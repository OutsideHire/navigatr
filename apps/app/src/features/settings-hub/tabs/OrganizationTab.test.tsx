import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationTab } from "./OrganizationTab";

// Radix Dialog uses Pointer Capture + scrollIntoView; jsdom lacks both.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let role: "rep" | "manager" | "admin";
const rotateAsync = vi.fn(() => Promise.resolve("newcode1"));

vi.mock("@/features/auth/useOrganization", () => ({
  useOrganization: () => ({ data: { id: "o1", name: "Acme", inviteCode: "oldcode1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role } }),
}));
vi.mock("@/features/admin/hooks/useRotateInviteCode", () => ({
  useRotateInviteCode: () => ({ mutateAsync: rotateAsync, isPending: false }),
}));
vi.mock("@/features/admin/components/SeatUsageBadge", () => ({
  SeatUsageBadge: () => <span>seats</span>,
}));

beforeEach(() => { role = "admin"; rotateAsync.mockClear(); });

describe("OrganizationTab — invite-code rotation", () => {
  it("hides Regenerate for reps", () => {
    role = "rep";
    render(<OrganizationTab />);
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("hides Regenerate for managers", () => {
    role = "manager";
    render(<OrganizationTab />);
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("shows Regenerate for admins and rotates on confirm", async () => {
    role = "admin";
    const user = userEvent.setup();
    render(<OrganizationTab />);

    await user.click(screen.getByRole("button", { name: /^regenerate$/i }));
    // Dialog opens with the warning copy.
    expect(await screen.findByText(/this breaks the current link/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /regenerate link/i }));
    await waitFor(() => expect(rotateAsync).toHaveBeenCalledTimes(1));
  });
});
