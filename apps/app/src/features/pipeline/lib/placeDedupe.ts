/**
 * Duplicate-detection normalizers + tiered classifier for Add-Deal-via-Places
 * (slice C). Mirrors the SQL helpers in the companion migration so the client
 * can flag a likely duplicate inline while the authoritative, org-wide check
 * still runs server-side (find_place_duplicate_candidates RPC, RLS-safe).
 *
 * Three tiers, strongest first (PRD §10.1 / FR-ADD-DUP):
 *   1. place_id       exact Google id match          -> BLOCKING (open/attach)
 *      name_address   normalized name+address match  -> BLOCKING (open/attach)
 *   2. phone          same last-10 phone digits       -> SOFT confirm
 *      name           same normalized business name   -> SOFT confirm
 *   3. base_name      same base name, different site  -> SOFT "second location"
 *
 * A blocking tier means we already know it is the same record; a soft tier means
 * "probably related, let the rep confirm". base_name is how a real second
 * location is offered as a sibling rather than blocked as a dupe.
 */

/** Legal suffixes + the leading article, dropped as standalone tokens so
 *  "Pat's Diner LLC" and "Pat's Diner" share a name key. Mirrors the SQL. */
const NAME_STOPWORDS = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "pllc",
  "lp",
  "llp",
  "the",
]);

/** Location qualifiers stripped to derive a base name (second-location detection):
 *  compass directions and generic site words. A trailing store/unit number is
 *  stripped separately. "Lone Star HVAC - North" and "Lone Star HVAC #12" both
 *  reduce to "lone star hvac". */
const LOCATION_QUALIFIERS = new Set([
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "downtown",
  "uptown",
  "midtown",
  "central",
  "location",
  "store",
  "branch",
  "at",
  "of",
]);

/**
 * Normalized business-name key: lowercase, `&`→`and`, non-alphanumerics to
 * spaces, drop legal-suffix/article tokens, collapse whitespace. Empty string
 * when nothing usable remains (caller treats "" as "no key").
 */
export function normalizeDealName(name: string | null | undefined): string {
  if (!name) return "";
  let v = name.toLowerCase().replace(/&/g, " and ");
  v = v.replace(/[^a-z0-9]+/g, " ");
  v = v
    .split(" ")
    .filter((t) => t && !NAME_STOPWORDS.has(t))
    .join(" ");
  return v.trim().replace(/\s+/g, " ");
}

/**
 * Last 10 digits of a phone number (US NANP significant digits), stripping a
 * leading country `1` and all formatting. Returns null when fewer than 10
 * digits remain — too little to match on.
 */
export function phoneTail10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Base-name key for second-location detection: the normalized name with any
 * trailing location qualifier(s) and a trailing store/unit number removed. Only
 * strips from the END so "north star grill" (north is meaningful at the front)
 * is preserved, while "star grill north 12" collapses to "star grill".
 */
export function baseDealName(name: string | null | undefined): string {
  const tokens = normalizeDealName(name).split(" ").filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (LOCATION_QUALIFIERS.has(last) || /^\d+$/.test(last)) {
      tokens.pop();
    } else {
      break;
    }
  }
  return tokens.join(" ");
}

/** The duplicate tiers, strongest to weakest. `null` = no match. */
export type DuplicateTier = "place_id" | "name_address" | "phone" | "name" | "base_name";

/** Whether a tier blocks creation (same record) or is a soft confirm. */
export function isBlockingTier(tier: DuplicateTier): boolean {
  return tier === "place_id" || tier === "name_address";
}

/** Minimal shape of a candidate business being added (from the Places resolver
 *  or manual entry). */
export interface DuplicateCandidate {
  placeId: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
}

/** Minimal shape of an existing active deal to check against. */
export interface ExistingDealForDedupe {
  id: string;
  companyName: string | null;
  address: string | null;
  contactPhone: string | null;
  placeId: string | null;
}

export interface DuplicateMatch {
  tier: DuplicateTier;
  deal: ExistingDealForDedupe;
}

/** name+address composite key, matching the SQL deal_dedupe_key: both parts
 *  required, else null (a blank address is never a wrong block). */
function nameAddressKey(name: string | null | undefined, address: string | null | undefined): string | null {
  const n = normalizeDealName(name);
  const a = normalizeAddress(address);
  if (!n || !a) return null;
  return `${n}|${a}`;
}

/** Address normalizer mirroring the SQL: lowercase, expand common street-type +
 *  unit abbreviations, drop unit designators (keep the number), collapse space. */
export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return "";
  let v = address.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const replacements: Array<[RegExp, string]> = [
    [/\b(street|str)\b/g, "st"],
    [/\b(avenue|av)\b/g, "ave"],
    [/\broad\b/g, "rd"],
    [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"],
    [/\blane\b/g, "ln"],
    [/\bcourt\b/g, "ct"],
    [/\b(highway|hwy)\b/g, "hwy"],
  ];
  for (const [re, to] of replacements) v = v.replace(re, to);
  v = v.replace(/\b(suite|ste|unit|apt|apartment|building|bldg|floor|fl|no|number)\b/g, " ");
  return v.trim().replace(/\s+/g, " ");
}

/**
 * Classify the strongest duplicate relationship between a candidate business and
 * a set of existing active deals. Returns the strongest tier and the deal it
 * matched, or null when the candidate looks new. Priority: place_id >
 * name_address > phone > name > base_name. Within a tier, the first (oldest, by
 * caller ordering) match wins.
 */
export function classifyDuplicateTier(
  candidate: DuplicateCandidate,
  existing: ExistingDealForDedupe[],
): DuplicateMatch | null {
  const candPlace = candidate.placeId?.trim() || null;
  const candKey = nameAddressKey(candidate.name, candidate.address);
  const candPhone = phoneTail10(candidate.phone);
  const candName = normalizeDealName(candidate.name);
  const candBase = baseDealName(candidate.name);

  // Evaluate each deal, keep the strongest tier seen. Lower index = stronger.
  const ORDER: DuplicateTier[] = ["place_id", "name_address", "phone", "name", "base_name"];
  let best: DuplicateMatch | null = null;
  const rank = (t: DuplicateTier) => ORDER.indexOf(t);

  for (const deal of existing) {
    let tier: DuplicateTier | null = null;
    if (candPlace && deal.placeId && candPlace === deal.placeId) {
      tier = "place_id";
    } else if (candKey && nameAddressKey(deal.companyName, deal.address) === candKey) {
      tier = "name_address";
    } else if (candPhone && phoneTail10(deal.contactPhone) === candPhone) {
      tier = "phone";
    } else if (candName && normalizeDealName(deal.companyName) === candName) {
      tier = "name";
    } else if (candBase && candBase === baseDealName(deal.companyName)) {
      // base_name only counts as a SEPARATE tier when the full names differ
      // (else it is already caught by the stronger `name` tier above).
      tier = "base_name";
    }
    if (tier && (!best || rank(tier) < rank(best.tier))) {
      best = { tier, deal };
      if (tier === "place_id") break; // nothing stronger possible
    }
  }
  return best;
}
