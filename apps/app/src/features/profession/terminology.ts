/**
 * terminology.ts — profession-specific labels.
 *
 * Single source of truth for "what do we call X in this profession." The
 * useTerm hook reads here (merged with optional per-org overrides from
 * org_profession_config.terminology).
 *
 * Why TypeScript not SQL: iteration cost. Tweaking "monthly volume" to
 * "monthly processing volume" should be a frontend PR, not a migration.
 * Per-org *overrides* live in the DB so an ISO can re-name without a code
 * change, but the defaults stay in code.
 *
 * TermKey naming: short, lowercase, no plural form (the rendering layer
 * pluralizes if needed). Keep keys ≤ 16 chars so consumers can use them
 * inline without making call sites awkward.
 *
 * When adding a new TermKey:
 *   1. Add to TermKey union below
 *   2. Add an entry for every profession in TERMINOLOGY_DEFAULTS
 *   3. (Optional) add to TERM_FALLBACKS for graceful "what's a sensible
 *      English noun if a profession entry is missing"
 */

export type Profession = "payroll" | "merchant_services" | "treasury_management";

export type TermKey =
  | "deal"           // the pipeline entity: deal / case / relationship
  | "deals"          // plural form (some terms have irregular plurals)
  | "company"        // the org being sold to: merchant / client / company
  | "companies"
  | "contact"        // person at the company
  | "value"          // the dollar metric: monthly volume / annual premium / AUM
  | "pipeline"       // the funnel itself
  | "lost_label"     // word for a lost deal: "lost", "declined", "no-go"
  | "won_label";     // word for a won deal: "won", "closed", "booked"

/**
 * Defaults per profession. Empty string means "fall through to TERM_FALLBACKS",
 * which lets us add a TermKey without filling in every cell up front.
 */
export const TERMINOLOGY_DEFAULTS: Record<Profession, Partial<Record<TermKey, string>>> = {
  payroll: {
    deal: "deal",
    deals: "deals",
    company: "company",
    companies: "companies",
    contact: "contact",
    value: "monthly payroll",
    pipeline: "pipeline",
    lost_label: "lost",
    won_label: "won",
  },
  merchant_services: {
    deal: "deal",
    deals: "deals",
    company: "merchant",
    companies: "merchants",
    contact: "contact",
    value: "monthly volume",
    pipeline: "pipeline",
    lost_label: "lost",
    won_label: "won",
  },
  treasury_management: {
    deal: "relationship",
    deals: "relationships",
    company: "client",
    companies: "clients",
    contact: "contact",
    value: "AUM",
    pipeline: "book",
    lost_label: "passed",
    won_label: "onboarded",
  },
};

/**
 * Last-resort labels when neither the per-org override nor the profession
 * default has a value. Keeps the UI rendering reasonable English instead
 * of leaking the TermKey to users.
 */
export const TERM_FALLBACKS: Record<TermKey, string> = {
  deal: "deal",
  deals: "deals",
  company: "company",
  companies: "companies",
  contact: "contact",
  value: "value",
  pipeline: "pipeline",
  lost_label: "lost",
  won_label: "won",
};

/**
 * Resolve a TermKey to a label. Lookup order:
 *   1. Per-org override (orgOverrides[key])
 *   2. Profession default (TERMINOLOGY_DEFAULTS[profession][key])
 *   3. Fallback (TERM_FALLBACKS[key])
 *
 * Pulled into a pure function so the hook can stay thin and the resolution
 * logic is unit-testable without React.
 */
export function resolveTerm(
  key: TermKey,
  profession: Profession | null,
  orgOverrides: Record<string, string> | null | undefined,
): string {
  if (orgOverrides && typeof orgOverrides[key] === "string" && orgOverrides[key] !== "") {
    return orgOverrides[key];
  }
  if (profession) {
    const v = TERMINOLOGY_DEFAULTS[profession]?.[key];
    if (v && v !== "") return v;
  }
  return TERM_FALLBACKS[key];
}
