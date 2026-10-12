import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PORTAL_API_URL, PortalApiError, portalApi } from "./portalApi";

const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as unknown,
  };
}

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portalApi", () => {
  it("POSTs to the action path with the anon key and no session header", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { brand: BRAND }));
    await expect(portalApi.brand("acme")).resolves.toEqual(BRAND);
    const call = lastCall();
    expect(call.url).toBe(`${PORTAL_API_URL}/brand`);
    expect(call.init.method).toBe("POST");
    expect(call.headers.apikey).toBeTruthy();
    expect(call.headers.Authorization).toBe(`Bearer ${call.headers.apikey}`);
    expect(call.headers["x-portal-session"]).toBeUndefined();
    expect(call.body).toEqual({ slug: "acme" });
  });

  it("returns null for an unavailable portal and throws on a server error", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_available" }));
    await expect(portalApi.brand("nope")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(respond(500, { error: "server_error" }));
    await expect(portalApi.brand("acme")).rejects.toMatchObject({ status: 500, code: "server_error" });
  });

  it("requests a code with the slug and email", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.requestCode("acme", "jane@example.com");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/request_code`);
    expect(lastCall().body).toEqual({ slug: "acme", email: "jane@example.com" });
  });

  it("verifies a code and surfaces invalid_code as a PortalApiError", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { sessionToken: "t1", expiresAt: "2026-11-08T00:00:00Z" }));
    await expect(portalApi.verifyCode("acme", "jane@example.com", "123456")).resolves.toEqual({
      sessionToken: "t1",
      expiresAt: "2026-11-08T00:00:00Z",
    });
    expect(lastCall().body).toEqual({ slug: "acme", email: "jane@example.com", code: "123456" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "invalid_code" }));
    const err = await portalApi.verifyCode("acme", "jane@example.com", "000000").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortalApiError);
    expect(err).toMatchObject({ status: 401, code: "invalid_code" });
  });

  it("peeks an invite and returns null when it is no longer valid", async () => {
    const invite = { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 };
    fetchMock.mockResolvedValueOnce(respond(200, { invite }));
    await expect(portalApi.peekInvite("acme", "tok")).resolves.toEqual(invite);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok" });
    fetchMock.mockResolvedValueOnce(respond(404, { error: "invalid_invite" }));
    await expect(portalApi.peekInvite("acme", "old")).resolves.toBeNull();
  });

  it("accepts an invite with the terms version and reports terms_changed", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { sessionToken: "t2", expiresAt: "x" }));
    await portalApi.acceptInvite("acme", "tok", 2);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok", termsVersion: 2 });
    fetchMock.mockResolvedValueOnce(respond(409, { error: "terms_changed" }));
    await expect(portalApi.acceptInvite("acme", "tok", 1)).rejects.toMatchObject({ status: 409, code: "terms_changed" });
  });

  it("sends the session in x-portal-session for me and sign_out", async () => {
    const me = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
    fetchMock.mockResolvedValueOnce(respond(200, { me }));
    await expect(portalApi.me("acme", "sess")).resolves.toEqual(me);
    expect(lastCall().headers["x-portal-session"]).toBe("sess");
    expect(lastCall().body).toEqual({ slug: "acme" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "unauthorized" }));
    await expect(portalApi.me("acme", "dead")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.signOut("sess");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/sign_out`);
    expect(lastCall().headers["x-portal-session"]).toBe("sess");
  });

  it("maps a network failure and a non-JSON error body", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(portalApi.requestCode("acme", "a@b.co")).rejects.toMatchObject({ status: 0, code: "network_error" });
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(portalApi.requestCode("acme", "a@b.co")).rejects.toMatchObject({ status: 502, code: "request_failed" });
  });
});

describe("isPortalTransientError", () => {
  it("treats network failures, 5xx and unknown errors as retryable", async () => {
    const { PortalApiError: E, isPortalTransientError } = await import("./portalApi");
    expect(isPortalTransientError(new E(0, "network_error"))).toBe(true);
    expect(isPortalTransientError(new E(500, "server_error"))).toBe(true);
    expect(isPortalTransientError(new E(503, "request_failed"))).toBe(true);
    expect(isPortalTransientError(new Error("boom"))).toBe(true);
    expect(isPortalTransientError("weird")).toBe(true);
  });

  it("treats real outcomes (4xx) as final", async () => {
    const { PortalApiError: E, isPortalTransientError } = await import("./portalApi");
    for (const status of [400, 401, 404, 409]) {
      expect(isPortalTransientError(new E(status, "x"))).toBe(false);
    }
  });
});

describe("Phase 1B actions", () => {
  it("sends the session header and the slug for every referral action", async () => {
    const { PORTAL_POLL_MS, portalDataKey } = await import("./portalApi");
    expect(PORTAL_POLL_MS).toBe(30_000);
    expect(portalDataKey("acme", "tok", "list", "all")).toEqual(["portal", "data", "acme", "tok", "list", "all"]);

    fetchMock.mockResolvedValueOnce(respond(200, { form: { consentText: "I may share.", consentVersion: 2 } }));
    await expect(portalApi.form("acme", "tok")).resolves.toEqual({ consentText: "I may share.", consentVersion: 2 });
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/form`);
    expect(lastCall().headers["x-portal-session"]).toBe("tok");
    expect(lastCall().body).toEqual({ slug: "acme" });

    fetchMock.mockResolvedValueOnce(respond(200, { probableDuplicate: true }));
    await expect(portalApi.dupCheck("acme", "tok", { companyName: "Co", phone: "555", address: "" })).resolves.toBe(true);
    expect(lastCall().body).toEqual({ slug: "acme", companyName: "Co", phone: "555", address: "" });

    fetchMock.mockResolvedValueOnce(respond(200, { referrals: [] }));
    await expect(portalApi.listReferrals("acme", "tok", "90d")).resolves.toEqual([]);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/list_referrals`);
    expect(lastCall().body).toEqual({ slug: "acme", window: "90d" });

    const dash = { submitted: 1, active: 1, closedWon: 0, conversionRate: null, valueVisible: false };
    fetchMock.mockResolvedValueOnce(respond(200, { dashboard: dash }));
    await expect(portalApi.dashboard("acme", "tok", "all")).resolves.toEqual(dash);

    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.withdrawReferral("acme", "tok", "r-1");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/withdraw_referral`);
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "r-1" });

    fetchMock.mockResolvedValueOnce(respond(200, { text: "Hello" }));
    await expect(portalApi.transcribe("acme", "tok", "YWJj", "audio/webm")).resolves.toBe("Hello");
    expect(lastCall().body).toEqual({ slug: "acme", audio: "YWJj", mime: "audio/webm" });
  });

  it("submits a referral and returns its id and reference", async () => {
    const input = {
      companyName: "Fresh Bakery",
      contactName: "Ann",
      email: "ann@fresh.example",
      phone: "",
      address: "",
      industry: "restaurant",
      urgency: "",
      notes: "",
      consent: true,
      consentVersion: 3,
    };
    fetchMock.mockResolvedValueOnce(respond(200, { referral: { id: "r-9", ref: "REF-AAAA0009" } }));
    await expect(portalApi.submitReferral("acme", "tok", input)).resolves.toEqual({ id: "r-9", ref: "REF-AAAA0009" });
    expect(lastCall().body).toEqual({ slug: "acme", ...input });
  });

  it("carries the field name of a 400 and recognizes a dead session", async () => {
    const { isPortalUnauthorized } = await import("./portalApi");
    fetchMock.mockResolvedValueOnce(respond(400, { error: "invalid_body", field: "emailOrPhone" }));
    const err = await portalApi
      .submitReferral("acme", "tok", {
        companyName: "Co",
        contactName: "A",
        email: "",
        phone: "",
        address: "",
        industry: "",
        urgency: "",
        notes: "",
        consent: true,
        consentVersion: 1,
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "invalid_body", field: "emailOrPhone" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "unauthorized" }));
    const dead = await portalApi.dashboard("acme", "old", "all").catch((e: unknown) => e);
    expect(isPortalUnauthorized(dead)).toBe(true);
    expect(isPortalUnauthorized(new PortalApiError(500, "server_error"))).toBe(false);
    expect(new PortalApiError(500, "server_error").field).toBeNull();
  });

  it("returns null for a referral that is missing or not the partner's", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_found" }));
    await expect(portalApi.getReferral("acme", "tok", "r-x")).resolves.toBeNull();
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "r-x" });
  });
});
