import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ShareUpdateSheet } from "./ShareUpdateSheet";

const publishMock = vi.fn();
vi.mock("../hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  usePublishReferralUpdate: () => ({ mutateAsync: publishMock, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
      <textarea aria-label="Update" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => {
  publishMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function setup() {
  const onOpenChange = vi.fn();
  render(<ShareUpdateSheet open onOpenChange={onOpenChange} referralId="r-1" partnerLabel="Jane" />);
  return onOpenChange;
}

describe("ShareUpdateSheet", () => {
  it("names the partner and says only this text is shared", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Share an update with Jane" })).toBeInTheDocument();
    expect(screen.getByText("They see this on their referral, word for word. Nothing else you write is shared.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What should the partner know?")).toBeInTheDocument();
  });

  it("needs some text", () => {
    setup();
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
  });

  it("shares the text, confirms, and closes", async () => {
    publishMock.mockResolvedValueOnce("u-1");
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "Demo booked" } });
    expect(screen.getByText("11/1000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share update" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(publishMock).toHaveBeenCalledWith("Demo booked");
    expect(toastSuccess).toHaveBeenCalledWith("Update shared with Jane.");
  });

  it("blocks more than 1000 characters", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "a".repeat(1001) } });
    expect(screen.getByText("1001/1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
  });

  it("shows the server's message and stays open when sharing fails", async () => {
    publishMock.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "Demo booked" } });
    fireEvent.click(screen.getByRole("button", { name: "Share update" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
