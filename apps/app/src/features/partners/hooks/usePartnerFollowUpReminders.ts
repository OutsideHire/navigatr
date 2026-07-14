/**
 * usePartnerFollowUpReminders — overdue + due-today partner cadence
 * follow-ups, for the TopBar bell. Derived over the partners cache (no new
 * network), mirroring useFollowUpReminders. A reminder is a partner whose
 * cadence-derived due date is today-or-earlier.
 */

import * as React from "react";
import { usePartners } from "./usePartners";
import { computeCadenceStatus } from "../partnerCadence";
import type { Partner } from "../mockData";

export interface PartnerFollowUpReminder {
  /** Partner id — stable key + navigate target. */
  id: string;
  partner: Partner;
  /** ISO of the cadence due date. */
  dueAt: string;
  /** 0 = due today, >0 = days overdue. */
  daysOverdue: number;
}

export interface UsePartnerFollowUpRemindersResult {
  overdue: PartnerFollowUpReminder[];
  today: PartnerFollowUpReminder[];
  count: number;
  isLoading: boolean;
}

export function usePartnerFollowUpReminders(
  now: Date = new Date(),
): UsePartnerFollowUpRemindersResult {
  const { data: partners = [], isLoading } = usePartners();

  return React.useMemo(() => {
    const overdue: PartnerFollowUpReminder[] = [];
    const today: PartnerFollowUpReminder[] = [];

    for (const p of partners) {
      const s = computeCadenceStatus(
        { followupCadenceDays: p.followupCadenceDays, lastTouch: p.lastTouch, createdAt: p.createdAt },
        now,
      );
      if (!s.dueAt) continue;
      if (s.state === "overdue") {
        overdue.push({ id: p.id, partner: p, dueAt: s.dueAt, daysOverdue: s.daysOverdue });
      } else if (s.state === "due-today") {
        today.push({ id: p.id, partner: p, dueAt: s.dueAt, daysOverdue: 0 });
      }
    }

    overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt)); // oldest-due first
    today.sort((a, b) => a.partner.name.localeCompare(b.partner.name));

    return { overdue, today, count: overdue.length + today.length, isLoading };
  }, [partners, now, isLoading]);
}
