import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalInvite, type PortalInviteDeps } from "./portalInvite";
import type { PortalEmailMessage, PortalEnv, PortalRpcResult } from "./portalApi";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const TOKEN = "a".repeat(64);
const ROW = {
  invite_token: TOKEN,
  invite_email: "jane@example.com",
  partner_name: "Jane",
  org_name: "Acme ISO",
  org_slug: "acme",
};
const PARTNER = "11111111-2222-3333-4444-555555555555";

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

function setup(opts: { userId?: string | null; result?: PortalRpcResult; env?: PortalEnv } = {}) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => opts.result ?? ok([ROW]));
  const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
  const getUserId = vi.fn(async () => (opts.userId === undefined ? "user-1" : opts.userId));
  const deps: PortalInviteDeps = { getUserId, rpc, sendEmail, env: opts.env ?? ENV };
  return { deps, rpc, sendEmail };
}

function post(body: unknown): Request {
  return new Request("https://proj.supabase.co/functions/v1/portal_invite", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-jwt" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePortalInvite", () => {
  it("answers CORS preflight and rejects other methods", async () => {
    const { deps } = setup();
    const pre = await handlePortalInvite(new Request("https://x/functions/v1/portal_invite", { method: "OPTIONS" }), deps);
    expect(pre.status).toBe(200);
    const get = await handlePortalInvite(new Request("https://x/functions/v1/portal_invite", { method: "GET" }), deps);
    expect(get.status).toBe(405);
  });

  it("401s when the caller is not a signed-in internal user", async () => {
    const { deps, rpc } = setup({ userId: null });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s a missing or malformed partner id", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalInvite(post({ partnerId: "not-a-uuid" }), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s an over-long body or partner id without calling the database", async () => {
    const { deps, rpc } = setup();
    const longId = await handlePortalInvite(post({ partnerId: `${PARTNER}${"0".repeat(200)}` }), deps);
    expect(longId.status).toBe(400);
    const longBody = await handlePortalInvite(post({ partnerId: PARTNER, pad: "x".repeat(2000) }), deps);
    expect(longBody.status).toBe(400);
    expect(await longBody.json()).toEqual({ error: "invalid_body" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates the invite as the verified user and emails the link, never returning the token", async () => {
    const { deps, rpc, sendEmail } = setup();
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_create_invite", { p_partner_id: PARTNER, p_actor: "user-1" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("jane@example.com");
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.subject).toBe("Acme ISO invited you to their referral portal");
    expect(msg.html).toContain(`https://app.getnavigatr.io/p/acme/invite?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, emailed: true });
    expect(text).not.toContain(TOKEN);
  });

  it.each([
    ["not_authorized", 403],
    ["partner_not_found", 404],
    ["portal_disabled", 409],
    ["partner_email_required", 422],
    ["portal_already_active", 409],
    ["portal_email_in_use", 409],
  ])("maps %s to %i", async (token, status) => {
    const { deps, sendEmail } = setup({ result: fail(token) });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: token });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("500s an unexpected database error", async () => {
    const { deps } = setup({ result: fail("connection reset") });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "invite_failed" });
  });

  it("respects the non-production allowlist", async () => {
    const { deps, sendEmail } = setup({ env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, emailed: false });
  });

  it("502s when the email provider fails", async () => {
    const { deps, sendEmail } = setup();
    sendEmail.mockRejectedValueOnce(new Error("resend down"));
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "email_failed" });
  });

  it("maps a thrown getUserId to 401 with no detail", async () => {
    const { deps, rpc } = setup();
    deps.getUserId = vi.fn(async () => {
      throw new Error("auth boom secret");
    });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("secret");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a thrown rpc to a generic 500 with no detail", async () => {
    const { deps, sendEmail } = setup();
    deps.rpc = vi.fn(async () => {
      throw new Error("db boom secret");
    });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "invite_failed" });
    expect(text).not.toContain("secret");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("400s an oversized or non-JSON body and ignores any actor in the body", async () => {
    const { deps, rpc } = setup();
    const big = await handlePortalInvite(post({ partnerId: PARTNER, pad: "x".repeat(5000) }), deps);
    expect(big.status).toBe(400);
    const bad = await handlePortalInvite(
      new Request("https://x/functions/v1/portal_invite", { method: "POST", body: "nope" }),
      deps,
    );
    expect(bad.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await handlePortalInvite(post({ partnerId: PARTNER, actor: "evil", p_actor: "evil" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_create_invite", { p_partner_id: PARTNER, p_actor: "user-1" });
  });
});
