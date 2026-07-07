/**
 * useAppointments — data hooks for the `scheduled_appointments` table.
 *
 * "Two-way calendar sync — Milestone 1: Appointments end-to-end." These are the
 * TanStack Query hooks the booking UI consumes. The actual Google push lives in
 * the `sync_appointment` Edge function (service role); these hooks just
 * insert/update the row and then *invoke* that function to kick off the push.
 *
 * Sync is fire-and-forget by design: the row is persisted with
 * calendar_sync_status='pending' (a DB default), so a failing invoke must NOT
 * fail the mutation — the UI shows "pending" and offers a retry. The Edge
 * function flips the row to 'synced'/'error' and the next refetch reflects it.
 *
 * org_id is sourced from the user's profile (useProfile().data.org_id), exactly
 * like the deal-create path (useCreateDeal); owner_id is the auth user id. The
 * insert RLS with-check ALSO enforces owner_id = auth.uid(), and the DB fills
 * status='scheduled' + calendar_sync_status='pending' — so we deliberately do
 * NOT set those columns here and let the defaults apply.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import {
  rowToAppointment,
  type ScheduledAppointment,
  type ScheduledAppointmentRow,
} from "./types";

/** TanStack Query key for a deal's non-cancelled appointments. */
export const dealAppointmentsKey = (dealId: string) =>
  ["appointments", "deal", dealId] as const;

/** Name of the Edge function that pushes/removes the event on Google Calendar. */
const SYNC_FUNCTION = "sync_appointment";

/**
 * List a deal's upcoming/active appointments (status <> 'cancelled'), ordered
 * by start time. RLS scopes rows to the owner (or managers/admins in-org), so
 * no owner filter is needed here.
 */
export function useDealAppointments(dealId: string) {
  return useQuery({
    queryKey: dealAppointmentsKey(dealId),
    enabled: !!dealId,
    queryFn: async (): Promise<ScheduledAppointment[]> => {
      const { data, error } = await supabase
        .from("scheduled_appointments")
        .select("*")
        .eq("deal_id", dealId)
        .neq("status", "cancelled")
        .order("start_at", { ascending: true });
      if (error) throw error;
      return ((data as ScheduledAppointmentRow[] | null) ?? []).map(rowToAppointment);
    },
  });
}

export interface ScheduleAppointmentInput {
  dealId: string;
  title: string;
  startAt: string; // ISO timestamp
  endAt: string; // ISO timestamp
  locationAddress?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  notes?: string | null;
}

/**
 * Book an appointment: insert the row (DB defaults status='scheduled',
 * calendar_sync_status='pending'), then best-effort invoke the sync function to
 * push it to Google. A failing invoke is swallowed — the row is saved as
 * 'pending' and the UI reflects sync status on refetch.
 */
export function useScheduleAppointment() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: ScheduleAppointmentInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) {
        throw new Error("Profile not loaded — cannot schedule appointment");
      }

      const { data, error } = await supabase
        .from("scheduled_appointments")
        .insert({
          owner_id: userId,
          org_id: profile.data.org_id,
          deal_id: input.dealId,
          title: input.title,
          start_at: input.startAt,
          end_at: input.endAt,
          location_address: input.locationAddress ?? null,
          location_lat: input.locationLat ?? null,
          location_lng: input.locationLng ?? null,
          notes: input.notes ?? null,
          // status + calendar_sync_status intentionally omitted — DB defaults.
        })
        .select("id")
        .single();
      if (error) throw error;

      const id = data.id as string;
      // Fire-and-forget push. The row is already saved as 'pending'; a failed
      // invoke (function down, network) must not fail the mutation.
      await invokeSyncQuietly(id, "upsert");
      return { id };
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: dealAppointmentsKey(input.dealId) });
    },
  });
}

/**
 * Cancel an appointment: flip status to 'cancelled', then best-effort invoke
 * the sync function to remove the Google event. dealId is accepted so we can
 * invalidate the right list query.
 */
export function useCancelAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }): Promise<void> => {
      const { error } = await supabase
        .from("scheduled_appointments")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;

      await invokeSyncQuietly(id, "delete");
    },
    onSuccess: (_result, { dealId }) => {
      void queryClient.invalidateQueries({ queryKey: dealAppointmentsKey(dealId) });
    },
  });
}

/**
 * Retry a failed sync: re-invoke the sync function's upsert for a row that's
 * already persisted, then refetch so the row's calendar_sync_status updates.
 */
export function useRetryAppointmentSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }): Promise<void> => {
      await invokeSyncQuietly(id, "upsert");
    },
    onSuccess: (_result, { dealId }) => {
      void queryClient.invalidateQueries({ queryKey: dealAppointmentsKey(dealId) });
    },
  });
}

/**
 * Invoke the sync Edge function without letting its failure propagate. Both the
 * returned `{ error }` and a thrown/rejected invoke are swallowed: the row is
 * already persisted, so sync state is reconciled on the next refetch (or a
 * manual retry) rather than by failing the user's action.
 */
async function invokeSyncQuietly(
  appointmentId: string,
  action: "upsert" | "delete",
): Promise<void> {
  try {
    await supabase.functions.invoke(SYNC_FUNCTION, {
      body: { appointment_id: appointmentId, action },
    });
  } catch {
    // Swallow — pending/error state is reconciled on refetch.
  }
}
