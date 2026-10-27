/**
 * Triage mutations for public form submissions (migration 20261020000002).
 * With a partner, useAttributeFormSubmission turns the submission into a
 * referral and the review sheet finishes with the referral mutations in
 * useReferralMutations. With no partner, accept, decline and merge act on the
 * submission itself. Each refreshes every referrals query (both queues) and the
 * partners list (its referral counts); merge also refreshes the deal's notes.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { DEAL_NOTES_KEY } from "@/features/pipeline/hooks/useDealNotes";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage, type DeclineReason } from "../lib/referrals";

function useRefresh(opts: { deals?: boolean; tasks?: boolean } = {}) {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    if (opts.deals) void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    if (opts.tasks) void queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });
  };
}

/**
 * The referral a submission became (migration 20261027000002). First referral
 * wins (FR-PORT-46, 47): when an earlier open referral or active deal matches,
 * a duplicate id is set and accepting needs a written reason. A company-link
 * submission goes to the partner's rep (FR-PORT-51); assignedUserName says who.
 */
export interface AttributedReferral {
  referralId: string;
  duplicateOfReferralId: string | null;
  duplicateOfDealId: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
}

interface AttributeRow {
  referral_id: string;
  duplicate_of_referral_id: string | null;
  duplicate_of_deal_id: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
}

export function useAttributeFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; partnerId: string }): Promise<AttributedReferral> => {
      const { data, error } = await supabase.rpc("attribute_form_submission", {
        p_submission_id: input.submissionId,
        p_partner_id: input.partnerId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't save who sent it"));
      // An older database (before 20261027000002) returns the referral id alone.
      if (typeof data === "string" && data) {
        return {
          referralId: data,
          duplicateOfReferralId: null,
          duplicateOfDealId: null,
          assignedUserId: null,
          assignedUserName: null,
        };
      }
      // A table-returning RPC comes back as an array of one row.
      const row = (data as AttributeRow[] | null)?.[0];
      if (!row?.referral_id) throw new Error("Couldn't save who sent it");
      return {
        referralId: row.referral_id,
        duplicateOfReferralId: row.duplicate_of_referral_id ?? null,
        duplicateOfDealId: row.duplicate_of_deal_id ?? null,
        assignedUserId: row.assigned_user_id ?? null,
        assignedUserName: row.assigned_user_name?.trim() || null,
      };
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
  const queryClient = useQueryClient();
  const refresh = useRefresh({ deals: true });
  return useMutation({
    mutationFn: async (input: { submissionId: string; dealId: string }): Promise<void> => {
      const { error } = await supabase.rpc("merge_form_submission", {
        p_submission_id: input.submissionId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't merge the referral"));
    },
    onSuccess: (_data, input) => {
      refresh();
      // The merge writes a deal note with what the sender typed.
      void queryClient.invalidateQueries({ queryKey: DEAL_NOTES_KEY(input.dealId) });
    },
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
