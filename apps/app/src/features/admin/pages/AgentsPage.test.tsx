// apps/app/src/features/admin/pages/AgentsPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("AgentsPage", () => {
  it("renders agent rows and seat usage", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
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
    expect(screen.getByText(/Pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Open deals/i)).toBeInTheDocument();
    expect(screen.getByText(/Activities/i)).toBeInTheDocument();
    expect(screen.getByText(/Last active/i)).toBeInTheDocument();
  });
});
