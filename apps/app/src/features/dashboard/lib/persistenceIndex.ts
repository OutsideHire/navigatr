/**
 * Persistence Index metric engine (beta).
 *
 * Rewards reps who keep working an account rather than dropping it after a
 * single touch. Three components ship: Follow-Up Discipline, Touch Cadence,
 * and Re-engagement After Silence, each scaled 0..max and summed into a
 * composite out of 100 over only the components that have a sample.
 */

import type { Deal } from "@/features/pipeline/mockData";
import type { Activity } from "@/features/activities/mockData";
import { median, mean, percentile } from "./activityToWin";

export const TARGET_CADENCE = 3.5;
export const TARGET_SCORE = 75;
export const WINDOW_DAYS = 30;
export const FOLLOWUP_MAX = 40;
export const CADENCE_MAX = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const REENGAGEMENT_MAX = 30;
export const SILENCE_THRESHOLD_DAYS = 21;
export const FAIRNESS_WINDOW_DAYS = 7;
export const FOLLOWUP_FLOOR = 8;
/** v1 = Follow-Up/Response-Velocity/Cadence. v2 drops Response Velocity
 *  (permanently uncomputable without inbound capture) for Re-engagement After
 *  Silence. SP-B will drive this and the parameters above from a config table. */
export const FORMULA_VERSION = 2;

// ── Follow-Up Discipline ─────────────────────────────────────────────────

export interface FollowUpResult {
  points: number;
  max: number;
  hasSample: boolean;
  completionRate: number | null;
  dueCount: number;
  belowFloor: boolean;
}

/**
 * Scores how reliably a rep keeps the follow-ups they scheduled. A
 * follow-up is "due" when its date falls inside the window; it's "on-time"
 * when some later activity on the same deal happened on or before that date.
 */
export function computeFollowUpDiscipline(
  deals: Deal[],
  activities: Activity[],
  ownerId: string,
  windowStart: Date,
  windowEnd: Date,
): FollowUpResult {
  const eligibleDealIds = new Set(
    deals.filter((d) => d.owner_id === ownerId && d.stage !== "lost").map((d) => d.id),
  );

  const startDate = windowStart.toISOString().slice(0, 10);
  const endDate = windowEnd.toISOString().slice(0, 10);

  const byDeal = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!eligibleDealIds.has(a.dealId)) continue;
    const group = byDeal.get(a.dealId);
    if (group) group.push(a);
    else byDeal.set(a.dealId, [a]);
  }

  const due: Activity[] = [];
  for (const acts of byDeal.values()) {
    for (const a of acts) {
      if (!a.followUpDate) continue;
      if (a.followUpDate >= startDate && a.followUpDate <= endDate) due.push(a);
    }
  }

  if (due.length === 0) {
    return { points: 0, max: FOLLOWUP_MAX, hasSample: false, completionRate: null, dueCount: 0, belowFloor: false };
  }

  let onTime = 0;
  for (const a of due) {
    const siblings = byDeal.get(a.dealId) ?? [];
    const kept = siblings.some(
      (b) => b.occurredAt > a.occurredAt && b.occurredAt.slice(0, 10) <= (a.followUpDate as string),
    );
    if (kept) onTime += 1;
  }

  const rate = onTime / due.length;
  const belowFloor = due.length < FOLLOWUP_FLOOR;
  return {
    points: Math.round(rate * FOLLOWUP_MAX),
    max: FOLLOWUP_MAX,
    hasSample: !belowFloor,
    completionRate: rate,
    dueCount: due.length,
    belowFloor,
  };
}

// ── Touch Cadence ────────────────────────────────────────────────────────

export interface CadenceResult {
  points: number;
  max: number;
  hasSample: boolean;
  medianTouchesPerWeek: number | null;
  activeDeals: number;
}

/**
 * Scores whether a rep is touching their open deals often enough. An
 * "active" deal is one the rep owns, still open, with at least one touch in
 * the window; its cadence is touches-per-week measured from its first touch
 * in the window through the window end. The rep's median cadence across
 * active deals is compared against the target (3.5/wk).
 */
export function computeTouchCadence(
  deals: Deal[],
  activities: Activity[],
  ownerId: string,
  windowStart: Date,
  windowEnd: Date,
): CadenceResult {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  const byDeal = new Map<string, Activity[]>();
  for (const a of activities) {
    const group = byDeal.get(a.dealId);
    if (group) group.push(a);
    else byDeal.set(a.dealId, [a]);
  }

  const openOwned = deals.filter(
    (d) => d.owner_id === ownerId && d.stage !== "won" && d.stage !== "lost",
  );

  const perWeek: number[] = [];
  for (const d of openOwned) {
    const acts = (byDeal.get(d.id) ?? []).filter((a) => {
      const t = new Date(a.occurredAt).getTime();
      return t >= startMs && t <= endMs;
    });
    if (acts.length === 0) continue;

    const firstMs = Math.min(...acts.map((a) => new Date(a.occurredAt).getTime()));
    const activeWeeks = Math.max((endMs - firstMs) / (7 * DAY_MS), 1);
    perWeek.push(acts.length / activeWeeks);
  }

  if (perWeek.length === 0) {
    return { points: 0, max: CADENCE_MAX, hasSample: false, medianTouchesPerWeek: null, activeDeals: 0 };
  }

  const med = median(perWeek) as number;
  const ratio = med / TARGET_CADENCE;
  let points: number;
  if (ratio >= 1) points = CADENCE_MAX;
  else if (ratio >= 0.5) points = Math.round(15 + (ratio - 0.5) * CADENCE_MAX);
  else points = Math.round(ratio * CADENCE_MAX);

  return {
    points,
    max: CADENCE_MAX,
    hasSample: true,
    medianTouchesPerWeek: med,
    activeDeals: perWeek.length,
  };
}

// ── Re-engagement After Silence ──────────────────────────────────────────

export interface ReEngagementResult {
  points: number;
  max: number;
  hasSample: boolean;
  rate: number | null;
  silentCount: number;
  reEngagedCount: number;
}

/**
 * Scores whether a rep gets back in touch with deals that went quiet. A deal
 * "goes silent" when SILENCE_THRESHOLD_DAYS pass with no logged activity. The
 * denominator is active deals whose silence began inside the trailing window
 * and at least FAIRNESS_WINDOW_DAYS ago (a just-quiet deal has not had a fair
 * chance to be recovered); the numerator is how many then got a later touch.
 * Zero silent deals (with active deals present) scores the full max, not
 * "excluded". A deal with a future-dated appointment, or reassigned within
 * the trailing `windowDays`, is excluded from the denominator entirely
 * (addendum 3.5): it never had a fair chance to be judged silent.
 *
 * Counts one episode per deal: for each deal we dedupe to its most recent
 * qualifying silence onset (see the loop below), so a deal that went silent
 * and recovered more than once in the window still contributes exactly one
 * entry to silentCount/reEngagedCount, not one per episode (addendum 3.8).
 */
export function computeReEngagement(
  deals: Deal[],
  activities: Activity[],
  ownerId: string,
  now: Date,
  windowDays: number = WINDOW_DAYS,
): ReEngagementResult {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const fairnessCutoffMs = nowMs - FAIRNESS_WINDOW_DAYS * DAY_MS;
  const silenceMs = SILENCE_THRESHOLD_DAYS * DAY_MS;
  const reassignLookbackMs = nowMs - windowDays * DAY_MS;

  const activeDeals = deals.filter(
    (d) => d.owner_id === ownerId && d.stage !== "won" && d.stage !== "lost",
  );
  if (activeDeals.length === 0) {
    return { points: 0, max: REENGAGEMENT_MAX, hasSample: false, rate: null, silentCount: 0, reEngagedCount: 0 };
  }

  const byDeal = new Map<string, number[]>();
  for (const a of activities) {
    const t = new Date(a.occurredAt).getTime();
    if (t > nowMs) continue;
    const g = byDeal.get(a.dealId);
    if (g) g.push(t);
    else byDeal.set(a.dealId, [t]);
  }

  let silentCount = 0;
  let reEngagedCount = 0;
  for (const d of activeDeals) {
    // Addendum 3.5 exclusions: a future-dated appointment or a reassignment
    // within the trailing lookback means the deal never had a fair chance
    // to be judged silent, so it drops out of the denominator entirely.
    if (d.has_future_appointment === true) continue;
    if (d.owner_changed_at && new Date(d.owner_changed_at).getTime() > reassignLookbackMs) continue;

    const times = (byDeal.get(d.id) ?? []).slice().sort((x, y) => x - y);
    if (times.length === 0) continue;

    let latestOnset: number | null = null;
    let latestReEngaged = false;
    for (let i = 0; i < times.length; i++) {
      const onset = times[i] + silenceMs;
      const next = i + 1 < times.length ? times[i + 1] : null;
      let reEngaged: boolean;
      if (next === null) {
        if (onset > nowMs) continue; // not yet silent
        reEngaged = false;
      } else if (next - times[i] > silenceMs) {
        reEngaged = true; // a later touch broke the silence
      } else {
        continue; // no silence in this interval
      }
      if (onset < windowStartMs || onset > fairnessCutoffMs) continue; // not a qualifying onset
      if (latestOnset === null || onset > latestOnset) {
        latestOnset = onset;
        latestReEngaged = reEngaged;
      }
    }
    if (latestOnset === null) continue;
    silentCount += 1;
    if (latestReEngaged) reEngagedCount += 1;
  }

  if (silentCount === 0) {
    return { points: REENGAGEMENT_MAX, max: REENGAGEMENT_MAX, hasSample: true, rate: null, silentCount: 0, reEngagedCount: 0 };
  }
  const rate = reEngagedCount / silentCount;
  return { points: Math.round(rate * REENGAGEMENT_MAX), max: REENGAGEMENT_MAX, hasSample: true, rate, silentCount, reEngagedCount };
}

// ── Composite ──────────────────────────────────────────────────────────────

export interface PersistenceOptions {
  ownerId: string;
  now: Date;
  windowDays?: number;
}

export interface ComponentView {
  key: "followUp" | "cadence" | "reEngagement";
  label: string;
  points: number;
  max: number;
  hasSample: boolean;
  belowFloor?: boolean;
}

export interface PersistenceIndexResult {
  composite: number | null;
  /** True when composite is null because follow-up discipline is below the
   *  volume floor (see caveats.followUpBelowFloor). The composite is NOT
   *  rescaled over the remaining components in that case; it is null. */
  insufficientData: boolean;
  followUp: FollowUpResult;
  cadence: CadenceResult;
  reEngagement: ReEngagementResult;
  components: ComponentView[];
  caveats: { followUpBelowFloor: boolean };
  windowDays: number;
  targetScore: number;
  formulaVersion: number;
}

/**
 * The blended Persistence Index: a 0-100 composite scaled over whichever
 * sub-components have a sample in the trailing window. Null when no
 * component has enough data to score.
 */
export function computePersistenceIndex(
  deals: Deal[],
  activities: Activity[],
  opts: PersistenceOptions,
): PersistenceIndexResult {
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const windowEnd = opts.now;
  const windowStart = new Date(opts.now.getTime() - windowDays * DAY_MS);

  const followUp = computeFollowUpDiscipline(deals, activities, opts.ownerId, windowStart, windowEnd);
  const cadence = computeTouchCadence(deals, activities, opts.ownerId, windowStart, windowEnd);
  const reEngagement = computeReEngagement(deals, activities, opts.ownerId, windowEnd, windowDays);

  const components: ComponentView[] = [
    { key: "followUp", label: "Follow-up discipline", points: followUp.points, max: followUp.max, hasSample: followUp.hasSample, belowFloor: followUp.belowFloor },
    { key: "cadence", label: "Touch cadence", points: cadence.points, max: cadence.max, hasSample: cadence.hasSample },
    { key: "reEngagement", label: "Re-engagement after silence", points: reEngagement.points, max: reEngagement.max, hasSample: reEngagement.hasSample },
  ];

  let availPoints = 0;
  let availMax = 0;
  for (const c of components) {
    if (c.hasSample) {
      availPoints += c.points;
      availMax += c.max;
    }
  }

  // Below the volume floor, the composite is NOT rescaled over the
  // remaining components; it is forced to null and flagged insufficientData
  // (addendum 4.3 / R-01). Component points themselves are untouched so a
  // /60 partial can still be displayed.
  const composite = followUp.belowFloor
    ? null
    : availMax > 0
      ? Math.round((availPoints / availMax) * 100)
      : null;

  return {
    composite,
    insufficientData: followUp.belowFloor,
    followUp,
    cadence,
    reEngagement,
    components,
    caveats: { followUpBelowFloor: followUp.belowFloor },
    windowDays,
    targetScore: TARGET_SCORE,
    formulaVersion: FORMULA_VERSION,
  };
}

// ── Team Roll-up ─────────────────────────────────────────────────────────

export interface TeamPersistenceIndexResult {
  composite: number | null;
  followUp: { points: number | null; max: number };
  cadence: { points: number | null; max: number };
  reEngagement: { points: number | null; max: number; silentCount: number; reEngagedCount: number };
  components: ComponentView[];
  repCount: number;
  range: { min: number; max: number } | null;
  windowDays: number;
  targetScore: number;
}

/**
 * The team-aggregate Persistence Index for a manager/admin: the median of
 * each distinct deal owner's individual composite, plus the min/max range
 * across scored reps and how many reps had enough data to score.
 */
export function computeTeamPersistenceIndex(
  deals: Deal[],
  activities: Activity[],
  opts: { now: Date; windowDays?: number },
): TeamPersistenceIndexResult {
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const owners = [...new Set(deals.map((d) => d.owner_id).filter((x): x is string => x != null))];
  const scored = owners
    .map((ownerId) => computePersistenceIndex(deals, activities, { ownerId, now: opts.now, windowDays }))
    .filter((r) => r.composite != null);
  const composites = scored.map((r) => r.composite as number);
  const fuPts = scored.filter((r) => r.followUp.hasSample).map((r) => r.followUp.points);
  const cadPts = scored.filter((r) => r.cadence.hasSample).map((r) => r.cadence.points);
  const reEngRows = scored.filter((r) => r.reEngagement.hasSample);
  const reEngPts = reEngRows.map((r) => r.reEngagement.points);
  // Eligible/recovered counts (addendum): total across scored reps, not a
  // median, since these are raw episode counts rather than a 0..max score.
  const silentTotal = reEngRows.reduce((s, r) => s + r.reEngagement.silentCount, 0);
  const reEngagedTotal = reEngRows.reduce((s, r) => s + r.reEngagement.reEngagedCount, 0);
  const teamComponents: ComponentView[] = [
    { key: "followUp", label: "Follow-up discipline", points: fuPts.length ? Math.round(median(fuPts) as number) : 0, max: FOLLOWUP_MAX, hasSample: fuPts.length > 0 },
    { key: "cadence", label: "Touch cadence", points: cadPts.length ? Math.round(median(cadPts) as number) : 0, max: CADENCE_MAX, hasSample: cadPts.length > 0 },
    { key: "reEngagement", label: "Re-engagement after silence", points: reEngPts.length ? Math.round(median(reEngPts) as number) : 0, max: REENGAGEMENT_MAX, hasSample: reEngPts.length > 0 },
  ];
  return {
    composite: composites.length ? Math.round(median(composites) as number) : null,
    followUp: { points: fuPts.length ? Math.round(median(fuPts) as number) : null, max: FOLLOWUP_MAX },
    cadence: { points: cadPts.length ? Math.round(median(cadPts) as number) : null, max: CADENCE_MAX },
    reEngagement: {
      points: reEngPts.length ? Math.round(median(reEngPts) as number) : null,
      max: REENGAGEMENT_MAX,
      silentCount: silentTotal,
      reEngagedCount: reEngagedTotal,
    },
    components: teamComponents,
    repCount: scored.length,
    range: composites.length >= 2 ? { min: Math.min(...composites), max: Math.max(...composites) } : null,
    windowDays,
    targetScore: TARGET_SCORE,
  };
}

// ── History (Slice 3) ───────────────────────────────────────────────────────

export interface PersistencePoint {
  date: string; // YYYY-MM-DD (UTC)
  composite: number | null;
  activityCount: number;
}

export const RANGE_PRESETS = [
  { key: "1W", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export interface HistoryOptions {
  now: Date;
  rangeDays: number;
  ownerId?: string; // required unless team
  team?: boolean;
  windowDays?: number;
}

/**
 * Client-side daily Persistence Index series: recomputes the composite as of
 * each day in the trailing `rangeDays` window (newest last), plus that day's
 * activity count for the volume sub-chart. Individual mode scopes volume to
 * the viewer's own deals; team mode counts everything in scope.
 */
export function computePersistenceHistory(
  deals: Deal[],
  activities: Activity[],
  opts: HistoryOptions,
): PersistencePoint[] {
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  // Activities scoped to the viewer: for an individual, only their deals'
  // activities count toward the daily volume; for a team, everything in scope.
  const ownerDealIds = opts.team
    ? null
    : new Set(deals.filter((d) => d.owner_id === opts.ownerId).map((d) => d.id));

  const points: PersistencePoint[] = [];
  for (let i = opts.rangeDays - 1; i >= 0; i--) {
    const d = new Date(opts.now.getTime() - i * DAY_MS);
    const dateStr = d.toISOString().slice(0, 10);
    const composite = opts.team
      ? computeTeamPersistenceIndex(deals, activities, { now: d, windowDays }).composite
      : computePersistenceIndex(deals, activities, { ownerId: opts.ownerId as string, now: d, windowDays }).composite;
    const activityCount = activities.filter(
      (a) => a.occurredAt.slice(0, 10) === dateStr && (ownerDealIds ? ownerDealIds.has(a.dealId) : true),
    ).length;
    points.push({ date: dateStr, composite, activityCount });
  }
  return points;
}

/** Trend delta: last minus first non-null composite; null when fewer than 2 scored days. */
export function historyDelta(points: PersistencePoint[]): number | null {
  const scored = points.filter((p) => p.composite != null).map((p) => p.composite as number);
  if (scored.length < 2) return null;
  return scored[scored.length - 1] - scored[0];
}

// ── Per-Rep Roster (Slice 4) ─────────────────────────────────────────────

export interface PerRepScore {
  ownerId: string;
  composite: number | null;
  followUpPoints: number | null;
  cadencePoints: number | null;
  reEngagementPoints: number | null;
  followUpBelowFloor: boolean;
  reEngagementSilentCount: number | null;
  reEngagementReEngagedCount: number | null;
}

/**
 * Each distinct deal owner's individual Persistence Index, for the manager
 * roster on the detail page. Sorted by composite descending; reps with no
 * computable score sort last with a null composite.
 */
export function computePerRepPersistence(
  deals: Deal[],
  activities: Activity[],
  opts: { now: Date; windowDays?: number },
): PerRepScore[] {
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const owners = [...new Set(deals.map((d) => d.owner_id).filter((x): x is string => x != null))];
  const rows = owners.map((ownerId) => {
    const r = computePersistenceIndex(deals, activities, { ownerId, now: opts.now, windowDays });
    return {
      ownerId,
      composite: r.composite,
      followUpPoints: r.followUp.hasSample ? r.followUp.points : null,
      cadencePoints: r.cadence.hasSample ? r.cadence.points : null,
      reEngagementPoints: r.reEngagement.hasSample ? r.reEngagement.points : null,
      followUpBelowFloor: r.caveats.followUpBelowFloor,
      reEngagementSilentCount: r.reEngagement.hasSample ? r.reEngagement.silentCount : null,
      reEngagementReEngagedCount: r.reEngagement.hasSample ? r.reEngagement.reEngagedCount : null,
    };
  });
  return rows.sort((a, b) => {
    if (a.composite == null && b.composite == null) return 0;
    if (a.composite == null) return 1;
    if (b.composite == null) return -1;
    return b.composite - a.composite;
  });
}

// ── Detail display (Slice 5) ─────────────────────────────────────────────

export type BenchmarkStrategy = "full" | "top-performer" | "small" | "solo";

export interface BenchmarkResult {
  repCount: number;
  peerAvg: number | null;
  topDecile: number | null;
  topPerformer: number | null;
  strategy: BenchmarkStrategy;
}

/**
 * Peer benchmarks across scored reps, with small-tenant degradation:
 * 10+ reps -> average + top decile; 5-9 -> average + top performer; 2-4 ->
 * average only (small sample); <=1 -> solo (no peer benchmarks).
 */
export function persistenceBenchmarks(composites: (number | null)[]): BenchmarkResult {
  const scored = composites.filter((c): c is number => c != null);
  const n = scored.length;
  if (n <= 1) {
    return { repCount: n, peerAvg: null, topDecile: null, topPerformer: null, strategy: "solo" };
  }
  const peerAvg = Math.round(median(scored) as number);
  if (n >= 10) {
    return { repCount: n, peerAvg, topDecile: Math.round(percentile(scored, 0.9) as number), topPerformer: null, strategy: "full" };
  }
  if (n >= 5) {
    return { repCount: n, peerAvg, topDecile: null, topPerformer: Math.round(Math.max(...scored)), strategy: "top-performer" };
  }
  return { repCount: n, peerAvg, topDecile: null, topPerformer: null, strategy: "small" };
}

export interface SubComponentPeerAverages {
  followUpAvgPct: number | null;
  cadenceAvgPct: number | null;
  reEngagementAvgPct: number | null;
  repCount: number;
}

/** Median sub-component points across reps, expressed as a % of each max, for the bar ticks. */
export function subComponentPeerAverages(rows: PerRepScore[]): SubComponentPeerAverages {
  const fu = rows.map((r) => r.followUpPoints).filter((p): p is number => p != null);
  const cad = rows.map((r) => r.cadencePoints).filter((p): p is number => p != null);
  const reEng = rows.map((r) => r.reEngagementPoints).filter((p): p is number => p != null);
  return {
    followUpAvgPct: fu.length ? Math.round(((median(fu) as number) / FOLLOWUP_MAX) * 100) : null,
    cadenceAvgPct: cad.length ? Math.round(((median(cad) as number) / CADENCE_MAX) * 100) : null,
    reEngagementAvgPct: reEng.length ? Math.round(((median(reEng) as number) / REENGAGEMENT_MAX) * 100) : null,
    repCount: rows.filter((r) => r.composite != null).length,
  };
}

export interface PersistenceStats {
  high: number | null;
  low: number | null;
  periodAvg: number | null;
  dailyActivityAvg: number;
  daysAboveAvg: number | null;
  scoredDays: number;
}

/** Period stats from the daily history: index high/low/avg, daily activity avg, days above peer average. */
export function persistenceStats(points: PersistencePoint[], peerAvg: number | null): PersistenceStats {
  const scored = points.filter((p) => p.composite != null).map((p) => p.composite as number);
  const dailyActivityAvg = points.length
    ? Math.round((points.reduce((s, p) => s + p.activityCount, 0) / points.length) * 10) / 10
    : 0;
  return {
    high: scored.length ? Math.max(...scored) : null,
    low: scored.length ? Math.min(...scored) : null,
    periodAvg: scored.length ? Math.round(mean(scored) as number) : null,
    dailyActivityAvg,
    daysAboveAvg: peerAvg != null && scored.length ? scored.filter((c) => c > peerAvg).length : null,
    scoredDays: scored.length,
  };
}

/** Peer-average label by viewer scope. Admin sees the whole org; managers see their team. */
export function benchmarkAvgLabel(role: string | undefined): string {
  return role === "admin" ? "Company average" : "Team average";
}
