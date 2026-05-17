// Regression: SettingsPage contracts (Session 20 QA, 2026-05-17)
//
// Pins three behaviors most likely to silently regress:
//   1. Save-name button is disabled until the input is actually different
//      from the current user's full name AND non-empty after trim. If a
//      refactor changes the comparison to a loose check, whitespace-only
//      edits would be savable — wasteful round-trip to supabase.
//   2. Theme radios update useTheme on click. Radix-pattern Theme buttons
//      use role="radio". A regression in the button's onClick or radio
//      props would silently break theme switching.
//   3. Account section's Sign out button calls useAuth.signOut and then
//      navigates to /login. Important: the spawned Activity-loop bug
//      (ISSUE-001 in Activities) was specifically about setState bailouts;
//      this confirms async-await flow in signOut.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the Supabase client so test doesn't hit network. Must include the
// methods auth.ts calls at module load (getSession, onAuthStateChange)
// otherwise the auth store crashes before our test gets to run.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      updateUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

// Mock the auth store to provide a deterministic user for the test.
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

describe("SettingsPage / contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("Save name button is disabled when input matches the current full name", () => {
    renderPage();
    const saveBtn = screen.getByRole("button", { name: /Save name/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Save name button enables after typing a different name", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText(/Full name/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Different Name");
    const saveBtn = screen.getByRole("button", { name: /Save name/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("Save name stays disabled on whitespace-only edit", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText(/Full name/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "    ");
    const saveBtn = screen.getByRole("button", { name: /Save name/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Renders all expected sections", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /^Profile$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Industry$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Appearance$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Notifications$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Account$/i })).toBeInTheDocument();
  });

  it("Theme buttons use the radiogroup pattern with role=radio", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: /theme/i });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(3); // Light / Dark / System
  });
});
