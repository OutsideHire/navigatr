/**
 * useFollowUpReminders — overdue + due-today follow-ups, for the TopBar
 * bell badge.
 *
 * Derived view over the existing caches: composes useActivitiesForOrg +
 * useDeals so we never refetch. A "reminder" is an activity whose
 * follow_up_date is today-or-earlier and whose parent deal is still
 * open (stage !== 'won').
 *
 * A follow-up is dropped once a *later* activity is logged on the same
 * deal (see followUpSupersession): the most recent touch owns the deal's
 * next follow-up, so logging an outcome clears the overdue reminder.
 *
 * Why derive from activities instead of reading `deals.next_followup_at`?
 *  - `next_followup_at` is overwritten by `expectedClose` edits in
 *    AddDealSheet, which conflates "expected close date" with "next
 *    scheduled touch." Activities are unambiguous.
 *  - Deriving here keeps the bell and the Activities list on the exact
 *    same supersession rule, so their counts never disagree.
 *
 * "Today" is the rep's LOCAL calendar day, so the bell flips at the rep's
 * wall clock; a follow-up's day is read from its stored value's UTC calendar
 * day (the intended date). See lib/calendarDate — the Activities list uses the
 * same comparison so the bell and the list never disagree.
 */

import * as React from "react";
import { useActivitiesForOrg } from "./useActivities";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { calendarDayDelta } from "@/lib/calendarDate";
import { latestOccurredAtByDeal, isFollowUpSuperseded } from "../lib/followUpSupersession";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

export interface FollowUpReminder {
  /** Activity id — stable key for the dropdown row. */
  id: string;
  /** Parent deal — for the row's company name + click-to-navigate. */
  deal: Deal;
  activity: Activity;
  /** ISO of the follow_up_date (noon-UTC of its calendar day). */
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

/**
 * Whole-day delta: (other - reference). Positive = future, 0 = due today.
 *
 * `reference` is "now" (its LOCAL day is today); `other` is a follow-up date
 * stored as a noon/midnight-UTC instant (its UTC day is the intended date).
 * Delegates to the shared calendar-day comparison so this bell and the
 * Activities list agree on which day a task belongs to. The old version
 * floored BOTH sides to LOCAL midnight, which read a stored date a day early
 * for reps west of UTC ("due today" when it was really tomorrow).
 */
export function dayDelta(reference: Date, other: Date): number {
  return calendarDayDelta(reference, other);
}

export function useFollowUpReminders(now: Date = new Date()): UseFollowUpRemindersResult {
  const { data: activities = [], isLoading: actLoading } = useActivitiesForOrg();
  const { data: deals = [], isLoading: dealsLoading } = useDeals();

  return React.useMemo(() => {
    const dealById = new Map(deals.map((d) => [d.id, d]));
    const latestByDeal = latestOccurredAtByDeal(activities);

    const overdue: FollowUpReminder[] = [];
    const today: FollowUpReminder[] = [];

    for (const a of activities) {
      if (!a.followUpDate) continue;
      const deal = dealById.get(a.dealId);
      if (!deal) continue; // orphan — parent deleted
      if (deal.stage === "won") continue; // closed-won; no follow-up needed
      if (isFollowUpSuperseded(a, latestByDeal)) continue; // newer touch handled it

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
