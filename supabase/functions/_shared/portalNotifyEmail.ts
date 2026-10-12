/**
 * Builders for the emails portal_notify sends (Partner Portal Phase 1C, spec
 * 5.8, brief E1, E3 and E7). One builder per outbox kind. The input is the
 * outbox row's payload, built in SQL from an allowlist; it is checked again
 * here, and anything unexpected (an unknown kind, a label that is not a partner
 * label, a label that does not match the kind, a missing field) returns null so
 * the drain drops the row instead of sending it.
 *
 * Partner emails name the ISO and use partner labels only. They never say
 * "navigatr" (the locked "Powered by navigatr" line comes from the template)
 * and never carry an internal status, stage, reason or note. Internal emails go
 * to reps and link into the app.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import type { EmailOptions } from "./emailTemplate.ts";
import { PORTAL_LABELS, type PortalLabel } from "./portalLabels.ts";
import { portalUrl } from "./portalEmail.ts";

export const PARTNER_NOTIFY_KINDS = [
  "partner_received",
  "partner_accepted",
  "partner_not_moving_forward",
  "partner_closed_won",
  "partner_withdrawn",
  "partner_update",
] as const;
export type PartnerNotifyKind = (typeof PARTNER_NOTIFY_KINDS)[number];

export const INTERNAL_NOTIFY_KINDS = ["internal_new_referral", "internal_nudge"] as const;
export type InternalNotifyKind = (typeof INTERNAL_NOTIFY_KINDS)[number];

export type PortalNotifyKind = PartnerNotifyKind | InternalNotifyKind;

/** The label each status email must carry. An update carries whatever the referral shows now. */
export const KIND_LABEL: Readonly<Record<Exclude<PartnerNotifyKind, "partner_update">, PortalLabel>> = Object.freeze({
  partner_received: "Received",
  partner_accepted: "Accepted",
  partner_not_moving_forward: "Not Moving Forward",
  partner_closed_won: "Closed Won",
  partner_withdrawn: "Withdrawn",
});

export interface PartnerNotifyPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  companyName: string;
  ref: string;
  label: PortalLabel;
  valueCents: number | null;
  repName: string | null;
  repEmail: string | null;
  updateBody: string | null;
}

export interface InternalNotifyPayload {
  appUrlPath: string;
  companyNames: string[];
  count: number;
}

export interface PortalNotifyEmail extends EmailOptions {
  subject: string;
  audience: "partner" | "internal";
  /** The ISO's name for the sender display name and the brand; null on internal emails. */
  orgName: string | null;
  /** The assigned rep's business email on partner emails (spec 5.8); otherwise null. */
  replyTo: string | null;
}

export interface NotifyContext {
  appBaseUrl: string;
  /** The outbox row's referral id; the partner link falls back to the portal home without one. */
  referralId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/;
const APP_PATH_RE = /^\/[A-Za-z0-9/_-]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const PARTNER_KEYS = [
  "slug", "orgName", "partnerName", "companyName", "ref", "label",
  "valueCents", "repName", "repEmail", "updateBody",
];
const INTERNAL_KEYS = ["appUrlPath", "companyNames", "count"];

/** The payload carries exactly the keys SQL builds: no more (nothing smuggled in), none missing. */
function hasExactKeys(raw: Record<string, unknown>, keys: string[]): boolean {
  const have = Object.keys(raw);
  return have.length === keys.length && keys.every((k) => k in raw);
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function isLabel(v: unknown): v is PortalLabel {
  return typeof v === "string" && (PORTAL_LABELS as readonly string[]).includes(v);
}

export function parsePartnerPayload(raw: unknown): PartnerNotifyPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, PARTNER_KEYS)) return null;
  const slug = text(raw.slug);
  const orgName = text(raw.orgName);
  const partnerName = text(raw.partnerName);
  const companyName = text(raw.companyName);
  const ref = text(raw.ref);
  if (!slug || !orgName || !partnerName || !companyName || !ref || !isLabel(raw.label)) return null;
  const value = raw.valueCents;
  const repEmail = text(raw.repEmail);
  return {
    slug,
    orgName,
    partnerName,
    companyName,
    ref,
    label: raw.label,
    valueCents: typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null,
    repName: text(raw.repName),
    repEmail: repEmail && EMAIL_RE.test(repEmail) ? repEmail : null,
    updateBody: text(raw.updateBody),
  };
}

export function parseInternalPayload(raw: unknown): InternalNotifyPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, INTERNAL_KEYS)) return null;
  const path = typeof raw.appUrlPath === "string" ? raw.appUrlPath : "";
  if (!APP_PATH_RE.test(path) || path.startsWith("//")) return null;
  if (!Array.isArray(raw.companyNames)) return null;
  const names = raw.companyNames.map(text).filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  const count = typeof raw.count === "number" && Number.isSafeInteger(raw.count) ? raw.count : 0;
  return { appUrlPath: path, companyNames: names, count: Math.max(count, names.length) };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

function contactLine(p: PartnerNotifyPayload): string {
  if (p.repName && p.repEmail) return `${p.repName} at ${p.orgName} is your contact. Reply to this email to reach them.`;
  if (p.repName) return `${p.repName} at ${p.orgName} is your contact.`;
  return `Someone at ${p.orgName} will be in touch.`;
}

function partnerEmail(
  p: PartnerNotifyPayload,
  ctx: NotifyContext,
  parts: { subject: string; preheader: string; heading: string; lines: string[] },
): PortalNotifyEmail {
  const suffix = ctx.referralId && UUID_RE.test(ctx.referralId) ? `/r/${ctx.referralId}` : "/home";
  return {
    subject: parts.subject,
    preheader: parts.preheader,
    heading: parts.heading,
    bodyLines: [`Hi ${p.partnerName},`, ...parts.lines, contactLine(p)],
    ctaLabel: "View referral",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, suffix),
    footnote: `You're getting this because you send referrals to ${p.orgName}. Reference ${p.ref}.`,
    audience: "partner",
    orgName: p.orgName,
    replyTo: p.repEmail,
  };
}

function buildPartner(kind: PartnerNotifyKind, p: PartnerNotifyPayload, ctx: NotifyContext): PortalNotifyEmail | null {
  const iso = p.orgName;
  const co = p.companyName;
  if (kind !== "partner_update" && p.label !== KIND_LABEL[kind]) return null;
  switch (kind) {
    case "partner_received":
      return partnerEmail(p, ctx, {
        subject: `${co}: Received by ${iso}`,
        preheader: `${iso} has your referral ${p.ref}.`,
        heading: `${iso} has your referral`,
        lines: [`Thanks for sending ${co}. ${iso} has it and will review it soon.`],
      });
    case "partner_accepted":
      return partnerEmail(p, ctx, {
        subject: `${co}: Accepted by ${iso}`,
        preheader: `${iso} is moving forward with ${co}.`,
        heading: `${co}: Accepted`,
        lines: [`Good news: ${iso} is moving forward with ${co}.`],
      });
    case "partner_not_moving_forward":
      return partnerEmail(p, ctx, {
        subject: `${co}: Not Moving Forward`,
        preheader: `An update from ${iso} on ${co}.`,
        heading: `${co}: Not Moving Forward`,
        lines: [`${iso} is not moving forward with ${co}. Thank you for thinking of them.`],
      });
    case "partner_closed_won":
      return partnerEmail(p, ctx, {
        subject: `${co}: Closed Won`,
        preheader: `${co} signed with ${iso}.`,
        heading: `${co}: Closed Won`,
        lines: [
          `Great news: ${co} signed with ${iso}. Thank you for the referral.`,
          ...(p.valueCents !== null ? [`Closed value: ${money(p.valueCents)}.`] : []),
        ],
      });
    case "partner_withdrawn":
      return partnerEmail(p, ctx, {
        subject: `${co}: Withdrawn`,
        preheader: `An update from ${iso} on ${co}.`,
        heading: `${co}: Withdrawn`,
        lines: [`${iso} marked ${co} as Withdrawn and will not follow up on it.`],
      });
    case "partner_update": {
      if (!p.updateBody) return null;
      const lines = p.updateBody
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "");
      return partnerEmail(p, ctx, {
        subject: `${co}: an update from ${iso}`,
        preheader: `${p.repName ?? iso} shared an update on ${co}.`,
        heading: `An update on ${co}`,
        lines: [`${p.repName ? `${p.repName} at ${iso}` : iso} shared an update:`, ...lines, `Status: ${p.label}.`],
      });
    }
    default:
      return null;
  }
}

function buildInternal(kind: InternalNotifyKind, p: InternalNotifyPayload, ctx: NotifyContext): PortalNotifyEmail {
  const url = `${ctx.appBaseUrl.replace(/\/+$/, "")}${p.appUrlPath}`;
  if (kind === "internal_new_referral") {
    const name = p.companyNames[0];
    return {
      subject: `New partner referral: ${name}`,
      preheader: `${name} is waiting in Referrals to review.`,
      heading: "New partner referral for you",
      bodyLines: [`A partner sent ${name} through your referral portal.`, "Review it to accept, merge or decline."],
      ctaLabel: "Review referral",
      ctaUrl: url,
      footnote: "You're getting this because partner referrals are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
  const n = p.count;
  const noun = n === 1 ? "partner referral" : "partner referrals";
  const shown = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
  const more = p.companyNames.length > 10 ? [`and ${p.companyNames.length - 10} more`] : [];
  return {
    subject: `${n} ${noun} still waiting for review`,
    preheader: `Received today and still waiting: ${p.companyNames.slice(0, 3).join(", ")}`,
    heading: `${n} ${noun} still waiting`,
    bodyLines: ["These came in through your referral portal today and have not been reviewed yet:", ...shown, ...more],
    ctaLabel: "Review referrals",
    ctaUrl: url,
    footnote: "You get this once, at the end of your day, when partner referrals from today are still waiting.",
    audience: "internal",
    orgName: null,
    replyTo: null,
  };
}

/** The email for one outbox row, or null when the row must be dropped unsent. */
export function buildPortalNotifyEmail(kind: string, payload: unknown, ctx: NotifyContext): PortalNotifyEmail | null {
  if ((PARTNER_NOTIFY_KINDS as readonly string[]).includes(kind)) {
    const p = parsePartnerPayload(payload);
    return p ? buildPartner(kind as PartnerNotifyKind, p, ctx) : null;
  }
  if ((INTERNAL_NOTIFY_KINDS as readonly string[]).includes(kind)) {
    const p = parseInternalPayload(payload);
    return p ? buildInternal(kind as InternalNotifyKind, p, ctx) : null;
  }
  return null;
}
