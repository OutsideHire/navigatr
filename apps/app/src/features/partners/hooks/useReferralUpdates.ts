/**
 * Updates a rep shares with the referring partner (Partner Portal Phase 1C,
 * spec 5.7, FR-PORT-74). Reads go through the referral_updates RLS policy
 * (visible when the referral is); writes go only through
 * publish_referral_update, which re-checks rights and queues the partner email.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { referralErrorMessage } from "../lib/referrals";

/** Same limit as the referral_updates.body check in the database. */
export const REFERRAL_UPDATE_MAX = 1000;

export interface ReferralUpdate {
  id: string;
  body: string;
  publishedAt: string;
  authorName: string | null;
}

interface Row {
  id: string;
  body: string;
  published_at: string;
  author: { full_name: string | null } | null;
}

export function referralUpdatesKey(referralId: string) {
  return ["referrals", "updates", referralId] as const;
}

export function useReferralUpdates(referralId: string | undefined) {
  return useQuery({
    queryKey: referralUpdatesKey(referralId ?? "none"),
    enabled: Boolean(referralId),
    queryFn: async (): Promise<ReferralUpdate[]> => {
      const { data, error } = await supabase
        .from("referral_updates")
        .select("id, body, published_at, author:profiles(full_name)")
        .eq("referral_id", referralId as string)
        .order("published_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        body: r.body,
        publishedAt: r.published_at,
        authorName: r.author?.full_name ?? null,
      }));
    },
    staleTime: 30_000,
  });
}

export function usePublishReferralUpdate(referralId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string): Promise<string> => {
      const { data, error } = await supabase.rpc("publish_referral_update", {
        p_referral_id: referralId,
        p_body: body.trim(),
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't share the update"));
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralUpdatesKey(referralId) });
    },
  });
}
