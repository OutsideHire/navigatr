/**
 * Partner profile rules (Partner Portal Phase 2A, FR-PORT-19).
 *
 * Shared by portal_api (server validation before any SQL) and the portal's
 * profile page (the same messages before a request is sent). The SQL function
 * portal_update_profile enforces the same caps again. The sign-in email is the
 * partner's identity and is never editable here.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export const PORTAL_PROFILE_LIMITS = { name: 120, phone: 40 } as const;
export const PORTAL_PROFILE_MIN_PHONE_DIGITS = 7;

export interface PortalProfile {
  name: string;
  phone: string | null;
  email: string;
  /** Whether the partner wants the weekly email (sent from Phase 2B). */
  weeklyDigest: boolean;
}

export interface PortalProfileInput {
  name: string;
  phone: string | null;
  weeklyDigest: boolean;
}

export type PortalProfileField = "name" | "phone" | "weeklyDigest";

export const PORTAL_PROFILE_MESSAGES: Record<PortalProfileField, string> = {
  name: "Add your name (up to 120 characters).",
  phone: "Enter a phone number with at least 7 digits, or leave it blank.",
  weeklyDigest: "Choose whether to get the weekly email.",
};

export type ProfileCheck = { ok: true; value: PortalProfileInput } | { ok: false; field: PortalProfileField };

export function validateProfile(raw: unknown): ProfileCheck {
  const body = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (typeof body.name !== "string") return { ok: false, field: "name" };
  const name = body.name.trim();
  if (!name || name.length > PORTAL_PROFILE_LIMITS.name) return { ok: false, field: "name" };

  if (body.phone !== null && body.phone !== undefined && typeof body.phone !== "string") {
    return { ok: false, field: "phone" };
  }
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (
    phone &&
    (phone.length > PORTAL_PROFILE_LIMITS.phone || phone.replace(/\D/g, "").length < PORTAL_PROFILE_MIN_PHONE_DIGITS)
  ) {
    return { ok: false, field: "phone" };
  }

  if (typeof body.weeklyDigest !== "boolean") return { ok: false, field: "weeklyDigest" };

  return { ok: true, value: { name, phone: phone || null, weeklyDigest: body.weeklyDigest } };
}
