// Focuses on the onboarding-activation gating DashboardPage adds. A brand-new
// org renders only the light selling zero-state (not the heavy populated tree),
// so these cases avoid mocking the whole dashboard. The gating splits by role:
// inviters get the Get-Started checklist, a field rep gets the first-action
// nudge, and neither renders once its condition clears.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DashboardPage } from "./DashboardPage";
import { deriveOnboardingSteps, type OnboardingCounts } from "../hooks/useOnboardingProgress";
import type { RoleLevel } from "@/features/auth/capabilities";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: unknown }) => unknown) =>
    sel({ user: { id: "u1", user_metadata: { full_name: "Alice Admin" }, email: "a@x.com" } }),
  getFirstName: () => "Alice",
}));

// Controllable viewer role — drives canInvite (checklist) vs isFieldRep (nudge).
let profileRole: RoleLevel = "administrator";
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role_level: profileRole, role: "admin" } }),
}));

// Controllable rep first-action state (only consulted for a field rep).
let repAction: { hasOwnDeals: boolean; hasOwnActivities: boolean; taken: boolean; isLoading: boolean };
vi.mock("../hooks/useRepFirstAction", () => ({
  useRepFirstAction: () => repAction,
}));

let progress: ReturnType<typeof makeProgress>;
vi.mock("../hooks/useOnboardingProgress", async (orig) => {
  const actual = await orig<typeof import("../hooks/useOnboardingProgress")>();
  return { ...actual, useOnboardingProgress: () => progress };
});

function makeProgress(counts: OnboardingCounts, allComplete: boolean) {
  return { steps: deriveOnboardingSteps(counts), counts, allComplete, isLoading: false };
}
const NEW_ORG: OnboardingCounts = { invitesSent: 0, orgMemberCount: 1, orgActivityCount: 0, orgDealCount: 0 };

beforeEach(() => {
  navigateMock.mockReset();
  profileRole = "administrator";
  repAction = { hasOwnDeals: false, hasOwnActivities: false, taken: false, isLoading: false };
  progress = makeProgress(NEW_ORG, false);
});

function renderPage() {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

describe("DashboardPage activation gating", () => {
  it("inviter on a brand-new org sees the Get-Started checklist + selling zero-state, not the populated dashboard", () => {
    progress = makeProgress(NEW_ORG, false);
    renderPage();
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getAllByText(/invite your team/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/your dashboard comes alive/i)).toBeInTheDocument();
    // The populated dashboard's "Dashboard" heading must NOT render for a new org.
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
    // The rep nudge is never shown to an inviter.
    expect(screen.queryByText(/make your first move/i)).not.toBeInTheDocument();
  });

  it("hides the checklist once activation is complete", () => {
    progress = makeProgress(NEW_ORG, true);
    renderPage();
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  });

  it("field rep who hasn't acted sees the first-action nudge, not the admin checklist", () => {
    profileRole = "sales_professional";
    repAction = { hasOwnDeals: false, hasOwnActivities: false, taken: false, isLoading: false };
    renderPage();
    expect(screen.getByText(/make your first move/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log your first stop/i })).toBeInTheDocument();
    // The admin checklist and its dead-end "Invite your team" CTA stay hidden.
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  });

  it("nudge CTAs deep-link to one-tap destinations (Path, and the Add Deal sheet)", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    profileRole = "sales_professional";
    repAction = { hasOwnDeals: false, hasOwnActivities: false, taken: false, isLoading: false };
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /log your first stop/i }));
    expect(navigateMock).toHaveBeenCalledWith("/path");
    await user.click(screen.getByRole("button", { name: /add a deal/i }));
    // ?action=add opens the Add Deal sheet directly — no second tap on the board.
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?action=add");
  });

  it("field rep who has taken a first action sees neither surface", () => {
    profileRole = "sales_professional";
    repAction = { hasOwnDeals: true, hasOwnActivities: false, taken: true, isLoading: false };
    renderPage();
    expect(screen.queryByText(/make your first move/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  });

  it("does not flash the nudge while the rep's counts are still loading", () => {
    profileRole = "sales_professional";
    repAction = { hasOwnDeals: false, hasOwnActivities: false, taken: false, isLoading: true };
    renderPage();
    expect(screen.queryByText(/make your first move/i)).not.toBeInTheDocument();
  });

  it("mid-band manager (cannot invite, not a field rep) sees neither surface", () => {
    profileRole = "sales_manager";
    renderPage();
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
    expect(screen.queryByText(/make your first move/i)).not.toBeInTheDocument();
  });
});
