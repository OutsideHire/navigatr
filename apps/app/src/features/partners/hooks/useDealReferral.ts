/**
 * useDealReferral: the partner who referred this deal, if any (earliest live
 * inbound referral). Drives the "Referred by" line on Deal Detail.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchReferralPartnerNames } from "./useReferralPartnerNames";

export interface DealReferral {
  referralId: string;
  partnerId: string;
  /** False when partners RLS hides the partner from this viewer (show the name, no link). */
  partnerVisible: boolean;
  partnerName: string | null;
  partnerCompany: string | null;
  partnerCompanySnapshot: string | null;
  /** accepted, working, won or lost (declined and withdrawn rows are hidden). */
  status: string;
}

interface Row {
  id: string;
  status: string;
  partner_id: string;
  partner_company_snapshot: string | null;
  partner: { name: string; company: string } | null;
}

export function useDealReferral(dealId: string | undefined) {
  return useQuery({
    queryKey: ["referrals", "deal", dealId ?? "none"] as const,
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealReferral | null> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, status, partner_id, partner_company_snapshot, partner:partners(name, company)")
        .eq("deal_id", dealId as string)
        .eq("direction", "inbound")
        .not("status", "in", "(declined,withdrawn)")
        .order("submitted_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as Row;
      // The partners embed is null when the viewer cannot open the partner.
      // Reps still see who referred the deal, read-only (FR-PORT-55).
      const hidden = row.partner === null ? (await fetchReferralPartnerNames([row.id])).get(row.id) : undefined;
      return {
        referralId: row.id,
        status: row.status,
        partnerId: row.partner_id,
        partnerVisible: row.partner !== null,
        partnerName: row.partner?.name ?? hidden?.name ?? null,
        partnerCompany: row.partner?.company ?? hidden?.company ?? null,
        partnerCompanySnapshot: row.partner_company_snapshot,
      };
    },
    staleTime: 30_000,
  });
}
