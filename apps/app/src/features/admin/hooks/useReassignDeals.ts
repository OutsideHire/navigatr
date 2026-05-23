import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";

export interface ReassignInput {
  fromProfile: string;
  toProfile: string;
}

export function useReassignDeals() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: ReassignInput): Promise<number> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("admin_reassign_deals", {
        p_from_profile: input.fromProfile,
        p_to_profile: input.toProfile,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      // Reassignment changes deal owner_id, which affects leaderboard +
      // dashboard + pipeline cards. Invalidate all three.
      void queryClient.invalidateQueries({ queryKey: ["admin", "leaderboard"] });
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    },
  });
}
