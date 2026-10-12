/**
 * String audit (spec 7, PRD section 19 acceptance): nothing a partner can see,
 * from the API or on screen, carries an internal status name, a deal stage, a
 * decline reason code, a referral source, or internal free text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  handlePortalRequest,
  type PortalApiDeps,
  type PortalRpcResult,
} from "../../../../../supabase/functions/_shared/portalApi";
import { PORTAL_LABELS } from "../../../../../supabase/functions/_shared/portalLabels";

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

vi.mock("./lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./pages/PortalRoot";
import { PortalApiError } from "./lib/portalApi";
import { writePortalSession } from "./lib/portalSession";

const INTERNAL_STATUSES = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];
const FORBIDDEN_VALUES = new Set([
  ...INTERNAL_STATUSES,
  "new",
  "contacted",
  "qualified",
  "proposal",
  "duplicate",
  "outside_footprint",
  "outside_icp",
  "insufficient_contact",
  "existing_customer",
  "withdrawn_by_partner",
  "rep_entered",
  "portal_signed_in",
]);
const FORBIDDEN_KEYS = ["status", "stage", "source", "decline_reason", "declineReason", "decline_note", "declineNote"];
const FORBIDDEN_WORDS =
  /\b(submitted|accepted|working|won|lost|declined|withdrawn|contacted|qualified|proposal|duplicate|outside_footprint|outside_icp|insufficient_contact|existing_customer|withdrawn_by_partner|rep_entered|portal_signed_in)\b/;
const SECRET = "INTERNAL-SECRET";

function walk(value: unknown, strings: string[], keys: string[]): void {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, strings, keys));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k);
      walk(v, strings, keys);
    }
  }
}

function auditJson(body: unknown) {
  const strings: string[] = [];
  const keys: string[] = [];
  walk(body, strings, keys);
  expect(strings.filter((s) => FORBIDDEN_VALUES.has(s))).toEqual([]);
  expect(keys.filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(body)).not.toContain(SECRET);
}

describe("portal_api responses", () => {
  const hostile = {
    decline_reason: "outside_icp",
    decline_note: `${SECRET} decline note`,
    stage: "proposal",
    deal_notes: `${SECRET} deal note`,
    other_partner: "Someone Else CPA",
  };

  function deps(status: string): PortalApiDeps {
    const rpc = vi.fn(async (name: string): Promise<PortalRpcResult> => {
      switch (name) {
        case "portal_session_lookup":
          return {
            data: [{ portal_user_id: "u-1", org_id: "o-1", partner_id: "p-1", partner_name: "Jane", user_email: "j@x.co", org_name: "Acme ISO", org_slug: "acme" }],
            error: null,
          };
        case "portal_list_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              id: `r-${i}`,
              ref: `REF-0000000${i}`,
              company_name: "Fresh Bakery",
              status: s,
              source: "rep_entered",
              submitted_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              ...hostile,
            })),
            error: null,
          };
        case "portal_get_referral":
          return {
            data: [{
              id: "3f9a21c0-1111-4222-8333-444455556666",
              ref: "REF-3F9A21C0",
              company_name: "Fresh Bakery",
              contact_name: "Ann",
              contact_email: "ann@fresh.example",
              contact_phone: "5550100100",
              address: "5 Oak St",
              industry: "restaurant",
              urgency: "this_week",
              notes: "Wants a demo",
              status,
              source: "portal_signed_in",
              submitted_at: "2026-10-01T12:00:00Z",
              rep_name: "Rita Rep",
              rep_email: "rita@acme.example",
              can_withdraw: status === "submitted",
              ...hostile,
            }],
            error: null,
          };
        case "portal_referral_history":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({ status: s, created_at: `2026-10-0${i + 1}T12:00:00Z`, actor_type: "user", note: SECRET })),
            error: null,
          };
        case "portal_dashboard_stats":
          return {
            data: [{ submitted: 7, active: 3, closed_won: 1, not_moving_forward: 2, won_value_cents: 123456, value_visible: false, ...hostile }],
            error: null,
          };
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    });
    return {
      rpc,
      sendEmail: vi.fn(async () => {}),
      env: { appBaseUrl: "https://app.getnavigatr.io", fromAddress: "n <a@b.co>", appEnv: "production", emailAllowlist: "" },
    };
  }

  async function call(action: string, body: Record<string, unknown>, status: string) {
    const res = await handlePortalRequest(
      new Request(`https://proj.supabase.co/functions/v1/portal_api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-portal-session": "tok" },
        body: JSON.stringify({ slug: "acme", ...body }),
      }),
      deps(status),
    );
    expect(res.status).toBe(200);
    return res.json();
  }

  it.each(INTERNAL_STATUSES)("leaks nothing internal for a referral that is %s", async (status) => {
    auditJson(await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status));
  });

  it("leaks nothing internal in the list or the dashboard", async () => {
    auditJson(await call("list_referrals", {}, "submitted"));
    const dash = await call("dashboard", {}, "submitted");
    auditJson(dash);
    expect(JSON.stringify(dash)).not.toContain("123456");
  });
});

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

function expectCleanScreen() {
  const text = document.body.textContent ?? "";
  expect(text.match(FORBIDDEN_WORDS)).toBeNull();
  expect(text).not.toContain(SECRET);
  expect(text).not.toMatch(/navigatr/i);
}

describe("rendered portal pages", () => {
  const HISTORY = PORTAL_LABELS.map((label, i) => ({ label, at: `2026-10-0${i + 1}T12:00:00Z` }));

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
    Object.values(api).forEach((fn) => fn.mockReset());
    api.brand.mockResolvedValue({ orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });
    api.form.mockResolvedValue({ consentText: "I have permission to share this business's contact details.", consentVersion: 1 });
    api.dupCheck.mockResolvedValue(true);
    writePortalSession("acme", "live");
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
  });

  it("dashboard with every label, value on and off", async () => {
    api.listReferrals.mockResolvedValue(
      PORTAL_LABELS.map((label, i) => ({
        id: `r-${i}`,
        ref: `REF-0000000${i}`,
        companyName: `Business ${i}`,
        label,
        submittedAt: "2026-10-01T12:00:00Z",
        lastActivityAt: "2026-10-02T12:00:00Z",
      })),
    );
    api.dashboard.mockResolvedValue({ submitted: 6, active: 3, closedWon: 1, conversionRate: 0.5, valueVisible: true, totalValueCents: 500000 });
    renderAt("/p/acme/home");
    await screen.findByRole("link", { name: /Business 5/ });
    expectCleanScreen();
  });

  it("dashboard with nothing closed and no referrals", async () => {
    api.listReferrals.mockResolvedValue([]);
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    renderAt("/p/acme/home");
    await screen.findByText("No closed referrals yet");
    expectCleanScreen();
  });

  it.each(PORTAL_LABELS)("detail page labelled %s, with every history step", async (label) => {
    api.getReferral.mockResolvedValue({
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
      label,
      submittedAt: "2026-10-01T12:00:00Z",
      canWithdraw: label === "Received",
      rep: label === "Received" ? null : { name: "Rita Rep", email: "rita@acme.example" },
      history: HISTORY,
    });
    renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    expectCleanScreen();
  });

  it("withdraw confirmation and the too-late message", async () => {
    const user = userEvent.setup();
    api.getReferral.mockResolvedValue({
      id: "r-1",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      industry: null,
      urgency: null,
      notes: null,
      label: "Received",
      submittedAt: "2026-10-01T12:00:00Z",
      canWithdraw: true,
      rep: null,
      history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
    });
    api.withdrawReferral.mockRejectedValue(new PortalApiError(409, "not_withdrawable"));
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    expectCleanScreen();
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    await screen.findByRole("alert");
    expectCleanScreen();
  });

  it("submit form with the duplicate warning, then the confirmation", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Corner Cafe");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.type(screen.getByLabelText("Phone"), "5550100001");
    await screen.findByText(/may already be in progress with Acme ISO/, {}, { timeout: 3000 });
    expectCleanScreen();
    await user.click(await screen.findByRole("checkbox", { name: "I have permission to share this business's contact details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await screen.findByRole("heading", { name: "Referral sent" });
    expectCleanScreen();
  });
});
