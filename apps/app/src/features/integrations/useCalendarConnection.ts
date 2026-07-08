/**
 * useCalendarConnection — a rep's calendar connection state + actions for one
 * provider (Google or Microsoft/Outlook).
 *
 * Slice 1 of "Calendar-Aware Path": connect / disconnect / status only. The
 * per-calendar "personal" toggle UI is deferred until the OAuth Edge function
 * (which exposes the user's calendar list) exists — see the TODO in
 * IntegrationsTab.tsx.
 *
 * Data source: the `oauth_connections` table, one row per (rep, provider). We
 * read the row's `status` for the requested provider and fold it into a small
 * UI-facing status:
 *   - "connected"    — row.status === "active"
 *   - "pending"      — row.status === "pending" (OAuth started, not finished)
 *   - "disconnected" — no row, or status revoked/expired/error/anything else
 *
 * The provider defaults to "google" so existing callers (and the query-key /
 * request shape they relied on) are unchanged.
 *
 * connect(): invokes the `calendar_oauth/start` Edge sub-route (authenticated)
 * with `{ provider }`, which returns a signed provider auth URL, then full-page
 * navigates to it.
 *
 * disconnect(): invokes the `calendar_oauth/disconnect` Edge sub-route (service
 * role) with `{ provider }`, which flips the row to "revoked" and best-effort
 * revokes the grant (providers that expose a revoke endpoint), then re-reads.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type CalendarConnectionStatus = "connected" | "pending" | "disconnected";

/** The calendar providers a rep can connect. */
export type CalendarProviderId = "google" | "microsoft";

/** Build the TanStack Query key for a provider's calendar connection row. */
export function calendarConnectionKey(provider: CalendarProviderId) {
  return ["integrations", "calendar", provider] as const;
}

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
  /** Fetch a signed provider auth URL and navigate to it. */
  connect: () => void;
  /** Revoke the connection via the Edge function, then re-read. */
  disconnect: () => void;
  isDisconnecting: boolean;
}

export function useCalendarConnection(
  provider: CalendarProviderId = "google",
): UseCalendarConnectionResult {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  const connectionKey = calendarConnectionKey(provider);

  const query = useQuery({
    queryKey: [...connectionKey, userId],
    enabled: !!userId,
    queryFn: async (): Promise<CalendarConnectionStatus> => {
      // Scope to the current user's row explicitly. The oauth_connections SELECT
      // RLS policy lets managers/admins see every org connection, so filtering
      // only on provider would return multiple rows for those roles and
      // maybeSingle() would throw (or pick an arbitrary rep's row — a privacy
      // leak once real tokens exist). eq("user_id", …) guarantees one row.
      const { data, error } = await supabase
        .from("oauth_connections")
        .select("status")
        .eq("provider", provider)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return toStatus(data?.status);
    },
  });

  const disconnectMutation = useMutation({
    // Routed through the calendar_oauth Edge function (service role): the client
    // can't write oauth_connections directly (SELECT-only RLS). The function
    // flips status to revoked and best-effort revokes the grant with the
    // provider.
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.functions.invoke("calendar_oauth/disconnect", {
        body: { provider },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKey });
    },
  });

  const connectMutation = useMutation({
    // Authenticated invoke to the `start` sub-route returns a signed provider
    // auth URL; a full-page navigation hands off to the provider, which
    // redirects back to the app via the callback sub-route.
    mutationFn: async (): Promise<void> => {
      const { data, error } = await supabase.functions.invoke<{ authUrl: string }>(
        "calendar_oauth/start",
        { body: { provider } },
      );
      if (error || !data?.authUrl) throw error ?? new Error("no authUrl returned");
      window.location.assign(data.authUrl);
    },
  });

  return {
    status: query.data ?? "disconnected",
    isLoading: query.isLoading,
    connect: () => connectMutation.mutate(),
    disconnect: () => disconnectMutation.mutate(),
    isDisconnecting: disconnectMutation.isPending,
  };
}
