/**
 * Persistence Index scoring, ported from the app's
 * apps/app/src/features/dashboard/lib/persistenceIndex.ts (SP-A) for the
 * nightly snapshot job. Pure, dependency-free so vitest runs it via the
 * _shared include, and the Deno bundler can ship it without app imports.
 *
 * A parity test (persistenceIndex.parity.test.ts) asserts this module and
 * the app module produce identical results for the same fixtures/params, so
 * the two implementations cannot silently drift apart.
 */

import { dateInZone } from "./zonedDate";

// ── Types ────────────────────────────────────────────────────────────────

export interface ScoreDeal {
  id: string;
  owner_id: string | null;
  stage: string;
  /** Timestamp of the last owner reassignment; null if never reassigned.
   *  Re-engagement addendum 3.5: a deal reassigned within the trailing
   *  windowDays is excluded from the re-engagement denominator. */
  owner_changed_at: string | null;
  /** Whether the deal has a scheduled_appointments row with
   *  status = 'scheduled' and start_at in the future. Re-engagement
   *  addendum 3.5: such a deal is excluded from the denominator. */
  has_future_appointment: boolean;
}

export interface ScoreActivity {
  dealId: string;
  occurredAt: string;
  followUpDate: string | null;
}

export interface ScoreParams {
  followupMax: number;
  cadenceMax: number;
  reengagementMax: number;
  targetCadence: number;
  windowDays: number;
  silenceThresholdDays: number;
  fairnessWindowDays: number;
  followupFloor: number;
  formulaVersion: number;
}

export const DEFAULT_SCORE_PARAMS: ScoreParams = {
  followupMax: 40,
  cadenceMax: 30,
  reengagementMax: 30,
  targetCadence: 3.5,
  windowDays: 30,
  silenceThresholdDays: 21,
  fairnessWindowDays: 7,
  followupFloor: 8,
  formulaVersion: 2,
};

export interface RepScore {
  composite: number | null;
  /** True when composite is null because follow-up discipline is below the
   *  volume floor (see followupBelowFloor). The composite is NOT rescaled
   *  over the remaining components in that case; it is simply null. */
  insufficientData: boolean;
  followupPoints: number;
  followupBelowFloor: boolean;
  followupDueCount: number;
  cadencePoints: number;
  reengagementPoints: number;
  reengagementRate: number | null;
  dealsWentSilentCount: number;
  dealsReEngagedCount: number;
  formulaVersion: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Stats helpers (copied from activityToWin.ts; kept dependency-free) ─────

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

// ── Follow-Up Discipline ────────────────────────────────────────────────

interface FollowUpResult {
  points: number;
  max: number;
  hasSample: boolean;
  dueCount: number;
  belowFloor: boolean;
}

function computeFollowUpDiscipline(
  deals: ScoreDeal[],
  activities: ScoreActivity[],
  ownerId: string,
  windowStart: Date,
  windowEnd: Date,
  params: ScoreParams,
  tz: string | null | undefined,
): FollowUpResult {
  const eligibleDealIds = new Set(
    deals.filter((d) => d.owner_id === ownerId && d.stage !== "lost").map((d) => d.id),
  );

  // Day boundaries resolve in the rep's zone, not UTC: a follow-up promised for
  // a date is "kept on time" if a later touch lands on/before that date in the
  // rep's LOCAL calendar. A null zone falls back to UTC (prior behavior).
  const startDate = dateInZone(windowStart, tz);
  const endDate = dateInZone(windowEnd, tz);

  const byDeal = new Map<string, ScoreActivity[]>();
  for (const a of activities) {
    if (!eligibleDealIds.has(a.dealId)) continue;
    const group = byDeal.get(a.dealId);
    if (group) group.push(a);
    else byDeal.set(a.dealId, [a]);
  }

  const due: ScoreActivity[] = [];
  for (const acts of byDeal.values()) {
    for (const a of acts) {
      if (!a.followUpDate) continue;
      if (a.followUpDate >= startDate && a.followUpDate <= endDate) due.push(a);
    }
  }

  if (due.length === 0) {
    return { points: 0, max: params.followupMax, hasSample: false, dueCount: 0, belowFloor: false };
  }

  let onTime = 0;
  for (const a of due) {
    const siblings = byDeal.get(a.dealId) ?? [];
    const kept = siblings.some(
      (b) => b.occurredAt > a.occurredAt && dateInZone(b.occurredAt, tz) <= (a.followUpDate as string),
    );
    if (kept) onTime += 1;
  }

  const rate = onTime / due.length;
  const belowFloor = due.length < params.followupFloor;
  return {
    points: Math.round(rate * params.followupMax),
    max: params.followupMax,
    hasSample: !belowFloor,
    dueCount: due.length,
    belowFloor,
  };
}

// ── Touch Cadence ─────────────────────────────────────────────────────────

interface CadenceResult {
  points: number;
  max: number;
  hasSample: boolean;
}

function computeTouchCadence(
  deals: ScoreDeal[],
  activities: ScoreActivity[],
  ownerId: string,
  windowStart: Date,
  windowEnd: Date,
  params: ScoreParams,
): CadenceResult {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  const byDeal = new Map<string, ScoreActivity[]>();
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
    return { points: 0, max: params.cadenceMax, hasSample: false };
  }

  const med = median(perWeek) as number;
  const ratio = med / params.targetCadence;
  let points: number;
  if (ratio >= 1) points = params.cadenceMax;
  else if (ratio >= 0.5) points = Math.round(15 + (ratio - 0.5) * params.cadenceMax);
  else points = Math.round(ratio * params.cadenceMax);

  return { points, max: params.cadenceMax, hasSample: true };
}

// ── Re-engagement After Silence ────────────────────────────────────────────

interface ReEngagementResult {
  points: number;
  max: number;
  hasSample: boolean;
  rate: number | null;
  silentCount: number;
  reEngagedCount: number;
}

/**
 * Counts one episode per deal: for each deal we dedupe to its most recent
 * qualifying silence onset (see the loop below), so a deal that went silent
 * and recovered more than once in the window still contributes exactly one
 * entry to silentCount/reEngagedCount, not one per episode (addendum 3.8).
 */
function computeReEngagement(
  deals: ScoreDeal[],
  activities: ScoreActivity[],
  ownerId: string,
  now: Date,
  params: ScoreParams,
): ReEngagementResult {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - params.windowDays * DAY_MS;
  const fairnessCutoffMs = nowMs - params.fairnessWindowDays * DAY_MS;
  const silenceMs = params.silenceThresholdDays * DAY_MS;
  const reassignLookbackMs = nowMs - params.windowDays * DAY_MS;

  const activeDeals = deals.filter(
    (d) => d.owner_id === ownerId && d.stage !== "won" && d.stage !== "lost",
  );
  if (activeDeals.length === 0) {
    return { points: 0, max: params.reengagementMax, hasSample: false, rate: null, silentCount: 0, reEngagedCount: 0 };
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
    return { points: params.reengagementMax, max: params.reengagementMax, hasSample: true, rate: null, silentCount: 0, reEngagedCount: 0 };
  }
  const rate = reEngagedCount / silentCount;
  return {
    points: Math.round(rate * params.reengagementMax),
    max: params.reengagementMax,
    hasSample: true,
    rate,
    silentCount,
    reEngagedCount,
  };
}

// ── Composite ──────────────────────────────────────────────────────────────

/**
 * Score a single rep with the same math as the client's
 * computePersistenceIndex, over structural (not app-typed) deal/activity
 * shapes so the nightly snapshot job can call it without an app dependency.
 */
export function scoreRep(
  deals: ScoreDeal[],
  activities: ScoreActivity[],
  ownerId: string,
  now: Date,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
  tz: string | null | undefined = null,
): RepScore {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - params.windowDays * DAY_MS);

  // Only Follow-Up Discipline truncates to calendar days, so it is the only
  // scorer that takes the rep's zone. Cadence + re-engagement compare elapsed
  // milliseconds and are zone-independent.
  const followUp = computeFollowUpDiscipline(deals, activities, ownerId, windowStart, windowEnd, params, tz);
  const cadence = computeTouchCadence(deals, activities, ownerId, windowStart, windowEnd, params);
  const reEngagement = computeReEngagement(deals, activities, ownerId, windowEnd, params);

  const components: { points: number; max: number; hasSample: boolean }[] = [followUp, cadence, reEngagement];

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
    followupPoints: followUp.points,
    followupBelowFloor: followUp.belowFloor,
    followupDueCount: followUp.dueCount,
    cadencePoints: cadence.points,
    reengagementPoints: reEngagement.points,
    reengagementRate: reEngagement.rate,
    dealsWentSilentCount: reEngagement.silentCount,
    dealsReEngagedCount: reEngagement.reEngagedCount,
    formulaVersion: params.formulaVersion,
  };
}
