import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, vi } from "vitest";
import { AgentCard } from "./AgentCard";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

const base: LeaderboardRow = {
  agent_id: "u1", full_name: "Rosa Kim", email: "rosa@example.com",
  role: "rep", role_level: "sales_professional", status: "active", manager_id: null,
  open_deals: 0, pipeline_cents: 0, won_deals_window: 0, won_cents_window: 0,
  lost_deals_window: 0, lost_cents_window: 0, activities_window: 0, last_activity: null,
} as LeaderboardRow;

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function renderCard(row: LeaderboardRow, onNewReferralLink?: (r: LeaderboardRow) => void) {
  const noop = () => {};
  return render(
    <AgentCard row={row} onNameClick={noop} onViewPipeline={noop} onResend={noop}
      onRevoke={noop} onSetRole={noop} callerRole="admin" selfId="admin" activeAdminCount={1} onNewReferralLink={onNewReferralLink} />,
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

  it("offers a new referral form link on an active agent when the handler is given", async () => {
    const onNew = vi.fn();
    renderCard(base, onNew);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New referral form link" }));
    expect(onNew).toHaveBeenCalledWith(base);
  });

  it("hides it without a handler, and for agents who are not active", async () => {
    renderCard(base);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    expect(screen.queryByRole("menuitem", { name: "New referral form link" })).toBeNull();
  });

  it("hides it on an invited agent", async () => {
    renderCard({ ...base, status: "invited" }, vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    expect(screen.queryByRole("menuitem", { name: "New referral form link" })).toBeNull();
  });
});
