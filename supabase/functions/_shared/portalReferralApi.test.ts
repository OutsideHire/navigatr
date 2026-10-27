import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalEnv, type PortalRpcResult } from "./portalApi";
import { PORTAL_MAX_AUDIO_BASE64_CHARS, PORTAL_MAX_AUDIO_BYTES } from "./transcribe";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-12T15:00:00Z");
const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";
const RID = "3f9a21c0-1111-4222-8333-444455556666";

const LOOKUP = [
  {
    portal_user_id: "u-1",
    org_id: "o-1",
    partner_id: "p-1",
    partner_name: "Jane",
    user_email: "jane@example.com",
    org_name: "Acme ISO",
    org_slug: "acme",
  },
];

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

type Handler = (args: Record<string, unknown>) => PortalRpcResult;

function setup(handlers: Record<string, Handler> = {}, extra: Partial<PortalApiDeps> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "portal_session_lookup") return (handlers.portal_session_lookup ?? (() => ok(LOOKUP)))(args);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected rpc ${name}`);
    return handler(args);
  });
  const deps: PortalApiDeps = { rpc, sendEmail: vi.fn(async () => {}), env: ENV, now: () => NOW, ...extra };
  return { deps, rpc };
}

function post(action: string, body: Record<string, unknown>, headers: Record<string, string> = { "x-portal-session": "tok" }) {
  return new Request(`${URL_BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify({ slug: "acme", ...body }),
  });
}

async function call(action: string, body: Record<string, unknown>, deps: PortalApiDeps) {
  const res = await handlePortalRequest(post(action, body), deps);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("session gate", () => {
  it("401s without a session header and never touches the database", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(post("list_referrals", {}, {}), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a Supabase JWT: identity only comes from x-portal-session", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(post("dashboard", {}, { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" }), deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s a dead session and runs no data query", async () => {
    const { deps, rpc } = setup({ portal_session_lookup: () => ok([]) });
    const { status } = await call("dashboard", {}, deps);
    expect(status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("portal_session_lookup", { p_slug: "acme", p_token: "tok" });
  });

  it("answers 500, not 401, when the session lookup itself fails", async () => {
    const { deps } = setup({ portal_session_lookup: () => fail("connection reset") });
    const { status, json } = await call("dashboard", {}, deps);
    expect(status).toBe(500);
    expect(json).toEqual({ error: "server_error" });
  });

  it("takes org, partner and portal user only from the session, never from the body", async () => {
    const { deps, rpc } = setup({
      portal_list_referrals: () => ok([]),
    });
    await call("list_referrals", { p_org: "evil-org", orgId: "evil-org", partnerId: "evil-partner", p_partner: "evil" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_referrals", { p_org: "o-1", p_partner: "p-1", p_since: null });
  });
});

describe("form", () => {
  it("returns only the consent wording and version", async () => {
    const { deps, rpc } = setup({
      portal_form_context: () => ok([{ consent_text: "I may share this.", consent_version: 4, org_id: "o-1" }]),
    });
    const { status, json } = await call("form", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_form_context", { p_org: "o-1", p_partner: "p-1" });
    expect(status).toBe(200);
    expect(json).toEqual({ form: { consentText: "I may share this.", consentVersion: 4 } });
  });
});

describe("dup_check", () => {
  it("passes trimmed fields and answers yes or no only", async () => {
    const { deps, rpc } = setup({ portal_dup_check: () => ok(true) });
    const { json } = await call("dup_check", { companyName: " Corner Cafe ", phone: " 555 010 0001 ", address: "", email: "x@y.co" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_dup_check", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_name: "Corner Cafe",
      p_phone: "555 010 0001",
      p_address: null,
      p_ip: "203.0.113.9",
    });
    expect(json).toEqual({ probableDuplicate: true });
  });

  it("answers no without a query when there is no company name", async () => {
    const { deps, rpc } = setup();
    const { json } = await call("dup_check", { companyName: "  ", phone: "5550100001" }, deps);
    expect(json).toEqual({ probableDuplicate: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("429s when the check is rate limited", async () => {
    const { deps } = setup({ portal_dup_check: () => fail("rate_limited") });
    const { status, json } = await call("dup_check", { companyName: "Co" }, deps);
    expect(status).toBe(429);
    expect(json).toEqual({ error: "rate_limited" });
  });

  it("400s an over-long field", async () => {
    const { deps } = setup();
    const { status } = await call("dup_check", { companyName: "x".repeat(161) }, deps);
    expect(status).toBe(400);
  });
});

describe("submit_referral", () => {
  const VALID = {
    companyName: " Fresh Bakery ",
    contactName: "Ann",
    email: "ANN@fresh.example",
    phone: "",
    address: "5 Oak St",
    industry: "restaurant",
    urgency: "this_week",
    notes: "Wants a demo",
    consent: true,
    consentVersion: 3,
  };

  it("sends validated fields with the session scope and returns only id and ref", async () => {
    const { deps, rpc } = setup({
      portal_submit_referral: () => ok([{ id: RID, ref: "REF-3F9A21C0", duplicate_of_deal_id: "d-9" }]),
    });
    const { status, json } = await call("submit_referral", VALID, deps);
    expect(rpc).toHaveBeenCalledWith("portal_submit_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_company: "Fresh Bakery",
      p_contact_name: "Ann",
      p_contact_email: "ann@fresh.example",
      p_contact_phone: null,
      p_address: "5 Oak St",
      p_industry: "restaurant",
      p_urgency: "this_week",
      p_notes: "Wants a demo",
      p_consent: true,
      p_consent_version: 3,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ referral: { id: RID, ref: "REF-3F9A21C0" } });
  });

  it("400s an invalid field before any data query", async () => {
    const { deps, rpc } = setup();
    const { status, json } = await call("submit_referral", { ...VALID, email: "", phone: "" }, deps);
    expect(status).toBe(400);
    expect(json).toEqual({ error: "invalid_body", field: "emailOrPhone" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid_input:notes", 400, { error: "invalid_body", field: "notes" }],
    ["consent_required", 400, { error: "invalid_body", field: "consent" }],
    ["consent_changed", 409, { error: "consent_changed" }],
    ["rate_limited", 429, { error: "rate_limited" }],
    ["not_authorized", 500, { error: "server_error" }],
  ])("maps the database error %s", async (message, status, body) => {
    const { deps } = setup({ portal_submit_referral: () => fail(message) });
    const res = await call("submit_referral", VALID, deps);
    expect(res.status).toBe(status);
    expect(res.json).toEqual(body);
  });
});

describe("list_referrals", () => {
  const ROW = {
    ref: "REF-AAAA0001",
    company_name: "Fresh Bakery",
    submitted_at: "2026-10-01T12:00:00Z",
    last_activity_at: "2026-10-02T12:00:00Z",
    decline_reason: "outside_icp",
    notes: "internal",
    stage: "proposal",
  };

  it("maps every internal status to its partner label and allowlists the fields", async () => {
    const statuses = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];
    const { deps } = setup({
      portal_list_referrals: () => ok(statuses.map((status, i) => ({ ...ROW, id: `r-${i}`, status }))),
    });
    const { json } = await call("list_referrals", {}, deps);
    const rows = json.referrals as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.label)).toEqual([
      "Received",
      "Accepted",
      "In Progress",
      "Closed Won",
      "Not Moving Forward",
      "Not Moving Forward",
      "Withdrawn",
    ]);
    expect(rows[0]).toEqual({
      id: "r-0",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      label: "Received",
      submittedAt: "2026-10-01T12:00:00Z",
      lastActivityAt: "2026-10-02T12:00:00Z",
    });
  });

  it("drops a row whose status has no partner label", async () => {
    const { deps } = setup({ portal_list_referrals: () => ok([{ ...ROW, id: "r-x", status: "mystery" }]) });
    const { json } = await call("list_referrals", {}, deps);
    expect(json).toEqual({ referrals: [] });
  });

  it("turns the window into a start time from the injected clock", async () => {
    const { deps, rpc } = setup({ portal_list_referrals: () => ok([]) });
    await call("list_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_referrals", { p_org: "o-1", p_partner: "p-1", p_since: "2026-09-12T15:00:00.000Z" });
  });

  it("400s an unknown window", async () => {
    const { deps } = setup();
    const { status, json } = await call("list_referrals", { window: "7d" }, deps);
    expect(status).toBe(400);
    expect(json).toEqual({ error: "invalid_body", field: "window" });
  });
});

describe("dashboard", () => {
  const STATS = { submitted: "5", active: "2", closed_won: "1", not_moving_forward: "1", won_value_cents: "500000", won_sent: "1" };

  it("computes conversion and hides the value when the ISO has not allowed it", async () => {
    const { deps } = setup({ portal_dashboard_stats: () => ok([{ ...STATS, value_visible: false }]) });
    const { json } = await call("dashboard", { window: "all" }, deps);
    expect(json).toEqual({
      dashboard: { submitted: 5, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: false },
    });
    expect(JSON.stringify(json)).not.toContain("500000");
  });

  it("shows the closed-won value when the ISO allows it", async () => {
    const { deps } = setup({ portal_dashboard_stats: () => ok([{ ...STATS, value_visible: true }]) });
    const { json } = await call("dashboard", {}, deps);
    expect(json).toEqual({
      dashboard: { submitted: 5, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: true, totalValueCents: 500000 },
    });
  });

  it("computes the conversion rate from won referrals sent in the window", async () => {
    const { deps } = setup({
      portal_dashboard_stats: () => ok([{ ...STATS, closed_won: "3", won_sent: "1", not_moving_forward: "1", value_visible: false }]),
    });
    const { json } = await call("dashboard", {}, deps);
    const d = json.dashboard as Record<string, unknown>;
    expect(d.closedWon).toBe(3);
    expect(d.conversionRate).toBe(0.5);
  });

  it("reports no conversion rate when nothing has closed", async () => {
    const { deps } = setup({
      portal_dashboard_stats: () =>
        ok([{ submitted: 2, active: 2, closed_won: 0, not_moving_forward: 0, won_value_cents: 0, won_sent: 0, value_visible: false }]),
    });
    const { json } = await call("dashboard", {}, deps);
    expect((json.dashboard as Record<string, unknown>).conversionRate).toBeNull();
  });
});

describe("get_referral", () => {
  const DETAIL = {
    id: RID,
    ref: "REF-3F9A21C0",
    company_name: "Fresh Bakery",
    contact_name: "Ann",
    contact_email: "ann@fresh.example",
    contact_phone: "5550100100",
    address: "5 Oak St",
    industry: "restaurant",
    urgency: "this_week",
    notes: "Wants a demo",
    status: "working",
    source: "portal_signed_in",
    submitted_at: "2026-10-01T12:00:00Z",
    rep_name: "Rita Rep",
    rep_email: "rita@acme.example",
    can_withdraw: false,
    decline_reason: "outside_icp",
    decline_note: "internal decline note",
    stage: "proposal",
  };
  const HISTORY = [
    { status: "submitted", created_at: "2026-10-01T12:00:00Z" },
    { status: "accepted", created_at: "2026-10-02T12:00:00Z" },
    { status: "working", created_at: "2026-10-03T12:00:00Z" },
    { status: "working", created_at: "2026-10-04T12:00:00Z" },
  ];

  const UPDATES = [
    {
      body: "Demo booked for Tuesday",
      published_at: "2026-10-05T12:00:00Z",
      author_name: "Rita Rep",
      author_user_id: "author-uuid-secret",
      author_email: "author-secret@internal.example",
    },
    { body: "  Called the owner  ", published_at: "2026-10-04T12:00:00Z", author_name: null },
    { body: "   ", published_at: "2026-10-03T12:00:00Z", author_name: "Rita Rep" },
  ];

  it("returns the allowlisted detail with labelled, collapsed history", async () => {
    const { deps, rpc } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok(HISTORY),
      portal_referral_updates: () => ok(UPDATES),
    });
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_referral: RID,
      p_ip: "203.0.113.9",
    });
    expect(rpc).toHaveBeenCalledWith("portal_referral_history", { p_org: "o-1", p_partner: "p-1", p_referral: RID });
    expect(status).toBe(200);
    expect(json).toEqual({
      referral: {
        id: RID,
        ref: "REF-3F9A21C0",
        companyName: "Fresh Bakery",
        contactName: "Ann",
        contactEmail: "ann@fresh.example",
        contactPhone: "5550100100",
        address: "5 Oak St",
        industry: "restaurant",
        urgency: "this_week",
        notes: "Wants a demo",
        label: "In Progress",
        submittedAt: "2026-10-01T12:00:00Z",
        canWithdraw: false,
        detailsRemoved: false,
        rep: { name: "Rita Rep", email: "rita@acme.example" },
        closedWonValueCents: null,
        history: [
          { label: "Received", at: "2026-10-01T12:00:00Z" },
          { label: "Accepted", at: "2026-10-02T12:00:00Z" },
          { label: "In Progress", at: "2026-10-03T12:00:00Z" },
        ],
        updates: [
          { body: "Demo booked for Tuesday", publishedAt: "2026-10-05T12:00:00Z", authorName: "Rita Rep" },
          { body: "Called the owner", publishedAt: "2026-10-04T12:00:00Z", authorName: null },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledWith("portal_referral_updates", { p_org: "o-1", p_partner: "p-1", p_referral: RID });
    const text = JSON.stringify(json);
    for (const leak of [
      "working",
      "portal_signed_in",
      "outside_icp",
      "internal decline note",
      "proposal",
      "author-uuid-secret",
      "author-secret@internal.example",
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it("never returns text for a rep-entered referral, even if the row carries it", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([{ ...DETAIL, source: "rep_entered", can_withdraw: true }]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    const detail = json.referral as Record<string, unknown>;
    for (const key of ["contactName", "contactEmail", "contactPhone", "address", "industry", "urgency", "notes"]) {
      expect(detail[key]).toBeNull();
    }
    expect(detail.canWithdraw).toBe(false);
    expect(detail.companyName).toBe("Fresh Bakery");
  });

  it("returns no rep when nobody is assigned yet", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([{ ...DETAIL, rep_name: null, rep_email: null }]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).rep).toBeNull();
  });

  it("returns an empty list when nothing was published", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).updates).toEqual([]);
  });

  it("degrades to no updates when they cannot be read, instead of breaking the page", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => fail("boom"),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(status).toBe(200);
    expect((json.referral as Record<string, unknown>).updates).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("404s a missing, foreign, or malformed id the same way", async () => {
    const { deps, rpc } = setup({ portal_get_referral: () => ok([]) });
    expect((await call("get_referral", { referralId: RID }, deps)).json).toEqual({ error: "not_found" });
    const bad = await call("get_referral", { referralId: "../../etc" }, deps);
    expect(bad.status).toBe(404);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("withdraw_referral", () => {
  it("withdraws through the session scope", async () => {
    const { deps, rpc } = setup({ portal_withdraw_referral: () => ok(null) });
    const { status, json } = await call("withdraw_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_withdraw_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_referral: RID,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it.each([
    ["referral_not_found", 404, { error: "not_found" }],
    ["not_withdrawable", 409, { error: "not_withdrawable" }],
    ["boom", 500, { error: "server_error" }],
  ])("maps %s", async (message, status, body) => {
    const { deps } = setup({ portal_withdraw_referral: () => fail(message) });
    const res = await call("withdraw_referral", { referralId: RID }, deps);
    expect(res.status).toBe(status);
    expect(res.json).toEqual(body);
  });
});

describe("transcribe", () => {
  const AUDIO = btoa("audio-bytes");

  it("claims a slot, then returns the trimmed text", async () => {
    const transcribe = vi.fn(async () => "  Met the owner  ");
    const { deps, rpc } = setup({ portal_claim_transcribe: () => ok(true) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO, mime: "audio/webm" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_claim_transcribe", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_ip: "203.0.113.9",
    });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/webm");
    expect(status).toBe(200);
    expect(json).toEqual({ text: "Met the owner" });
  });

  it("429s when the hourly budget is used, without calling the vendor", async () => {
    const transcribe = vi.fn(async () => "x");
    const { deps } = setup({ portal_claim_transcribe: () => ok(false) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(429);
    expect(json).toEqual({ error: "rate_limited" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("413s oversized audio before decoding or claiming", async () => {
    const transcribe = vi.fn(async () => "x");
    const { deps, rpc } = setup({}, { transcribe });
    const { status, json } = await call("transcribe", { audio: "A".repeat(PORTAL_MAX_AUDIO_BASE64_CHARS + 4) }, deps);
    expect(status).toBe(413);
    expect(json).toEqual({ error: "audio_too_large" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("caps portal audio at 2 MB decoded, well under the rep limit", async () => {
    const transcribe = vi.fn(async () => "x");
    const { deps, rpc } = setup({ portal_claim_transcribe: () => ok(true) }, { transcribe });
    // About 3 MB of audio: fine for a rep, too long for a partner.
    const big = await call("transcribe", { audio: "A".repeat(4 * 1024 * 1024) }, deps);
    expect(big.status).toBe(413);
    expect(big.json).toEqual({ error: "audio_too_large" });
    // One byte over 2 MB decoded, still inside the base64 character cap.
    const over = btoa("a".repeat(PORTAL_MAX_AUDIO_BYTES + 1));
    expect(over.length).toBeLessThanOrEqual(PORTAL_MAX_AUDIO_BASE64_CHARS);
    expect((await call("transcribe", { audio: over }, deps)).status).toBe(413);
    expect(rpc).not.toHaveBeenCalledWith("portal_claim_transcribe", expect.anything());
    expect(transcribe).not.toHaveBeenCalled();
    // Exactly 2 MB goes through.
    const exact = await call("transcribe", { audio: btoa("a".repeat(PORTAL_MAX_AUDIO_BYTES)) }, deps);
    expect(exact.status).toBe(200);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("400s missing or invalid audio", async () => {
    const { deps } = setup({}, { transcribe: vi.fn(async () => "x") });
    expect((await call("transcribe", {}, deps)).status).toBe(400);
    expect((await call("transcribe", { audio: "***" }, deps)).status).toBe(400);
  });

  it("502s a vendor failure without passing the vendor's detail to the partner", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("upload http 500 key=secret");
    });
    const { deps } = setup({ portal_claim_transcribe: () => ok(true) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(502);
    expect(json).toEqual({ error: "transcription_failed" });
  });

  it("500s when no transcriber is wired", async () => {
    const { deps } = setup();
    const { status } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(500);
  });
});

describe("1A rules on the referral actions", () => {
  it("rejects an oversized session token or slug before any rpc", async () => {
    const { deps, rpc } = setup();
    const long = await handlePortalRequest(post("dashboard", {}, { "x-portal-session": "t".repeat(129) }), deps);
    expect(long.status).toBe(401);
    const slug = await handlePortalRequest(post("dashboard", { slug: "s".repeat(65) }), deps);
    expect(slug.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers a generic 500 when an rpc throws, without its detail", async () => {
    const { deps } = setup({
      portal_dashboard_stats: () => {
        throw new Error("secret connection string");
      },
    });
    const res = await handlePortalRequest(post("dashboard", {}), deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});

describe("export_referrals", () => {
  const ROWS = [
    {
      ref: "REF-AAAA0001",
      company_name: "Fresh Bakery",
      status: "won",
      submitted_at: "2026-10-01T12:00:00Z",
      last_activity_at: "2026-10-05T12:00:00Z",
      won_value_cents: 500000,
      value_visible: true,
      icp_flags: ["chain:Subway"],
      decline_reason: "outside_icp",
    },
    {
      ref: "REF-AAAA0002",
      company_name: "Corner Cafe",
      status: "declined",
      submitted_at: "2026-09-20T12:00:00Z",
      last_activity_at: "2026-09-21T12:00:00Z",
      won_value_cents: null,
      value_visible: true,
    },
  ];

  it("returns labelled rows for the session scope and the chosen window", async () => {
    const { deps, rpc } = setup({ portal_export_referrals: () => ok(ROWS), portal_record_export: () => ok(null) });
    const { status, json } = await call("export_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_export_referrals", {
      p_org: "o-1",
      p_partner: "p-1",
      p_since: "2026-09-12T15:00:00.000Z",
    });
    expect(status).toBe(200);
    expect(json).toEqual({
      export: {
        valueVisible: true,
        rows: [
          {
            ref: "REF-AAAA0001",
            companyName: "Fresh Bakery",
            label: "Closed Won",
            submittedAt: "2026-10-01T12:00:00Z",
            lastActivityAt: "2026-10-05T12:00:00Z",
            closedWonValueCents: 500000,
          },
          {
            ref: "REF-AAAA0002",
            companyName: "Corner Cafe",
            label: "Not Moving Forward",
            submittedAt: "2026-09-20T12:00:00Z",
            lastActivityAt: "2026-09-21T12:00:00Z",
            closedWonValueCents: null,
          },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ['"won"', '"declined"', "outside_icp", "chain:", "icp"]) expect(text).not.toContain(leak);
  });

  it("never sends a value when the ISO hides it, even if a row carries one", async () => {
    const hidden = ROWS.map((r) => ({ ...r, value_visible: false }));
    const { deps } = setup({ portal_export_referrals: () => ok(hidden), portal_record_export: () => ok(null) });
    const { json } = await call("export_referrals", {}, deps);
    const out = json.export as { valueVisible: boolean; rows: Array<{ closedWonValueCents: number | null }> };
    expect(out.valueVisible).toBe(false);
    expect(out.rows.map((r) => r.closedWonValueCents)).toEqual([null, null]);
    expect(JSON.stringify(json)).not.toContain("500000");
  });

  it("drops a row whose status has no partner label, and rejects an unknown window", async () => {
    const { deps } = setup({ portal_export_referrals: () => ok([{ ...ROWS[0], status: "bogus" }]), portal_record_export: () => ok(null) });
    expect((await call("export_referrals", {}, deps)).json).toEqual({ export: { valueVisible: false, rows: [] } });
    const bad = await call("export_referrals", { window: "5y" }, deps);
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: "invalid_body", field: "window" });
  });

  it("answers a generic 500 when the export fails", async () => {
    const { deps } = setup({ portal_export_referrals: () => fail("boom") });
    const res = await call("export_referrals", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
  it("audits every export with the session's portal user and IP", async () => {
    const { deps, rpc } = setup({ portal_export_referrals: () => ok(ROWS), portal_record_export: () => ok(null) });
    await call("export_referrals", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_record_export", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_ip: "203.0.113.9" });
  });

  it("delivers no file when the audit cannot be written", async () => {
    const { deps } = setup({ portal_export_referrals: () => ok(ROWS), portal_record_export: () => fail("boom") });
    const res = await call("export_referrals", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
});

describe("get_profile and update_profile", () => {
  const ROW = {
    name: "Jane",
    phone: "5550100100",
    email: "jane@example.com",
    weekly_digest: true,
    org_id: "secret-org",
    notification_prefs: { digest: true, other: "x" },
  };

  it("reads the session partner's profile from an allowlist", async () => {
    const { deps, rpc } = setup({ portal_get_profile: () => ok([ROW]) });
    const { status, json } = await call("get_profile", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_profile", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1" });
    expect(status).toBe(200);
    expect(json).toEqual({ profile: { name: "Jane", phone: "5550100100", email: "jane@example.com", weeklyDigest: true } });
  });

  it("saves trimmed values through the session scope, ignoring ids in the body", async () => {
    const { deps, rpc } = setup({
      portal_update_profile: () => ok([{ ...ROW, name: "Jane Smith", phone: null, weekly_digest: false }]),
    });
    const { status, json } = await call(
      "update_profile",
      { name: " Jane Smith ", phone: "", weeklyDigest: false, orgId: "x", partnerId: "y", portalUserId: "z" },
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_update_profile", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_name: "Jane Smith",
      p_phone: null,
      p_weekly_digest: false,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ profile: { name: "Jane Smith", phone: null, email: "jane@example.com", weeklyDigest: false } });
  });

  it("rejects bad input before any profile call", async () => {
    const { deps, rpc } = setup();
    const res = await call("update_profile", { name: "", phone: null, weeklyDigest: true }, deps);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "invalid_body", field: "name" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps the server's field error and the rate limit", async () => {
    const field = setup({ portal_update_profile: () => fail("invalid_input:phone") });
    expect((await call("update_profile", { name: "Jane", phone: "5550100100", weeklyDigest: true }, field.deps)).json).toEqual({
      error: "invalid_body",
      field: "phone",
    });
    const limited = setup({ portal_update_profile: () => fail("rate_limited") });
    const res = await call("update_profile", { name: "Jane", phone: null, weeklyDigest: true }, limited.deps);
    expect(res.status).toBe(429);
    expect(res.json).toEqual({ error: "rate_limited" });
  });

  it("echoes only a profile field from a server field error", async () => {
    for (const message of ["invalid_input:notes", "invalid_input:contactName", "invalid_input:weeklyDigest"]) {
      const { deps } = setup({ portal_update_profile: () => fail(message) });
      const res = await call("update_profile", { name: "Jane", phone: null, weeklyDigest: true }, deps);
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "invalid_body" });
    }
    const name = setup({ portal_update_profile: () => fail("invalid_input:name") });
    expect((await call("update_profile", { name: "Jane", phone: null, weeklyDigest: true }, name.deps)).json).toEqual({
      error: "invalid_body",
      field: "name",
    });
  });

  it("returns a profile whose stored name is blank instead of failing", async () => {
    const { deps } = setup({ portal_get_profile: () => ok([{ ...ROW, name: "" }]) });
    const res = await call("get_profile", {}, deps);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ profile: { name: "", phone: "5550100100", email: "jane@example.com", weeklyDigest: true } });
  });

  it("answers 500 when no profile row comes back", async () => {
    const { deps } = setup({ portal_get_profile: () => ok([]) });
    const res = await call("get_profile", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
});

describe("get_referral after a purge", () => {
  const PURGED = {
    id: RID,
    ref: "REF-3F9A21C0",
    company_name: "Fresh Bakery",
    contact_name: "PURGED-SECRET name",
    contact_email: "purged-secret@example.com",
    contact_phone: "5550100100",
    address: "PURGED-SECRET address",
    industry: "restaurant",
    urgency: "this_week",
    notes: "PURGED-SECRET notes",
    status: "declined",
    source: "portal_signed_in",
    submitted_at: "2026-06-01T12:00:00Z",
    rep_name: "Rita Rep",
    rep_email: "rita@acme.example",
    can_withdraw: false,
    details_removed: true,
  };

  it("returns no personal details for a purged referral and says so", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([PURGED]),
      portal_referral_history: () => ok([{ status: "declined", created_at: "2026-06-02T12:00:00Z" }]),
      portal_referral_updates: () => ok([]),
    });
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(status).toBe(200);
    const detail = json.referral as Record<string, unknown>;
    expect(detail.detailsRemoved).toBe(true);
    for (const key of ["contactName", "contactEmail", "contactPhone", "address", "notes"]) expect(detail[key]).toBeNull();
    expect(detail).toMatchObject({ companyName: "Fresh Bakery", industry: "restaurant", urgency: "this_week", label: "Not Moving Forward" });
    const text = JSON.stringify(json);
    expect(text).not.toContain("PURGED-SECRET");
    expect(text).not.toContain("purged-secret@example.com");
    expect(text).not.toContain("5550100100");
  });

  it("does not claim removed details for a referral a rep logged", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([{ ...PURGED, source: "rep_logged" }]),
      portal_referral_history: () => ok([{ status: "declined", created_at: "2026-06-02T12:00:00Z" }]),
      portal_referral_updates: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).detailsRemoved).toBe(false);
  });
});

describe("get_referral closed value (FR-PORT-71)", () => {
  const DETAIL = {
    id: RID,
    ref: "REF-3F9A21C0",
    company_name: "Fresh Bakery",
    contact_name: "Ann",
    contact_email: "ann@fresh.example",
    contact_phone: "5550100100",
    address: "5 Oak St",
    industry: "restaurant",
    urgency: "this_week",
    notes: "Wants a demo",
    status: "working",
    source: "portal_signed_in",
    submitted_at: "2026-10-01T12:00:00Z",
    rep_name: "Rita Rep",
    rep_email: "rita@acme.example",
    can_withdraw: false,
  };
  const HISTORY = [{ status: "working", created_at: "2026-10-03T12:00:00Z" }];
  const WON = { ...DETAIL, status: "won" };
  const base = (value: PortalRpcResult) =>
    setup({
      portal_get_referral: () => ok([WON]),
      portal_referral_history: () => ok([{ status: "won", created_at: "2026-10-06T12:00:00Z" }]),
      portal_referral_updates: () => ok([]),
      portal_referral_value: () => value,
    });

  it("returns the value for a Closed Won referral when the ISO shows values", async () => {
    const { deps, rpc } = base(ok(700000));
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_referral_value", { p_org: "o-1", p_partner: "p-1", p_referral: RID });
    expect((json.referral as Record<string, unknown>).closedWonValueCents).toBe(700000);
  });

  it("is null when the ISO hides values (the RPC returns null)", async () => {
    const { deps } = base(ok(null));
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).closedWonValueCents).toBeNull();
  });

  it("is null and never asks for a value unless the label is Closed Won", async () => {
    const { deps, rpc } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok(HISTORY),
      portal_referral_updates: () => ok([]),
      portal_referral_value: () => ok(5),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).closedWonValueCents).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("portal_referral_value", expect.anything());
  });

  it("drops a malformed value instead of passing it on", async () => {
    for (const bad of [-1, "abc", 1.5]) {
      const { deps } = base(ok(bad));
      const { json } = await call("get_referral", { referralId: RID }, deps);
      expect((json.referral as Record<string, unknown>).closedWonValueCents).toBeNull();
    }
  });

  it("a failed value lookup degrades to no value, logged, page still loads", async () => {
    const { deps } = base(fail("boom"));
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(status).toBe(200);
    expect((json.referral as Record<string, unknown>).closedWonValueCents).toBeNull();
    expect(console.error).toHaveBeenCalledWith("[portal_api] referral_value failed:", "boom");
  });

  it("still shows the value after a purge (the deal keeps its value)", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([{ ...WON, details_removed: true }]),
      portal_referral_history: () => ok([{ status: "won", created_at: "2026-10-06T12:00:00Z" }]),
      portal_referral_updates: () => ok([]),
      portal_referral_value: () => ok(300000),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    const detail = json.referral as Record<string, unknown>;
    expect(detail.detailsRemoved).toBe(true);
    expect(detail.closedWonValueCents).toBe(300000);
  });
});
