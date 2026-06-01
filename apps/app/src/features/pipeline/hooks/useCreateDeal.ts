/**
 * useCreateDeal — INSERT a new deal via Supabase.
 *
 * Input is the camelCase Deal shape the form already builds. We translate
 * to snake_case + extract org_id from the user's profile (the RLS
 * with-check ALSO enforces this; sending the wrong org_id would 403).
 *
 * Profession-specific fields (annualVolume, acceptanceMethods, etc.) live
 * under `profession_data` JSONB — the form already groups them, so the
 * caller just passes an object.
 *
 * On success: invalidate the deals list so the new row appears.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { DEALS_QUERY_KEY } from "./useDeals";
import type { DealStage } from "../mockData";

export interface CreateDealInput {
  companyName: string;
  address?: string;
  industry?: string;
  employeeCountRange?: string;
  contactName: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone: string;
  valueCents?: number;
  stage: DealStage;
  probability: number;
  expectedClose?: string | null;     // ISO date
  leadSource?: string;
  notes?: string;
  nextFollowupAt?: string | null;    // ISO timestamp
  professionData?: Record<string, unknown>;
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: CreateDealInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) throw new Error("Profile not loaded — cannot create deal");

      const { data, error } = await supabase
        .from("deals")
        .insert({
          org_id:              profile.data.org_id,
          owner_id:            userId,
          company_name:        input.companyName,
          address:             input.address ?? null,
          industry:            input.industry ?? null,
          employee_count_range: input.employeeCountRange ?? null,
          contact_name:        input.contactName,
          contact_title:       input.contactTitle ?? null,
          contact_email:       input.contactEmail ?? null,
          contact_phone:       input.contactPhone,
          value_cents:         input.valueCents ?? null,
          stage:               input.stage,
          probability:         input.probability,
          expected_close:      input.expectedClose ?? null,
          lead_source:         input.leadSource ?? null,
          notes:               input.notes ?? null,
          next_followup_at:    input.nextFollowupAt ?? null,
          profession_data:     input.professionData ?? {},
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: () => {
      // Trigger refetch of the list so the new deal appears.
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    },
  });
}
