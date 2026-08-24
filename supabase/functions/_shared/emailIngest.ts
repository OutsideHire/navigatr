/**
 * emailIngest — pure ingest core for auto email capture (PRD §5.2/§5.3). Turns a
 * Microsoft Graph sent-message into our metadata-only shape and decides what to
 * do with it (write an activity, queue it, or skip). Deterministic + unit-tested;
 * the poll edge function (the I/O half) supplies the Graph messages, the candidate
 * deals, and the thread-already-captured flag, then acts on the decision.
 *
 * METADATA ONLY: we never read or map body, bodyPreview, or attachment content.
 */

import { classifyEmail, type EmailMatchDeal } from "./emailMatch.ts";

export type CaptureProvider = "outlook" | "gmail";

// The Graph message fields we $select (no body/preview/attachments).
export interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}
export interface GraphSentMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  webLink?: string;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
}

/** Our stored, metadata-only representation of a captured sent email. */
export interface CapturedEmailMeta {
  provider: CaptureProvider;
  providerMessageId: string;
  internetMessageId: string | null;
  threadId: string | null;
  subject: string | null;
  sentAt: string | null; // ISO-8601
  hasAttachments: boolean;
  deepLinkUrl: string | null;
  recipients: string[]; // To + CC addresses, normalized lowercase
}

export function graphRecipientAddresses(recipients: GraphRecipient[] | undefined): string[] {
  if (!recipients) return [];
  const out: string[] = [];
  for (const r of recipients) {
    const addr = r.emailAddress?.address?.trim().toLowerCase();
    if (addr && addr.includes("@")) out.push(addr);
  }
  return out;
}

function toIso(dt: string | undefined): string | null {
  if (!dt) return null;
  const ms = Date.parse(dt);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Map a Graph message to our metadata shape. Never touches message content. */
export function mapGraphMessage(msg: GraphSentMessage, provider: CaptureProvider): CapturedEmailMeta {
  return {
    provider,
    providerMessageId: msg.id,
    internetMessageId: msg.internetMessageId ?? null,
    threadId: msg.conversationId ?? null,
    subject: msg.subject ?? null,
    sentAt: toIso(msg.sentDateTime),
    hasAttachments: Boolean(msg.hasAttachments),
    deepLinkUrl: msg.webLink ?? null,
    recipients: [
      ...graphRecipientAddresses(msg.toRecipients),
      ...graphRecipientAddresses(msg.ccRecipients),
    ],
  };
}

export type IngestAction = "write_activity" | "queue" | "skip";

export interface IngestDecision {
  action: IngestAction;
  meta: CapturedEmailMeta;
  /** write_activity only */
  dealId?: string;
  confidence?: number;
  method?: "contact_email" | "account_domain";
  /** queue/skip: why */
  reason?: string;
}

export interface IngestContext {
  meta: CapturedEmailMeta;
  deals: EmailMatchDeal[];
  internalDomains: string[];
  personalDomains: string[];
  /** True when an activity already exists for this message's thread. */
  threadAlreadyCaptured: boolean;
  bulkRecipientThreshold?: number;
}

/**
 * Decide the ingest action for one mapped message. matched -> write_activity;
 * unmatched -> queue (manual assign); suppressed/duplicate -> skip. This is the
 * single decision the poll function acts on per message.
 */
export function decideIngest(ctx: IngestContext): IngestDecision {
  const c = classifyEmail({
    recipients: ctx.meta.recipients,
    threadAlreadyCaptured: ctx.threadAlreadyCaptured,
    internalDomains: ctx.internalDomains,
    personalDomains: ctx.personalDomains,
    deals: ctx.deals,
    bulkRecipientThreshold: ctx.bulkRecipientThreshold,
  });
  switch (c.kind) {
    case "matched":
      return {
        action: "write_activity",
        meta: ctx.meta,
        dealId: c.dealId,
        confidence: c.confidence,
        method: c.method,
      };
    case "unmatched":
      return { action: "queue", meta: ctx.meta, reason: c.reason };
    case "suppressed":
    case "duplicate":
      return { action: "skip", meta: ctx.meta, reason: c.reason ?? c.kind };
  }
}
