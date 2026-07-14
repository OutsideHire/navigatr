/**
 * usePartners — list-all-partners query with embedded attribution.
 *
 * Returns the same shape PartnersPage already consumes (`Partner[]`).
 * RLS scopes results to the user's org; we don't pass an explicit
 * filter. The nested `partner_deals(deal_id)` select gets each
 * partner's attributed deal ids in one round-trip via PostgREST.
 *
 * Cache key tail = userId so sign-out invalidates cleanly.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { Partner, PartnerStatus, PartnerType } from "../mockData";

interface PartnerRow {
  id: string;
  name: string;
  company: string;
  type: PartnerType;
  status: PartnerStatus;
  phone: string | null;
  email: string | null;
  city: string | null;
  last_touch_at: string | null;
  next_followup_at: string | null;
  notes: string;
  created_by: string | null;
  // Nested via PostgREST embedded resource
  partner_deals: Array<{ deal_id: string; direction?: string }> | null;
}

function toPartner(row: PartnerRow): Partner {
  const links = row.partner_deals ?? [];
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    type: row.type,
    status: row.status,
    phone: row.phone ?? "",
    email: row.email ?? "",
    city: row.city ?? "",
    lastTouch: row.last_touch_at,
    nextFollowup: row.next_followup_at,
    attributedDealIds: links
      .filter((l) => l.direction !== "outbound")
      .map((l) => l.deal_id),
    outboundDealIds: links
      .filter((l) => l.direction === "outbound")
      .map((l) => l.deal_id),
    notes: row.notes,
    createdBy: row.created_by ?? null,
  };
}

export const PARTNERS_QUERY_KEY = (userId: string | undefined) =>
  ["partners", "list", userId ?? "anon"] as const;

export function usePartners() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PARTNERS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Partner[]> => {
      const { data, error } = await supabase
        .from("partners")
        .select(
          "id, name, company, type, status, phone, email, city, " +
            "last_touch_at, next_followup_at, notes, created_by, " +
            "partner_deals(deal_id, direction)",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toPartner(r as unknown as PartnerRow));
    },
    staleTime: 30_000,
  });
}
