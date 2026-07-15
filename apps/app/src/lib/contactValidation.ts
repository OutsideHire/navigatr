/**
 * contactValidation — the app's single source of truth for phone + email
 * format enforcement. Every form composes its schema from these so the rules
 * can't drift (partners now; deal / drop-in / log-activity forms adopt the
 * same schemas as a fast-follow).
 *
 * Phone: a valid US number, stored as E.164 ("+15551234567"), shown as
 * "(555) 123-4567". Email: a valid address, trimmed.
 *
 * Two flavors of each field:
 *  - required*  — must be present AND valid (create flows).
 *  - optional*  — empty is allowed, but any entered value must be valid (edit
 *                 flows, so a legacy record missing a value isn't blocked while
 *                 format is still forced when something IS typed).
 */

import { z } from "zod";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function formatUSPhone(input: string): string {
  const d = digitsOnly(input);
  if (d.length === 0) return "";
  return new AsYouType("US").input(d.slice(0, d.startsWith("1") ? 11 : 10));
}

/** Strip a leading US country code so an E.164 value pre-fills as 10 digits. */
export function stripUsCountryCode(phone: string): string {
  const d = digitsOnly(phone);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** Valid US phone: a libphonenumber-valid number, or a bare 10 digits. */
export function isValidUsPhone(v: string): boolean {
  return Boolean(parsePhoneNumberFromString(v, "US")?.isValid()) || digitsOnly(v).length === 10;
}

/** Normalize a phone for storage. Empty/blank → null; else E.164 (drops a
 *  habitual leading "1" so we never write a doubled country code). */
export function phoneToE164(v: string): string | null {
  return v.trim() === "" ? null : "+1" + stripUsCountryCode(v);
}

/** Trim an email for storage. Empty/blank → null. */
export function normalizeEmail(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

const PHONE_MSG = "Enter a 10-digit US phone";
const EMAIL_MSG = "Enter a valid email";

/** Required, format-forced phone (create flows). */
export const requiredPhoneSchema = z
  .string()
  .min(1, "Phone is required")
  .refine(isValidUsPhone, PHONE_MSG);

/** Optional phone: empty allowed; any value must be a valid US phone. */
export const optionalPhoneSchema = z
  .string()
  .refine((v) => v.trim() === "" || isValidUsPhone(v), PHONE_MSG);

/** Required, format-forced email (create flows). Trim-tolerant. */
export const requiredEmailSchema = z
  .string()
  .min(1, "Email is required")
  .refine((v) => z.string().email().safeParse(v.trim()).success, EMAIL_MSG);

/** Optional email: empty allowed; any value must be a valid email. */
export const optionalEmailSchema = z
  .string()
  .refine((v) => v.trim() === "" || z.string().email().safeParse(v.trim()).success, EMAIL_MSG);
