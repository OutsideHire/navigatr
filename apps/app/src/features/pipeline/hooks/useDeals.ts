/**
 * useDeals — list-all-deals query against Supabase.
 *
 * Returns the same shape PipelinePage already consumes (`Deal[]`), so the
 * page swap is a single import change. RLS on the `deals` table scopes
 * results to the user's org_id; no explicit filter needed here.
 *
 * Cache key is `["deals", "list", userId]`. The userId tail makes sign-out
 * + sign-in-as-someone-else invalidate cleanly without manual cache busting.
 *
 * Server-side filtering (stage, q) deliberately NOT added yet — the page
 * already does in-memory filtering and the dataset will be small (<1k per
 * org) for the foreseeable future. We add Postgres-side filters when a
 * single org's deal count makes the round-trip the bottleneck.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { Deal, DealStage } from "../mockData";

/** Shape Supabase returns. Snake_case + nullable timestamps. */
interface DealRow {
  id: string;
  company_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  value_cents: number;
  stage: DealStage;
  probability: number;
  last_activity_at: string | null;
  next_followup_at: string | null;
  address: string | null;
  employee_count_range: string | null;
  lead_source: string | null;
  updated_at: string;
}

/**
 * Map a Supabase row to the frontend `Deal` shape. Centralizing this lets
 * the table grow new columns without touching every UI consumer.
 *
 * Sprint 1 frontend treats `lastActivity` as required (it's used for the
 * "3d ago" relative date). For brand-new deals with no activity yet we
 * fall back to created_at-equivalent: the row's own creation moment. Since
 * we don't currently select created_at, we use the deal id timestamp via
 * "now" as a last resort — better to render "today" than crash on null.
 * Real fix: surface created_at + render "no activity yet" in the UI.
 */
function toDeal(row: DealRow): Deal {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    phone: row.contact_phone,
    email: row.contact_email,
    valueCents: row.value_cents,
    stage: row.stage,
    probability: row.probability,
    lastActivity: row.last_activity_at ?? new Date().toISOString(),
    nextFollowup: row.next_followup_at,
    address: row.address,
    employeeCountRange: row.employee_count_range ?? "",
    leadSource: row.lead_source ?? "",
    updatedAt: row.updated_at,
  };
}

export const DEALS_QUERY_KEY = (userId: string | undefined) =>
  ["deals", "list", userId ?? "anon"] as const;

export function useDeals() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: DEALS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Deal[]> => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          "id, company_name, contact_name, contact_phone, contact_email, " +
            "value_cents, stage, probability, last_activity_at, " +
            "next_followup_at, address, employee_count_range, lead_source, updated_at",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => toDeal(row as unknown as DealRow));
    },
    staleTime: 30_000,
  });
}
