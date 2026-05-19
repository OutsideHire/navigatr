/**
 * useLogActivity — INSERT into activities for the current deal.
 *
 * RLS with-check enforces org_id = user_org_id() and logged_by = auth.uid().
 * The org-consistency trigger on activities also overwrites org_id from
 * the parent deal — so even a malformed payload from the client is
 * neutralized server-side.
 *
 * On success: invalidate the per-deal activities cache AND the deals list
 * cache (the sync trigger updates deals.last_activity_at + next_followup_at,
 * which the pipeline list renders).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { ACTIVITIES_ORG_QUERY_KEY, ACTIVITIES_QUERY_KEY } from "./useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { ActivityType } from "../mockData";
import type { Disposition } from "@/lib/followUpScheduling";

export interface LogActivityInput {
  dealId: string;
  type: ActivityType;
  disposition: Disposition;
  durationMinutes?: number | null;
  outcomeNotes?: string;
  /** Defaults to now() server-side if omitted. */
  occurredAt?: string;
  /** ISO timestamp from the frontend scheduler; we convert to DATE here. */
  followUpDate?: string | null;
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: LogActivityInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) throw new Error("Profile not loaded — cannot log activity");

      // follow_up_date is a DATE column; strip the time portion. Frontend
      // schedulers return either a full ISO timestamp or null.
      const followUpDateOnly = input.followUpDate
        ? input.followUpDate.slice(0, 10)
        : null;

      const { data, error } = await supabase
        .from("activities")
        .insert({
          // org_id is required by the with-check policy but the consistency
          // trigger overwrites it from the parent deal anyway. Sending the
          // user's profile org keeps the RLS check happy.
          org_id:           profile.data.org_id,
          deal_id:          input.dealId,
          logged_by:        userId,
          type:             input.type,
          disposition:      input.disposition,
          duration_minutes: input.durationMinutes ?? null,
          outcome_notes:    input.outcomeNotes ?? "",
          occurred_at:      input.occurredAt ?? new Date().toISOString(),
          follow_up_date:   followUpDateOnly,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_data, variables) => {
      // 1. Per-deal activity timeline picks up the new row.
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_QUERY_KEY(userId, variables.dealId),
      });
      // 2. Org-wide activity feed (the /activities page) picks it up too.
      void queryClient.invalidateQueries({
        queryKey: ACTIVITIES_ORG_QUERY_KEY(userId),
      });
      // 3. Deals list: the activities sync trigger updated the parent
      //    deal's last_activity_at + next_followup_at. Pipeline cards
      //    render those columns, so refetch.
      void queryClient.invalidateQueries({
        queryKey: DEALS_QUERY_KEY(userId),
      });
    },
  });
}
