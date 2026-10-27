import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { ReviewFormSubmissionSheet } from "./ReviewFormSubmissionSheet";
import type { QueueSubmission } from "../hooks/useFormSubmissionQueue";

const attribute = vi.fn();
const acceptSubmission = vi.fn();
const declineSubmission = vi.fn();
const mergeSubmission = vi.fn();
const reassignSubmission = vi.fn();
vi.mock("../hooks/useFormSubmissionMutations", () => ({
  useAttributeFormSubmission: () => ({ mutateAsync: attribute, isPending: false }),
  useAcceptFormSubmission: () => ({ mutateAsync: acceptSubmission, isPending: false }),
  useDeclineFormSubmission: () => ({ mutateAsync: declineSubmission, isPending: false }),
  useMergeFormSubmission: () => ({ mutateAsync: mergeSubmission, isPending: false }),
  useReassignFormSubmission: () => ({ mutateAsync: reassignSubmission, isPending: false }),
}));
const acceptReferral = vi.fn();
const declineReferral = vi.fn();
const mergeReferral = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useAcceptReferral: () => ({ mutateAsync: acceptReferral, isPending: false }),
  useDeclineReferral: () => ({ mutateAsync: declineReferral, isPending: false }),
  useMergeReferral: () => ({ mutateAsync: mergeReferral, isPending: false }),
}));
const customerState: { data: { dealId: string; companyName: string } | null | undefined } = { data: null };
const customerArgs: unknown[] = [];
vi.mock("../hooks/useCustomerMatch", () => ({
  useCustomerMatch: (a: unknown) => { customerArgs.push(a); return customerState; },
}));
const adviceState: { data: unknown } = { data: undefined };
vi.mock("../hooks/useFormSubmissionQueue", () => ({ useFormSubmissionAdvice: () => adviceState }));
vi.mock("../hooks/usePartners", () => ({
  usePartners: () => ({ data: [
    { id: "p-1", name: "Jane CPA", company: "Jane & Co" },
    { id: "p-2", name: "Bob CPA", company: "Bob & Co" },
  ] }),
}));
const createPartner = vi.fn();
vi.mock("../hooks/useCreatePartner", () => ({ useCreatePartner: () => ({ mutateAsync: createPartner, isPending: false }) }));
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
const assigneesState: { data: Array<{ id: string; name: string }> | undefined } = { data: undefined };
vi.mock("../hooks/useReassignReferral", () => ({ useReferralAssignees: () => assigneesState }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    Select: ({ value, onValueChange, options, placeholder, disabled }: {
      value?: string; onValueChange?: (v: string) => void;
      options: Array<{ value: string; label: string }>; placeholder?: string; disabled?: boolean;
    }) => (
      <select aria-label={placeholder} value={value ?? ""} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="">--</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});

const ATTRIBUTED = { referralId: "r-new", duplicateOfReferralId: null, duplicateOfDealId: null, assignedUserId: "user-1" };
const FLAGGED = { ...ATTRIBUTED, duplicateOfReferralId: "r-9" };

const submission: QueueSubmission = {
  id: "s-1", linkType: "user", assignedUserId: "user-1", companyName: "Fresh Bakery",
  contactName: "Ann", contactEmail: "ann@fresh.example", contactPhone: "512-555-0100",
  notes: "Wants a demo", referredByText: "Jane at Jane & Co", referrerEmail: "jane@janeco.example",
  submittedAt: "2026-10-20T15:00:00Z",
};

function renderSheet(s: QueueSubmission = submission) {
  const onOpenChange = vi.fn();
  render(<MemoryRouter><ReviewFormSubmissionSheet submission={s} open onOpenChange={onOpenChange} /></MemoryRouter>);
  return onOpenChange;
}

async function pickExistingPartner(id = "p-1") {
  await userEvent.click(screen.getByRole("button", { name: "A partner" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a partner…" }), id);
}

beforeEach(() => {
  for (const f of [attribute, acceptSubmission, declineSubmission, mergeSubmission, reassignSubmission,
    acceptReferral, declineReferral, mergeReferral, createPartner, toastSuccess, toastError]) f.mockReset();
  adviceState.data = undefined;
  customerState.data = null; customerArgs.length = 0;
  profileState.data = { role: "rep", role_level: "sales_professional" };
  assigneesState.data = [{ id: "user-1", name: "Rita Rep" }, { id: "u-2", name: "Rob Rep" }];
  attribute.mockResolvedValue(ATTRIBUTED);
  acceptReferral.mockResolvedValue({ result: "accepted", dealId: "d-9" });
  createPartner.mockResolvedValue({ id: "p-new" });
});

describe("ReviewFormSubmissionSheet", () => {
  it("says when the business is already a customer, linking to the won deal", async () => {
    customerState.data = { dealId: "d-77", companyName: "Fresh Bakery" };
    const onOpenChange = renderSheet();
    expect(screen.getByRole("link", { name: "Fresh Bakery" }).parentElement).toHaveTextContent("Already a customer: Fresh Bakery was closed won.");
    expect(screen.getByRole("link", { name: "Fresh Bakery" })).toHaveAttribute("href", "/pipeline/d-77");
    await userEvent.click(screen.getByRole("link", { name: "Fresh Bakery" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(customerArgs[0]).toMatchObject({ company: "Fresh Bakery", phone: "512-555-0100", address: null });
  });

  it("shows no customer line when there is no match", () => {
    renderSheet();
    expect(screen.queryByText(/Already a customer/)).not.toBeInTheDocument();
  });

  it("shows what the sender typed, where it came from and the advice", () => {
    adviceState.data = {
      duplicateReferral: { id: "r-9", companyName: "Corner Cafe" },
      duplicateDeal: { id: "d-1", companyName: "Zed Cafe" },
      chainBrand: "Subway",
    };
    renderSheet();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText("From your referral form")).toBeInTheDocument();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ann@fresh.example" })).toHaveAttribute("href", "mailto:ann@fresh.example");
    expect(screen.getByRole("button", { name: /call \(512\) 555-0100/i })).toBeInTheDocument();
    expect(screen.getByText("Jane at Jane & Co")).toBeInTheDocument();
    expect(screen.getByText("jane@janeco.example")).toBeInTheDocument();
    expect(screen.getByText("Wants a demo")).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate: Zed Cafe is already in your team's pipeline.")).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate of an open referral: Corner Cafe.")).toBeInTheDocument();
    expect(screen.getByText("Looks like a chain: Subway. Check before accepting.")).toBeInTheDocument();
  });

  it("does not call a teammate's form 'your' form", () => {
    renderSheet({ ...submission, assignedUserId: "user-2" });
    expect(screen.getByText("From a rep's referral form")).toBeInTheDocument();
  });

  it("keeps the actions off until you say who sent it", async () => {
    renderSheet();
    expect(screen.getByText("Say who sent this to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "A partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    expect(screen.getByRole("button", { name: "No partner" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("no partner: accept creates the deal from the submission", async () => {
    acceptSubmission.mockResolvedValueOnce("d-new");
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(acceptSubmission).toHaveBeenCalledWith("s-1");
    expect(attribute).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Accepted. Deal created.");
  });

  it("a partner: search narrows the list, then it becomes a referral and is accepted", async () => {
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "A partner" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search partners" }), "jane");
    const picker = screen.getByRole("combobox", { name: "Pick a partner…" });
    expect(within(picker).queryByText("Bob CPA · Bob & Co")).toBeNull();
    await userEvent.selectOptions(picker, "p-1");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(attribute).toHaveBeenCalledWith({ submissionId: "s-1", partnerId: "p-1" });
    expect(acceptReferral).toHaveBeenCalledWith("r-new");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("a new partner: created once, then the referral is declined with a reason", async () => {
    declineReferral.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "New partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Partner name" }), "Pat");
    await userEvent.type(screen.getByRole("textbox", { name: "Partner phone" }), "5550001234");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const reasons = screen.getByRole("combobox", { name: "Pick a reason…" });
    expect(within(reasons).queryByText("Partner withdrew it")).toBeNull();
    await userEvent.selectOptions(reasons, "outside_icp");
    await userEvent.click(screen.getByRole("button", { name: "Decline referral" }));
    expect(createPartner).toHaveBeenCalledWith({
      name: "Pat", company: "", type: "other", email: undefined, phone: "+15550001234",
    });
    expect(attribute).toHaveBeenCalledWith({ submissionId: "s-1", partnerId: "p-new" });
    expect(declineReferral).toHaveBeenCalledWith({ referralId: "r-new", reason: "outside_icp", note: "" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Referral declined"));
  });

  it("a duplicate on accept moves to merge on the same referral, without attributing again", async () => {
    acceptReferral.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    mergeReferral.mockResolvedValueOnce({ result: "merged", creditedPartnerName: null });
    renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Already in your team's pipeline");
    expect(screen.getByRole("combobox", { name: "Pick a deal…" })).toHaveValue("d-1");
    expect(screen.getByRole("button", { name: "No partner" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeReferral).toHaveBeenCalledWith({ referralId: "r-new", dealId: "d-1" });
    expect(attribute).toHaveBeenCalledTimes(1);
  });

  it("a failed step keeps the new partner, so a retry never creates it twice", async () => {
    attribute.mockReset();
    attribute.mockRejectedValueOnce(new Error("Couldn't save who sent it")).mockResolvedValueOnce(ATTRIBUTED);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "New partner" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Partner name" }), "Pat");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save who sent it"));
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptReferral).toHaveBeenCalledWith("r-new"));
    expect(createPartner).toHaveBeenCalledTimes(1);
    expect(attribute).toHaveBeenCalledTimes(2);
    expect(attribute).toHaveBeenLastCalledWith({ submissionId: "s-1", partnerId: "p-new" });
  });

  it("no partner: decline acts on the submission", async () => {
    declineSubmission.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const submit = screen.getByRole("button", { name: "Decline referral" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a reason…" }), "duplicate");
    await userEvent.click(submit);
    expect(declineSubmission).toHaveBeenCalledWith({ submissionId: "s-1", reason: "duplicate", note: "" });
    expect(declineReferral).not.toHaveBeenCalled();
  });

  it("no partner: merge offers open deals only and acts on the submission", async () => {
    mergeSubmission.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    const deals = screen.getByRole("combobox", { name: "Pick a deal…" });
    expect(within(deals).queryByText("Closed Co")).toBeNull();
    await userEvent.selectOptions(deals, "d-2");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeSubmission).toHaveBeenCalledWith({ submissionId: "s-1", dealId: "d-2" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Merged into the existing deal"));
  });

  it("reps do not get Reassign", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  });

  it("a manager reassigns before anyone says who sent it", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignSubmission.mockResolvedValueOnce(undefined);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const picker = screen.getByRole("combobox", { name: "Pick a teammate…" });
    expect(within(picker).queryByText("Rita Rep")).toBeNull();
    await userEvent.selectOptions(picker, "u-2");
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    expect(reassignSubmission).toHaveBeenCalledWith({ submissionId: "s-1", userId: "u-2" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Reassigned to Rob Rep");
  });

  it("keeps the business and the referral id when the parent drops the row mid-flow", async () => {
    acceptReferral.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    mergeReferral.mockResolvedValueOnce({ result: "merged", creditedPartnerName: null });
    const onOpenChange = vi.fn();
    const { rerender } = render(<MemoryRouter><ReviewFormSubmissionSheet submission={submission} open onOpenChange={onOpenChange} /></MemoryRouter>);
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByRole("button", { name: "Merge into deal" });
    rerender(<MemoryRouter><ReviewFormSubmissionSheet submission={null} open onOpenChange={onOpenChange} /></MemoryRouter>);
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeReferral).toHaveBeenCalledWith({ referralId: "r-new", dealId: "d-1" });
    expect(attribute).toHaveBeenCalledTimes(1);
  });

  it("ignores a completion that lands after the sheet moved to another submission", async () => {
    let resolveAccept: (v: string) => void = () => {};
    acceptSubmission.mockReturnValueOnce(new Promise<string>((r) => { resolveAccept = r; }));
    const onOpenChange = vi.fn();
    const { rerender } = render(<MemoryRouter><ReviewFormSubmissionSheet submission={submission} open onOpenChange={onOpenChange} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    rerender(<MemoryRouter><ReviewFormSubmissionSheet submission={{ ...submission, id: "s-2", companyName: "Other Co" }} open onOpenChange={onOpenChange} /></MemoryRouter>);
    resolveAccept("d-new");
    await new Promise((r) => setTimeout(r, 10));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Other Co")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("locks the who-toggle and new partner fields once the partner is created", async () => {
    attribute.mockReset();
    attribute.mockRejectedValueOnce(new Error("Couldn't save who sent it"));
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "New partner" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Partner name" }), "Pat");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Partner name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No partner" })).toBeDisabled();
  });

  it("stacks the who-sent-this buttons on a phone and puts them in a row from sm up", () => {
    renderSheet();
    const row = screen.getByRole("button", { name: "A partner" }).parentElement as HTMLElement;
    expect(row).toHaveClass("grid-cols-1");
    expect(row).toHaveClass("sm:grid-cols-3");
    expect(row).not.toHaveClass("grid-cols-3");
    // In the sm row each third is about 130px, so the label gets the smaller padding.
    expect(screen.getByRole("button", { name: "New partner" })).toHaveClass("sm:px-3");
  });

  it("locks the partner picker once the submission became a referral", async () => {
    acceptReferral.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    renderSheet();
    await pickExistingPartner();
    expect(screen.getByRole("combobox", { name: "Pick a partner…" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByRole("button", { name: "Merge into deal" });
    expect(screen.getByRole("combobox", { name: "Pick a partner…" })).toBeDisabled();
  });

  it("disables the partner picker while an action is running", async () => {
    let resolveAttr: (v: typeof ATTRIBUTED) => void = () => {};
    attribute.mockReset();
    attribute.mockReturnValueOnce(new Promise<typeof ATTRIBUTED>((r) => { resolveAttr = r; }));
    renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("combobox", { name: "Pick a partner…" })).toBeDisabled();
    resolveAttr(ATTRIBUTED);
    await waitFor(() => expect(acceptReferral).toHaveBeenCalled());
  });

  it("ignores a completion from before a close and reopen of the same submission", async () => {
    let resolveAccept: (v: string) => void = () => {};
    acceptSubmission.mockReturnValueOnce(new Promise<string>((r) => { resolveAccept = r; }));
    const onOpenChange = vi.fn();
    const { rerender } = render(<MemoryRouter><ReviewFormSubmissionSheet submission={submission} open onOpenChange={onOpenChange} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    rerender(<MemoryRouter><ReviewFormSubmissionSheet submission={submission} open={false} onOpenChange={onOpenChange} /></MemoryRouter>);
    rerender(<MemoryRouter><ReviewFormSubmissionSheet submission={submission} open onOpenChange={onOpenChange} /></MemoryRouter>);
    resolveAccept("d-new");
    await new Promise((r) => setTimeout(r, 10));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });
  it("first referral wins: a flagged attribution asks for a reason before accepting (FR-PORT-47)", async () => {
    attribute.mockResolvedValueOnce(FLAGGED);
    const onOpenChange = renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(
      "Possible duplicate of an earlier referral. Decline (duplicate) is preselected; you can still accept or merge.",
    )).toBeInTheDocument();
    expect(acceptReferral).not.toHaveBeenCalled();
    const acceptAnyway = screen.getByRole("button", { name: "Accept anyway" });
    expect(acceptAnyway).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Why accept it anyway?"), "  Second location  ");
    expect(acceptAnyway).toBeEnabled();
    await userEvent.click(acceptAnyway);
    expect(acceptReferral).toHaveBeenCalledWith({ referralId: "r-new", overrideReason: "Second location" });
    expect(attribute).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Accepted. Deal created.");
  });

  it("first referral wins: once flagged, Decline (duplicate) is preselected and Accept goes back to the reason", async () => {
    attribute.mockResolvedValueOnce({ ...ATTRIBUTED, duplicateOfDealId: "d-1" });
    declineReferral.mockResolvedValueOnce(undefined);
    renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByRole("button", { name: "Accept anyway" });
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("button", { name: "Accept anyway" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByRole("combobox", { name: "Pick a reason…" })).toHaveValue("duplicate");
    await userEvent.click(screen.getByRole("button", { name: "Decline referral" }));
    expect(declineReferral).toHaveBeenCalledWith({ referralId: "r-new", reason: "duplicate", note: "" });
    expect(attribute).toHaveBeenCalledTimes(1);
    expect(acceptReferral).not.toHaveBeenCalled();
  });

  it("first referral wins: merging a flagged attribution asks for a reason before merging (FR-PORT-47)", async () => {
    attribute.mockResolvedValueOnce(FLAGGED);
    mergeReferral.mockResolvedValueOnce({ result: "merged", creditedPartnerName: null });
    const onOpenChange = renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a deal…" }), "d-1");
    expect(screen.queryByPlaceholderText("Why merge it anyway?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    // The flag shows first; nothing is merged until the reviewer writes a reason.
    const box = await screen.findByPlaceholderText("Why merge it anyway?");
    expect(screen.getByText(/Possible duplicate of an earlier referral/)).toBeInTheDocument();
    expect(mergeReferral).not.toHaveBeenCalled();
    const go = screen.getByRole("button", { name: "Merge into deal" });
    expect(go).toBeDisabled();
    await userEvent.type(box, "  Same owner  ");
    await userEvent.click(go);
    expect(mergeReferral).toHaveBeenCalledWith({ referralId: "r-new", dealId: "d-1", overrideReason: "Same owner" });
    expect(attribute).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Merged into the existing deal");
  });

  it("a merge that closes as a duplicate says another partner keeps credit when the name is not visible", async () => {
    mergeReferral.mockResolvedValueOnce({ result: "closed_duplicate", creditedPartnerName: null });
    const onOpenChange = renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a deal…" }), "d-1");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeReferral).toHaveBeenCalledWith({ referralId: "r-new", dealId: "d-1" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Merged. Another partner keeps credit, so this referral closed as a duplicate.");
  });

  it("an unflagged attribution shows no first-referral warning", async () => {
    renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptReferral).toHaveBeenCalledWith("r-new"));
    expect(screen.queryByText(/Possible duplicate of an earlier referral/)).toBeNull();
  });
});
