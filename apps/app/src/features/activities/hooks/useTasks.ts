/**
 * useTasks — the caller's OWN tasks. Feeds the Activities screen and the
 * notification bell. Returns open tasks by default.
 *
 * THE OWNER FILTER IS LOAD-BEARING, NOT BELT AND BRACES. The `task` table's
 * RLS policy is `org_id = public.user_org_id()` and nothing more: the Roles
 * bundles routed deals, activities and partners through the hierarchy check
 * and never touched task. So "what RLS allows" is EVERY task in the ISO, for
 * every role, and a screen that renders it unfiltered is not a personal queue.
 * That is what put one rep's follow-ups in an administrator's queue on
 * production, where logging them closed them.
 *
 * Scoping here rather than in the page also fixes every derived number at
 * once: the "N tasks due today" subhead, the Today/Upcoming tab chips, the
 * aging alarm and the bell all reduce over this one array.
 *
 * Same pattern, and the same reason, as useAppointments' `.eq("owner_id",
 * userId)`; see its docblock.
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
      if (!userId) return [];
      let q = supabase.from("task").select(TASK_SELECT).eq("owner_id", userId);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q.order("target_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as TaskRow[]).map(rowToTask);
    },
  });
  return { tasks: query.data ?? [], isLoading: query.isLoading };
}
