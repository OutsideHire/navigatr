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

  it("rejects a plain http logo and falls back to the ISO name", () => {
    const { html } = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: "http://cdn.example/acme.png", primaryColor: null } });
    expect(html).not.toContain("<img src=\"http://cdn.example/acme.png\"");
    expect(html).not.toContain("http://cdn.example");
    expect(html).toContain("Acme ISO</span>");
  });

  it("escapes a quote in the logo URL so it cannot add an attribute", () => {
    const { html } = renderEmail({
      ...base,
      brand: { name: "Acme ISO", logoUrl: 'https://cdn.example/a.png"onerror="x', primaryColor: null },
    });
    expect(html).toContain('src="https://cdn.example/a.png&quot;onerror=&quot;x"');
    expect(html).not.toContain('onerror="');
  });

  it("escapes a double quote in the brand name used as the logo alt", () => {
    const { html } = renderEmail({
      ...base,
      brand: { name: 'Acme "Best" ISO', logoUrl: "https://cdn.example/acme.png", primaryColor: null },
    });
    expect(html).toContain('alt="Acme &quot;Best&quot; ISO"');
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

describe("renderEmail without a button", () => {
  const noButton = {
    preheader: "Your reference is REF-1A2B3C4D.",
    heading: "Thanks for the referral",
    bodyLines: ["Acme ISO received the details sent through their referral form."],
    footnote: "If you didn't expect this email, you can ignore it.",
    brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#0f766e" },
  };

  it("drops the button, the fallback link and the text link line", () => {
    const out = renderEmail(noButton);
    expect(out.html).not.toContain("Button not working?");
    expect(out.html).not.toContain("<a href=");
    expect(out.html).toContain("Thanks for the referral");
    expect(out.html).toContain("If you didn't expect this email, you can ignore it.");
    expect(out.html).toContain(POWERED_BY);
    expect(out.text).toBe(
      [
        "Thanks for the referral",
        "",
        "Acme ISO received the details sent through their referral form.",
        "",
        "If you didn't expect this email, you can ignore it.",
        "",
        POWERED_BY,
      ].join("\n"),
    );
  });

  it("needs both a label and a url to show a button", () => {
    expect(renderEmail({ ...noButton, ctaLabel: "Open" }).html).not.toContain("Button not working?");
    expect(renderEmail({ ...noButton, ctaUrl: "https://x.example" }).html).not.toContain("Button not working?");
    expect(renderEmail({ ...noButton, ctaLabel: "Open", ctaUrl: "https://x.example" }).html).toContain(
      "Button not working?",
    );
  });
});

describe("renderEmail footerLink", () => {
  const BASE_OPTS = {
    preheader: "p",
    heading: "h",
    bodyLines: ["one"],
    footnote: "You get this weekly.",
  };

  it("renders the link under the footnote, escaped, and as a text line", () => {
    const { html, text } = renderEmail({
      ...BASE_OPTS,
      footerLink: { label: "Unsubscribe <now>", url: 'https://x.example/u?t=a&b="c"' },
    });
    expect(html).toContain('<a href="https://x.example/u?t=a&b=&quot;c&quot;"');
    expect(html).toContain("Unsubscribe &lt;now&gt;</a>");
    expect(text).toContain('Unsubscribe <now>: https://x.example/u?t=a&b="c"');
    expect(text.indexOf("You get this weekly.")).toBeLessThan(text.indexOf("Unsubscribe <now>"));
  });

  it("changes nothing when absent", () => {
    expect(renderEmail({ ...BASE_OPTS, footerLink: undefined })).toEqual(renderEmail(BASE_OPTS));
  });
});

describe("renderEmail portal sign-in address (FR-PORT-23)", () => {
  const base = {
    preheader: "p",
    heading: "h",
    bodyLines: ["b"],
    footnote: "f",
  };
  const brand = { name: "Acme ISO", logoUrl: null, primaryColor: null };
  const LINE = "Sign in to your partner portal any time:";

  it("shows the line above Powered by, in html and text", () => {
    const out = renderEmail({ ...base, brand, portalAddress: { url: "https://app.getnavigatr.io/p/acme" } });
    expect(out.html).toContain(`${LINE} <a href="https://app.getnavigatr.io/p/acme"`);
    expect(out.html.indexOf(LINE)).toBeLessThan(out.html.indexOf(POWERED_BY));
    expect(out.text).toContain(`${LINE} https://app.getnavigatr.io/p/acme`);
    expect(out.text.indexOf(LINE)).toBeLessThan(out.text.indexOf(POWERED_BY));
  });

  it("escapes the url in the html", () => {
    const out = renderEmail({ ...base, brand, portalAddress: { url: 'https://x.test/p/a"><script>' } });
    expect(out.html).not.toContain("<script>");
  });

  it("is ignored without a brand: unbranded output is unchanged", () => {
    const plain = renderEmail(base);
    const withAddr = renderEmail({ ...base, portalAddress: { url: "https://app.getnavigatr.io/p/acme" } });
    expect(withAddr).toEqual(plain);
  });

  it("is absent when no portalAddress is given", () => {
    expect(renderEmail({ ...base, brand }).html).not.toContain(LINE);
  });
});
