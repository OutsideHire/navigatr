/**
 * emailPoll — pure orchestration core for the sent-email poll (PRD §5.2/§5.3).
 * The edge function does the I/O (Graph fetch, token refresh, DB writes); this
 * holds the deterministic, unit-tested logic: build the delta request, parse a
 * delta page, and turn a batch of Graph messages into the exact DB rows to write.
 */

import {
  mapGraphMessage,
  decideIngest,
  type GraphSentMessage,
  type CaptureProvider,
} from "./emailIngest.ts";
import type { EmailMatchDeal } from "./emailMatch.ts";

const SENT_DELTA_SELECT =
  "id,internetMessageId,conversationId,subject,sentDateTime,hasAttachments,webLink,toRecipients,ccRecipients";

/** The initial Sent Items delta URL, or the stored deltaLink for incremental polls. */
export function buildSentDeltaUrl(deltaLink: string | null): string {
  if (deltaLink) return deltaLink;
  return (
    "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta" +
    `?$select=${SENT_DELTA_SELECT}`
  );
}

export interface DeltaPage {
  messages: GraphSentMessage[];
  /** Next page of the current sweep (follow it before persisting the deltaLink). */
  nextLink: string | null;
  /** Cursor to store for the next poll; present only on the final page. */
  deltaLink: string | null;
}

interface RawDeltaResponse {
  value?: Array<GraphSentMessage & { "@removed"?: unknown }>;
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

/** Parse one Graph delta response. Dropped: tombstones (`@removed`) and rows
 *  without an id -- we only ingest added/updated sent messages. */
export function parseDeltaPage(json: RawDeltaResponse): DeltaPage {
  const messages = (json.value ?? []).filter((m) => m && m.id && !("@removed" in m));
  return {
    messages,
    nextLink: json["@odata.nextLink"] ?? null,
    deltaLink: json["@odata.deltaLink"] ?? null,
  };
}

// Row shapes the edge function inserts (snake_case = the table columns).
export interface EmailActivityRow {
  org_id: string;
  sender_user_id: string;
  provider: CaptureProvider;
  provider_message_id: string;
  internet_message_id: string | null;
  thread_id: string | null;
  recipients: string[];
  sent_at: string | null;
  subject: string | null;
  has_attachments: boolean;
  deep_link_url: string | null;
  matched_deal_id: string;
  match_confidence: number | null;
  match_method: string | null;
  status: "suggested";
}
export interface UnmatchedRow {
  org_id: string;
  sender_user_id: string;
  provider: CaptureProvider;
  provider_message_id: string;
  internet_message_id: string | null;
  thread_id: string | null;
  recipients: string[];
  sent_at: string | null;
  subject: string | null;
  has_attachments: boolean;
  deep_link_url: string | null;
}

export interface ProcessInput {
  messages: GraphSentMessage[];
  orgId: string;
  senderUserId: string;
  provider: CaptureProvider;
  deals: EmailMatchDeal[];
  internalDomains: string[];
  personalDomains: string[];
  /** Thread ids already captured (from a prior poll) for this sender/org. */
  capturedThreadIds: Set<string>;
  /** provider_message_ids already recorded in EITHER table (email_activity or
   *  email_unmatched_queue), so a re-polled message is never double-handled or
   *  duplicated across the two tables. */
  seenMessageIds: Set<string>;
  /** No historical backfill (PRD): messages sent before this are skipped. Null
   *  disables the bound. */
  captureStartDate: string | null;
  /** Fallback for a message with no parseable sentDateTime, so the NOT NULL
   *  sent_at column is always satisfied (the poll passes its own now()). */
  nowIso: string;
  bulkRecipientThreshold?: number;
}

export interface ProcessOutput {
  suggestions: EmailActivityRow[];
  queued: UnmatchedRow[];
  skipped: Array<{ providerMessageId: string; reason: string }>;
}

/**
 * Turn a batch of Graph sent messages into the DB rows to write. Matched ->
 * a SUGGESTED email_activity row (D-07: rep confirms before it becomes an
 * activity); unmatched -> the manual queue; suppressed/duplicate -> skipped.
 * Thread dedup spans BOTH prior polls (capturedThreadIds) and this batch (a
 * second message in a thread we just suggested is skipped as a duplicate).
 */
export function processSentMessages(input: ProcessInput): ProcessOutput {
  const out: ProcessOutput = { suggestions: [], queued: [], skipped: [] };
  const seenThreads = new Set(input.capturedThreadIds);

  for (const msg of input.messages) {
    const meta = mapGraphMessage(msg, input.provider);

    // Idempotency across re-polls AND across both tables: a message already
    // recorded anywhere is left alone (never re-handled or duplicated).
    if (input.seenMessageIds.has(meta.providerMessageId)) {
      out.skipped.push({ providerMessageId: meta.providerMessageId, reason: "already_processed" });
      continue;
    }
    // No historical backfill: skip anything sent before the connection's
    // capture start (a null sentAt can't be judged, so it is not skipped here).
    if (input.captureStartDate && meta.sentAt && meta.sentAt < input.captureStartDate) {
      out.skipped.push({ providerMessageId: meta.providerMessageId, reason: "before_capture_start" });
      continue;
    }

    const sentAt = meta.sentAt ?? input.nowIso; // NOT NULL column; coalesce
    const threadAlreadyCaptured = meta.threadId != null && seenThreads.has(meta.threadId);
    const decision = decideIngest({
      meta,
      deals: input.deals,
      internalDomains: input.internalDomains,
      personalDomains: input.personalDomains,
      threadAlreadyCaptured,
      bulkRecipientThreshold: input.bulkRecipientThreshold,
    });

    if (decision.action === "write_activity") {
      out.suggestions.push({
        org_id: input.orgId,
        sender_user_id: input.senderUserId,
        provider: meta.provider,
        provider_message_id: meta.providerMessageId,
        internet_message_id: meta.internetMessageId,
        thread_id: meta.threadId,
        recipients: meta.recipients,
        sent_at: sentAt,
        subject: meta.subject,
        has_attachments: meta.hasAttachments,
        deep_link_url: meta.deepLinkUrl,
        matched_deal_id: decision.dealId!,
        match_confidence: decision.confidence ?? null,
        match_method: decision.method ?? null,
        status: "suggested",
      });
      if (meta.threadId) seenThreads.add(meta.threadId); // in-batch thread dedup
    } else if (decision.action === "queue") {
      out.queued.push({
        org_id: input.orgId,
        sender_user_id: input.senderUserId,
        provider: meta.provider,
        provider_message_id: meta.providerMessageId,
        internet_message_id: meta.internetMessageId,
        thread_id: meta.threadId,
        recipients: meta.recipients,
        sent_at: sentAt,
        subject: meta.subject,
        has_attachments: meta.hasAttachments,
        deep_link_url: meta.deepLinkUrl,
      });
    } else {
      out.skipped.push({ providerMessageId: meta.providerMessageId, reason: decision.reason ?? "skip" });
    }
  }
  return out;
}

/** Thrown when Graph reports the delta token expired (410 resyncRequired). The
 *  caller resets the stored cursor to null so the next poll does a fresh sync. */
export class DeltaResyncRequired extends Error {
  constructor() {
    super("resync_required");
    this.name = "DeltaResyncRequired";
  }
}

/**
 * Follow the Sent Items delta from `startUrl` (buildSentDeltaUrl) across pages,
 * accumulating messages until Graph returns the final deltaLink. Injectable
 * fetch for tests; bounded by maxPages so a pathological nextLink loop can't run
 * forever.
 *
 * Returns `cursor` = the value to STORE for the next poll: the deltaLink once
 * the sweep finishes, or the last nextLink if maxPages was hit mid-sweep (so a
 * long initial sync RESUMES next invocation and makes progress instead of
 * restarting and getting stuck). Throws DeltaResyncRequired on a 410 (expired
 * token) and a plain Error on any other non-OK response.
 */
export async function collectSentDelta(
  accessToken: string,
  startUrl: string,
  fetchImpl: typeof fetch = fetch,
  maxPages = 40,
): Promise<{ messages: GraphSentMessage[]; cursor: string | null }> {
  const messages: GraphSentMessage[] = [];
  let url: string | null = startUrl;
  let deltaLink: string | null = null;
  let lastNextLink: string | null = null;
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw new DeltaResyncRequired();
    if (!res.ok) throw new Error(`graph sent delta http ${res.status}`);
    const parsed = parseDeltaPage(await res.json());
    messages.push(...parsed.messages);
    if (parsed.deltaLink) {
      deltaLink = parsed.deltaLink;
      url = null;
    } else {
      lastNextLink = parsed.nextLink;
      url = parsed.nextLink;
    }
  }
  // deltaLink = sweep complete (incremental next time); else resume from the
  // last nextLink so the next invocation continues rather than restarting.
  return { messages, cursor: deltaLink ?? lastNextLink };
}
