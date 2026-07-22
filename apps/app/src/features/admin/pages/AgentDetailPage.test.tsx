// apps/app/src/features/admin/pages/AgentDetailPage.test.tsx
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentDetailPage } from "./AgentDetailPage";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

// Mutable holders shared with the mocked hooks. `rows` is the leaderboard
// roster the page reads; `authUserId` drives useAuth (→ callerRole); the
// mutate spy captures admin_set_manager calls.
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  authUserId: undefined as string | undefined,
  callerRoleLevel: undefined as string | undefined,
  setManagerMutate: vi.fn(),
  setRoleLevelMutate: vi.fn(),
}));

vi.mock("../hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({ data: h.rows, isLoading: false }),
  TEAM_LEADERBOARD_QUERY_KEY: (userId: string, windowDays: number) => [
    "admin",
    "leaderboard",
    userId,
    windowDays,
  ],
}));

vi.mock("../hooks/useSetMemberManager", () => ({
  useSetMemberManager: () => ({
    mutate: h.setManagerMutate,
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/useSetRoleLevel", () => ({
  useSetRoleLevel: () => ({
    mutate: h.setRoleLevelMutate,
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({
    data: h.callerRoleLevel ? { role_level: h.callerRoleLevel } : null,
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: h.authUserId ? { id: h.authUserId } : null }),
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

function row(
  overrides: Partial<LeaderboardRow> & { agent_id: string },
): LeaderboardRow {
  return {
    agent_id: overrides.agent_id,
    full_name: overrides.full_name ?? null,
    email: overrides.email ?? `${overrides.agent_id}@acme.com`,
    role: overrides.role ?? "rep",
    role_level: overrides.role_level ?? null,
    status: overrides.status ?? "active",
    manager_id: overrides.manager_id ?? null,
    open_deals: overrides.open_deals ?? 0,
    pipeline_cents: overrides.pipeline_cents ?? 0,
    won_deals_window: overrides.won_deals_window ?? 0,
    won_cents_window: overrides.won_cents_window ?? 0,
    lost_deals_window: overrides.lost_deals_window ?? 0,
    lost_cents_window: overrides.lost_cents_window ?? 0,
    activities_window: overrides.activities_window ?? 0,
    last_activity: overrides.last_activity ?? null,
  };
}

const SARAH = () =>
  row({
    agent_id: "test-agent-id",
    full_name: "Sarah Lim",
    email: "sarah@acme.com",
    role: "rep",
    role_level: "sales_professional",
    status: "active",
    manager_id: "mgr-1",
    open_deals: 23,
    pipeline_cents: 48_700_000, // $487K
    won_deals_window: 4,
    won_cents_window: 8_900_000, // $89K
    lost_deals_window: 1,
    lost_cents_window: 2_000_000,
    activities_window: 47,
  });

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

// Radix Select uses pointer APIs + scrollIntoView that jsdom lacks.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  h.setManagerMutate.mockReset();
  h.setRoleLevelMutate.mockReset();
  h.authUserId = "admin-1"; // admin caller by default
  h.callerRoleLevel = "administrator"; // caller can assignRoleLevels by default
  h.rows = [
    SARAH(),
    row({ agent_id: "mgr-1", full_name: "Mike Manager", role: "manager", status: "active" }),
    row({ agent_id: "mgr-2", full_name: "Nora Manager", role: "manager", status: "active" }),
    row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
  ];
});

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
    const listItems = screen.getAllByRole("listitem");

    const callsItem = listItems.find((li) => li.textContent?.includes("Calls"));
    expect(callsItem).toBeTruthy();
    expect(callsItem?.textContent).toContain("1");

    const emailsItem = listItems.find((li) => li.textContent?.includes("Emails"));
    expect(emailsItem).toBeTruthy();
    expect(emailsItem?.textContent).toContain("1");

    const dropInsItem = listItems.find((li) => li.textContent?.includes("Drop-ins"));
    expect(dropInsItem).toBeTruthy();
    expect(dropInsItem?.textContent).toContain("1");

    const appointmentsItem = listItems.find((li) =>
      li.textContent?.includes("Appointments"),
    );
    expect(appointmentsItem).toBeTruthy();
    expect(appointmentsItem?.textContent).toContain("0");
  });
});

describe("AgentDetailPage / reports-to control", () => {
  it("lets an admin caller pick a rep's manager from the org's managers, preselected", () => {
    renderPage();
    expect(screen.getByText("Reports to")).toBeInTheDocument();

    // Open the Radix select and inspect the options.
    fireEvent.click(screen.getByRole("combobox", { name: "Reports to" }));
    expect(screen.getByRole("option", { name: "No manager" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Mike Manager" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Nora Manager" })).toBeTruthy();
    // Admins are eligible reports-to targets too.
    expect(screen.getByRole("option", { name: "Amy Admin" })).toBeTruthy();
    // The rep themselves is never an option.
    expect(screen.queryByRole("option", { name: "Sarah Lim" })).toBeNull();

    // Current manager (mgr-1) is preselected.
    expect(
      screen.getByRole("option", { name: "Mike Manager" }).getAttribute("data-state"),
    ).toBe("checked");

    // Changing it calls the mutation with member + the chosen manager.
    fireEvent.click(screen.getByRole("option", { name: "Nora Manager" }));
    expect(h.setManagerMutate).toHaveBeenCalledTimes(1);
    expect(h.setManagerMutate.mock.calls[0][0]).toEqual({
      memberId: "test-agent-id",
      managerId: "mgr-2",
    });
  });

  it("passes null when the admin picks 'No manager' (unassign)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Reports to" }));
    fireEvent.click(screen.getByRole("option", { name: "No manager" }));
    expect(h.setManagerMutate).toHaveBeenCalledTimes(1);
    expect(h.setManagerMutate.mock.calls[0][0]).toEqual({
      memberId: "test-agent-id",
      managerId: null,
    });
  });

  it("shows the org-wide note (no control) for an admin agent", () => {
    h.rows = [
      row({
        agent_id: "test-agent-id",
        full_name: "Sarah Lim",
        email: "sarah@acme.com",
        role: "admin",
        status: "active",
      }),
      row({ agent_id: "mgr-1", full_name: "Mike Manager", role: "manager", status: "active" }),
      row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
    ];
    renderPage();
    expect(screen.getByText("Admins see the whole organization.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the current manager read-only to a non-admin caller", () => {
    h.authUserId = "mgr-2"; // a manager, not an admin
    h.callerRoleLevel = "sales_manager"; // lacks assignRoleLevels too
    renderPage();
    expect(screen.getByText("Reports to")).toBeInTheDocument();
    // No editable control for non-admins (neither reports-to nor role level).
    expect(screen.queryByRole("combobox")).toBeNull();
    // The current manager's name is shown read-only.
    expect(screen.getByText("Mike Manager")).toBeInTheDocument();
  });

  it("excludes the viewed member from their OWN manager options (no self-report)", () => {
    // View a MANAGER's detail so the self-exclusion clause is exercised
    // independently of the role filter (a manager IS role-eligible).
    h.rows = [
      row({ agent_id: "test-agent-id", full_name: "Mike Manager", role: "manager", status: "active" }),
      row({ agent_id: "mgr-2", full_name: "Nora Manager", role: "manager", status: "active" }),
      row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Reports to" }));
    // Other managers/admins are offered…
    expect(screen.getByRole("option", { name: "Nora Manager" })).toBeTruthy();
    // …but the viewed manager is NOT an option for themselves.
    expect(screen.queryByRole("option", { name: "Mike Manager" })).toBeNull();
  });

  it("excludes the viewed member's own reports (cycle) from manager options", () => {
    // Mike (viewed) manages a sub-manager. The sub-manager is role-eligible but
    // is a descendant → must not be selectable (would form a loop).
    h.rows = [
      row({ agent_id: "test-agent-id", full_name: "Mike Manager", role: "manager", status: "active" }),
      row({ agent_id: "sub-mgr", full_name: "Sub Manager", role: "manager", status: "active", manager_id: "test-agent-id" }),
      row({ agent_id: "mgr-2", full_name: "Nora Manager", role: "manager", status: "active" }),
      row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Reports to" }));
    expect(screen.getByRole("option", { name: "Nora Manager" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Sub Manager" })).toBeNull();
  });

  it("keeps a deactivated current manager visible (Select not blank)", () => {
    // Sarah reports to mgr-1, but mgr-1 has been deactivated → not eligible.
    h.rows = [
      SARAH(),
      row({ agent_id: "mgr-1", full_name: "Mike Manager", role: "manager", status: "revoked" }),
      row({ agent_id: "mgr-2", full_name: "Nora Manager", role: "manager", status: "active" }),
      row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Reports to" }));
    // The current (now-inactive) manager is still shown, flagged.
    expect(screen.getByRole("option", { name: /Mike Manager \(inactive\)/ })).toBeTruthy();
  });

  it("shows a read-only line (no editable control) for an invited/revoked member", () => {
    // Admin caller, but the member isn't active → not editable.
    h.rows = [
      row({ agent_id: "test-agent-id", full_name: "Pending Pat", role: "rep", status: "invited", manager_id: null }),
      row({ agent_id: "admin-1", full_name: "Amy Admin", role: "admin", status: "active" }),
    ];
    renderPage();
    expect(screen.getByText("Reports to")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("AgentDetailPage / role-level control", () => {
  it("lets an admin caller pick a member's role level, preselected, and fires the hook", () => {
    renderPage();
    expect(screen.getByText("Role level")).toBeInTheDocument();

    // The role-level combobox is distinct from the reports-to one.
    const combo = screen.getByRole("combobox", { name: "Role level" });
    fireEvent.click(combo);

    // All 7 levels are offered, current one preselected.
    expect(screen.getByRole("option", { name: "Administrator" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sales Manager" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Sales Professional" }).getAttribute("data-state"),
    ).toBe("checked");

    // Choosing a level calls the hook with { profileId, level }.
    fireEvent.click(screen.getByRole("option", { name: "Sales Manager" }));
    expect(h.setRoleLevelMutate).toHaveBeenCalledTimes(1);
    expect(h.setRoleLevelMutate.mock.calls[0][0]).toEqual({
      profileId: "test-agent-id",
      level: "sales_manager",
    });
  });

  it("shows the role level read-only (no Select) to a caller who can't assign levels", () => {
    h.authUserId = "mgr-1";
    h.callerRoleLevel = "sales_manager"; // lacks assignRoleLevels
    renderPage();
    expect(screen.getByText("Role level")).toBeInTheDocument();
    // No editable control for non-administrators.
    expect(screen.queryByRole("combobox", { name: "Role level" })).toBeNull();
    // The current level label is shown read-only.
    expect(screen.getByText("Sales Professional")).toBeInTheDocument();
  });

  it("shows the role level read-only when an admin views their OWN row (self-guard)", () => {
    // Amy Admin views her own detail page: role level is not self-editable
    // (admin_set_role_level rejects changing your own role server-side too).
    h.rows = [
      row({ agent_id: "test-agent-id", full_name: "Amy Admin", role: "admin", role_level: "administrator", status: "active" }),
    ];
    h.authUserId = "test-agent-id";
    h.callerRoleLevel = "administrator";
    renderPage();
    expect(screen.getByText("Role level")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Role level" })).toBeNull();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });
});
