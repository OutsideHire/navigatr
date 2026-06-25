// Focused test for the invite-link rotation wired into the live Team section
// (rendered here via SettingsPage, which the settings-hub PersonalTab wraps).
// Asserts the admin-only gating + that confirming the dialog calls the
// rotate_invite_code mutation. The hook itself and the parallel Organization-tab
// surface are tested separately.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix Dialog uses Pointer Capture + scrollIntoView; jsdom lacks both.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let role: "rep" | "manager" | "admin";
const rotateAsync = vi.fn(() => Promise.resolve("newcode1"));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      updateUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

vi.mock("@/stores/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/auth")>();
  return {
    ...actual,
    // Force the Team section to render regardless of profession heuristics.
    canInviteTeam: () => true,
    useAuth: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({
          user: {
            id: "u-test",
            email: "admin@navigatr.app",
            user_metadata: { full_name: "Avery Admin", profession: "merchant_services" },
          },
          signOut: vi.fn(() => Promise.resolve()),
          setProfession: vi.fn(() => Promise.resolve()),
        }),
      { getState: () => ({}) },
    ),
  };
});

vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role } }),
}));
vi.mock("@/features/auth/useOrganization", () => ({
  useOrganization: () => ({ data: { id: "o1", name: "Acme", inviteCode: "oldcode1" }, isLoading: false, isError: false }),
}));
vi.mock("@/features/admin/hooks/useRotateInviteCode", () => ({
  useRotateInviteCode: () => ({ mutateAsync: rotateAsync, isPending: false }),
}));
vi.mock("@/features/account/DeleteAccountDialog", () => ({
  DeleteAccountDialog: () => <div>danger</div>,
}));

import { SettingsPage } from "./SettingsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { role = "admin"; rotateAsync.mockClear(); });
afterEach(() => cleanup());

describe("SettingsPage Team section — invite-link rotation", () => {
  it("hides Regenerate for non-admins (manager)", () => {
    role = "manager";
    renderPage();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("shows Regenerate for admins and rotates on confirm", async () => {
    role = "admin";
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^regenerate$/i }));
    expect(await screen.findByText(/this breaks the current link/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /regenerate link/i }));
    await waitFor(() => expect(rotateAsync).toHaveBeenCalledTimes(1));
  });
});
