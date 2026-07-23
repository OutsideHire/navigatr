import { describe, it, expect } from "vitest";
import { renderEmail } from "./emailTemplate";

describe("renderEmail", () => {
  const base = {
    preheader: "Sign in to navigatr",
    heading: "Sign in to navigatr",
    bodyLines: ["Tap the button below to sign in.", "This link expires in 60 minutes."],
    ctaLabel: "Sign in to navigatr",
    ctaUrl: "https://app.getnavigatr.io/auth/v1/verify?token=abc&type=magiclink",
    footnote: "If this wasn't you, you can ignore this email.",
  };

  it("returns both html and text", () => {
    const out = renderEmail(base);
    expect(typeof out.html).toBe("string");
    expect(typeof out.text).toBe("string");
  });

  it("includes heading, body lines, cta label and url, and footnote in the html", () => {
    const out = renderEmail(base);
    expect(out.html).toContain("Sign in to navigatr");
    expect(out.html).toContain("Tap the button below to sign in.");
    expect(out.html).toContain("This link expires in 60 minutes.");
    expect(out.html).toContain(base.ctaUrl);
    expect(out.html).toContain("If this wasn't you");
    expect(out.html).toContain("#5856EB");
  });

  it("puts the cta url and body into the plain-text version", () => {
    const out = renderEmail(base);
    expect(out.text).toContain(base.ctaUrl);
    expect(out.text).toContain("Tap the button below to sign in.");
    expect(out.text).toContain("If this wasn't you");
  });

  it("escapes HTML in interpolated values to prevent injection", () => {
    const out = renderEmail({ ...base, heading: "Hi <script>alert(1)</script>" });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("renders each body line as its own paragraph", () => {
    const out = renderEmail(base);
    const bodyMatches = out.html.match(/class="em-body"/g) ?? [];
    expect(bodyMatches.length).toBe(2);
  });

  it("renders a prominent code block when a code is given, and omits it otherwise", () => {
    const withCode = renderEmail({ ...base, code: "482913" });
    expect(withCode.html).toContain("482913");
    expect(withCode.text).toContain("Code: 482913");
    const without = renderEmail(base);
    expect(without.html).not.toContain("482913");
    expect(without.text).not.toContain("Code:");
  });
});
