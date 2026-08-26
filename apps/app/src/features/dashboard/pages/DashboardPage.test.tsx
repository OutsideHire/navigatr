// Focuses on the onboarding-activation gating DashboardPage adds. A brand-new
// org renders only the light selling zero-state (not the heavy populated tree),
// so these cases avoid mocking the whole dashboard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DashboardPage } from "./DashboardPage";
import { deriveOnboardingSteps, type OnboardingCounts } from "../hooks/useOnboardingProgress";

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
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role_level: "administrator", role: "admin" } }),
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

beforeEach(() => navigateMock.mockReset());

function renderPage() {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

describe("DashboardPage activation gating", () => {
  it("brand-new org shows the Get-Started checklist + selling zero-state, not the populated dashboard", () => {
    progress = makeProgress(NEW_ORG, false);
    renderPage();
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getAllByText(/invite your team/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/your dashboard comes alive/i)).toBeInTheDocument();
    // The populated dashboard's "Dashboard" heading must NOT render for a new org.
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("hides the checklist once activation is complete", () => {
    progress = makeProgress(NEW_ORG, true);
    renderPage();
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  });
});
