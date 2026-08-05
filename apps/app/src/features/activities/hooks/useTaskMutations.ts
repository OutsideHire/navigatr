/**
 * useTaskMutations — create / complete / cancel / snooze a Task.
 *
 * Snooze shifts the three working band dates forward preserving width, bumps
 * snooze_count, and NEVER touches original_target_at (the accountability date)
 * or activities.follow_up_date (the score signal). Completion and Cancel set
 * their timestamps. Every mutation invalidates the tasks list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addBusinessDays, format, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { type Task, type TaskDateSource } from "../tasks/taskTypes";
import { type TaskType } from "../lib/isProspectTouch";

export interface CreateTaskInput {
  type: TaskType;
  title: string;
  dealId: string | null;
  targetAt: string;
  earliestAt: string;
  latestAt: string;
  originalTargetAt: string;
  dateSource?: TaskDateSource;
  startAt?: string | null;
  reminderAt?: string | null;
  priority?: string | null;
  repeatRule?: string | null;
  sourceActivityId?: string | null;
  sourceOutcome?: string | null;
}

const shift = (iso: string, days: number) =>
  format(addBusinessDays(parseISO(iso.slice(0, 10)), days), "yyyy-MM-dd");

export function useTaskMutations() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });

  const createTask = useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");
      if (!profile.data?.org_id) throw new Error("Profile not loaded — cannot create task");
      const { data, error } = await supabase
        .from("task")
        .insert({
          org_id: profile.data.org_id,
          owner_id: userId,
          type: input.type,
          title: input.title,
          deal_id: input.dealId,
          status: "open",
          earliest_at: input.earliestAt,
          target_at: input.targetAt,
          latest_at: input.latestAt,
          original_target_at: input.originalTargetAt,
          date_source: input.dateSource ?? "interval",
          start_at: input.startAt ?? null,
          reminder_at: input.reminderAt ?? null,
          priority: input.priority ?? null,
          repeat_rule: input.repeatRule ?? null,
          source_activity_id: input.sourceActivityId ?? null,
          source_outcome: input.sourceOutcome ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: invalidate,
  });

  const completeTask = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("task")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const cancelTask = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("task")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const snoozeTask = useMutation({
    mutationFn: async ({ task, businessDays }: { task: Task; businessDays: number }): Promise<void> => {
      const { error } = await supabase
        .from("task")
        .update({
          earliest_at: shift(task.earliestAt, businessDays),
          target_at: shift(task.targetAt, businessDays),
          latest_at: shift(task.latestAt, businessDays),
          snooze_count: task.snoozeCount + 1,
          // original_target_at intentionally untouched.
        })
        .eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { createTask, completeTask, cancelTask, snoozeTask };
}
