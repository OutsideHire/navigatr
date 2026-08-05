// Covers the bucketing logic (overdue / today / future), orphan handling
// (parent deal deleted), won-deal filtering, and To-do exclusion. SP1: the bell
// reads open Tasks, not activities. "Superseded" follow-ups no longer need
// special handling here — a satisfied task is auto-closed on activity log, so
// it simply isn't in the open-tasks list this hook receives.

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useFollowUpReminders, dayDelta } from "./useFollowUpReminders";
import type { Task } from "../tasks/taskTypes";
import type { TaskType } from "../lib/isProspectTouch";
import type { Deal } from "@/features/pipeline/mockData";

// Stub the underlying queries so we control input directly.
let tasksData: Task[] = [];
let dealsData: Deal[] = [];
vi.mock("./useTasks", () => ({
  useTasks: () => ({ tasks: tasksData, isLoading: false }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsData, isLoading: false }),
  DEALS_QUERY_KEY: () => ["deals", "list", "user-1"],
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1", companyName: "Acme", contactName: "Jane", phone: "+15555555555",
    email: "j@acme.com", valueCents: 100_000, stage: "contacted", probability: 35,
    lastActivity: "2026-05-20T00:00:00Z", nextFollowup: null, address: null,
    employeeCountRange: "10-49", leadSource: "inbound", updatedAt: "2026-05-20T00:00:00Z",
    owner_id: null, lostReasonCategory: null, lostReasonNotes: null, ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const target = overrides.targetAt ?? "2026-05-22";
  return {
    id: "t-1", orgId: "org-1", ownerId: "user-1", type: "call" as TaskType, title: "Acme",
    dealId: "deal-1", status: "open", earliestAt: target, targetAt: target, latestAt: target,
    originalTargetAt: target, dateSource: "interval", startAt: null, reminderAt: null,
    priority: null, repeatRule: null, sourceActivityId: null, sourceOutcome: "positive_engagement",
    snoozeCount: 0, excludeFromPath: false, completedAt: null, cancelledAt: null,
    createdAt: "2026-05-19", updatedAt: "2026-05-19", ...overrides,
  };
}

describe("dayDelta", () => {
  it("is 0 when the due day is the reference's day", () => {
    expect(dayDelta(new Date("2026-05-22T15:00:00Z"), new Date("2026-05-22T12:00:00Z"))).toBe(0);
  });
  it("is positive in the future, negative in the past", () => {
    const ref = new Date("2026-05-22T15:00:00Z");
    expect(dayDelta(ref, new Date("2026-05-24T12:00:00Z"))).toBeGreaterThan(0);
    expect(dayDelta(ref, new Date("2026-05-19T12:00:00Z"))).toBeLessThan(0);
  });
});

describe("useFollowUpReminders", () => {
  const NOW = new Date("2026-05-22T12:00:00Z");

  it("buckets tasks into overdue + today, drops future ones", () => {
    dealsData = [makeDeal()];
    tasksData = [
      makeTask({ id: "a-overdue", targetAt: "2026-05-19" }),
      makeTask({ id: "a-today", targetAt: "2026-05-22" }),
      makeTask({ id: "a-future", targetAt: "2026-05-25" }),
    ];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.overdue.map((r) => r.id)).toEqual(["a-overdue"]);
    expect(result.current.today.map((r) => r.id)).toEqual(["a-today"]);
    expect(result.current.count).toBe(2);
  });

  it("skips tasks whose parent deal was deleted (orphan)", () => {
    dealsData = [];
    tasksData = [makeTask({ targetAt: "2026-05-22" })];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.count).toBe(0);
  });

  it("skips tasks on closed-won deals", () => {
    dealsData = [makeDeal({ stage: "won" })];
    tasksData = [makeTask({ targetAt: "2026-05-22" })];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.count).toBe(0);
  });

  it("excludes internal To-do tasks (not a merchant touch)", () => {
    dealsData = [makeDeal()];
    tasksData = [makeTask({ type: "todo", targetAt: "2026-05-22" })];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.count).toBe(0);
  });

  it("sorts overdue oldest-first (most urgent at the top)", () => {
    dealsData = [makeDeal(), makeDeal({ id: "deal-2", companyName: "Beta" })];
    tasksData = [
      makeTask({ id: "newer", dealId: "deal-1", targetAt: "2026-05-20" }),
      makeTask({ id: "older", dealId: "deal-2", targetAt: "2026-05-15" }),
    ];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.overdue.map((r) => r.id)).toEqual(["older", "newer"]);
  });

  it("reports daysOverdue as a positive count overdue, 0 for due-today", () => {
    dealsData = [makeDeal()];
    tasksData = [
      makeTask({ id: "od", targetAt: "2026-05-19" }),
      makeTask({ id: "td", dealId: "deal-1", targetAt: "2026-05-22" }),
    ];
    const { result } = renderHook(() => useFollowUpReminders(NOW), { wrapper });
    expect(result.current.overdue[0].daysOverdue).toBe(3);
    expect(result.current.today[0].daysOverdue).toBe(0);
  });
});
