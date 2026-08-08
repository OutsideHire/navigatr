// useTasks + useTaskMutations. Verifies row mapping, the status filter, and that
// snooze preserves original_target_at (accountability date) while shifting the
// working band and bumping snooze_count. Supabase is mocked as a chainable builder.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTasks } from "./useTasks";
import { useTaskMutations } from "./useTaskMutations";
import { type Task } from "../tasks/taskTypes";

let readData: unknown[];
let eqCalls: Array<[string, unknown]>;
let updatePayload: Record<string, unknown> | null;
let insertPayload: Record<string, unknown> | null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        // update().eq() is terminal; read select().eq().order() continues.
        return updatePayload ? Promise.resolve({ error: null }) : builder;
      };
      builder.order = () => Promise.resolve({ data: readData, error: null });
      builder.single = () => Promise.resolve({ data: { id: "t-new" }, error: null });
      builder.insert = (p: Record<string, unknown>) => {
        insertPayload = p;
        return builder;
      };
      builder.update = (p: Record<string, unknown>) => {
        updatePayload = p;
        return builder;
      };
      return builder;
    },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  readData = [];
  eqCalls = [];
  updatePayload = null;
  insertPayload = null;
});

const TASK: Task = {
  id: "t-1", orgId: "org-1", ownerId: "user-1", type: "call", title: "Acme Co", dealId: "d-1", dealName: "Acme Co",
  status: "open", earliestAt: "2026-08-04", targetAt: "2026-08-05", latestAt: "2026-08-07",
  originalTargetAt: "2026-08-05", dateSource: "interval", startAt: null, reminderAt: null,
  priority: null, repeatRule: null, sourceActivityId: "a-1", sourceOutcome: "positive_engagement",
  snoozeCount: 0, excludeFromPath: false, completedAt: null, cancelledAt: null,
  createdAt: "2026-08-03", updatedAt: "2026-08-03",
};

describe("useTasks", () => {
  it("maps rows and filters by status by default (open)", async () => {
    readData = [{
      id: "t-1", org_id: "org-1", owner_id: "user-1", type: "call", title: "Acme Co", deal_id: "d-1",
      status: "open", earliest_at: "2026-08-04", target_at: "2026-08-05", latest_at: "2026-08-07",
      original_target_at: "2026-08-05", date_source: "interval", start_at: null, reminder_at: null,
      priority: null, repeat_rule: null, source_activity_id: "a-1", source_outcome: "positive_engagement",
      snooze_count: 0, exclude_from_path: false, completed_at: null, cancelled_at: null,
      created_at: "2026-08-03", updated_at: "2026-08-03",
    }];
    const { result } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(result.current.tasks.length).toBe(1));
    expect(result.current.tasks[0]).toMatchObject({ id: "t-1", type: "call", targetAt: "2026-08-05", dealId: "d-1" });
    expect(eqCalls).toContainEqual(["status", "open"]);
  });
});

describe("useTaskMutations", () => {
  it("snooze shifts the band and bumps snooze_count but never touches original_target_at", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });
    await result.current.snoozeTask.mutateAsync({ task: TASK, businessDays: 3 });
    expect(updatePayload).toBeTruthy();
    expect(updatePayload).not.toHaveProperty("original_target_at");
    expect(updatePayload!.snooze_count).toBe(1);
    expect(updatePayload!.target_at).toBe("2026-08-10"); // Wed + 3 bd = next Mon
  });

  it("complete sets status completed", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });
    await result.current.completeTask.mutateAsync("t-1");
    expect(updatePayload!.status).toBe("completed");
  });

  it("cancel sets status cancelled", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });
    await result.current.cancelTask.mutateAsync("t-1");
    expect(updatePayload!.status).toBe("cancelled");
  });

  it("create inserts an open task scoped to the org + owner", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });
    await result.current.createTask.mutateAsync({
      type: "todo", title: "Prep proposal", dealId: null,
      targetAt: "2026-08-06", earliestAt: "2026-08-06", latestAt: "2026-08-07", originalTargetAt: "2026-08-06",
    });
    expect(insertPayload).toMatchObject({ org_id: "org-1", owner_id: "user-1", status: "open", type: "todo" });
  });
});
