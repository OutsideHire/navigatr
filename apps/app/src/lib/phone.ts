/**
 * Phone display formatting — single source of truth, backed by libphonenumber-js.
 * US numbers render as national format `(512) 555-0100`; anything unparseable or
 * non-US falls back to the raw input (passthrough). Extracted from
 * PhoneWithClickToCall so list views (e.g. RoutePreview) can format consistently.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Parse a phone string (US default) → display, e164, validity. Invalid input
 *  passes through as `display: raw`, `e164: null`, `valid: false`. */
export function formatPhone(raw: string, format: "us" | "international" = "us"): {
  display: string;
  e164: string | null;
  valid: boolean;
} {
  const parsed = parsePhoneNumberFromString(raw, "US" as CountryCode);
  if (!parsed || !parsed.isValid()) {
    return { display: raw, e164: null, valid: false };
  }
  const display = format === "us" && parsed.country === "US"
    ? parsed.formatNational()
    : parsed.formatInternational();
  return { display, e164: parsed.number, valid: true };
}

/** Display string only — formatted when parseable, raw passthrough otherwise. */
export function formatPhoneDisplay(raw: string): string {
  return formatPhone(raw).display;
}

/**
 * Best-effort dialable form for numbers libphonenumber-js can't validate.
 * Returns a sanitized `+?digits` string when the raw input has at least 7
 * digits (enough to be a real, dialable number — e.g. a non-US line), else
 * null. Preserves a leading `+` if present so `tel:` keeps the country code.
 */
export function dialableDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}
