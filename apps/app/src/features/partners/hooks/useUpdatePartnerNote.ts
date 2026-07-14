/**
 * useUpdatePartnerNote — edit a note's text.
 *
 * RLS (partner_notes_update) is the real guard: author only. The UI hides the
 * affordance otherwise (see canEditNote). Editing a note is not contact, so
 * onSuccess invalidates ONLY the per-partner notes query.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNER_NOTES_QUERY_KEY } from "./usePartnerNotes";

export interface UpdatePartnerNoteInput {
  noteId: string;
  partnerId: string;
  body: string;
}

export function useUpdatePartnerNote() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: UpdatePartnerNoteInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("partner_notes")
        .update({ body: input.body })
        .eq("id", input.noteId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: PARTNER_NOTES_QUERY_KEY(userId, variables.partnerId),
      });
    },
  });
}
