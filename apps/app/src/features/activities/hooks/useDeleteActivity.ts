/**
 * useDeleteActivity — DELETE an activity row.
 *
 * RLS activities_delete restricts to managers/admins. Reps hitting this
 * get a permission error from the server — the UI should hide the
 * affordance for reps, but the policy is the real guardrail.
 *
 * The activities_sync_deal_denorm trigger fires on DELETE and recomputes
 * the parent deal's last_activity_at + next_followup_at, so we invalidate
 * the deals list too.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useFollowupSync } from "@/features/appointments/useFollowupSync";
import { ACTIVITIES_ORG_QUERY_KEY, ACTIVITIES_QUERY_KEY } from "./useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";

export interface DeleteActivityInput {
  id: string;
  /** Required so we can invalidate the per-deal cache. */
  dealId: string;
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const { syncFollowup } = useFollowupSync();

  return useMutation({
    mutationFn: async (input: DeleteActivityInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const { error } = await supabase
        .from("activities")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_QUERY_KEY(userId, variables.dealId),
      });
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_ORG_QUERY_KEY(userId),
      });
      void queryClient.invalidateQueries({
        queryKey: DEALS_QUERY_KEY(userId),
      });
      // next_followup_at is DERIVED — the activities_sync_deal_denorm trigger
      // recomputes it on DELETE (deleting the latest activity can move the
      // follow-up to an earlier one, or clear it). Reconcile the deal's
      // follow-up calendar event. Fire-and-forget.
      void syncFollowup(variables.dealId);
    },
  });
}
