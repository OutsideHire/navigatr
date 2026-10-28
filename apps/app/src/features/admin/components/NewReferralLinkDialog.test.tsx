import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn();
vi.mock("@/features/partners/hooks/useReferralLinks", () => ({
  useRegenerateReferralLink: () => ({ mutateAsync, isPending: false }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { NewReferralLinkDialog } from "./NewReferralLinkDialog";

const row = { agent_id: "rep-1", full_name: "Rosa Kim", email: "rosa@example.com" };

function open() {
  return render(<NewReferralLinkDialog open onOpenChange={() => {}} row={row} slug="acme" />);
}

beforeEach(() => {
  mutateAsync.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("NewReferralLinkDialog", () => {
  it("warns the old link and printed QR codes stop working before doing anything", () => {
    open();
    expect(screen.getByText(/old link and any printed QR codes stop working/i)).toBeInTheDocument();
    expect(screen.getByText(/Rosa Kim/)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("gets the new link for that rep and shows the address with a copy button", async () => {
    mutateAsync.mockResolvedValueOnce("newtok");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Get new link" }));
    expect(mutateAsync).toHaveBeenCalledWith({ linkType: "user", userId: "rep-1" });
    expect(await screen.findByText(`${window.location.origin}/p/acme/refer/newtok`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/acme/refer/newtok`);
    expect(toastMock.success).toHaveBeenCalledWith("Link copied.");
  });

  it("says why on a failure and stays on the confirm step", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("You don't have access to do that."));
    open();
    await userEvent.click(screen.getByRole("button", { name: "Get new link" }));
    expect(toastMock.error).toHaveBeenCalledWith("You don't have access to do that.");
    expect(screen.getByRole("button", { name: "Get new link" })).toBeInTheDocument();
  });

  it("falls back to a plain message for a non-Error failure, and a failed copy", async () => {
    mutateAsync.mockRejectedValueOnce("boom");
    open();
    await userEvent.click(screen.getByRole("button", { name: "Get new link" }));
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't get a new link. Try again.");

    mutateAsync.mockResolvedValueOnce("t2");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Get new link" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(toastMock.error).toHaveBeenLastCalledWith("Couldn't copy. Press and hold the link to copy it.");
  });
});
