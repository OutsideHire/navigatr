// calendar_oauth — Google Calendar OAuth connect/callback/list/disconnect.
//
// Routing: sub-route is the path segment after the function name, i.e.
// /functions/v1/calendar_oauth/<sub>. Mirrors geocode's CORS / json() shape.
//
//   start       POST, authenticated — returns { authUrl } for the browser to
//               redirect to. State is a self-verifying signed token (HMAC-SHA256
//               over userId.nonce.expiry keyed by the service-role key), so
//               /callback can trust it without a session.
//   callback    GET, no session — Google redirects here with code+state. Verifies
//               state, exchanges the code, upserts oauth_connections (service
//               role), stores the token bundle in Vault, then 302s back to the app.
//   calendars   POST, authenticated — lists the user's calendars for the personal-
//               calendar picker.
//   disconnect  POST, authenticated — marks the connection revoked and best-effort
//               revokes the grant with Google.
//
// Secrets are read from env at runtime; nothing is hardcoded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshAccessToken, type TokenBundle } from "../_shared/googleToken.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "";
// Where to bounce the browser after the callback completes. Falls back to the
// request's referer origin, then to localhost dev — see resolveAppUrl().
const APP_URL = Deno.env.get("APP_URL") ?? "";

const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/calendar_oauth/callback`;

// Two read-only calendar scopes: calendar list + events read.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

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

// state = <userId>.<nonce>.<expiryMs>.<sig>  (sig over the first three joined by ".")
async function signState(userId: string): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const expiry = String(Date.now() + STATE_TTL_MS);
  const payload = `${userId}.${nonce}.${expiry}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, expiry, sig] = parts;
  const payload = `${userId}.${nonce}.${expiry}`;
  const expected = await hmac(payload);
  // Constant-time-ish compare: lengths + char loop.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (Number.isNaN(Number(expiry)) || Date.now() > Number(expiry)) return null;
  return userId;
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

  const state = await signState(auth.userId);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
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

    const userId = await verifyState(state);
    if (!userId) return redirect(errUrl);

    // Exchange the auth code for tokens.
    const form = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: CALLBACK_URL,
      grant_type: "authorization_code",
    });
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
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
          provider: "google",
          scopes: SCOPES,
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

    return redirect(okUrl);
  } catch {
    return redirect(errUrl);
  }
}

async function handleCalendars(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

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

  const svc = serviceClient();
  // Grab the refresh token (best-effort revoke with Google) before flipping.
  const { data: conn } = await svc
    .from("oauth_connections")
    .select("id")
    .eq("provider", "google")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (conn) {
    const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: conn.id });
    const refreshToken = (bundleJson as TokenBundle | null)?.refresh_token;
    if (refreshToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch { /* best-effort */ }
    }
  }

  await svc
    .from("oauth_connections")
    .update({ status: "revoked" })
    .eq("provider", "google")
    .eq("user_id", auth.userId);

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
