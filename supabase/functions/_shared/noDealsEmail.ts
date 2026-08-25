/**
 * Content builders for the "no deals yet" activation emails, sent by the
 * notify_no_deals cron. Two emails share the branded template (emailTemplate.ts):
 *   - nudgeEmail: to an org administrator, prompting them to add a first deal.
 *   - opsDigestEmail: to the Navigatr operator, a heads-up listing the accounts
 *     that crossed the "active for a few days, still zero deals" line.
 *
 * Pure, dependency-free TS (no Deno globals) so the app's vitest can verify it,
 * matching the other _shared modules.
 */
import type { EmailOptions } from "./emailTemplate.ts";

export interface BuiltEmail extends EmailOptions {
  subject: string;
}

function trimUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

/** Customer nudge to an org admin. */
export function nudgeEmail(orgName: string, appBaseUrl: string): BuiltEmail {
  const url = trimUrl(appBaseUrl);
  return {
    subject: "Add your first deal on navigatr",
    preheader: "Your navigatr pipeline is empty. Add your first deal to get going.",
    heading: "Ready to add your first deal?",
    bodyLines: [
      `Your team at ${orgName} is set up on navigatr, but there are no deals in the pipeline yet.`,
      "Adding your first deal takes under a minute, and it unlocks route planning, follow-ups, and your pipeline reports.",
    ],
    ctaLabel: "Open navigatr",
    ctaUrl: url,
    footnote: "You're receiving this because you're an administrator on this navigatr account.",
  };
}

export interface DeadOrg {
  name: string;
  ageDays: number;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Operator heads-up digest listing accounts with no deals. */
export function opsDigestEmail(orgs: DeadOrg[], appBaseUrl: string): BuiltEmail {
  const url = trimUrl(appBaseUrl);
  const count = orgs.length;
  const noun = plural(count, "account", "accounts");
  const orgLines = orgs.map(
    (o) => `- ${o.name} (${o.ageDays} ${plural(o.ageDays, "day", "days")} old, still no deals)`,
  );
  return {
    subject: `navigatr: ${count} ${noun} with no deals`,
    preheader: `${count} ${noun} have not added a deal yet.`,
    heading: `${count} ${noun} ${plural(count, "hasn't", "haven't")} added a deal`,
    bodyLines: [
      "These accounts have been active for a few days but still have zero deals. They may need a check-in:",
      ...orgLines,
      "Each admin was just sent a one-time nudge to add their first deal.",
    ],
    ctaLabel: "Open navigatr",
    ctaUrl: url,
    footnote: "Automated activation heads-up from navigatr. One notice per account.",
  };
}
