/**
 * The portal_notify drain (Partner Portal Phase 1C, spec 5.8 and 5.9, brief E4).
 *
 * Every run: queue the same-day nudges and the weekly partner summaries for
 * "now" (enqueue_portal_nudges, enqueue_portal_digests), claim
 * one batch (20 rows, paced 600 ms apart) from portal_email_outbox (claim_portal_emails, FOR UPDATE SKIP
 * LOCKED), build each email (portalNotifyEmail.ts), and settle each row with
 * mark_portal_email:
 *   sent      the provider accepted it
 *   dropped   invalid_payload (nothing safe to send) or email_guard (the
 *             non-production allowlist blocked the recipient)
 *   failed    the provider refused it; SQL retries with backoff and gives up
 *             after the fifth attempt
 *
 * Partner emails go out in the ISO's name (portalFromAddress), with the ISO's
 * brand and Reply-To the assigned rep. Internal emails use the shared sender
 * and the default template. Logs carry outbox ids and kinds, never addresses.
 *
 * Pure TS with injected dependencies and no Deno globals at module scope, so
 * the app's vitest covers it. portal_notify/index.ts wires the real clients.
 */
import { requireCronCaller, type HeaderBearingRequest } from "./cronAuth.ts";
import { shouldSend } from "./emailGuard.ts";
import { renderEmail, type EmailBrand } from "./emailTemplate.ts";
import { noReplyAddress, portalFromAddress } from "./portalEmail.ts";
import { buildPortalNotifyEmail } from "./portalNotifyEmail.ts";

/** Rows per run. With the 2 minute cron and the pacing below, a run stays well under the function time limit. */
export const PORTAL_NOTIFY_BATCH = 20;
/** Pause between consecutive sends, to stay under Resend's request rate limit. */
export const PORTAL_NOTIFY_PACE_MS = 600;

export interface PortalNotifyMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface PortalNotifyBrand {
  logoUrl: string | null;
  primaryColor: string | null;
  /** org_branding.show_powered_by. Missing means shown. */
  showPoweredBy?: boolean;
}

export interface PortalNotifyEnv {
  appBaseUrl: string;
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
  /** NO_REPLY_ADDRESS (FR-PORT-81). Unset or not a plain address: no-reply@send.getnavigatr.io. */
  noReplyAddress?: string | null;
  /** The portal_api function URL (`${SUPABASE_URL}/functions/v1/portal_api`): the weekly summary's one-click unsubscribe target. */
  portalApiUrl?: string;
}

export interface PortalNotifyDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  /** The org's logo and color (org_branding), or null. */
  loadBrand(orgId: string): Promise<PortalNotifyBrand | null>;
  sendEmail(msg: PortalNotifyMessage): Promise<void>;
  /** Injected so tests do not wait; the edge function passes a setTimeout wrapper. */
  sleep(ms: number): Promise<void>;
  now?(): Date;
  env: PortalNotifyEnv;
}

export interface PortalNotifySummary {
  nudgesQueued: number;
  digestsQueued: number;
  claimed: number;
  sent: number;
  dropped: number;
  failed: number;
}

interface ClaimedRow {
  id: string;
  org_id: string;
  kind: string;
  referral_id: string | null;
  payload: unknown;
  recipient: string | null;
  attempts: number;
}

type Outcome = "sent" | "dropped" | "failed";

const EMAIL_LIKE = /[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+/g;

/** A provider error, safe for logs and last_error: no addresses, at most 500 characters. */
function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(EMAIL_LIKE, "[email]").slice(0, 500);
}

async function markOnce(deps: PortalNotifyDeps, id: string, outcome: Outcome, error: string | null): Promise<string | null> {
  try {
    const res = await deps.rpc("mark_portal_email", { p_id: id, p_outcome: outcome, p_error: error });
    return res.error ? errorText(res.error.message) : null;
  } catch (e) {
    return errorText(e);
  }
}

/**
 * Settle a row. A 'sent' mark is retried once: the email already went out, and
 * an unmarked row would be re-claimed and sent again, so one retry is worth it.
 * We never re-send within the run. Logs carry the id only.
 */
async function mark(deps: PortalNotifyDeps, id: string, outcome: Outcome, error: string | null): Promise<void> {
  let failure = await markOnce(deps, id, outcome, error);
  if (failure && outcome === "sent") failure = await markOnce(deps, id, outcome, error);
  if (failure) console.error(`[portal_notify] mark ${outcome} failed for ${id}:`, failure);
}

async function deliver(
  row: ClaimedRow,
  deps: PortalNotifyDeps,
  brandFor: (orgId: string) => Promise<PortalNotifyBrand | null>,
  pace: { sentAny: boolean },
): Promise<Outcome> {
  const built = buildPortalNotifyEmail(row.kind, row.payload, {
    appBaseUrl: deps.env.appBaseUrl,
    referralId: row.referral_id,
    portalApiUrl: deps.env.portalApiUrl,
  });
  if (!built) {
    console.error(`[portal_notify] dropped ${row.kind} ${row.id}: payload did not build`);
    await mark(deps, row.id, "dropped", "invalid_payload");
    return "dropped";
  }
  if (!row.recipient || !shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.recipient)) {
    console.log(`[portal_notify][emailGuard] dropped ${row.kind} ${row.id} in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
    await mark(deps, row.id, "dropped", "email_guard");
    return "dropped";
  }

  let from = deps.env.fromAddress;
  let brand: EmailBrand | undefined;
  if (built.audience === "partner" && built.orgName) {
    const found = await brandFor(row.org_id);
    brand = {
      name: built.orgName,
      logoUrl: found?.logoUrl ?? null,
      primaryColor: found?.primaryColor ?? null,
      showPoweredBy: found?.showPoweredBy !== false,
    };
    from = portalFromAddress(deps.env.fromAddress, built.orgName);
  }
  const { html, text } = renderEmail({ ...built, brand });

  if (pace.sentAny) await deps.sleep(PORTAL_NOTIFY_PACE_MS);
  pace.sentAny = true;
  const replyTo = built.noReply ? noReplyAddress(deps.env.noReplyAddress) : built.replyTo;
  try {
    await deps.sendEmail({
      from,
      to: row.recipient,
      subject: built.subject,
      html,
      text,
      // Weekly summaries reply to the no-reply address; status and "sent to you" emails reply to the rep;
      // internal emails set none.
      ...(replyTo ? { replyTo } : {}),
      ...(built.headers ? { headers: built.headers } : {}),
    });
  } catch (e) {
    const message = errorText(e);
    console.error(`[portal_notify] send failed for ${row.kind} ${row.id} (attempt ${row.attempts}):`, message);
    await mark(deps, row.id, "failed", message);
    return "failed";
  }
  await mark(deps, row.id, "sent", null);
  return "sent";
}

export async function drainPortalEmails(deps: PortalNotifyDeps): Promise<PortalNotifySummary> {
  const summary: PortalNotifySummary = { nudgesQueued: 0, digestsQueued: 0, claimed: 0, sent: 0, dropped: 0, failed: 0 };
  const now = deps.now ? deps.now() : new Date();

  // A failed nudge selection must not hold up emails already queued.
  const nudges = await deps.rpc("enqueue_portal_nudges", { p_now: now.toISOString() });
  if (nudges.error) console.error("[portal_notify] nudge enqueue failed:", nudges.error.message);
  else summary.nudgesQueued = typeof nudges.data === "number" ? nudges.data : 0;

  // Weekly summaries (2B-3). Like the nudges, a failure here never holds up the drain.
  const digests = await deps.rpc("enqueue_portal_digests", { p_now: now.toISOString() });
  if (digests.error) console.error("[portal_notify] digest enqueue failed:", digests.error.message);
  else summary.digestsQueued = typeof digests.data === "number" ? digests.data : 0;

  const claim = await deps.rpc("claim_portal_emails", { p_limit: PORTAL_NOTIFY_BATCH });
  if (claim.error) throw new Error(`claim failed: ${claim.error.message}`);
  const rows = Array.isArray(claim.data) ? (claim.data as ClaimedRow[]) : [];
  summary.claimed = rows.length;

  const brands = new Map<string, Promise<PortalNotifyBrand | null>>();
  const brandFor = (orgId: string) => {
    let pending = brands.get(orgId);
    if (!pending) {
      pending = deps.loadBrand(orgId).catch(() => null);
      brands.set(orgId, pending);
    }
    return pending;
  };

  const pace = { sentAny: false };
  for (const row of rows) {
    summary[await deliver(row, deps, brandFor, pace)] += 1;
  }
  return summary;
}
/** The HTTP edge of the function: cron gate first (no DB call before it), then one drain. */
export async function handlePortalNotifyRequest(
  req: HeaderBearingRequest,
  cronSecret: string | null | undefined,
  deps: PortalNotifyDeps,
): Promise<Response> {
  const denied = requireCronCaller(req, cronSecret);
  if (denied) return denied;
  try {
    const summary = await drainPortalEmails(deps);
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[portal_notify] run failed:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
