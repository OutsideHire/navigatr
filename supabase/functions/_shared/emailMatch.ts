/**
 * emailMatch — the auto email-capture matcher (PRD Automatic Email Activity
 * Capture, §7 / spec §5.3). Pure + deterministic so it is unit-tested against
 * synthetic fixtures with no live mail; the ingest edge function calls it per
 * captured sent message.
 *
 * Rule of the feature: NEVER guess. A message resolves to exactly one of:
 *   - matched     one confident deal (exact contact email, or a unique account
 *                 domain) -> written as an activity
 *   - unmatched   plausible but not confident (no candidate, or ambiguous) ->
 *                 goes to the manual-assign queue
 *   - suppressed  should not be captured at all (internal-only, bulk, personal)
 *   - duplicate   this thread already produced an activity (thread-level dedup)
 */

export type EmailMatchKind = "matched" | "unmatched" | "suppressed" | "duplicate";

export interface EmailMatchDeal {
  id: string;
  /** The deal's primary contact email (deals.contact_email); may be null. */
  contactEmail: string | null;
}

export interface EmailMatchInput {
  /** To + CC addresses (BCC is out of scope). */
  recipients: string[];
  /** True when an activity already exists for this message's thread. */
  threadAlreadyCaptured: boolean;
  /** The sending org's own mail domains, e.g. ["getnavigatr.io"]. */
  internalDomains: string[];
  /** Consumer/personal mail domains that cannot be domain-matched to a business
   *  account, e.g. ["gmail.com", "outlook.com", "yahoo.com"]. */
  personalDomains: string[];
  /** Candidate deals to match against. */
  deals: EmailMatchDeal[];
  /** A send to at least this many recipients is treated as bulk. Default 8. */
  bulkRecipientThreshold?: number;
}

export interface EmailMatchResult {
  kind: EmailMatchKind;
  dealId?: string;
  /** 0..1; present only when matched. */
  confidence?: number;
  method?: "contact_email" | "account_domain";
  /** Why, for suppressed/unmatched (drives the queue + monitoring). */
  reason?:
    | "internal_only"
    | "bulk"
    | "personal"
    | "no_candidate"
    | "ambiguous_contact"
    | "ambiguous_domain";
}

const DEFAULT_BULK_THRESHOLD = 8;

export function normalizeEmail(addr: string): string {
  return addr.trim().toLowerCase();
}

export function emailDomain(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at === -1 ? "" : addr.slice(at + 1).trim().toLowerCase();
}

function uniq(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function classifyEmail(input: EmailMatchInput): EmailMatchResult {
  const bulkThreshold = input.bulkRecipientThreshold ?? DEFAULT_BULK_THRESHOLD;
  const internal = new Set(input.internalDomains.map((d) => d.toLowerCase()));
  const personal = new Set(input.personalDomains.map((d) => d.toLowerCase()));

  // Thread dedup wins over everything: one activity per exchange.
  if (input.threadAlreadyCaptured) return { kind: "duplicate" };

  const recipients = input.recipients.map(normalizeEmail).filter((r) => r.includes("@"));

  // Bulk: a wide blast is not a 1:1 sales touch.
  if (recipients.length >= bulkThreshold) return { kind: "suppressed", reason: "bulk" };

  // External = not one of our own domains.
  const external = recipients.filter((r) => !internal.has(emailDomain(r)));
  if (external.length === 0) return { kind: "suppressed", reason: "internal_only" };

  // Exact contact-email match (works regardless of domain type).
  const exactDealIds = uniq(
    input.deals
      .filter((d) => d.contactEmail && external.includes(normalizeEmail(d.contactEmail)))
      .map((d) => d.id),
  );
  if (exactDealIds.length === 1) {
    return { kind: "matched", dealId: exactDealIds[0], confidence: 0.99, method: "contact_email" };
  }
  if (exactDealIds.length > 1) {
    return { kind: "unmatched", reason: "ambiguous_contact" };
  }

  // Domain -> account match, business domains only.
  const businessDomains = uniq(external.map(emailDomain).filter((d) => d && !personal.has(d)));
  const domainDealIds = uniq(
    input.deals
      .filter((d) => d.contactEmail && businessDomains.includes(emailDomain(d.contactEmail)))
      .map((d) => d.id),
  );
  if (domainDealIds.length === 1) {
    return { kind: "matched", dealId: domainDealIds[0], confidence: 0.7, method: "account_domain" };
  }
  if (domainDealIds.length > 1) {
    return { kind: "unmatched", reason: "ambiguous_domain" };
  }

  // No business domain to match on, and every external recipient is a personal
  // mailbox -> treat as a personal send, not a business touch.
  if (businessDomains.length === 0) {
    return { kind: "suppressed", reason: "personal" };
  }

  return { kind: "unmatched", reason: "no_candidate" };
}
