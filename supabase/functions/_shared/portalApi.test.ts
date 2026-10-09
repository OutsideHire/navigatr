import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clientIp,
  firstRow,
  handlePortalRequest,
  portalAction,
  sessionTokenFrom,
  type PortalApiDeps,
  type PortalEmailMessage,
  type PortalEnv,
  type PortalRpcResult,
} from "./portalApi";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io/",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

function setup(rpcImpl: (name: string, args: Record<string, unknown>) => PortalRpcResult, env: PortalEnv = ENV) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args));
  const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
  const deps: PortalApiDeps = { rpc, sendEmail, env };
  return { deps, rpc, sendEmail };
}

const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";

function post(action: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${URL_BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("parses the action from the last path segment", () => {
    expect(portalAction(`${URL_BASE}/brand`)).toBe("brand");
    expect(portalAction("not a url")).toBe("");
  });

  it("takes the first x-forwarded-for entry as the client IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.5 , 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("reads the session only from x-portal-session", () => {
    expect(sessionTokenFrom(new Headers({ "x-portal-session": "  abc " }))).toBe("abc");
    expect(sessionTokenFrom(new Headers({ authorization: "Bearer eyJhbGciOi" }))).toBe("");
  });

  it("returns the first row of an RPC result", () => {
    expect(firstRow([{ a: 1 }])).toEqual({ a: 1 });
    expect(firstRow([])).toBeNull();
    expect(firstRow(null)).toBeNull();
    expect(firstRow({ a: 2 })).toEqual({ a: 2 });
  });
});

describe("routing", () => {
  it("answers CORS preflight and allows the session header", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(new Request(`${URL_BASE}/me`, { method: "OPTIONS" }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("x-portal-session");
  });

  it("404s an unknown action without touching the database", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("drop_tables", {}), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("405s a non-POST request", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(new Request(`${URL_BASE}/brand`, { method: "GET" }), deps);
    expect(res.status).toBe(405);
  });

  it("400s a body that is not JSON", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(post("brand", "{not json"), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("brand", () => {
  it("returns only the allowlisted branding fields for a normalized slug", async () => {
    const { deps, rpc } = setup(() =>
      ok([
        {
          org_name: "Acme ISO",
          product_name: "Acme",
          primary_color: "#0f766e",
          logo_url: "https://cdn.example/l.png",
          dark_logo_url: null,
          org_id: "secret-org-id",
          partner_terms_text: "internal",
        },
      ]),
    );
    const res = await handlePortalRequest(post("brand", { slug: "  ACME " }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_brand", { p_slug: "acme" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      brand: {
        orgName: "Acme ISO",
        productName: "Acme",
        primaryColor: "#0f766e",
        logoUrl: "https://cdn.example/l.png",
        darkLogoUrl: null,
      },
    });
  });

  it("404s an unknown or disabled portal with no tenant detail", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("brand", { slug: "nope" }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_available" });
  });

  it("500s when the database fails", async () => {
    const { deps } = setup(() => fail("boom"));
    const res = await handlePortalRequest(post("brand", { slug: "acme" }), deps);
    expect(res.status).toBe(500);
  });
});

describe("request_code", () => {
  const ISSUED = ok([{ code: "123456", recipient: "jane@example.com", org_name: "Acme ISO", org_slug: "acme" }]);

  it.each([
    ["a code was issued", ISSUED],
    ["no such user", ok([])],
    ["rate limited, inactive, or portal off", ok(null)],
    ["the database failed", fail("boom")],
  ])("always answers { ok: true } when %s", async (_label, result) => {
    const { deps } = setup(() => result);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers { ok: true } for a malformed email without calling the database", async () => {
    const { deps, rpc } = setup(() => ISSUED);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "nope" }), deps);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the client IP and emails the code in the ISO's name", async () => {
    const { deps, rpc, sendEmail } = setup(() => ISSUED);
    await handlePortalRequest(
      post("request_code", { slug: "acme", email: "jane@example.com" }, { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_issue_code", {
      p_slug: "acme",
      p_email: "jane@example.com",
      p_ip: "203.0.113.5",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("jane@example.com");
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.subject).toBe("Your sign-in code for Acme ISO");
    expect(msg.html).toContain("123456");
    expect(msg.text).toContain("https://app.getnavigatr.io/p/acme");
  });

  it("respects the non-production allowlist and still answers { ok: true }", async () => {
    const staging: PortalEnv = { ...ENV, appEnv: "staging", emailAllowlist: "someone@else.com" };
    const { deps, sendEmail } = setup(() => ISSUED, staging);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true });

    const allowed = setup(() => ISSUED, { ...staging, emailAllowlist: "jane@example.com" });
    await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), allowed.deps);
    expect(allowed.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("answers { ok: true } even when the email provider fails", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    sendEmail.mockRejectedValueOnce(new Error("resend down"));
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("verify_code", () => {
  it("returns only the session token and expiry", async () => {
    const { deps, rpc } = setup(() =>
      ok([{ session_token: "t".repeat(64), session_expires_at: "2026-11-08T00:00:00Z", portal_user_id: "u-1" }]),
    );
    const res = await handlePortalRequest(
      post(
        "verify_code",
        { slug: "acme", email: "jane@example.com", code: "123 456" },
        { "x-forwarded-for": "198.51.100.7", "user-agent": "Mozilla/5.0" },
      ),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_verify_code", {
      p_slug: "acme",
      p_email: "jane@example.com",
      p_code: "123456",
      p_ip: "198.51.100.7",
      p_user_agent: "Mozilla/5.0",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionToken: "t".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
  });

  it("answers a generic 401 for a wrong code", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "000000" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("answers the same 401 for a malformed code without calling the database", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "12ab" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the same 401 when the database fails", async () => {
    const { deps } = setup(() => fail("boom"));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "123456" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });
});

describe("peek_invite", () => {
  it("returns only the allowlisted invite fields", async () => {
    const { deps, rpc } = setup(() =>
      ok([{ partner_name: "Jane", org_name: "Acme ISO", terms_text: "Be fair.", terms_version: 2, org_id: "secret" }]),
    );
    const res = await handlePortalRequest(post("peek_invite", { slug: "acme", token: "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_peek_invite", { p_slug: "acme", p_token: "tok" });
    expect(await res.json()).toEqual({
      invite: { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 },
    });
  });

  it("404s an invalid invite and a missing token", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("peek_invite", { slug: "acme", token: "bad" }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invite" });

    rpc.mockClear();
    const missing = await handlePortalRequest(post("peek_invite", { slug: "acme" }), deps);
    expect(missing.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("accept_invite", () => {
  it("accepts with the terms version and returns a session", async () => {
    const { deps, rpc } = setup(() => ok([{ session_token: "s".repeat(64), session_expires_at: "2026-11-08T00:00:00Z" }]));
    const res = await handlePortalRequest(
      post("accept_invite", { slug: "acme", token: "tok", termsVersion: 2 }, { "x-forwarded-for": "203.0.113.9", "user-agent": "UA" }),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_accept_invite", {
      p_slug: "acme",
      p_token: "tok",
      p_terms_version: 2,
      p_ip: "203.0.113.9",
      p_user_agent: "UA",
    });
    expect(await res.json()).toEqual({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
  });

  it("409s when the terms changed since the partner read them", async () => {
    const { deps } = setup(() => fail("terms_changed"));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok", termsVersion: 1 }), deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "terms_changed" });
  });

  it("404s any other failure", async () => {
    const { deps } = setup(() => fail("invalid_invite"));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok", termsVersion: 1 }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
  });

  it("400s a missing terms version without calling the database", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok" }), deps);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("me", () => {
  it("rejects a Supabase JWT: identity only ever comes from x-portal-session", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(
      post("me", { slug: "acme" }, { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns only the partner name, email and ISO name", async () => {
    const { deps, rpc } = setup(() =>
      ok([
        {
          portal_user_id: "u-1",
          org_id: "o-1",
          partner_id: "p-1",
          partner_name: "Jane",
          user_email: "jane@example.com",
          org_name: "Acme ISO",
          org_slug: "acme",
        },
      ]),
    );
    const res = await handlePortalRequest(post("me", { slug: "acme" }, { "x-portal-session": "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_session_lookup", { p_slug: "acme", p_token: "tok" });
    expect(await res.json()).toEqual({ me: { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" } });
  });

  it("401s a dead session", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("me", { slug: "acme" }, { "x-portal-session": "old" }), deps);
    expect(res.status).toBe(401);
  });
});

describe("sign_out", () => {
  it("revokes the session from the header", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("sign_out", {}, { "x-portal-session": "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_sign_out", { p_token: "tok" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is a no-op without a session", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("sign_out", {}), deps);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("request_code timing and failure hardening", () => {
  const ISSUED = ok([{ code: "123456", recipient: "jane@example.com", org_name: "Acme ISO", org_slug: "acme" }]);
  const req = () => post("request_code", { slug: "acme", email: "jane@example.com" });

  it("returns 200 immediately even when sendEmail never resolves, handing the promise to background", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    sendEmail.mockImplementation(() => new Promise<void>(() => {}));
    const background = vi.fn();
    const res = await handlePortalRequest(req(), { ...deps, background });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(background).toHaveBeenCalledTimes(1);
    expect(background.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("returns 200 when sendEmail rejects, and the background promise does not reject", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    sendEmail.mockRejectedValue(new Error("resend down"));
    const background = vi.fn();
    const res = await handlePortalRequest(req(), { ...deps, background });
    expect(res.status).toBe(200);
    await expect(background.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("does not await or leak a rejection when no background hook is provided", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    sendEmail.mockImplementation(() => new Promise<void>(() => {}));
    const res = await handlePortalRequest(req(), deps);
    expect(res.status).toBe(200);
    sendEmail.mockRejectedValue(new Error("x"));
    const res2 = await handlePortalRequest(req(), deps);
    expect(res2.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("hands background nothing when no email is to be sent", async () => {
    const { deps } = setup(() => ok([]));
    const background = vi.fn();
    await handlePortalRequest(req(), { ...deps, background });
    expect(background).not.toHaveBeenCalled();
  });

  it("passes a null IP when there is no forwarded header", async () => {
    const { deps, rpc } = setup(() => ok([]));
    await handlePortalRequest(req(), deps);
    expect(rpc).toHaveBeenCalledWith("portal_issue_code", { p_slug: "acme", p_email: "jane@example.com", p_ip: null });
  });
});

describe("rpc that throws or rejects", () => {
  function throwing() {
    const rpc = vi.fn(async () => {
      throw new Error("network exploded");
    });
    const deps: PortalApiDeps = { rpc, sendEmail: vi.fn(async () => {}), env: ENV };
    return deps;
  }
  const H = { "x-portal-session": "tok" };

  it("request_code still answers 200 { ok: true }", async () => {
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), throwing());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("verify_code answers 401 invalid_code", async () => {
    const res = await handlePortalRequest(
      post("verify_code", { slug: "acme", email: "jane@example.com", code: "123456" }),
      throwing(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it.each([
    ["brand", { slug: "acme" }, {}],
    ["peek_invite", { slug: "acme", token: "tok" }, {}],
    ["accept_invite", { slug: "acme", token: "tok", termsVersion: 1 }, {}],
    ["me", { slug: "acme" }, H],
    ["sign_out", {}, H],
  ])("%s answers 500 server_error with no detail", async (action, body, headers) => {
    const res = await handlePortalRequest(post(action, body, headers), throwing());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});

describe("length caps (checked before any rpc)", () => {
  const LONG_SLUG = "a".repeat(65);
  const LONG_EMAIL = `${"a".repeat(250)}@x.io`;
  const LONG_TOKEN = "t".repeat(129);
  const SESSION_ROW = [{ session_token: "s", session_expires_at: "2026-11-01T00:00:00Z" }];

  it("brand: an over-long slug answers the generic 404 without the database", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("brand", { slug: LONG_SLUG }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_available" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("request_code: an over-long email or slug still answers the generic 200", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const a = await handlePortalRequest(post("request_code", { slug: "acme", email: LONG_EMAIL }), deps);
    const b = await handlePortalRequest(post("request_code", { slug: LONG_SLUG, email: "a@b.co" }), deps);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
    expect(b.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("verify_code: an over-long code, email or slug answers the generic 401", async () => {
    const { deps, rpc } = setup(() => ok(SESSION_ROW));
    const cases = [
      { slug: "acme", email: "a@b.co", code: "1".repeat(17) },
      { slug: "acme", email: LONG_EMAIL, code: "123456" },
      { slug: LONG_SLUG, email: "a@b.co", code: "123456" },
    ];
    for (const body of cases) {
      const res = await handlePortalRequest(post("verify_code", body), deps);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_code" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("verify_code: spaces do not count toward the code cap", async () => {
    const { deps, rpc } = setup(() => ok(SESSION_ROW));
    const res = await handlePortalRequest(
      post("verify_code", { slug: "acme", email: "a@b.co", code: "1 2 3 4 5 6          " }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("peek_invite: an over-long token answers the generic 404", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("peek_invite", { slug: "acme", token: LONG_TOKEN }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accept_invite: an over-long token or slug answers 400 invalid_body", async () => {
    const { deps, rpc } = setup(() => ok(SESSION_ROW));
    const a = await handlePortalRequest(post("accept_invite", { slug: "acme", token: LONG_TOKEN, termsVersion: 1 }), deps);
    const b = await handlePortalRequest(post("accept_invite", { slug: LONG_SLUG, token: "tok", termsVersion: 1 }), deps);
    expect(a.status).toBe(400);
    expect(await a.json()).toEqual({ error: "invalid_body" });
    expect(b.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("me: an over-long session header answers 401", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("me", { slug: "acme" }, { "x-portal-session": LONG_TOKEN }), deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sign_out: an over-long session header is ignored but still answers ok", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("sign_out", {}, { "x-portal-session": LONG_TOKEN }), deps);
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("truncates the IP to 64 and the user agent to 512 before the rpc", async () => {
    const { deps, rpc } = setup(() => ok(SESSION_ROW));
    await handlePortalRequest(
      post(
        "verify_code",
        { slug: "acme", email: "a@b.co", code: "123456" },
        { "x-forwarded-for": "9".repeat(100), "user-agent": "u".repeat(2000) },
      ),
      deps,
    );
    const args = rpc.mock.calls[0][1];
    expect(String(args.p_ip)).toHaveLength(64);
    expect(String(args.p_user_agent)).toHaveLength(512);
  });
});
