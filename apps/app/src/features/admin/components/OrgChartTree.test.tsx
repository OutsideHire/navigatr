import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrgChartTree } from "./OrgChartTree";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

function row(over: Partial<LeaderboardRow> & { agent_id: string }): LeaderboardRow {
  return {
    full_name: null,
    email: `${over.agent_id}@x.com`,
    role: "rep",
    role_level: null,
    status: "active",
    manager_id: null,
    open_deals: 0,
    pipeline_cents: 0,
    won_deals_window: 0,
    won_cents_window: 0,
    lost_deals_window: 0,
    lost_cents_window: 0,
    activities_window: 0,
    last_activity: null,
    ...over,
  };
}

const ROWS: LeaderboardRow[] = [
  row({ agent_id: "a", full_name: "Admin Ann", role_level: "administrator" }),
  row({ agent_id: "m", full_name: "Manager Mike", role_level: "sales_manager", manager_id: "a" }),
  row({ agent_id: "r", full_name: "Rep Rita", role_level: "sales_professional", manager_id: "m" }),
];

describe("OrgChartTree", () => {
  it("renders every person with a role-level label", () => {
    render(<OrgChartTree rows={ROWS} />);
    expect(screen.getByText("Admin Ann")).toBeInTheDocument();
    expect(screen.getByText("Manager Mike")).toBeInTheDocument();
    expect(screen.getByText("Rep Rita")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Sales Manager")).toBeInTheDocument();
    expect(screen.getByText("Sales Professional")).toBeInTheDocument();
  });

  it("shows a dash label when role_level is null", () => {
    render(<OrgChartTree rows={[row({ agent_id: "x", full_name: "No Role", role_level: null })]} />);
    expect(screen.getByText("No Role")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("fires onSelect with the agent id when a node is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<OrgChartTree rows={ROWS} onSelect={onSelect} />);
    await user.click(screen.getByText("Rep Rita"));
    expect(onSelect).toHaveBeenCalledWith("r");
  });

  it("collapses and re-expands a subtree via the chevron", async () => {
    const user = userEvent.setup();
    render(<OrgChartTree rows={ROWS} />);
    // Default expanded: the rep is visible.
    expect(screen.getByText("Rep Rita")).toBeInTheDocument();
    const collapseAdmin = screen.getByRole("button", { name: /Collapse Admin Ann/i });
    expect(collapseAdmin).toHaveAttribute("aria-expanded", "true");
    await user.click(collapseAdmin);
    // Whole subtree hidden.
    expect(screen.queryByText("Manager Mike")).not.toBeInTheDocument();
    expect(screen.queryByText("Rep Rita")).not.toBeInTheDocument();
    // Re-expand.
    await user.click(screen.getByRole("button", { name: /Expand Admin Ann/i }));
    expect(screen.getByText("Manager Mike")).toBeInTheDocument();
  });

  it("shows a status hint for invited members", () => {
    render(<OrgChartTree rows={[row({ agent_id: "i", full_name: "Invited Ivy", status: "invited" })]} />);
    expect(screen.getByText("Invited")).toBeInTheDocument();
  });

  it("renders an empty-state message when there are no rows", () => {
    render(<OrgChartTree rows={[]} />);
    expect(screen.getByText(/no team members/i)).toBeInTheDocument();
  });

  describe("rails, avatars, role chips, and report counts", () => {
    const MANAGER_ROWS: LeaderboardRow[] = [
      row({ agent_id: "u_sam", full_name: "Sam Vance", role_level: "svp_sales" }),
      row({ agent_id: "u_vic", full_name: "Victor Pratt", role_level: "vp_sales", manager_id: "u_sam" }),
      row({ agent_id: "u_vera", full_name: "Vera Powell", role_level: "vp_sales", manager_id: "u_sam" }),
    ];

    it("shows a manager's direct-report count with pluralization", () => {
      render(<OrgChartTree rows={MANAGER_ROWS} />);
      expect(screen.getByText("2 reports")).toBeInTheDocument();
    });

    it("uses the singular 'report' for one direct report", () => {
      render(
        <OrgChartTree
          rows={[
            row({ agent_id: "u_sam", full_name: "Sam Vance", role_level: "svp_sales" }),
            row({ agent_id: "u_vic", full_name: "Victor Pratt", role_level: "vp_sales", manager_id: "u_sam" }),
          ]}
        />,
      );
      expect(screen.getByText("1 report")).toBeInTheDocument();
    });

    it("does not show a report count on a leaf node", () => {
      render(<OrgChartTree rows={MANAGER_ROWS} />);
      expect(screen.queryByText(/0 report/)).not.toBeInTheDocument();
    });

    it("renders an initials avatar and a role chip for a person", () => {
      render(<OrgChartTree rows={MANAGER_ROWS} />);
      expect(screen.getByText("SV")).toBeInTheDocument();
      expect(screen.getByText("SVP of Sales")).toBeInTheDocument();
    });

    it("fires onSelect with the agent id when a name is clicked", () => {
      const onSelect = vi.fn();
      render(<OrgChartTree rows={MANAGER_ROWS} onSelect={onSelect} />);
      fireEvent.click(screen.getByText("Sam Vance"));
      expect(onSelect).toHaveBeenCalledWith("u_sam");
    });

    it("collapses a branch when the chevron is clicked", () => {
      render(<OrgChartTree rows={MANAGER_ROWS} />);
      expect(screen.getByText("Victor Pratt")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Collapse Sam Vance/i }));
      expect(screen.queryByText("Victor Pratt")).not.toBeInTheDocument();
    });
  });
});
