import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalEnv, type PortalRpcResult } from "./portalApi";
import { PORTAL_NOTE_MAX, validateNoteBody } from "./portalSentApi";
import { NAVIGATR_PORTAL_TERMS_VERSION } from "./portalNavigatrTerms";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-22T15:00:00Z");
const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const LOOKUP = [
  { portal_user_id: "u-1", org_id: "o-1", partner_id: "p-1", partner_name: "Jane", user_email: "jane@example.com", org_name: "Acme ISO", org_slug: "acme", terms_current: true, navigatr_terms_version: NAVIGATR_PORTAL_TERMS_VERSION },
];
const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });
type Handler = (args: Record<string, unknown>) => PortalRpcResult;

function setup(handlers: Record<string, Handler> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "portal_session_lookup") return (handlers.portal_session_lookup ?? (() => ok(LOOKUP)))(args);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected rpc ${name}`);
    return handler(args);
  });
  const deps: PortalApiDeps = { rpc, sendEmail: vi.fn(async () => {}), env: ENV, now: () => NOW };
  return { deps, rpc };
}

async function call(action: string, body: Record<string, unknown>, deps: PortalApiDeps) {
  const res = await handlePortalRequest(
    new Request(`${URL_BASE}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-portal-session": "tok", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ slug: "acme", ...body }),
    }),
    deps,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const DETAIL_ROW = {
  id: RID,
  ref: "REF-3F9A21C0",
  company_name: "Fresh Bakery",
  contact_name: "Ann",
  contact_email: "ann@fresh.example",
  contact_phone: "5550100100",
  rep_note: "Ask for Ann after 3pm.",
  status: "working",
  sent_at: "2026-10-20T12:00:00Z",
  rep_name: "Rita Rep",
  rep_email: "rita@acme.example",
  details_removed: false,
  can_post_note: true,
  // Hostile extras a row must never pass through.
  stage: "proposal",
  value_cents: 123456,
  notes: "INTERNAL deal note",
  decline_reason: "outside_icp",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateNoteBody", () => {
  it("trims, and accepts 1 to 1,000 characters", () => {
    expect(validateNoteBody("  hello \n")).toBe("hello");
    expect(validateNoteBody("x".repeat(PORTAL_NOTE_MAX))).toBe("x".repeat(1000));
    expect(validateNoteBody("x".repeat(1001))).toBeNull();
    expect(validateNoteBody("   ")).toBeNull();
    expect(validateNoteBody(42)).toBeNull();
  });

  it("trims exactly space, tab, CR and LF, like SQL btrim", () => {
    expect(validateNoteBody("\u00a0")).toBe("\u00a0");
    expect(validateNoteBody("\u00a0hi\u2003")).toBe("\u00a0hi\u2003");
    expect(validateNoteBody(" \t\r\nhi\t ")).toBe("hi");
    expect(validateNoteBody(" \t\r\n")).toBeNull();
  });
});

describe("list_sent_referrals", () => {
  it("lists the session's sent referrals with partner labels for the chosen window", async () => {
    const { deps, rpc } = setup({
      portal_list_sent_referrals: () =>
        ok([
          { id: RID, ref: "REF-3F9A21C0", company_name: "Fresh Bakery", status: "working", sent_at: "2026-10-20T12:00:00Z", last_activity_at: "2026-10-21T12:00:00Z", stage: "proposal" },
          { id: "x", ref: "REF-X", company_name: "Bogus", status: "bogus", sent_at: "2026-10-20T12:00:00Z", last_activity_at: "2026-10-20T12:00:00Z" },
        ]),
    });
    const { status, json } = await call("list_sent_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_sent_referrals", { p_org: "o-1", p_partner: "p-1", p_since: "2026-09-22T15:00:00.000Z" });
    expect(status).toBe(200);
    expect(json).toEqual({
      referrals: [
        { id: RID, ref: "REF-3F9A21C0", companyName: "Fresh Bakery", label: "In Progress", sentAt: "2026-10-20T12:00:00Z", lastActivityAt: "2026-10-21T12:00:00Z" },
      ],
    });
  });

  it("rejects an unknown window and answers 500 on a database error", async () => {
    const { deps } = setup({ portal_list_sent_referrals: () => fail("boom") });
    expect((await call("list_sent_referrals", { window: "5y" }, deps)).json).toEqual({ error: "invalid_body", field: "window" });
    expect((await call("list_sent_referrals", {}, deps)).status).toBe(500);
  });

  it("401s without a live session and runs no data query", async () => {
    const { deps, rpc } = setup({ portal_session_lookup: () => ok([]) });
    expect((await call("list_sent_referrals", {}, deps)).status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("get_sent_referral", () => {
  it("returns the allowlisted detail with the partner's notes, never the stage, value or internal notes", async () => {
    const { deps, rpc } = setup({
      portal_get_sent_referral: () => ok([DETAIL_ROW]),
      portal_partner_notes: () =>
        ok([
          { id: "n-2", body: "Demo booked.", created_at: "2026-10-21T12:00:00Z", portal_user_id: "u-1" },
          { id: "n-1", body: "Called Ann.", created_at: "2026-10-20T13:00:00Z" },
        ]),
    });
    const { status, json } = await call("get_sent_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_sent_referral", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_referral: RID, p_ip: "203.0.113.9" });
    expect(status).toBe(200);
    expect(json).toEqual({
      referral: {
        id: RID,
        ref: "REF-3F9A21C0",
        companyName: "Fresh Bakery",
        contactName: "Ann",
        contactEmail: "ann@fresh.example",
        contactPhone: "5550100100",
        repNote: "Ask for Ann after 3pm.",
        label: "In Progress",
        sentAt: "2026-10-20T12:00:00Z",
        rep: { name: "Rita Rep", email: "rita@acme.example" },
        detailsRemoved: false,
        canPostNote: true,
        notes: [
          { id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00Z" },
          { id: "n-1", body: "Called Ann.", createdAt: "2026-10-20T13:00:00Z" },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ["proposal", "123456", "INTERNAL", "outside_icp", '"working"', "portal_user_id"]) expect(text).not.toContain(leak);
  });

  it("blanks personal fields and the note once the details were removed", async () => {
    const { deps } = setup({
      portal_get_sent_referral: () => ok([{ ...DETAIL_ROW, details_removed: true, can_post_note: true }]),
      portal_partner_notes: () => ok([]),
    });
    const { json } = await call("get_sent_referral", { referralId: RID }, deps);
    expect(json.referral).toMatchObject({ contactName: null, contactEmail: null, contactPhone: null, repNote: null, detailsRemoved: true, canPostNote: false });
  });

  it("404s a missing, malformed or unlabelled referral, and keeps the page when notes fail", async () => {
    const missing = setup({ portal_get_sent_referral: () => ok([]) });
    expect((await call("get_sent_referral", { referralId: RID }, missing.deps)).status).toBe(404);
    expect((await call("get_sent_referral", { referralId: "not-a-uuid" }, missing.deps)).status).toBe(404);
    const odd = setup({ portal_get_sent_referral: () => ok([{ ...DETAIL_ROW, status: "bogus" }]) });
    expect((await call("get_sent_referral", { referralId: RID }, odd.deps)).status).toBe(404);
    const notesDown = setup({ portal_get_sent_referral: () => ok([DETAIL_ROW]), portal_partner_notes: () => fail("boom") });
    const res = await call("get_sent_referral", { referralId: RID }, notesDown.deps);
    expect(res.status).toBe(200);
    expect((res.json.referral as { notes: unknown[] }).notes).toEqual([]);
  });
});

describe("post_note", () => {
  it("posts the trimmed note for the session and returns only the note", async () => {
    const { deps, rpc } = setup({
      portal_post_partner_note: () => ok([{ id: "n-3", body: "Signed today.", created_at: "2026-10-22T15:00:00Z", org_id: "o-1" }]),
    });
    const { status, json } = await call("post_note", { referralId: RID, body: "  Signed today.  " }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_post_partner_note", {
      p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_referral: RID, p_body: "Signed today.", p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ note: { id: "n-3", body: "Signed today.", createdAt: "2026-10-22T15:00:00Z" } });
  });

  it("posts and returns a note that is only a non-breaking space (SQL keeps it, so the response must too)", async () => {
    const { deps } = setup({
      portal_post_partner_note: (args) => ok([{ id: "n-4", body: args.p_body, created_at: "2026-10-22T15:00:00Z" }]),
    });
    const { status, json } = await call("post_note", { referralId: RID, body: "\u00a0" }, deps);
    expect(status).toBe(200);
    expect(json).toEqual({ note: { id: "n-4", body: "\u00a0", createdAt: "2026-10-22T15:00:00Z" } });
  });

  it("lists a note that is only unicode whitespace, and trims only space, tab, CR and LF", async () => {
    const { deps } = setup({
      portal_get_sent_referral: () => ok([DETAIL_ROW]),
      portal_partner_notes: () => ok([
        { id: "n-1", body: "\u2003", created_at: "2026-10-22T15:00:00Z" },
        { id: "n-2", body: " \u00a0hi\t", created_at: "2026-10-22T14:00:00Z" },
        { id: "n-3", body: " \t\r\n", created_at: "2026-10-22T13:00:00Z" },
      ]),
    });
    const res = await call("get_sent_referral", { referralId: RID }, deps);
    expect((res.json.referral as { notes: unknown[] }).notes).toEqual([
      { id: "n-1", body: "\u2003", createdAt: "2026-10-22T15:00:00Z" },
      { id: "n-2", body: "\u00a0hi", createdAt: "2026-10-22T14:00:00Z" },
    ]);
  });

  it("validates before calling the database", async () => {
    const { deps, rpc } = setup();
    expect((await call("post_note", { referralId: RID, body: " " }, deps)).json).toEqual({ error: "invalid_body", field: "body" });
    expect((await call("post_note", { referralId: RID, body: "x".repeat(1001) }, deps)).json).toEqual({ error: "invalid_body", field: "body" });
    expect((await call("post_note", { referralId: "nope", body: "hi" }, deps)).status).toBe(404);
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("portal_post_partner_note");
  });

  it("maps the database refusals", async () => {
    for (const [message, status, body] of [
      ["referral_not_found", 404, { error: "not_found" }],
      ["rate_limited", 429, { error: "rate_limited" }],
      ["invalid_input:body", 400, { error: "invalid_body", field: "body" }],
      ["boom", 500, { error: "server_error" }],
    ] as const) {
      const { deps } = setup({ portal_post_partner_note: () => fail(message) });
      const res = await call("post_note", { referralId: RID, body: "hi" }, deps);
      expect(res.status).toBe(status);
      expect(res.json).toEqual(body);
    }
  });
});
