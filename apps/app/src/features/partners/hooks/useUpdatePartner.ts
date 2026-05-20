/**
 * useUpdatePartner — partial UPDATE on the partners table.
 *
 * Accepts any subset of editable columns. RLS update policy enforces
 * org_id stays in the user's org; the rep can only edit partners they
 * created, managers/admins can edit any in the org.
 *
 * org_id and created_by are intentionally NOT editable here — moving a
 * partner between orgs would be a data-leak; re-assigning creation is
 * audit-trail-only and shouldn't be a frontend feature.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import type { PartnerStatus, PartnerType } from "../mockData";

export interface UpdatePartnerInput {
  id: string;
  /** Any subset of these is fair game. */
  patch: {
    name?: string;
    company?: string;
    type?: PartnerType;
    status?: PartnerStatus;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    notes?: string;
  };
}

export function useUpdatePartner() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: UpdatePartnerInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const { error } = await supabase
        .from("partners")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    },
  });
}
