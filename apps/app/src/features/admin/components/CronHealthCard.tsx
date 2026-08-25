/**
 * CronHealthCard — operational readout of the automated background jobs on the
 * admin roster. Outcome-based: each job is OK when its output is fresh, so a
 * silently-failing scheduler (the email poll's 401 gateway block was invisible
 * for days) shows up here as "Stale". Admin-only: cron_health() returns {} to
 * non-admins, and the card renders nothing for them.
 */

import { Card } from "@/components/navigatr";
import { useCronHealth } from "../hooks/useCronHealth";
import { summarizeCronHealth, cronHealthNeedsAttention, type CronHealthStatus } from "../lib/cronHealth";

const STATUS_LABEL: Record<CronHealthStatus, string> = {
  ok: "OK",
  stale: "Stale",
  attention: "Attention",
  idle: "Idle",
};

function statusClass(status: CronHealthStatus): string {
  return status === "stale" || status === "attention" ? "text-status-danger" : "text-text-muted";
}

export function CronHealthCard() {
  const { data, isLoading } = useCronHealth();

  // The RPC returns {} to non-admins; only an admin result carries the job
  // keys. Render nothing otherwise so a non-admin never sees a misleading card.
  const isAdminResult = !!data && typeof data === "object" && "persistence" in data;
  if (!isLoading && !isAdminResult) return null;

  const rows = summarizeCronHealth(data ?? {});
  const attention = cronHealthNeedsAttention(rows);

  return (
    <Card padding="md">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-strong text-text-default">Scheduled jobs</h3>
        <p className="text-caption text-text-muted">
          Whether the automated background jobs are running and up to date.
          {attention ? " Something needs attention." : ""}
        </p>
      </div>

      {isLoading ? (
        <p className="mt-4 text-body-sm text-text-muted">Loading…</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.job} className="flex items-center justify-between gap-3 text-caption">
              <span className="min-w-0 truncate text-text-default">{r.job}</span>
              <span className={"shrink-0 " + statusClass(r.status)}>
                {STATUS_LABEL[r.status]} · {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
