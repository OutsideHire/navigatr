import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LogReferralSheet } from "./LogReferralSheet";

const logMock = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useLogReferral: () => ({ mutateAsync: logMock, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
      <textarea aria-label="Notes" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => { logMock.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

function setup() {
  const onOpenChange = vi.fn();
  render(<LogReferralSheet open onOpenChange={onOpenChange} partnerId="p-1" partnerName="Jane" />);
  return onOpenChange;
}

describe("LogReferralSheet", () => {
  it("needs a business name", () => {
    setup();
    expect(screen.getByRole("button", { name: "Log referral" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Log referral" })).toBeDisabled();
  });

  it("logs the referral with what was typed and closes", async () => {
    logMock.mockResolvedValueOnce("r-1");
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Fresh Bakery" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+15550001" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Owner is Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Log referral" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(logMock).toHaveBeenCalledWith({
      partnerId: "p-1", companyName: "Fresh Bakery", contactName: "", contactEmail: "",
      contactPhone: "+15550001", address: "", notes: "Owner is Ann",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Referral logged. It's in Referrals to review.");
  });

  it("stays open on error", async () => {
    logMock.mockRejectedValueOnce(new Error("You can't see that partner."));
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Fresh Bakery" } });
    fireEvent.click(screen.getByRole("button", { name: "Log referral" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You can't see that partner."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
