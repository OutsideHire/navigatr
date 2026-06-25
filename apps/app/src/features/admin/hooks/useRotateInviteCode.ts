/**
 * useRotateInviteCode — regenerate the org's shared join code via the
 * rotate_invite_code RPC (admin-only, enforced server-side). Returns the new
 * code and invalidates the organization query so the displayed link updates.
 * Mirrors useSetMemberRole.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useRotateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("rotate_invite_code");
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      // Prefix-match invalidation: refreshes useOrganization regardless of the
      // userId/orgId tail in its query key.
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
}
