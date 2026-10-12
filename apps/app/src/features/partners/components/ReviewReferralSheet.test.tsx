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
const profileState: { data: { role: string; role_level: string } | null } = {
  data: { role: "rep", role_level: "sales_professional" },
};
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => profileState }));
const reassignMutate = vi.fn();
const assigneesState: { data: Array<{ id: string; name: string }> | undefined } = { data: undefined };
const seesState: { data: boolean | undefined; isError: boolean; isFetching: boolean } = {
  data: true,
  isError: false,
  isFetching: false,
};
const seesArgs: unknown[][] = [];
vi.mock("../hooks/useReassignReferral", () => ({
  useReferralAssignees: () => assigneesState,
  useAssigneeSeesPartner: (...a: unknown[]) => {
    seesArgs.push(a);
    return seesState;
  },
  useReassignReferral: () => ({ mutateAsync: reassignMutate, isPending: false }),
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

const flagged: QueueReferral = {
  ...referral,
  source: "portal_signed_in",
  duplicateOfReferralId: null,
  duplicateOfDealId: "d-1",
};

function renderSheet(onOpenChange = vi.fn()) {
  render(<ReviewReferralSheet referral={referral} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

beforeEach(() => {
  acceptPending = false; accept.mockReset(); decline.mockReset(); merge.mockReset();
  checkPlaceDuplicate.mockReset().mockResolvedValue(null);
  toastSuccess.mockReset(); toastError.mockReset();
  profileState.data = { role: "rep", role_level: "sales_professional" };
  assigneesState.data = [
    { id: "user-1", name: "Rita Rep" },
    { id: "user-2", name: "Rob Rep" },
    { id: "user-3", name: "Mia Mgr" },
  ];
  seesState.data = true;
  seesState.isError = false;
  seesState.isFetching = false;
  seesArgs.length = 0;
  reassignMutate.mockReset();
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

  it("says when a referral came through the partner portal", () => {
    render(<ReviewReferralSheet referral={{ ...referral, source: "portal_signed_in" }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Sent through the partner portal")).toBeInTheDocument();
  });

  it("shows no portal or duplicate cue for a rep-logged referral", () => {
    render(<ReviewReferralSheet referral={{ ...referral, source: "rep_entered" }} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Sent through the partner portal")).toBeNull();
    expect(screen.queryByText(/Possible duplicate of an earlier referral/)).toBeNull();
  });

  it("flags a probable duplicate and preselects Decline (duplicate)", async () => {
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Possible duplicate of an earlier referral/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByLabelText("Pick a reason…")).toHaveValue("duplicate");
    expect(screen.getByRole("button", { name: "Decline referral" })).toBeEnabled();
  });

  it("needs a written reason to accept a flagged referral", async () => {
    accept.mockResolvedValueOnce({ result: "accepted", dealId: "d-9" });
    const onOpenChange = vi.fn();
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).not.toHaveBeenCalled();
    const go = screen.getByRole("button", { name: "Accept anyway" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Why accept it anyway?"), "Different location");
    await userEvent.click(go);
    expect(accept).toHaveBeenCalledWith({ referralId: "r-1", overrideReason: "Different location" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("caps the written override reason at 500 characters", async () => {
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByPlaceholderText("Why accept it anyway?")).toHaveAttribute("maxLength", "500");
  });

  it("shows the urgency the partner picked", () => {
    render(<ReviewReferralSheet referral={{ ...flagged, urgency: "this_week" }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Urgency")).toBeInTheDocument();
    expect(screen.getByText("This week")).toBeInTheDocument();
  });

  it("shows no urgency row when the partner left it blank or it is unknown", () => {
    const { rerender } = render(<ReviewReferralSheet referral={{ ...flagged, urgency: null }} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Urgency")).toBeNull();
    rerender(<ReviewReferralSheet referral={{ ...flagged, urgency: "someday" }} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Urgency")).toBeNull();
    expect(screen.queryByText("someday")).toBeNull();
  });

  it("still lets the rep merge a flagged referral", async () => {
    merge.mockResolvedValueOnce(undefined);
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a deal…"), "d-1");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(merge).toHaveBeenCalledWith({ referralId: "r-1", dealId: "d-1" });
  });

  it("switches to Merge when the override finds the business already in the pipeline", async () => {
    accept.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.type(screen.getByPlaceholderText("Why accept it anyway?"), "Different location");
    await userEvent.click(screen.getByRole("button", { name: "Accept anyway" }));
    expect(await screen.findByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pick a deal…")).toHaveValue("d-1");
  });

  it("lists only open deals sorted by company name", async () => {
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    const labels = screen.getAllByRole("option").map((o) => o.textContent).filter((l) => l !== "--");
    expect(labels).toEqual(["Alpha Gym", "Zed Cafe"]);
  });
});

describe("ReviewReferralSheet: chain advisory and reassign", () => {
  it("shows an advisory chain line, ignores unknown flags, and still allows accept", () => {
    render(<ReviewReferralSheet referral={{ ...referral, icpFlags: ["chain:Subway", "mystery:x"] }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Looks like a chain: Subway. Check before accepting.")).toBeInTheDocument();
    expect(screen.queryByText(/mystery/)).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("never doubles the period when the brand ends in one", () => {
    render(<ReviewReferralSheet referral={{ ...referral, icpFlags: ["chain:Ace Hardware Inc."] }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Looks like a chain: Ace Hardware Inc. Check before accepting.")).toBeInTheDocument();
    expect(screen.queryByText(/\.\. Check/)).toBeNull();
  });

  it("names the teammate generically when the picked one has no name", async () => {
    profileState.data = { role: "admin", role_level: "administrator" };
    assigneesState.data = [...(assigneesState.data ?? []), { id: "user-9", name: "" }];
    seesState.data = false;
    reassignMutate.mockResolvedValueOnce(true);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-9");
    expect(screen.getByText("That teammate can't see Jane's partner record. They will still see this referral.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reassigned to that teammate"));
  });

  it("offers no Reassign to a rep", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  });

  it("lets a manager reassign to a teammate who can see the partner", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignMutate.mockResolvedValueOnce(true);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByText("Now with Rita Rep.")).toBeInTheDocument();
    const labels = screen.getAllByRole("option").map((o) => o.textContent).filter((l) => l !== "--");
    expect(labels).toEqual(["Rob Rep", "Mia Mgr"]);
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    expect(seesArgs.at(-1)).toEqual(["user-2", "p-1"]);
    expect(screen.queryByText(/can't see/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    expect(reassignMutate).toHaveBeenCalledWith({ referralId: "r-1", userId: "user-2" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Reassigned to Rob Rep");
  });

  it("warns before confirming when the new owner cannot see the partner", async () => {
    profileState.data = { role: "admin", role_level: "administrator" };
    seesState.data = false;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    expect(screen.getByText("Rob Rep can't see Jane's partner record. They will still see this referral.")).toBeInTheDocument();
    expect(reassignMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeEnabled();
  });

  it("waits for the check before allowing the reassign", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    seesState.data = undefined;
    seesState.isFetching = true;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-3");
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeDisabled();
  });

  it("still allows the reassign when partner access could not be checked", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    seesState.data = undefined;
    seesState.isError = true;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-3");
    expect(screen.getByText("Couldn't check partner access. You can still reassign.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeEnabled();
  });

  it("toasts and stays open when the reassign is refused", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignMutate.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
