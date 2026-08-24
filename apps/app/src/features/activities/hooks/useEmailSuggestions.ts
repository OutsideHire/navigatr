/**
 * useEmailSuggestions — the rep's own auto-captured sent emails that matched a
 * deal and are awaiting one-tap confirm (email_activity.status = 'suggested').
 * Source for the "Suggested from email" section on the Activities page
 * (Email Capture Phase 1, Slice 5b, D-07).
 *
 * Scoped to the caller: email_activity RLS lets an admin read the org's rows,
 * but this list is rep-facing and confirm/dismiss are sender-gated, so we also
 * filter sender_user_id = auth.uid() here. Company names come from useDeals.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import {
  buildEmailSuggestionViews,
  type EmailSuggestionRow,
} from "../lib/emailSuggestions";

export const EMAIL_SUGGESTIONS_QUERY_KEY = (userId: string | undefined) =>
  ["email-suggestions", userId ?? "anon"] as const;

const SUGGESTION_SELECT =
  "id, subject, recipients, sent_at, matched_deal_id, deep_link_url";

export function useEmailSuggestions() {
  const userId = useAuth((s) => s.user?.id);
  const deals = useDeals();

  return useQuery({
    queryKey: EMAIL_SUGGESTIONS_QUERY_KEY(userId),
    // Wait for deals so the company-name join is populated (mirrors the
    // unlogged-dials hook, which pins "Unknown deal" if it resolves first).
    enabled: Boolean(userId) && deals.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_activity")
        .select(SUGGESTION_SELECT)
        .eq("sender_user_id", userId as string)
        .eq("status", "suggested")
        .order("sent_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as EmailSuggestionRow[];
      const nameOf = new Map((deals.data ?? []).map((d) => [d.id, d.companyName]));
      return buildEmailSuggestionViews(rows, nameOf);
    },
    staleTime: 30_000,
  });
}
