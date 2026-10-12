import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

const dictation = vi.hoisted(() => ({
  onResult: null as null | ((text: string) => void),
  toggle: vi.fn(),
  micState: "rest" as string,
}));
vi.mock("../hooks/usePortalDictation", () => ({
  usePortalDictation: (opts: { onResult: (text: string) => void }) => {
    dictation.onResult = opts.onResult;
    return { micState: dictation.micState, toggle: dictation.toggle };
  },
}));

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const FORM = { consentText: "I may share these details.", consentVersion: 3 };
const DUP = "This business may already be in progress with Acme ISO. You can still send it.";

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

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Business name"), "Fresh Bakery");
  await user.type(screen.getByLabelText("Contact name"), "Ann");
  await user.type(screen.getByLabelText("Email"), "ann@fresh.example");
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  dictation.onResult = null;
  dictation.toggle.mockReset();
  dictation.micState = "rest";
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.form.mockResolvedValue(FORM);
  api.dupCheck.mockResolvedValue(false);
  api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
  api.listReferrals.mockResolvedValue([]);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalSubmitPage", () => {
  it("opens from the dashboard's Send a referral button", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("button", { name: "Send a referral" }));
    expect(await screen.findByRole("heading", { name: "Send a referral" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "I may share these details." })).toBeInTheDocument();
    expect(api.form).toHaveBeenCalledWith("acme", "live");
  });

  it("sends a referral and confirms it with a reference", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Address (optional)"), "5 Oak St");
    await user.selectOptions(screen.getByLabelText("Industry (optional)"), "restaurant");
    await user.selectOptions(screen.getByLabelText("How soon? (optional)"), "this_week");
    await user.type(screen.getByLabelText("Notes (optional)"), "Wants a demo");
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));

    expect(api.submitReferral).toHaveBeenCalledWith("acme", "live", {
      companyName: "Fresh Bakery",
      contactName: "Ann",
      email: "ann@fresh.example",
      phone: "",
      address: "5 Oak St",
      industry: "restaurant",
      urgency: "this_week",
      notes: "Wants a demo",
      consent: true,
      consentVersion: 3,
    });
    expect(await screen.findByRole("heading", { name: "Referral sent" })).toBeInTheDocument();
    expect(screen.getByText("Acme ISO has Fresh Bakery. Your reference is REF-AAAA0009.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View this referral" })).toBeInTheDocument();
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Send another" }));
    expect(await screen.findByLabelText("Business name")).toHaveValue("");
  });

  it("points at the first problem before sending anything", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/new");
    await screen.findByRole("checkbox", { name: "I may share these details." });
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add the business name.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Business name"), "Fresh Bakery");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add an email or a phone number.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Phone"), "555 010 0100");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Check the box to confirm you have permission.")).toBeInTheDocument();
    expect(api.submitReferral).not.toHaveBeenCalled();
  });

  it("restores and keeps a draft per portal", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "navigatr-portal-draft:acme",
      JSON.stringify({ companyName: "Saved Co", contactName: "Sam", notes: "From last time" }),
    );
    renderAt("/p/acme/new");
    expect(await screen.findByLabelText("Business name")).toHaveValue("Saved Co");
    expect(screen.getByLabelText("Contact name")).toHaveValue("Sam");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("From last time");
    await user.type(screen.getByLabelText("Phone"), "5550100100");
    expect(JSON.parse(window.localStorage.getItem("navigatr-portal-draft:acme") ?? "{}")).toMatchObject({
      companyName: "Saved Co",
      phone: "5550100100",
    });
  });

  it("warns softly about a probable duplicate and still lets the partner send", async () => {
    const user = userEvent.setup();
    api.dupCheck.mockResolvedValue(true);
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Corner Cafe");
    await new Promise((r) => setTimeout(r, 700));
    expect(api.dupCheck).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Phone"), "555 010 0001");
    expect(await screen.findByText(DUP, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(api.dupCheck).toHaveBeenLastCalledWith("acme", "live", {
      companyName: "Corner Cafe",
      phone: "555 010 0001",
      address: "",
    });
    expect(screen.getByRole("button", { name: "Send referral" })).toBeEnabled();
  });

  it("asks again when the consent wording changed", async () => {
    const user = userEvent.setup();
    api.form.mockResolvedValueOnce(FORM).mockResolvedValue({ consentText: "New wording.", consentVersion: 4 });
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The permission wording was just updated. Read it and check the box again.")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "New wording." })).not.toBeChecked();
  });

  it.each([
    [new PortalApiError(429, "rate_limited"), "Too many referrals right now. Try again later."],
    [new PortalApiError(400, "invalid_body", "notes"), "Shorten the notes."],
    [new PortalApiError(0, "network_error"), "We couldn't reach Acme ISO. Check your connection and try again."],
  ])("explains a failed send (%s)", async (error, message) => {
    const user = userEvent.setup();
    api.submitReferral.mockRejectedValueOnce(error);
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toHaveValue("Fresh Bakery");
  });

  it("appends dictated text to the notes", async () => {
    window.localStorage.setItem("navigatr-portal-draft:acme", JSON.stringify({ notes: "Owner is Sam." }));
    renderAt("/p/acme/new");
    await screen.findByLabelText("Notes (optional)");
    act(() => dictation.onResult?.("Call after 3pm."));
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Owner is Sam. Call after 3pm.");
  });

  it("returns to sign-in when the session is gone", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("keeps the loaded form when a background refresh fails (no retry state)", async () => {
    const user = userEvent.setup();
    api.form.mockResolvedValueOnce(FORM).mockRejectedValue(new PortalApiError(0, "network_error"));
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText(/permission wording was just updated/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I may share these details." })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toHaveValue("Fresh Bakery");
  });

  it("offers a retry only when the form context never loaded", async () => {
    const user = userEvent.setup();
    api.form.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(FORM);
    renderAt("/p/acme/new");
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry.className).toContain("h-12");
    expect(screen.getByRole("button", { name: "Send referral" })).toBeDisabled();
    await user.click(retry);
    expect(await screen.findByRole("checkbox", { name: "I may share these details." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("marks and focuses the field the server rejected", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(400, "invalid_body", "email"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Check the email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("focuses the first invalid field on a local check", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/new");
    await screen.findByRole("checkbox", { name: "I may share these details." });
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(screen.getByLabelText("Business name")).toHaveFocus();
  });

  it("uses 44px-or-larger partner buttons on the form and the confirmation", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    renderAt("/p/acme/new");
    await fillRequired(user);
    expect(screen.getByRole("button", { name: "Send referral" }).className).toContain("h-12");
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    for (const name of ["View this referral", "Send another", "Back to your referrals"]) {
      expect((await screen.findByRole("button", { name })).className).toContain("h-12");
    }
  });

  it("words a dictation failure for partners", async () => {
    dictation.micState = "error";
    renderAt("/p/acme/new");
    expect(
      await screen.findByText("Couldn't turn that into text. Try a shorter clip in a minute, or type it."),
    ).toBeInTheDocument();
  });

  it("never names a rep, stage, value or another partner in the duplicate warning", async () => {
    const user = userEvent.setup();
    api.dupCheck.mockResolvedValue(true);
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Corner Cafe");
    await user.type(screen.getByLabelText("Phone"), "555 010 0001");
    const warning = await screen.findByText(DUP, {}, { timeout: 3000 });
    expect(warning).toHaveAttribute("role", "status");
    expect(warning.textContent).toBe(DUP);
  });
});
