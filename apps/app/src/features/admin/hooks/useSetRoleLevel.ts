/**
 * useSetRoleLevel — set a member's hierarchy role level via the
 * admin_set_role_level RPC (Administrator-only, enforced server-side). The RPC
 * keeps the legacy `role` synced and rebuilds the member's role_path subtree.
 * Invalidates the leaderboard so the roster reflects the new level. Mirrors
 * useSetMemberManager.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { RoleLevel } from "@/features/auth/capabilities";

export interface SetRoleLevelInput {
  profileId: string;
  level: RoleLevel;
}

export function useSetRoleLevel() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: SetRoleLevelInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_set_role_level", {
        p_profile_id: input.profileId,
        p_level: input.level,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "leaderboard", userId ?? "anon"],
      });
    },
  });
}
