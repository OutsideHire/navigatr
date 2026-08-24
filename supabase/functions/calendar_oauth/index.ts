// calendar_oauth — Calendar OAuth connect/callback/list/disconnect.
//
// Provider-aware: the OAuth endpoints (authUrl / tokenUrl / revokeUrl / scopes /
// client-id+secret env vars / extra auth params) come from
// getProvider(provider).oauth. `provider` defaults to "google" everywhere, so
// existing Google callers (which send no `provider`) behave exactly as before.
//
// Routing: sub-route is the path segment after the function name, i.e.
// /functions/v1/calendar_oauth/<sub>. Mirrors geocode's CORS / json() shape.
//
//   start       POST, authenticated — accepts { provider? } and returns
//               { authUrl } for the browser to redirect to. State is a
//               self-verifying signed token (HMAC-SHA256 over
//               userId.nonce.expiry.provider keyed by the service-role key), so
//               /callback can trust it (incl. which provider) without a session.
//   callback    GET, no session — the provider redirects here with code+state.
//               Verifies state, reads the provider from it, exchanges the code
//               against that provider's token URL, upserts oauth_connections
//               (service role), stores the token bundle in Vault, then 302s back.
//   calendars   POST, authenticated — accepts { provider? }; lists the user's
//               calendars for the personal-calendar picker (Google only for now;
//               Microsoft returns an empty list — no picker in this slice).
//   disconnect  POST, authenticated — accepts { provider? }; marks the connection
//               revoked. For providers with a revoke endpoint (Google) it also
//               best-effort revokes the grant; for those without (Microsoft) it
//               clears the stored token instead.
//
// Secrets are read from env at runtime; nothing is hardcoded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshAccessToken, type TokenBundle } from "../_shared/googleToken.ts";
import { getProvider, type CalendarProviderId } from "../_shared/calendarProviders/index.ts";
import {
  emailConnectionRowForConnect,
  shouldRemoveEmailConnectionOnDisconnect,
} from "../_shared/emailConnection.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "";
// Where to bounce the browser after the callback completes. Falls back to the
// request's referer origin, then to localhost dev — see resolveAppUrl().
const APP_URL = Deno.env.get("APP_URL") ?? "";
// Automatic Email Activity Capture: when on, connecting Outlook also registers
// the mailbox for the sent-mail poll (see _shared/emailConnection.ts).
const EMAIL_CAPTURE_ENABLED = Deno.env.get("EMAIL_CAPTURE_ENABLED") === "1";

// Base origin used to build the OAuth callback the browser is redirected back
// to. Defaults to the project's Supabase URL (…supabase.co). Set
// CALENDAR_CALLBACK_BASE to a custom domain (e.g. https://api.getnavigatr.io,
// no trailing slash) so the Google consent screen shows our own domain. This
// value MUST also be registered as an Authorized redirect URI on the Google
// OAuth client (as `<base>/functions/v1/calendar_oauth/callback`).
const CALLBACK_BASE = (Deno.env.get("CALENDAR_CALLBACK_BASE") ?? SUPABASE_URL).replace(/\/+$/, "");
const CALLBACK_URL = `${CALLBACK_BASE}/functions/v1/calendar_oauth/callback`;

// Scopes are provider-specific and sourced from getProvider(provider).oauth.scopes.
// Google's set includes calendar.events (read/WRITE) so navigatr appointments can be
// pushed (M6); any user connected under the old read-only scope must reconnect once
// to grant write.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the round-trip.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---- state signing (self-verifying, session-free) --------------------------

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

// state = <userId>.<nonce>.<expiryMs>.<provider>.<sig>
// The HMAC covers the whole payload (userId.nonce.expiry.provider), so tampering
// with the provider — like any other field — invalidates the signature. `provider`
// is a fixed enum ("google"/"microsoft") with no "." so the "." split stays safe.
async function signState(userId: string, provider: CalendarProviderId): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const expiry = String(Date.now() + STATE_TTL_MS);
  const payload = `${userId}.${nonce}.${expiry}.${provider}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

async function verifyState(
  state: string,
): Promise<{ userId: string; provider: CalendarProviderId } | null> {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [userId, nonce, expiry, provider, sig] = parts;
  const payload = `${userId}.${nonce}.${expiry}.${provider}`;
  const expected = await hmac(payload);
  // Constant-time-ish compare: lengths + char loop.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (Number.isNaN(Number(expiry)) || Date.now() > Number(expiry)) return null;
  if (provider !== "google" && provider !== "microsoft") return null;
  return { userId, provider };
}

// ---- helpers ----------------------------------------------------------------

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function resolveAppUrl(req: Request): string {
  if (APP_URL) return APP_URL.replace(/\/$/, "");
  const referer = req.headers.get("referer") ?? req.headers.get("origin");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch { /* fall through */ }
  }
  return "http://localhost:5173"; // vite dev default
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: url } });
}

async function requireUser(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return json({ error: "unauthorized" }, 401);
  return { userId: data.user.id };
}

/** Read the requested provider from the JSON body, defaulting to "google".
 *  Existing callers send no body (invoke() with no args), which throws on
 *  req.json() → we swallow it and return "google", preserving today's behavior.
 *  Any missing/unknown value also falls back to "google". */
async function readProvider(req: Request): Promise<CalendarProviderId> {
  try {
    const body = (await req.json()) as { provider?: unknown } | null;
    if (body?.provider === "microsoft") return "microsoft";
    if (body?.provider === "google") return "google";
  } catch { /* no/empty/invalid body → default */ }
  return "google";
}

/** Load the connection id + a fresh access token for this user, persisting a
 *  refreshed bundle back to Vault when the token had expired. */
async function freshTokenForUser(
  userId: string,
): Promise<{ connectionId: string; accessToken: string } | null> {
  const svc = serviceClient();
  const { data: conn } = await svc
    .from("oauth_connections")
    .select("id, status")
    .eq("provider", "google")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn || conn.status !== "active") return null;

  const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: conn.id });
  if (!bundleJson) return null;
  const bundle = bundleJson as TokenBundle;

  const fresh = await getFreshAccessToken(bundle, {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  });
  if (fresh.refreshed) {
    await svc.rpc("oauth_token_set", { p_connection_id: conn.id, p_token: fresh.bundle });
    await svc
      .from("oauth_connections")
      .update({ last_refreshed_at: new Date().toISOString() })
      .eq("id", conn.id);
  }
  return { connectionId: conn.id, accessToken: fresh.accessToken };
}

// ---- sub-routes --------------------------------------------------------------

async function handleStart(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const provider = await readProvider(req);
  const { oauth } = getProvider(provider);

  const state = await signState(auth.userId, provider);
  const url = new URL(oauth.authUrl);
  url.searchParams.set("client_id", Deno.env.get(oauth.clientIdEnv) ?? "");
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oauth.scopes.join(" "));
  // Provider-specific extras (Google: access_type/prompt/include_granted_scopes;
  // Microsoft: response_mode). Object.entries preserves insertion order, so for
  // Google these land in the same order/positions as before.
  for (const [k, v] of Object.entries(oauth.extraAuthParams)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("state", state);
  return json({ authUrl: url.toString() });
}

async function handleCallback(req: Request): Promise<Response> {
  const appUrl = resolveAppUrl(req);
  const okUrl = `${appUrl}/settings/integrations?calendar=connected`;
  const errUrl = `${appUrl}/settings/integrations?calendar=error`;
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (!code || !state) return redirect(errUrl);

    const verified = await verifyState(state);
    if (!verified) return redirect(errUrl);
    const { userId, provider } = verified;
    const { oauth } = getProvider(provider);

    // Exchange the auth code for tokens against the provider's token endpoint.
    const form = new URLSearchParams({
      code,
      client_id: Deno.env.get(oauth.clientIdEnv) ?? "",
      client_secret: Deno.env.get(oauth.clientSecretEnv) ?? "",
      redirect_uri: CALLBACK_URL,
      grant_type: "authorization_code",
    });
    const tokRes = await fetch(oauth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!tokRes.ok) return redirect(errUrl);
    const tok = (await tokRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    // Both providers must return a refresh_token (Google via access_type=offline
    // + prompt=consent, Microsoft via the offline_access scope). No refresh token
    // means we can't keep the connection alive → treat as a failed connect.
    if (!tok.access_token || !tok.refresh_token) return redirect(errUrl);

    const bundle: TokenBundle = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expiry: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };

    const svc = serviceClient();
    // The connection is (org_id, user_id, provider); fetch the user's org.
    const { data: profile, error: profileErr } = await svc
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr || !profile?.org_id) return redirect(errUrl);

    const nowIso = new Date().toISOString();
    const { data: conn, error: upsertErr } = await svc
      .from("oauth_connections")
      .upsert(
        {
          org_id: profile.org_id,
          user_id: userId,
          provider,
          scopes: oauth.scopes,
          status: "active",
          connected_at: nowIso,
          last_refreshed_at: nowIso,
        },
        { onConflict: "org_id,user_id,provider" },
      )
      .select("id")
      .single();
    if (upsertErr || !conn) return redirect(errUrl);

    const { error: tokenErr } = await svc.rpc("oauth_token_set", {
      p_connection_id: conn.id,
      p_token: bundle,
    });
    if (tokenErr) return redirect(errUrl);

    // Register the mailbox for the sent-mail poll when Outlook connects with
    // email capture on. Non-fatal: a failure here must not break the calendar
    // connect the user actually asked for, so we log and still redirect ok.
    const emailRow = emailConnectionRowForConnect({
      provider,
      orgId: profile.org_id,
      userId,
      emailCaptureEnabled: EMAIL_CAPTURE_ENABLED,
    });
    if (emailRow) {
      const { error: ecErr } = await svc
        .from("email_connection")
        .upsert(emailRow, { onConflict: "user_id,provider" });
      if (ecErr) console.error("email_connection provision failed:", ecErr.message);
    }

    return redirect(okUrl);
  } catch {
    return redirect(errUrl);
  }
}

async function handleCalendars(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const provider = await readProvider(req);
  // No Microsoft calendar picker in this slice — Graph's calendarView reads the
  // primary calendar directly (see read_calendar_events), so there's nothing to
  // pick yet. Return an empty list rather than erroring.
  if (provider === "microsoft") return json({ calendars: [] });

  const fresh = await freshTokenForUser(auth.userId);
  if (!fresh) return json({ error: "not_connected" }, 409);

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${fresh.accessToken}` } },
  );
  if (!res.ok) return json({ error: "calendar_list_failed", detail: `http ${res.status}` }, 502);
  const data = (await res.json()) as {
    items?: Array<{ id: string; summary?: string; primary?: boolean }>;
  };
  const calendars = (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: !!c.primary,
  }));
  return json({ calendars });
}

async function handleDisconnect(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const provider = await readProvider(req);
  const { oauth } = getProvider(provider);

  const svc = serviceClient();
  // Grab the connection (and its token) before flipping so we can revoke/clear it.
  const { data: conn } = await svc
    .from("oauth_connections")
    .select("id")
    .eq("provider", provider)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (conn) {
    const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: conn.id });
    const refreshToken = (bundleJson as TokenBundle | null)?.refresh_token;
    if (oauth.revokeUrl) {
      // Providers with a revoke endpoint (Google): best-effort remote revoke.
      if (refreshToken) {
        try {
          await fetch(`${oauth.revokeUrl}?token=${encodeURIComponent(refreshToken)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
        } catch { /* best-effort */ }
      }
    } else if (bundleJson) {
      // Providers without a revoke endpoint (Microsoft): we can't tell the IdP to
      // invalidate the grant, so drop our stored copy by overwriting it with an
      // empty bundle via the sanctioned RPC.
      try {
        await svc.rpc("oauth_token_set", {
          p_connection_id: conn.id,
          p_token: { access_token: "", refresh_token: "", expiry: "" },
        });
      } catch { /* best-effort */ }
    }
  }

  await svc
    .from("oauth_connections")
    .update({ status: "revoked" })
    .eq("provider", provider)
    .eq("user_id", auth.userId);

  // Drop the mailbox's email_connection row on Outlook disconnect so the poll
  // stops and it leaves the admin health card. Best-effort; independent of the
  // capture flag (cleaning up on disconnect is always correct).
  if (shouldRemoveEmailConnectionOnDisconnect(provider)) {
    await svc
      .from("email_connection")
      .delete()
      .eq("user_id", auth.userId)
      .eq("provider", "outlook");
  }

  return json({ ok: true });
}

// ---- entry -------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const path = new URL(req.url).pathname;
  const sub = path.split("/").filter(Boolean).pop() ?? "";

  switch (sub) {
    case "start":
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return handleStart(req);
    case "callback":
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return handleCallback(req);
    case "calendars":
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return handleCalendars(req);
    case "disconnect":
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return handleDisconnect(req);
    default:
      return json({ error: "not_found", detail: `unknown sub-route: ${sub}` }, 404);
  }
});
