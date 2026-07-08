/**
 * useFollowupSync — client trigger for the `sync_followup` Edge function.
 *
 * "Two-way calendar sync — Milestone 2: Follow-up sync." When a deal's
 * `next_followup_at` changes (a direct edit, a logged activity/drop-in whose
 * disposition reschedules the follow-up, or a won/lost stage change that clears
 * it), we invoke `sync_followup` to reconcile the deal's follow-up to an all-day
 * Google Calendar event (create / move / remove).
 *
 * Fire-and-forget by design, mirroring `invokeSyncQuietly` in useAppointments:
 * the deal row is already persisted, so a failing invoke (function down, network,
 * returned `{ error }`) must NOT fail the underlying mutation. Calendar state is
 * reconciled on the next successful reconcile pass — never at the cost of the
 * user's action. Callers therefore `void syncFollowup(dealId)` and don't await
 * it in a way that blocks the UI.
 */

import { supabase } from "@/lib/supabase";

/** Name of the Edge function that reconciles the follow-up calendar event. */
const SYNC_FUNCTION = "sync_followup";

export function useFollowupSync() {
  /**
   * Best-effort invoke of the follow-up sync function for a deal. Both a
   * returned `{ error }` and a thrown/rejected invoke are swallowed — the
   * deal's next_followup_at is already saved, so sync is reconciled later
   * rather than by failing the caller's mutation.
   */
  async function syncFollowup(dealId: string): Promise<void> {
    try {
      await supabase.functions.invoke(SYNC_FUNCTION, {
        body: { deal_id: dealId },
      });
    } catch {
      // Swallow — calendar state is reconciled on the next sync pass.
    }
  }

  return { syncFollowup };
}
