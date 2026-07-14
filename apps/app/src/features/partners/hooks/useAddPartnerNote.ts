/**
 * useAddPartnerNote — append a note to a partner.
 *
 * A note is NOT contact, so onSuccess invalidates ONLY the per-partner notes
 * query — never the partners list (which would imply last_touch_at changed).
 * org_id is passed explicitly (belt-and-suspenders; the DB trigger also
 * overwrites it from the partner) and the insert RLS enforces created_by.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { PARTNER_NOTES_QUERY_KEY } from "./usePartnerNotes";

export interface AddPartnerNoteInput {
  partnerId: string;
  body: string;
}

export function useAddPartnerNote() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: AddPartnerNoteInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) {
        throw new Error("Profile not loaded — cannot add note");
      }
      const { error } = await supabase.from("partner_notes").insert({
        org_id:     profile.data.org_id,
        partner_id: input.partnerId,
        created_by: userId,
        body:       input.body,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: PARTNER_NOTES_QUERY_KEY(userId, variables.partnerId),
      });
    },
  });
}
