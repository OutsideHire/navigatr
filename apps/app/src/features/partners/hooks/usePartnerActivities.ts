/**
 * usePartnerActivities — read the per-partner touch log.
 *
 * Drives the partner detail page's timeline. RLS scopes results to
 * org_id; we just filter by partner_id and order by occurred_at desc.
 *
 * Shape mirrors the deals-side Activity hook so consumers can render
 * one timeline component for either. We keep them as separate types
 * (PartnerTouch here, Activity for deals) so a future divergence
 * doesn't force a refactor.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type PartnerTouchType = "call" | "email" | "meeting" | "note";

export interface PartnerTouch {
  id: string;
  partnerId: string;
  type: PartnerTouchType;
  notes: string;
  durationMinutes: number | null;
  occurredAt: string;
  /** ISO timestamp (midnight UTC) — null when no next-touch was set. */
  followUpDate: string | null;
}

interface Row {
  id: string;
  partner_id: string;
  type: PartnerTouchType;
  notes: string;
  duration_minutes: number | null;
  occurred_at: string;
  follow_up_date: string | null;
}

function toTouch(r: Row): PartnerTouch {
  return {
    id: r.id,
    partnerId: r.partner_id,
    type: r.type,
    notes: r.notes,
    durationMinutes: r.duration_minutes,
    occurredAt: r.occurred_at,
    followUpDate: r.follow_up_date
      ? new Date(r.follow_up_date + "T00:00:00Z").toISOString()
      : null,
  };
}

export const PARTNER_ACTIVITIES_QUERY_KEY = (
  userId: string | undefined,
  partnerId: string,
) => ["partnerActivities", "byPartner", userId ?? "anon", partnerId] as const;

export function usePartnerActivities(partnerId: string | undefined) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PARTNER_ACTIVITIES_QUERY_KEY(userId, partnerId ?? "none"),
    enabled: Boolean(userId && partnerId),
    queryFn: async (): Promise<PartnerTouch[]> => {
      const { data, error } = await supabase
        .from("partner_activities")
        .select(
          "id, partner_id, type, notes, duration_minutes, occurred_at, follow_up_date",
        )
        .eq("partner_id", partnerId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toTouch(r as unknown as Row));
    },
    staleTime: 30_000,
  });
}
