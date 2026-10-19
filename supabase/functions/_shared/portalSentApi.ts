/**
 * "Sent to you" and partner note-back behind portal_api (Partner Portal Phase
 * 2B-3, FR-PORT-76, 77, 78).
 *
 * portalReferralApi.ts routes here after portalApi.ts resolved the session; the
 * scope is the one portal_session_lookup returned, never the request.
 *
 * Every response is built field by field: the partner label (portalLabels.ts),
 * the contact snapshot the rep shared by sending the referral, the rep's note
 * only when SQL returned it (partner_note_visible), the sender's name and
 * business email, and the partner's own notes. A row's other fields (stage,
 * value, internal notes, ids of people) are never copied.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import { portalLabel, type PortalLabel } from "./portalLabels.ts";

/** Same limit as referral_partner_notes.body in the database. */
export const PORTAL_NOTE_MAX = 1000;

export interface PortalSentReferralSummary {
  id: string;
  ref: string;
  companyName: string;
  label: PortalLabel;
  sentAt: string;
  lastActivityAt: string;
}

export interface PortalPartnerNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface PortalSentReferralDetail {
  id: string;
  ref: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** The note the rep wrote for the partner, or null. */
  repNote: string | null;
  label: PortalLabel;
  sentAt: string;
  /** Who sent it (name and business email), or null when they left the ISO. */
  rep: { name: string; email: string | null } | null;
  /** The ISO's retention period passed and the contact details were erased. */
  detailsRemoved: boolean;
  canPostNote: boolean;
  /** The partner's own notes, newest first. */
  notes: PortalPartnerNote[];
}

export interface SentScope {
  portalUserId: string;
  orgId: string;
  partnerId: string;
}

export interface SentDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface SentResult {
  status: number;
  body: unknown;
}

type Body = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(body: unknown): SentResult {
  return { status: 200, body };
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): SentResult {
  return { status, body: { error, ...extra } };
}

function serverError(where: string, message: string): SentResult {
  console.error(`[portal_api] ${where} failed:`, message);
  return err(500, "server_error");
}

function rows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return data !== null && typeof data === "object" ? [data as Record<string, unknown>] : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Exactly space, tab, CR, LF: the same set btrim(..., E' \t\r\n') strips in SQL. */
function trimNote(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/** The trimmed note, or null when it is empty or longer than PORTAL_NOTE_MAX characters (code points, like char_length). */
export function validateNoteBody(value: unknown): string | null {
  const body = typeof value === "string" ? trimNote(value) : "";
  const length = Array.from(body).length;
  return length >= 1 && length <= PORTAL_NOTE_MAX ? body : null;
}

function notesFrom(data: unknown): PortalPartnerNote[] {
  const out: PortalPartnerNote[] = [];
  for (const n of rows(data)) {
    const id = str(n.id);
    // Same trim as SQL and validateNoteBody: a note of only unicode whitespace
    // (a non-breaking space) is a real stored note and must come back.
    const body = trimNote(str(n.body));
    const createdAt = str(n.created_at);
    if (!id || !body || !createdAt) continue;
    out.push({ id, body, createdAt });
  }
  return out;
}

export async function listSentReferrals(scope: SentScope, since: string | null, deps: SentDeps): Promise<SentResult> {
  const { data, error } = await deps.rpc("portal_list_sent_referrals", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_since: since,
  });
  if (error) return serverError("list_sent_referrals", error.message);
  const referrals: PortalSentReferralSummary[] = [];
  for (const r of rows(data)) {
    const label = portalLabel(r.status);
    if (!label) continue;
    referrals.push({
      id: str(r.id),
      ref: str(r.ref),
      companyName: str(r.company_name),
      label,
      sentAt: str(r.sent_at),
      lastActivityAt: str(r.last_activity_at),
    });
  }
  return ok({ referrals });
}

export async function getSentReferral(scope: SentScope, body: Body, ip: string | null, deps: SentDeps): Promise<SentResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const detail = await deps.rpc("portal_get_sent_referral", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (detail.error) return serverError("get_sent_referral", detail.error.message);
  const row = rows(detail.data)[0];
  const label = row ? portalLabel(row.status) : null;
  if (!row || !label) return err(404, "not_found");

  // A failed notes lookup degrades to no notes (logged) rather than breaking the page.
  const list = await deps.rpc("portal_partner_notes", { p_org: scope.orgId, p_partner: scope.partnerId, p_referral: id });
  let notes: PortalPartnerNote[] = [];
  if (list.error) console.error("[portal_api] partner_notes failed:", list.error.message);
  else notes = notesFrom(list.data);

  // Defense in depth: SQL already blanks these for a purged row.
  const removed = row.details_removed === true;
  const repName = strOrNull(row.rep_name);
  const repEmail = strOrNull(row.rep_email);
  const out: PortalSentReferralDetail = {
    id: str(row.id),
    ref: str(row.ref),
    companyName: str(row.company_name),
    contactName: removed ? null : strOrNull(row.contact_name),
    contactEmail: removed ? null : strOrNull(row.contact_email),
    contactPhone: removed ? null : strOrNull(row.contact_phone),
    repNote: removed ? null : strOrNull(row.rep_note),
    label,
    sentAt: str(row.sent_at),
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    detailsRemoved: removed,
    canPostNote: !removed && row.can_post_note === true,
    notes,
  };
  return ok({ referral: out });
}

export async function postNote(scope: SentScope, body: Body, ip: string | null, deps: SentDeps): Promise<SentResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const text = validateNoteBody(body.body);
  if (text === null) return err(400, "invalid_body", { field: "body" });
  const { data, error } = await deps.rpc("portal_post_partner_note", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_body: text,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("referral_not_found")) return err(404, "not_found");
    if (error.message.includes("rate_limited")) return err(429, "rate_limited");
    if (error.message.includes("invalid_input:body")) return err(400, "invalid_body", { field: "body" });
    return serverError("post_note", error.message);
  }
  const note = notesFrom(data)[0];
  if (!note) return serverError("post_note", "no row returned");
  return ok({ note });
}
