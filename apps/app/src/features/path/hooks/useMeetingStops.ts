/**
 * useMeetingStops (Slice 5A), the day's meetings as time-ordered stops for the
 * Path Stops view. Thin composer: it fetches the rep's scheduled appointments
 * for `pathDate` and the external calendar waypoints for the same day, then
 * derives the normalized list via the pure `assembleMeetingStops`.
 *
 * No new query: both sources already have hooks. This hook only reads today's
 * appointments (scoped to the current rep by RLS) and the calendar waypoints,
 * and joins them in memory. Status mirrors the calendar read (the source that
 * can degrade to a reconnect nudge); appointments are a plain table read.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useCalendarEvents, type CalendarStatus } from "./useCalendarEvents";
import { rowToAppointment, type ScheduledAppointmentRow } from "@/features/appointments/types";
import { assembleMeetingStops, type MeetingStop } from "../lib/meetingStops";

export const MEETING_STOPS_APPTS_KEY = (userId: string | undefined, pathDate: string) =>
  ["path", "meeting-stops", "appointments", userId ?? "anon", pathDate] as const;

/** UTC ISO bounds of the local calendar day named by `pathDate` (YYYY-MM-DD).
 *  Mirrors useOwedVisits: `new Date("YYYY-MM-DDT00:00:00")` parses in local time,
 *  so this brackets the rep's day regardless of timezone. */
function localDayBounds(pathDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${pathDate}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export interface UseMeetingStopsResult {
  stops: MeetingStop[];
  status: CalendarStatus;
  isLoading: boolean;
}

/**
 * @param pathDate  the local calendar day (YYYY-MM-DD) to assemble stops for.
 * @param nowIso    "now" for the past/upcoming split. Defaults to the current
 *                  time; passed through so callers/tests can pin it.
 */
export function useMeetingStops(
  pathDate: string,
  nowIso: string = new Date().toISOString(),
): UseMeetingStopsResult {
  const userId = useAuth((s) => s.user?.id);
  const { startIso, endIso } = localDayBounds(pathDate);

  // Non-cancelled appointments that START within the rep's local day.
  const appts = useQuery({
    queryKey: MEETING_STOPS_APPTS_KEY(userId, pathDate),
    enabled: Boolean(userId) && Boolean(pathDate),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_appointments")
        .select("*")
        .neq("status", "cancelled")
        .gte("start_at", startIso)
        .lt("start_at", endIso)
        .order("start_at", { ascending: true });
      if (error) throw error;
      return ((data as ScheduledAppointmentRow[] | null) ?? []).map(rowToAppointment);
    },
  });

  // External located meetings for the same window, from the calendar read.
  const calendar = useCalendarEvents(pathDate ? { start: startIso, end: endIso } : null);

  const stops = useMemo(
    () => assembleMeetingStops(appts.data ?? [], calendar.waypoints, nowIso),
    [appts.data, calendar.waypoints, nowIso],
  );

  return {
    stops,
    status: calendar.status,
    isLoading: (appts.isLoading && appts.fetchStatus !== "idle") || calendar.isLoading,
  };
}
