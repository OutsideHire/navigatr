/**
 * Partner referral submission rules (Partner Portal Phase 1B, spec 5.5, brief D9).
 *
 * Shared by portal_api (server validation before any SQL) and the portal's
 * submit form (the same messages before a request is sent). The SQL function
 * portal_submit_referral enforces the same caps and lists again.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export const PORTAL_FIELD_LIMITS = {
  companyName: 160,
  contactName: 120,
  email: 254,
  phone: 40,
  address: 300,
  notes: 4000,
} as const;

/** The Add Deal form's industry keys, so an accepted referral's deal round-trips. */
export const PORTAL_INDUSTRIES = [
  { value: "restaurant", label: "Restaurant" },
  { value: "retail", label: "Retail" },
  { value: "healthcare", label: "Healthcare" },
  { value: "professional_services", label: "Professional services" },
  { value: "personal_services", label: "Personal services" },
  { value: "automotive", label: "Automotive" },
  { value: "other", label: "Other" },
] as const;
export type PortalIndustry = (typeof PORTAL_INDUSTRIES)[number]["value"];

export const PORTAL_URGENCIES = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "no_rush", label: "No rush" },
] as const;
export type PortalUrgency = (typeof PORTAL_URGENCIES)[number]["value"];

export function industryLabel(value: string | null): string | null {
  return PORTAL_INDUSTRIES.find((i) => i.value === value)?.label ?? null;
}

export function urgencyLabel(value: string | null): string | null {
  return PORTAL_URGENCIES.find((u) => u.value === value)?.label ?? null;
}

export type PortalWindow = "30d" | "90d" | "12m" | "all";

export const PORTAL_WINDOWS: ReadonlyArray<{ value: PortalWindow; label: string }> = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
];

export function isPortalWindow(value: unknown): value is PortalWindow {
  return PORTAL_WINDOWS.some((w) => w.value === value);
}

/** Start of the window, or null for all time. Never mutates `now`. */
export function windowSince(window: PortalWindow, now: Date): Date | null {
  if (window === "all") return null;
  const since = new Date(now.getTime());
  if (window === "12m") {
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    return since;
  }
  since.setUTCDate(since.getUTCDate() - (window === "30d" ? 30 : 90));
  return since;
}

export type PortalSubmissionField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "emailOrPhone"
  | "address"
  | "industry"
  | "urgency"
  | "notes"
  | "consent";

export const PORTAL_SUBMISSION_FIELDS: readonly PortalSubmissionField[] = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "emailOrPhone",
  "address",
  "industry",
  "urgency",
  "notes",
  "consent",
];

export function isSubmissionField(value: unknown): value is PortalSubmissionField {
  return typeof value === "string" && (PORTAL_SUBMISSION_FIELDS as readonly string[]).includes(value);
}

export interface PortalSubmission {
  companyName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  industry: PortalIndustry | null;
  urgency: PortalUrgency | null;
  notes: string;
  consent: true;
  consentVersion: number;
}

export type SubmissionCheck =
  | { ok: true; value: PortalSubmission }
  | { ok: false; field: PortalSubmissionField };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubmission(input: Readonly<Record<string, unknown>>): SubmissionCheck {
  const text = (key: string): string => {
    const v = input[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const fail = (field: PortalSubmissionField): SubmissionCheck => ({ ok: false, field });

  const companyName = text("companyName");
  if (!companyName || companyName.length > PORTAL_FIELD_LIMITS.companyName) return fail("companyName");
  const contactName = text("contactName");
  if (!contactName || contactName.length > PORTAL_FIELD_LIMITS.contactName) return fail("contactName");

  const email = text("email").toLowerCase();
  if (email && (email.length > PORTAL_FIELD_LIMITS.email || !EMAIL_RE.test(email))) return fail("email");
  const phone = text("phone");
  if (phone && (phone.length > PORTAL_FIELD_LIMITS.phone || phone.replace(/\D/g, "").length < 7)) return fail("phone");
  if (!email && !phone) return fail("emailOrPhone");

  const address = text("address");
  if (address.length > PORTAL_FIELD_LIMITS.address) return fail("address");

  const industry = text("industry");
  const industryHit = PORTAL_INDUSTRIES.find((i) => i.value === industry);
  if (industry && !industryHit) return fail("industry");
  const urgency = text("urgency");
  const urgencyHit = PORTAL_URGENCIES.find((u) => u.value === urgency);
  if (urgency && !urgencyHit) return fail("urgency");

  const notes = text("notes");
  if (notes.length > PORTAL_FIELD_LIMITS.notes) return fail("notes");

  if (input.consent !== true) return fail("consent");
  const consentVersion = input.consentVersion;
  if (typeof consentVersion !== "number" || !Number.isInteger(consentVersion)) return fail("consent");

  return {
    ok: true,
    value: {
      companyName,
      contactName,
      email: email || null,
      phone: phone || null,
      address: address || null,
      industry: industryHit ? industryHit.value : null,
      urgency: urgencyHit ? urgencyHit.value : null,
      notes,
      consent: true,
      consentVersion,
    },
  };
}
