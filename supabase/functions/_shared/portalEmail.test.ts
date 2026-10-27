import { describe, it, expect, vi } from "vitest";
import { fetchPortalEmailBrand, portalCodeEmail, portalEmailBrand, portalFromAddress, portalInviteEmail, portalPublicConfirmationEmail, portalUrl, portalApiUrl, safeReplyTo, noReplyAddress } from "./portalEmail";
import { renderEmail } from "./emailTemplate";

describe("portalFromAddress", () => {
  it("shows the ISO name with the address part of FROM_ADDRESS", () => {
    expect(portalFromAddress("navigatr <invites@send.getnavigatr.io>", "Acme ISO")).toBe(
      '"Acme ISO" <invites@send.getnavigatr.io>',
    );
  });

  it("accepts a bare FROM_ADDRESS", () => {
    expect(portalFromAddress("invites@send.getnavigatr.io", "Acme ISO")).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
  });

  it("strips quotes, angle brackets, backslashes and line breaks from the name", () => {
    expect(portalFromAddress("x <a@b.co>", 'Evil "ISO" <hi>\\\r\nBcc: z@z.co')).toBe('"Evil ISO hi Bcc: z@z.co" <a@b.co>');
  });

  it("falls back to the bare address when nothing is left of the name", () => {
    expect(portalFromAddress("x <a@b.co>", ' "<>" ')).toBe("a@b.co");
  });
});

describe("portalUrl", () => {
  it("joins the base, slug and suffix without a double slash", () => {
    expect(portalUrl("https://app.getnavigatr.io/", "acme")).toBe("https://app.getnavigatr.io/p/acme");
    expect(portalUrl("https://app.getnavigatr.io", "acme", "/invite?token=abc")).toBe(
      "https://app.getnavigatr.io/p/acme/invite?token=abc",
    );
  });
});

describe("portalInviteEmail", () => {
  const e = portalInviteEmail({
    orgName: "Acme ISO",
    partnerName: "Jane",
    inviteUrl: "https://app.getnavigatr.io/p/acme/invite?token=abc",
  });

  it("names the ISO and the partner and links to the invite", () => {
    expect(e.subject).toBe("Acme ISO invited you to their referral portal");
    expect(e.bodyLines.join(" ")).toContain("Hi Jane,");
    expect(e.bodyLines.join(" ")).toContain("Acme ISO");
    expect(e.bodyLines.join(" ")).toContain("7 days");
    expect(e.ctaLabel).toBe("Accept invite");
    expect(e.ctaUrl).toBe("https://app.getnavigatr.io/p/acme/invite?token=abc");
  });

  it("never says navigatr in the subject or body", () => {
    expect(`${e.subject} ${e.preheader} ${e.heading} ${e.bodyLines.join(" ")}`.toLowerCase()).not.toContain("navigatr");
  });

  it("renders through the shared template", () => {
    const { html, text } = renderEmail(e);
    expect(html).toContain("Acme ISO");
    expect(text).toContain("Accept invite: https://app.getnavigatr.io/p/acme/invite?token=abc");
  });
});

describe("portalCodeEmail", () => {
  const e = portalCodeEmail({ orgName: "Acme ISO", code: "042917", signInUrl: "https://app.getnavigatr.io/p/acme" });

  it("carries the code, the expiry and the sign-in page", () => {
    expect(e.subject).toBe("Your sign-in code for Acme ISO");
    expect(e.code).toBe("042917");
    expect(e.preheader).toContain("042917");
    expect(e.bodyLines.join(" ")).toContain("15 minutes");
    expect(e.ctaUrl).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("renders the code prominently", () => {
    const { html, text } = renderEmail(e);
    expect(html).toContain("042917");
    expect(text).toContain("Code: 042917");
  });
});

describe("portalEmailBrand", () => {
  it("takes the logo and color from a branding row", () => {
    expect(portalEmailBrand("Acme ISO", { logo_url: "https://cdn.example/a.png", primary_color: "#0A7C45" })).toEqual({
      name: "Acme ISO",
      logoUrl: "https://cdn.example/a.png",
      primaryColor: "#0A7C45",
    });
  });

  it("is name-only for a missing row or empty fields", () => {
    const none = { name: "Acme ISO", logoUrl: null, primaryColor: null };
    expect(portalEmailBrand("Acme ISO", null)).toEqual(none);
    expect(portalEmailBrand("Acme ISO", { logo_url: "", primary_color: 7 })).toEqual(none);
  });
});

describe("fetchPortalEmailBrand", () => {
  it("reads portal_brand for the slug", async () => {
    const rpc = vi.fn(async () => ({ data: [{ logo_url: "https://cdn.example/a.png", primary_color: "#0A7C45" }], error: null }));
    await expect(fetchPortalEmailBrand(rpc, "acme", "Acme ISO")).resolves.toEqual({
      name: "Acme ISO",
      logoUrl: "https://cdn.example/a.png",
      primaryColor: "#0A7C45",
    });
    expect(rpc).toHaveBeenCalledWith("portal_brand", { p_slug: "acme" });
  });

  it("falls back to the name when the lookup errors, throws, or finds nothing", async () => {
    const none = { name: "Acme ISO", logoUrl: null, primaryColor: null };
    await expect(fetchPortalEmailBrand(async () => ({ data: null, error: { message: "boom" } }), "acme", "Acme ISO")).resolves.toEqual(none);
    await expect(fetchPortalEmailBrand(async () => { throw new Error("down"); }, "acme", "Acme ISO")).resolves.toEqual(none);
    await expect(fetchPortalEmailBrand(async () => ({ data: [], error: null }), "acme", "Acme ISO")).resolves.toEqual(none);
  });
});

describe("portalPublicConfirmationEmail", () => {
  it("names the ISO and the reference, and has no button", () => {
    const email = portalPublicConfirmationEmail({ orgName: "Acme ISO", ref: "REF-1A2B3C4D" });
    expect(email.subject).toBe("Acme ISO received your referral");
    expect(email.ctaLabel).toBeUndefined();
    expect(email.ctaUrl).toBeUndefined();
    const { html, text } = renderEmail({ ...email, brand: portalEmailBrand("Acme ISO", null) });
    expect(text).toContain("REF-1A2B3C4D");
    expect(text).toContain("Acme ISO");
    expect(html).not.toContain("Button not working?");
    expect(`${email.subject} ${text}`).not.toMatch(/\b(submitted|accepted|working|won|lost|declined|withdrawn)\b/);
    expect(text.replace("Powered by navigatr", "")).not.toMatch(/navigatr/i);
  });
  it("escapes an org name with markup characters in the html", () => {
    const orgName = `Ben & Jerry's <b>"ISO"</b>`;
    const email = portalPublicConfirmationEmail({ orgName, ref: "REF-1A2B3C4D" });
    const { html, text } = renderEmail({ ...email, brand: portalEmailBrand(orgName, null) });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain(`"ISO"`);
    expect(html).toContain("Ben &amp; Jerry");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toMatch(/&quot;ISO&quot;|&#34;ISO&#34;|&#x22;ISO&#x22;/);
    // Plain text keeps the name as typed.
    expect(text).toContain(orgName);
  });
});

describe("portalApiUrl", () => {
  it("builds an action URL with encoded query values and no doubled slash", () => {
    expect(portalApiUrl("https://x.supabase.co/functions/v1/portal_api/", "unsubscribe_digest", { slug: "acme co", t: "a/b" })).toBe(
      "https://x.supabase.co/functions/v1/portal_api/unsubscribe_digest?slug=acme%20co&t=a%2Fb",
    );
  });
});

describe("edge sources build portal links through portalUrl only", () => {
  it("no other shared source hand-builds a /p/ link", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = __dirname;
    const offenders = readdirSync(dir).filter(
      (n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "portalEmail.ts" && readFileSync(join(dir, n), "utf8").includes("/p/${"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("portal sign-in address on partner emails (FR-PORT-23)", () => {
  const url = "https://app.getnavigatr.io/p/acme";
  it("the invite and code builders carry the address when given", () => {
    const invite = portalInviteEmail({ orgName: "Acme ISO", partnerName: "Jane", inviteUrl: "https://x.test/i", portalAddressUrl: url });
    const code = portalCodeEmail({ orgName: "Acme ISO", code: "042917", signInUrl: url, portalAddressUrl: url });
    for (const e of [invite, code]) {
      expect(e.portalAddress).toEqual({ url });
      const { html, text } = renderEmail({ ...e, brand: portalEmailBrand("Acme ISO", null) });
      expect(html).toContain("Sign in to your partner portal any time:");
      expect(text).toContain(`Sign in to your partner portal any time: ${url}`);
    }
  });
  it("omits it when no address is given", () => {
    expect(portalInviteEmail({ orgName: "A", partnerName: "J", inviteUrl: "https://x.test/i" }).portalAddress).toBeUndefined();
    expect(portalCodeEmail({ orgName: "A", code: "1", signInUrl: url }).portalAddress).toBeUndefined();
  });
  it("the public-form confirmation never carries it (the reader may have no portal account)", () => {
    const e = portalPublicConfirmationEmail({ orgName: "Acme ISO", ref: "REF-1" });
    expect(e.portalAddress).toBeUndefined();
    const { html, text } = renderEmail({ ...e, brand: portalEmailBrand("Acme ISO", null) });
    expect(html).not.toContain("Sign in to your partner portal");
    expect(text).not.toContain("Sign in to your partner portal");
  });
});

describe("Reply-To helpers (FR-PORT-81)", () => {
  it("accepts a plain address and rejects anything that could inject a header", () => {
    expect(safeReplyTo(" rita@acme.example ")).toBe("rita@acme.example");
    expect(safeReplyTo("rita@acme.example\r\nBcc: x@evil.example")).toBeNull();
    expect(safeReplyTo('"Rita" <rita@acme.example>')).toBeNull();
    expect(safeReplyTo(null)).toBeNull();
    expect(safeReplyTo("")).toBeNull();
  });

  it("falls back to the default no-reply address", () => {
    expect(noReplyAddress(undefined)).toBe("no-reply@send.getnavigatr.io");
    expect(noReplyAddress("bad value")).toBe("no-reply@send.getnavigatr.io");
    expect(noReplyAddress("stop@send.example.com")).toBe("stop@send.example.com");
  });
});
