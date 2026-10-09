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
