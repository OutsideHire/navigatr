/**
 * Reassigning a referral (FR-PORT-55). Managers and administrators pick a
 * teammate they can see (list_referral_assignees), are warned before confirming
 * when that teammate cannot see the partner (can_user_see_partner), then
 * reassign_referral moves it. Only assigned_user_id changes, which is what
 * routes every later email.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { referralErrorMessage } from "../lib/referrals";

export interface ReferralAssignee {
  id: string;
  name: string;
}

interface AssigneeRow {
  user_id: string;
  full_name: string | null;
  email: string;
}

export const REFERRAL_ASSIGNEES_QUERY_KEY = (userId?: string) => ["referrals", "assignees", userId ?? "anon"] as const;

export function useReferralAssignees(enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_ASSIGNEES_QUERY_KEY(userId),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReferralAssignee[]> => {
      const { data, error } = await supabase.rpc("list_referral_assignees");
      if (error) throw error;
      return ((data ?? []) as AssigneeRow[]).map((r) => ({ id: r.user_id, name: r.full_name?.trim() || r.email }));
    },
    staleTime: 5 * 60_000,
  });
}

export function useAssigneeSeesPartner(userId: string | null, partnerId: string | null) {
  return useQuery({
    queryKey: ["referrals", "assignee-sees-partner", userId ?? "none", partnerId ?? "none"] as const,
    enabled: Boolean(userId && partnerId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("can_user_see_partner", {
        p_user_id: userId,
        p_partner_id: partnerId,
      });
      if (error) throw error;
      return data === true;
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useReassignReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { referralId: string; userId: string }): Promise<boolean> => {
      const { data, error } = await supabase.rpc("reassign_referral", {
        p_referral_id: input.referralId,
        p_user_id: input.userId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reassign the referral"));
      return data === true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
