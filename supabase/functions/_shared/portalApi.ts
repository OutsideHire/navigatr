/**
 * Request handler for the portal_api edge function (Partner Portal, spec 5.1).
 *
 * Partners are never Supabase Auth users (spec R2). Identity comes only from the
 * x-portal-session header, checked by portal_session_lookup in SQL on every
 * request; Authorization is never read for identity. Secrets, rate limits,
 * expiry and state changes all live in service-role-only SQL functions, so this
 * module only routes, shapes responses from explicit allowlists (never passing a
 * row through), and sends the sign-in code email.
 *
 * Pure TS with injected dependencies and no Deno globals at module scope, so the
 * app's vitest run covers it. portal_api/index.ts wires the real service-role
 * client and Resend.
 */
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { portalCodeEmail, portalFromAddress, portalUrl } from "./portalEmail.ts";

export const PORTAL_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface PortalRpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface PortalEmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface PortalEnv {
  appBaseUrl: string;
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
}

export interface PortalApiDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>;
  sendEmail(msg: PortalEmailMessage): Promise<void>;
  /** Reserved for later phases; Phase 1A keeps every clock in SQL. */
  now?(): Date;
  /**
   * Keeps a fire-and-forget promise alive past the response (EdgeRuntime.waitUntil).
   * request_code hands the email send here so its latency cannot reveal whether an
   * account exists. When absent the promise is detached with a swallowed rejection.
   */
  background?(p: Promise<unknown>): void;
  env: PortalEnv;
}

/** Narrower than Headers so tests and callers can pass any header bag. */
export interface HeaderReader {
  get(name: string): string | null;
}

export type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out";

const ACTIONS: ReadonlySet<string> = new Set<PortalAction>([
  "brand",
  "request_code",
  "verify_code",
  "peek_invite",
  "accept_invite",
  "me",
  "sign_out",
]);

interface BrandRow {
  org_name: string;
  product_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  dark_logo_url: string | null;
}

interface IssuedCodeRow {
  code: string;
  recipient: string;
  org_name: string;
  org_slug: string;
}

interface SessionRow {
  session_token: string;
  session_expires_at: string;
}

interface InviteRow {
  partner_name: string;
  org_name: string;
  terms_text: string | null;
  terms_version: number;
}

interface LookupRow {
  portal_user_id: string;
  partner_name: string;
  user_email: string;
  org_name: string;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = PORTAL_CORS_HEADERS,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Sub-route = last path segment: /functions/v1/portal_api/<action>. */
export function portalAction(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** First x-forwarded-for entry (the client as seen by the edge), or null. */
export function clientIp(headers: HeaderReader): string | null {
  const raw = headers.get("x-forwarded-for");
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first || null;
}

export function sessionTokenFrom(headers: HeaderReader): string {
  return (headers.get("x-portal-session") ?? "").trim();
}

/** RETURNS TABLE functions come back from PostgREST as arrays. */
export function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data.length > 0 ? (data[0] as T) : null;
  return data !== null && typeof data === "object" ? (data as T) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function handlePortalRequest(req: Request, deps: PortalApiDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PORTAL_CORS_HEADERS });

  const action = portalAction(req.url);
  if (!ACTIONS.has(action)) return jsonResponse({ error: "not_found" }, 404);
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    body = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const slug = str(body.slug).trim().toLowerCase();
  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");

  try {
    switch (action as PortalAction) {
      case "brand":
        return await brand(slug, deps);
      case "request_code":
        return await requestCode(slug, str(body.email).trim(), ip, deps);
      case "verify_code":
        return await verifyCode(slug, str(body.email).trim(), str(body.code), ip, userAgent, deps);
      case "peek_invite":
        return await peekInvite(slug, str(body.token).trim(), deps);
      case "accept_invite":
        return await acceptInvite(slug, str(body.token).trim(), body.termsVersion, ip, userAgent, deps);
      case "me":
        return await me(slug, sessionTokenFrom(req.headers), deps);
      case "sign_out":
        return await signOut(sessionTokenFrom(req.headers), deps);
      default:
        return jsonResponse({ error: "not_found" }, 404);
    }
  } catch (e) {
    // A throwing or rejecting rpc must look exactly like the handled failure for
    // each action: no detail, and no existence oracle on the sign-in routes.
    console.error(`[portal_api] ${action} threw:`, e instanceof Error ? e.message : String(e));
    if (action === "request_code") return jsonResponse({ ok: true });
    if (action === "verify_code") return jsonResponse({ error: "invalid_code" }, 401);
    return jsonResponse({ error: "server_error" }, 500);
  }
}

async function brand(slug: string, deps: PortalApiDeps): Promise<Response> {
  const { data, error } = await deps.rpc("portal_brand", { p_slug: slug });
  if (error) {
    console.error("[portal_api] brand failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<BrandRow>(data);
  if (!row) return jsonResponse({ error: "not_available" }, 404);
  return jsonResponse({
    brand: {
      orgName: row.org_name,
      productName: row.product_name ?? "navigatr",
      primaryColor: row.primary_color ?? null,
      logoUrl: row.logo_url ?? null,
      darkLogoUrl: row.dark_logo_url ?? null,
    },
  });
}

/** Always { ok: true }, whatever happened (NFR-PORT-04). */
async function requestCode(slug: string, email: string, ip: string | null, deps: PortalApiDeps): Promise<Response> {
  const generic = () => jsonResponse({ ok: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic();
  try {
    const { data, error } = await deps.rpc("portal_issue_code", { p_slug: slug, p_email: email, p_ip: ip });
    if (error) {
      console.error("[portal_api] issue code failed:", error.message);
      return generic();
    }
    const row = firstRow<IssuedCodeRow>(data);
    if (!row?.code) return generic();
    if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.recipient)) {
      console.log(`[portal_api][emailGuard] dropped a sign-in code in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
      return generic();
    }
    const built = portalCodeEmail({
      orgName: row.org_name,
      code: row.code,
      signInUrl: portalUrl(deps.env.appBaseUrl, row.org_slug),
    });
    const { html, text } = renderEmail(built);
    // Not awaited: response time must not depend on whether an email was sent.
    const sending = deps
      .sendEmail({
        from: portalFromAddress(deps.env.fromAddress, row.org_name),
        to: row.recipient,
        subject: built.subject,
        html,
        text,
      })
      .catch((e: unknown) => {
        console.error("[portal_api] sign-in code send failed:", e instanceof Error ? e.message : String(e));
      });
    if (deps.background) deps.background(sending);
  } catch (e) {
    console.error("[portal_api] sign-in code send failed:", e instanceof Error ? e.message : String(e));
  }
  return generic();
}

async function verifyCode(
  slug: string,
  email: string,
  rawCode: string,
  ip: string | null,
  userAgent: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  const invalid = () => jsonResponse({ error: "invalid_code" }, 401);
  const code = rawCode.replace(/\s+/g, "");
  if (!email || !/^\d{6}$/.test(code)) return invalid();
  const { data, error } = await deps.rpc("portal_verify_code", {
    p_slug: slug,
    p_email: email,
    p_code: code,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) {
    console.error("[portal_api] verify failed:", error.message);
    return invalid();
  }
  const row = firstRow<SessionRow>(data);
  if (!row?.session_token) return invalid();
  return jsonResponse({ sessionToken: row.session_token, expiresAt: row.session_expires_at });
}

async function peekInvite(slug: string, token: string, deps: PortalApiDeps): Promise<Response> {
  if (!token) return jsonResponse({ error: "invalid_invite" }, 404);
  const { data, error } = await deps.rpc("portal_peek_invite", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] peek failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<InviteRow>(data);
  if (!row) return jsonResponse({ error: "invalid_invite" }, 404);
  return jsonResponse({
    invite: {
      partnerName: row.partner_name,
      orgName: row.org_name,
      termsText: row.terms_text ?? "",
      termsVersion: row.terms_version,
    },
  });
}

async function acceptInvite(
  slug: string,
  token: string,
  termsVersion: unknown,
  ip: string | null,
  userAgent: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  if (!token || typeof termsVersion !== "number" || !Number.isInteger(termsVersion)) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const { data, error } = await deps.rpc("portal_accept_invite", {
    p_slug: slug,
    p_token: token,
    p_terms_version: termsVersion,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) {
    if (error.message.includes("terms_changed")) return jsonResponse({ error: "terms_changed" }, 409);
    return jsonResponse({ error: "invalid_invite" }, 404);
  }
  const row = firstRow<SessionRow>(data);
  if (!row?.session_token) return jsonResponse({ error: "invalid_invite" }, 404);
  return jsonResponse({ sessionToken: row.session_token, expiresAt: row.session_expires_at });
}

async function me(slug: string, token: string, deps: PortalApiDeps): Promise<Response> {
  const unauthorized = () => jsonResponse({ error: "unauthorized" }, 401);
  if (!token) return unauthorized();
  const { data, error } = await deps.rpc("portal_session_lookup", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] session lookup failed:", error.message);
    return unauthorized();
  }
  const row = firstRow<LookupRow>(data);
  if (!row?.portal_user_id) return unauthorized();
  return jsonResponse({ me: { partnerName: row.partner_name, email: row.user_email, orgName: row.org_name } });
}

async function signOut(token: string, deps: PortalApiDeps): Promise<Response> {
  if (token) {
    const { error } = await deps.rpc("portal_sign_out", { p_token: token });
    if (error) console.error("[portal_api] sign out failed:", error.message);
  }
  return jsonResponse({ ok: true });
}
