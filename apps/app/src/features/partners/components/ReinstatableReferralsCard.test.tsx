import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state: { data: Array<{ id: string; companyName: string; submittedAt: string }> | undefined } = { data: undefined };
const reinstate = vi.fn();
vi.mock("../hooks/useReinstateReferral", () => ({
  useReinstatableReferrals: () => state,
  useReinstateReferral: () => ({ mutateAsync: reinstate, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ReinstatableReferralsCard } from "./ReinstatableReferralsCard";

beforeEach(() => {
  state.data = [
    { id: "r-1", companyName: "Dup One", submittedAt: "2026-10-10T12:00:00Z" },
    { id: "r-2", companyName: "Dup Two", submittedAt: "2026-10-11T12:00:00Z" },
  ];
  reinstate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ReinstatableReferralsCard", () => {
  it("is hidden when nothing can be reinstated", () => {
    state.data = [];
    const { container } = render(<ReinstatableReferralsCard partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the declined duplicates and reinstates one", async () => {
    reinstate.mockResolvedValueOnce(undefined);
    render(<ReinstatableReferralsCard partnerId="p-1" />);
    expect(screen.getByRole("heading", { name: "Declined duplicates you can reinstate" })).toBeInTheDocument();
    expect(screen.getByText("The earlier referral for each of these is now closed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reinstate Dup One" }));
    expect(reinstate).toHaveBeenCalledWith("r-1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reinstated. It's back in Referrals to review."));
  });

  it("says why when the reinstate is refused", async () => {
    reinstate.mockRejectedValueOnce(new Error("This referral can't be reinstated now."));
    render(<ReinstatableReferralsCard partnerId="p-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reinstate Dup Two" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This referral can't be reinstated now."));
  });
});
