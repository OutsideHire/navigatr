import { describe, it, expect } from "vitest";
import { authEmailContent, buildVerifyUrl } from "./authEmail";

describe("authEmailContent", () => {
  it("maps signup to confirm wording", () => {
    const c = authEmailContent("signup");
    expect(c.subject).toMatch(/confirm/i);
    expect(c.heading).toMatch(/confirm/i);
    expect(c.ctaLabel).toMatch(/confirm/i);
  });
  it("maps recovery to reset-password wording", () => {
    const c = authEmailContent("recovery");
    expect(c.subject).toMatch(/reset/i);
    expect(c.ctaLabel).toMatch(/reset/i);
  });
  it("maps magiclink to sign-in wording", () => {
    const c = authEmailContent("magiclink");
    expect(c.subject).toMatch(/sign.?in/i);
    expect(c.ctaLabel).toMatch(/sign in/i);
  });
  it("falls back safely for an unknown action type", () => {
    const c = authEmailContent("something_else");
    expect(c.subject.length).toBeGreaterThan(0);
    expect(c.ctaLabel.length).toBeGreaterThan(0);
  });
});

describe("buildVerifyUrl", () => {
  it("builds the Supabase verify url with encoded redirect", () => {
    const url = buildVerifyUrl({
      siteUrl: "https://xyz.supabase.co",
      tokenHash: "abc123",
      type: "magiclink",
      redirectTo: "https://app.getnavigatr.io/auth/callback",
    });
    expect(url).toBe(
      "https://xyz.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https%3A%2F%2Fapp.getnavigatr.io%2Fauth%2Fcallback",
    );
  });
  it("omits redirect_to when not provided", () => {
    const url = buildVerifyUrl({ siteUrl: "https://s.co", tokenHash: "t", type: "signup", redirectTo: "" });
    expect(url).toBe("https://s.co/auth/v1/verify?token=t&type=signup");
  });
});
