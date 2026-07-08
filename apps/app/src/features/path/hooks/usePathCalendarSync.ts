/**
 * usePathCalendarSync — client trigger for the `sync_path` Edge function.
 *
 * "Two-way calendar sync — Milestone 3: Path blocks." A planned path
 * (`status='planned' AND started_at IS NULL`) is mirrored to an all-day Google
 * Calendar block. `sync_path` reconciles that block: it creates the block for a
 * newly-planned path and deletes it once the path is started (`started_at` set)
 * or completed. Callers fire it at the plan-save / start / complete moments.
 *
 * Fire-and-forget by design, mirroring `useFollowupSync` / `invokeSyncQuietly`
 * in useAppointments: the path row is already persisted, so a failing invoke
 * (function down, network, returned `{ error }`) must NOT fail the underlying
 * mutation. The block is reconciled on the next successful pass — never at the
 * cost of the user's action. Callers therefore `void syncPath(pathId)` and don't
 * await it in a way that blocks the UI.
 */

import { supabase } from "@/lib/supabase";

/** Name of the Edge function that reconciles the path calendar block. */
const SYNC_FUNCTION = "sync_path";

export function usePathCalendarSync() {
  /**
   * Best-effort invoke of the path sync function. Both a returned `{ error }`
   * and a thrown/rejected invoke are swallowed — the path row is already saved,
   * so the block is reconciled later rather than by failing the caller's
   * mutation.
   */
  async function syncPath(pathId: string): Promise<void> {
    try {
      await supabase.functions.invoke(SYNC_FUNCTION, {
        body: { path_id: pathId },
      });
    } catch {
      // Swallow — calendar state is reconciled on the next sync pass.
    }
  }

  return { syncPath };
}
