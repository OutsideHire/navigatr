/**
 * useUpdateActivity — partial UPDATE on the activities table.
 *
 * Mirror of useUpdateDeal: pick the editable columns, translate camelCase
 * → snake_case, send only the keys the caller specified. RLS allows
 * rep-own / manager-any; with-check pins org_id so we never need to
 * send it.
 *
 * The activities_sync_deal_denorm trigger recomputes the parent deal's
 * last_activity_at + next_followup_at after any UPDATE — so we invalidate
 * the deals list cache regardless of which fields changed.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ACTIVITIES_ORG_QUERY_KEY, ACTIVITIES_QUERY_KEY } from "./useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { ActivityType } from "../mockData";
import type { Disposition } from "@/lib/followUpScheduling";

export interface UpdateActivityInput {
  id: string;
  /** Required so we can invalidate the per-deal cache. */
  dealId: string;
  patch: {
    type?: ActivityType;
    disposition?: Disposition;
    durationMinutes?: number | null;
    outcomeNotes?: string;
    occurredAt?: string;
    /** ISO timestamp or null; we slice to DATE before sending. */
    followUpDate?: string | null;
  };
}

function toSnakeCase(patch: UpdateActivityInput["patch"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.type !== undefined)            out.type = patch.type;
  if (patch.disposition !== undefined)     out.disposition = patch.disposition;
  if (patch.durationMinutes !== undefined) out.duration_minutes = patch.durationMinutes;
  if (patch.outcomeNotes !== undefined)    out.outcome_notes = patch.outcomeNotes;
  if (patch.occurredAt !== undefined)      out.occurred_at = patch.occurredAt;
  if (patch.followUpDate !== undefined) {
    // follow_up_date is a DATE column; strip the time portion.
    out.follow_up_date = patch.followUpDate ? patch.followUpDate.slice(0, 10) : null;
  }
  return out;
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: UpdateActivityInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");

      const snakePatch = toSnakeCase(input.patch);
      if (Object.keys(snakePatch).length === 0) return;

      const { error } = await supabase
        .from("activities")
        .update(snakePatch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_QUERY_KEY(userId, variables.dealId),
      });
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_ORG_QUERY_KEY(userId),
      });
      // Parent deal's last_activity_at / next_followup_at may have shifted.
      void queryClient.invalidateQueries({
        queryKey: DEALS_QUERY_KEY(userId),
      });
    },
  });
}
