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
