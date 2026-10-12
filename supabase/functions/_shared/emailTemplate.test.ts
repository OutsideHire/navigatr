import { describe, it, expect } from "vitest";
import { POWERED_BY, brandAccent, readableTextOn, renderEmail } from "./emailTemplate";

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

describe("renderEmail with a tenant brand", () => {
  const base = {
    preheader: "Acme ISO has your referral.",
    heading: "Acme ISO has your referral",
    bodyLines: ["Thanks for sending Fresh Bakery."],
    ctaLabel: "View referral",
    ctaUrl: "https://app.getnavigatr.io/p/acme/r/r-1",
    footnote: "You're getting this because you send referrals to Acme ISO.",
  };

  it("shows the ISO logo instead of the navigatr mark", () => {
    const { html } = renderEmail({
      ...base,
      brand: { name: "Acme ISO", logoUrl: "https://cdn.example/acme.png", primaryColor: null },
    });
    expect(html).toContain('src="https://cdn.example/acme.png"');
    expect(html).toContain('alt="Acme ISO"');
    expect(html).not.toContain("icons/icon-192x192.png");
    expect(html).not.toContain(">navigatr</td>");
  });

  it("shows the ISO name as text when there is no usable logo", () => {
    for (const logoUrl of [null, "", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const { html } = renderEmail({ ...base, brand: { name: "Acme <ISO>", logoUrl, primaryColor: null } });
      expect(html).toContain("Acme &lt;ISO&gt;</span>");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("data:image");
      expect(html).not.toContain("icons/icon-192x192.png");
    }
  });

  it("uses the ISO color for the button and the footer link, with readable button text", () => {
    const dark = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#0A7C45" } }).html;
    expect(dark).toContain("background:#0A7C45;");
    expect(dark).toContain("color:#0A7C45;word-break:break-all;");
    expect(dark).toContain("color:#FFFFFF;text-decoration:none;");
    expect(dark).not.toContain("#5856EB");

    const light = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#FFD500" } }).html;
    expect(light).toContain("background:#FFD500;");
    expect(light).toContain("color:#0B1220;text-decoration:none;");
  });

  it("falls back to the default color for a color that is not #rrggbb", () => {
    for (const primaryColor of [null, "", "red", "#FFF", "#12345G", "#0A7C45;background:url(x)"]) {
      const { html } = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor } });
      expect(html).toContain("background:#5856EB;");
      expect(html).not.toContain("url(x)");
    }
  });

  it("always adds the locked Powered by line, in html and text", () => {
    const out = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    expect(out.html).toContain(`>${POWERED_BY}</p>`);
    expect(out.text.endsWith(`\n\n${POWERED_BY}`)).toBe(true);
    const plain = renderEmail(base);
    expect(plain.html).not.toContain(POWERED_BY);
    expect(plain.text).not.toContain(POWERED_BY);
  });
});

describe("brandAccent and readableTextOn", () => {
  it("accepts only #rrggbb", () => {
    expect(brandAccent("#0a7c45")).toBe("#0a7c45");
    expect(brandAccent("0A7C45")).toBe("#5856EB");
    expect(brandAccent(undefined)).toBe("#5856EB");
  });

  it("picks the text color with the better contrast", () => {
    expect(readableTextOn("#5856EB")).toBe("#FFFFFF");
    expect(readableTextOn("#000000")).toBe("#FFFFFF");
    expect(readableTextOn("#FFD500")).toBe("#0B1220");
    expect(readableTextOn("#FFFFFF")).toBe("#0B1220");
  });
});
