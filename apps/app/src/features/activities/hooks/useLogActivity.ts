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
import type { LogConfirmation, LogConfirmationTask } from "../lib/logConfirmation";
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
  /** Where the follow-up date came from. "asserted" (a person named the date,
   *  e.g. a Callback promised time) collapses the task's band to that date and
   *  keeps Path from moving it. Defaults to "interval". */
  followUpDateSource?: "interval" | "asserted";
  /** Overrides the generated task's title (e.g. Verbal commitment's next step). */
  taskTitle?: string;
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: LogActivityInput): Promise<{ id: string; confirmation: LogConfirmation }> => {
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

      // Post-log confirmation summary (SP2/Screen Content Spec §5): what the log
      // actually created, returned so the sheet can explain it to the rep.
      const createdTasks: LogConfirmationTask[] = [];
      const recordEffects: string[] = [];

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
            source_activity_id: activityId,
            source_outcome: input.disposition as string,
            // Verbal commitment's next-step text (etc.) overrides the title.
            title: input.taskTitle?.trim() || dealName,
          };
          if (input.followUpDateSource === "asserted") {
            // A person named the date (Callback promised time). Collapsed band,
            // pinned — Path (SP3) never moves it. Handles callback, whose
            // interval is null so taskFromOutcome would otherwise skip it.
            await supabase.from("task").insert({
              ...baseRow,
              type: input.type,
              date_source: "asserted",
              earliest_at: followUpDateOnly,
              target_at: followUpDateOnly,
              latest_at: followUpDateOnly,
              original_target_at: followUpDateOnly,
            });
            createdTasks.push({ type: input.type, title: baseRow.title, targetAt: followUpDateOnly });
          } else if (input.disposition === "send_info") {
            // The one compound in the platform: get the info out today (Email),
            // then follow up on it (Call at the 3-day interval). Independent.
            const today = new Date().toISOString().slice(0, 10);
            const emailBands = bandsFromTarget(today, 1)!;
            const callBands = bandsFromTarget(followUpDateOnly, 3)!;
            await supabase.from("task").insert([
              { ...baseRow, type: "email", date_source: "interval", earliest_at: emailBands.earliest_at, target_at: emailBands.target_at, latest_at: emailBands.latest_at, original_target_at: emailBands.target_at },
              { ...baseRow, type: "call", date_source: "interval", earliest_at: callBands.earliest_at, target_at: callBands.target_at, latest_at: callBands.latest_at, original_target_at: callBands.target_at },
            ]);
            createdTasks.push({ type: "email", title: baseRow.title, targetAt: emailBands.target_at });
            createdTasks.push({ type: "call", title: baseRow.title, targetAt: callBands.target_at });
          } else {
            const fields = taskFromOutcome(input.type, input.disposition, followUpDateOnly, dealName);
            if (fields) {
              await supabase.from("task").insert({
                ...baseRow,
                type: fields.type,
                date_source: "interval",
                earliest_at: fields.earliest_at,
                target_at: fields.target_at,
                latest_at: fields.latest_at,
                original_target_at: fields.original_target_at,
              });
              createdTasks.push({ type: fields.type, title: baseRow.title, targetAt: fields.target_at });
            }
          }
        }

        // Record-state effects (SP2 §7). Flags + suppression + stage advance.
        // These run regardless of a follow-up (terminal outcomes have none).
        const nowIso = new Date().toISOString();
        if (input.disposition === "bad_number") {
          await supabase.from("deals").update({ contact_phone_invalid: true }).eq("id", input.dealId);
          recordEffects.push("Phone number flagged as invalid");
        } else if (input.disposition === "bad_address") {
          await supabase.from("deals").update({ contact_email_invalid: true }).eq("id", input.dealId);
          recordEffects.push("Email address flagged as invalid");
        } else if (input.disposition === "do_not_call") {
          await supabase.from("deals").update({ do_not_call: true }).eq("id", input.dealId);
          await supabase.from("task").update({ status: "cancelled", cancelled_at: nowIso })
            .eq("deal_id", input.dealId).eq("type", "call").eq("status", "open");
          recordEffects.push("Marked Do Not Call; open call follow-ups cancelled");
        } else if (input.disposition === "unsubscribed") {
          await supabase.from("deals").update({ email_opt_out: true }).eq("id", input.dealId);
          await supabase.from("task").update({ status: "cancelled", cancelled_at: nowIso })
            .eq("deal_id", input.dealId).eq("type", "email").eq("status", "open");
          recordEffects.push("Marked email opt-out; open email follow-ups cancelled");
        } else if (input.disposition === "verbal_commitment") {
          // Advance to Proposal, never regress and never set won.
          const { data: d } = await supabase.from("deals").select("stage").eq("id", input.dealId).maybeSingle();
          const stage = d?.stage as string | undefined;
          if (stage === "new" || stage === "contacted" || stage === "qualified") {
            await supabase.from("deals").update({ stage: "proposal" }).eq("id", input.dealId);
            recordEffects.push("Deal advanced to Proposal");
          }
        }
      } catch (taskErr) {
        console.error("[useLogActivity] task sync failed (activity still saved)", taskErr);
      }

      return {
        id: activityId,
        confirmation: {
          activityType: input.type,
          createdTasks,
          compound: input.disposition === "send_info",
          recordEffects,
        },
      };
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
