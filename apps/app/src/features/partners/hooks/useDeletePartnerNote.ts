/**
 * useDeletePartnerNote — remove a note.
 *
 * RLS (partner_notes_delete) is the real guard: author OR manager/admin. The
 * UI hides the affordance otherwise (see canDeleteNote). partnerId is passed
 * so we can invalidate the right per-partner notes query.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNER_NOTES_QUERY_KEY } from "./usePartnerNotes";

export interface DeletePartnerNoteInput {
  noteId: string;
  partnerId: string;
}

export function useDeletePartnerNote() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: DeletePartnerNoteInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("partner_notes")
        .delete()
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
