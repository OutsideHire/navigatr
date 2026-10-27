/**
 * useReferralPartnerNames: the referring partner's name and company for a batch
 * of referrals, even when the viewer cannot open that partner (FR-PORT-55). The
 * referral_partner_names RPC returns rows only for referrals the viewer can
 * already select, and nothing beyond name and company. `visible` says whether
 * the viewer may open the partner page, so callers link only then.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ReferralPartnerName {
  partnerId: string;
  name: string;
  company: string;
  /** True when the viewer may open the partner record (link it). */
  visible: boolean;
}

interface Row {
  referral_id: string;
  partner_id: string;
  name: string;
  company: string;
  visible: boolean;
}

/** One RPC call for the whole batch, keyed by referral id. */
export async function fetchReferralPartnerNames(referralIds: string[]): Promise<Map<string, ReferralPartnerName>> {
  const names = new Map<string, ReferralPartnerName>();
  if (referralIds.length === 0) return names;
  const { data, error } = await supabase.rpc("referral_partner_names", { p_referral_ids: referralIds });
  if (error) throw error;
  for (const r of (data ?? []) as Row[]) {
    names.set(r.referral_id, { partnerId: r.partner_id, name: r.name, company: r.company, visible: r.visible });
  }
  return names;
}

export function useReferralPartnerNames(referralIds: string[]) {
  const ids = [...referralIds].sort();
  return useQuery({
    queryKey: ["referrals", "partner-names", ids] as const,
    enabled: ids.length > 0,
    queryFn: () => fetchReferralPartnerNames(ids),
    staleTime: 60_000,
  });
}
