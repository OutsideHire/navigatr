/**
 * Signed-in referral actions behind portal_api (Partner Portal Phase 1B, spec
 * 5.5 and 5.6).
 *
 * portalApi.ts resolves the session first and passes the scope that
 * portal_session_lookup returned. Nothing here reads an org, partner or portal
 * user id from the request (brief D2).
 *
 * Every response is built field by field from an allowlist (FR-PORT-16/61/62/73):
 * internal statuses become partner labels through portalLabels.ts, and decline
 * reasons, deal stage, internal notes and other partners' data are never copied
 * from a row, even when a row carries them.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import { collapseHistory, portalLabel, type PortalHistoryEntry, type PortalLabel } from "./portalLabels.ts";
import { PORTAL_FIELD_LIMITS, isPortalWindow, validateSubmission, windowSince } from "./portalSubmission.ts";
import { MAX_AUDIO_BASE64_CHARS, MAX_AUDIO_BYTES, base64ToBytes } from "./transcribe.ts";

export const REFERRAL_ACTIONS = [
  "form",
  "dup_check",
  "submit_referral",
  "list_referrals",
  "get_referral",
  "withdraw_referral",
  "dashboard",
  "transcribe",
] as const;
export type ReferralAction = (typeof REFERRAL_ACTIONS)[number];

export function isReferralAction(action: string): action is ReferralAction {
  return (REFERRAL_ACTIONS as readonly string[]).includes(action);
}

export interface ReferralScope {
  portalUserId: string;
  orgId: string;
  partnerId: string;
}

export interface ReferralDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>;
  now?(): Date;
}

export interface ActionResult {
  status: number;
  body: unknown;
}

export interface PortalForm {
  consentText: string;
  consentVersion: number;
}

export interface PortalReferralSummary {
  id: string;
  ref: string;
  companyName: string;
  label: PortalLabel;
  submittedAt: string;
  lastActivityAt: string;
}

export interface PortalDashboard {
  submitted: number;
  active: number;
  closedWon: number;
  conversionRate: number | null;
  valueVisible: boolean;
  totalValueCents?: number;
}

export interface PortalRepContact {
  name: string;
  email: string | null;
}

export interface PortalReferralDetail {
  id: string;
  ref: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  industry: string | null;
  urgency: string | null;
  notes: string | null;
  label: PortalLabel;
  submittedAt: string;
  canWithdraw: boolean;
  rep: PortalRepContact | null;
  history: PortalHistoryEntry[];
}

type Body = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(body: unknown): ActionResult {
  return { status: 200, body };
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): ActionResult {
  return { status, body: { error, ...extra } };
}

function serverError(where: string, message: string): ActionResult {
  console.error(`[portal_api] ${where} failed:`, message);
  return err(500, "server_error");
}

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return data !== null && typeof data === "object" ? [data as T] : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scopeArgs(scope: ReferralScope): Record<string, unknown> {
  return { p_org: scope.orgId, p_partner: scope.partnerId };
}

function windowArg(body: Body, deps: ReferralDeps): { ok: true; since: string | null } | { ok: false } {
  const chosen = body.window === undefined ? "all" : body.window;
  if (!isPortalWindow(chosen)) return { ok: false };
  const since = windowSince(chosen, deps.now ? deps.now() : new Date());
  return { ok: true, since: since ? since.toISOString() : null };
}

export async function handleReferralAction(
  action: ReferralAction,
  scope: ReferralScope,
  body: Body,
  ip: string | null,
  deps: ReferralDeps,
): Promise<ActionResult> {
  switch (action) {
    case "form":
      return form(scope, deps);
    case "dup_check":
      return dupCheck(scope, body, ip, deps);
    case "submit_referral":
      return submit(scope, body, ip, deps);
    case "list_referrals":
      return list(scope, body, deps);
    case "dashboard":
      return dashboard(scope, body, deps);
    case "get_referral":
      return getReferral(scope, body, ip, deps);
    case "withdraw_referral":
      return withdraw(scope, body, ip, deps);
    case "transcribe":
      return transcribe(scope, body, ip, deps);
    default:
      return err(404, "not_found");
  }
}

async function form(scope: ReferralScope, deps: ReferralDeps): Promise<ActionResult> {
  const { data, error } = await deps.rpc("portal_form_context", scopeArgs(scope));
  if (error) return serverError("form", error.message);
  const row = rows<{ consent_text: unknown; consent_version: unknown }>(data)[0];
  if (!row) return serverError("form", "no form context");
  const out: PortalForm = { consentText: str(row.consent_text), consentVersion: num(row.consent_version) };
  return ok({ form: out });
}

async function dupCheck(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const name = str(body.companyName).trim();
  const phone = str(body.phone).trim();
  const address = str(body.address).trim();
  if (
    name.length > PORTAL_FIELD_LIMITS.companyName ||
    phone.length > PORTAL_FIELD_LIMITS.phone ||
    address.length > PORTAL_FIELD_LIMITS.address
  ) {
    return err(400, "invalid_body");
  }
  if (!name) return ok({ probableDuplicate: false });
  const { data, error } = await deps.rpc("portal_dup_check", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_name: name,
    p_phone: phone || null,
    p_address: address || null,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("rate_limited")) return err(429, "rate_limited");
    return serverError("dup_check", error.message);
  }
  return ok({ probableDuplicate: data === true });
}

async function submit(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const check = validateSubmission(body);
  if (!check.ok) return err(400, "invalid_body", { field: check.field });
  const s = check.value;
  const { data, error } = await deps.rpc("portal_submit_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_company: s.companyName,
    p_contact_name: s.contactName,
    p_contact_email: s.email,
    p_contact_phone: s.phone,
    p_address: s.address,
    p_industry: s.industry,
    p_urgency: s.urgency,
    p_notes: s.notes,
    p_consent: s.consent,
    p_consent_version: s.consentVersion,
    p_ip: ip,
  });
  if (error) {
    const message = error.message;
    if (message.includes("rate_limited")) return err(429, "rate_limited");
    if (message.includes("consent_changed")) return err(409, "consent_changed");
    if (message.includes("consent_required")) return err(400, "invalid_body", { field: "consent" });
    const field = /invalid_input:([A-Za-z]+)/.exec(message)?.[1];
    if (field) return err(400, "invalid_body", { field });
    return serverError("submit_referral", message);
  }
  const row = rows<{ id: unknown; ref: unknown }>(data)[0];
  if (!row || !str(row.id)) return serverError("submit_referral", "no row returned");
  return ok({ referral: { id: str(row.id), ref: str(row.ref) } });
}

async function list(scope: ReferralScope, body: Body, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_list_referrals", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("list_referrals", error.message);
  const referrals: PortalReferralSummary[] = [];
  for (const r of rows<Record<string, unknown>>(data)) {
    const label = portalLabel(r.status);
    if (!label) continue;
    referrals.push({
      id: str(r.id),
      ref: str(r.ref),
      companyName: str(r.company_name),
      label,
      submittedAt: str(r.submitted_at),
      lastActivityAt: str(r.last_activity_at),
    });
  }
  return ok({ referrals });
}

async function dashboard(scope: ReferralScope, body: Body, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_dashboard_stats", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("dashboard", error.message);
  const row = rows<Record<string, unknown>>(data)[0];
  if (!row) return serverError("dashboard", "no stats row");
  const won = num(row.closed_won);
  const closed = won + num(row.not_moving_forward);
  const out: PortalDashboard = {
    submitted: num(row.submitted),
    active: num(row.active),
    closedWon: won,
    conversionRate: closed > 0 ? won / closed : null,
    valueVisible: row.value_visible === true,
  };
  // FR-PORT-70/71: the value leaves the server only when the ISO allows it.
  if (out.valueVisible) out.totalValueCents = num(row.won_value_cents);
  return ok({ dashboard: out });
}

async function getReferral(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const detail = await deps.rpc("portal_get_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (detail.error) return serverError("get_referral", detail.error.message);
  const row = rows<Record<string, unknown>>(detail.data)[0];
  const label = row ? portalLabel(row.status) : null;
  if (!row || !label) return err(404, "not_found");

  const hist = await deps.rpc("portal_referral_history", { ...scopeArgs(scope), p_referral: id });
  if (hist.error) return serverError("referral_history", hist.error.message);
  const history = collapseHistory(
    rows<Record<string, unknown>>(hist.data).map((h) => ({ status: h.status, at: h.created_at })),
  );

  // Defense in depth: SQL already blanks these for a rep-logged referral; never
  // pass rep-written text through even if a row carried it (spec 6).
  const typed = row.source === "portal_signed_in";
  const repName = strOrNull(row.rep_name);
  const repEmail = strOrNull(row.rep_email);
  const out: PortalReferralDetail = {
    id: str(row.id),
    ref: str(row.ref),
    companyName: str(row.company_name),
    contactName: typed ? strOrNull(row.contact_name) : null,
    contactEmail: typed ? strOrNull(row.contact_email) : null,
    contactPhone: typed ? strOrNull(row.contact_phone) : null,
    address: typed ? strOrNull(row.address) : null,
    industry: typed ? strOrNull(row.industry) : null,
    urgency: typed ? strOrNull(row.urgency) : null,
    notes: typed ? strOrNull(row.notes) : null,
    label,
    submittedAt: str(row.submitted_at),
    canWithdraw: typed && row.can_withdraw === true,
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    history,
  };
  return ok({ referral: out });
}

async function withdraw(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const { error } = await deps.rpc("portal_withdraw_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("referral_not_found")) return err(404, "not_found");
    if (error.message.includes("not_withdrawable")) return err(409, "not_withdrawable");
    return serverError("withdraw_referral", error.message);
  }
  return ok({ ok: true });
}

async function transcribe(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  if (!deps.transcribe) return serverError("transcribe", "no transcriber configured");
  const audio = str(body.audio);
  const mime = str(body.mime).slice(0, 100);
  if (!audio) return err(400, "invalid_body");
  if (audio.length > MAX_AUDIO_BASE64_CHARS) return err(413, "audio_too_large");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(audio);
  } catch {
    return err(400, "invalid_body");
  }
  if (bytes.length === 0) return err(400, "invalid_body");
  if (bytes.length > MAX_AUDIO_BYTES) return err(413, "audio_too_large");

  const claim = await deps.rpc("portal_claim_transcribe", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_ip: ip,
  });
  if (claim.error) return serverError("transcribe claim", claim.error.message);
  if (claim.data !== true) return err(429, "rate_limited");

  try {
    const text = await deps.transcribe(bytes, mime);
    return ok({ text: text.trim() });
  } catch (e) {
    // The vendor's message can carry request detail; the partner gets none of it.
    console.error("[portal_api] transcribe failed:", e instanceof Error ? e.message : String(e));
    return err(502, "transcription_failed");
  }
}
