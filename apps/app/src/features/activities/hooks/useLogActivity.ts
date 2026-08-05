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
import { taskFromOutcome } from "../lib/taskFromOutcome";
import { bandsFromTarget } from "../lib/taskBands";
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
  /** Storage path of an uploaded voice note (private bucket); null when none. */
  voiceNoteUrl?: string | null;
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
          voice_note_url:   input.voiceNoteUrl ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const activityId = data.id as string;

      // Task sync (SP1). Best-effort: the activity + follow_up_date remain the
      // durable signal Follow-Up Discipline reads, so a task hiccup must never
      // fail the logged activity or move the score. Tasks are a derived
      // convenience the Activities screen + bell render.
      try {
        // Auto-close a matching open task of the same type on this deal
        // (preserves today's supersession behavior, now explicit).
        const { data: openTask } = await supabase
          .from("task")
          .select("id")
          .eq("deal_id", input.dealId)
          .eq("type", input.type)
          .eq("status", "open")
          .order("target_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (openTask?.id) {
          await supabase
            .from("task")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", openTask.id as string);
          await supabase
            .from("activities")
            .update({ closed_task_id: openTask.id })
            .eq("id", activityId);
        }
        // Create the next follow-up task(s). target_at mirrors the stored
        // follow_up_date exactly (score-stability contract).
        if (followUpDateOnly) {
          const { data: deal } = await supabase
            .from("deals")
            .select("company_name")
            .eq("id", input.dealId)
            .maybeSingle();
          const dealName = (deal?.company_name as string) ?? "Follow-up";
          const baseRow = {
            org_id: profile.data.org_id,
            owner_id: userId,
            deal_id: input.dealId,
            status: "open" as const,
            date_source: "interval" as const,
            source_activity_id: activityId,
            source_outcome: input.disposition as string,
            title: dealName,
          };
          if (input.disposition === "send_info") {
            // The one compound in the platform: get the info out today (Email),
            // then follow up on it (Call at the 3-day interval). Independent.
            const today = new Date().toISOString().slice(0, 10);
            const emailBands = bandsFromTarget(today, 1)!;
            const callBands = bandsFromTarget(followUpDateOnly, 3)!;
            await supabase.from("task").insert([
              { ...baseRow, type: "email", earliest_at: emailBands.earliest_at, target_at: emailBands.target_at, latest_at: emailBands.latest_at, original_target_at: emailBands.target_at },
              { ...baseRow, type: "call", earliest_at: callBands.earliest_at, target_at: callBands.target_at, latest_at: callBands.latest_at, original_target_at: callBands.target_at },
            ]);
          } else {
            const fields = taskFromOutcome(input.type, input.disposition, followUpDateOnly, dealName);
            if (fields) {
              await supabase.from("task").insert({
                ...baseRow,
                type: fields.type,
                earliest_at: fields.earliest_at,
                target_at: fields.target_at,
                latest_at: fields.latest_at,
                original_target_at: fields.original_target_at,
              });
            }
          }
        }
      } catch (taskErr) {
        console.error("[useLogActivity] task sync failed (activity still saved)", taskErr);
      }

      return { id: activityId };
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
      // 4. Tasks list (Activities screen + bell) picks up the created/closed tasks.
      void queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });
    },
  });
}
