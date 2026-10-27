/**
 * A referral's full history for reps: every status change plus reassignments
 * (FR-PORT-60). Reads go through the referral_status_history RLS policy
 * (visible when the referral is). The partner portal never reads this table,
 * it uses portal_referral_history, which leaves reassignments out.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ReferralStatus } from "../lib/referrals";

export interface ReferralHistoryEntry {
  id: string;
  fromStatus: ReferralStatus | null;
  toStatus: ReferralStatus;
  actorType: "user" | "partner" | "system";
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  from_status: ReferralStatus | null;
  to_status: ReferralStatus;
  actor_type: "user" | "partner" | "system";
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export function referralHistoryKey(referralId: string) {
  return ["referrals", "history", referralId] as const;
}

export function useReferralHistory(referralId: string | undefined) {
  return useQuery({
    queryKey: referralHistoryKey(referralId ?? "none"),
    enabled: Boolean(referralId),
    queryFn: async (): Promise<ReferralHistoryEntry[]> => {
      const { data, error } = await supabase
        .from("referral_status_history")
        .select("id, from_status, to_status, actor_type, actor_id, note, created_at")
        .eq("referral_id", referralId as string)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];

      // actor_id has no foreign key, so names come from a second read. A failed
      // name lookup only costs the names, never the history.
      const ids = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
      const names = new Map<string, string | null>();
      if (ids.length > 0) {
        const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name);
      }

      return rows.map((r) => ({
        id: r.id,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        actorType: r.actor_type,
        actorName: r.actor_id ? names.get(r.actor_id) ?? null : null,
        note: r.note,
        createdAt: r.created_at,
      }));
    },
    staleTime: 30_000,
  });
}
