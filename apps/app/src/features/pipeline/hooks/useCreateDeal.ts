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
import { useFollowupSync } from "@/features/appointments/useFollowupSync";
import { DEALS_QUERY_KEY } from "./useDeals";
import type { DealStage } from "../mockData";

/**
 * Thrown by useCreateDeal when the deals_org_place_active_uidx partial unique
 * index rejects the insert, i.e. an ACTIVE deal for this place_id already exists
 * in the org. Callers catch this to show a friendly de-dupe message instead of a
 * raw database error.
 */
export class DuplicateDealError extends Error {
  constructor() {
    super("This business is already in your team's pipeline.");
    this.name = "DuplicateDealError";
  }
}

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
  /** Google place_id of the source prospect. Present for deals created from Path
   *  discovery; null for manually-entered deals. Anchors org-wide de-duplication. */
  placeId?: string;
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const { syncFollowup } = useFollowupSync();

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
          place_id:            input.placeId ?? null,
        })
        .select("id")
        .single();
      if (error) {
        // Postgres unique_violation from deals_org_place_active_uidx: this
        // business is already an ACTIVE deal somewhere in the org. Surface a
        // typed error so callers can show a calm "already in pipeline" message.
        if (error.code === "23505") {
          throw new DuplicateDealError();
        }
        throw error;
      }
      return { id: data.id as string };
    },
    onSuccess: (data, variables) => {
      // Trigger refetch of the list so the new deal appears.
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
      // If the deal was created with a follow-up date, reconcile it to an
      // all-day calendar event right away — nothing else fires sync on the
      // create path. Only when a follow-up was actually set. Fire-and-forget.
      if (variables.nextFollowupAt) {
        void syncFollowup(data.id);
      }
    },
  });
}
