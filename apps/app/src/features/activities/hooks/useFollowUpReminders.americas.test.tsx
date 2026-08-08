// Bug C regression — the notification bell.
//
// Runs in America/Los_Angeles. A task with target_at Jul 9 must not show as
// "due today" on the evening of Jul 8 (rep's local time), and must become due
// once the local day rolls to Jul 9. SP1: the bell reads open Tasks.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useFollowUpReminders } from "./useFollowUpReminders";
import type { Deal } from "@/features/pipeline/mockData";
import type { Task } from "../tasks/taskTypes";

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

function makeDeal(): Deal {
  return {
    id: "deal-1", companyName: "Acme", contactName: "Jane", phone: "+15555555555",
    email: "j@acme.com", valueCents: 100_000, stage: "contacted", probability: 35,
    lastActivity: "2026-07-08T00:00:00Z", nextFollowup: null, address: null,
    employeeCountRange: "10-49", leadSource: "inbound", updatedAt: "2026-07-08T00:00:00Z",
    owner_id: null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

function makeTask(targetAt: string): Task {
  return {
    id: "t-1", orgId: "org-1", ownerId: "user-1", type: "call", title: "Acme", dealId: "deal-1", dealName: "Acme",
    status: "open", earliestAt: targetAt, targetAt, latestAt: targetAt, originalTargetAt: targetAt,
    dateSource: "interval", startAt: null, reminderAt: null, priority: null, repeatRule: null,
    sourceActivityId: null, sourceOutcome: "positive_engagement", snoozeCount: 0,
    excludeFromPath: false, completedAt: null, cancelledAt: null, createdAt: "2026-07-08", updatedAt: "2026-07-08",
  };
}

// Rep's clock: 2026-07-09T02:00Z = 2026-07-08 19:00 PDT.
const NOW_JUL8_EVENING = new Date("2026-07-09T02:00:00Z");

describe("useFollowUpReminders — Americas (negative-UTC) evening", () => {
  it("a Jul-9 task is NOT due on the evening of Jul 8", () => {
    dealsData = [makeDeal()];
    tasksData = [makeTask("2026-07-09")];
    const { result } = renderHook(() => useFollowUpReminders(NOW_JUL8_EVENING), { wrapper });
    expect(result.current.today).toHaveLength(0);
    expect(result.current.overdue).toHaveLength(0);
    expect(result.current.count).toBe(0);
  });

  it("the same task IS due once the rep's local day rolls to Jul 9", () => {
    dealsData = [makeDeal()];
    tasksData = [makeTask("2026-07-09")];
    // 2026-07-09T20:00Z = 2026-07-09 13:00 PDT.
    const { result } = renderHook(() => useFollowUpReminders(new Date("2026-07-09T20:00:00Z")), { wrapper });
    expect(result.current.today.map((r) => r.id)).toEqual(["t-1"]);
    expect(result.current.count).toBe(1);
  });
});
