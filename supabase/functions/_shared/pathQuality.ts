/**
 * Path Data Quality Fix v1.2: the pieces of discovery's quality filter that
 * are pure logic, kept Deno-free so vitest covers them.
 *
 * The filter itself (closed businesses, team suppressions) runs in SQL; this
 * decides whether it is on, normalizes what Google sent, and shapes the one
 * measurement row each search writes (R7).
 */

/** The global switch. Read from the discovery service's PATH_QUALITY_FILTER
 *  setting. ON unless explicitly turned off, so a missing setting (every
 *  environment today) means the fix is live. Only "off", "0" or "false" turn it
 *  off, case and surrounding spaces ignored; anything else, typos included,
 *  leaves it on rather than silently disabling the fix. */
export function qualityFilterOn(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false");
}

export type BusinessStatus = "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

const STATUSES = new Set<string>(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]);

/** Google's businessStatus as stored on the prospect. Anything Google did not
 *  say, or a value we do not know (BUSINESS_STATUS_UNSPECIFIED, a future enum),
 *  is null: "unknown", which never hides a business. */
export function normalizeBusinessStatus(raw: unknown): BusinessStatus | null {
  return typeof raw === "string" && STATUSES.has(raw) ? (raw as BusinessStatus) : null;
}

/** Which Path surface asked. The spec names two: plan an area, and "+ Add
 *  more stops" (today's nearby view and a saved path's add-stops sheet). The
 *  app has two more discovery surfaces, Create a Path and the automatic fill of
 *  today's path, logged under their own names rather than folded into those. */
export const SEARCH_TYPES = ["plan_area", "add_stops", "create_path", "todays_path"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number] | "unspecified";

export function normalizeSearchType(raw: unknown): SearchType {
  return typeof raw === "string" && (SEARCH_TYPES as readonly string[]).includes(raw)
    ? (raw as SearchType)
    : "unspecified";
}

/** The hidden-count row prospects_nearby_hidden_counts returns. */
export interface HiddenCountsRow {
  home_based_hidden?: number | null;
  closed_hidden?: number | null;
  suppressed_hidden?: number | null;
  candidates?: number | null;
}

export interface SearchLogRow {
  org_id: string | null;
  user_id: string;
  search_type: SearchType;
  quality_filter_on: boolean;
  candidates: number;
  removed_closed: number;
  removed_service_area: number;
  removed_suppressed: number;
  final_stops: number;
}

/** One R7 row. Missing counts (the counts query failed) log as 0 rather than
 *  dropping the row, so every search still leaves a trace. */
export function searchLogRow(input: {
  orgId: string | null;
  userId: string;
  searchType: SearchType;
  qualityFilterOn: boolean;
  counts: HiddenCountsRow | null;
  finalStops: number;
}): SearchLogRow {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    org_id: input.orgId,
    user_id: input.userId,
    search_type: input.searchType,
    quality_filter_on: input.qualityFilterOn,
    candidates: n(input.counts?.candidates),
    removed_closed: n(input.counts?.closed_hidden),
    removed_service_area: n(input.counts?.home_based_hidden),
    removed_suppressed: n(input.counts?.suppressed_hidden),
    final_stops: input.finalStops,
  };
}
