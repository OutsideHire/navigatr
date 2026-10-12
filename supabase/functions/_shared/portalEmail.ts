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

/** The partner portal address for a tenant, optionally with a sub-path. */
export function portalUrl(appBaseUrl: string, slug: string, suffix = ""): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}${suffix}`;
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

export function portalCodeEmail(args: { orgName: string; code: string; signInUrl: string }): PortalEmail {
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
  };
}

/**
 * The email brand for an ISO from a portal_brand or portal_issue_code row.
 * renderEmail validates the logo URL and the color; this only drops values
 * that are not non-empty strings.
 */
export function portalEmailBrand(
  orgName: string,
  row: { logo_url?: unknown; primary_color?: unknown } | null | undefined,
): EmailBrand {
  const logo = row?.logo_url;
  const color = row?.primary_color;
  return {
    name: orgName,
    logoUrl: typeof logo === "string" && logo !== "" ? logo : null,
    primaryColor: typeof color === "string" && color !== "" ? color : null,
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
