// Bug C / D agreement regression — the Activities list must bucket a task on
// the same calendar day as the notification bell.
//
// Runs in America/Los_Angeles with the clock pinned to the evening of Jul 8
// (local). A task with target_at Jul 9 must land under Upcoming ("Tomorrow"),
// not Today — matching useFollowUpReminders. Pre-fix, the list bucketed against
// UTC midnight, so a rep west of UTC saw the task as "due today" while the bell
// (local midnight) disagreed. SP1: both now read the task's target_at.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { TASKS_QUERY_KEY } from "../hooks/useTasks";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { Deal } from "@/features/pipeline/mockData";
import type { Task } from "../tasks/taskTypes";

vi.mock("../hooks/useTaskMutations", () => ({
  useTaskMutations: () => ({
    snoozeTask: { mutate: vi.fn() },
    completeTask: { mutate: vi.fn() },
    cancelTask: { mutate: vi.fn() },
    createTask: { mutate: vi.fn() },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2026-07-09T02:00Z = 2026-07-08 19:00 PDT — the evening before the due day.
  vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function deal(): Deal {
  return {
    id: "d-1", companyName: "TomorrowCo", contactName: "X", phone: "+12025550100", email: "x@x.x",
    valueCents: 100_00, stage: "contacted", probability: 20, lastActivity: "2026-07-08T02:00:00Z",
    nextFollowup: null, address: null, employeeCountRange: "1-10", leadSource: "",
    updatedAt: "2026-07-08T02:00:00Z", owner_id: null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

function task(targetAt: string): Task {
  return {
    id: "t-1", orgId: "org-1", ownerId: "user-1", type: "call", title: "TomorrowCo", dealId: "d-1",
    status: "open", earliestAt: targetAt, targetAt, latestAt: targetAt, originalTargetAt: targetAt,
    dateSource: "interval", startAt: null, reminderAt: null, priority: null, repeatRule: null,
    sourceActivityId: null, sourceOutcome: "positive_engagement", snoozeCount: 0,
    excludeFromPath: false, completedAt: null, cancelledAt: null, createdAt: "2026-07-08", updatedAt: "2026-07-08",
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(TASKS_QUERY_KEY(undefined, "open"), [task("2026-07-09")]);
  client.setQueryData(DEALS_QUERY_KEY(undefined), [deal()]);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/activities"]}>
        <ActivitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivitiesPage — Americas (negative-UTC) evening", () => {
  it("buckets a Jul-9 task as Upcoming, not Today, on the evening of Jul 8", () => {
    renderPage();
    expect(screen.getByText("No tasks due today")).toBeInTheDocument();
    expect(screen.queryByText("TomorrowCo")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Upcoming/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).not.toContain("1");
  });
});
