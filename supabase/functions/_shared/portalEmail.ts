/**
 * Partner portal emails (spec 5.8, the Phase 1A subset): the invite and the
 * sign-in code. Built on the shared branded template (emailTemplate.ts).
 *
 * The ISO's name is the sender display name and appears in the copy. Since
 * Phase 1C every portal email is rendered with the ISO's brand (logo or name,
 * color, and the locked "Powered by navigatr" line): see portalEmailBrand and
 * fetchPortalEmailBrand below.
 *
 * Pure, dependency-free TS (no Deno globals) so the app's vitest can verify it,
 * matching the other _shared modules.
 */
import type { EmailBrand, EmailOptions } from "./emailTemplate.ts";

export interface PortalEmail extends EmailOptions {
  subject: string;
}

/**
 * Sender for portal emails: the shared navigatr address with the ISO's name as
 * the display name (spec 5.8). Characters that could break or inject into the
 * From header are removed from the name.
 */
export function portalFromAddress(fromEnv: string, orgName: string): string {
  const match = /<([^<>]+)>/.exec(fromEnv);
  const address = (match ? match[1] : fromEnv).trim();
  const name = orgName.replace(/["<>\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return name ? `"${name}" <${address}>` : address;
}

/** FR-PORT-81: the no-reply Reply-To for sign-in codes, weekly summaries and form confirmations. */
export const DEFAULT_NO_REPLY_ADDRESS = "no-reply@send.getnavigatr.io";

const REPLY_TO_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/;

/** A Reply-To value that is a plain address (no spaces, quotes, angle brackets or line breaks), else null. */
export function safeReplyTo(address: string | null | undefined): string | null {
  const value = typeof address === "string" ? address.trim() : "";
  return REPLY_TO_RE.test(value) ? value : null;
}

/** The no-reply Reply-To: an override when it is a plain address, else the default. */
export function noReplyAddress(configured: string | null | undefined): string {
  return safeReplyTo(configured) ?? DEFAULT_NO_REPLY_ADDRESS;
}

/** The partner portal address for a tenant, optionally with a sub-path. */
export function portalUrl(appBaseUrl: string, slug: string, suffix = ""): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}${suffix}`;
}

/** A portal_api action URL (e.g. the one-click unsubscribe), query values encoded. */
export function portalApiUrl(apiBaseUrl: string, action: string, query: Record<string, string> = {}): string {
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${apiBaseUrl.trim().replace(/\/+$/, "")}/${action}${qs ? `?${qs}` : ""}`;
}

export function portalInviteEmail(args: {
  orgName: string;
  partnerName: string;
  inviteUrl: string;
}): PortalEmail {
  return {
    subject: `${args.orgName} invited you to their referral portal`,
    preheader: `Accept your invite to send referrals to ${args.orgName}.`,
    heading: `Join the ${args.orgName} referral portal`,
    bodyLines: [
      `Hi ${args.partnerName},`,
      `${args.orgName} invited you to their referral portal. You can send them businesses and see how each referral is going.`,
      "This link works once and expires in 7 days.",
    ],
    ctaLabel: "Accept invite",
    ctaUrl: args.inviteUrl,
    footnote: "If you weren't expecting this, you can ignore this email.",
  };
}

export function portalCodeEmail(args: { orgName: string; code: string; signInUrl: string; portalAddressUrl?: string }): PortalEmail {
  return {
    subject: `Your sign-in code for ${args.orgName}`,
    preheader: `Your code is ${args.code}. It expires in 15 minutes.`,
    heading: "Your sign-in code",
    bodyLines: [
      `Enter this code to sign in to the ${args.orgName} referral portal. It expires in 15 minutes.`,
    ],
    code: args.code,
    ctaLabel: "Open the sign-in page",
    ctaUrl: args.signInUrl,
    footnote: "If you didn't ask for this code, you can ignore this email.",
    ...(args.portalAddressUrl ? { portalAddress: { url: args.portalAddressUrl } } : {}),
  };
}

/**
 * The email brand for an ISO from a portal_brand or portal_issue_code row.
 * renderEmail validates the logo URL and the color; this only drops values
 * that are not non-empty strings.
 */
export function portalEmailBrand(
  orgName: string,
  row: { logo_url?: unknown; primary_color?: unknown; show_powered_by?: unknown } | null | undefined,
): EmailBrand {
  const logo = row?.logo_url;
  const color = row?.primary_color;
  return {
    name: orgName,
    logoUrl: typeof logo === "string" && logo !== "" ? logo : null,
    primaryColor: typeof color === "string" && color !== "" ? color : null,
    // Only an explicit false hides the credit (FR-PORT-82): a missing row or field keeps it.
    showPoweredBy: row?.show_powered_by !== false,
  };
}

export type PortalBrandRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Look the ISO's brand up by slug. Never throws: a failed lookup sends the email name-only. */
export async function fetchPortalEmailBrand(rpc: PortalBrandRpc, slug: string, orgName: string): Promise<EmailBrand> {
  try {
    const { data, error } = await rpc("portal_brand", { p_slug: slug });
    if (error) return portalEmailBrand(orgName, null);
    const row = Array.isArray(data) ? data[0] : data;
    return portalEmailBrand(orgName, row !== null && typeof row === "object" ? (row as Record<string, unknown>) : null);
  } catch {
    return portalEmailBrand(orgName, null);
  }
}

/**
 * Confirmation for a public referral form submission (FR-PORT-33). It goes
 * only to the optional "Your email" the sender typed (never to the business
 * contact), which anyone can type, so it carries only the ISO's name and the
 * reference: never the company, notes or other text the
 * submitter wrote (the form must not become a way to send arbitrary text
 * through the ISO's name). No button: there is nothing for the reader to open.
 */
export function portalPublicConfirmationEmail(args: { orgName: string; ref: string }): PortalEmail {
  return {
    subject: `${args.orgName} received your referral`,
    preheader: `Your reference is ${args.ref}.`,
    heading: "Thanks for the referral",
    bodyLines: [
      `${args.orgName} received the details sent through their referral form.`,
      `Your reference is ${args.ref}. Keep it in case you need to follow up.`,
    ],
    footnote: "If you didn't expect this email, you can ignore it.",
  };
}
