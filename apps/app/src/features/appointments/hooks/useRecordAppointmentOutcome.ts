/**
 * useRecordAppointmentOutcome, capture the outcome of a past-due scheduled
 * appointment (addendum 3.3.B.12 2.8, task W2b-2).
 *
 * Recording an outcome does four things, in order. The order matters: the
 * two idempotent writes (steps 1-2) run first, and the non-idempotent
 * activity insert (step 3) runs last, so a retry after a step 1 or 2 failure
 * never double-logs the touch. Re-running steps 1-2 with the same values is
 * a no-op; re-running step 3 would insert a second appointment activity and
 * inflate touch counts that feed the Persistence Index and activity reports.
 *   1. Marks the scheduled_appointments row completed with the outcome,
 *      note, and timestamp. Idempotent.
 *   2. For the two outcomes in APPOINTMENT_STAGE_EFFECT (verbal commitment to
 *      proposal, application signed to submitted), or "not interested" plus
 *      doNotContact to lost, advances the deal's stage via useUpdateDeal.
 *      Idempotent (setting the same stage again is a no-op). Only ever
 *      forward-advances into proposal/submitted/lost, never won.
 *   3. Logs an `appointment` activity (the touch + any auto-scheduled
 *      follow-up) via the existing useLogActivity hook, composed rather than
 *      duplicated so the insert shape, org/owner derivation, and cache
 *      invalidation for the activities feed stay in one place. NOT
 *      idempotent, so it runs last: if steps 1-2 failed, we never reach
 *      this insert, and a retry re-runs 1-2 as no-ops then inserts exactly
 *      one activity.
 *   4. Fire-and-forget reconciles the deal's follow-up calendar event
 *      (mirrors invokeSyncQuietly/syncFollowup elsewhere in this feature),
 *      after the activity insert so it reconciles against the up-to-date
 *      next_followup_at: the activity's follow_up_date write already
 *      happened, so a failed sync must not fail the outcome capture.
 *
 * appt_rescheduled is a special case: when the rep already booked a new
 * appointment on the deal (hasFutureAppointment), we don't also schedule a
 * generic follow-up. The new appointment IS the next touch.
 *
 * On success: invalidate the deal's appointments list (status flipped to
 * completed), the deals list (stage may have changed), and both activities
 * caches (the new appointment activity). useLogActivity/useUpdateDeal already
 * invalidate their own slice when NOT mocked, but we invalidate explicitly
 * here too so this hook's contract doesn't depend on their internals.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useLogActivity } from "@/features/activities/hooks/useLogActivity";
import { useUpdateDeal } from "@/features/pipeline/hooks/useUpdateDeal";
import { ACTIVITIES_ORG_QUERY_KEY, ACTIVITIES_QUERY_KEY } from "@/features/activities/hooks/useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { dealAppointmentsKey } from "../useAppointments";
import { useFollowupSync } from "../useFollowupSync";
import { calculateFollowUpDate, APPOINTMENT_STAGE_EFFECT, type Disposition } from "@/lib/followUpScheduling";

export interface RecordAppointmentOutcomeInput {
  appointmentId: string;
  dealId: string;
  outcome: Disposition;
  notes?: string;
  /** True when the deal already has another scheduled (future) appointment.
   *  Suppresses the generic follow-up for appt_rescheduled. */
  hasFutureAppointment: boolean;
  /** Only meaningful for appt_not_interested: opts the merchant out, moving
   *  the deal to lost instead of leaving the stage untouched. */
  doNotContact?: boolean;
  /** Only meaningful for appt_presented_awaiting: the merchant's stated
   *  decision date. When set it fully replaces the 3-day default and pins the
   *  follow-up to that date (asserted), so nothing chases them early. */
  expectedDecisionDate?: string | null;
}

export function useRecordAppointmentOutcome() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const logActivity = useLogActivity();
  const updateDeal = useUpdateDeal();
  const { syncFollowup } = useFollowupSync();

  return useMutation({
    mutationFn: async (input: RecordAppointmentOutcomeInput): Promise<void> => {
      // A stated decision date (Presented, awaiting) pins the follow-up and
      // replaces the 3-day default.
      const useDecisionDate =
        input.outcome === "appt_presented_awaiting" && !!input.expectedDecisionDate;
      const followUpDate = useDecisionDate
        ? input.expectedDecisionDate!
        : input.outcome === "appt_rescheduled" && input.hasFutureAppointment
          ? null
          : calculateFollowUpDate(input.outcome);

      // 1. Mark the appointment row completed with the outcome. Idempotent,
      //    so it runs before the non-idempotent activity insert below.
      const { error } = await supabase
        .from("scheduled_appointments")
        .update({
          outcome: input.outcome,
          outcome_notes: input.notes ?? null,
          outcome_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", input.appointmentId);
      if (error) throw error;

      // 2. Stage effect. Only forward advancement, target is only ever
      //    proposal/submitted/lost, never won. Idempotent.
      const target =
        input.doNotContact && input.outcome === "appt_not_interested"
          ? "lost"
          : APPOINTMENT_STAGE_EFFECT[input.outcome];
      if (target) {
        await updateDeal.mutateAsync({ id: input.dealId, patch: { stage: target } });
      }

      // 3. The touch + follow-up. NOT idempotent, so it runs last: if either
      //    write above failed, we never reach this insert, and a retry
      //    re-runs 1-2 as no-ops then inserts exactly one activity.
      await logActivity.mutateAsync({
        dealId: input.dealId,
        type: "appointment",
        disposition: input.outcome,
        outcomeNotes: input.notes ?? "",
        followUpDate,
        followUpDateSource: useDecisionDate ? "asserted" : "interval",
        voiceNoteUrl: null,
      });

      // 4. Reconcile the follow-up calendar event. Fire-and-forget, runs
      //    after the activity insert so it reconciles the up-to-date
      //    next_followup_at; the writes above already succeeded.
      void syncFollowup(input.dealId);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: dealAppointmentsKey(variables.dealId) });
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_QUERY_KEY(userId, variables.dealId),
      });
      void queryClient.invalidateQueries({ queryKey: ACTIVITIES_ORG_QUERY_KEY(userId) });
    },
  });
}
