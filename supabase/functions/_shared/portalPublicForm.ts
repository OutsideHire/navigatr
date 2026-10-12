/**
 * Public referral form (Partner Portal Phase 2B-1, PRD FR-PORT-24..34).
 *
 * Anyone holding a rep's or the ISO's form link can send a business with no
 * sign-in. Bot mitigation (FR-PORT-30) is invisible to people:
 *   - a hidden "website" field that only bots fill (the honeypot);
 *   - a signed form token: an HMAC over the slug, the link token and the issue
 *     time, so the server can tell how long the form was open without storing
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
import { PORTAL_FIELD_LIMITS } from "./portalSubmission.ts";

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
  | "consent";

export const PUBLIC_FORM_FIELDS: readonly PublicFormField[] = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "notes",
  "referredBy",
  "referrerEmail",
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

/** Required: company, contact name, email, phone, notes (FR-PORT-29). Optional: who referred, the sender's own email. */
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

/** `<issuedAtMs>.<hex HMAC-SHA256 of "slug.token.issuedAtMs">`. */
export async function signFormToken(secret: string, slug: string, token: string, issuedAtMs: number): Promise<string> {
  return `${issuedAtMs}.${await hmacSha256Hex(secret, `${slug}.${token}.${issuedAtMs}`)}`;
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
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(formToken);
  if (!m) return "invalid";
  const issuedAt = Number(m[1]);
  const expected = await hmacSha256Hex(secret, `${slug}.${token}.${issuedAt}`);
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
): Promise<boolean> {
  if (!fetchFn || !secret || !captchaToken) return false;
  try {
    const form = new URLSearchParams({ secret, response: captchaToken });
    if (ip) form.set("remoteip", ip);
    const res = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
