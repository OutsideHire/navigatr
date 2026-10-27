/**
 * Public referral form (Partner Portal Phase 2B-1, PRD FR-PORT-24..34).
 *
 * Anyone holding a rep's or the ISO's form link can send a business with no
 * sign-in. Bot mitigation (FR-PORT-30) is invisible to people:
 *   - a hidden "website" field that only bots fill (the honeypot);
 *   - a signed form token: an HMAC over the slug, the link token and the issue
 *     time (newline-separated, which neither a slug nor a link token can hold), so the server can tell how long the form was open without storing
 *     anything, and a post under 3 seconds is treated as a bot;
 *   - a per-IP count across every tenant: past 5 an hour the caller must pass
 *     Cloudflare Turnstile, and past 30 nothing goes through.
 * A too-fast post or a filled honeypot gets a response identical to success
 * with a random reference, so a bot learns nothing.
 *
 * Pure TS, no Deno globals at module scope: vitest covers it. Web Crypto
 * (globalThis.crypto) exists in both Deno and Node.
 */
import { timingSafeEquals } from "./cronAuth.ts";
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { noReplyAddress, portalEmailBrand, portalFromAddress, portalPublicConfirmationEmail } from "./portalEmail.ts";
import type { ActionResult } from "./portalReferralApi.ts";
import { PORTAL_FIELD_LIMITS, matchEmployeeCount, type EmployeeCount } from "./portalSubmission.ts";

export const PUBLIC_FORM_LIMITS = {
  companyName: PORTAL_FIELD_LIMITS.companyName,
  contactName: PORTAL_FIELD_LIMITS.contactName,
  email: PORTAL_FIELD_LIMITS.email,
  phone: PORTAL_FIELD_LIMITS.phone,
  notes: PORTAL_FIELD_LIMITS.notes,
  referredBy: 160,
  referrerEmail: PORTAL_FIELD_LIMITS.email,
  formToken: 128,
  captchaToken: 2048,
} as const;

/** Minimum time-to-submit (FR-PORT-30). */
export const PUBLIC_FORM_MIN_AGE_MS = 3_000;
/** A form left open longer than this must be reloaded. */
export const PUBLIC_FORM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Per IP per hour, across every tenant. Past the soft limit Turnstile is required. */
export const PUBLIC_SOFT_LIMIT_PER_HOUR = 5;
/** Per IP per hour, even with Turnstile. portal_public_submit enforces it again in SQL. */
export const PUBLIC_HARD_LIMIT_PER_HOUR = 30;
/** Per form link per hour: past this EVERYONE on the link must pass Turnstile (R6; not keyed on a client header). */
export const PUBLIC_LINK_SOFT_LIMIT_PER_HOUR = 10;
/** Turnstile siteverify timeout. */
export const TURNSTILE_TIMEOUT_MS = 5_000;
/** The honeypot: a field people never see and bots fill. */
export const PUBLIC_HONEYPOT_FIELD = "website";

export type PublicFormField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "notes"
  | "referredBy"
  | "referrerEmail"
  | "employeeCount"
  | "consent";

export const PUBLIC_FORM_FIELDS: readonly PublicFormField[] = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "notes",
  "referredBy",
  "referrerEmail",
  "employeeCount",
  "consent",
];

export function isPublicFormField(value: unknown): value is PublicFormField {
  return typeof value === "string" && (PUBLIC_FORM_FIELDS as readonly string[]).includes(value);
}

export interface PublicSubmission {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string | null;
  /** The sender's own email: the only address the confirmation goes to (FR-PORT-33). */
  referrerEmail: string | null;
  /** Optional business size (FR-PORT-35). */
  employeeCount: EmployeeCount | null;
  consentVersion: number;
}

export type PublicSubmissionCheck = { ok: true; value: PublicSubmission } | { ok: false; field: PublicFormField };

/** What public_form answers. Brand comes from portal_brand, which the page already loaded. */
export interface PortalPublicForm {
  orgName: string;
  /** The rep the link routes to, or null (tenant link, or a rep who no longer takes referrals). */
  repName: string | null;
  consentText: string;
  consentVersion: number;
  /** Echo back on public_submit. Opaque to the browser. */
  formToken: string;
}

/** The browser's public_submit body (besides slug and token). A type alias so it is a Record. */
export type PortalPublicSubmitInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string;
  /** Optional "Your email": "" for none. */
  referrerEmail: string;
  /** Optional "How many employees?": "" for none. */
  employeeCount: string;
  consent: boolean;
  consentVersion: number;
  formToken: string;
  /** The honeypot. Always "" from a person. */
  website: string;
  captchaToken?: string;
};

export interface PortalPublicSubmitted {
  ref: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** ASCII control characters, CR, LF and tab included (DEL too). */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** Notes are free text and may keep line breaks and tabs, nothing else from the control range. */
const NOTES_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Required: company, contact name, email, phone, notes (FR-PORT-29). Optional: who referred, the sender's own email, employee count. */
export function validatePublicSubmission(input: Readonly<Record<string, unknown>>): PublicSubmissionCheck {
  const text = (key: string): string => {
    const v = input[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const clean = (v: string): boolean => !CONTROL_RE.test(v);
  const fail = (field: PublicFormField): PublicSubmissionCheck => ({ ok: false, field });

  const companyName = text("companyName");
  if (!companyName || companyName.length > PUBLIC_FORM_LIMITS.companyName || !clean(companyName)) return fail("companyName");
  const contactName = text("contactName");
  if (!contactName || contactName.length > PUBLIC_FORM_LIMITS.contactName || !clean(contactName)) return fail("contactName");
  const email = text("email").toLowerCase();
  if (!email || email.length > PUBLIC_FORM_LIMITS.email || !EMAIL_RE.test(email) || !clean(email)) return fail("email");
  const phone = text("phone");
  if (!phone || phone.length > PUBLIC_FORM_LIMITS.phone || !clean(phone) || phone.replace(/\D/g, "").length < 7) return fail("phone");
  const notes = text("notes");
  if (!notes || notes.length > PUBLIC_FORM_LIMITS.notes || NOTES_CONTROL_RE.test(notes)) return fail("notes");
  const referredBy = text("referredBy");
  if (referredBy.length > PUBLIC_FORM_LIMITS.referredBy || !clean(referredBy)) return fail("referredBy");
  const rawReferrer = input.referrerEmail;
  if (rawReferrer !== undefined && rawReferrer !== null && typeof rawReferrer !== "string") return fail("referrerEmail");
  const referrerEmail = text("referrerEmail").toLowerCase();
  if (referrerEmail && (referrerEmail.length > PUBLIC_FORM_LIMITS.referrerEmail || !EMAIL_RE.test(referrerEmail) || !clean(referrerEmail))) {
    return fail("referrerEmail");
  }
  const employeeCount = matchEmployeeCount(text("employeeCount"));
  if (employeeCount === undefined) return fail("employeeCount");

  if (input.consent !== true) return fail("consent");
  const consentVersion = input.consentVersion;
  if (typeof consentVersion !== "number" || !Number.isInteger(consentVersion)) return fail("consent");

  return {
    ok: true,
    value: {
      companyName,
      contactName,
      email,
      phone,
      notes,
      referredBy: referredBy || null,
      referrerEmail: referrerEmail || null,
      employeeCount,
      consentVersion,
    },
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

/**
 * The signed message: slug, link token and issue time joined by "\n". A "."
 * delimiter was ambiguous ("a.b" + "c" and "a" + "b.c" signed the same bytes);
 * slugs and link tokens never contain a newline.
 */
function formTokenMessage(slug: string, token: string, issuedAtMs: number): string {
  return `${slug}\n${token}\n${issuedAtMs}`;
}

/** Canonical only: no leading zero, so one issue time has exactly one spelling. */
const FORM_TOKEN_RE = /^([1-9]\d{0,15})\.([0-9a-f]{64})$/;

/** `<issuedAtMs>.<hex HMAC-SHA256 of "slug\ntoken\nissuedAtMs">`. */
export async function signFormToken(secret: string, slug: string, token: string, issuedAtMs: number): Promise<string> {
  return `${issuedAtMs}.${await hmacSha256Hex(secret, formTokenMessage(slug, token, issuedAtMs))}`;
}

export type FormTokenCheck = "ok" | "too_fast" | "invalid";

/**
 * "invalid": missing, malformed, forged, for another link, or older than 24
 * hours (the caller answers form_expired). "too_fast": genuine but younger
 * than 3 seconds, or issued in the future (the caller answers a fake success).
 */
export async function checkFormToken(
  secret: string,
  slug: string,
  token: string,
  formToken: string,
  nowMs: number,
): Promise<FormTokenCheck> {
  const m = FORM_TOKEN_RE.exec(formToken);
  if (!m) return "invalid";
  const issuedAt = Number(m[1]);
  const expected = await hmacSha256Hex(secret, formTokenMessage(slug, token, issuedAt));
  if (!timingSafeEquals(expected, m[2])) return "invalid";
  const age = nowMs - issuedAt;
  if (age > PUBLIC_FORM_MAX_AGE_MS) return "invalid";
  if (age < PUBLIC_FORM_MIN_AGE_MS) return "too_fast";
  return "ok";
}

/** Same shape as _portal_referral_ref: REF- and 8 uppercase hex digits. */
export function fakeRef(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return `REF-${hex(bytes).toUpperCase()}`;
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Cloudflare Turnstile siteverify. Never throws; anything but success: true is false. */
export async function verifyTurnstile(
  fetchFn: FetchLike | undefined,
  secret: string | null | undefined,
  captchaToken: string,
  ip: string | null,
  timeoutMs: number = TURNSTILE_TIMEOUT_MS,
): Promise<boolean> {
  if (!fetchFn || !secret || !captchaToken) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new URLSearchParams({ secret, response: captchaToken });
    if (ip) form.set("remoteip", ip);
    const res = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- portal_api actions (no session) ------------------------------------------------

export const PUBLIC_FORM_ACTIONS = ["public_form", "public_submit"] as const;
export type PublicFormAction = (typeof PUBLIC_FORM_ACTIONS)[number];

export function isPublicFormAction(action: string): action is PublicFormAction {
  return (PUBLIC_FORM_ACTIONS as readonly string[]).includes(action);
}

export interface PublicFormEnv {
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
  /** NO_REPLY_ADDRESS (FR-PORT-81). Unset or not a plain address: no-reply@send.getnavigatr.io. */
  noReplyAddress?: string | null;
  /** PUBLIC_FORM_SIGNING_SECRET. Unset: the form answers not_available (fail closed). */
  publicFormSigningSecret?: string | null;
  /** TURNSTILE_SECRET_KEY. Unset: nobody over the soft limit can pass the check (fail closed). */
  turnstileSecretKey?: string | null;
}

export interface PublicFormDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  sendEmail(msg: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string | null }): Promise<void>;
  background?(p: Promise<unknown>): void;
  fetch?: FetchLike;
  now?(): Date;
  env: PublicFormEnv;
}

interface FormRow {
  org_name: unknown;
  rep_name: unknown;
  consent_text: unknown;
  consent_version: unknown;
}

interface SubmitRow {
  ref: unknown;
  org_name: unknown;
  logo_url?: unknown;
  primary_color?: unknown;
  show_powered_by?: unknown;
}

function ok(body: unknown): ActionResult {
  return { status: 200, body };
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): ActionResult {
  return { status, body: { error, ...extra } };
}

function serverError(where: string, message: string): ActionResult {
  console.error(`[portal_api] ${where} failed:`, message);
  return err(500, "server_error");
}

function one<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data.length > 0 ? (data[0] as T) : null;
  return data !== null && typeof data === "object" ? (data as T) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The only success shape, real or fake. */
function submitted(ref: string): ActionResult {
  return ok({ submission: { ref } });
}

export async function handlePublicFormAction(
  action: PublicFormAction,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PublicFormDeps,
): Promise<ActionResult> {
  const secret = deps.env.publicFormSigningSecret ?? "";
  if (!secret) {
    console.error("[portal_api] PUBLIC_FORM_SIGNING_SECRET is not set; the public form is unavailable");
    return err(503, "not_available");
  }
  if (!slug || !token) return err(404, "not_available");
  return action === "public_form"
    ? publicForm(secret, slug, token, deps)
    : publicSubmit(secret, slug, token, body, ip, deps);
}

async function publicForm(secret: string, slug: string, token: string, deps: PublicFormDeps): Promise<ActionResult> {
  const { data, error } = await deps.rpc("portal_public_form", { p_slug: slug, p_token: token });
  if (error) return serverError("public_form", error.message);
  const row = one<FormRow>(data);
  if (!row) return err(404, "not_available");
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const form: PortalPublicForm = {
    orgName: str(row.org_name),
    repName: strOrNull(row.rep_name),
    consentText: str(row.consent_text),
    consentVersion: num(row.consent_version),
    formToken: await signFormToken(secret, slug, token, nowMs),
  };
  return ok({ form });
}

async function publicSubmit(
  secret: string,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PublicFormDeps,
): Promise<ActionResult> {
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const formToken = str(body.formToken);
  const stamp =
    formToken.length > PUBLIC_FORM_LIMITS.formToken ? "invalid" : await checkFormToken(secret, slug, token, formToken, nowMs);
  if (stamp === "invalid") return err(409, "form_expired");
  // A bot learns nothing: identical to success, nothing written, nothing sent.
  const trap = body[PUBLIC_HONEYPOT_FIELD];
  const trapped = !(trap === undefined || trap === null || (typeof trap === "string" && trap.trim() === ""));
  if (stamp === "too_fast" || trapped) return submitted(fakeRef());

  const check = validatePublicSubmission(body);
  if (!check.ok) return err(400, "invalid_body", { field: check.field });
  const s = check.value;

  // R3: with no resolvable client IP the per-IP count cannot work, so the caller counts as over
  // the soft limit. R6: the per-link count is keyed on the link, not on any header, and a
  // malformed count fails closed to the soft limit too.
  let ipCount = PUBLIC_SOFT_LIMIT_PER_HOUR;
  let linkCount = PUBLIC_LINK_SOFT_LIMIT_PER_HOUR;
  const hasIp = ip !== null && ip.trim() !== "";
  const counts = await deps.rpc("portal_public_counts", { p_slug: slug, p_token: token, p_ip: hasIp ? ip : null });
  if (counts.error) return serverError("public_counts", counts.error.message);
  const countRow = one<{ ip_count?: unknown; link_count?: unknown }>(counts.data);
  const nonNegative = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const parsedIp = countRow ? nonNegative(countRow.ip_count) : null;
  const parsedLink = countRow ? nonNegative(countRow.link_count) : null;
  if (parsedIp !== null && hasIp) ipCount = parsedIp;
  if (parsedLink !== null) linkCount = parsedLink;
  if (parsedIp === null) ipCount = Math.max(ipCount, PUBLIC_SOFT_LIMIT_PER_HOUR);
  if (ipCount >= PUBLIC_HARD_LIMIT_PER_HOUR) return err(429, "rate_limited");
  // True only when Turnstile verified a token in THIS request. portal_public_submit re-checks the
  // soft limits under its locks (a parallel burst can pass this pre-check) and needs this flag.
  let captchaPassed = false;
  if (ipCount >= PUBLIC_SOFT_LIMIT_PER_HOUR || linkCount >= PUBLIC_LINK_SOFT_LIMIT_PER_HOUR) {
    const captchaToken = str(body.captchaToken).trim();
    captchaPassed =
      captchaToken !== "" &&
      captchaToken.length <= PUBLIC_FORM_LIMITS.captchaToken &&
      (await verifyTurnstile(deps.fetch, deps.env.turnstileSecretKey, captchaToken, ip));
    if (!captchaPassed) return err(429, "captcha_required");
  }

  const { data, error } = await deps.rpc("portal_public_submit", {
    p_slug: slug,
    p_token: token,
    p_company: s.companyName,
    p_contact_name: s.contactName,
    p_contact_email: s.email,
    p_contact_phone: s.phone,
    p_notes: s.notes,
    p_referred_by: s.referredBy,
    p_referrer_email: s.referrerEmail,
    p_consent_version: s.consentVersion,
    p_ip: ip,
    p_captcha_passed: captchaPassed,
    p_employee_count: s.employeeCount,
  });
  if (error) {
    const message = error.message;
    if (message.includes("rate_limited")) return err(429, "rate_limited");
    if (message.includes("captcha_required")) return err(429, "captcha_required");
    if (message.includes("consent_changed")) return err(409, "consent_changed");
    const field = /invalid_input:([A-Za-z]+)/.exec(message)?.[1];
    if (field && isPublicFormField(field)) return err(400, "invalid_body", { field });
    return serverError("public_submit", message);
  }
  const row = one<SubmitRow>(data);
  if (!row || !str(row.ref)) return err(404, "not_available");
  // FR-PORT-33 (controller ruling): only to the sender's own optional email, never the business contact.
  if (s.referrerEmail) sendConfirmation(s.referrerEmail, str(row.org_name), str(row.ref), row, deps);
  return submitted(str(row.ref));
}

/** FR-PORT-33. Never fails the submit, and never delays the response. */
function sendConfirmation(to: string, orgName: string, ref: string, brandRow: SubmitRow, deps: PublicFormDeps): void {
  try {
    if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, to)) {
      console.log(`[portal_api][emailGuard] dropped a public form confirmation in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
      return;
    }
    const built = portalPublicConfirmationEmail({ orgName, ref });
    const { html, text } = renderEmail({ ...built, brand: portalEmailBrand(orgName, brandRow) });
    const sending = deps
      .sendEmail({
        from: portalFromAddress(deps.env.fromAddress, orgName),
        to,
        subject: built.subject,
        html,
        text,
        replyTo: noReplyAddress(deps.env.noReplyAddress),
      })
      .catch((e: unknown) => {
        console.error("[portal_api] public form confirmation failed:", e instanceof Error ? e.message : String(e));
      });
    if (deps.background) deps.background(sending);
  } catch (e) {
    console.error("[portal_api] public form confirmation failed:", e instanceof Error ? e.message : String(e));
  }
}
