/**
 * useMatchUnloggedDials: stamps the explicit dial-to-activity match after a
 * rep logs an outcome from the Unlogged Calls nudge (UCB task). Calls the
 * security-definer RPC match_unlogged_dials(p_deal_id, p_activity_id), which
 * sets coverage_signal.matched_activity_id + matched_at on the caller's
 * unmatched dials for that deal.
 *
 * This is what clears the nudge for a next-day (or later) log: the 4h
 * auto-match window in computeUnloggedDials only covers same-session logs,
 * so a late log needs this explicit stamp instead.
 *
 * On success: invalidate the unlogged-dials query so the list refreshes
 * without the just-matched dial.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { UNLOGGED_DIALS_QUERY_KEY } from "./useUnloggedDials";

export interface MatchUnloggedDialsInput {
  dealId: string;
  activityId: string;
}

export function useMatchUnloggedDials() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: MatchUnloggedDialsInput): Promise<void> => {
      const { error } = await supabase.rpc("match_unlogged_dials", {
        p_deal_id: input.dealId,
        p_activity_id: input.activityId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNLOGGED_DIALS_QUERY_KEY(userId) });
    },
  });
}
