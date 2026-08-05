/**
 * useFollowUpReminders — overdue + due-today follow-ups, for the TopBar
 * bell badge.
 *
 * SP1: reads open Tasks (the follow-up primitive) rather than deriving from
 * activities, so the bell and the Activities screen share one source of truth
 * and never disagree, including after a snooze (which moves the task's
 * target_at but not the activity's follow_up_date). Only merchant-contact task
 * types appear (is_prospect_touch); internal To-do tasks are excluded from the
 * bell. Deal context (company + contact + won-exclusion) comes from useDeals.
 *
 * "Today" is the rep's LOCAL calendar day; a task's day is read from its
 * target_at (a date). The shared calendarDayDelta keeps the bell and the
 * Activities list agreeing on which day a task belongs to.
 */

import * as React from "react";
import { useTasks } from "./useTasks";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { calendarDayDelta } from "@/lib/calendarDate";
import { isProspectTouch, type TaskType } from "../lib/isProspectTouch";
import type { Task } from "../tasks/taskTypes";
import type { Deal } from "@/features/pipeline/mockData";

export interface FollowUpReminder {
  /** Task id — stable key for the dropdown row. */
  id: string;
  /** Parent deal — for the row's company name + click-to-navigate. */
  deal: Deal;
  /** The task behind this reminder. */
  task: Task;
  /** Task type, drives the row icon. */
  type: TaskType;
  /** ISO of the task's target_at. */
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

/** Whole-day delta (other - reference); positive = future, 0 = due today. */
export function dayDelta(reference: Date, other: Date): number {
  return calendarDayDelta(reference, other);
}

export function useFollowUpReminders(now: Date = new Date()): UseFollowUpRemindersResult {
  const { tasks, isLoading: tasksLoading } = useTasks("open");
  const { data: deals = [], isLoading: dealsLoading } = useDeals();

  return React.useMemo(() => {
    const dealById = new Map(deals.map((d) => [d.id, d]));

    const overdue: FollowUpReminder[] = [];
    const today: FollowUpReminder[] = [];

    for (const t of tasks) {
      if (!isProspectTouch(t.type)) continue; // internal To-do never rings the bell
      if (!t.dealId) continue;
      const deal = dealById.get(t.dealId);
      if (!deal) continue; // orphan — parent deleted
      if (deal.stage === "won") continue; // closed-won; no follow-up needed

      const delta = dayDelta(now, new Date(t.targetAt));
      if (delta > 0) continue; // future — not a reminder yet

      const reminder: FollowUpReminder = {
        id: t.id,
        deal,
        task: t,
        type: t.type,
        dueAt: t.targetAt,
        daysOverdue: delta === 0 ? 0 : -delta,
      };

      if (delta === 0) today.push(reminder);
      else overdue.push(reminder);
    }

    overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    today.sort((a, b) => a.dueAt.localeCompare(b.dueAt));

    return {
      overdue,
      today,
      count: overdue.length + today.length,
      isLoading: tasksLoading || dealsLoading,
    };
  }, [tasks, deals, now, tasksLoading, dealsLoading]);
}
