// Smoke tests for RevokeAgentDialog.
// Covers: open with open deals shows successor dropdown, confirm calls both
// mutateAsync hooks in order, zero-deal path shows simple confirm message.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RevokeAgentDialog } from "./RevokeAgentDialog";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

// ── hook mocks ────────────────────────────────────────────────────────────────

const reassignMutateAsync = vi.fn();
const revokeMutateAsync = vi.fn();

vi.mock("../hooks/useReassignDeals", () => ({
  useReassignDeals: () => ({ mutateAsync: reassignMutateAsync }),
}));
vi.mock("../hooks/useRevokeMember", () => ({
  useRevokeMember: () => ({ mutateAsync: revokeMutateAsync }),
}));

function makeAgent(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    agent_id: "agent-1",
    full_name: "Sarah Lim",
    email: "sarah@x.com",
    role: "rep",
    role_level: "sales_professional",
    status: "active",
    manager_id: null,
    open_deals: 3,
    pipeline_cents: 150_000_00,
    won_deals_window: 1,
    won_cents_window: 5_000_00,
    lost_deals_window: 0,
    lost_cents_window: 0,
    activities_window: 10,
    last_activity: null,
    ...overrides,
  };
}

const activeAgents: LeaderboardRow[] = [
  makeAgent(), // the agent being deactivated
  {
    agent_id: "agent-2",
    full_name: "Marcus Reed",
    email: "marcus@x.com",
    role: "rep",
    role_level: "sales_professional",
    status: "active",
    manager_id: null,
    open_deals: 5,
    pipeline_cents: 200_000_00,
    won_deals_window: 2,
    won_cents_window: 10_000_00,
    lost_deals_window: 1,
    lost_cents_window: 2_000_00,
    activities_window: 15,
    last_activity: null,
  },
  {
    agent_id: "agent-3",
    full_name: "Jordan Kim",
    email: "jordan@x.com",
    role: "manager",
    role_level: "sales_manager",
    status: "active",
    manager_id: null,
    open_deals: 2,
    pipeline_cents: 80_000_00,
    won_deals_window: 0,
    won_cents_window: 0,
    lost_deals_window: 0,
    lost_cents_window: 0,
    activities_window: 3,
    last_activity: null,
  },
];

beforeEach(() => {
  reassignMutateAsync.mockReset();
  revokeMutateAsync.mockReset();
  reassignMutateAsync.mockResolvedValue(3);
  revokeMutateAsync.mockResolvedValue(undefined);
});

describe("RevokeAgentDialog", () => {
  it("renders open-deal count and shows other active agents in the successor dropdown", () => {
    const agent = makeAgent({ open_deals: 3 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RevokeAgentDialog
          open
          onOpenChange={vi.fn()}
          agent={agent}
          activeAgents={activeAgents}
        />
      </QueryClientProvider>,
    );

    // Shows deal context
    expect(screen.getByText(/3 open deals/i)).toBeInTheDocument();
    expect(screen.getByText(/Deactivate Sarah Lim/i)).toBeInTheDocument();
  });

  it("calls reassignMutateAsync then revokeMutateAsync in order on confirm", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const agent = makeAgent({ open_deals: 3 });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RevokeAgentDialog
          open
          onOpenChange={onOpenChange}
          agent={agent}
          activeAgents={activeAgents}
        />
      </QueryClientProvider>,
    );

    // The "Reassign to" radio is checked by default; a successor is pre-selected.
    // Click the confirm button.
    const confirmBtn = screen.getByRole("button", { name: /deactivate agent/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(reassignMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(reassignMutateAsync).toHaveBeenCalledWith({
      fromProfile: "agent-1",
      toProfile: "agent-2", // first successor in the list
    });
    expect(revokeMutateAsync).toHaveBeenCalledTimes(1);
    expect(revokeMutateAsync).toHaveBeenCalledWith({
      targetId: "agent-1",
      kind: "profile",
    });

    // reassign must be called before revoke
    const reassignOrder = reassignMutateAsync.mock.invocationCallOrder[0];
    const revokeOrder = revokeMutateAsync.mock.invocationCallOrder[0];
    expect(reassignOrder).toBeLessThan(revokeOrder);
  });

  it("shows a simple confirm message when agent has zero open deals", () => {
    const agent = makeAgent({ open_deals: 0, pipeline_cents: 0 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RevokeAgentDialog
          open
          onOpenChange={vi.fn()}
          agent={agent}
          activeAgents={activeAgents}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/no longer be able to sign in/i)).toBeInTheDocument();
    // No radio choices shown
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
