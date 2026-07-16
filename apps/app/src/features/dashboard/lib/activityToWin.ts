/**
 * Activity-to-Win metric engine (PRD §3.3.A).
 *
 * Pure aggregation over the per-deal snapshot columns stamped at Closed Won
 * (migration 20260716000001). Two components, both medians:
 *   A — activity volume to win (total + per type)
 *   B — time-to-win (business days) with 25th/75th percentile spread
 *
 * Zero-activity wins are excluded from BOTH components and reported
 * separately as `unmeasuredWins` (PRD §3.3.A.8). A 3-won-deal minimum
 * gates the headline ("Insufficient data") without hiding the raw numbers.
 */

import type { Deal } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";

// ── Stats helpers ──────────────────────────────────────────────────────

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Linear-interpolation percentile (R-7 / Excel PERCENTILE.INC). p ∈ [0,1]. */
export function percentile(nums: number[], p: number): number | null {
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0]!;
  const s = [...nums].sort((a, b) => a - b);
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (idx - lo) * (s[hi]! - s[lo]!);
}

/** Population standard deviation. 0 for <2 values (no spread → no outliers). */
export function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums)!;
  return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length);
}

// ── Types ──────────────────────────────────────────────────────────────

export type AwActivityType = "call" | "email" | "dropin" | "appointment";

export interface AwFilters {
  /** Matches the lead-source bucket (empty leadSource → "Other"). */
  source?: string;
  ownerId?: string;
  industry?: string;
  /** Half-open [minCents, maxCents) so the default bands don't overlap. */
  valueBand?: { minCents?: number; maxCents?: number };
}

export interface ActivityToWinRow {
  dealId: string;
  companyName: string;
  ownerId: string | null;
  source: string;
  valueCents: number;
  closedWonAt: string;
  firstActivityAt: string | null;
  counts: Record<AwActivityType | "total", number>;
  businessDays: number | null;
  calendarDays: number | null;
  isOutlier: boolean;
}

export interface ActivityToWinAggregate {
  /** Component A cohort size (won deals with ≥1 logged activity). */
  sampleSize: number;
  insufficientData: boolean;
  /** Won deals with zero logged activities (excluded from both components). */
  unmeasuredWins: number;
  // Component A
  medianTotal: number | null;
  meanTotal: number | null;
  medianByType: Record<AwActivityType, number | null>;
  // Component B
  timingSampleSize: number;
  medianBusinessDays: number | null;
  medianCalendarDays: number | null;
  p25BusinessDays: number | null;
  p75BusinessDays: number | null;
  /** Per-deal detail (drives the slice-4 drill-down). */
  rows: ActivityToWinRow[];
}

export const MIN_SAMPLE = 3;

/** Default (tenant-configurable) deal-value bands, in cents. */
export const VALUE_BANDS = [
  { key: "lt25k", label: "< $25K", minCents: undefined, maxCents: 25_000_00 },
  { key: "25kto100k", label: "$25K-$100K", minCents: 25_000_00, maxCents: 100_000_00 },
  { key: "gt100k", label: "> $100K", minCents: 100_000_00, maxCents: undefined },
] as const;

export function leadSourceBucket(leadSource: string | null | undefined): string {
  const t = (leadSource ?? "").trim();
  return t === "" ? "Other" : t;
}

export interface RepComparisonBand {
  /** Range of per-rep median touches-to-close across reps in the cohort. */
  touches: { min: number; max: number } | null;
  /** Range of per-rep median business-days-to-close across reps. */
  businessDays: { min: number; max: number } | null;
  repCount: number;
}

/**
 * The manager comparison band: the spread of per-rep medians across the reps
 * whose deals are in the cohort. A range needs ≥2 reps with a value to be
 * meaningful, so bands are null below that (e.g. a manager with one active rep).
 */
export function repComparisonBand(rows: ActivityToWinRow[]): RepComparisonBand {
  const byRep = new Map<string, ActivityToWinRow[]>();
  for (const r of rows) {
    const key = r.ownerId ?? "__unassigned__";
    const group = byRep.get(key);
    if (group) group.push(r);
    else byRep.set(key, [r]);
  }

  const touchMedians: number[] = [];
  const dayMedians: number[] = [];
  for (const group of byRep.values()) {
    const t = median(group.filter((r) => r.counts.total > 0).map((r) => r.counts.total));
    if (t != null) touchMedians.push(t);
    const d = median(
      group.filter((r) => r.businessDays != null).map((r) => r.businessDays as number),
    );
    if (d != null) dayMedians.push(d);
  }

  const range = (xs: number[]) =>
    xs.length >= 2 ? { min: Math.min(...xs), max: Math.max(...xs) } : null;

  return { touches: range(touchMedians), businessDays: range(dayMedians), repCount: byRep.size };
}

// ── Compare-to-Lost (slice 5b) ─────────────────────────────────────────────

export interface AwLostSummary {
  /** Lost deals with ≥1 logged activity before loss (median cohort). */
  sampleSize: number;
  insufficientData: boolean;
  /** Median touches-before-loss over the measured cohort. */
  medianTotal: number | null;
  /** Median business-days-to-loss over lost deals that have a timing. */
  medianBusinessDays: number | null;
}

/**
 * The lost-side companion to computeActivityToWin, for the report's
 * Compare-to-Lost toggle: median touches + median business-days over deals
 * currently in the terminal 'lost' stage whose loss snapshot falls in the
 * window. Same filters and MIN_SAMPLE gate as the won side so the two read
 * consistently. Touches reuse activityCount*; timing uses the lost columns.
 */
export function computeActivityToLost(
  deals: Deal[],
  opts: { range: DateRange; filters?: AwFilters; minSample?: number },
): AwLostSummary {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const f = opts.filters ?? {};

  const lost = deals.filter((dl) => {
    if (dl.stage !== "lost") return false;
    if (!dl.closedLostAt) return false;
    if (!withinRange(dl.closedLostAt, opts.range)) return false;
    if (f.ownerId && dl.owner_id !== f.ownerId) return false;
    if (f.source && leadSourceBucket(dl.leadSource) !== f.source) return false;
    if (f.industry && (dl.industry ?? "") !== f.industry) return false;
    if (f.valueBand) {
      if (f.valueBand.minCents != null && dl.valueCents < f.valueBand.minCents) return false;
      if (f.valueBand.maxCents != null && dl.valueCents >= f.valueBand.maxCents) return false;
    }
    return true;
  });

  const measured = lost.filter((dl) => (dl.activityCountTotal ?? 0) > 0);
  const bizDays = lost
    .filter((dl) => dl.timeToLostBusinessDays != null)
    .map((dl) => dl.timeToLostBusinessDays as number);

  return {
    sampleSize: measured.length,
    insufficientData: measured.length < minSample,
    medianTotal: median(measured.map((dl) => dl.activityCountTotal ?? 0)),
    medianBusinessDays: median(bizDays),
  };
}

// ── Trend over time (slice 5a) ─────────────────────────────────────────────

export interface AwTrendBucket {
  /** Calendar month of close, "YYYY-MM" (UTC). */
  key: string;
  /** Short display label, e.g. "Jun" (or "Jun '25" when the trend spans years). */
  label: string;
  /** Won deals closing in the month (all, including zero-activity). */
  wonCount: number;
  /** Median touches-to-close over the month's measured deals (activity > 0). */
  medianTotal: number | null;
  /** Median business-days-to-close over the month's timed deals. */
  medianBusinessDays: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Bucket won-deal rows into calendar months of close and compute the two
 * medians per month, so the report can show whether deals are trending toward
 * fewer touches / faster closes. Only months that contain a won deal appear
 * (sparse beta data reads better without empty gaps), sorted oldest → newest.
 * Labels carry a 2-digit year only when the trend spans more than one year.
 */
export function activityToWinTrend(rows: ActivityToWinRow[]): AwTrendBucket[] {
  const byMonth = new Map<string, ActivityToWinRow[]>();
  for (const r of rows) {
    const key = r.closedWonAt.slice(0, 7); // "YYYY-MM" (UTC, lexicographic-safe)
    const group = byMonth.get(key);
    if (group) group.push(r);
    else byMonth.set(key, [r]);
  }

  const keys = [...byMonth.keys()].sort();
  const spansYears = keys.length > 0 && keys[0]!.slice(0, 4) !== keys[keys.length - 1]!.slice(0, 4);

  return keys.map((key) => {
    const group = byMonth.get(key)!;
    const monthIdx = Number(key.slice(5, 7)) - 1;
    const label = spansYears ? `${MONTHS[monthIdx]} '${key.slice(2, 4)}` : MONTHS[monthIdx]!;
    return {
      key,
      label,
      wonCount: group.length,
      medianTotal: median(group.filter((r) => r.counts.total > 0).map((r) => r.counts.total)),
      medianBusinessDays: median(
        group.filter((r) => r.businessDays != null).map((r) => r.businessDays as number),
      ),
    };
  });
}

// ── CSV export (slice 5a) ──────────────────────────────────────────────────

/** RFC-4180 field escape: quote when the value holds a comma, quote, or newline. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface AwCsvOptions {
  /** Include a Rep column (managers/admins only). */
  includeRep?: boolean;
  /** ownerId → display name; unresolved / null owners render "Unassigned". */
  repName?: (ownerId: string | null) => string;
}

/**
 * Serialize the drill-down rows to a spreadsheet-friendly CSV. Numbers stay
 * raw (dollars, integer days) and dates are YYYY-MM-DD so Excel/Sheets parse
 * them without coercion. Row order matches whatever the caller passes in.
 */
export function activityToWinRowsToCsv(rows: ActivityToWinRow[], opts: AwCsvOptions = {}): string {
  const header = [
    "Company",
    ...(opts.includeRep ? ["Rep"] : []),
    "Total touches",
    "Calls",
    "Emails",
    "Drop-ins",
    "Appointments",
    "Business days",
    "Calendar days",
    "Source",
    "Value (USD)",
    "Closed",
    "Outlier",
  ];

  const lines = [header.map(csvField).join(",")];
  for (const r of rows) {
    const cells: (string | number)[] = [
      r.companyName,
      ...(opts.includeRep ? [opts.repName ? opts.repName(r.ownerId) : (r.ownerId ?? "Unassigned")] : []),
      r.counts.total,
      r.counts.call,
      r.counts.email,
      r.counts.dropin,
      r.counts.appointment,
      r.businessDays ?? "",
      r.calendarDays ?? "",
      r.source,
      (r.valueCents / 100).toFixed(2),
      r.closedWonAt.slice(0, 10),
      r.isOutlier ? "yes" : "",
    ];
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\r\n");
}

// ── Aggregation ──────────────────────────────────────────────────────────

export function computeActivityToWin(
  deals: Deal[],
  opts: { range: DateRange; filters?: AwFilters; minSample?: number },
): ActivityToWinAggregate {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const f = opts.filters ?? {};

  // Won-set: currently won, with an in-window close snapshot, passing filters.
  const won = deals.filter((dl) => {
    if (dl.stage !== "won") return false;
    if (!dl.closedWonAt) return false;
    if (!withinRange(dl.closedWonAt, opts.range)) return false;
    if (f.ownerId && dl.owner_id !== f.ownerId) return false;
    if (f.source && leadSourceBucket(dl.leadSource) !== f.source) return false;
    if (f.industry && (dl.industry ?? "") !== f.industry) return false;
    if (f.valueBand) {
      if (f.valueBand.minCents != null && dl.valueCents < f.valueBand.minCents) return false;
      if (f.valueBand.maxCents != null && dl.valueCents >= f.valueBand.maxCents) return false;
    }
    return true;
  });

  const measured = won.filter((dl) => (dl.activityCountTotal ?? 0) > 0);
  const timed = won.filter((dl) => dl.timeToWinBusinessDays != null);

  const totals = measured.map((dl) => dl.activityCountTotal ?? 0);
  const bizDays = timed.map((dl) => dl.timeToWinBusinessDays as number);
  // Calendar-days median over its OWN non-null cohort (not the business-days
  // cohort) so it never depends on the two columns being co-null.
  const calDays = won
    .filter((dl) => dl.timeToWinCalendarDays != null)
    .map((dl) => dl.timeToWinCalendarDays as number);
  const medTotal = median(totals);
  const medBiz = median(bizDays);
  const sdTotal = stddev(totals);
  const sdBiz = stddev(bizDays);

  const isOutlier = (dl: Deal): boolean => {
    const t = dl.activityCountTotal ?? 0;
    // Only measured-cohort deals (activity > 0) can be Component-A outliers;
    // zero-activity wins are excluded from the component entirely.
    const totalOut = t > 0 && medTotal != null && sdTotal > 0 && Math.abs(t - medTotal) > 2 * sdTotal;
    const b = dl.timeToWinBusinessDays;
    const bizOut = b != null && medBiz != null && sdBiz > 0 && Math.abs(b - medBiz) > 2 * sdBiz;
    return Boolean(totalOut || bizOut);
  };

  const rows: ActivityToWinRow[] = won.map((dl) => ({
    dealId: dl.id,
    companyName: dl.companyName,
    ownerId: dl.owner_id,
    source: leadSourceBucket(dl.leadSource),
    valueCents: dl.valueCents,
    closedWonAt: dl.closedWonAt as string,
    firstActivityAt: dl.firstActivityAt ?? null,
    counts: {
      total: dl.activityCountTotal ?? 0,
      call: dl.activityCountCall ?? 0,
      email: dl.activityCountEmail ?? 0,
      dropin: dl.activityCountDropin ?? 0,
      appointment: dl.activityCountAppointment ?? 0,
    },
    businessDays: dl.timeToWinBusinessDays ?? null,
    calendarDays: dl.timeToWinCalendarDays ?? null,
    isOutlier: isOutlier(dl),
  }));

  return {
    sampleSize: measured.length,
    insufficientData: measured.length < minSample,
    unmeasuredWins: won.length - measured.length,
    medianTotal: medTotal,
    meanTotal: mean(totals),
    medianByType: {
      call: median(measured.map((dl) => dl.activityCountCall ?? 0)),
      email: median(measured.map((dl) => dl.activityCountEmail ?? 0)),
      dropin: median(measured.map((dl) => dl.activityCountDropin ?? 0)),
      appointment: median(measured.map((dl) => dl.activityCountAppointment ?? 0)),
    },
    timingSampleSize: timed.length,
    medianBusinessDays: medBiz,
    medianCalendarDays: median(calDays),
    p25BusinessDays: percentile(bizDays, 0.25),
    p75BusinessDays: percentile(bizDays, 0.75),
    rows,
  };
}
