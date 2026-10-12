/**
 * Byte-for-byte guard for the default (unbranded) email template. Every
 * existing caller (send_invite_email, send_auth_email, notify_no_deals) passes
 * no brand, so these files must never change. They were written by the first
 * run, before the brand option existed (Partner Portal Phase 1C).
 */
import { describe, it, expect } from "vitest";
import { renderEmail, type EmailOptions } from "./emailTemplate";

const CASES: Record<string, EmailOptions> = {
  auth: {
    preheader: "Sign in to navigatr",
    heading: "Sign in to navigatr",
    bodyLines: ["Tap the button below to sign in.", "This link expires in 60 minutes."],
    ctaLabel: "Sign in to navigatr",
    ctaUrl: "https://app.getnavigatr.io/auth/v1/verify?token=abc&type=magiclink",
    footnote: "If this wasn't you, you can ignore this email.",
  },
  code: {
    preheader: "Your code is 042917. It expires in 15 minutes.",
    heading: "Your sign-in code",
    bodyLines: ["Enter this code to sign in to the Acme ISO referral portal. It expires in 15 minutes."],
    code: "042917",
    ctaLabel: "Open the sign-in page",
    ctaUrl: "https://app.getnavigatr.io/p/acme",
    footnote: "If you didn't ask for this code, you can ignore this email.",
  },
  escaped: {
    preheader: `Quotes " and <tags> & more`,
    heading: `Hi <b>"Team"</b> & co`,
    bodyLines: ["Line with <script>alert(1)</script>", "- A list line", ""],
    ctaLabel: "Open & go",
    ctaUrl: `https://app.getnavigatr.io/x?a=1&b="2"<3>`,
    footnote: "Footnote with 'quotes' & <angles>",
  },
};

describe("renderEmail default template stays byte-identical", () => {
  for (const [name, opts] of Object.entries(CASES)) {
    it(`${name}: html and text`, async () => {
      const { html, text } = renderEmail(opts);
      await expect(html).toMatchFileSnapshot(`./__snapshots__/emailTemplate.${name}.html`);
      await expect(text).toMatchFileSnapshot(`./__snapshots__/emailTemplate.${name}.txt`);
    });
  }
});
