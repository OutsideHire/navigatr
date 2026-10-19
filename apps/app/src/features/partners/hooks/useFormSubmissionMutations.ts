/**
 * Triage mutations for public form submissions (migration 20261020000002).
 * With a partner, useAttributeFormSubmission turns the submission into a
 * referral and the review sheet finishes with the referral mutations in
 * useReferralMutations. With no partner, accept, decline and merge act on the
 * submission itself. Each refreshes every referrals query (both queues).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { referralErrorMessage, type DeclineReason } from "../lib/referrals";

function useRefresh(opts: { deals?: boolean; tasks?: boolean } = {}) {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    if (opts.deals) void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    if (opts.tasks) void queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });
  };
}

export function useAttributeFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; partnerId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("attribute_form_submission", {
        p_submission_id: input.submissionId,
        p_partner_id: input.partnerId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't save who sent it"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useAcceptFormSubmission() {
  // Accepting creates a deal and its first follow-up task.
  const refresh = useRefresh({ deals: true, tasks: true });
  return useMutation({
    mutationFn: async (submissionId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_form_submission", { p_submission_id: submissionId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't accept the referral"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useDeclineFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; reason: DeclineReason; note?: string }): Promise<void> => {
      const { error } = await supabase.rpc("decline_form_submission", {
        p_submission_id: input.submissionId,
        p_reason: input.reason,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't decline the referral"));
    },
    onSuccess: refresh,
  });
}

export function useMergeFormSubmission() {
  const refresh = useRefresh({ deals: true });
  return useMutation({
    mutationFn: async (input: { submissionId: string; dealId: string }): Promise<void> => {
      const { error } = await supabase.rpc("merge_form_submission", {
        p_submission_id: input.submissionId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't merge the referral"));
    },
    onSuccess: refresh,
  });
}

export function useReassignFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; userId: string }): Promise<void> => {
      const { error } = await supabase.rpc("reassign_form_submission", {
        p_submission_id: input.submissionId,
        p_user_id: input.userId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reassign the referral"));
    },
    onSuccess: refresh,
  });
}
