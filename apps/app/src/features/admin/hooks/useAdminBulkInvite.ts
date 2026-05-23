/**
 * useAdminBulkInvite — wraps the admin_bulk_invite RPC.
 *
 * Returns the per-row result array as-is so the CSV import wizard
 * can show users which rows succeeded vs failed (already_invited /
 * already_active / seat_cap_reached / invalid_email).
 *
 * Email sending is NOT part of this hook — the wizard calls
 * useSendInviteEmails after the bulk insert lands, which lets us retry
 * the email side without re-inserting rows.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface InviteInput {
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
}

export interface InviteResult {
  email: string;
  id: string | null;   // null when ok=false
  ok: boolean;
  error: string | null;
}

export function useAdminBulkInvite() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (rows: InviteInput[]): Promise<InviteResult[]> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("admin_bulk_invite", {
        p_invites: rows,
      });
      if (error) throw error;
      return (data ?? []) as InviteResult[];
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "leaderboard", userId ?? "anon"],
      });
    },
  });
}
