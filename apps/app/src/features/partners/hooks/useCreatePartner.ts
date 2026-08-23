/**
 * useCreatePartner — INSERT a new partner.
 *
 * RLS with-check enforces org_id = user_org_id() and created_by = auth.uid()
 * server-side. We send what we have and trust the gate.
 *
 * owner_id is stamped to the creating rep (Bundle 2, FR-HIER-05). It is NOT
 * NULL on the table, drives hierarchy visibility (partners_select ->
 * user_can_see_owner), and starts equal to created_by; a later bundle can add
 * reassignment. created_by stays as the immutable audit trail.
 *
 * On success: invalidate the partners list so the new row appears.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import type { PartnerStatus, PartnerType } from "../mockData";

export interface CreatePartnerInput {
  name: string;
  company: string;
  type: PartnerType;
  status?: PartnerStatus;
  phone?: string;
  email?: string;
  city?: string;
  notes?: string;
}

export function useCreatePartner() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: CreatePartnerInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) throw new Error("Profile not loaded — cannot create partner");

      const { data, error } = await supabase
        .from("partners")
        .insert({
          org_id:     profile.data.org_id,
          created_by: userId,
          owner_id:   userId,
          name:       input.name,
          company:    input.company,
          type:       input.type,
          status:     input.status ?? "active",
          phone:      input.phone ?? null,
          email:      input.email ?? null,
          city:       input.city ?? null,
          notes:      input.notes ?? "",
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    },
  });
}
