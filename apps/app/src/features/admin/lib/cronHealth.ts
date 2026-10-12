/**
 * cronHealth — pure summary for the admin "Scheduled jobs" health card.
 * Turns the raw freshness facts from the cron_health() RPC (latest snapshot
 * dates + the email poll's freshest last_poll_at) into per-job ok / stale /
 * attention / idle rows. Outcome-based: a job is healthy when its OUTPUT is
 * fresh, which is what catches a silently-failing scheduler (e.g. the email
 * poll whose last_poll_at stops advancing). Pure so the thresholds are tested.
 */

export interface CronHealthFacts {
  persistence?: { latest_date: string | null; rows: number } | null;
  coverage?: { latest_date: string | null; rows: number } | null;
  email_capture?: { connections: number; freshest_poll_at: string | null; unhealthy: number } | null;
  /** Partner portal email outbox (Phase 1C): drained every 2 minutes by portal_notify. */
  portal_email?: { pending: number; oldest_pending_at: string | null; failed_7d: number; sent_7d: number } | null;
}

export type CronHealthStatus = "ok" | "stale" | "attention" | "idle";

export interface CronHealthRow {
  job: string;
  status: CronHealthStatus;
  detail: string;
}

/** The Sent-mail poll runs every 2 min; allow slack for a few missed cycles
 *  before calling it stalled. */
export const POLL_STALE_MINUTES = 15;

/** portal_notify runs every 2 min; an email still waiting after this many minutes means it is not running. */
export const PARTNER_EMAIL_STALE_MINUTES = 15;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A nightly snapshot is fresh if its latest date is today or yesterday (the
 *  job runs in the early morning, so "today's hasn't run yet" is normal). */
function nightlySnapshotRow(
  job: string,
  fact: { latest_date: string | null; rows: number } | null | undefined,
  now: Date,
): CronHealthRow {
  const rows = fact?.rows ?? 0;
  const latest = fact?.latest_date ?? null;
  if (rows === 0 || !latest) return { job, status: "idle", detail: "No snapshots yet" };
  const yesterday = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (latest >= yesterday) return { job, status: "ok", detail: `Updated ${latest}` };
  return { job, status: "stale", detail: `Last updated ${latest}` };
}

export function summarizeCronHealth(facts: CronHealthFacts, now: Date = new Date()): CronHealthRow[] {
  const rows: CronHealthRow[] = [
    nightlySnapshotRow("Persistence Index (nightly)", facts.persistence, now),
    nightlySnapshotRow("Coverage rollup (nightly)", facts.coverage, now),
  ];

  const ec = facts.email_capture;
  if (!ec || ec.connections === 0) {
    rows.push({ job: "Email capture poll (2 min)", status: "idle", detail: "No mailboxes connected" });
  } else if (ec.unhealthy > 0) {
    rows.push({
      job: "Email capture poll (2 min)",
      status: "attention",
      detail: `${ec.unhealthy} of ${ec.connections} need reconnect`,
    });
  } else {
    const freshest = ec.freshest_poll_at ? new Date(ec.freshest_poll_at).getTime() : NaN;
    const stalled =
      Number.isNaN(freshest) || now.getTime() - freshest > POLL_STALE_MINUTES * 60 * 1000;
    rows.push(
      stalled
        ? { job: "Email capture poll (2 min)", status: "stale", detail: "Poll not running" }
        : { job: "Email capture poll (2 min)", status: "ok", detail: `Polling; ${ec.connections} connected` },
    );
  }

  const pe = facts.portal_email;
  const partnerJob = "Partner emails (2 min)";
  if (!pe || (pe.pending === 0 && pe.failed_7d === 0 && pe.sent_7d === 0)) {
    rows.push({ job: partnerJob, status: "idle", detail: "No partner emails yet" });
  } else if (pe.failed_7d > 0) {
    rows.push({ job: partnerJob, status: "attention", detail: `${pe.failed_7d} not delivered this week` });
  } else {
    const oldest = pe.oldest_pending_at ? new Date(pe.oldest_pending_at).getTime() : NaN;
    const stuck =
      pe.pending > 0 && (Number.isNaN(oldest) || now.getTime() - oldest > PARTNER_EMAIL_STALE_MINUTES * 60 * 1000);
    rows.push(
      stuck
        ? { job: partnerJob, status: "stale", detail: "Emails waiting to send" }
        : { job: partnerJob, status: "ok", detail: `${pe.sent_7d} sent this week` },
    );
  }
  return rows;
}

/** True when any job needs an operator's eye (stale output or an unhealthy
 *  connection); idle (nothing to do yet) does not count. */
export function cronHealthNeedsAttention(rows: CronHealthRow[]): boolean {
  return rows.some((r) => r.status === "stale" || r.status === "attention");
}
