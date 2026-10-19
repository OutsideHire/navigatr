/**
 * useReferDeal: record that we referred a deal TO a partner (outbound).
 * Calls send_referral_to_partner (migration 20261022000002). A non-blank note
 * is written FOR the partner: they read it in their portal and in the
 * "sent you a referral" email. Without a note nothing is shown to them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage } from "../lib/referrals";

export interface ReferDealInput {
  partnerId: string;
  dealId: string;
  notes?: string;
}

export function useReferDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: ReferDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("send_referral_to_partner", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_partner_note: input.notes ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not refer deal"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
