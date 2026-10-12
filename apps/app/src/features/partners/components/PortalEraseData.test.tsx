import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state: {
  profile: { data: { role_level: string } | null };
  user: { data: { status: string } | null };
} = { profile: { data: { role_level: "administrator" } }, user: { data: { status: "revoked" } } };
const purge = vi.fn();
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => state.profile }));
vi.mock("../hooks/usePortalAccess", () => ({
  usePartnerPortalUser: () => state.user,
  usePurgePortalUser: () => ({ mutateAsync: purge, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { PortalEraseData } from "./PortalEraseData";

beforeEach(() => {
  state.profile = { data: { role_level: "administrator" } };
  state.user = { data: { status: "revoked" } };
  purge.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("PortalEraseData", () => {
  it("is for administrators only", () => {
    state.profile = { data: { role_level: "sales_manager" } };
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    expect(screen.queryByRole("button", { name: "Erase portal data" })).toBeNull();
  });

  it("is hidden when the partner never had portal access", () => {
    state.user = { data: null };
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    expect(screen.queryByRole("button", { name: "Erase portal data" })).toBeNull();
  });

  it("erases only after Confirm, and says what happens", async () => {
    purge.mockResolvedValueOnce(undefined);
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    expect(
      screen.getByText(
        "Erase Jane's portal sign-in details? Access is revoked right away and their portal email and sign-in history are erased. Their referrals stay.",
      ),
    ).toBeInTheDocument();
    expect(purge).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    expect(purge).toHaveBeenCalledWith("p-1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Portal data erased. Access is revoked."));
  });

  it("Cancel leaves everything as it was, and a refusal is explained", async () => {
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Erase portal data" })).toBeInTheDocument();
    purge.mockRejectedValueOnce({ message: "not_authorized" });
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
  });
});
