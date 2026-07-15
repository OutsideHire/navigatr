/**
 * useSetMemberManager — set who a member reports to via the admin_set_manager
 * RPC (admin-only, enforced server-side). The RPC rebuilds the member's
 * role_path subtree, activating hierarchy scoping. Invalidates the leaderboard
 * so the roster reflects the new assignment. Mirrors useSetMemberRole.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface SetMemberManagerInput {
  memberId: string;
  managerId: string | null;
}

export function useSetMemberManager() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: SetMemberManagerInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_set_manager", {
        p_member: input.memberId,
        p_manager: input.managerId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "leaderboard", userId ?? "anon"],
      });
    },
  });
}
