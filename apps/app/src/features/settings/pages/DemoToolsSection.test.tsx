// DemoToolsSection — flag + role-gated "Reset demo data" card in Settings.
// Verifies: hidden when the demo_reset flag is off; hidden for reps but shown
// for managers/admins (matching reset_demo_data's server-side gate) when the
// flag is on; and that confirming the dialog calls the reset mutation.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

// Radix Dialog uses Pointer Capture + scrollIntoView; jsdom lacks both.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let flagEnabled: boolean;
let role: "rep" | "manager" | "admin";
const mutateAsync = vi.fn(() => Promise.resolve());
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/features/settings/hooks/useDemoResetEnabled", () => ({
  useDemoResetEnabled: () => flagEnabled,
}));
vi.mock("@/features/settings/hooks/useResetDemoData", () => ({
  useResetDemoData: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role } }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastSuccess(...args), {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));

import { DemoToolsSection } from "./SettingsPage";

beforeEach(() => {
  flagEnabled = true;
  role = "admin";
  mutateAsync.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});
afterEach(() => cleanup());

describe("DemoToolsSection", () => {
  it("renders nothing when the demo_reset flag is off", () => {
    flagEnabled = false;
    role = "admin";
    render(<DemoToolsSection />);
    expect(screen.queryByText(/Demo tools/i)).toBeNull();
  });

  it("renders nothing for a rep, even with the flag on", () => {
    flagEnabled = true;
    role = "rep";
    render(<DemoToolsSection />);
    expect(screen.queryByText(/Demo tools/i)).toBeNull();
  });

  it("shows the card for a manager (matches the reset function's gate)", () => {
    flagEnabled = true;
    role = "manager";
    render(<DemoToolsSection />);
    expect(screen.getByText(/Demo tools/i)).toBeInTheDocument();
  });

  it("opens a confirm dialog and calls the reset mutation on confirm", async () => {
    flagEnabled = true;
    role = "admin";
    const user = userEvent.setup();
    render(<DemoToolsSection />);

    expect(screen.getByText(/Demo tools/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reset demo data/i }));

    expect(await screen.findByText(/reset demo data\?/i)).toBeTruthy();

    const resetButtons = screen.getAllByRole("button", { name: /^reset$/i });
    await user.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });
});
