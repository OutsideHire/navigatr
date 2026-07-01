/**
 * usePathReminders — planned paths that are DUE, for the TopBar bell badge (SP3).
 *
 * A derived view over the existing usePaths cache (no new network), mirroring
 * useFollowUpReminders. A planned path is "due" when:
 *   - it has a reminder_at that is <= now, OR
 *   - it has no reminder_at but its path_date is today (local calendar day),
 * and it is not completed.
 *
 * "now" (and today) are bucketed against the user's local clock so the bell flips
 * to a new day at wall-clock midnight, not UTC.
 */

import * as React from "react";
import { usePaths } from "./usePaths";
import type { Path } from "../lib/pathTypes";

export interface PathReminder {
  /** Path id — stable key + click-to-navigate target. */
  id: string;
  path: Path;
  /** Display name (falls back to the origin label, then a generic). */
  name: string;
  /** The path's calendar day (yyyy-mm-dd). */
  date: string;
  /** ISO reminder timestamp, or null when the path is due purely by its date. */
  reminderAt: string | null;
}

export interface UsePathRemindersResult {
  /** Planned paths that are due now (reminder elapsed or scheduled for today). */
  due: PathReminder[];
  /** Badge contribution = due.length. */
  count: number;
  isLoading: boolean;
}

/** Local yyyy-mm-dd for a Date (matches lib/today.todayISO). */
function localDateISO(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function usePathReminders(now: Date = new Date()): UsePathRemindersResult {
  const { data: paths = [], isLoading } = usePaths();

  return React.useMemo(() => {
    const todayIso = localDateISO(now);
    const nowMs = now.getTime();

    const due: PathReminder[] = [];
    for (const p of paths) {
      if (p.status === "completed") continue;

      let isDue = false;
      if (p.reminderAt) {
        const t = new Date(p.reminderAt).getTime();
        isDue = !Number.isNaN(t) && t <= nowMs;
      } else {
        // No reminder set → due on its scheduled day.
        isDue = p.date === todayIso;
      }
      if (!isDue) continue;

      due.push({
        id: p.id,
        path: p,
        name: p.name ?? p.originLabel ?? "Planned path",
        date: p.date,
        reminderAt: p.reminderAt,
      });
    }

    // Soonest reminder / earliest date first.
    due.sort((a, b) => {
      const av = a.reminderAt ?? `${a.date}T00:00:00.000Z`;
      const bv = b.reminderAt ?? `${b.date}T00:00:00.000Z`;
      return av.localeCompare(bv);
    });

    return { due, count: due.length, isLoading };
  }, [paths, now, isLoading]);
}
