/**
 * Branded navigatr transactional-email template (Option A / Minimal).
 * Pure, dependency-free TS so the app's vitest can verify it and the Deno
 * edge functions can import it. Returns email-safe HTML (table layout, inline
 * styles, light mode) plus a plain-text alternative. Single source of truth for
 * the look of every transactional email.
 */
export interface EmailOptions {
  /** Hidden inbox-preview line. */
  preheader: string;
  heading: string;
  /** One paragraph per line. */
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** Small footer note (expiry / "wasn't you"). */
  footnote: string;
  /** Optional prominent one-time code (magic-link / OTP), shown above the button. */
  code?: string;
}

const LOGO_URL = "https://app.getnavigatr.io/icons/icon-192x192.png";

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

export function renderEmail(opts: EmailOptions): { html: string; text: string } {
  const bodyHtml = opts.bodyLines
    .map((l) => `<p class="em-body" style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#56607A;">${esc(l)}</p>`)
    .join("");

  const codeHtml = opts.code
    ? `<tr><td style="padding:4px 28px 0;">
        <div style="background:#F0F2F7;border:1px solid #E8EBF2;border-radius:10px;padding:16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#0B1220;">${esc(opts.code)}</div>
      </td></tr>`
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
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${LOGO_URL}" width="30" height="30" alt="" style="display:block;border:0;border-radius:7px;"></td>
          <td style="vertical-align:middle;padding-left:9px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0B1220;letter-spacing:-0.01em;">navigatr</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:12px 28px 4px;">
        <h1 style="margin:0 0 10px;font-size:20px;line-height:1.25;color:#0B1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(opts.heading)}</h1>
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${bodyHtml}</div>
      </td></tr>
      ${codeHtml}
      <tr><td style="padding:8px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:#5856EB;border-radius:9px;">
            <a href="${escUrl(opts.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(opts.ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 24px;">
        <p style="margin:16px 0 0;border-top:1px solid #F0F2F7;padding-top:14px;font-size:11.5px;line-height:1.5;color:#8089A1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          ${esc(opts.footnote)}<br>
          Button not working? Paste this link into your browser:<br>
          <a href="${escUrl(opts.ctaUrl)}" style="color:#5856EB;word-break:break-all;">${escUrl(opts.ctaUrl)}</a>
        </p>
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
    "",
    `${opts.ctaLabel}: ${opts.ctaUrl}`,
    "",
    opts.footnote,
  ].join("\n");

  return { html, text };
}
