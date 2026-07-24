import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentCard } from "./AgentCard";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

const base: LeaderboardRow = {
  agent_id: "u1", full_name: "Rosa Kim", email: "rosa@example.com",
  role: "rep", role_level: "sales_professional", status: "active", manager_id: null,
  open_deals: 0, pipeline_cents: 0, won_deals_window: 0, won_cents_window: 0,
  lost_deals_window: 0, lost_cents_window: 0, activities_window: 0, last_activity: null,
} as LeaderboardRow;

function renderCard(row: LeaderboardRow) {
  const noop = () => {};
  return render(
    <AgentCard row={row} onNameClick={noop} onViewPipeline={noop} onResend={noop}
      onRevoke={noop} onSetRole={noop} callerRole="admin" selfId="admin" activeAdminCount={1} />,
  );
}

describe("AgentCard", () => {
  it("dims a zero pipeline stat", () => {
    renderCard(base);
    expect(screen.getByText("$0").className).toMatch(/text-text-subtle/);
  });
  it("does not dim a non-zero pipeline stat", () => {
    renderCard({ ...base, pipeline_cents: 30800000 });
    expect(screen.getByText("$308K").className).not.toMatch(/text-text-subtle/);
  });
});
