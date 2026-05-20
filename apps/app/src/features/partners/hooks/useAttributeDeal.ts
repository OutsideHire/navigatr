/**
 * useAttributeDeal — link a deal to a partner.
 *
 * Inserts into partner_deals. RLS with-check pins org_id; the
 * partner_deals consistency trigger overwrites org_id from the parent
 * partner anyway. attributed_by defaults to auth.uid().
 *
 * On success: invalidate the partners cache (the nested
 * partner_deals(deal_id) embed needs to refetch so the partner's
 * attributedDealIds includes the new link).
 *
 * useUnattributeDeal is the inverse — removes the link row.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { PARTNERS_QUERY_KEY } from "./usePartners";

export interface AttributeDealInput {
  partnerId: string;
  dealId: string;
  notes?: string;
}

export function useAttributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: AttributeDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) {
        throw new Error("Profile not loaded — cannot attribute deal");
      }

      const { error } = await supabase.from("partner_deals").insert({
        // org_id is required by the with-check policy; the trigger
        // overwrites it from the parent partner. We send our own org
        // for the rare case the trigger is disabled.
        org_id:        profile.data.org_id,
        partner_id:    input.partnerId,
        deal_id:       input.dealId,
        attributed_by: userId,
        notes:         input.notes ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // The partners query embeds partner_deals(deal_id); invalidating
      // it refetches the full list (and rebuilds each partner's
      // attributedDealIds). The deals list isn't touched — deal rows
      // don't carry attribution.
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    },
  });
}

export function useUnattributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: { partnerId: string; dealId: string }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const { error } = await supabase
        .from("partner_deals")
        .delete()
        .eq("partner_id", input.partnerId)
        .eq("deal_id", input.dealId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    },
  });
}
