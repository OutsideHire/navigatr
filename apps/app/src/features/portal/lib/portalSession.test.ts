import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearPortalSession, portalSessionKey, readPortalSession, writePortalSession } from "./portalSession";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPortalSession("acme");
  clearPortalSession("beta");
});

describe("portal session storage", () => {
  it("keeps one session per slug under a portal-only key", () => {
    writePortalSession("acme", "t1");
    writePortalSession("beta", "t2");
    expect(portalSessionKey("acme")).toBe("navigatr-portal-session:acme");
    expect(localStorage.getItem("navigatr-portal-session:acme")).toBe("t1");
    expect(readPortalSession("beta")).toBe("t2");
    expect(Object.keys(localStorage).every((k) => k.startsWith("navigatr-portal-session:"))).toBe(true);
  });

  it("clears a session", () => {
    writePortalSession("acme", "t1");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readPortalSession("acme")).toBeNull();
  });

  it("falls back to memory when storage throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writePortalSession("acme", "t3");
    expect(readPortalSession("acme")).toBe("t3");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });
});
