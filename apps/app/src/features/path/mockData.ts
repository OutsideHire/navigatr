/**
 * Path Discovery mock — 25 merchants scattered around downtown Austin.
 *
 * Anchored at (30.2672, -97.7431) ± ~3 mi so they fit a "drop-in route
 * near me" on a typical rep day. Mix of categories that match the
 * merchant-services ICP (food, retail, personal services, auto, etc.)
 * with realistic relationship statuses so the map renders a believable
 * field-rep day.
 *
 * Status palette (drives map marker color + list status pill):
 *   untouched  — never contacted, fresh ICP target              (text-text-muted)
 *   prospect   — in pipeline as New / Contacted                 (status-info)
 *   active     — Qualified / Proposal (in-flight deal)          (accent-violet)
 *   won        — Closed-won, here for residual / referral asks  (status-success)
 *   cooled     — Was active but inactive 30+ days, needs a poke (status-warning)
 *
 * TODO Sprint 2: replace with the Places/Merchants endpoint
 * (Places.searchNearby in the generated SDK) so coords come from the
 * server, gated by the rep's ICP filter and the requested radius.
 */

export type MerchantStatus = "untouched" | "prospect" | "active" | "won" | "cooled";

export type MerchantCategory =
  | "manufacturing_wholesale" | "construction_trades" | "healthcare" | "veterinary_pet"
  | "professional_services" | "automotive" | "convenience_fuel" | "grocery_food_retail"
  | "apparel_accessories" | "home_hardware" | "electronics_specialty" | "pharmacy_health_retail"
  | "general_merchandise" | "food_beverage" | "hospitality" | "education" | "finance_banking"
  | "fitness_wellness" | "personal_services" | "entertainment" | "sports_recreation"
  | "transportation" | "non_profit" | "other";

export interface Merchant {
  id: string;
  name: string;
  category: MerchantCategory;
  /** Display address — single line, not parsed for sprint 1. */
  address: string;
  lat: number;
  lng: number;
  phone: string; // E.164
  email?: string;
  employeeCountRange: string;
  status: MerchantStatus;
  /** ISO date string, or null if never contacted. */
  lastActivity: string | null;
  /** Free-form note shown on the detail sheet. */
  note?: string;
  /** Google Places stable ID. Present for discovered prospects (Phase 2),
   *  absent for mock/deal-derived records. Stable across cache refreshes. */
  placeId?: string;
  /** Business website, when Places returns one. Shown on the detail sheet. */
  website?: string;
  /** Google rating count — a rough size/foot-traffic proxy for discovered
   *  prospects (Places gives no employee count). Also the saturation signal the
   *  opportunity sort ranks on: low count = under-pitched/newly-opened. */
  ratingCount?: number;
  /** Google average rating (stars, 1.0–5.0), when Places returns one. A
   *  secondary quality read shown on the detail sheet. */
  rating?: number;
  /** Chain detection (Path Slice 5). isChain drives the read-path filter +
   *  the lead-card badge; confidence/brand come from ingest. */
  isChain?: boolean;
  chainConfidence?: "high" | "medium" | "low" | null;
  chainBrandName?: string;
  /** Google Places primary_type (or types[0] fallback), set at ingest. Null on
   *  legacy rows; used for category→sub-type filtering in the Create path flow. */
  primaryType?: string | null;
}

const TODAY = new Date("2026-05-16T12:00:00Z");
const daysAgo = (n: number): string => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
};

export const MOCK_MERCHANTS: Merchant[] = [
  // ─── Restaurants ────────────────────────────────────────────────
  { id: "m-001", name: "Iron Oak Restaurant",   category: "food_beverage", address: "1100 Congress Ave",      lat: 30.2706, lng: -97.7428, phone: "+15125550101", email: "manager@ironoak.com",     employeeCountRange: "11-50",   status: "prospect",  lastActivity: daysAgo(3),   note: "Chef Romano runs the front of house. Lunch rush 11:30-1:30." },
  { id: "m-002", name: "Sunrise Cafe",          category: "food_beverage", address: "401 W 2nd St",            lat: 30.2655, lng: -97.7475, phone: "+15125550102", email: "hello@sunrisecafe.com",   employeeCountRange: "1-10",    status: "active",    lastActivity: daysAgo(1),   note: "Owner Carlos asked for a proposal Tuesday." },
  { id: "m-003", name: "Joe's Pizza",           category: "food_beverage", address: "612 E 6th St",            lat: 30.2667, lng: -97.7363, phone: "+15125550103",                                  employeeCountRange: "1-10",    status: "prospect",  lastActivity: daysAgo(5) },
  { id: "m-004", name: "Maple Bakery",          category: "food_beverage", address: "208 W Mary St",           lat: 30.2483, lng: -97.7530, phone: "+15125550104", email: "eli@maplebakery.com",     employeeCountRange: "1-10",    status: "prospect",  lastActivity: daysAgo(4) },
  { id: "m-005", name: "Hilltop Pizzeria",      category: "food_beverage", address: "2715 Manor Rd",           lat: 30.2900, lng: -97.7140, phone: "+15125550105",                                  employeeCountRange: "1-10",    status: "won",       lastActivity: daysAgo(12),  note: "Closed last quarter. Ask about a partner intro." },
  { id: "m-006", name: "Downtown Diner",        category: "food_beverage", address: "318 Colorado St",         lat: 30.2667, lng: -97.7457, phone: "+15125550106",                                  employeeCountRange: "1-10",    status: "untouched", lastActivity: null },
  { id: "m-007", name: "Harbor Coffee",         category: "food_beverage", address: "1810 W 6th St",           lat: 30.2724, lng: -97.7600, phone: "+15125550107",                                  employeeCountRange: "1-10",    status: "prospect",  lastActivity: daysAgo(2) },

  // ─── Retail ─────────────────────────────────────────────────────
  { id: "m-008", name: "Linda's Boutique",      category: "apparel_accessories", address: "1006 S Lamar Blvd",  lat: 30.2613, lng: -97.7560, phone: "+15125550108",                                  employeeCountRange: "1-10",    status: "untouched", lastActivity: null },
  { id: "m-009", name: "Yellow Brick Toys",     category: "general_merchandise", address: "2438 Anderson Ln",   lat: 30.3540, lng: -97.7345, phone: "+15125550109",                                  employeeCountRange: "1-10",    status: "active",    lastActivity: daysAgo(6),   note: "Proposal sent. Renewal window: Aug." },
  { id: "m-010", name: "Acme Hardware",         category: "home_hardware",       address: "612 N Lamar Blvd",   lat: 30.2773, lng: -97.7548, phone: "+15125550110",                                  employeeCountRange: "11-50",   status: "untouched", lastActivity: null },
  { id: "m-011", name: "Coastal Surf Co",       category: "sports_recreation",   address: "1100 S Congress Ave", lat: 30.2520, lng: -97.7440, phone: "+15125550111",                                 employeeCountRange: "1-10",    status: "cooled",    lastActivity: daysAgo(38),  note: "Last touch 5 weeks ago, dropped off after first call." },

  // ─── Healthcare ─────────────────────────────────────────────────
  { id: "m-012", name: "Bright Smile Dental",   category: "healthcare", address: "3409 Executive Center Dr",lat: 30.3320, lng: -97.7300, phone: "+15125550112", email: "priya@brightsmile.com",   employeeCountRange: "11-50",   status: "prospect",  lastActivity: daysAgo(1) },
  { id: "m-013", name: "Riverside Pediatrics",  category: "healthcare", address: "1500 Red River St",       lat: 30.2790, lng: -97.7340, phone: "+15125550113",                                  employeeCountRange: "11-50",   status: "active",    lastActivity: daysAgo(2) },
  { id: "m-014", name: "Northside Vet",         category: "healthcare", address: "9701 Brodie Ln",          lat: 30.2120, lng: -97.8260, phone: "+15125550114",                                  employeeCountRange: "11-50",   status: "prospect",  lastActivity: daysAgo(4) },
  { id: "m-015", name: "Cypress Veterinary",    category: "healthcare", address: "5400 Burnet Rd",          lat: 30.3210, lng: -97.7390, phone: "+15125550115",                                  employeeCountRange: "11-50",   status: "active",    lastActivity: daysAgo(3) },

  // ─── Personal services ──────────────────────────────────────────
  { id: "m-016", name: "Karma Yoga Studio",     category: "fitness_wellness", address: "1700 S 1st St",    lat: 30.2480, lng: -97.7510, phone: "+15125550116",                                  employeeCountRange: "1-10",    status: "prospect",  lastActivity: daysAgo(2) },
  { id: "m-017", name: "Westfield Salon",       category: "other", address: "11066 Pecan Park Blvd", lat: 30.4810, lng: -97.7950, phone: "+15125550117",                            employeeCountRange: "1-10",    status: "active",    lastActivity: daysAgo(4) },
  { id: "m-018", name: "Ocean Breeze Spa",      category: "fitness_wellness", address: "1010 W 38th St",   lat: 30.3030, lng: -97.7510, phone: "+15125550118",                                  employeeCountRange: "11-50",   status: "prospect",  lastActivity: daysAgo(3) },
  { id: "m-019", name: "Island Massage",        category: "fitness_wellness", address: "1716 S Congress Ave", lat: 30.2491, lng: -97.7430, phone: "+15125550119",                              employeeCountRange: "1-10",    status: "won",       lastActivity: daysAgo(8),   note: "Closed last month. Friendly intro source." },

  // ─── Automotive ─────────────────────────────────────────────────
  { id: "m-020", name: "Eastside Auto Repair",  category: "automotive", address: "2200 E 7th St",           lat: 30.2615, lng: -97.7220, phone: "+15125550120",                                  employeeCountRange: "11-50",   status: "untouched", lastActivity: null },
  { id: "m-021", name: "Valley Auto Body",      category: "automotive", address: "8200 N Lamar Blvd",       lat: 30.3530, lng: -97.7180, phone: "+15125550121",                                  employeeCountRange: "11-50",   status: "active",    lastActivity: daysAgo(5) },

  // ─── Professional / hospitality / other ─────────────────────────
  { id: "m-022", name: "Tropical Travel Agency",category: "professional_services", address: "601 Brazos St", lat: 30.2700, lng: -97.7420, phone: "+15125550122",                                 employeeCountRange: "1-10",    status: "active",    lastActivity: daysAgo(2) },
  { id: "m-023", name: "XYZ Plumbing",          category: "construction_trades", address: "910 W Anderson Ln", lat: 30.3460, lng: -97.7385, phone: "+15125550123",                            employeeCountRange: "11-50",   status: "active",    lastActivity: daysAgo(6) },
  { id: "m-024", name: "PineCrest Hotel",       category: "hospitality",  address: "303 W 15th St",         lat: 30.2790, lng: -97.7430, phone: "+15125550124",                                  employeeCountRange: "51-200",  status: "active",    lastActivity: daysAgo(2),   note: "Big logo, multi-property opportunity." },
  { id: "m-025", name: "Family Pharmacy",       category: "other",        address: "5601 Brodie Ln",        lat: 30.2240, lng: -97.8230, phone: "+15125550125",                                  employeeCountRange: "11-50",   status: "cooled",    lastActivity: daysAgo(45) },
];

// ─── Label / token maps used by the map markers + list ─────────────

export const STATUS_LABEL: Record<MerchantStatus, string> = {
  untouched: "Untouched",
  prospect:  "Prospect",
  active:    "Active deal",
  won:       "Closed-won",
  cooled:    "Cooled",
};

/** Tailwind class for the small status pill in the list row. */
export const STATUS_PILL_CLASS: Record<MerchantStatus, string> = {
  untouched: "bg-surface-sunken text-text-muted",
  prospect:  "bg-status-info-bg text-status-info",
  active:    "bg-accent-violet-20 text-accent-violet",
  won:       "bg-status-success-bg text-status-success",
  cooled:    "bg-status-warning-bg text-status-warning",
};

/** Hex color for the map dot — Leaflet markers can't use Tailwind classes,
 *  they need a string color value. Stay in sync with STATUS_PILL_CLASS. */
export const STATUS_MAP_COLOR: Record<MerchantStatus, string> = {
  untouched: "#8C94A6", // text-muted-ish
  prospect:  "#2456E6", // signal blue (brand accent)
  active:    "#8B5CF6", // accent-violet
  won:       "#16A34A", // status-success
  cooled:    "#F59E0B", // status-warning
};

export const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  manufacturing_wholesale: "Manufacturing & Wholesale",
  construction_trades: "Construction & Trades",
  healthcare: "Healthcare",
  veterinary_pet: "Veterinary & Pet Services",
  professional_services: "Professional Services",
  automotive: "Automotive",
  convenience_fuel: "Convenience & Fuel",
  grocery_food_retail: "Grocery & Food",
  apparel_accessories: "Apparel & Accessories",
  home_hardware: "Home & Hardware",
  electronics_specialty: "Electronics & Specialty Retail",
  pharmacy_health_retail: "Pharmacy & Health Retail",
  general_merchandise: "General Merchandise",
  food_beverage: "Food & Beverage",
  hospitality: "Hospitality",
  education: "Education",
  finance_banking: "Finance & Banking",
  fitness_wellness: "Fitness & Wellness",
  personal_services: "Personal Services",
  entertainment: "Entertainment",
  sports_recreation: "Sports & Recreation",
  transportation: "Transportation",
  non_profit: "Non-Profit",
  other: "Other",
};

/** Labels for retired pre-migration category keys still on old merchant/path_stop
 *  rows, so historical data renders a sensible name. */
const RETIRED_CATEGORY_LABEL: Record<string, string> = {
  manufacturing: "Manufacturing",
  retail: "Retail",
};

/** Display label for ANY stored category string — new key, retired key, or unknown.
 *  Route all category-label display lookups through this. */
export function labelForCategory(key: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[key] ?? RETIRED_CATEGORY_LABEL[key] ?? "Other";
}
