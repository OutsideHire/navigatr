// apps/app/src/features/admin/pages/AgentsPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsPage } from "./AgentsPage";

vi.mock("../hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({
    data: [
      {
        agent_id: "p1",
        full_name: "Alice",
        email: "a@x.com",
        role: "rep",
        status: "active",
        open_deals: 3,
        pipeline_cents: 100_000,
        won_deals_window: 1,
        won_cents_window: 50_000,
        lost_deals_window: 0,
        lost_cents_window: 0,
        activities_window: 5,
        last_activity: null,
      },
    ],
    isLoading: false,
  }),
  TEAM_LEADERBOARD_QUERY_KEY: (userId: string, windowDays: number) => ["admin", "leaderboard", userId, windowDays],
}));
vi.mock("../hooks/useResendInvite", () => ({ useResendInvite: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useRevokeMember", () => ({ useRevokeMember: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useSeatUsage", () => ({ useSeatUsage: () => ({ data: { used: 1, limit: 10, remaining: 9 }, isLoading: false }) }));
// TeamCoverageCard mounts useCoverageRollup → supabase.rpc; mock it deterministically.
// With rows: [] the card renders null, so existing assertions are unaffected.
vi.mock("@/features/coverage/hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows: [], isLoading: false }),
}));

describe("AgentsPage", () => {
  it("renders agent rows and seat usage", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // Name + email render in both the table and the mobile card list, so scope
    // to the desktop table to assert the row presence unambiguously.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Alice")).toBeInTheDocument();
    expect(within(table).getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  it("renders a mobile card per agent with name, a key field, and an action", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const cards = screen.getByTestId("agents-mobile-cards");
    // Same agent as the table, rendered in card form.
    expect(within(cards).getByText("Alice")).toBeInTheDocument();
    expect(within(cards).getByText("a@x.com")).toBeInTheDocument();
    // A scan-critical labeled number (pipeline value).
    expect(within(cards).getByText("Pipeline")).toBeInTheDocument();
    // Same row action the table exposes.
    expect(within(cards).getByRole("button", { name: "Row actions" })).toBeInTheDocument();
  });

  it("renders window selector buttons", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("90 days")).toBeInTheDocument();
  });

  it("renders sortable column headers", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // "Pipeline" / "Open deals" also appear as labeled stats in the mobile
    // cards, so scope the header assertions to the desktop table.
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    const headerText = headers.map((h) => h.textContent ?? "").join(" ");
    expect(headerText).toMatch(/Pipeline/i);
    expect(headerText).toMatch(/Open deals/i);
    expect(headerText).toMatch(/Activities/i);
    expect(headerText).toMatch(/Last active/i);
  });
});
