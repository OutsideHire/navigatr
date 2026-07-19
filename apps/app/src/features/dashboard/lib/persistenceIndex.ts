/**
 * Persistence Index metric engine (beta).
 *
 * Rewards reps who keep working an account rather than dropping it after a
 * single touch. Two components ship in this slice, both scaled 0..max and
 * summed into a composite out of 100 over only the components that have a
 * sample; a third (response velocity) is a placeholder for a later slice.
 */

import type { Deal } from "@/features/pipeline/mockData";
import type { Activity } from "@/features/activities/mockData";
import { median } from "./activityToWin";

export const TARGET_CADENCE = 3.5;
export const TARGET_SCORE = 75;
export const WINDOW_DAYS = 30;
export const FOLLOWUP_MAX = 40;
export const CADENCE_MAX = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

// ── Follow-Up Discipline ─────────────────────────────────────────────────

export interface FollowUpResult {
  points: number;
  max: number;
  hasSample: boolean;
  completionRate: number | null;
  dueCount: number;
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
    return { points: 0, max: FOLLOWUP_MAX, hasSample: false, completionRate: null, dueCount: 0 };
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
  return {
    points: Math.round(rate * FOLLOWUP_MAX),
    max: FOLLOWUP_MAX,
    hasSample: true,
    completionRate: rate,
    dueCount: due.length,
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

// ── Composite ──────────────────────────────────────────────────────────────

export interface PersistenceOptions {
  ownerId: string;
  now: Date;
  windowDays?: number;
}

export interface PersistenceIndexResult {
  composite: number | null;
  followUp: FollowUpResult;
  cadence: CadenceResult;
  responseVelocity: { comingSoon: true };
  windowDays: number;
  targetScore: number;
}

/**
 * The blended Persistence Index: a 0-100 composite scaled over whichever
 * sub-components have a sample in the trailing window (response velocity is
 * a placeholder for a later slice and never contributes points). Null when
 * no component has enough data to score.
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

  let availPoints = 0;
  let availMax = 0;
  if (followUp.hasSample) {
    availPoints += followUp.points;
    availMax += followUp.max;
  }
  if (cadence.hasSample) {
    availPoints += cadence.points;
    availMax += cadence.max;
  }

  return {
    composite: availMax > 0 ? Math.round((availPoints / availMax) * 100) : null,
    followUp,
    cadence,
    responseVelocity: { comingSoon: true },
    windowDays,
    targetScore: TARGET_SCORE,
  };
}
