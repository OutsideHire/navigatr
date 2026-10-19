import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  getSentReferral: vi.fn(),
  postNote: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const DETAIL = {
  id: "s-1",
  ref: "REF-BBBB0001",
  companyName: "Gold Gym",
  contactName: "Gil",
  contactEmail: "gil@gold.example",
  contactPhone: "5550100200",
  repNote: "Ask for Gil after 3pm.",
  label: "Accepted",
  sentAt: "2026-10-03T12:00:00Z",
  rep: { name: "Rita Rep", email: "rita@acme.example" },
  detailsRemoved: false,
  canPostNote: true,
  notes: [{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-04T12:00:00Z" }],
};

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function renderAt(path = "/p/acme/s/s-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.getSentReferral.mockResolvedValue(DETAIL);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalSentReferralPage", () => {
  it("shows the business, the label, who sent it with their note, the contact and the partner's notes", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { name: "Gold Gym" })).toBeInTheDocument();
    expect(api.getSentReferral).toHaveBeenCalledWith("acme", "live", "s-1");
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("REF-BBBB0001 · Sent Oct 3, 2026")).toBeInTheDocument();

    const from = screen.getByRole("heading", { name: "Sent by Rita Rep" }).closest("section")!;
    expect(within(from).getByText("Ask for Gil after 3pm.")).toBeInTheDocument();
    expect(within(from).getByRole("link", { name: /rita@acme.example/ })).toHaveAttribute("href", "mailto:rita@acme.example");

    const contact = screen.getByRole("heading", { name: "Business contact" }).closest("section")!;
    expect(within(contact).getByText("Gil")).toBeInTheDocument();
    expect(within(contact).getByRole("link", { name: "gil@gold.example" })).toHaveAttribute("href", "mailto:gil@gold.example");
    expect(within(contact).getByRole("link", { name: "5550100200" })).toHaveAttribute("href", "tel:5550100200");

    const notes = screen.getByRole("heading", { name: "Your notes" }).closest("section")!;
    expect(within(notes).getByText("Called Gil.")).toBeInTheDocument();
    expect(within(notes).getByText("Rita Rep gets an email when you add one.")).toBeInTheDocument();
  });

  it("adds a note, clears the box and reloads the referral", async () => {
    const user = userEvent.setup();
    api.postNote.mockResolvedValue({ id: "n-2", body: "Signed today.", createdAt: "2026-10-22T12:00:00Z" });
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    expect(screen.getByRole("button", { name: "Send note" })).toBeDisabled();
    await user.type(box, "  Signed today.  ");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    expect(api.postNote).toHaveBeenCalledWith("acme", "live", "s-1", "Signed today.");
    expect(await screen.findByLabelText("Add a note for Acme ISO")).toHaveValue("");
    expect(api.getSentReferral.mock.calls.length).toBeGreaterThan(1);
  });

  it("explains a refused note", async () => {
    const user = userEvent.setup();
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    for (const [error, message] of [
      [new PortalApiError(429, "rate_limited"), "You've added a lot of notes in the last hour. Try again later."],
      [new PortalApiError(404, "not_found"), "This referral is no longer available."],
      [new PortalApiError(0, "network_error"), "We couldn't reach Acme ISO. Check your connection and try again."],
      [new PortalApiError(400, "invalid_body", "body"), "We couldn't add your note. Try again."],
    ] as const) {
      api.postNote.mockRejectedValueOnce(error);
      await user.clear(box);
      await user.type(box, "Hello");
      await user.click(screen.getByRole("button", { name: "Send note" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(box).toHaveValue("Hello");
    }
  });

  it("says when the rep wrote no note, when nothing was noted yet, and hides the composer when it cannot be used", async () => {
    api.getSentReferral.mockResolvedValue({ ...DETAIL, repNote: null, rep: null, notes: [], canPostNote: false });
    renderAt();
    expect(await screen.findByRole("heading", { name: "Sent by Acme ISO" })).toBeInTheDocument();
    expect(screen.queryByText("Ask for Gil after 3pm.")).toBeNull();
    expect(screen.getByText("No notes yet. Let Acme ISO know how it's going.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note for Acme ISO")).toBeNull();
  });

  // SQL never returns a purged sent referral (only removed links are purged, and
  // removed links are hidden); the page still handles the flag defensively.
  it("says the contact details were removed", async () => {
    api.getSentReferral.mockResolvedValue({
      ...DETAIL, contactName: null, contactEmail: null, contactPhone: null, repNote: null, detailsRemoved: true, canPostNote: false,
    });
    renderAt();
    expect(await screen.findByText("Contact details for this referral were removed for privacy.")).toBeInTheDocument();
  });

  it("says when the referral cannot be found, and offers a retry when it cannot load", async () => {
    api.getSentReferral.mockResolvedValue(null);
    renderAt();
    expect(await screen.findByRole("heading", { name: "We couldn't find that referral" })).toBeInTheDocument();
  });

  it("offers a retry when the referral cannot be loaded", async () => {
    api.getSentReferral.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderAt();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getSentReferral.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt();
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("blocks a note over the limit and says why, counting code points like the server", async () => {
    const user = userEvent.setup();
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    await user.click(box);
    await user.paste("a".repeat(1001));
    expect(screen.getByText("Keep your note under 1,000 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send note" })).toBeDisabled();
    await user.clear(box);
    await user.paste("\u{1F600}".repeat(1000));
    expect(screen.queryByText("Keep your note under 1,000 characters.")).toBeNull();
    expect(screen.getByRole("button", { name: "Send note" })).toBeEnabled();
  });

  it("marks the box invalid and announces a note over the limit", async () => {
    const user = userEvent.setup();
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    expect(box).not.toHaveAttribute("aria-invalid");
    await user.click(box);
    await user.paste("a".repeat(1001));
    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent("Keep your note under 1,000 characters.");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("keeps Send disabled for a note that is only spaces and line breaks", async () => {
    const user = userEvent.setup();
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    await user.type(box, "   {enter}  {enter}");
    expect(screen.getByRole("button", { name: "Send note" })).toBeDisabled();
    expect(api.postNote).not.toHaveBeenCalled();
  });

  it("returns to sign-in when the session ends while a note is posting", async () => {
    const user = userEvent.setup();
    api.postNote.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    await user.type(box, "Hello");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("reloads the referral when it disappeared while a note was posting", async () => {
    const user = userEvent.setup();
    api.postNote.mockRejectedValue(new PortalApiError(404, "not_found"));
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    api.getSentReferral.mockResolvedValue(null);
    await user.type(box, "Hello");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    expect(await screen.findByRole("heading", { name: "We couldn't find that referral" })).toBeInTheDocument();
  });

  it("says when no contact details were shared", async () => {
    api.getSentReferral.mockResolvedValue({ ...DETAIL, contactName: null, contactEmail: null, contactPhone: null });
    renderAt();
    const contact = (await screen.findByRole("heading", { name: "Business contact" })).closest("section")!;
    expect(within(contact).getByText("No contact details were shared.")).toBeInTheDocument();
    expect(within(contact).queryByText("Contact details for this referral were removed for privacy.")).toBeNull();
  });

  it("encodes email addresses in mailto links", async () => {
    api.getSentReferral.mockResolvedValue({
      ...DETAIL,
      contactEmail: "gil@gold.example?cc=x@evil.example&body=hi",
      rep: { name: "Rita Rep", email: "rita@acme.example#x" },
    });
    renderAt();
    const contact = (await screen.findByRole("heading", { name: "Business contact" })).closest("section")!;
    expect(within(contact).getByRole("link", { name: "gil@gold.example?cc=x@evil.example&body=hi" })).toHaveAttribute(
      "href",
      "mailto:gil@gold.example%3Fcc%3Dx@evil.example%26body%3Dhi",
    );
    const from = screen.getByRole("heading", { name: "Sent by Rita Rep" }).closest("section")!;
    expect(within(from).getByRole("link", { name: /rita@acme.example#x/ })).toHaveAttribute("href", "mailto:rita@acme.example%23x");
  });

  it("disables the composer while a note is posting", async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    api.postNote.mockReturnValue(new Promise((r) => (release = r)));
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    await user.type(box, "Hi");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    expect(box).toBeDisabled();
    release({ id: "n-3", body: "Hi", createdAt: "2026-10-22T12:00:00Z" });
    expect(await screen.findByLabelText("Add a note for Acme ISO")).toBeEnabled();
  });
});
