// apps/app/src/features/admin/pages/AgentsPage.test.tsx
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsPage } from "./AgentsPage";

// Radix DropdownMenu uses Pointer Capture + scrollIntoView; jsdom lacks both.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

// Default mock: a single rep row whose agent_id is NOT the signed-in user, so
// `callerRole` is undefined → settableRoles returns [] → no role items render →
// the existing assertions below are unaffected by the role-change feature.
const DEFAULT_ROWS: Array<Record<string, unknown>> = [
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
];
let leaderboardRows: Array<Record<string, unknown>> = DEFAULT_ROWS;

vi.mock("../hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({
    data: leaderboardRows,
    isLoading: false,
  }),
  TEAM_LEADERBOARD_QUERY_KEY: (userId: string, windowDays: number) => ["admin", "leaderboard", userId, windowDays],
}));
vi.mock("../hooks/useResendInvite", () => ({ useResendInvite: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useRevokeMember", () => ({ useRevokeMember: () => ({ mutateAsync: vi.fn() }) }));
const setRoleMutate = vi.fn();
vi.mock("../hooks/useSetMemberRole", () => ({ useSetMemberRole: () => ({ mutate: setRoleMutate }) }));
// AgentsPage derives the caller's role from rows.find(agent_id === userId).
// The default user is "self" (not in the default rows) → callerRole undefined.
const authUserId = { current: "self" as string | undefined };
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string | undefined } }) => unknown) =>
    selector({ user: { id: authUserId.current } }),
}));
vi.mock("../hooks/useSeatUsage", () => ({ useSeatUsage: () => ({ data: { used: 1, limit: 10, remaining: 9 }, isLoading: false }) }));
// TeamCoverageCard mounts useCoverageRollup → supabase.rpc; mock it deterministically.
// With rows: [] the card renders null, so existing assertions are unaffected.
vi.mock("@/features/coverage/hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows: [], isLoading: false }),
}));

describe("AgentsPage", () => {
  // Reset all mutable module-level state to its default after every test so
  // tests stay order-independent regardless of which custom fixtures they set.
  afterEach(() => {
    leaderboardRows = DEFAULT_ROWS;
    authUserId.current = "self";
  });

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

  it("lets an admin promote a rep via the row menu (confirmed)", async () => {
    // Caller is an active admin present in the leaderboard, plus a separate rep row.
    authUserId.current = "p_admin";
    leaderboardRows = [
      {
        agent_id: "p_admin",
        full_name: "Admin Adam",
        email: "admin@x.com",
        role: "admin",
        status: "active",
        open_deals: 0,
        pipeline_cents: 0,
        won_deals_window: 0,
        won_cents_window: 0,
        lost_deals_window: 0,
        lost_cents_window: 0,
        activities_window: 0,
        last_activity: null,
      },
      {
        agent_id: "p_rep",
        full_name: "Rep Rita",
        email: "rep@x.com",
        role: "rep",
        status: "active",
        open_deals: 1,
        pipeline_cents: 10_000,
        won_deals_window: 0,
        won_cents_window: 0,
        lost_deals_window: 0,
        lost_cents_window: 0,
        activities_window: 0,
        last_activity: null,
      },
    ];
    setRoleMutate.mockClear();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Open the rep row's action menu (scope to the desktop table).
    const table = screen.getByRole("table");
    const repRow = within(table).getByText("Rep Rita").closest("tr") as HTMLElement;
    await user.click(within(repRow).getByRole("button", { name: "Row actions" }));

    await user.click(await screen.findByText("Promote to manager"));

    expect(setRoleMutate).toHaveBeenCalledWith(
      { profileId: "p_rep", newRole: "manager" },
      expect.any(Object),
    );

    confirmSpy.mockRestore();
  });

  it("does not change the role when an admin cancels the confirm prompt", async () => {
    // Same setup as the confirmed test: admin caller in rows + a rep row.
    authUserId.current = "p_admin";
    leaderboardRows = [
      {
        agent_id: "p_admin",
        full_name: "Admin Adam",
        email: "admin@x.com",
        role: "admin",
        status: "active",
        open_deals: 0,
        pipeline_cents: 0,
        won_deals_window: 0,
        won_cents_window: 0,
        lost_deals_window: 0,
        lost_cents_window: 0,
        activities_window: 0,
        last_activity: null,
      },
      {
        agent_id: "p_rep",
        full_name: "Rep Rita",
        email: "rep@x.com",
        role: "rep",
        status: "active",
        open_deals: 1,
        pipeline_cents: 10_000,
        won_deals_window: 0,
        won_cents_window: 0,
        lost_deals_window: 0,
        lost_cents_window: 0,
        activities_window: 0,
        last_activity: null,
      },
    ];
    setRoleMutate.mockClear();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Open the rep row's action menu (scope to the desktop table).
    const table = screen.getByRole("table");
    const repRow = within(table).getByText("Rep Rita").closest("tr") as HTMLElement;
    await user.click(within(repRow).getByRole("button", { name: "Row actions" }));

    await user.click(await screen.findByText("Promote to manager"));

    // Cancelling the confirm prompt must not trigger the mutation.
    expect(setRoleMutate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
