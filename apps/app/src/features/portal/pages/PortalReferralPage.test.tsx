import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const DETAIL = {
  id: "r-1",
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  contactName: "Ann",
  contactEmail: "ann@fresh.example",
  contactPhone: "5550100100",
  address: "5 Oak St",
  industry: "restaurant",
  urgency: "this_week",
  notes: "Wants a demo",
  label: "Received",
  submittedAt: "2026-10-01T12:00:00Z",
  canWithdraw: true,
  rep: { name: "Rita Rep", email: "rita@acme.example" },
  history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
  updates: [] as Array<{ body: string; publishedAt: string; authorName: string | null }>,
};
const ROW = {
  id: "r-1",
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  label: "Received",
  submittedAt: "2026-10-01T12:00:00Z",
  lastActivityAt: "2026-10-01T12:00:00Z",
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

function renderAt(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
  api.getReferral.mockResolvedValue(DETAIL);
  api.dashboard.mockResolvedValue({ submitted: 1, active: 1, closedWon: 0, conversionRate: null, valueVisible: false });
  api.listReferrals.mockResolvedValue([ROW]);
  api.form.mockResolvedValue({ consentText: "I may share these details.", consentVersion: 3 });
  api.dupCheck.mockResolvedValue(false);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalReferralPage", () => {
  it("shows the label, the rep, the history and what the partner sent", async () => {
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByRole("heading", { name: "Fresh Bakery" })).toBeInTheDocument();
    expect(api.getReferral).toHaveBeenCalledWith("acme", "live", "r-1");
    expect(screen.getByText("REF-AAAA0001 · Sent Oct 1, 2026")).toBeInTheDocument();

    const contact = screen.getByRole("heading", { name: "Your contact at Acme ISO" }).parentElement as HTMLElement;
    expect(within(contact).getByText("Rita Rep")).toBeInTheDocument();
    expect(within(contact).getByRole("link", { name: /rita@acme\.example/ })).toHaveAttribute("href", "mailto:rita@acme.example");

    const progress = screen.getByRole("heading", { name: "Progress" }).parentElement as HTMLElement;
    expect(within(progress).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["ReceivedOct 1, 2026"]);

    const sent = screen.getByRole("heading", { name: "What you sent" }).parentElement as HTMLElement;
    expect(within(sent).getByText("Ann")).toBeInTheDocument();
    expect(within(sent).getByText("Restaurant")).toBeInTheDocument();
    expect(within(sent).getByText("This week")).toBeInTheDocument();
    expect(within(sent).getByText("Wants a demo")).toBeInTheDocument();
  });

  it("opens from a row on the dashboard", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("link", { name: /Fresh Bakery/ }));
    expect(await screen.findByRole("heading", { name: "Fresh Bakery" })).toBeInTheDocument();
  });

  it("opens from the confirmation after sending", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    api.getReferral.mockResolvedValue({ ...DETAIL, id: "r-9", ref: "REF-AAAA0009" });
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Fresh Bakery");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.type(screen.getByLabelText("Phone"), "5550100100");
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await user.click(await screen.findByRole("button", { name: "View this referral" }));
    expect(await screen.findByText("REF-AAAA0009 · Sent Oct 1, 2026")).toBeInTheDocument();
    expect(api.getReferral).toHaveBeenLastCalledWith("acme", "live", "r-9");
  });

  it("withdraws while Received, after a confirmation", async () => {
    const user = userEvent.setup();
    api.withdrawReferral.mockResolvedValue(undefined);
    api.getReferral.mockResolvedValueOnce(DETAIL).mockResolvedValue({
      ...DETAIL,
      label: "Withdrawn",
      canWithdraw: false,
      history: [...DETAIL.history, { label: "Withdrawn", at: "2026-10-02T12:00:00Z" }],
    });
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    expect(screen.getByText("Withdraw Fresh Bakery? Acme ISO will not follow up on it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.withdrawReferral).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Withdraw this referral" }));
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    expect(api.withdrawReferral).toHaveBeenCalledWith("acme", "live", "r-1");
    // The chip and the new history step.
    expect(await screen.findAllByText("Withdrawn")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Withdraw this referral" })).toBeNull();
  });

  it("explains when it is too late to withdraw", async () => {
    const user = userEvent.setup();
    api.withdrawReferral.mockRejectedValue(new PortalApiError(409, "not_withdrawable"));
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This referral is already being worked on, so it can no longer be pulled back.",
    );
  });

  it("hides withdraw once the ISO has picked it up, and says who will follow up when nobody is assigned", async () => {
    api.getReferral.mockResolvedValue({ ...DETAIL, label: "Accepted", canWithdraw: false, rep: null });
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByText("Someone at Acme ISO will pick this up soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw this referral" })).toBeNull();
  });

  it("shows a plain not-found for a referral that is not the partner's", async () => {
    api.getReferral.mockResolvedValue(null);
    renderAt("/p/acme/r/someone-elses");
    expect(await screen.findByRole("heading", { name: "We couldn't find that referral" })).toBeInTheDocument();
  });

  it("polls every 30 seconds", async () => {
    const client = renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    const query = client.getQueryCache().find({ queryKey: ["portal", "data", "acme", "live", "referral", "r-1"], exact: true });
    expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getReferral.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
  it("shows the email under the contact heading when the rep has no name", async () => {
    api.getReferral.mockResolvedValue({ ...DETAIL, rep: { name: "", email: "rita@acme.example" } });
    renderAt("/p/acme/r/r-1");
    const contact = (await screen.findByRole("heading", { name: "Your contact at Acme ISO" })).parentElement as HTMLElement;
    expect(within(contact).getByRole("link", { name: /rita@acme\.example/ })).toBeInTheDocument();
  });

  it("shows retry when the first load fails", async () => {
    api.getReferral.mockRejectedValue(new PortalApiError(500, "server_error"));
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps the detail on screen when a background refresh fails", async () => {
    const client = renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    api.getReferral.mockRejectedValue(new PortalApiError(500, "server_error"));
    await client.refetchQueries({ queryKey: ["portal", "data", "acme", "live", "referral", "r-1"] });
    expect(screen.getByRole("heading", { name: "Fresh Bakery" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("links back to the list from not-found", async () => {
    api.getReferral.mockResolvedValue(null);
    renderAt("/p/acme/r/nope");
    expect(await screen.findByRole("link", { name: /Back to your referrals/ })).toHaveAttribute("href", "/p/acme/home");
    expect(screen.queryByText("Fresh Bakery")).toBeNull();
  });

  it("shows the ISO's published updates, newest first", async () => {
    api.getReferral.mockResolvedValue({
      ...DETAIL,
      label: "In Progress",
      canWithdraw: false,
      updates: [
        { body: "Demo booked for Tuesday.\nBring the statements.", publishedAt: "2026-10-05T12:00:00Z", authorName: "Rita Rep" },
        { body: "Called the owner.", publishedAt: "2026-10-03T12:00:00Z", authorName: null },
      ],
    });
    renderAt("/p/acme/r/r-1");
    const section = (await screen.findByRole("heading", { name: "Updates from Acme ISO" })).parentElement as HTMLElement;
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Demo booked for Tuesday.\nBring the statements.Rita Rep · Oct 5, 2026",
      "Called the owner.Acme ISO · Oct 3, 2026",
    ]);
  });

  it("has no updates section when nothing was published", async () => {
    renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    expect(screen.queryByRole("heading", { name: /Updates from/ })).toBeNull();
  });
});