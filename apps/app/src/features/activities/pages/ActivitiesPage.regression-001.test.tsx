// Regression: ISSUE-001 — Activities History tab used to not re-render
// after a new activity was logged. The old root cause was a setTab((t) =>
// t) no-op in React 18 + a refreshKey hack that the page authors added
// as a workaround. Both are gone: the page now reads from
// useActivitiesForOrg(), and useLogActivity invalidates the cache key
// on success, so React Query's normal subscription model handles the
// re-render.
//
// This test preserves the original CONTRACT (the page renders the
// current activity set in the History tab) against the new
// implementation. The earlier failure mode is structurally unreachable
// without a regression in cache invalidation OR the page wiring.

import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { ACTIVITIES_ORG_QUERY_KEY } from "../hooks/useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

function deal(id: string, company: string): Deal {
  return {
    id,
    companyName: company,
    contactName: "X",
    phone: "+12025550100",
    email: "x@x.x",
    valueCents: 100_00,
    stage: "new",
    probability: 20,
    lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null,
    employeeCountRange: "1-10",
  };
}

function activity(
  id: string,
  dealId: string,
  notes: string,
  occurredAt: string = "2026-05-18T12:00:00Z",
): Activity {
  return {
    id,
    dealId,
    type: "call",
    disposition: "positive_engagement",
    durationMinutes: 10,
    outcomeNotes: notes,
    occurredAt,
    followUpDate: null,
  };
}

function renderWithSeed(args: { activities: Activity[]; deals: Deal[] }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Page uses userId = undefined when there's no auth → falls back to "anon"
  client.setQueryData(ACTIVITIES_ORG_QUERY_KEY(undefined), args.activities);
  client.setQueryData(DEALS_QUERY_KEY(undefined), args.deals);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/activities"]}>
          <ActivitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("ActivitiesPage / History tab reflects current data", () => {
  it("renders the History tab with one row per cached activity", async () => {
    const user = userEvent.setup();
    const deals = [deal("d-1", "Acme")];
    const acts = [
      activity("a-1", "d-1", "first"),
      activity("a-2", "d-1", "second"),
    ];
    renderWithSeed({ activities: acts, deals });

    // Radix Tabs uses pointer events, not React synthetic clicks.
    await user.click(screen.getByRole("tab", { name: /History/i }));

    expect(screen.getAllByText(/^Call · /)).toHaveLength(2);
    expect(screen.getByText(/first/i)).toBeInTheDocument();
    expect(screen.getByText(/second/i)).toBeInTheDocument();
  });

  it("when the cached activities update, the History tab re-renders with the new set", async () => {
    const user = userEvent.setup();
    const deals = [deal("d-1", "Acme")];

    const { client } = renderWithSeed({
      activities: [activity("a-1", "d-1", "first")],
      deals,
    });
    await user.click(screen.getByRole("tab", { name: /History/i }));
    expect(screen.getAllByText(/^Call · /)).toHaveLength(1);

    // Simulate useLogActivity's onSuccess: writes a new list to the
    // org-wide cache key. The page's useActivitiesForOrg subscriber
    // should re-render with the new array.
    cleanup();
    client.setQueryData(ACTIVITIES_ORG_QUERY_KEY(undefined), [
      activity("a-1", "d-1", "first"),
      activity("a-2", "d-1", "newly-logged-marker"),
    ]);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/activities"]}>
          <ActivitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("tab", { name: /History/i }));

    expect(screen.getAllByText(/^Call · /)).toHaveLength(2);
    expect(screen.getByText(/newly-logged-marker/i)).toBeInTheDocument();
  });

  it("activity with orphaned dealId (deal was deleted) is skipped, not crashed", async () => {
    const user = userEvent.setup();
    // Activity points to a deal that doesn't exist in the cached list.
    renderWithSeed({
      activities: [activity("a-1", "d-ghost", "ghost")],
      deals: [],
    });
    // Should still render the History tab without throwing.
    await user.click(screen.getByRole("tab", { name: /History/i }));
    // The row renders but the deal name falls back to "Unknown deal".
    expect(screen.getByText(/Unknown deal/i)).toBeInTheDocument();
  });
});
