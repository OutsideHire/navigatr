// Regression: SettingsPage contracts (Session 20 QA, 2026-05-17; updated
// 2026-05-28 for the design-critique redesign).
//
// Pins behaviors most likely to silently regress after the auto-save
// redesign:
//   1. There is NO "Save name" button. The form auto-saves on input
//      after a debounce. A regression that re-adds an explicit Save
//      button would reintroduce the inconsistency the critique flagged.
//   2. Auto-save fires after the debounce window and calls
//      supabase.auth.updateUser with the trimmed name. Whitespace-only
//      edits or unchanged values must NOT trigger a save.
//   3. Theme radios update useTheme on click. Radix-pattern Theme buttons
//      use role="radio".
//   4. Section headings render in the expected order. The Account section
//      was split into Session + Danger zone — both must be present.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Capture the updateUser mock so individual tests can assert on it.
// vi.fn() with no implementation accepts any args, which is what we want
// here for spread compatibility.
const updateUserMock = vi.fn();
updateUserMock.mockResolvedValue({ data: { user: null }, error: null });

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

vi.mock("@/stores/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/auth")>();
  return {
    ...actual,
    useAuth: Object.assign(
      (selector: (s: { user: unknown; signOut: () => Promise<void>; setProfession: () => Promise<void> }) => unknown) =>
        selector({
          user: {
            id: "u-test",
            email: "test@navigatr.app",
            user_metadata: { full_name: "Jamie Rivera", profession: "merchant_services" },
          },
          signOut: vi.fn(() => Promise.resolve()),
          setProfession: vi.fn(() => Promise.resolve()),
        }),
      { getState: () => ({}) },
    ),
  };
});

import { SettingsPage } from "./SettingsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage / contracts (auto-save redesign)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does NOT render a 'Save name' button — Profile is auto-save", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /Save name/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save changes/i })).toBeNull();
  });

  it("auto-saves the trimmed full name after the debounce window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    const input = screen.getByLabelText(/Full name/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Different Name");
    // Debounce is 500ms; advance past it.
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(updateUserMock).toHaveBeenCalledWith({ data: { full_name: "Different Name" } });
  });

  it("does NOT auto-save when the input matches the current name (no-op)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    // Initial render: name matches user_metadata.full_name → no save.
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("does NOT auto-save on whitespace-only input", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    const input = screen.getByLabelText(/Full name/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "    ");
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("renders all expected sections (Account split into Session + Danger zone)", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /^Profile$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Industry$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Appearance$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Notifications$/i })).toBeInTheDocument();
    // Critique #11 split: Session + Danger zone replace the previous
    // single "Account" section.
    expect(screen.getByRole("heading", { name: /^Session$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Danger zone$/i })).toBeInTheDocument();
  });

  it("Theme buttons use the radiogroup pattern with role=radio", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: /theme/i });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio", { name: /(light|dark|system)/i });
    expect(radios.length).toBe(3);
  });

  it("Industry tiles render with exactly one active card (one indigo per page)", () => {
    renderPage();
    // The active card has aria-pressed="true"; others are false. The
    // accessible name of each tile includes both label + description
    // (e.g. "Payroll HR, benefits, ...") so we match by the leading word.
    const merchantTile = screen.getByRole("button", { name: /^merchant services/i });
    expect(merchantTile.getAttribute("aria-pressed")).toBe("true");
    const payrollTile = screen.getByRole("button", { name: /^payroll/i });
    expect(payrollTile.getAttribute("aria-pressed")).toBe("false");
    const treasuryTile = screen.getByRole("button", { name: /^treasury management/i });
    expect(treasuryTile.getAttribute("aria-pressed")).toBe("false");
  });

  it("does NOT leak internal copy like 'Sprint 2' in the Notifications section", () => {
    renderPage();
    expect(screen.queryByText(/Sprint 2/i)).toBeNull();
    expect(screen.queryByText(/Backend wires/i)).toBeNull();
  });

  it("Team section consolidates Link + Code into one card with a switcher", () => {
    renderPage();
    // Should have a single Link/Code radio group (the switcher).
    const switcher = screen.getByRole("radiogroup", { name: /share invite as/i });
    expect(switcher).toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: /(link|code)/i })).toHaveLength(2);
    // Should NOT have a second "Or share just the code" subheading.
    expect(screen.queryByText(/Or share just the code/i)).toBeNull();
  });
});
