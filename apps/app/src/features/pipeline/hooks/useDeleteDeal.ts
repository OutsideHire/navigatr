/**
 * useDeleteDeal — DELETE a deal row.
 *
 * RLS deletes_delete policy restricts this to managers/admins. Reps
 * who hit this will get a permission error from the server — the UI
 * should hide the affordance for reps to avoid the dead-end click,
 * but the policy is the real guardrail.
 *
 * On success: invalidate the deals list. The activities + stage
 * history on this deal cascade-delete from the FK on delete CASCADE
 * we set in the migration, so no separate cache busts needed.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "./useDeals";
import { STAGE_HISTORY_QUERY_KEY } from "./useStageHistory";

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (dealId: string): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const { error } = await supabase
        .from("deals")
        .delete()
        .eq("id", dealId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
      // Stage history rows for the deleted deal are removed via FK
      // cascade; the dashboard funnel reads from stage_history so we
      // invalidate to surface the updated counts.
      void queryClient.invalidateQueries({ queryKey: STAGE_HISTORY_QUERY_KEY(userId) });
    },
  });
}
