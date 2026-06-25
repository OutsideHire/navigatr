/**
 * useSetMemberRole — change a member's role via the admin_set_role RPC (admin-
 * only, enforced server-side). Invalidates the team-leaderboard so the role
 * badge updates. Mirrors useRevokeMember.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { UserRole } from "../lib/roleActions";

export interface SetMemberRoleInput {
  profileId: string;
  newRole: UserRole;
}

export function useSetMemberRole() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: SetMemberRoleInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_set_role", {
        p_profile_id: input.profileId,
        p_new_role: input.newRole,
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
