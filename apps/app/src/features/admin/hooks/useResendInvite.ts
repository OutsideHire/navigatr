/**
 * useResendInvite — extend an invite's expires_at by 14 days and return
 * the (id, email, token) so the caller can fire a fresh email.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ORG_AGENTS_QUERY_KEY } from "./useOrgAgents";

export interface ResendInviteResult {
  id: string;
  email: string;
  token: string;
}

export function useResendInvite() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (inviteId: string): Promise<ResendInviteResult> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("admin_resend_invite", {
        p_invite_id: inviteId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("admin_resend_invite returned no row");
      return row as ResendInviteResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ORG_AGENTS_QUERY_KEY(userId),
      });
    },
  });
}
