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
 * Two Phase 2B-3 partner kinds (referral sent to you, weekly summary) carry
 * their own payloads; only the weekly summary has an unsubscribe link and
 * headers (FR-PORT-84).
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

export const INTERNAL_NOTIFY_KINDS = [
  "internal_new_referral",
  "internal_nudge",
  "internal_reinstate_available",
  "internal_new_submission",
  "internal_partner_note",
] as const;
export type InternalNotifyKind = (typeof INTERNAL_NOTIFY_KINDS)[number];

export type PortalNotifyKind = PartnerNotifyKind | InternalNotifyKind;

/** Phase 2B-3 partner kinds. Kept out of PARTNER_NOTIFY_KINDS: their payloads have no status label. */
export const PARTNER_SENT_KIND = "partner_referral_sent";
export const PARTNER_DIGEST_KIND = "partner_digest";
/** The digest item label for a referral the ISO sent to the partner. */
export const DIGEST_SENT_LABEL = "Sent to you";

export interface PartnerSentPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  companyName: string;
  ref: string;
  repName: string | null;
  repEmail: string | null;
  /** Only a note the rep wrote for the partner (partner_note_visible); null otherwise. */
  note: string | null;
}

export interface PartnerDigestCounts {
  submitted: number;
  accepted: number;
  inProgress: number;
  closedWon: number;
  notMovingForward: number;
  sentToYou: number;
}

export interface PartnerDigestItem {
  companyName: string;
  label: PortalLabel | typeof DIGEST_SENT_LABEL;
}

export interface PartnerDigestPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  weekLabel: string;
  counts: PartnerDigestCounts;
  valueCents: number | null;
  items: PartnerDigestItem[];
  unsubscribeToken: string;
}

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
  /** Extra mail headers; only the weekly summary sets them (List-Unsubscribe, FR-PORT-84). */
  headers?: Record<string, string>;
}

export interface NotifyContext {
  appBaseUrl: string;
  /** The outbox row's referral id; the partner link falls back to the portal home without one. */
  referralId: string | null;
  /** The portal_api function URL, for the digest's one-click unsubscribe header. Without it no digest builds. */
  portalApiUrl?: string;
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

/** Single-line text: CR, LF and tabs become single spaces so a value can sit in a subject line. */
function line(v: unknown): string | null {
  return typeof v === "string" ? text(v.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ")) : null;
}

function isLabel(v: unknown): v is PortalLabel {
  return typeof v === "string" && (PORTAL_LABELS as readonly string[]).includes(v);
}

export function parsePartnerPayload(raw: unknown): PartnerNotifyPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, PARTNER_KEYS)) return null;
  const slug = line(raw.slug);
  const orgName = line(raw.orgName);
  const partnerName = line(raw.partnerName);
  const companyName = line(raw.companyName);
  const ref = line(raw.ref);
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
    repName: line(raw.repName),
    repEmail: repEmail && EMAIL_RE.test(repEmail) ? repEmail : null,
    updateBody: text(raw.updateBody),
  };
}

export function parseInternalPayload(raw: unknown): InternalNotifyPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, INTERNAL_KEYS)) return null;
  const path = typeof raw.appUrlPath === "string" ? raw.appUrlPath : "";
  if (!APP_PATH_RE.test(path) || path.startsWith("//")) return null;
  if (!Array.isArray(raw.companyNames)) return null;
  const names = raw.companyNames.map(line).filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  const count = typeof raw.count === "number" && Number.isSafeInteger(raw.count) ? raw.count : 0;
  return { appUrlPath: path, companyNames: names, count: Math.max(count, names.length) };
}

const SENT_KEYS = ["slug", "orgName", "partnerName", "companyName", "ref", "repName", "repEmail", "note"];
const DIGEST_KEYS = ["slug", "orgName", "partnerName", "weekLabel", "counts", "valueCents", "items", "unsubscribeToken"];
const COUNT_KEYS = ["submitted", "accepted", "inProgress", "closedWon", "notMovingForward", "sentToYou"] as const;
const DIGEST_ITEM_KEYS = ["companyName", "label"];
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function parseSentPayload(raw: unknown): PartnerSentPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, SENT_KEYS)) return null;
  const slug = line(raw.slug);
  const orgName = line(raw.orgName);
  const partnerName = line(raw.partnerName);
  const companyName = line(raw.companyName);
  const ref = line(raw.ref);
  if (!slug || !orgName || !partnerName || !companyName || !ref) return null;
  const repEmail = text(raw.repEmail);
  return {
    slug,
    orgName,
    partnerName,
    companyName,
    ref,
    repName: line(raw.repName),
    repEmail: repEmail && EMAIL_RE.test(repEmail) ? repEmail : null,
    note: text(raw.note),
  };
}

export function parseDigestPayload(raw: unknown): PartnerDigestPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, DIGEST_KEYS)) return null;
  const slug = line(raw.slug);
  const orgName = line(raw.orgName);
  const partnerName = line(raw.partnerName);
  const weekLabel = line(raw.weekLabel);
  if (!slug || !orgName || !partnerName || !weekLabel) return null;
  const token = raw.unsubscribeToken;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;

  const rawCounts = raw.counts;
  if (!isRecord(rawCounts) || !hasExactKeys(rawCounts, [...COUNT_KEYS])) return null;
  const counts: Record<string, number> = {};
  for (const key of COUNT_KEYS) {
    const v = rawCounts[key];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    counts[key] = v;
  }

  if (!Array.isArray(raw.items) || raw.items.length > 10) return null;
  const items: PartnerDigestItem[] = [];
  for (const item of raw.items) {
    if (!isRecord(item) || !hasExactKeys(item, DIGEST_ITEM_KEYS)) return null;
    const companyName = line(item.companyName);
    const label = item.label;
    if (!companyName || !(isLabel(label) || label === DIGEST_SENT_LABEL)) return null;
    items.push({ companyName, label: label as PartnerDigestItem["label"] });
  }

  const value = raw.valueCents;
  return {
    slug,
    orgName,
    partnerName,
    weekLabel,
    counts: counts as unknown as PartnerDigestCounts,
    valueCents: typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null,
    items,
    unsubscribeToken: token,
  };
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

function noteLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function buildSent(p: PartnerSentPayload, ctx: NotifyContext): PortalNotifyEmail {
  const suffix = ctx.referralId && UUID_RE.test(ctx.referralId) ? `/s/${ctx.referralId}` : "/home";
  const sender = p.repName ? `${p.repName} at ${p.orgName}` : p.orgName;
  const reach =
    p.repName && p.repEmail
      ? `Reply to this email to reach ${p.repName}.`
      : p.repEmail
        ? "Reply to this email to reach them."
        : `Someone at ${p.orgName} can tell you more.`;
  return {
    subject: `${p.orgName} sent you a referral: ${p.companyName}`,
    preheader: `${sender} sent you ${p.companyName}.`,
    heading: `${p.orgName} sent you a referral`,
    bodyLines: [
      `Hi ${p.partnerName},`,
      `${sender} sent you ${p.companyName}. Open it to see the contact details.`,
      ...(p.note ? [`${p.repName ?? p.orgName} added a note:`, ...noteLines(p.note)] : []),
      reach,
    ],
    ctaLabel: "View referral",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, suffix),
    footnote: `You're getting this because ${p.orgName} sent you a referral. Reference ${p.ref}.`,
    audience: "partner",
    orgName: p.orgName,
    replyTo: p.repEmail,
  };
}

function buildDigest(p: PartnerDigestPayload, ctx: NotifyContext): PortalNotifyEmail | null {
  const api = typeof ctx.portalApiUrl === "string" ? ctx.portalApiUrl.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/\S+$/.test(api)) return null;
  const c = p.counts;
  if (c.submitted + c.accepted + c.inProgress + c.closedWon + c.notMovingForward + c.sentToYou === 0) return null;

  const token = encodeURIComponent(p.unsubscribeToken);
  const oneClick = `${api}/unsubscribe_digest?slug=${encodeURIComponent(p.slug)}&t=${token}`;
  const lines = [
    c.submitted > 0 ? `New referrals you sent: ${c.submitted}` : null,
    c.accepted > 0 ? `Accepted: ${c.accepted}` : null,
    c.inProgress > 0 ? `In Progress: ${c.inProgress}` : null,
    c.closedWon > 0 ? `Closed Won: ${c.closedWon}${p.valueCents !== null ? ` (${money(p.valueCents)})` : ""}` : null,
    c.notMovingForward > 0 ? `Not Moving Forward: ${c.notMovingForward}` : null,
    c.sentToYou > 0 ? `${p.orgName} sent you: ${c.sentToYou}` : null,
  ].filter((l): l is string => l !== null);
  const items = p.items.map((i) => `- ${i.companyName}: ${i.label}`);

  return {
    subject: `Your weekly referral summary from ${p.orgName}`,
    preheader: `Your referrals with ${p.orgName}, the week of ${p.weekLabel}.`,
    heading: `Your week with ${p.orgName}`,
    bodyLines: [
      `Hi ${p.partnerName},`,
      `Here's what happened with your referrals the week of ${p.weekLabel}.`,
      ...lines,
      ...(items.length > 0 ? ["Recent activity:", ...items] : []),
    ],
    ctaLabel: "Open your referrals",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, "/home"),
    footnote: `You're getting this weekly summary because you send referrals to ${p.orgName}. You can turn it off in your profile.`,
    footerLink: {
      label: "Unsubscribe from the weekly summary",
      url: portalUrl(ctx.appBaseUrl, p.slug, `/unsubscribe?t=${token}`),
    },
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    audience: "partner",
    orgName: p.orgName,
    replyTo: null,
  };
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
  if (kind === "internal_new_submission") {
    const name = p.companyNames[0];
    return {
      subject: `New referral from your form: ${name}`,
      preheader: `${name} is waiting in Referrals to review.`,
      heading: "New referral from your referral form",
      bodyLines: [
        `Someone sent ${name} through your referral form.`,
        "Review it to say who sent it, then accept, merge or decline.",
      ],
      ctaLabel: "Review referral",
      ctaUrl: url,
      footnote: "You're getting this because referral form submissions are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
  if (kind === "internal_partner_note") {
    const name = p.companyNames[0];
    return {
      subject: `New partner note: ${name}`,
      preheader: `A partner wrote back about ${name}.`,
      heading: "A partner wrote back",
      bodyLines: [`The partner you sent ${name} to left a note on it.`, "Open it to read the note."],
      ctaLabel: "Read the note",
      ctaUrl: url,
      footnote: "You're getting this because you sent this referral to a partner.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
  if (kind === "internal_reinstate_available") {
    const count = p.count;
    const first = p.companyNames[0];
    const listed = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
    const rest = count > listed.length ? [`and ${count - listed.length} more`] : [];
    return {
      subject: count === 1 ? `You can reinstate ${first}` : `${count} declined duplicates can be reinstated`,
      preheader:
        count === 1
          ? `The earlier referral for ${first} is closed.`
          : "The earlier referrals for these businesses are closed.",
      heading: count === 1 ? "A declined duplicate can come back" : "Declined duplicates can come back",
      bodyLines:
        count === 1
          ? [
              `${first} was declined as a duplicate of an earlier referral. That earlier referral is now closed, so ${first} can be reinstated.`,
              "Open the partner to reinstate it, or leave it declined.",
            ]
          : [
              "These were declined as duplicates of an earlier referral that is now closed, so they can be reinstated:",
              ...listed,
              ...rest,
              "Open the partner to reinstate them, or leave them declined.",
            ],
      ctaLabel: "Open partner",
      ctaUrl: url,
      footnote: "You're getting this because partner referrals are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
  // One digest lists partner referrals and form submissions together (2B-2).
  const n = p.count;
  const noun = n === 1 ? "referral" : "referrals";
  const shown = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
  const more = p.count > shown.length ? [`and ${p.count - shown.length} more`] : [];
  return {
    subject: `${n} ${noun} still waiting for review`,
    preheader: `Still waiting for review: ${p.companyNames.slice(0, 3).join(", ")}`,
    heading: `${n} ${noun} still waiting`,
    bodyLines: ["These are still waiting for review:", ...shown, ...more],
    ctaLabel: "Review referrals",
    ctaUrl: url,
    footnote: "You get this at the end of your day when referrals are still waiting for review.",
    audience: "internal",
    orgName: null,
    replyTo: null,
  };
}

/** The email for one outbox row, or null when the row must be dropped unsent. */
export function buildPortalNotifyEmail(kind: string, payload: unknown, ctx: NotifyContext): PortalNotifyEmail | null {
  if (kind === PARTNER_SENT_KIND) {
    const p = parseSentPayload(payload);
    return p ? buildSent(p, ctx) : null;
  }
  if (kind === PARTNER_DIGEST_KIND) {
    const p = parseDigestPayload(payload);
    return p ? buildDigest(p, ctx) : null;
  }
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
