import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalRpcResult } from "./portalApi";

const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api/unsubscribe_digest";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function setup(result: PortalRpcResult = { data: null, error: null }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => result);
  const deps: PortalApiDeps = {
    rpc,
    sendEmail: vi.fn(async () => {}),
    env: { appBaseUrl: "https://app.getnavigatr.io", fromAddress: "n <a@b.co>", appEnv: "production", emailAllowlist: "" },
  };
  return { deps, rpc };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsubscribe_digest", () => {
  it("accepts the one-click POST: query string, form body, no session", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(
      new Request(`${URL_BASE}?slug=ACME&t=${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.7" },
        body: "List-Unsubscribe=One-Click",
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("portal_unsubscribe_digest", { p_slug: "acme", p_token: TOKEN, p_ip: "203.0.113.7" });
  });

  it("accepts the portal page's JSON body", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "acme", token: TOKEN }) }),
      deps,
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("portal_unsubscribe_digest", { p_slug: "acme", p_token: TOKEN, p_ip: "unknown" });
  });

  it("answers the same for a missing, oversized or malformed request, without a database call", async () => {
    const { deps, rpc } = setup();
    for (const req of [
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
      new Request(`${URL_BASE}?slug=acme&t=${"x".repeat(200)}`, { method: "POST", body: "" }),
      new Request(`${URL_BASE}?slug=acme`, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    ]) {
      const res = await handlePortalRequest(req, deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("puts requests with no resolvable client IP into one shared rate-limit bucket", async () => {
    const { deps, rpc } = setup();
    await handlePortalRequest(new Request(`${URL_BASE}?slug=acme&t=${TOKEN}`, { method: "POST", body: "" }), deps);
    expect(rpc.mock.calls[0][1].p_ip).toBe("unknown");
  });

  it("never changes anything on GET (link scanners)", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(new Request(`${URL_BASE}?slug=acme&t=${TOKEN}`, { method: "GET" }), deps);
    expect(res.status).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 500 only when the database fails, and never reads x-portal-session", async () => {
    const { deps } = setup({ data: null, error: { message: "boom" } });
    const res = await handlePortalRequest(
      new Request(`${URL_BASE}?slug=acme&t=${TOKEN}`, { method: "POST", headers: { "x-portal-session": "tok" }, body: "" }),
      deps,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});
