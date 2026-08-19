// SP1: logging an activity creates the follow-up task (target mirrors the
// stored follow_up_date) and auto-closes a matching open task. Full per-table
// Supabase mock so the task/deals calls resolve.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLogActivity } from "./useLogActivity";

let openTaskRow: { id: string } | null;
let taskInsertPayload: Record<string, unknown> | null;
let taskUpdatePayload: Record<string, unknown> | null;
let activityUpdatePayload: Record<string, unknown> | null;
let dealUpdatePayload: Record<string, unknown> | null;
let dealStage: string;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.insert = (p: Record<string, unknown>) => {
        if (table === "task") taskInsertPayload = p;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        if (table === "task") taskUpdatePayload = p;
        if (table === "activities") activityUpdatePayload = p;
        if (table === "deals") dealUpdatePayload = p;
        return b;
      };
      b.select = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data:
            table === "task"
              ? openTaskRow
              : table === "deals"
                ? { company_name: "Acme Co", stage: dealStage }
                : null,
          error: null,
        });
      b.single = () => Promise.resolve({ data: { id: "act-1" }, error: null });
      return b;
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
  openTaskRow = null;
  taskInsertPayload = null;
  taskUpdatePayload = null;
  activityUpdatePayload = null;
  dealUpdatePayload = null;
  dealStage = "new";
});

describe("useLogActivity record-state effects (SP2)", () => {
  it("Bad number flags the phone as invalid", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "bad_number", followUpDate: null });
    expect(dealUpdatePayload).toMatchObject({ contact_phone_invalid: true });
  });

  it("Do not call sets the flag and cancels open call tasks", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "do_not_call", followUpDate: null });
    expect(dealUpdatePayload).toMatchObject({ do_not_call: true });
    expect(taskUpdatePayload).toMatchObject({ status: "cancelled" });
  });

  it("Verbal commitment advances an early-stage deal to Proposal", async () => {
    dealStage = "contacted";
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "verbal_commitment", followUpDate: "2026-05-19T00:00:00.000Z" });
    expect(dealUpdatePayload).toMatchObject({ stage: "proposal" });
  });

  it("Verbal commitment does NOT regress a later-stage deal", async () => {
    dealStage = "won";
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "verbal_commitment", followUpDate: "2026-05-19T00:00:00.000Z" });
    expect(dealUpdatePayload).toBeNull(); // no stage change
  });
});

describe("useLogActivity task sync", () => {
  it("creates a follow-up task whose target mirrors the stored follow_up_date", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
    });
    expect(taskInsertPayload).toBeTruthy();
    expect(taskInsertPayload!.target_at).toBe("2026-05-22");
    expect(taskInsertPayload!.original_target_at).toBe("2026-05-22");
    expect(taskInsertPayload!.source_activity_id).toBe("act-1");
    expect(taskInsertPayload!.source_outcome).toBe("positive_engagement");
    expect(taskInsertPayload!.type).toBe("call");
    expect(taskInsertPayload!.status).toBe("open");
  });

  it("creates no task for a terminal outcome with no follow-up date", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "not_interested", followUpDate: null,
    });
    expect(taskInsertPayload).toBeNull();
  });

  it("Send info creates the Email + Call compound (two tasks)", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "send_info",
      followUpDate: "2026-05-25T00:00:00.000Z",
    });
    expect(Array.isArray(taskInsertPayload)).toBe(true);
    const rows = taskInsertPayload as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type)).toEqual(["email", "call"]);
    expect(rows[1].target_at).toBe("2026-05-25"); // the Call follows at the 3-day date
  });

  it("Callback (asserted) creates a pinned task collapsed to the promised date", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "callback",
      followUpDate: "2026-08-14T14:30:00", followUpDateSource: "asserted",
    });
    expect(taskInsertPayload).toBeTruthy();
    expect(taskInsertPayload!.date_source).toBe("asserted");
    expect(taskInsertPayload!.type).toBe("call");
    expect(taskInsertPayload!.target_at).toBe("2026-08-14");
    expect(taskInsertPayload!.earliest_at).toBe("2026-08-14");
    expect(taskInsertPayload!.latest_at).toBe("2026-08-14");
  });

  it("Verbal commitment uses the next-step text as the To-do title", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "verbal_commitment",
      followUpDate: "2026-05-19T00:00:00.000Z", taskTitle: "Prepare the application",
    });
    expect(taskInsertPayload!.type).toBe("todo");
    expect(taskInsertPayload!.title).toBe("Prepare the application");
  });

  it("auto-closes a matching open task and stamps closed_task_id on the activity", async () => {
    openTaskRow = { id: "task-open-1" };
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
    });
    expect(taskUpdatePayload!.status).toBe("completed");
    expect(activityUpdatePayload!.closed_task_id).toBe("task-open-1");
  });

  it("closeTaskId closes THAT exact task even when no same-type task matches (Activities row log)", async () => {
    // Regression (Robert): logging from an overdue task row must clear that task
    // regardless of the activity type picked. openTaskRow is null (the same-type
    // match finds nothing, e.g. an overdue Drop-in logged as a Call), yet the
    // passed closeTaskId is still closed and stamped on the activity.
    openTaskRow = null;
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
      closeTaskId: "task-overdue-dropin",
    });
    expect(taskUpdatePayload!.status).toBe("completed");
    expect(activityUpdatePayload!.closed_task_id).toBe("task-overdue-dropin");
  });
});
