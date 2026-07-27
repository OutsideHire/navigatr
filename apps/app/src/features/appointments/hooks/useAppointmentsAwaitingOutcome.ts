/**
 * useAppointmentsAwaitingOutcome: the rep's own scheduled appointments whose
 * end time has passed with no outcome recorded (W2c nudge source). Mirrors
 * useUnloggedDials as the pattern: fetch the rep's own rows, run the pure
 * matcher (computeAwaitingOutcome), then join deal company names from
 * useDeals.
 *
 * scheduled_appointments RLS is org-wide for managers/admins (not rep-scoped
 * like coverage_signal), so the owner_id filter below is load-bearing: it
 * keeps this "my own" nudge from also pulling in appointments the viewer can
 * merely see because they manage the org.
 *
 * Filtering to status='scheduled' at the query level (rather than fetching
 * every status and filtering client-side) does double duty: it matches the
 * scheduled_appointments_awaiting_idx partial index, and it's exactly the
 * row set computeAwaitingOutcome needs plus the future-appointment check
 * below (a future appointment is always still 'scheduled').
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { computeAwaitingOutcome, type AppointmentForOutcomeCheck } from "../lib/awaitingOutcome";

type AppointmentRow = AppointmentForOutcomeCheck;

export interface AppointmentAwaitingOutcomeView {
  id: string;
  dealId: string;
  companyName: string;
  title: string;
  startAt: string;
  endAt: string;
  /** Whether this deal already has another scheduled appointment booked for
   *  the future, passed straight through to AppointmentOutcomeSheet. */
  hasFutureAppointment: boolean;
}

export const APPOINTMENTS_AWAITING_OUTCOME_QUERY_KEY = (userId: string | undefined) =>
  ["appointments", "awaiting-outcome", userId ?? "anon"] as const;

export function useAppointmentsAwaitingOutcome() {
  const userId = useAuth((s) => s.user?.id);
  const deals = useDeals();

  return useQuery({
    queryKey: APPOINTMENTS_AWAITING_OUTCOME_QUERY_KEY(userId),
    // Gate on deals being loaded too: the company-name join reads deals.data,
    // same rationale as useUnloggedDials.
    enabled: Boolean(userId) && deals.isSuccess,
    queryFn: async (): Promise<AppointmentAwaitingOutcomeView[]> => {
      const { data, error } = await supabase
        .from("scheduled_appointments")
        .select("id, deal_id, title, start_at, end_at, status, outcome")
        .eq("owner_id", userId)
        .eq("status", "scheduled")
        .order("end_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as AppointmentRow[];
      if (rows.length === 0) return [];

      const now = new Date();
      const nowMs = now.getTime();
      const awaiting = computeAwaitingOutcome(rows, now);
      if (awaiting.length === 0) return [];

      const nameOf = new Map((deals.data ?? []).map((d) => [d.id, d.companyName]));

      return awaiting.map((a) => ({
        id: a.id,
        dealId: a.deal_id,
        companyName: nameOf.get(a.deal_id) ?? "Unknown deal",
        title: a.title,
        startAt: a.start_at,
        endAt: a.end_at,
        hasFutureAppointment: rows.some(
          (r) => r.deal_id === a.deal_id && r.id !== a.id && new Date(r.start_at).getTime() > nowMs,
        ),
      }));
    },
    staleTime: 30_000,
  });
}
