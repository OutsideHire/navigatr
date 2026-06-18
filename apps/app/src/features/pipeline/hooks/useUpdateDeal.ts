/**
 * useUpdateDeal — partial UPDATE on the deals table.
 *
 * Single entry point for any deal-field edit: stage, value, contact,
 * notes, etc. RLS update policy enforces rep-own / manager-any.
 *
 * org_id, owner_id, id are intentionally NOT editable — they're identity
 * + tenancy; mutating them would break audit / RLS isolation.
 *
 * Stage transitions are recorded by the deal_stage_history trigger
 * automatically; no extra work needed here.
 *
 * On success: invalidate the deals list (the pipeline page + dashboard
 * KPIs read from it) and the stage history (the funnel rolls up from
 * there).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "./useDeals";
import { STAGE_HISTORY_QUERY_KEY } from "./useStageHistory";
import type { DealStage, LostReasonCategory } from "../mockData";

export interface UpdateDealInput {
  id: string;
  patch: {
    stage?: DealStage;
    probability?: number;
    companyName?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactTitle?: string;
    address?: string;
    industry?: string;
    employeeCountRange?: string;
    valueCents?: number;
    expectedClose?: string | null;
    leadSource?: string;
    notes?: string;
    nextFollowupAt?: string | null;
    lostReasonCategory?: LostReasonCategory | null;
    lostReasonNotes?: string | null;
    professionData?: Record<string, unknown>;
  };
}

/** Map the camelCase patch keys to the snake_case columns Supabase wants.
 *  Centralizing this keeps consumers from having to know the DB schema. */
function toSnakeCase(patch: UpdateDealInput["patch"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.stage !== undefined)              out.stage = patch.stage;
  if (patch.probability !== undefined)        out.probability = patch.probability;
  if (patch.companyName !== undefined)        out.company_name = patch.companyName;
  if (patch.contactName !== undefined)        out.contact_name = patch.contactName;
  if (patch.contactPhone !== undefined)       out.contact_phone = patch.contactPhone;
  if (patch.contactEmail !== undefined)       out.contact_email = patch.contactEmail;
  if (patch.contactTitle !== undefined)       out.contact_title = patch.contactTitle;
  if (patch.address !== undefined)            out.address = patch.address;
  if (patch.industry !== undefined)           out.industry = patch.industry;
  if (patch.employeeCountRange !== undefined) out.employee_count_range = patch.employeeCountRange;
  if (patch.valueCents !== undefined)         out.value_cents = patch.valueCents;
  if (patch.expectedClose !== undefined)      out.expected_close = patch.expectedClose;
  if (patch.leadSource !== undefined)         out.lead_source = patch.leadSource;
  if (patch.notes !== undefined)              out.notes = patch.notes;
  if (patch.nextFollowupAt !== undefined)     out.next_followup_at = patch.nextFollowupAt;
  // Send even when value is null so we can clear the columns.
  if ("lostReasonCategory" in patch)          out.lost_reason_category = patch.lostReasonCategory;
  if ("lostReasonNotes" in patch)             out.lost_reason_notes = patch.lostReasonNotes;
  if (patch.professionData !== undefined)     out.profession_data = patch.professionData;
  return out;
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: UpdateDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const snakePatch = toSnakeCase(input.patch);
      if (Object.keys(snakePatch).length === 0) return; // No-op

      const { error } = await supabase
        .from("deals")
        .update(snakePatch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      // Pipeline + dashboard
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
      // Funnel — stage_history trigger writes a row whenever stage changes
      if (variables.patch.stage !== undefined) {
        void queryClient.invalidateQueries({ queryKey: STAGE_HISTORY_QUERY_KEY(userId) });
      }
    },
  });
}
