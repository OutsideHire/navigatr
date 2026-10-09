// apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewReferralSheet } from "./ReviewReferralSheet";
import type { QueueReferral } from "../hooks/useReferralQueue";

const accept = vi.fn();
let acceptPending = false;
const decline = vi.fn();
const merge = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useAcceptReferral: () => ({ mutateAsync: accept, isPending: acceptPending }),
  useDeclineReferral: () => ({ mutateAsync: decline, isPending: false }),
  useMergeReferral: () => ({ mutateAsync: merge, isPending: false }),
}));
const checkPlaceDuplicate = vi.fn();
vi.mock("@/features/pipeline/hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({ checkPlaceDuplicate }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [
    { id: "d-1", companyName: "Zed Cafe", stage: "contacted" },
    { id: "d-2", companyName: "Alpha Gym", stage: "new" },
    { id: "d-3", companyName: "Closed Co", stage: "won" },
  ] }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    Select: ({ value, onValueChange, options, placeholder }: {
      value?: string; onValueChange?: (v: string) => void;
      options: Array<{ value: string; label: string }>; placeholder?: string;
    }) => (
      <select aria-label={placeholder} value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="">--</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

const referral: QueueReferral = {
  id: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co",
  companyName: "Fresh Bakery", contactName: "Ann", contactEmail: "ann@fresh.example",
  contactPhone: "+15550001", address: "5 Oak St", placeId: null, notes: "Wants a demo",
  submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
};

function renderSheet(onOpenChange = vi.fn()) {
  render(<ReviewReferralSheet referral={referral} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

beforeEach(() => {
  acceptPending = false; accept.mockReset(); decline.mockReset(); merge.mockReset();
  checkPlaceDuplicate.mockReset().mockResolvedValue(null);
  toastSuccess.mockReset(); toastError.mockReset();
});

describe("ReviewReferralSheet", () => {
  it("shows what the partner sent", async () => {
    renderSheet();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText(/From Jane · Jane & Co/)).toBeInTheDocument();
    expect(screen.getByText("Wants a demo")).toBeInTheDocument();
    await waitFor(() => expect(checkPlaceDuplicate).toHaveBeenCalledWith({
      placeId: null, name: "Fresh Bakery", phone: "+15550001", address: "5 Oak St",
    }));
  });

  it("warns about a possible duplicate", async () => {
    checkPlaceDuplicate.mockResolvedValueOnce({ tier: "phone", dealId: "d-1", companyName: "Zed Cafe", dealHasPlaceId: false });
    renderSheet();
    expect(await screen.findByText(/Possible duplicate: Zed Cafe is already in your team's pipeline/)).toBeInTheDocument();
  });

  it("disables Merge and Decline while an accept is in flight", () => {
    acceptPending = true;
    renderSheet();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });

  it("accepts and closes", async () => {
    accept.mockResolvedValueOnce({ result: "accepted", dealId: "d-9" });
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("r-1");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Accepted. Deal created.");
  });

  it("moves to merge when accept hits a duplicate", async () => {
    accept.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Already in your team's pipeline");
  });

  it("requires a reason to decline", async () => {
    decline.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const submit = screen.getByRole("button", { name: "Decline referral" });
    expect(submit).toBeDisabled();
  });

  it("keeps the sheet open and toasts on error", async () => {
    accept.mockRejectedValueOnce(new Error("This referral was already handled."));
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This referral was already handled."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps state when the parent passes a new object for the same referral", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<ReviewReferralSheet referral={referral} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    rerender(<ReviewReferralSheet referral={{ ...referral }} open onOpenChange={onOpenChange} />);
    expect(screen.getByRole("button", { name: "Decline referral" })).toBeInTheDocument();
  });

  it("declines with the chosen reason", async () => {
    decline.mockResolvedValueOnce(undefined);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a reason…"), "outside_icp");
    await userEvent.click(screen.getByRole("button", { name: "Decline referral" }));
    expect(decline).toHaveBeenCalledWith({ referralId: "r-1", reason: "outside_icp", note: "" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Referral declined");
  });

  it("merges into the picked deal", async () => {
    merge.mockResolvedValueOnce(undefined);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a deal…"), "d-1");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(merge).toHaveBeenCalledWith({ referralId: "r-1", dealId: "d-1" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Merged into the existing deal");
  });

  it("lists only open deals sorted by company name", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    const labels = screen.getAllByRole("option").map((o) => o.textContent).filter((l) => l !== "--");
    expect(labels).toEqual(["Alpha Gym", "Zed Cafe"]);
  });
});
