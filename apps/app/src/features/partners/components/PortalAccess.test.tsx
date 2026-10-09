import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerPortalUser } from "../hooks/usePortalAccess";
import type { PortalUserStatus } from "../lib/portalAccess";

const state: {
  status: { data?: { enabled: boolean; slug: string } };
  user: { data: PartnerPortalUser | null; isPending: boolean };
} = {
  status: { data: { enabled: true, slug: "acme" } },
  user: { data: null, isPending: false },
};
const inviteMutate = vi.fn();
const setAccessMutate = vi.fn();

vi.mock("../hooks/usePortalAccess", () => ({
  usePortalStatus: () => state.status,
  usePartnerPortalUser: () => state.user,
  useInviteToPortal: () => ({ mutateAsync: inviteMutate, isPending: false }),
  useSetPortalAccess: () => ({ mutateAsync: setAccessMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { PortalAccessLine, PortalInviteButton } from "./PortalAccess";

function portalUser(status: PortalUserStatus): PartnerPortalUser {
  return { partnerId: "p-1", status, invitedAt: null, activatedAt: null, lastLoginAt: null };
}

beforeEach(() => {
  state.status = { data: { enabled: true, slug: "acme" } };
  state.user = { data: null, isPending: false };
  inviteMutate.mockReset();
  setAccessMutate.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PortalInviteButton", () => {
  it("is hidden when the org portal is off", () => {
    state.status = { data: { enabled: false, slug: "acme" } };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.queryByRole("button", { name: "Invite to portal" })).toBeNull();
  });

  it("is hidden when the partner has no email", () => {
    render(<PortalInviteButton partnerId="p-1" email="  " />);
    expect(screen.queryByRole("button", { name: "Invite to portal" })).toBeNull();
  });

  it("is hidden once the partner has access", () => {
    state.user = { data: portalUser("active"), isPending: false };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  });

  it("invites a partner who has not been invited", async () => {
    const user = userEvent.setup();
    inviteMutate.mockResolvedValueOnce({ emailed: true });
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    await user.click(screen.getByRole("button", { name: "Invite to portal" }));
    expect(inviteMutate).toHaveBeenCalledWith("p-1");
    expect(toast.success).toHaveBeenCalledWith("Invite sent to jane@example.com");
  });

  it("says no email went out when the environment guard dropped the send", async () => {
    const user = userEvent.setup();
    inviteMutate.mockResolvedValueOnce({ emailed: false });
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    await user.click(screen.getByRole("button", { name: "Invite to portal" }));
    expect(toast.success).toHaveBeenCalledWith("Invite created, but no email was sent (test environment).");
    expect(toast.success).not.toHaveBeenCalledWith("Invite sent to jane@example.com");
  });

  it("offers Resend invite while the invite is pending", () => {
    state.user = { data: portalUser("invited"), isPending: false };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
  });

  it("explains a refusal in plain words", async () => {
    const user = userEvent.setup();
    inviteMutate.mockRejectedValueOnce(new Error("portal_disabled"));
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    await user.click(screen.getByRole("button", { name: "Invite to portal" }));
    expect(toast.error).toHaveBeenCalledWith("The partner portal is turned off. An admin can turn it on in Settings.");
  });
});

describe("PortalAccessLine", () => {
  it("is hidden when the org portal is off", () => {
    state.status = { data: { enabled: false, slug: "acme" } };
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.queryByText(/Portal:/)).toBeNull();
  });

  it("shows Not invited and copies the portal address", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.getByText("Portal: Not invited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Revoke access" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy portal address" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/acme`);
    expect(toast.success).toHaveBeenCalledWith("Portal address copied");
  });

  it("suspends or revokes an active partner", async () => {
    const user = userEvent.setup();
    state.user = { data: portalUser("active"), isPending: false };
    setAccessMutate.mockResolvedValueOnce("revoked");
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.getByText("Portal: Active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Suspend access" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(setAccessMutate).toHaveBeenCalledWith({ partnerId: "p-1", status: "revoked" });
    expect(toast.success).toHaveBeenCalledWith("Portal access revoked");
  });

  it("restores a suspended partner back to invited", async () => {
    const user = userEvent.setup();
    state.user = { data: portalUser("suspended"), isPending: false };
    setAccessMutate.mockResolvedValueOnce("invited");
    render(<PortalAccessLine partnerId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Restore access" }));
    expect(setAccessMutate).toHaveBeenCalledWith({ partnerId: "p-1", status: "invited" });
  });
});
