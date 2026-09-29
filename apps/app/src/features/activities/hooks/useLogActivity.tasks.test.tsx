// SP1: logging an activity creates the follow-up task (target mirrors the
// stored follow_up_date) and auto-closes a matching open task. Full per-table
// Supabase mock so the task/deals calls resolve.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLogActivity } from "./useLogActivity";

const ME = "user-1";
const PEER = "user-2";

/** The tasks that EXIST, and who owns each. The mock honours an owner_id filter
 *  against this, so "the query was scoped to me" is a real behaviour the tests
 *  can observe rather than a string they assert on. */
let tasksById: Record<string, { owner_id: string }>;
/** What the deal + type + status lookup would find IGNORING ownership, i.e. the
 *  open task sitting on the deal whoever it belongs to. */
let dealOpenTaskId: string | null;

let taskInsertPayload: Record<string, unknown> | null;
let taskUpdatePayload: Record<string, unknown> | null;
let taskSelectFilters: Record<string, unknown> | null;
let taskUpdateFilters: Record<string, unknown> | null;
let activityUpdatePayload: Record<string, unknown> | null;
let dealUpdatePayload: Record<string, unknown> | null;
let dealStage: string;
/** Calls to supabase.rpc(), so the compliance cancel can be asserted now that
 *  it no longer goes through a direct task UPDATE. */
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: 0, error: null });
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let updating = false;
      const b: Record<string, unknown> = {};
      const ownerOk = (row: { owner_id: string } | undefined) =>
        filters.owner_id === undefined || (row != null && row.owner_id === filters.owner_id);

      b.insert = (p: Record<string, unknown>) => {
        if (table === "task") taskInsertPayload = p;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        updating = true;
        if (table === "task") taskUpdatePayload = p;
        if (table === "activities") activityUpdatePayload = p;
        if (table === "deals") dealUpdatePayload = p;
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        filters[col] = val;
        // Snapshot as we go, so an update that never calls .select() (the
        // do-not-call cancel) still reports what it was scoped to.
        if (updating && table === "task") taskUpdateFilters = { ...filters };
        return b;
      };
      b.order = () => b;
      b.limit = () => b;
      // `.select()` is two different things: starting a read, or asking an
      // UPDATE which rows it actually hit. Only the second resolves.
      b.select = () => {
        if (!updating || table !== "task") return b;
        taskUpdateFilters = { ...filters };
        const id = filters.id as string | undefined;
        const row = id ? tasksById[id] : undefined;
        return Promise.resolve({
          data: row && ownerOk(row) ? [{ id }] : [],
          error: null,
        });
      };
      b.maybeSingle = () => {
        if (table === "deals") {
          return Promise.resolve({ data: { company_name: "Acme Co", stage: dealStage }, error: null });
        }
        if (table !== "task") return Promise.resolve({ data: null, error: null });
        taskSelectFilters = { ...filters };
        const row = dealOpenTaskId ? tasksById[dealOpenTaskId] : undefined;
        return Promise.resolve({
          data: dealOpenTaskId && ownerOk(row) ? { id: dealOpenTaskId } : null,
          error: null,
        });
      };
      b.single = () => Promise.resolve({ data: { id: "act-1" }, error: null });
      return b;
    },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: ME } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  tasksById = {};
  dealOpenTaskId = null;
  taskInsertPayload = null;
  taskUpdatePayload = null;
  taskSelectFilters = null;
  taskUpdateFilters = null;
  activityUpdatePayload = null;
  dealUpdatePayload = null;
  dealStage = "new";
  rpcCalls = [];
});

describe("useLogActivity record-state effects (SP2)", () => {
  it("Bad number flags the phone as invalid", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "bad_number", followUpDate: null });
    expect(dealUpdatePayload).toMatchObject({ contact_phone_invalid: true });
  });

  it("Do not call sets the flag and cancels open call tasks through the guarded RPC", async () => {
    // The cancel crosses owners on purpose (do-not-call belongs to the
    // MERCHANT), so it cannot be a direct task UPDATE any more: task_update is
    // owner-only. It goes through cancel_contact_tasks_for_deal, which refuses
    // unless the deal is already flagged, which is why the flag is written
    // FIRST. A direct update here would silently cancel nothing.
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "call", disposition: "do_not_call", followUpDate: null });
    expect(dealUpdatePayload).toMatchObject({ do_not_call: true });
    expect(taskUpdatePayload).toBeNull();
    expect(rpcCalls).toEqual([
      { fn: "cancel_contact_tasks_for_deal", args: { p_deal_id: "deal-1", p_channel: "call" } },
    ]);
  });

  it("Unsubscribed does the same for the email channel", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", type: "email", disposition: "unsubscribed", followUpDate: null });
    expect(dealUpdatePayload).toMatchObject({ email_opt_out: true });
    expect(rpcCalls).toEqual([
      { fn: "cancel_contact_tasks_for_deal", args: { p_deal_id: "deal-1", p_channel: "email" } },
    ]);
  });

  it("does not reach for the compliance RPC on an ordinary outcome", async () => {
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
    });
    expect(rpcCalls).toEqual([]);
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
    dealOpenTaskId = "task-open-1";
    tasksById = { "task-open-1": { owner_id: ME } };
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
    dealOpenTaskId = null;
    tasksById = { "task-overdue-dropin": { owner_id: ME } };
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

/**
 * Ownership. The 2026-09-21 production incident: an administrator logging
 * visits closed four of a rep's drop-ins on the rep's own deals, silently. She
 * lost her next day's route and nothing told her. The close matched on deal +
 * type + status with no owner predicate, and the replacement follow-up was
 * created owned by whoever logged, so the work quietly changed hands.
 */
describe("useLogActivity only ever closes the acting rep's OWN tasks", () => {
  it("leaves a colleague's open task on the deal alone", async () => {
    // The exact shape of the incident: the open drop-in on this deal belongs to
    // someone else. Logging must not touch it.
    dealOpenTaskId = "task-hers";
    tasksById = { "task-hers": { owner_id: PEER } };

    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "drop_in", disposition: "gatekeeper",
      followUpDate: "2026-09-24T00:00:00.000Z",
    });

    expect(taskUpdatePayload).toBeNull();          // nothing was completed
    expect(activityUpdatePayload).toBeNull();      // and nothing was stamped
  });

  it("scopes the deal lookup to the acting rep, so a colleague's task is never even a candidate", async () => {
    dealOpenTaskId = "task-hers";
    tasksById = { "task-hers": { owner_id: PEER } };

    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "drop_in", disposition: "gatekeeper",
      followUpDate: "2026-09-24T00:00:00.000Z",
    });

    expect(taskSelectFilters).toMatchObject({ deal_id: "deal-1", status: "open", owner_id: ME });
  });

  it("still gives the visitor their OWN follow-up, so both people keep a task", async () => {
    // The outcome that makes this fix safe rather than merely restrictive: the
    // deal owner keeps her visit AND the person who actually dropped in gets a
    // reminder of their own. Two follow-ups on a shared deal is honest; one
    // silently replacing the other is not.
    dealOpenTaskId = "task-hers";
    tasksById = { "task-hers": { owner_id: PEER } };

    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "drop_in", disposition: "gatekeeper",
      followUpDate: "2026-09-24T00:00:00.000Z",
    });

    expect(taskInsertPayload).toBeTruthy();
    expect(taskInsertPayload!.owner_id).toBe(ME);
    expect(taskUpdatePayload).toBeNull();
  });

  it("refuses a closeTaskId pointing at someone else's task", async () => {
    // Defence in depth. Once the Activities queue is scoped a rep should never
    // SEE a colleague's row to tap, but the UI is not the boundary: the write
    // itself carries the owner predicate.
    dealOpenTaskId = null;
    tasksById = { "task-hers": { owner_id: PEER } };

    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
      closeTaskId: "task-hers",
    });

    expect(activityUpdatePayload).toBeNull();
    expect(taskUpdateFilters).toMatchObject({ id: "task-hers", owner_id: ME });
  });

  it("closes the rep's own task, scoped to them", async () => {
    dealOpenTaskId = "task-mine";
    tasksById = { "task-mine": { owner_id: ME } };

    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "positive_engagement",
      followUpDate: "2026-05-22T00:00:00.000Z",
    });

    expect(taskUpdatePayload!.status).toBe("completed");
    expect(taskUpdateFilters).toMatchObject({ id: "task-mine", owner_id: ME });
    expect(activityUpdatePayload!.closed_task_id).toBe("task-mine");
  });

  it("STILL cancels every open call task on a do-not-call, whoever owns them", async () => {
    // The deliberate exception, pinned so nobody "fixes" it to match the close
    // above. Do-not-call is a property of the merchant, not of a rep: leaving a
    // colleague holding an open task to ring a merchant who just asked not to
    // be rung is a compliance problem, not a tidiness one.
    //
    // The MECHANISM moved (task_update is owner-only now, so this goes through
    // the guarded RPC) but the BEHAVIOUR is the point of this test: no owner
    // predicate is sent, so a colleague's task is still cancelled. Asserting
    // the absence of one keeps that meaningful.
    const { result } = renderHook(() => useLogActivity(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1", type: "call", disposition: "do_not_call", followUpDate: null,
    });

    expect(taskUpdatePayload).toBeNull();               // not a direct write any more
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("cancel_contact_tasks_for_deal");
    expect(rpcCalls[0]!.args).toEqual({ p_deal_id: "deal-1", p_channel: "call" });
    expect(rpcCalls[0]!.args.p_owner_id).toBeUndefined();
  });
});
