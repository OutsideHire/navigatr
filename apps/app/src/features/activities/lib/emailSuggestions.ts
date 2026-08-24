/**
 * emailSuggestions — pure shaping for the rep-facing "Suggested from email"
 * list (Email Capture Phase 1, Slice 5b). Turns raw email_activity rows
 * (status = 'suggested') plus a deal-name lookup into the view rows the
 * section renders. No I/O here so the display logic (subject fallback,
 * recipient summary, deal-name join) is unit-tested on its own.
 */

/** The columns the suggestions query selects from email_activity. */
export interface EmailSuggestionRow {
  id: string;
  subject: string | null;
  recipients: string[] | null;
  sent_at: string;
  matched_deal_id: string | null;
  deep_link_url: string | null;
}

export interface EmailSuggestionView {
  id: string;
  subject: string;
  /** e.g. "jane@acme.com" or "jane@acme.com +2". Empty string if none. */
  recipientSummary: string;
  sentAt: string;
  dealId: string | null;
  companyName: string;
  deepLinkUrl: string | null;
}

/** First recipient, with a "+N" suffix when there are more. */
export function summarizeRecipients(recipients: string[] | null): string {
  const list = (recipients ?? []).filter((r) => r && r.trim().length > 0);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
}

/** Map raw suggestion rows to view rows, joining the deal company name. */
export function buildEmailSuggestionViews(
  rows: EmailSuggestionRow[],
  dealNames: Map<string, string>,
): EmailSuggestionView[] {
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject && r.subject.trim().length > 0 ? r.subject : "(no subject)",
    recipientSummary: summarizeRecipients(r.recipients),
    sentAt: r.sent_at,
    dealId: r.matched_deal_id,
    companyName:
      (r.matched_deal_id && dealNames.get(r.matched_deal_id)) || "Unknown deal",
    deepLinkUrl: r.deep_link_url,
  }));
}
