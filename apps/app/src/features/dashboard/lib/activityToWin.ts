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
  { key: "25kto100k", label: "$25K–$100K", minCents: 25_000_00, maxCents: 100_000_00 },
  { key: "gt100k", label: "> $100K", minCents: 100_000_00, maxCents: undefined },
] as const;

export function leadSourceBucket(leadSource: string | null | undefined): string {
  const t = (leadSource ?? "").trim();
  return t === "" ? "Other" : t;
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
  const medTotal = median(totals);
  const medBiz = median(bizDays);
  const sdTotal = stddev(totals);
  const sdBiz = stddev(bizDays);

  const isOutlier = (dl: Deal): boolean => {
    const t = dl.activityCountTotal ?? 0;
    const totalOut = medTotal != null && sdTotal > 0 && Math.abs(t - medTotal) > 2 * sdTotal;
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
    medianCalendarDays: median(timed.map((dl) => dl.timeToWinCalendarDays as number)),
    p25BusinessDays: percentile(bizDays, 0.25),
    p75BusinessDays: percentile(bizDays, 0.75),
    rows,
  };
}
