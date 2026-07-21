/**
 * Partners Sprint 1 mock data.
 *
 * Partners are referral sources — CPAs, bankers, attorneys, insurance
 * agents, and other professionals who feed leads into the rep's
 * pipeline. The rep tracks every touch with them, attributes deals
 * back to them, and watches who's actually moving the needle.
 *
 * 14 mock partners across realistic types. Cross-referenced with
 * MOCK_DEALS via `attributedDealIds` so the Partner Detail page can
 * surface real referrals from the existing pipeline data.
 *
 * TODO Sprint 2: swap MOCK_PARTNERS for PartnersService.list and
 * referral attribution for a real ManyToMany Partner↔Deal table.
 */

import type { BadgeKind } from "@/components/navigatr";

export type PartnerType =
  | "accountant"
  | "cpa_bookkeeper"
  | "business_banker_commercial_lender"
  | "benefits_broker"
  | "commercial_insurance_agent"
  | "pos_dealer"
  | "var"
  | "isv"
  | "small_business_attorney"
  | "web_developer"
  | "hr_consultant"
  | "equipment_leasing_finance"
  | "chamber_of_commerce"
  | "trade_association"
  | "other";

export type PartnerStatus = "active" | "cooling" | "inactive";

export interface Partner {
  id: string;
  name: string;
  company: string;
  type: PartnerType;
  status: PartnerStatus;
  phone: string;  // E.164
  email: string;
  /** Free-text. Sprint 2 will swap to structured address + geocode. */
  city: string;
  /** ISO date of the last logged touch with this partner. null = never. */
  lastTouch: string | null;
  /** ISO date of the next scheduled follow-up. null = none. */
  nextFollowup: string | null;
  /** Deal ids in MOCK_DEALS this partner referred. */
  attributedDealIds: string[];
  /** Deal ids in MOCK_DEALS we referred TO this partner (outbound). */
  outboundDealIds: string[];
  notes: string;
  /** auth uid of the profile that created this partner (partners.created_by).
   *  Optional: only fetched by usePartners; used to gate the Edit button
   *  against RLS. null/undefined when unknown → treated as "not the owner". */
  createdBy?: string | null;
  /** ISO timestamp the partner row was created (partners.created_at).
   *  Optional: only fetched by usePartners. Anchors the cadence clock for a
   *  never-touched partner. */
  createdAt?: string;
  /** Required follow-up cadence in days (partners.followup_cadence_days).
   *  null/undefined = no cadence set. */
  followupCadenceDays?: number | null;
}

const TODAY = new Date("2026-04-30T12:00:00Z");
function isoDaysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}
function isoDaysAhead(n: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

/** Compact factory — keeps the table below readable. */
function partner(
  id: string,
  name: string,
  company: string,
  type: PartnerType,
  status: PartnerStatus,
  phoneLast4: string,
  city: string,
  lastTouchDays: number | null,
  nextFollowupDays: number | null,
  attributedDealIds: string[],
  notes: string = "",
): Partner {
  const local = phoneLast4.padStart(4, "0");
  return {
    id,
    name,
    company,
    type,
    status,
    phone: `+1202555${local}`,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@${company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
    city,
    lastTouch: lastTouchDays === null ? null : isoDaysAgo(lastTouchDays),
    nextFollowup: nextFollowupDays === null ? null : isoDaysAhead(nextFollowupDays),
    attributedDealIds,
    outboundDealIds: [],
    notes,
  };
}

// Deal-id references reach into MOCK_DEALS (apps/app/src/features/pipeline/mockData.ts)
// so the Partner Detail page can render real deal cards from the pipeline.
export const MOCK_PARTNERS: Partner[] = [
  // ── Star performers (active + multiple referrals) ──────────────────
  partner("p-001", "Sarah Johnson",     "Johnson & Boyle CPAs",     "cpa_bookkeeper",                     "active",   "0101", "Austin, TX",  2,  3,  ["d-206", "d-301", "d-401"], "Best CPA in our network. Refers exclusively merchant services to us — never tries to upsell into other services."),
  partner("p-002", "Marcus Thompson",   "Thompson Capital Bank",    "business_banker_commercial_lender", "active",   "0102", "Austin, TX",  4,  7,  ["d-302"],                     "VP of small business banking. Friday lunches work — get a calendar invite out 2 weeks ahead."),
  partner("p-003", "Aisha Patel",       "Patel Law Firm",           "small_business_attorney",           "active",   "0103", "Round Rock",  6,  10, ["d-105"],                     "Estate planning attorney with strong restaurant client base."),
  partner("p-004", "David Chen",        "Chen Wealth Advisors",     "hr_consultant",                      "active",   "0104", "Cedar Park",  3,  5,  ["d-307"],                     "Hits commercial real estate hard. His clients are usually merchant services targets too."),

  // ── Active, single referral ────────────────────────────────────────
  partner("p-005", "Brandon Mitchell",  "Mitchell Insurance Group", "commercial_insurance_agent",        "active",   "0105", "Austin, TX",  5,  14, ["d-202"],                     "Health benefits broker. SMB focus."),
  partner("p-006", "Linda Park",        "Park & Associates",        "cpa_bookkeeper",                    "active",   "0106", "Pflugerville",8,  21, ["d-208"],                     "Smaller firm but every referral has been gold."),

  // ── Cooling — last touch >30 days, no recent referrals ─────────────
  partner("p-007", "Robert Garcia",     "Garcia Financial",         "business_banker_commercial_lender", "cooling",  "0107", "Austin, TX",  45, 4,  [],                            "Was hot in Q3, gone quiet. Try a coffee meeting."),
  partner("p-008", "Jennifer Wu",       "Wu Tax Services",          "cpa_bookkeeper",                    "cooling",  "0108", "Round Rock",  38, 7,  [],                            "Used to refer 1-2/month. New baby; reduced practice."),
  partner("p-009", "Tom O'Brien",       "O'Brien Legal",            "small_business_attorney",           "cooling",  "0109", "Bee Cave",    52, 14, [],                            "Moved offices. Reconnect with a value-add intro."),

  // ── Inactive — no touches in 90+ days, deprioritized but kept ──────
  partner("p-010", "Maria Rodriguez",   "Rodriguez & Co",           "cpa_bookkeeper",                    "inactive", "0110", "Austin, TX",  120, null, [],                          "Retired last year per LinkedIn."),
  partner("p-011", "Eric Nguyen",       "Nguyen Insurance",         "commercial_insurance_agent",        "inactive", "0111", "Leander",     180, null, [],                          "Switched industries; no longer SMB."),

  // ── New (recently added, no touches yet) ───────────────────────────
  partner("p-012", "Hannah Liu",        "Liu Strategy Group",       "hr_consultant",                     "active",   "0112", "Austin, TX",  null, 3, [],                            "New intro from David Chen. Strong network."),
  partner("p-013", "Wes Calloway",      "Calloway Bookkeeping",     "cpa_bookkeeper",                    "active",   "0113", "Cedar Park",  null, 5, [],                            "Small bookkeeping shop, lots of micro-merchants."),
  partner("p-014", "Iris Donovan",      "Donovan Capital",          "business_banker_commercial_lender", "active",   "0114", "Austin, TX",  null, 7, [],                            "Met at chamber event 2 weeks back."),
];

// ── Formatters / helpers ──────────────────────────────────────────────

export const TYPE_LABEL: Record<PartnerType, string> = {
  accountant: "Accountant",
  cpa_bookkeeper: "CPA/Bookkeeper",
  business_banker_commercial_lender: "Business Banker / Commercial Lender",
  benefits_broker: "Benefits Broker",
  commercial_insurance_agent: "Commercial Insurance Agent",
  pos_dealer: "POS Dealer",
  var: "VAR",
  isv: "ISV",
  small_business_attorney: "Small Business Attorney",
  web_developer: "Web Developer",
  hr_consultant: "HR Consultant",
  equipment_leasing_finance: "Equipment Leasing / Finance Company",
  chamber_of_commerce: "Chamber of Commerce",
  trade_association: "Trade Association",
  other: "Other",
};

/** Status pill class for the Partner card and detail header. */
export const STATUS_PILL_CLASS: Record<PartnerStatus, string> = {
  active:   "bg-status-success-bg text-status-success",
  cooling:  "bg-status-warning-bg text-status-warning",
  inactive: "bg-surface-sunken text-text-muted",
};

export const STATUS_LABEL: Record<PartnerStatus, string> = {
  active: "Active",
  cooling: "Cooling",
  inactive: "Inactive",
};

/** Map partner status to a Badge kind for cross-surface consistency. */
export const STATUS_BADGE_KIND: Record<PartnerStatus, BadgeKind> = {
  active: "stage-won",        // green
  cooling: "stage-contacted", // amber
  inactive: "stage-new",      // info — but visually muted via surface-sunken treatment
};

/** Sort by attributed revenue (resolved from MOCK_DEALS), then by name.
 *  Resolution lives in the page so we don't create a circular import. */
export function sortByRevenueDesc(
  a: Partner,
  b: Partner,
  revenueOf: (p: Partner) => number,
): number {
  const ra = revenueOf(a);
  const rb = revenueOf(b);
  if (rb !== ra) return rb - ra;
  return a.name.localeCompare(b.name);
}

/** Pretty relative date for "Last touch: 5d ago" / "Never contacted". */
export function formatRelativeLastTouch(iso: string | null): string {
  if (!iso) return "Never contacted";
  const now = TODAY.getTime();
  const then = new Date(iso).getTime();
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return "over a year";
}

/** Pretty short date for next follow-up — "Apr 28". */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Total attributed revenue in cents — caller passes the resolved
 *  Deal[] for this partner from MOCK_DEALS so we don't create a
 *  circular import between mockData files. */
export function totalAttributedRevenueCents(dealValueCents: number[]): number {
  return dealValueCents.reduce((sum, v) => sum + v, 0);
}
