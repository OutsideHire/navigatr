// apps/app/src/features/admin/pages/AgentDetailPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentDetailPage } from "./AgentDetailPage";

vi.mock("../hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({
    data: [
      {
        agent_id: "test-agent-id",
        full_name: "Sarah Lim",
        email: "sarah@acme.com",
        role: "rep",
        status: "active",
        open_deals: 23,
        pipeline_cents: 48_700_000, // $487K
        won_deals_window: 4,
        won_cents_window: 8_900_000, // $89K
        lost_deals_window: 1,
        lost_cents_window: 2_000_000,
        activities_window: 47,
        last_activity: null,
      },
    ],
    isLoading: false,
  }),
  TEAM_LEADERBOARD_QUERY_KEY: (userId: string, windowDays: number) => [
    "admin",
    "leaderboard",
    userId,
    windowDays,
  ],
}));

vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivitiesForOrg: () => ({
    data: [
      {
        id: "act-1",
        dealId: "d-001",
        type: "call",
        disposition: "positive_engagement",
        durationMinutes: 10,
        outcomeNotes: "Good call",
        occurredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        followUpDate: null,
        loggedBy: "test-agent-id",
      },
      {
        id: "act-2",
        dealId: "d-001",
        type: "email",
        disposition: "dm_unavailable",
        durationMinutes: null,
        outcomeNotes: "",
        occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        followUpDate: null,
        loggedBy: "test-agent-id",
      },
      {
        id: "act-3",
        dealId: "d-002",
        type: "drop_in",
        disposition: "no_answer",
        durationMinutes: null,
        outcomeNotes: "",
        occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        followUpDate: null,
        loggedBy: "test-agent-id",
      },
    ],
    isLoading: false,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/agents/test-agent-id"]}>
      <QueryClientProvider client={new QueryClient()}>
        <Routes>
          <Route path="/admin/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("AgentDetailPage", () => {
  it("renders the agent name", () => {
    renderPage();
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
  });

  it("renders KPI numbers", () => {
    renderPage();
    // open deals
    expect(screen.getByText("23")).toBeInTheDocument();
    // pipeline
    expect(screen.getByText("$487K")).toBeInTheDocument();
    // won value
    expect(screen.getByText("$89K")).toBeInTheDocument();
    // won deals count
    expect(screen.getByText("(4)")).toBeInTheDocument();
    // activities from leaderboard
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders activity breakdown counts", () => {
    renderPage();
    // There are 3 activities: 1 call, 1 email, 1 drop_in, 0 appointment.
    // Each type label appears in the breakdown list.
    // We check counts next to each label.
    const listItems = screen.getAllByRole("listitem");

    // Find breakdown list items (the Card with "Activity breakdown" heading)
    // Calls → count 1
    const callsItem = listItems.find((li) => li.textContent?.includes("Calls"));
    expect(callsItem).toBeTruthy();
    expect(callsItem?.textContent).toContain("1");

    // Emails → count 1
    const emailsItem = listItems.find((li) => li.textContent?.includes("Emails"));
    expect(emailsItem).toBeTruthy();
    expect(emailsItem?.textContent).toContain("1");

    // Drop-ins → count 1
    const dropInsItem = listItems.find((li) => li.textContent?.includes("Drop-ins"));
    expect(dropInsItem).toBeTruthy();
    expect(dropInsItem?.textContent).toContain("1");

    // Appointments → count 0
    const appointmentsItem = listItems.find((li) =>
      li.textContent?.includes("Appointments"),
    );
    expect(appointmentsItem).toBeTruthy();
    expect(appointmentsItem?.textContent).toContain("0");
  });
});
