// Bug C / D agreement regression — the Activities list must bucket a task on
// the same calendar day as the notification bell.
//
// Runs in America/Los_Angeles with the clock pinned to the evening of Jul 8
// (local). A follow-up scheduled for Jul 9 must land under Upcoming
// ("Tomorrow"), not Today — matching useFollowUpReminders. Pre-fix, the list
// bucketed against UTC midnight, so a rep west of UTC saw the task as "due
// today" here while the bell (local midnight) disagreed.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { ACTIVITIES_ORG_QUERY_KEY } from "../hooks/useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

vi.mock("../hooks/useUpdateActivity", () => ({
  useUpdateActivity: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  // Only fake the Date clock so React Testing Library's timers keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2026-07-09T02:00Z = 2026-07-08 19:00 PDT — the evening before the due day.
  vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function deal(): Deal {
  return {
    id: "d-1",
    companyName: "TomorrowCo",
    contactName: "X",
    phone: "+12025550100",
    email: "x@x.x",
    valueCents: 100_00,
    stage: "contacted",
    probability: 20,
    lastActivity: "2026-07-08T02:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "1-10",
    leadSource: "",
    updatedAt: "2026-07-08T02:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function task(followUpDate: string): Activity {
  return {
    id: "a-1",
    dealId: "d-1",
    type: "call",
    disposition: "positive_engagement",
    durationMinutes: 10,
    outcomeNotes: "notes",
    occurredAt: "2026-07-08T02:00:00Z",
    followUpDate,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ACTIVITIES_ORG_QUERY_KEY(undefined), [
    task(dateOnlyToNoonUtcIso("2026-07-09")),
  ]);
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
  it("buckets a Jul-9 follow-up as Upcoming, not Today, on the evening of Jul 8", () => {
    renderPage();

    // Default Today tab shows the empty state, not the task.
    expect(screen.getByText("No tasks due today")).toBeInTheDocument();
    expect(screen.queryByText("TomorrowCo")).not.toBeInTheDocument();

    // The task is counted under Upcoming, agreeing with the bell (which would
    // also treat it as future, not due-today).
    expect(screen.getByRole("tab", { name: /Upcoming/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).not.toContain("1");
  });
});
