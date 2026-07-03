/**
 * useCalendarEvents — Calendar-Aware Path (Slice 1) data source.
 *
 * Calls the `read_calendar_events` Edge Function for a given time window and
 * returns the calendar-derived waypoints (mappable appointments) and time
 * blocks (unmappable events that still consume the rep's day) the Create-a-Path
 * wizard overlays onto a route.
 *
 * NON-BLOCKING BY DESIGN: a calendar failure (not connected, expired token,
 * network error, empty response) must never break Path. On any error we return
 * `status: "needs_reconnect"` with empty arrays so the wizard can render a
 * gentle "reconnect calendar" nudge and carry on planning the route without it.
 *
 * Mirrors the useMerchants hook: same TanStack Query style, the same
 * `supabase.functions.invoke<...>(name, { body })` call, and the same
 * gate-until-input `enabled` pattern (no fetch until a window is set).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** A mappable calendar appointment — has a real location we can route to. */
export interface CalendarWaypoint {
  id: string;
  title: string;
  start: string;
  end: string;
  address: string;
  lat: number;
  lng: number;
  source: "calendar";
}

/** A calendar event that consumes time but can't be mapped (no/unmappable
 *  location) — shown as a time block so the day's capacity stays honest. */
export interface CalendarTimeBlock {
  id: string;
  title: string;
  start: string;
  end: string;
  reason: "no_location" | "unmappable";
}

/** Connection state for the rep's calendar, surfaced so the wizard can decide
 *  whether to prompt a (re)connect. */
export type CalendarStatus = "ok" | "not_connected" | "needs_reconnect";

/** Raw shape returned by the read_calendar_events Edge Function. */
interface ReadCalendarResponse {
  status: CalendarStatus;
  waypoints: CalendarWaypoint[];
  timeBlocks: CalendarTimeBlock[];
  skippedCount: number;
}

/** What queryFn resolves to — the subset the UI cares about. */
interface CalendarResult {
  status: CalendarStatus;
  waypoints: CalendarWaypoint[];
  timeBlocks: CalendarTimeBlock[];
}

export interface UseCalendarEventsResult {
  waypoints: CalendarWaypoint[];
  timeBlocks: CalendarTimeBlock[];
  status: CalendarStatus;
  isLoading: boolean;
  isError: boolean;
  /** Re-pull (for a future manual "Refresh calendar" button). */
  refetch: () => void;
}

/**
 * @param window  the {start,end} ISO range to read, or null before the wizard
 *                has picked a day. When null the query is disabled — no fetch,
 *                empty arrays, `status: "not_connected"`.
 */
export function useCalendarEvents(
  window: { start: string; end: string } | null,
): UseCalendarEventsResult {
  const query = useQuery({
    queryKey: ["path", "calendar", window?.start ?? null, window?.end ?? null],
    enabled: !!window?.start && !!window?.end,
    staleTime: 60_000,
    queryFn: async (): Promise<CalendarResult> => {
      const { data, error } =
        await supabase.functions.invoke<ReadCalendarResponse>(
          "read_calendar_events",
          { body: { window_start: window!.start, window_end: window!.end } },
        );
      // Non-blocking: any failure or missing payload degrades to a reconnect
      // nudge, never a thrown error that would break Path.
      if (error || !data) {
        return { status: "needs_reconnect", waypoints: [], timeBlocks: [] };
      }
      return {
        status: data.status,
        waypoints: data.waypoints,
        timeBlocks: data.timeBlocks,
      };
    },
  });

  return {
    waypoints: query.data?.waypoints ?? [],
    timeBlocks: query.data?.timeBlocks ?? [],
    status: query.data?.status ?? "not_connected",
    isLoading: query.isLoading && query.fetchStatus !== "idle",
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
