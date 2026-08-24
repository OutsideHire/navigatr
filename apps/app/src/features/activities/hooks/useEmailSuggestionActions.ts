/**
 * useConfirmEmailSuggestion / useDismissEmailSuggestion — the rep's one-tap
 * response to a suggested auto-captured email (Email Capture Phase 1, Slice 5b).
 *
 * Both call sender-gated SECURITY DEFINER RPCs (migration 20260820000011):
 *  - confirm_email_suggestion(p_id) -> new activity id: creates the activity,
 *    links it, flips status to 'confirmed' (idempotent).
 *  - dismiss_email_suggestion(p_id): flips status to 'dismissed', no activity.
 *
 * email_activity has no client write policy, so these RPCs are the only path
 * and a rep can only act on their own suggestions. On success both refresh the
 * suggestions list; confirm also invalidates the activities lists so the newly
 * created activity appears.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { EMAIL_SUGGESTIONS_QUERY_KEY } from "./useEmailSuggestions";

export function useConfirmEmailSuggestion() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await supabase.rpc("confirm_email_suggestion", { p_id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EMAIL_SUGGESTIONS_QUERY_KEY(userId) });
      // Both activities query keys share the ["activities", ...] prefix.
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useDismissEmailSuggestion() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc("dismiss_email_suggestion", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EMAIL_SUGGESTIONS_QUERY_KEY(userId) });
    },
  });
}
