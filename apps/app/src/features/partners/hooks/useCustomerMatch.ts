/**
 * useCustomerMatch: is this referral's business already a won customer the
 * reviewer can see? Drives the rep-only "Already a customer" line on the
 * review sheets (FR-PORT-44). Never used on the partner side.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CustomerMatch {
  dealId: string;
  companyName: string;
}

export interface CustomerMatchInput {
  company: string | null | undefined;
  phone: string | null | undefined;
  address: string | null | undefined;
  /** False skips the lookup (sheet closed). Defaults to true. */
  enabled?: boolean;
}

interface Row {
  deal_id: string;
  company_name: string;
}

export function useCustomerMatch({ company, phone, address, enabled = true }: CustomerMatchInput) {
  const c = company?.trim() || null;
  const p = phone?.trim() || null;
  const a = address?.trim() || null;
  return useQuery({
    queryKey: ["referrals", "customer-match", c, p, a] as const,
    enabled: enabled && Boolean(c || p),
    queryFn: async (): Promise<CustomerMatch | null> => {
      const { data, error } = await supabase.rpc("referral_customer_match", {
        p_company: c,
        p_phone: p,
        p_address: a,
      });
      if (error) throw error;
      const row = ((data ?? []) as Row[])[0];
      return row ? { dealId: row.deal_id, companyName: row.company_name } : null;
    },
    staleTime: 60_000,
  });
}
