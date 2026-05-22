/**
 * useFollowUpReminders — overdue + due-today follow-ups, for the TopBar
 * bell badge.
 *
 * Derived view over the existing caches: composes useActivitiesForOrg +
 * useDeals so we never refetch. A "reminder" is an activity whose
 * follow_up_date is today-or-earlier and whose parent deal is still
 * open (stage !== 'won').
 *
 * Why not just read `deals.next_followup_at`?
 *  - `deals.next_followup_at` is the *most recent* scheduled follow-up
 *    only. If a rep had two open follow-ups on the same deal (rare but
 *    possible), the older one would vanish. Pulling straight from
 *    activities is the source of truth.
 *  - `next_followup_at` is also overwritten by `expectedClose` edits in
 *    AddDealSheet, which conflates "expected close date" with "next
 *    scheduled touch." Activities are unambiguous.
 *
 * Today is bucketed against the user's local midnight so the bell flips
 * to a new day at the user's wall clock, not UTC midnight.
 */

import * as React from "react";
import { useActivitiesForOrg } from "./useActivities";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

export interface FollowUpReminder {
  /** Activity id — stable key for the dropdown row. */
  id: string;
  /** Parent deal — for the row's company name + click-to-navigate. */
  deal: Deal;
  activity: Activity;
  /** ISO of the follow_up_date, local-midnight-floored. */
  dueAt: string;
  /** Negative = overdue, 0 = today, positive = future (filtered out). */
  daysOverdue: number;
}

export interface UseFollowUpRemindersResult {
  /** Overdue (due before today). */
  overdue: FollowUpReminder[];
  /** Due today. */
  today: FollowUpReminder[];
  /** Total badge count = overdue.length + today.length. */
  count: number;
  isLoading: boolean;
}

/** Local-midnight floor as ISO. "2026-05-22T00:00:00.000Z"-style string
 *  comparison only works once both sides have been floored. */
function localMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole-day delta: (other - reference). Positive = future. */
export function dayDelta(reference: Date, other: Date): number {
  const ms = localMidnight(other).getTime() - localMidnight(reference).getTime();
  return Math.round(ms / 86_400_000);
}

export function useFollowUpReminders(now: Date = new Date()): UseFollowUpRemindersResult {
  const { data: activities = [], isLoading: actLoading } = useActivitiesForOrg();
  const { data: deals = [], isLoading: dealsLoading } = useDeals();

  return React.useMemo(() => {
    const dealById = new Map(deals.map((d) => [d.id, d]));

    const overdue: FollowUpReminder[] = [];
    const today: FollowUpReminder[] = [];

    for (const a of activities) {
      if (!a.followUpDate) continue;
      const deal = dealById.get(a.dealId);
      if (!deal) continue; // orphan — parent deleted
      if (deal.stage === "won") continue; // closed-won; no follow-up needed

      const delta = dayDelta(now, new Date(a.followUpDate));
      if (delta > 0) continue; // future — not a reminder yet

      const reminder: FollowUpReminder = {
        id: a.id,
        deal,
        activity: a,
        dueAt: a.followUpDate,
        daysOverdue: delta === 0 ? 0 : -delta, // delta is negative or zero; flip sign for "days overdue". Avoid -0.
      };

      if (delta === 0) today.push(reminder);
      else overdue.push(reminder);
    }

    // Sort: overdue oldest-first (most behind = most urgent), today by dueAt asc.
    overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    today.sort((a, b) => a.dueAt.localeCompare(b.dueAt));

    return {
      overdue,
      today,
      count: overdue.length + today.length,
      isLoading: actLoading || dealsLoading,
    };
  }, [activities, deals, now, actLoading, dealsLoading]);
}
