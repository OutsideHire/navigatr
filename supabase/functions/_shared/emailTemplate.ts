/**
 * Branded navigatr transactional-email template (Option A / Minimal).
 * Pure, dependency-free TS so the app's vitest can verify it and the Deno
 * edge functions can import it. Returns email-safe HTML (table layout, inline
 * styles, light mode) plus a plain-text alternative. Single source of truth for
 * the look of every transactional email.
 *
 * Partner Portal Phase 1C (spec 5.8): an optional per-tenant brand. With a
 * brand, the header shows the ISO's logo (or its name), the button and links
 * use the ISO's color, and a small "Powered by navigatr" line closes the
 * footer (locked on, like the app footer since white-label v2). Without a
 * brand the output is byte-identical to before
 * (emailTemplate.snapshot.test.ts).
 */
export interface EmailBrand {
  /** The ISO's name: the header text when there is no logo, and the logo's alt text. */
  name: string;
  /** Public https URL of the ISO's logo (org_branding.logo_url); anything else falls back to the name. */
  logoUrl: string | null;
  /** #rrggbb button and link color (org_branding.primary_color). */
  primaryColor: string | null;
}

export interface EmailOptions {
  /** Hidden inbox-preview line. */
  preheader: string;
  heading: string;
  /** One paragraph per line. */
  bodyLines: string[];
  /** Button label. A button shows only when both ctaLabel and ctaUrl are set. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Small footer note (expiry / "wasn't you"). */
  footnote: string;
  /** Optional prominent one-time code (magic-link / OTP), shown above the button. */
  code?: string;
  /** Per-tenant branding (partner emails). Absent = the navigatr look, unchanged. */
  brand?: EmailBrand;
  /** Optional link under the footnote (the weekly summary's unsubscribe link). Absent: output unchanged. */
  footerLink?: { label: string; url: string };
}

const LOGO_URL = "https://app.getnavigatr.io/icons/icon-192x192.png";
const DEFAULT_ACCENT = "#5856EB";
const DEFAULT_ACCENT_TEXT = "#FFFFFF";
const DARK_TEXT = "#0B1220";

/** The locked credit line on every branded email. */
export const POWERED_BY = "Powered by navigatr";

const DEFAULT_HEADER = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${LOGO_URL}" width="30" height="30" alt="" style="display:block;border:0;border-radius:7px;"></td>
          <td style="vertical-align:middle;padding-left:9px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0B1220;letter-spacing:-0.01em;">navigatr</td>
        </tr></table>`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// URLs are interpolated without ampersand-escaping (query strings routinely
// carry raw "&") but still guard against attribute/tag breakout.
function escUrl(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The brand color when it is a #rrggbb hex, else the navigatr default. */
export function brandAccent(color: string | null | undefined): string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** White or near-black button text, whichever contrasts better with the color (WCAG luminance). */
export function readableTextOn(hex: string): "#FFFFFF" | "#0B1220" {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  // #0B1220 has a relative luminance of about 0.0061.
  const onWhiteText = 1.05 / (lum + 0.05);
  const onDarkText = (lum + 0.05) / 0.0561;
  return onDarkText > onWhiteText ? DARK_TEXT : "#FFFFFF";
}

function brandHeader(brand: EmailBrand): string {
  const logo = typeof brand.logoUrl === "string" ? brand.logoUrl.trim() : "";
  if (/^https:\/\/\S+$/i.test(logo)) {
    return `<img src="${escUrl(logo)}" height="32" alt="${esc(brand.name)}" style="display:block;border:0;height:32px;width:auto;max-width:200px;">`;
  }
  return `<span style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0B1220;letter-spacing:-0.01em;">${esc(brand.name)}</span>`;
}

export function renderEmail(opts: EmailOptions): { html: string; text: string } {
  const brand = opts.brand;
  const header = brand ? brandHeader(brand) : DEFAULT_HEADER;
  const accent = brand ? brandAccent(brand.primaryColor) : DEFAULT_ACCENT;
  const accentText = brand ? readableTextOn(accent) : DEFAULT_ACCENT_TEXT;
  const poweredBy = brand
    ? `\n        <p style="margin:12px 0 0;font-size:11px;line-height:1.4;color:#A0A7B8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${POWERED_BY}</p>`
    : "";

  const bodyHtml = opts.bodyLines
    .map((l) => `<p class="em-body" style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#56607A;">${esc(l)}</p>`)
    .join("");

  const codeHtml = opts.code
    ? `<tr><td style="padding:4px 28px 0;">
        <div style="background:#F0F2F7;border:1px solid #E8EBF2;border-radius:10px;padding:16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#0B1220;">${esc(opts.code)}</div>
      </td></tr>`
    : "";

  const ctaLabel = opts.ctaLabel ?? "";
  const ctaUrl = opts.ctaUrl ?? "";
  const hasCta = ctaLabel !== "" && ctaUrl !== "";
  const ctaHtml = hasCta
    ? `<tr><td style="padding:8px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:${accent};border-radius:9px;">
            <a href="${escUrl(ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${accentText};text-decoration:none;">${esc(ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>`
    : "";
  const ctaFallback = hasCta
    ? `<br>
          Button not working? Paste this link into your browser:<br>
          <a href="${escUrl(ctaUrl)}" style="color:${accent};word-break:break-all;">${escUrl(ctaUrl)}</a>`
    : "";

  const footerLinkHtml = opts.footerLink
    ? `<br>
          <a href="${escUrl(opts.footerLink.url)}" style="color:#8089A1;text-decoration:underline;">${esc(opts.footerLink.label)}</a>`
    : "";

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F7F8FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8FB;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E8EBF2;border-radius:14px;">
      <tr><td style="padding:24px 28px 8px;">
        ${header}
      </td></tr>
      <tr><td style="padding:12px 28px 4px;">
        <h1 style="margin:0 0 10px;font-size:20px;line-height:1.25;color:#0B1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(opts.heading)}</h1>
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${bodyHtml}</div>
      </td></tr>
      ${codeHtml}
      ${ctaHtml}
      <tr><td style="padding:18px 28px 24px;">
        <p style="margin:16px 0 0;border-top:1px solid #F0F2F7;padding-top:14px;font-size:11.5px;line-height:1.5;color:#8089A1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          ${esc(opts.footnote)}${footerLinkHtml}${ctaFallback}
        </p>${poweredBy}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    opts.heading,
    "",
    ...opts.bodyLines,
    ...(opts.code ? ["", `Code: ${opts.code}`] : []),
    ...(hasCta ? ["", `${ctaLabel}: ${ctaUrl}`] : []),
    "",
    opts.footnote,
    ...(opts.footerLink ? [`${opts.footerLink.label}: ${opts.footerLink.url}`] : []),
    ...(brand ? ["", POWERED_BY] : []),
  ].join("\n");

  return { html, text };
}
