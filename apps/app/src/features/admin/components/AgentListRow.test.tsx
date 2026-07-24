import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentListRow } from "./AgentListRow";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

const base: LeaderboardRow = {
  agent_id: "u1", full_name: "Rosa Kim",
  email: "demo-rep2-3ac28035-7ab6-46c1-855c-70011b01f60f@navigatr-demo.local",
  role: "rep", role_level: "sales_professional", status: "active", manager_id: null,
  open_deals: 0, pipeline_cents: 0, won_deals_window: 0, won_cents_window: 0,
  lost_deals_window: 0, lost_cents_window: 0, activities_window: 0, last_activity: null,
} as LeaderboardRow;

function renderRow(row: LeaderboardRow) {
  const noop = () => {};
  return render(
    <table><tbody>
      <AgentListRow row={row} onNameClick={noop} onViewPipeline={noop} onResend={noop}
        onRevoke={noop} onSetRole={noop} callerRole="admin" selfId="admin" activeAdminCount={1} />
    </tbody></table>,
  );
}

describe("AgentListRow", () => {
  it("renders the email on one truncated line with the full value as a title", () => {
    renderRow(base);
    const email = screen.getByText(base.email);
    expect(email).toHaveAttribute("title", base.email);
    expect(email.className).toMatch(/truncate/);
  });

  it("dims metric cells that are zero", () => {
    const { container } = renderRow(base);
    expect(container.querySelectorAll("td.text-text-subtle").length).toBeGreaterThan(0);
  });

  it("does not dim the pipeline cell when it is non-zero", () => {
    renderRow({ ...base, pipeline_cents: 30800000 });
    const cell = screen.getByText("$308K").closest("td")!;
    expect(cell.className).not.toMatch(/text-text-subtle/);
  });
});
