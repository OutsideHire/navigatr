/**
 * useActivities(dealId) — per-deal timeline query.
 *
 * RLS enforces org isolation server-side; we just filter by deal_id and
 * order by occurred_at desc. The activities table's
 * `activities_deal_occurred_idx` makes this an index scan.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { Activity, ActivityType } from "../mockData";
import type { Disposition } from "@/lib/followUpScheduling";

/** Shape Supabase returns. Snake_case + nullable timestamps. */
interface ActivityRow {
  id: string;
  deal_id: string;
  type: ActivityType;
  disposition: Disposition;
  duration_minutes: number | null;
  outcome_notes: string;
  occurred_at: string;
  follow_up_date: string | null;
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    disposition: row.disposition,
    durationMinutes: row.duration_minutes,
    outcomeNotes: row.outcome_notes,
    occurredAt: row.occurred_at,
    // Mock stores follow-up as a full ISO timestamp; DB stores a date.
    // Coerce to ISO midnight UTC so consumers don't have to switch.
    followUpDate: row.follow_up_date
      ? new Date(row.follow_up_date + "T00:00:00Z").toISOString()
      : null,
  };
}

export const ACTIVITIES_QUERY_KEY = (userId: string | undefined, dealId: string) =>
  ["activities", "byDeal", userId ?? "anon", dealId] as const;

export const ACTIVITIES_ORG_QUERY_KEY = (userId: string | undefined) =>
  ["activities", "list", userId ?? "anon"] as const;

export function useActivities(dealId: string | undefined) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: ACTIVITIES_QUERY_KEY(userId, dealId ?? "none"),
    enabled: Boolean(userId && dealId),
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, deal_id, type, disposition, duration_minutes, " +
            "outcome_notes, occurred_at, follow_up_date",
        )
        .eq("deal_id", dealId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toActivity(r as unknown as ActivityRow));
    },
    staleTime: 30_000,
  });
}

/**
 * Org-wide activity feed. Powers the /activities page (Today / Upcoming
 * / History tabs). RLS scopes results to the user's org_id, so we don't
 * pass an explicit filter. The activities_org_occurred_idx makes this
 * an index scan even at scale.
 */
export function useActivitiesForOrg() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: ACTIVITIES_ORG_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, deal_id, type, disposition, duration_minutes, " +
            "outcome_notes, occurred_at, follow_up_date",
        )
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toActivity(r as unknown as ActivityRow));
    },
    staleTime: 30_000,
  });
}
