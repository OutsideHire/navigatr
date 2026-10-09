/**
 * Partner portal emails (spec 5.8, the Phase 1A subset): the invite and the
 * sign-in code. Built on the shared branded template (emailTemplate.ts).
 *
 * The ISO's name is the sender display name and appears in the copy. The
 * template header still shows the navigatr mark until per-tenant email
 * branding lands with the referral emails in Phase 1C.
 *
 * Pure, dependency-free TS (no Deno globals) so the app's vitest can verify it,
 * matching the other _shared modules.
 */
import type { EmailOptions } from "./emailTemplate.ts";

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
