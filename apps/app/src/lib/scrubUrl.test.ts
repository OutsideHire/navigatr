import { describe, it, expect } from "vitest";
import { isSensitiveUrlParam, scrubAnalyticsEvent, scrubUrl } from "./scrubUrl";

describe("isSensitiveUrlParam", () => {
  it("flags the named secrets and anything ending in token, key, code or secret", () => {
    for (const k of ["token", "code", "invite", "access_token", "refresh_token", "api_key", "TOKEN"]) {
      expect(isSensitiveUrlParam(k)).toBe(true);
    }
    for (const k of ["page", "tab", "slug", "monkey", "decode_mode"]) {
      expect(isSensitiveUrlParam(k)).toBe(false);
    }
  });
});

describe("scrubUrl", () => {
  it("removes sensitive params from an absolute URL and keeps the rest", () => {
    const out = scrubUrl("https://app.getnavigatr.io/p/acme/invite?token=SECRET&tab=2&invite=X&code=123456");
    expect(out).toBe("https://app.getnavigatr.io/p/acme/invite?tab=2");
  });

  it("drops the ? entirely when nothing is left", () => {
    expect(scrubUrl("https://app.getnavigatr.io/accept-invite?token=SECRET")).toBe(
      "https://app.getnavigatr.io/accept-invite",
    );
  });

  it("keeps a relative path relative", () => {
    expect(scrubUrl("/p/acme/invite?token=SECRET&x=1")).toBe("/p/acme/invite?x=1");
  });

  it("scrubs a fragment that carries query-style secrets", () => {
    expect(scrubUrl("https://app.getnavigatr.io/cb#access_token=abc&type=recovery")).toBe(
      "https://app.getnavigatr.io/cb#type=recovery",
    );
  });

  it("redact mode masks the value instead of removing it", () => {
    const out = scrubUrl("https://app.example/accept-invite?token=SECRET123&page=2", "redact");
    expect(out).toContain("token=%5Bredacted%5D");
    expect(out).not.toContain("SECRET123");
    expect(out).toContain("page=2");
  });

  it("leaves a URL without secrets untouched", () => {
    expect(scrubUrl("https://app.getnavigatr.io/path?tab=2")).toBe("https://app.getnavigatr.io/path?tab=2");
    expect(scrubUrl("/dashboard")).toBe("/dashboard");
  });
});

describe("scrubAnalyticsEvent", () => {
  it("scrubs event.url and keeps every other field", () => {
    const event = { type: "pageview" as const, url: "https://app.getnavigatr.io/p/acme/invite?token=S&tab=1" };
    expect(scrubAnalyticsEvent(event)).toEqual({ type: "pageview", url: "https://app.getnavigatr.io/p/acme/invite?tab=1" });
  });
});
