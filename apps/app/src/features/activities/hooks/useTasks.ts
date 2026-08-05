/**
 * useTasks — list the caller's tasks (RLS scopes to the org; the Activities
 * screen and the notification bell read from here). Returns open tasks by
 * default. Replaces the in-memory deriveTasks() view over activities.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { TASK_SELECT, rowToTask, type Task, type TaskStatus, type TaskRow } from "../tasks/taskTypes";

export const TASKS_QUERY_KEY = (userId: string | undefined, status: TaskStatus | "all") =>
  ["tasks", userId ?? "anon", status] as const;

export function useTasks(status: TaskStatus | "all" = "open"): {
  tasks: Task[];
  isLoading: boolean;
} {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: TASKS_QUERY_KEY(userId, status),
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<Task[]> => {
      let q = supabase.from("task").select(TASK_SELECT);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q.order("target_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as TaskRow[]).map(rowToTask);
    },
  });
  return { tasks: query.data ?? [], isLoading: query.isLoading };
}
