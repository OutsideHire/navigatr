/**
 * useCalendarConnection — the rep's Google Calendar connection state + actions.
 *
 * Slice 1 of "Calendar-Aware Path": connect / disconnect / status only. The
 * per-calendar "personal" toggle UI is deferred until the OAuth Edge function
 * (which exposes the user's calendar list) exists — see the TODO in
 * IntegrationsTab.tsx.
 *
 * Data source: the `oauth_connections` table, one row per (rep, provider). We
 * read the Google row's `status` and fold it into a small UI-facing status:
 *   - "connected"    — row.status === "active"
 *   - "pending"      — row.status === "pending" (OAuth started, not finished)
 *   - "disconnected" — no row, or status revoked/expired/error/anything else
 *
 * connect(): full-page navigate to the OAuth start endpoint on the Supabase
 * Edge Functions host. The endpoint (`calendar_oauth?action=start`) doesn't
 * exist yet — building it is the follow-up OAuth task — so this won't complete
 * the round-trip today. That's expected for Slice 1.
 *
 * disconnect(): flips the row to "revoked" and re-reads. Actual token
 * revocation with Google happens in the OAuth function later.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CalendarConnectionStatus = "connected" | "pending" | "disconnected";

/** TanStack Query key for the Google calendar connection row. */
export const CALENDAR_CONNECTION_KEY = ["integrations", "calendar", "google"] as const;

const PROVIDER = "google";

/**
 * Base URL for Supabase Edge Functions. The app derives its Supabase project
 * URL from `VITE_SUPABASE_URL` (see src/lib/supabase.ts); Edge Functions live
 * under `<project-url>/functions/v1`. We fall back to the same localhost value
 * lib/supabase.ts uses so unit tests / envless dev don't produce `undefined/`.
 */
export const SUPABASE_FUNCTIONS_URL = `${
  import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321"
}/functions/v1`;

/** Fold the raw row status into the UI-facing status. */
function toStatus(rowStatus: string | null | undefined): CalendarConnectionStatus {
  if (rowStatus === "active") return "connected";
  if (rowStatus === "pending") return "pending";
  // No row, revoked, expired, error, or any unknown value → not connected.
  return "disconnected";
}

export interface UseCalendarConnectionResult {
  status: CalendarConnectionStatus;
  isLoading: boolean;
  /** Full-page navigate to the OAuth start endpoint. */
  connect: () => void;
  /** Flip the connection to revoked, then re-read. */
  disconnect: () => void;
  isDisconnecting: boolean;
}

export function useCalendarConnection(): UseCalendarConnectionResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CALENDAR_CONNECTION_KEY,
    queryFn: async (): Promise<CalendarConnectionStatus> => {
      const { data, error } = await supabase
        .from("oauth_connections")
        .select("status")
        .eq("provider", PROVIDER)
        .maybeSingle();
      if (error) throw error;
      return toStatus(data?.status);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      // TODO(calendar-oauth-task): also revoke the Google token via the OAuth
      // Edge function so the grant is torn down upstream, not just locally.
      const { error } = await supabase
        .from("oauth_connections")
        .update({ status: "revoked" })
        .eq("provider", PROVIDER);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CALENDAR_CONNECTION_KEY });
    },
  });

  const connect = () => {
    const url = `${SUPABASE_FUNCTIONS_URL}/calendar_oauth?action=start`;
    // Full-page navigation hands off to the OAuth flow (redirects to Google,
    // then back to the app). This endpoint is built in the follow-up task.
    window.location.assign(url);
  };

  return {
    status: query.data ?? "disconnected",
    isLoading: query.isLoading,
    connect,
    disconnect: () => disconnectMutation.mutate(),
    isDisconnecting: disconnectMutation.isPending,
  };
}
