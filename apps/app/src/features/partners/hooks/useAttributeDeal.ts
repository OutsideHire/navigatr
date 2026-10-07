/**
 * useAttributeDeal: link an existing deal to a partner as an inbound referral.
 * useUnattributeDeal: withdraw a rep-entered link (history is kept).
 *
 * Both go through SECURITY DEFINER RPCs (migration 20261007000003); the app
 * role has no direct write access to referrals. On success we refetch the
 * partners list (its embedded referrals drive attributedDealIds) and every
 * referrals query (queue, deal "Referred by").
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage, type ReferralDirection } from "../lib/referrals";

export interface AttributeDealInput {
  partnerId: string;
  dealId: string;
  notes?: string;
}

export function useAttributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: AttributeDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("attribute_deal_to_partner", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_note: input.notes ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not attribute deal"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}

export function useUnattributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: {
      partnerId: string;
      dealId: string;
      direction?: ReferralDirection;
    }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("remove_referral_link", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_direction: input.direction ?? "inbound",
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not remove the link"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
