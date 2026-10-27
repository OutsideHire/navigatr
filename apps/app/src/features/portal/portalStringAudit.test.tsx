/**
 * String audit (spec 7, PRD section 19 acceptance): nothing a partner can see,
 * from the API or on screen, carries an internal status name, a deal stage, a
 * decline reason code, a referral source, or internal free text.
 *
 * The API block feeds handlePortalRequest hostile rpc rows (internal fields,
 * another partner's name, rep-typed text) and audits the JSON. The rendered
 * block audits the UI copy of each page given clean, already-mapped data; it
 * does not re-test the API mapping.
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
import {
  KIND_LABEL,
  PARTNER_NOTIFY_KINDS,
  PARTNER_DIGEST_KIND,
  PARTNER_SENT_KIND,
  buildPortalNotifyEmail,
} from "../../../../../supabase/functions/_shared/portalNotifyEmail";
import { portalCodeEmail, portalInviteEmail } from "../../../../../supabase/functions/_shared/portalEmail";
import { POWERED_BY, renderEmail } from "../../../../../supabase/functions/_shared/emailTemplate";
import { PUBLIC_HONEYPOT_FIELD, signFormToken } from "../../../../../supabase/functions/_shared/portalPublicForm";
import { buildReferralsCsv } from "./lib/portalCsv";

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
  exportReferrals: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  publicForm: vi.fn(),
  publicSubmit: vi.fn(),
  listSentReferrals: vi.fn(),
  getSentReferral: vi.fn(),
  postNote: vi.fn(),
  unsubscribeDigest: vi.fn(),
}));

vi.mock("./lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/portalApi")>();
  return { ...actual, portalApi: api };
});

const turnstile = vi.hoisted(() => ({ siteKey: "1x00000000000000000000AA", render: vi.fn() }));
vi.mock("./lib/turnstile", () => ({
  turnstileSiteKey: () => turnstile.siteKey,
  loadTurnstile: () => Promise.resolve({ render: turnstile.render, remove: vi.fn() }),
}));
vi.mock("./lib/publicFormTiming", () => ({ waitForFormAge: () => Promise.resolve() }));

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
  "portal_public",
]);
const FORBIDDEN_KEYS = [
  "status", "stage", "source", "decline_reason", "declineReason", "decline_note", "declineNote", "icp_flags", "icpFlags",
];
// Erased personal details a purged row might still carry: never passed through.
const PURGED_SECRET = "PURGED-PERSONAL";
const FORBIDDEN_WORDS =
  /\b(submitted|accepted|working|won|lost|declined|withdrawn|contacted|qualified|proposal|duplicate|outside_footprint|outside_icp|insufficient_contact|existing_customer|withdrawn_by_partner|rep_entered|portal_signed_in|portal_public)\b/;
const SECRET = "INTERNAL-SECRET";
// The injected name of a different partner: no response may ever carry it.
const OTHER_PARTNER = "Someone Else CPA";
// Text a rep typed on a rep-logged referral: never shown to the partner (spec 6).
const REP_SECRET = "REP-TYPED-SECRET call the owner after 5";

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
  expect(JSON.stringify(body)).not.toContain(OTHER_PARTNER);
  expect(JSON.stringify(body)).not.toContain("chain:");
}

describe("portal_api responses", () => {
  const hostile = {
    decline_reason: "outside_icp",
    decline_note: `${SECRET} decline note`,
    stage: "proposal",
    deal_notes: `${SECRET} deal note`,
    other_partner: OTHER_PARTNER,
    icp_flags: ["chain:Subway"],
  };

  function deps(status: string, source = "portal_signed_in", purged = false): PortalApiDeps {
    const repTyped = source === "rep_entered";
    const personal = (value: string) => (purged ? `${PURGED_SECRET} ${value}` : value);
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
              contact_name: repTyped ? `${REP_SECRET} contact` : personal("Ann"),
              contact_email: repTyped ? "rep-secret@internal.example" : personal("ann@fresh.example"),
              contact_phone: personal("5550100100"),
              address: repTyped ? `${REP_SECRET} address` : personal("5 Oak St"),
              industry: "restaurant",
              urgency: "this_week",
              notes: repTyped ? REP_SECRET : personal("Wants a demo"),
              status,
              source,
              submitted_at: "2026-10-01T12:00:00Z",
              rep_name: "Rita Rep",
              rep_email: "rita@acme.example",
              can_withdraw: status === "submitted",
              details_removed: purged,
              ...hostile,
            }],
            error: null,
          };
        case "portal_referral_value":
          return { data: 700000, error: null };
        case "portal_referral_history":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({ status: s, created_at: `2026-10-0${i + 1}T12:00:00Z`, actor_type: "user", note: SECRET })),
            error: null,
          };
        case "portal_referral_updates":
          return {
            data: [
              {
                body: "Demo booked for Tuesday",
                published_at: "2026-10-05T12:00:00Z",
                author_name: "Rita Rep",
                author_user_id: SECRET,
                author_email: `${SECRET}@internal.example`,
                status,
              },
            ],
            error: null,
          };
        case "portal_dashboard_stats":
          return {
            data: [{ submitted: 7, active: 3, closed_won: 1, not_moving_forward: 2, won_value_cents: 123456, value_visible: false, ...hostile }],
            error: null,
          };
        case "portal_export_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              ref: `REF-0000000${i}`,
              company_name: "Fresh Bakery",
              status: s,
              submitted_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              won_value_cents: 123456,
              value_visible: false,
              ...hostile,
            })),
            error: null,
          };
        case "portal_record_export":
          return { data: null, error: null };
        case "portal_list_sent_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              id: `s-${i}`,
              ref: `REF-1000000${i}`,
              company_name: "Gold Gym",
              status: s,
              sent_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              value_cents: 123456,
              notes: `${SECRET} internal note`,
              ...hostile,
            })),
            error: null,
          };
        case "portal_get_sent_referral":
          return {
            data: [{
              id: "3f9a21c0-1111-4222-8333-444455556666",
              ref: "REF-3F9A21C0",
              company_name: "Gold Gym",
              contact_name: "Gil",
              contact_email: "gil@gold.example",
              contact_phone: "5550100200",
              rep_note: "Ask for Gil after 3pm.",
              status,
              sent_at: "2026-10-01T12:00:00Z",
              rep_name: "Rita Rep",
              rep_email: "rita@acme.example",
              details_removed: false,
              can_post_note: true,
              value_cents: 123456,
              notes: `${SECRET} internal note`,
              submitted_by_user_id: SECRET,
              ...hostile,
            }],
            error: null,
          };
        case "portal_partner_notes":
          return {
            data: [{ id: "n-1", body: "Called Gil.", created_at: "2026-10-02T12:00:00Z", portal_user_id: SECRET, org_id: SECRET }],
            error: null,
          };
        case "portal_post_partner_note":
          return {
            data: [{ id: "n-2", body: "Demo booked.", created_at: "2026-10-03T12:00:00Z", portal_user_id: SECRET, status }],
            error: null,
          };
        case "portal_unsubscribe_digest":
          return { data: null, error: null };
        case "portal_get_profile":
          return {
            data: [{ name: "Jane", phone: "5550100100", email: "j@x.co", weekly_digest: true, ...hostile }],
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

  async function call(action: string, body: Record<string, unknown>, status: string, source?: string, purged = false) {
    const res = await handlePortalRequest(
      new Request(`https://proj.supabase.co/functions/v1/portal_api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-portal-session": "tok" },
        body: JSON.stringify({ slug: "acme", ...body }),
      }),
      deps(status, source, purged),
    );
    expect(res.status).toBe(200);
    return res.json();
  }

  it.each(INTERNAL_STATUSES)("leaks nothing internal for a referral that is %s", async (status) => {
    auditJson(await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status));
  });

  it.each(INTERNAL_STATUSES)("never passes rep-typed text through for a rep-logged referral that is %s", async (status) => {
    const body = await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status, "rep_entered");
    auditJson(body);
    expect(JSON.stringify(body)).not.toContain("REP-TYPED-SECRET");
    expect(JSON.stringify(body)).not.toContain("rep-secret@internal.example");
    expect(body.referral).toMatchObject({ companyName: "Fresh Bakery", contactName: null, notes: null, canWithdraw: false });
  });

  it("leaks nothing internal in the list or the dashboard", async () => {
    const list = await call("list_referrals", {}, "submitted");
    auditJson(list);
    // Every fixture row comes back, each with a partner-facing label.
    expect(list.referrals).toHaveLength(INTERNAL_STATUSES.length);
    for (const r of list.referrals as { label: string }[]) {
      expect(PORTAL_LABELS as readonly string[]).toContain(r.label);
    }
    const dash = await call("dashboard", {}, "submitted");
    auditJson(dash);
    expect(JSON.stringify(dash)).not.toContain("123456");
  });

  it.each(INTERNAL_STATUSES)("never passes erased details through for a purged referral that is %s", async (status) => {
    const body = await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status, "portal_signed_in", true);
    auditJson(body);
    expect(JSON.stringify(body)).not.toContain(PURGED_SECRET);
    expect(body.referral).toMatchObject({ detailsRemoved: true, contactName: null, contactEmail: null, contactPhone: null, address: null, notes: null });
  });

  it("export leaks nothing internal, and the CSV built from it carries no internal token", async () => {
    const body = await call("export_referrals", {}, "submitted");
    auditJson(body);
    expect(body.export.rows).toHaveLength(INTERNAL_STATUSES.length);
    expect(body.export.valueVisible).toBe(false);
    expect(JSON.stringify(body)).not.toContain("123456");
    const csv = buildReferralsCsv(body.export);
    expect(csv.match(FORBIDDEN_WORDS)).toBeNull();
    expect(csv).not.toContain(SECRET);
    expect(csv).not.toContain(OTHER_PARTNER);
    expect(csv).not.toContain("chain:");
    expect(csv).not.toMatch(/navigatr/i);
  });

  it("profile leaks nothing beyond the four profile fields", async () => {
    const body = await call("get_profile", {}, "submitted");
    auditJson(body);
    expect(Object.keys(body.profile).sort()).toEqual(["email", "name", "phone", "weeklyDigest"]);
  });

  // Defense in depth: SQL never returns a withdrawn (removed) or unshared row,
  // but the API layer must stay clean for any status a row could carry.
  it.each(INTERNAL_STATUSES)("sent-to-you detail leaks nothing internal for a referral that is %s", async (status) => {
    const body = await call("get_sent_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status);
    auditJson(body);
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(body.referral.repNote).toBe("Ask for Gil after 3pm.");
    expect(body.referral.notes).toEqual([{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-02T12:00:00Z" }]);
  });

  it("the sent-to-you list and a posted note leak nothing internal", async () => {
    const list = await call("list_sent_referrals", {}, "accepted");
    auditJson(list);
    expect(list.referrals).toHaveLength(INTERNAL_STATUSES.length);
    for (const r of list.referrals as { label: string }[]) expect(PORTAL_LABELS as readonly string[]).toContain(r.label);
    expect(JSON.stringify(list)).not.toContain("123456");
    const note = await call("post_note", { referralId: "3f9a21c0-1111-4222-8333-444455556666", body: "Demo booked." }, "accepted");
    auditJson(note);
    expect(Object.keys(note.note).sort()).toEqual(["body", "createdAt", "id"]);
  });

  it("unsubscribe answers exactly the same for any token", async () => {
    const a = await call("unsubscribe_digest", { token: "AbCdEfGhIjKlMnOpQrStUv" }, "accepted");
    const b = await call("unsubscribe_digest", { token: "no-such-token-at-all-xx" }, "accepted");
    expect(a).toEqual({ ok: true });
    expect(b).toEqual(a);
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

describe("public referral form: responses", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const SIGNING = "audit-signing-secret";
  const REP_EMAIL = "rita@acme.example";

  function publicDeps() {
    const rpc = vi.fn(async (name: string): Promise<PortalRpcResult> => {
      switch (name) {
        case "portal_public_form":
          return {
            data: [
              {
                org_name: "Acme ISO",
                rep_name: "Rita Rep",
                consent_text: "I may share this.",
                consent_version: 2,
                org_id: SECRET,
                user_id: SECRET,
                token: SECRET,
                email: REP_EMAIL,
                status: "submitted",
              },
            ],
            error: null,
          };
        case "portal_public_counts":
          return { data: [{ ip_count: 0, link_count: 0 }], error: null };
        case "portal_public_submit":
          return {
            data: [
              {
                id: "1a2b3c4d-0000-0000-0000-000000000000",
                ref: "REF-1A2B3C4D",
                org_name: "Acme ISO",
                logo_url: null,
                primary_color: null,
                assigned_user_id: SECRET,
                source: "portal_public",
              },
            ],
            error: null,
          };
        default:
          return { data: null, error: { message: `unexpected ${name}` } };
      }
    });
    const sendEmail = vi.fn(async (_msg: { from: string; to: string; subject: string; html: string; text: string }) => {});
    const deps: PortalApiDeps = {
      rpc,
      sendEmail,
      now: () => new Date(NOW),
      env: {
        appBaseUrl: "https://app.getnavigatr.io",
        fromAddress: "navigatr <invites@send.getnavigatr.io>",
        appEnv: "production",
        emailAllowlist: "",
        publicFormSigningSecret: SIGNING,
      },
    };
    return { deps, sendEmail };
  }

  async function post(deps: PortalApiDeps, action: string, body: Record<string, unknown>) {
    const res = await handlePortalRequest(
      new Request(`https://proj.supabase.co/functions/v1/portal_api/${action}`, {
        method: "POST",
        // A resolvable client IP: with none the server counts the caller as over the soft limit.
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify(body),
      }),
      deps,
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function submitBody(overrides: Record<string, unknown> = {}) {
    return {
      slug: "acme",
      token: "tok123",
      companyName: "Fresh Bakery",
      contactName: "Ann Owner",
      email: "ann@bakery.example",
      phone: "5550100100",
      notes: `${SECRET} typed by the submitter`,
      referredBy: "Joe",
      referrerEmail: "joe@bank.example",
      consent: true,
      consentVersion: 2,
      formToken: await signFormToken(SIGNING, "acme", "tok123", NOW - 10_000),
      [PUBLIC_HONEYPOT_FIELD]: "",
      ...overrides,
    };
  }

  it("the form carries only the five public fields", async () => {
    const { status, json } = await post(publicDeps().deps, "public_form", { slug: "acme", token: "tok123" });
    expect(status).toBe(200);
    auditJson(json);
    const form = json.form as Record<string, unknown>;
    expect(Object.keys(form).sort()).toEqual(["consentText", "consentVersion", "formToken", "orgName", "repName"]);
    expect(JSON.stringify(json)).not.toContain(REP_EMAIL);
    expect(JSON.stringify(json)).not.toMatch(/navigatr/i);
  });

  it("a real submission and a bot's look exactly alike", async () => {
    const real = await post(publicDeps().deps, "public_submit", await submitBody());
    const bot = await post(publicDeps().deps, "public_submit", await submitBody({ [PUBLIC_HONEYPOT_FIELD]: "spam" }));
    for (const r of [real, bot]) {
      expect(r.status).toBe(200);
      auditJson(r.json);
      expect(Object.keys(r.json)).toEqual(["submission"]);
      expect(Object.keys(r.json.submission as object)).toEqual(["ref"]);
      expect((r.json.submission as { ref: string }).ref).toMatch(/^REF-[0-9A-F]{8}$/);
      expect(JSON.stringify(r.json)).not.toMatch(/navigatr/i);
    }
  });

  it("every refusal body is clean too", async () => {
    const stale = await submitBody({ formToken: "garbage" });
    const cases: Array<[string, () => Promise<{ status: number; json: Record<string, unknown> }>, number, string]> = [
      ["captcha_required", async () => {
        const d = publicDeps().deps;
        const rpc = d.rpc;
        d.rpc = async (name, args) => (name === "portal_public_counts" ? { data: [{ ip_count: 5, link_count: 0 }], error: null } : rpc(name, args));
        return post(d, "public_submit", await submitBody());
      }, 429, "captcha_required"],
      ["rate_limited", async () => {
        const d = publicDeps().deps;
        const rpc = d.rpc;
        d.rpc = async (name, args) => (name === "portal_public_counts" ? { data: [{ ip_count: 30, link_count: 0 }], error: null } : rpc(name, args));
        return post(d, "public_submit", await submitBody());
      }, 429, "rate_limited"],
      ["form_expired", () => post(publicDeps().deps, "public_submit", stale), 409, "form_expired"],
      ["consent_changed", async () => {
        const d = publicDeps().deps;
        const rpc = d.rpc;
        d.rpc = async (name, args) => (name === "portal_public_submit" ? { data: null, error: { message: `consent_changed ${SECRET}` } } : rpc(name, args));
        return post(d, "public_submit", await submitBody());
      }, 409, "consent_changed"],
      ["invalid_body", async () => post(publicDeps().deps, "public_submit", await submitBody({ email: "nope" })), 400, "invalid_body"],
    ];
    for (const [name, run, status, error] of cases) {
      const r = await run();
      expect(r.status, name).toBe(status);
      expect(r.json.error, name).toBe(error);
      auditJson(r.json);
      expect(JSON.stringify(r.json)).not.toMatch(/navigatr/i);
    }
    const bad = await (cases[4][1]());
    expect(bad.json.field).toBe("email");
  });

  it("the confirmation email carries no submitter text and no internal word", async () => {
    const { deps, sendEmail } = publicDeps();
    await post(deps, "public_submit", await submitBody());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("joe@bank.example");
    expect(`${msg.subject} ${msg.text} ${msg.html}`).not.toContain("ann@bakery.example");
    for (const part of [msg.subject, msg.text]) {
      expect(part.match(FORBIDDEN_WORDS)).toBeNull();
      expect(part).not.toContain(SECRET);
      expect(part).not.toContain("Fresh Bakery");
      expect(part).not.toContain("Joe");
    }
    const visibleHtml = msg.html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/Button not working\?/g, "")
      .replace(POWERED_BY, "");
    expect(visibleHtml.match(FORBIDDEN_WORDS)).toBeNull();
    for (const typed of ["Fresh Bakery", "Ann Owner", "Ann", "Joe", "Needs", "typed by the submitter"]) {
      expect(msg.html).not.toContain(typed);
    }
    expect(msg.html).not.toContain(SECRET);
    expect(msg.html.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    expect(msg.text.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
  });
});

describe("rendered portal pages: UI copy audit", () => {
  const HISTORY = PORTAL_LABELS.map((label, i) => ({ label, at: `2026-10-0${i + 1}T12:00:00Z` }));

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
    Object.values(api).forEach((fn) => fn.mockReset());
    api.brand.mockResolvedValue({ orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });
    api.form.mockResolvedValue({ consentText: "I have permission to share this business's contact details.", consentVersion: 1 });
    api.dupCheck.mockResolvedValue(true);
    api.listSentReferrals.mockResolvedValue([]);
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
      updates: [
        { body: "Demo booked for Tuesday", publishedAt: "2026-10-05T12:00:00Z", authorName: label === "Received" ? null : "Rita Rep" },
      ],
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
      updates: [],
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

  it("profile page", async () => {
    api.getProfile.mockResolvedValue({ name: "Jane", phone: null, email: "jane@example.com", weeklyDigest: true });
    renderAt("/p/acme/profile");
    await screen.findByRole("heading", { name: "Your profile" });
    expectCleanScreen();
  });

  it("detail page after the contact details were removed", async () => {
    api.getReferral.mockResolvedValue({
      id: "r-1",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      industry: "restaurant",
      urgency: null,
      notes: null,
      label: "Not Moving Forward",
      submittedAt: "2026-06-01T12:00:00Z",
      canWithdraw: false,
      detailsRemoved: true,
      rep: null,
      history: [{ label: "Received", at: "2026-06-01T12:00:00Z" }, { label: "Not Moving Forward", at: "2026-06-02T12:00:00Z" }],
      updates: [],
    });
    renderAt("/p/acme/r/r-1");
    await screen.findByText("Contact details for this referral were removed for privacy.");
    expectCleanScreen();
  });

  it("public form and its confirmation", async () => {
    const user = userEvent.setup();
    api.publicForm.mockResolvedValue({
      orgName: "Acme ISO",
      repName: "Rita Rep",
      consentText: "I may share this.",
      consentVersion: 2,
      formToken: "1.ab",
    });
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt("/p/acme/refer/tok123");
    await screen.findByRole("heading", { name: "Refer a business to Acme ISO" });
    expectCleanScreen();

    await user.type(screen.getByLabelText(/^Business name/), "Fresh Bakery");
    await user.type(screen.getByLabelText(/^Contact name/), "Ann");
    await user.type(screen.getByLabelText(/^Email/), "ann@bakery.example");
    await user.type(screen.getByLabelText(/^Phone/), "5550100100");
    await user.type(screen.getByLabelText(/^Notes/), "Needs a terminal.");
    await user.click(screen.getByRole("checkbox", { name: "I may share this." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await screen.findByRole("heading", { name: "Thanks for the referral" });
    expectCleanScreen();
  });

  it("public form unavailable", async () => {
    api.publicForm.mockResolvedValue(null);
    renderAt("/p/acme/refer/old");
    await screen.findByRole("heading", { name: "This form isn't available" });
    expectCleanScreen();
  });

  const SENT_LABELS = PORTAL_LABELS.filter((l) => l !== "Received" && l !== "Withdrawn");

  it("dashboard with Sent to you in every label it can show", async () => {
    api.listReferrals.mockResolvedValue([]);
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listSentReferrals.mockResolvedValue(
      SENT_LABELS.map((label, i) => ({
        id: `s-${i}`,
        ref: `REF-1000000${i}`,
        companyName: `Sent ${i}`,
        label,
        sentAt: "2026-10-01T12:00:00Z",
        lastActivityAt: "2026-10-02T12:00:00Z",
      })),
    );
    renderAt("/p/acme/home");
    await screen.findByRole("link", { name: /Sent 3/ });
    expectCleanScreen();
  });

  it.each(SENT_LABELS)("sent referral page labelled %s, with notes and the composer", async (label) => {
    api.getSentReferral.mockResolvedValue({
      id: "s-1",
      ref: "REF-BBBB0001",
      companyName: "Gold Gym",
      contactName: "Gil",
      contactEmail: "gil@gold.example",
      contactPhone: "5550100200",
      repNote: "Ask for Gil after 3pm.",
      label,
      sentAt: "2026-10-01T12:00:00Z",
      rep: label === "Not Moving Forward" ? null : { name: "Rita Rep", email: "rita@acme.example" },
      detailsRemoved: false,
      canPostNote: true,
      notes: [{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-02T12:00:00Z" }],
    });
    renderAt("/p/acme/s/s-1");
    await screen.findByRole("heading", { name: "Gold Gym" });
    expectCleanScreen();
  });

  it("sent referral page after a refused note, and with the details removed", async () => {
    const user = userEvent.setup();
    api.getSentReferral.mockResolvedValue({
      id: "s-1",
      ref: "REF-BBBB0001",
      companyName: "Gold Gym",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      repNote: null,
      label: "Accepted",
      sentAt: "2026-10-01T12:00:00Z",
      rep: null,
      detailsRemoved: true,
      canPostNote: true,
      notes: [],
    });
    api.postNote.mockRejectedValue(new PortalApiError(429, "rate_limited"));
    renderAt("/p/acme/s/s-1");
    await user.type(await screen.findByLabelText("Add a note for Acme ISO"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    await screen.findByRole("alert");
    expectCleanScreen();
  });

  it("unsubscribe page, before and after", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockResolvedValue(undefined);
    renderAt("/p/acme/unsubscribe?t=AbCdEfGhIjKlMnOpQrStUv");
    await screen.findByRole("heading", { name: "Stop the weekly summary?" });
    expectCleanScreen();
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByRole("heading", { name: "You're unsubscribed" });
    expectCleanScreen();
  });

  describe("public form: every page state", () => {
    const FORM = { orgName: "Acme ISO", repName: "Rita Rep", consentText: "I may share this.", consentVersion: 2, formToken: "1.ab" };

    beforeEach(() => {
      turnstile.siteKey = "1x00000000000000000000AA";
      turnstile.render.mockReset();
      api.publicForm.mockResolvedValue(FORM);
    });

    async function open() {
      const user = userEvent.setup();
      renderAt("/p/acme/refer/tok123");
      await screen.findByRole("heading", { name: "Refer a business to Acme ISO" });
      return user;
    }
    async function fillAll(user: ReturnType<typeof userEvent.setup>, referrerEmail = "") {
      await user.type(screen.getByLabelText(/^Business name/), "Fresh Bakery");
      await user.type(screen.getByLabelText(/^Contact name/), "Ann");
      await user.type(screen.getByLabelText(/^Email/), "ann@bakery.example");
      await user.type(screen.getByLabelText(/^Phone/), "5550100100");
      await user.type(screen.getByLabelText(/^Notes/), "Needs a terminal.");
      if (referrerEmail) await user.type(screen.getByLabelText("Your email (optional)"), referrerEmail);
      await user.click(screen.getByRole("checkbox", { name: "I may share this." }));
      await user.click(screen.getByRole("button", { name: "Send referral" }));
    }

    it("a field error from client validation", async () => {
      const user = await open();
      await user.click(screen.getByRole("button", { name: "Send referral" }));
      await screen.findByText("Add the business name.");
      expectCleanScreen();
    });

    it("the server naming a field", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(400, "invalid_body", "email"));
      const user = await open();
      await fillAll(user);
      await screen.findByText("Add a valid email address.");
      expectCleanScreen();
    });

    it("the check prompt, then the failed check notice", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
      turnstile.render.mockImplementation((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
        queueMicrotask(() => opts.callback("captcha-bad"));
        return "w1";
      });
      const user = await open();
      await fillAll(user);
      await screen.findByText("That check didn't go through. Try it again.");
      expectCleanScreen();
    });

    it("the check prompt while the check is shown", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
      turnstile.render.mockImplementation(() => "w1");
      const user = await open();
      await fillAll(user);
      await screen.findByText("One more step. Complete the check below and we'll send it.");
      expectCleanScreen();
    });

    it("the check could not load", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
      turnstile.render.mockImplementation(() => {
        throw new Error("boom");
      });
      const user = await open();
      await fillAll(user);
      await screen.findByText("The check couldn't load. Try again later.");
      expectCleanScreen();
    });

    it("the rate limit notice", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(429, "rate_limited"));
      const user = await open();
      await fillAll(user);
      await screen.findByText("Too many referrals from this connection right now. Try again later.");
      expectCleanScreen();
    });

    it("the page expired and the wording changed notices", async () => {
      api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "form_expired"));
      const user = await open();
      await fillAll(user);
      await screen.findByText("This page was open for a while. Check your details and send it again.");
      expectCleanScreen();
    });

    it("a load error with the retry button", async () => {
      api.publicForm.mockReset();
      api.publicForm.mockRejectedValue(new PortalApiError(0, "network_error"));
      renderAt("/p/acme/refer/tok123");
      await screen.findByRole("button", { name: "Try again" });
      expectCleanScreen();
    });

    it("a send failure alert", async () => {
      api.publicSubmit.mockRejectedValue(new PortalApiError(400, "invalid_body"));
      const user = await open();
      await fillAll(user);
      await screen.findByText("We couldn't send that. Try again.");
      expectCleanScreen();
    });

    it("thanks, with a referrer email, promises a confirmation", async () => {
      api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
      const user = await open();
      await fillAll(user, "joe@bank.example");
      await screen.findByText("A confirmation email is on its way.");
      expectCleanScreen();
    });
  });
});

describe("partner emails: copy audit", () => {
  const RID = "3f9a21c0-1111-4222-8333-444455556666";
  const CTX = { appBaseUrl: "https://app.getnavigatr.io", referralId: RID };
  // Hostile markup in every free field the SQL can carry.
  const XSS = "<script>alert(1)</script>";
  const IMG = "<img src=x onerror=alert(2)>";
  const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation"];
  const TOKEN_RE = new RegExp(`\\b(${[...INTERNAL_STATUSES, ...STAGES].join("|")})\\b`);
  // The template's generic link-fallback sentence uses the everyday word "working"; it is not a status.
  const TEMPLATE_FALLBACK = /Button not working\?/g;
  const REASON_RE = /\b[a-z]+(?:_[a-z]+)+\b/;

  const payload = (label: string) => ({
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: `Jane ${IMG}`,
    companyName: `Fresh Bakery ${XSS}`,
    ref: "REF-3F9A21C0",
    label,
    valueCents: 500000,
    repName: `Rita Rep ${IMG}`,
    repEmail: "rita@acme.example",
    updateBody: `Spoke with the owner today. Demo next Tuesday.\n${XSS}\n${IMG}`,
  });

  const CASES: Array<[string, string]> = PARTNER_NOTIFY_KINDS.flatMap((kind): Array<[string, string]> =>
    kind === "partner_update" ? PORTAL_LABELS.map((label): [string, string] => [kind, label]) : [[kind, KIND_LABEL[kind]]],
  );

  it("covers every kind and every label", () => {
    expect(CASES.length).toBe(PARTNER_NOTIFY_KINDS.length - 1 + PORTAL_LABELS.length);
  });

  it.each(CASES)("%s labelled %s: partner words only, the ISO's name, the locked credit", (kind, label) => {
    const built = buildPortalNotifyEmail(kind, payload(label), CTX);
    expect(built).not.toBeNull();
    const e = built!;
    const copy = [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
    expect(copy).toContain("Acme ISO");
    expect(copy).not.toMatch(/navigatr/i);

    const { html, text } = renderEmail({ ...e, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    const visibleHtml = html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/https?:\/\/\S+/g, "")
      .replace(TEMPLATE_FALLBACK, "");
    const visibleText = text.replace(/https?:\/\/\S+/g, "").replace(TEMPLATE_FALLBACK, "");

    for (const [name, s] of [["subject", e.subject], ["text", visibleText], ["html", visibleHtml]] as const) {
      expect(s.match(TOKEN_RE), `${kind}/${label}: status or stage token in ${name}`).toBeNull();
      expect(s.match(FORBIDDEN_WORDS), `${kind}/${label}: forbidden word in ${name}`).toBeNull();
      expect(s.match(REASON_RE), `${kind}/${label}: reason code in ${name}`).toBeNull();
    }

    // The locked credit is present exactly once and is the only mention of navigatr.
    expect(visibleText).toContain(POWERED_BY);
    expect(visibleText.split(POWERED_BY).length - 1).toBe(1);
    expect(visibleText.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    expect(e.subject).not.toMatch(/navigatr/i);
    expect(visibleHtml.split(POWERED_BY).length - 1).toBe(1);
    expect(visibleHtml.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);

    // Hostile markup is escaped, never raw.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
    if (kind === "partner_update") expect(html).toContain("Demo next Tuesday.");
  });

  it("drops a payload that carries any key beyond the allowlist", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      for (const extra of [
        { status: "lost" },
        { stage: "proposal" },
        { decline_reason: "outside_icp" },
        { notes: `${SECRET} deal note` },
        { other_partner: OTHER_PARTNER },
      ]) {
        expect(buildPortalNotifyEmail(kind, { ...payload(label), ...extra }, CTX)).toBeNull();
      }
    }
  });

  it("drops every partner email whose label is an internal status", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      for (const status of INTERNAL_STATUSES) {
        expect(buildPortalNotifyEmail(kind, payload(status), CTX)).toBeNull();
      }
    }
  });

  it("shows no amount when the ISO hides closed-won value", () => {
    const won = buildPortalNotifyEmail("partner_closed_won", { ...payload("Closed Won"), valueCents: null }, CTX);
    expect(won).not.toBeNull();
    expect(renderEmail(won!).text).not.toContain("$");
  });
});

describe("Phase 2B-3 partner emails: copy audit", () => {
  const XSS = "<script>alert(1)</script>";
  const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation"];
  const TOKEN_RE = new RegExp(`\\b(${[...INTERNAL_STATUSES, ...STAGES].join("|")})\\b`);
  const TEMPLATE_FALLBACK = /Button not working\?/g;
  const REASON_RE = /\b[a-z]+(?:_[a-z]+)+\b/;
  const CTX = {
    appBaseUrl: "https://app.getnavigatr.io",
    referralId: "3f9a21c0-1111-4222-8333-444455556666",
    portalApiUrl: "https://proj.supabase.co/functions/v1/portal_api",
  };
  const SENT = {
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: `Jane ${XSS}`,
    companyName: `Gold Gym ${XSS}`,
    ref: "REF-3F9A21C0",
    repName: "Rita Rep",
    repEmail: "rita@acme.example",
    note: `Ask for Gil after 3pm.\n${XSS}`,
  };
  const DIGEST = {
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: `Jane ${XSS}`,
    weekLabel: "Dec 31",
    counts: { submitted: 2, accepted: 1, inProgress: 1, closedWon: 1, notMovingForward: 1, sentToYou: 1 },
    valueCents: 500000,
    items: [
      ...PORTAL_LABELS.slice(0, 5).map((label): { companyName: string; label: string } => ({ companyName: `Co ${XSS}`, label })),
      { companyName: "Gold Gym", label: "Sent to you" },
    ],
    unsubscribeToken: "AbCdEfGhIjKlMnOpQrStUv",
  };

  it.each([
    [PARTNER_SENT_KIND, SENT],
    [PARTNER_DIGEST_KIND, DIGEST],
  ] as const)("%s: partner words only, the ISO's name, the locked credit, escaped markup", (kind, payload) => {
    const built = buildPortalNotifyEmail(kind, payload, CTX);
    expect(built).not.toBeNull();
    const e = built!;
    const copy = [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
    expect(copy).toContain("Acme ISO");
    expect(copy).not.toMatch(/navigatr/i);

    const { html, text } = renderEmail({ ...e, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    const visibleHtml = html.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, "").replace(TEMPLATE_FALLBACK, "");
    const visibleText = text.replace(/https?:\/\/\S+/g, "").replace(TEMPLATE_FALLBACK, "");
    for (const s of [e.subject, visibleText, visibleHtml]) {
      expect(s.match(TOKEN_RE)).toBeNull();
      expect(s.match(FORBIDDEN_WORDS)).toBeNull();
      expect(s.match(REASON_RE)).toBeNull();
    }
    expect(visibleText.split(POWERED_BY).length - 1).toBe(1);
    expect(visibleText.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops either payload when it carries anything beyond the allowlist", () => {
    for (const extra of [{ status: "lost" }, { stage: "proposal" }, { notes: `${SECRET} deal note` }, { other_partner: OTHER_PARTNER }]) {
      expect(buildPortalNotifyEmail(PARTNER_SENT_KIND, { ...SENT, ...extra }, CTX)).toBeNull();
      expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, ...extra }, CTX)).toBeNull();
    }
  });

  it("only the weekly summary can be unsubscribed from; sign-in and invite emails never (FR-PORT-84)", () => {
    const digest = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, CTX)!;
    expect(renderEmail(digest).text).toMatch(/Unsubscribe from the weekly summary/);
    expect(digest.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const sent = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, CTX)!;
    const code = portalCodeEmail({ orgName: "Acme ISO", code: "123456", signInUrl: "https://app.getnavigatr.io/p/acme" });
    const invite = portalInviteEmail({ orgName: "Acme ISO", partnerName: "Jane", inviteUrl: "https://app.getnavigatr.io/p/acme/invite#t" });
    for (const e of [sent, code, invite]) {
      const { html, text } = renderEmail(e);
      expect(text).not.toMatch(/unsubscribe/i);
      expect(html).not.toMatch(/unsubscribe/i);
      expect("headers" in e && (e as { headers?: unknown }).headers).toBeFalsy();
    }
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, {
        slug: "acme", orgName: "Acme ISO", partnerName: "Jane", companyName: "Fresh Bakery", ref: "REF-3F9A21C0",
        label, valueCents: null, repName: "Rita Rep", repEmail: "rita@acme.example", updateBody: "Hi",
      }, CTX)!;
      expect(renderEmail(e).text).not.toMatch(/unsubscribe/i);
      expect(e.headers).toBeUndefined();
    }
  });

  it("internal_partner_note goes to the rep: no partner note text, no unsubscribe, no headers, escaped markup", () => {
    const e = buildPortalNotifyEmail(
      "internal_partner_note",
      { appUrlPath: "/referrals", companyNames: [`Gold Gym ${XSS}`], count: 1 },
      CTX,
    );
    expect(e).not.toBeNull();
    expect(e!.audience).toBe("internal");
    expect(e!.headers).toBeUndefined();
    const { html, text } = renderEmail(e!);
    expect(text).not.toMatch(/unsubscribe/i);
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    // The payload allowlist has no room for the note body.
    expect(
      buildPortalNotifyEmail("internal_partner_note", { appUrlPath: "/referrals", companyNames: ["Gold Gym"], count: 1, body: "secret note" }, CTX),
    ).toBeNull();
  });
});
