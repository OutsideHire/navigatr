import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LinkQuery = {
  data: { enabled: boolean; slug: string; token: string | null } | null | undefined;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => unknown;
};
const state = vi.hoisted(() => ({
  mine: { data: { enabled: true, slug: "acme", token: "myTok123" } } as LinkQuery,
  tenant: { data: { enabled: true, slug: "acme", token: "coTok456" } } as LinkQuery,
  tenantEnabled: [] as boolean[],
  roleLevel: "sales_professional",
  regenerate: vi.fn(),
  qr: vi.fn(),
  listeners: new Set<() => void>(),
}));
/** Swap the user's link the way a refetch after invalidation would, re-rendering every reader. */
function setMine(next: LinkQuery) {
  state.mine = next;
  state.listeners.forEach((l) => l());
}
vi.mock("../hooks/useReferralLinks", async () => {
  const React = await import("react");
  const subscribe = (l: () => void) => {
    state.listeners.add(l);
    return () => state.listeners.delete(l);
  };
  return {
    useMyReferralLink: () => React.useSyncExternalStore(subscribe, () => state.mine),
    useTenantReferralLink: (enabled: boolean) => {
      state.tenantEnabled.push(enabled);
      return enabled ? state.tenant : { data: undefined };
    },
    useRegenerateReferralLink: () => ({ mutateAsync: state.regenerate, isPending: false }),
  };
});
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role_level: state.roleLevel } }) }));
vi.mock("../lib/referralQr", () => ({
  referralQrDataUrl: (url: string) => state.qr(url),
  referralQrFileName: (t: string) => (t === "tenant" ? "company-referral-qr.png" : "my-referral-qr.png"),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { ShareReferralFormButton, ShareReferralFormSheet } from "./ShareReferralForm";

const MY_URL = `${window.location.origin}/p/acme/refer/myTok123`;
const CO_URL = `${window.location.origin}/p/acme/refer/coTok456`;
const writeText = vi.fn();
const origShare = (navigator as { share?: unknown }).share;
const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  state.mine = { data: { enabled: true, slug: "acme", token: "myTok123" } };
  state.tenant = { data: { enabled: true, slug: "acme", token: "coTok456" } };
  state.tenantEnabled = [];
  state.roleLevel = "sales_professional";
  state.regenerate.mockReset();
  state.qr.mockReset();
  state.qr.mockImplementation(async (url: string) => `data:image/png;base64,${btoa(url)}`);
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
  if (origClipboard) Object.defineProperty(navigator, "clipboard", origClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

// userEvent.setup() installs its own clipboard stub, so ours goes in after it.
async function open() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<ShareReferralFormButton />);
  await user.click(screen.getByRole("button", { name: "Share referral form" }));
  return user;
}

describe("ShareReferralFormButton", () => {
  it("is hidden while the ISO has the public form off, or before the link loads", () => {
    state.mine = { data: { enabled: false, slug: "acme", token: null } };
    const off = render(<ShareReferralFormButton />);
    expect(screen.queryByRole("button", { name: "Share referral form" })).toBeNull();
    off.unmount();
    state.mine = { data: undefined };
    render(<ShareReferralFormButton />);
    expect(screen.queryByRole("button", { name: "Share referral form" })).toBeNull();
  });

  it("shows the rep's link, its QR code and a download", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Share referral form" })).toBeInTheDocument();
    expect(screen.getByText(MY_URL)).toBeInTheDocument();
    const img = await screen.findByRole("img", { name: "QR code for your link" });
    expect(img).toHaveAttribute("src", `data:image/png;base64,${btoa(MY_URL)}`);
    const download = screen.getByRole("link", { name: "Download QR" });
    expect(download).toHaveAttribute("download", "my-referral-qr.png");
    expect(download).toHaveAttribute("href", `data:image/png;base64,${btoa(MY_URL)}`);
    expect(screen.queryByText(CO_URL)).toBeNull();
    expect(state.tenantEnabled.every((e) => e === false)).toBe(true);
  });

  it("copies the link", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(MY_URL);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied.");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't copy. Press and hold the link to copy it."));
  });

  it("uses the phone's share sheet when there is one, and copies otherwise", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith(MY_URL);

    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    writeText.mockClear();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ title: "Referral form", url: MY_URL });
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    await user.click(screen.getByRole("button", { name: "Share" }));
    // Let the rejected share settle before asserting that nothing was copied.
    await new Promise((r) => setTimeout(r, 0));
    expect(share).toHaveBeenCalledTimes(2);
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new Error("not allowed"));
    await user.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MY_URL));
  });

  it("gets a new link only after confirming", async () => {
    state.regenerate.mockResolvedValueOnce("newTok");
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    expect(screen.getByText("Get a new link? Your old link and QR code stop working right away.")).toBeInTheDocument();
    expect(state.regenerate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.regenerate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    expect(state.regenerate).toHaveBeenCalledWith({ linkType: "user" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("New link ready. The old one no longer works."));
  });

  it("explains a refused new link", async () => {
    state.regenerate.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
  });

  it("gives administrators the company link with its own QR and new link", async () => {
    state.roleLevel = "administrator";
    state.regenerate.mockResolvedValue("x");
    const user = await open();
    expect(state.tenantEnabled).toContain(true);
    expect(screen.getByText(CO_URL)).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "QR code for the company link" })).toBeInTheDocument();
    const downloads = screen.getAllByRole("link", { name: "Download QR" });
    expect(downloads.map((a) => a.getAttribute("download"))).toEqual(["my-referral-qr.png", "company-referral-qr.png"]);
    const getNew = screen.getAllByRole("button", { name: "Get a new link" });
    await user.click(getNew[1]);
    expect(screen.getByText("Get a new company link? The old link and QR code stop working right away.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    expect(state.regenerate).toHaveBeenCalledWith({ linkType: "tenant" });
  });

  it("keeps the sheet usable when the QR image cannot be drawn", async () => {
    state.qr.mockRejectedValue(new Error("canvas"));
    await open();
    expect(screen.getByText(MY_URL)).toBeInTheDocument();
    await waitFor(() => expect(state.qr).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Download QR" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(await screen.findByText("Couldn't make the QR code. The link above still works.")).toBeInTheDocument();
  });

  it("draws the QR code for the new link after getting a new one", async () => {
    state.regenerate.mockImplementationOnce(async () => {
      // What the refetch after invalidation brings back.
      setMine({ data: { enabled: true, slug: "acme", token: "newTok789" } });
      return "newTok789";
    });
    const user = await open();
    expect(await screen.findByRole("img", { name: "QR code for your link" })).toHaveAttribute("src", `data:image/png;base64,${btoa(MY_URL)}`);
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    const NEW_URL = `${window.location.origin}/p/acme/refer/newTok789`;
    expect(await screen.findByText(NEW_URL)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "QR code for your link" })).toHaveAttribute("src", `data:image/png;base64,${btoa(NEW_URL)}`),
    );
    expect(state.qr).toHaveBeenLastCalledWith(NEW_URL);
  });

  it("says the link could not load, with a retry, instead of spinning forever", async () => {
    const refetch = vi.fn();
    state.mine = { data: undefined, isError: true, refetch };
    const user = userEvent.setup();
    render(<ShareReferralFormSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Couldn't load your link. Try again.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says the same when the server returns no link", () => {
    state.mine = { data: null, refetch: vi.fn() };
    render(<ShareReferralFormSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Couldn't load your link. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("shows the note in the company section when only that link fails", async () => {
    state.roleLevel = "administrator";
    state.tenant = { data: undefined, isError: true, refetch: vi.fn() };
    await open();
    expect(screen.getByText(MY_URL)).toBeInTheDocument();
    const company = screen.getByRole("region", { name: "Company link" });
    expect(company).toHaveTextContent("Couldn't load your link. Try again.");
    expect(screen.queryByLabelText("Loading")).toBeNull();
  });

  it("still shows a spinner while a link is loading", () => {
    state.mine = { data: undefined, isFetching: true, refetch: vi.fn() };
    render(<ShareReferralFormSheet open onOpenChange={() => {}} />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
