/**
 * useLogStopDwell — records the REAL dwell time of a closed-out stop (Path v2.2
 * Ticket B 4.3.2). The driving sequence uses fixed 15/30-minute dwell estimates;
 * this write captures the measured elapsed time between the rep marking arrival
 * ("I'm here") and closing the stop out (logging the outcome), bucketed by stop
 * type, so those estimates can later be replaced with measured per-rep averages.
 *
 * This is INVISIBLE analytics: it changes nothing the rep sees, and it is
 * BEST-EFFORT — every failure path (no signed-in user, a supabase error, a
 * rejected insert, or a not-yet-created table) is swallowed so a dwell write can
 * never disrupt the run or the logging flow. No query invalidation: write-only.
 */
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type StopDwellType = "appointment" | "discovery";

export interface LogStopDwellInput {
  stopType: StopDwellType;
  dealId: string | null;
  /** ISO timestamp captured when the rep tapped "I'm here". */
  arrivedAt: string;
  /** ISO timestamp captured when the outcome was logged (close-out). */
  closedAt: string;
}

export function useLogStopDwell() {
  const userId = useAuth((s) => s.user?.id);

  const logStopDwell = async ({ stopType, dealId, arrivedAt, closedAt }: LogStopDwellInput): Promise<void> => {
    try {
      if (!userId) return;
      const dwellMinutes = (new Date(closedAt).getTime() - new Date(arrivedAt).getTime()) / 60000;
      await supabase.from("stop_dwell_log").insert({
        user_id: userId,
        stop_type: stopType,
        deal_id: dealId,
        arrived_at: arrivedAt,
        closed_at: closedAt,
        dwell_minutes: dwellMinutes,
      });
      // Any supabase-reported error is intentionally ignored: best-effort.
    } catch {
      // Swallow: a dwell-log failure must never surface to the rep or break the run.
    }
  };

  return { logStopDwell };
}
