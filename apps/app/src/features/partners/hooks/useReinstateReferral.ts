/**
 * Declined duplicates that can come back (FR-PORT-48): the referral that held
 * credit is now declined or withdrawn. RLS scopes the read; the can_reinstate
 * computed field keeps only rows the caller can triage and that qualify.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { referralErrorMessage } from "../lib/referrals";

export interface ReinstatableReferral {
  id: string;
  companyName: string;
  submittedAt: string;
}

interface Row {
  id: string;
  company_name: string;
  submitted_at: string;
}

export const REINSTATABLE_REFERRALS_QUERY_KEY = (partnerId?: string) =>
  ["referrals", "reinstatable", partnerId ?? "none"] as const;

export function useReinstatableReferrals(partnerId: string | undefined) {
  return useQuery({
    queryKey: REINSTATABLE_REFERRALS_QUERY_KEY(partnerId),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<ReinstatableReferral[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, company_name, submitted_at")
        .eq("partner_id", partnerId as string)
        .eq("status", "declined")
        .eq("can_reinstate", true)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id, companyName: r.company_name, submittedAt: r.submitted_at }));
    },
    staleTime: 30_000,
  });
}

export function useReinstateReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (referralId: string): Promise<void> => {
      const { error } = await supabase.rpc("reinstate_referral", { p_referral_id: referralId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reinstate the referral"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
