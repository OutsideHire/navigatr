/**
 * useSendInviteEmails — invokes the send_invite_email Edge Function.
 * Returns the per-row results array.
 */
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SendInviteEmailsResult {
  id: string;
  ok: boolean;
  error?: string;
}

export function useSendInviteEmails() {
  return useMutation({
    mutationFn: async (inviteIds: string[]): Promise<SendInviteEmailsResult[]> => {
      const { data, error } = await supabase.functions.invoke("send_invite_email", {
        body: { invite_ids: inviteIds },
      });
      if (error) throw error;
      return (data?.results ?? []) as SendInviteEmailsResult[];
    },
  });
}
