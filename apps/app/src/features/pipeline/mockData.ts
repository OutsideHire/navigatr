/**
 * Pipeline Sprint 1 mock data.
 *
 * 35 merchant-services deals across the 5 canonical stages. Probabilities,
 * activity dates, and headcount ranges chosen to feel plausible — same
 * coherent story as the Rep Dashboard mock (Outside Hire, merchant
 * services rep, ~47 deals worth $163K weighted in aggregate).
 *
 * TODO Sprint 2: replace with TanStack Query hooks against
 * Deals.listDeals from apps/app/src/api/generated/. The shape here is
 * deliberately close to the OpenAPI Deal contract so swapping in the SDK
 * is mostly a name-mapping exercise.
 */

export type DealStage = "new" | "contacted" | "qualified" | "proposal" | "won";

export interface Deal {
  id: string;
  companyName: string;
  contactName: string;
  /** E.164 format — PhoneWithClickToCall will display formatted. */
  phone: string;
  email: string;
  /** Annualized deal value in USD cents (matches dashboard convention). */
  valueCents: number;
  stage: DealStage;
  /** 0–100. Defaults by stage but per-deal-override-able. */
  probability: number;
  /** ISO date string. Within last 14 days for active; last 30 for won. */
  lastActivity: string;
  /** ISO date string. Within next 14 days; null for Won. */
  nextFollowup: string | null;
  /** Street address — used by /path to surface deals as merchants.
   *  Null when the rep didn't fill it in. Not geocoded yet (no lat/lng). */
  address: string | null;
  employeeCountRange: string;
  /** Free-text source. Common values surface as the dashboard's "Lead
   *  sources this quarter" breakdown. Nullable in the DB; empty string
   *  here when the rep didn't specify (collapses to the "Other" bucket). */
  leadSource: string;
  /** ISO timestamp of the last UPDATE on the row. Imperfect proxy for
   *  "when did this deal close" on the monthly-performance dashboard
   *  widget — a rep editing notes on an old won deal will re-bump this
   *  and shift the row into the current month. Real fix is a
   *  deal_stage_history table; until then this is the best signal. */
  updatedAt: string;
}

// Static "today" so subsequent renders don't shift cards' relative dates.
// Matches the dashboard mock's "Wed Apr 30" anchor.
const TODAY = new Date("2026-04-30T12:00:00Z");

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}
function daysAhead(n: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number> = {
  new: 20,
  contacted: 35,
  qualified: 55,
  proposal: 75,
  won: 100,
};

// Compact factory — fills in defaults so the table below stays readable.
function deal(
  id: string,
  companyName: string,
  contactName: string,
  phone: string,
  email: string,
  valueK: number,
  stage: DealStage,
  lastActivityDays: number,
  nextFollowupDays: number | null,
  employees: string,
  probabilityOverride?: number,
): Deal {
  return {
    id,
    companyName,
    contactName,
    phone,
    email,
    valueCents: valueK * 100_000, // $K → cents
    stage,
    leadSource: "Mock data",
    updatedAt: TODAY.toISOString(),
    probability: probabilityOverride ?? STAGE_DEFAULT_PROBABILITY[stage],
    lastActivity: daysAgo(lastActivityDays),
    nextFollowup: nextFollowupDays === null ? null : daysAhead(nextFollowupDays),
    address: null,
    employeeCountRange: employees,
  };
}

export const MOCK_DEALS: Deal[] = [
  // ── New (6) ────────────────────────────────────────────────────────
  deal("d-001", "Acme Hardware",         "Marcus Reed",       "+12025550101", "marcus@acmehardware.com",       8,  "new", 2,  3,  "11-50"),
  deal("d-002", "Bright Smile Dental",   "Dr. Priya Shah",    "+12025550102", "priya@brightsmile.com",        12,  "new", 1,  4,  "11-50"),
  deal("d-003", "Coastal Surf Co",       "Jen Alvarez",       "+12025550103", "jen@coastalsurf.com",           6,  "new", 4,  5,  "1-10"),
  deal("d-004", "Downtown Diner",        "Tony Beretta",      "+12025550104", "tony@downtowndiner.com",        4,  "new", 6,  2,  "1-10"),
  deal("d-005", "Eastside Auto Repair",  "Mike Petrov",       "+12025550105", "mike@eastsideauto.com",         9,  "new", 3,  6,  "11-50"),
  deal("d-006", "Family Pharmacy",       "Linda Cho",         "+12025550106", "linda@familypharm.com",         4,  "new", 5,  8,  "11-50"),

  // ── Contacted (9) ──────────────────────────────────────────────────
  deal("d-101", "GreenLeaf Landscaping", "Hector Diaz",       "+12025550201", "hector@greenleaf.com",         11, "contacted", 1,  3,  "11-50"),
  deal("d-102", "Harbor Coffee",         "Sam Whitman",       "+12025550202", "sam@harborcoffee.com",          7, "contacted", 2,  4,  "1-10"),
  deal("d-103", "Iron Oak Restaurant",   "Chef Romano",       "+12025550203", "romano@ironoak.com",           14, "contacted", 3,  2,  "11-50"),
  deal("d-104", "Joe's Pizza",           "Joe Marrone",       "+12025550204", "joe@joespizza.com",             5, "contacted", 5,  6,  "1-10"),
  deal("d-105", "Karma Yoga Studio",     "Aisha Patel",       "+12025550205", "aisha@karmayoga.com",           6, "contacted", 2,  5,  "1-10"),
  deal("d-106", "Linda's Boutique",      "Linda Park",        "+12025550206", "linda@lindasboutique.com",      3, "contacted", 7,  9,  "1-10"),
  deal("d-107", "Maple Bakery",          "Eli Brennan",       "+12025550207", "eli@maplebakery.com",           4, "contacted", 4,  3,  "1-10"),
  deal("d-108", "Northside Vet",         "Dr. Hannah Liu",    "+12025550208", "hannah@northsidevet.com",       8, "contacted", 1,  4,  "11-50"),
  deal("d-109", "Ocean Breeze Spa",      "Maya Russo",        "+12025550209", "maya@oceanbreezespa.com",       9, "contacted", 3,  7,  "11-50"),

  // ── Qualified (10) ─────────────────────────────────────────────────
  deal("d-201", "PineCrest Hotel",       "Derek Choi",        "+12025550301", "derek@pinecresthotel.com",     18, "qualified", 2,  3,  "51-200"),
  deal("d-202", "Quest Fitness",         "Brandon Mitchell",  "+12025550302", "brandon@questfitness.com",     11, "qualified", 4,  2,  "11-50"),
  deal("d-203", "Riverside Pediatrics",  "Dr. Erin Walsh",    "+12025550303", "erin@riversidepeds.com",       14, "qualified", 1,  5,  "11-50"),
  deal("d-204", "Sunset Cafe",           "Carlos Mendez",     "+12025550304", "carlos@sunsetcafe.com",         7, "qualified", 3,  4,  "1-10"),
  deal("d-205", "Tropical Travel Agency","Yumi Tanaka",       "+12025550305", "yumi@tropicaltravel.com",       8, "qualified", 2,  6,  "1-10"),
  deal("d-206", "Urban Outfitters Local","Sarah Johnson",     "+12025550306", "sarah@uolocal.com",            24, "qualified", 1,  3,  "51-200"),
  deal("d-207", "Valley Auto Body",      "Russ Henderson",    "+12025550307", "russ@valleyautobody.com",      10, "qualified", 5,  4,  "11-50"),
  deal("d-208", "Westfield Salon",       "Nora Patel",        "+12025550308", "nora@westfieldsalon.com",       6, "qualified", 4,  7,  "1-10"),
  deal("d-209", "XYZ Plumbing",          "Frank Owens",       "+12025550309", "frank@xyzplumbing.com",         9, "qualified", 6,  5,  "11-50"),
  deal("d-210", "Yellow Brick Toys",     "Lauren Pham",       "+12025550310", "lauren@yellowbricktoys.com",    5, "qualified", 3,  8,  "1-10"),

  // ── Proposal (7) ───────────────────────────────────────────────────
  deal("d-301", "Alpine Wellness",       "Dr. Kira Bowen",    "+12025550401", "kira@alpinewellness.com",      22, "proposal", 1,  2,  "11-50"),
  deal("d-302", "Bristol Hardware",      "Marcus Thompson",   "+12025550402", "marcus@bristolhw.com",         16, "proposal", 2,  3,  "11-50"),
  deal("d-303", "Cypress Veterinary",    "Dr. Patel Singh",   "+12025550403", "patel@cypressvet.com",         14, "proposal", 3,  4,  "11-50"),
  deal("d-304", "Delta Dental",          "Renee Carter",      "+12025550404", "renee@deltadental.com",        28, "proposal", 1,  2,  "51-200"),
  deal("d-305", "Eagle Eye Optometry",   "Dr. Aaron Kim",     "+12025550405", "aaron@eagleeye.com",           11, "proposal", 4,  5,  "1-10"),
  deal("d-306", "Forest Hills Florist",  "Iris Donovan",      "+12025550406", "iris@foresthills.com",          9, "proposal", 2,  3,  "1-10"),
  deal("d-307", "GreenWay Energy",       "David Chen",        "+12025550407", "david@greenway.com",           31, "proposal", 1,  4,  "51-200"),

  // ── Won this month (3) ─────────────────────────────────────────────
  deal("d-401", "Hilltop Pizzeria",      "Vince Capello",     "+12025550501", "vince@hilltoppizza.com",        4, "won", 8,  null, "1-10"),
  deal("d-402", "Island Massage",        "Kara Olsen",        "+12025550502", "kara@islandmassage.com",        3, "won", 12, null, "1-10"),
  deal("d-403", "Junction Brewery",      "Wes Calloway",      "+12025550503", "wes@junctionbrew.com",          3, "won", 14, null, "11-50"),
];

// ---------------------------------------------------------------------------
// Mock async fetcher — used by the page's TanStack Query hook. 300 ms delay
// gives the loading skeletons a chance to render so we can verify them in
// design review without throttling the network.
// ---------------------------------------------------------------------------

export function fetchDealsMock(): Promise<Deal[]> {
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_DEALS), 300));
}

// ---------------------------------------------------------------------------
// Formatters / helpers
// ---------------------------------------------------------------------------

/** Format cents → "$8K" / "$163K" / "$1.2M". Same shape as dashboard. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

/**
 * "3d ago" / "today" / "yesterday". Defaults `now` to the current wall
 * clock — was previously hardcoded to TODAY (the mock anchor 2026-04-30),
 * which made every REAL deal created after the anchor render as a future
 * event ("in 19d") instead of a past one. Mock callers can still pass
 * TODAY explicitly to keep the curated story aligned.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffDays === -1) return "tomorrow";
  return `in ${-diffDays}d`;
}

/** "Apr 28" — short month + day. */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

import type { BadgeKind } from "@/components/navigatr";
import type { BandColor } from "@/components/navigatr";

export const STAGE_BADGE_KIND: Record<DealStage, BadgeKind> = {
  new: "stage-new",
  contacted: "stage-contacted",
  qualified: "stage-qualified",
  proposal: "stage-proposal",
  won: "stage-won",
};

export const STAGE_BAND_COLOR: Record<DealStage, BandColor> = {
  new: "info",
  contacted: "warning",
  qualified: "teal",
  proposal: "violet",
  won: "success",
};

export const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
};

/**
 * Default next-step verb for each stage. Powers the DealCard's
 * action-zone line ("→ Call back · Jun 3"). Turns a date (data) into
 * an instruction (job-to-be-done).
 *
 * When a deal has a rep-authored next-step note (Sprint 2), prefer that
 * over the default verb. Generic verb is the fallback.
 */
export const STAGE_NEXT_VERB: Record<DealStage, string> = {
  new: "Reach out",
  contacted: "Call back",
  qualified: "Send proposal",
  proposal: "Follow up",
  won: "Onboard",
};

// Chip counts authored to match the dashboard story (47 total active across
// the rep's whole book). Slightly larger than what's in MOCK_DEALS because
// MOCK_DEALS is a curated 35-card sample for the visible list.
export const STAGE_CHIP_COUNTS: Record<"all" | DealStage, number> = {
  all: 47,
  new: 12,
  contacted: 15,
  qualified: 10,
  proposal: 7,
  won: 3,
};

export const HEADER_SUBHEAD = "47 active deals · $163K weighted";
