/**
 * Submit-form draft (spec 5.5: "Draft autosaves to localStorage"). One draft
 * per tenant slug, cleared on a successful submit. Every storage access is
 * wrapped: private browsing must never break the form. Consent is never part of
 * the draft; the partner confirms it fresh each time.
 */
export interface PortalDraft {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  industry: string;
  urgency: string;
  employeeCount: string;
  notes: string;
}

export const EMPTY_DRAFT: PortalDraft = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  industry: "",
  urgency: "",
  employeeCount: "",
  notes: "",
};

const FIELDS = Object.keys(EMPTY_DRAFT) as Array<keyof PortalDraft>;

export function portalDraftKey(slug: string): string {
  return `navigatr-portal-draft:${slug}`;
}

export function isEmptyDraft(draft: PortalDraft): boolean {
  return FIELDS.every((f) => draft[f].trim() === "");
}

export function readPortalDraft(slug: string): PortalDraft {
  try {
    const raw = window.localStorage.getItem(portalDraftKey(slug));
    if (!raw) return { ...EMPTY_DRAFT };
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return { ...EMPTY_DRAFT };
    const out: PortalDraft = { ...EMPTY_DRAFT };
    for (const f of FIELDS) {
      const v = (parsed as Record<string, unknown>)[f];
      if (typeof v === "string") out[f] = v;
    }
    return out;
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function writePortalDraft(slug: string, draft: PortalDraft): void {
  try {
    if (isEmptyDraft(draft)) window.localStorage.removeItem(portalDraftKey(slug));
    else window.localStorage.setItem(portalDraftKey(slug), JSON.stringify(draft));
  } catch {
    // Storage refused (private mode); the form still works, just without autosave.
  }
}

export function clearPortalDraft(slug: string): void {
  try {
    window.localStorage.removeItem(portalDraftKey(slug));
  } catch {
    // Nothing stored that we can reach.
  }
}
