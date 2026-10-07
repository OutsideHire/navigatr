/**
 * useDealReferral: the partner who referred this deal, if any (earliest live
 * inbound referral). Drives the "Referred by" line on Deal Detail.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DealReferral {
  referralId: string;
  partnerId: string;
  partnerName: string;
  partnerCompany: string;
}

interface Row {
  id: string;
  partner_id: string;
  partner: { name: string; company: string } | null;
}

export function useDealReferral(dealId: string | undefined) {
  return useQuery({
    queryKey: ["referrals", "deal", dealId ?? "none"] as const,
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealReferral | null> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, partner_id, partner:partners(name, company)")
        .eq("deal_id", dealId as string)
        .eq("direction", "inbound")
        .not("status", "in", "(declined,withdrawn)")
        .order("submitted_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as Row;
      return {
        referralId: row.id,
        partnerId: row.partner_id,
        partnerName: row.partner?.name ?? "",
        partnerCompany: row.partner?.company ?? "",
      };
    },
    staleTime: 30_000,
  });
}
