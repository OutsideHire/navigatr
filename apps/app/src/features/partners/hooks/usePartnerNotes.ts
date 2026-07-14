/**
 * usePartnerNotes — read a partner's append-only note feed (newest first).
 *
 * RLS scopes rows to the org. The author's display name is embedded from
 * profiles via the created_by FK (profiles_select already allows reading
 * teammates in the same org); it's null when the profile isn't visible.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { PartnerNote } from "../partnerNotes";

interface Row {
  id: string;
  partner_id: string;
  created_by: string;
  body: string;
  created_at: string;
  updated_at: string;
  // PostgREST embed of the created_by → profiles FK (to-one → object|null).
  author: { full_name: string | null } | null;
}

function toNote(r: Row): PartnerNote {
  return {
    id: r.id,
    partnerId: r.partner_id,
    createdBy: r.created_by,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorName: r.author?.full_name ?? null,
  };
}

export const PARTNER_NOTES_QUERY_KEY = (
  userId: string | undefined,
  partnerId: string,
) => ["partnerNotes", "byPartner", userId ?? "anon", partnerId] as const;

export function usePartnerNotes(partnerId: string | undefined) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PARTNER_NOTES_QUERY_KEY(userId, partnerId ?? "none"),
    enabled: Boolean(userId && partnerId),
    queryFn: async (): Promise<PartnerNote[]> => {
      const { data, error } = await supabase
        .from("partner_notes")
        .select(
          "id, partner_id, created_by, body, created_at, updated_at, " +
            "author:profiles!partner_notes_created_by_fkey(full_name)",
        )
        .eq("partner_id", partnerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => toNote(r as unknown as Row));
    },
    staleTime: 30_000,
  });
}
