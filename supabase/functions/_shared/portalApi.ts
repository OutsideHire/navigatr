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
import { portalCodeEmail, portalEmailBrand, portalFromAddress, portalUrl } from "./portalEmail.ts";
import { PUBLIC_FORM_ACTIONS, handlePublicFormAction, isPublicFormAction, type PublicFormAction } from "./portalPublicForm.ts";
import { REFERRAL_ACTIONS, handleReferralAction, isReferralAction, type ReferralAction } from "./portalReferralApi.ts";

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
  /** Phase 2B-1: PUBLIC_FORM_SIGNING_SECRET. Unset means the public form answers not_available. */
  publicFormSigningSecret?: string | null;
  /** Phase 2B-1: TURNSTILE_SECRET_KEY. Unset means the Turnstile check always fails. */
  turnstileSecretKey?: string | null;
}

export interface PortalApiDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>;
  sendEmail(msg: PortalEmailMessage): Promise<void>;
  /** Clock for the referral time windows (Phase 1B); defaults to new Date(). */
  now?(): Date;
  /** Speech-to-text for the portal's dictated notes (Phase 1B). Absent means transcribe answers 500. */
  transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>;
  /**
   * Keeps a fire-and-forget promise alive past the response (EdgeRuntime.waitUntil).
   * request_code hands the email send here so its latency cannot reveal whether an
   * account exists. When absent the promise is detached with a swallowed rejection.
   */
  background?(p: Promise<unknown>): void;
  /** Outbound HTTP for the Turnstile check (Phase 2B-1). Absent means the check always fails. */
  fetch?(input: string, init: RequestInit): Promise<Response>;
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
  | "get_terms"
  | "accept_terms"
  | "sign_out"
  | "unsubscribe_digest"
  | ReferralAction
  | PublicFormAction;

const ACTIONS: ReadonlySet<string> = new Set<PortalAction>([
  "brand",
  "request_code",
  "verify_code",
  "peek_invite",
  "accept_invite",
  "me",
  "get_terms",
  "accept_terms",
  "sign_out",
  "unsubscribe_digest",
  ...REFERRAL_ACTIONS,
  ...PUBLIC_FORM_ACTIONS,
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
  /** Phase 1C: the ISO's brand rides along so the send needs no second lookup. */
  logo_url?: string | null;
  primary_color?: string | null;
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
  org_id: string;
  partner_id: string;
  partner_name: string;
  user_email: string;
  org_name: string;
  /** FR-PORT-18: false once the ISO edits its terms, until the partner accepts them. */
  terms_current?: boolean | null;
}

interface SessionTermsRow {
  terms_text: string | null;
  terms_version: number;
  terms_current: boolean | null;
}

/** Input caps, checked before any rpc so oversized input never reaches SQL. */
export const PORTAL_LIMITS = {
  slug: 64,
  email: 254,
  code: 16,
  token: 128,
  ip: 64,
  userAgent: 512,
} as const;

function tooLong(value: string, max: number): boolean {
  return value.length > max;
}

function truncate(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
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

/**
 * The client IP, best effort. The header order (cf-connecting-ip, then x-real-ip, then the
 * first x-forwarded-for entry) is a guess: which of these Supabase's edge sets, and whether
 * it overwrites a client-sent value, is unverified (an operator step checks it on staging).
 * Treat every one of them as possibly client-controlled, so no limit may rest on this alone
 * (R6): portal_public_submit also enforces per-link and per-org limits keyed on no header.
 */
export function clientIp(headers: HeaderReader): string | null {
  for (const name of ["cf-connecting-ip", "x-real-ip"]) {
    const v = headers.get(name)?.trim() ?? "";
    if (v) return v.slice(0, 64);
  }
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return first ? first.slice(0, 64) : null;
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

  // FR-PORT-84: no session, and the one-click POST from a mail provider is
  // form-encoded, so this action reads its own input before the JSON parse.
  if (action === "unsubscribe_digest") {
    try {
      return await unsubscribeDigest(req, deps);
    } catch (e) {
      console.error("[portal_api] unsubscribe_digest threw:", e instanceof Error ? e.message : String(e));
      return jsonResponse({ error: "server_error" }, 500);
    }
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    body = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const slug = str(body.slug).trim().toLowerCase();
  const ip = truncate(clientIp(req.headers), PORTAL_LIMITS.ip);
  const userAgent = truncate(req.headers.get("user-agent"), PORTAL_LIMITS.userAgent);
  const slugTooLong = tooLong(slug, PORTAL_LIMITS.slug);

  try {
    switch (action as PortalAction) {
      case "brand":
        if (slugTooLong) return jsonResponse({ error: "not_available" }, 404);
        return await brand(slug, deps);
      case "request_code": {
        const email = str(body.email).trim();
        if (slugTooLong || tooLong(email, PORTAL_LIMITS.email)) return jsonResponse({ ok: true });
        return await requestCode(slug, email, ip, deps);
      }
      case "verify_code": {
        const email = str(body.email).trim();
        const code = str(body.code).replace(/\s+/g, "");
        if (slugTooLong || tooLong(email, PORTAL_LIMITS.email) || tooLong(code, PORTAL_LIMITS.code)) {
          return jsonResponse({ error: "invalid_code" }, 401);
        }
        return await verifyCode(slug, email, code, ip, userAgent, deps);
      }
      case "peek_invite": {
        const token = str(body.token).trim();
        if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "invalid_invite" }, 404);
        return await peekInvite(slug, token, deps);
      }
      case "accept_invite": {
        const token = str(body.token).trim();
        if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "invalid_body" }, 400);
        return await acceptInvite(slug, token, body.termsVersion, ip, userAgent, deps);
      }
      case "me": {
        const token = sessionTokenFrom(req.headers);
        if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
        return await me(slug, token, deps);
      }
      case "get_terms": {
        const token = sessionTokenFrom(req.headers);
        if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
        return await getTerms(slug, token, deps);
      }
      case "accept_terms": {
        const token = sessionTokenFrom(req.headers);
        if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
        return await acceptTerms(slug, token, body.termsVersion, ip, deps);
      }
      case "sign_out": {
        const token = sessionTokenFrom(req.headers);
        if (tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ ok: true });
        return await signOut(token, deps);
      }
      default: {
        if (isPublicFormAction(action)) {
          // The public form has no session (FR-PORT-24): x-portal-session is never read.
          const token = str(body.token).trim();
          if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "not_available" }, 404);
          const result = await handlePublicFormAction(action, slug, token, body, ip, deps);
          return jsonResponse(result.body, result.status);
        }
        if (isReferralAction(action)) {
          const token = sessionTokenFrom(req.headers);
          if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
          return await referral(action, slug, token, body, ip, deps);
        }
        return jsonResponse({ error: "not_found" }, 404);
      }
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
    const portalAddressUrl = portalUrl(deps.env.appBaseUrl, row.org_slug);
    const built = portalCodeEmail({
      orgName: row.org_name,
      code: row.code,
      signInUrl: portalAddressUrl,
      portalAddressUrl,
    });
    const { html, text } = renderEmail({ ...built, brand: portalEmailBrand(row.org_name, row) });
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
  return jsonResponse({
    me: {
      partnerName: row.partner_name,
      email: row.user_email,
      orgName: row.org_name,
      termsCurrent: row.terms_current === true,
    },
  });
}

/** FR-PORT-18: the terms a signed-in partner is asked to accept after the ISO changed them. */
async function getTerms(slug: string, token: string, deps: PortalApiDeps): Promise<Response> {
  const unauthorized = () => jsonResponse({ error: "unauthorized" }, 401);
  if (!token) return unauthorized();
  const { data, error } = await deps.rpc("portal_get_terms", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] get terms failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<SessionTermsRow>(data);
  if (!row) return unauthorized();
  return jsonResponse({
    terms: { termsText: row.terms_text ?? "", termsVersion: row.terms_version, termsCurrent: row.terms_current === true },
  });
}

/**
 * FR-PORT-18: accept the version the partner read. A 409 terms_changed means the
 * ISO edited the terms again in the meantime, so the page shows the new text.
 */
async function acceptTerms(
  slug: string,
  token: string,
  termsVersion: unknown,
  ip: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  if (typeof termsVersion !== "number" || !Number.isInteger(termsVersion)) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const { error } = await deps.rpc("portal_accept_terms", {
    p_slug: slug,
    p_token: token,
    p_terms_version: termsVersion,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("terms_changed")) return jsonResponse({ error: "terms_changed" }, 409);
    if (error.message.includes("invalid_session")) return jsonResponse({ error: "unauthorized" }, 401);
    console.error("[portal_api] accept terms failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({ ok: true });
}

async function signOut(token: string, deps: PortalApiDeps): Promise<Response> {
  if (token) {
    const { error } = await deps.rpc("portal_sign_out", { p_token: token });
    if (error) console.error("[portal_api] sign out failed:", error.message);
  }
  return jsonResponse({ ok: true });
}

/**
 * Weekly summary opt-out (FR-PORT-84). The List-Unsubscribe one-click target
 * carries slug and t in the query string; the portal page posts JSON
 * { slug, token }. The answer never says whether the token matched anyone.
 * Only POST reaches here (a GET, e.g. a link scanner, is a 405 and changes nothing).
 * A request with no resolvable client IP shares one "unknown" rate-limit bucket in
 * SQL (which skips the per-IP limit for a null IP), so stripping the IP headers does
 * not escape the limit. The IP comes from request headers, so the per-IP limit on
 * misses is a brake on guessing, not a guarantee; the 128-bit token is the defense.
 */
async function unsubscribeDigest(req: Request, deps: PortalApiDeps): Promise<Response> {
  const done = () => jsonResponse({ ok: true });
  let slug = "";
  let token = "";
  try {
    const url = new URL(req.url);
    slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
    token = (url.searchParams.get("t") ?? "").trim();
  } catch {
    // Fall through to the body.
  }
  if (!slug || !token) {
    slug = "";
    token = "";
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      try {
        const parsed: unknown = await req.json();
        if (parsed !== null && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          slug = str(obj.slug).trim().toLowerCase();
          token = str(obj.token).trim();
        }
      } catch {
        return done();
      }
    }
  }
  if (!slug || !token || tooLong(slug, PORTAL_LIMITS.slug) || tooLong(token, PORTAL_LIMITS.token)) return done();
  const { error } = await deps.rpc("portal_unsubscribe_digest", {
    p_slug: slug,
    p_token: token,
    p_ip: truncate(clientIp(req.headers), PORTAL_LIMITS.ip) ?? "unknown",
  });
  if (error) {
    console.error("[portal_api] unsubscribe failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return done();
}

/**
 * Phase 1B signed-in actions. The session is looked up on every request, and the
 * org, partner and portal user it returns are the only scope the referral
 * functions ever see. A database error during the lookup is a 500 (retry), not a
 * 401, so a transient failure never signs the partner out. Until the partner has
 * accepted the ISO's current terms (FR-PORT-18) every one of these actions is a
 * 403 terms_required; a lookup that does not say the terms are current counts as
 * not current.
 */
async function referral(
  action: ReferralAction,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  const { data, error } = await deps.rpc("portal_session_lookup", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] session lookup failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<LookupRow>(data);
  if (!row?.portal_user_id) return jsonResponse({ error: "unauthorized" }, 401);
  if (row.terms_current !== true) return jsonResponse({ error: "terms_required" }, 403);
  const result = await handleReferralAction(
    action,
    { portalUserId: row.portal_user_id, orgId: row.org_id, partnerId: row.partner_id },
    body,
    ip,
    deps,
  );
  return jsonResponse(result.body, result.status);
}
