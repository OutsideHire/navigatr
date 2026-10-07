/**
 * Triage + log mutations for referrals. Each calls one RPC from migration
 * 20261007000003 and refreshes every referrals query, the partners list, and
 * (when a deal can change) the deals list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage, type DeclineReason } from "../lib/referrals";

export type AcceptResult =
  | { result: "accepted"; dealId: string }
  | { result: "duplicate"; dealId: string | null };

export interface LogReferralInput {
  partnerId: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  notes?: string;
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
}

function useRefresh(includeDeals: boolean) {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    if (includeDeals) void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
  };
}

export function useLogReferral() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: async (input: LogReferralInput): Promise<string> => {
      const { data, error } = await supabase.rpc("log_referral", {
        p_partner_id: input.partnerId,
        p_company_name: input.companyName.trim(),
        p_contact_name: blankToNull(input.contactName),
        p_contact_email: blankToNull(input.contactEmail),
        p_contact_phone: blankToNull(input.contactPhone),
        p_address: blankToNull(input.address),
        p_notes: input.notes?.trim() ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't log the referral"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useAcceptReferral() {
  const refreshAll = useRefresh(true);
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  // Accepting also creates the first follow-up task.
  const refresh = () => {
    refreshAll();
    void queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });
  };
  return useMutation({
    mutationFn: async (referralId: string): Promise<AcceptResult> => {
      const { data, error } = await supabase.rpc("accept_referral", { p_referral_id: referralId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't accept the referral"));
      const raw = data as { result: "accepted" | "duplicate"; deal_id: string | null };
      return raw.result === "accepted"
        ? { result: "accepted", dealId: raw.deal_id as string }
        : { result: "duplicate", dealId: raw.deal_id };
    },
    onSuccess: refresh,
  });
}

export function useDeclineReferral() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: async (input: { referralId: string; reason: DeclineReason; note?: string }): Promise<void> => {
      const { error } = await supabase.rpc("decline_referral", {
        p_referral_id: input.referralId,
        p_reason: input.reason,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't decline the referral"));
    },
    onSuccess: refresh,
  });
}

export function useMergeReferral() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: async (input: { referralId: string; dealId: string }): Promise<void> => {
      const { error } = await supabase.rpc("merge_referral", {
        p_referral_id: input.referralId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't merge the referral"));
    },
    onSuccess: refresh,
  });
}
