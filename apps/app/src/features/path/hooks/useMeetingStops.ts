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
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useCalendarEvents, type CalendarStatus } from "./useCalendarEvents";
import { rowToAppointment, type ScheduledAppointmentRow } from "@/features/appointments/types";
import {
  assembleMeetingStops,
  type MeetingStop,
  type MeetingStopAppointment,
} from "../lib/meetingStops";

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

  // Slice 5A concern #2: appointment rows carry `dealId` but no deal name. Reuse
  // the deals the app already caches (useDeals, same react-query cache the
  // pipeline populates) to look the name up rather than adding a join query.
  const deals = useDeals();
  const dealNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deals.data ?? []) map.set(d.id, d.companyName);
    return map;
  }, [deals.data]);

  // Enrich appointments with their deal name before assembling. External
  // waypoints keep `dealName: null` (they have no navigatr deal).
  const appointments = useMemo<MeetingStopAppointment[]>(
    () =>
      (appts.data ?? []).map((a) => ({
        ...a,
        dealName: a.dealId ? dealNameById.get(a.dealId) ?? null : null,
      })),
    [appts.data, dealNameById],
  );

  // NOTE (Slice 5A concern #1 / de-dup): assembleMeetingStops already drops a
  // mirrored external waypoint when an appointment carries `calendarEventId`.
  // An appointment whose calendar sync is still pending has no `calendarEventId`
  // yet, so its mirror could theoretically appear twice until sync lands.
  // Slice 5C / monitoring may refine this; we do not add speculative hiding here.
  const stops = useMemo(
    () => assembleMeetingStops(appointments, calendar.waypoints, nowIso),
    [appointments, calendar.waypoints, nowIso],
  );

  return {
    stops,
    status: calendar.status,
    isLoading: (appts.isLoading && appts.fetchStatus !== "idle") || calendar.isLoading,
  };
}
