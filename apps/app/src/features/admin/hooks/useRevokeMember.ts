/**
 * useRevokeMember — revoke a pending invite OR soft-deactivate an active
 * profile. The `kind` param matches the RPC's discriminator.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ORG_AGENTS_QUERY_KEY } from "./useOrgAgents";

export interface RevokeMemberInput {
  targetId: string;
  kind: "invite" | "profile";
}

export function useRevokeMember() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: RevokeMemberInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_revoke_member", {
        p_target: input.targetId,
        p_kind: input.kind,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ORG_AGENTS_QUERY_KEY(userId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "seat-usage", userId ?? "anon"],
      });
    },
  });
}
