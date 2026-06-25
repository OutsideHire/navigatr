/**
 * dateRange — pure helpers for the Dashboard's date-range selector.
 *
 * The range re-scopes the dashboard's *flow* metrics (activities logged,
 * activities-to-win) by their timestamps. Stock metrics (current pipeline,
 * stage distribution) ignore it — see useDashboardData.
 *
 * ISO strings are compared lexicographically, which is correct for UTC
 * ISO-8601 timestamps (fixed-width, zero-padded, Z suffix).
 */

export type RangeKey = "7d" | "30d" | "90d" | "all";

export interface DateRange {
  /** Inclusive lower bound (ISO). null === all time (no lower bound). */
  fromIso: string | null;
  /** Inclusive upper bound (ISO) — "now" when the range was resolved. */
  toIso: string;
}

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

const DAYS: Record<Exclude<RangeKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Resolve a range key into concrete ISO bounds, anchored at `now`. */
export function resolveRange(key: RangeKey, now: Date): DateRange {
  const toIso = now.toISOString();
  if (key === "all") return { fromIso: null, toIso };
  const from = new Date(now);
  from.setDate(from.getDate() - DAYS[key]);
  return { fromIso: from.toISOString(), toIso };
}

/** True when an ISO timestamp falls within the (inclusive) range. */
export function withinRange(iso: string, range: DateRange): boolean {
  if (iso > range.toIso) return false;
  if (range.fromIso !== null && iso < range.fromIso) return false;
  return true;
}

/** The human label for a range key (for the heading + dropdown trigger). */
export function rangeLabel(key: RangeKey): string {
  return RANGE_OPTIONS.find((o) => o.key === key)?.label ?? "Last 30 days";
}
