/**
 * SettingsHubPage — integration smoke covering role gating, URL → tab,
 * and the desktop tab rail. Heavy children (tab content components) are
 * stubbed so this test stays focused on the hub's routing + visibility.
 *
 * Mobile vs. desktop is tested via matchMedia mock — the hub flips layouts
 * based on the (min-width: 768px) media query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Stub each tab to a tiny div so we can assert which one is mounted
// without rendering the real (heavy) settings pages.
vi.mock("./tabs/PersonalTab", () => ({
  PersonalTab: () => <div data-testid="tab-content">PERSONAL_TAB_CONTENT</div>,
}));
vi.mock("./tabs/OrganizationTab", () => ({
  OrganizationTab: () => <div data-testid="tab-content">ORG_TAB_CONTENT</div>,
}));
vi.mock("./tabs/BrandingTab", () => ({
  BrandingTab: () => <div data-testid="tab-content">BRANDING_TAB_CONTENT</div>,
}));
vi.mock("./tabs/ProfessionTab", () => ({
  ProfessionTab: () => <div data-testid="tab-content">PROFESSION_TAB_CONTENT</div>,
}));
vi.mock("./tabs/DangerZoneTab", () => ({
  DangerZoneTab: () => <div data-testid="tab-content">DANGER_TAB_CONTENT</div>,
}));

let profileShape: { data?: { role: "rep" | "manager" | "admin" } | null } = { data: null };
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => profileShape,
}));

// Force desktop layout for these tests (we render the tab rail).
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("min-width: 768px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

import { SettingsHubPage } from "./SettingsHubPage";

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/settings" element={<SettingsHubPage />} />
        <Route path="/settings/:tabId" element={<SettingsHubPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsHubPage — desktop layout", () => {
  it("defaults to Personal tab when no ?tab param", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    expect(screen.getByTestId("tab-content")).toHaveTextContent("PERSONAL_TAB_CONTENT");
  });

  it("renders the requested tab when role-permitted", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings?tab=branding");
    expect(screen.getByTestId("tab-content")).toHaveTextContent("BRANDING_TAB_CONTENT");
  });

  it("shows all 6 tabs to an admin in the rail", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist", { name: /settings sections/i });
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(6);
    const labels = Array.from(tabs).map((t) => t.textContent);
    expect(labels).toEqual([
      "Personal",
      "Organization",
      "Integrations",
      "Branding",
      "Profession",
      "Danger zone",
    ]);
  });

  it("shows only 3 tabs to a rep", () => {
    profileShape = { data: { role: "rep" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist");
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(Array.from(tabs).map((t) => t.textContent)).toEqual([
      "Personal",
      "Organization",
      "Integrations",
    ]);
  });

  it("redirects rep away from branding (renders personal instead)", () => {
    profileShape = { data: { role: "rep" } };
    renderAt("/settings?tab=branding");
    // The redirect fires in an effect; on initial render the tab list
    // already filters to rep-visible tabs, and the content panel renders
    // whatever tab the resolve returns (personal).
    expect(screen.getByTestId("tab-content")).toHaveTextContent("PERSONAL_TAB_CONTENT");
  });

  it("redirects manager away from danger zone", () => {
    profileShape = { data: { role: "manager" } };
    renderAt("/settings?tab=danger");
    expect(screen.getByTestId("tab-content")).toHaveTextContent("PERSONAL_TAB_CONTENT");
  });

  it("marks the active tab with aria-selected=true", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings?tab=profession");
    const professionTab = screen.getByRole("tab", { name: "Profession" });
    expect(professionTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab updates the rendered content", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    expect(screen.getByTestId("tab-content")).toHaveTextContent("PERSONAL_TAB_CONTENT");
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    expect(screen.getByTestId("tab-content")).toHaveTextContent("BRANDING_TAB_CONTENT");
  });

  it("renders all three group labels for admins (Account/Workspace/Advanced)", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist");
    expect(tablist.textContent).toMatch(/Account/);
    expect(tablist.textContent).toMatch(/Workspace/);
    expect(tablist.textContent).toMatch(/Advanced/);
  });

  it("renders only the Account group label for reps (no admin tabs visible)", () => {
    profileShape = { data: { role: "rep" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist");
    expect(tablist.textContent).toMatch(/Account/);
    expect(tablist.textContent).not.toMatch(/Workspace/);
    expect(tablist.textContent).not.toMatch(/Advanced/);
  });
});
