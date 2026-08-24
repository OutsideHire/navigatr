/**
 * Email-connection-health summary (Email Capture Phase 1, Slice 5d). Turns the
 * email_connection_health RPC rows (one per rep's Outlook connection) into an
 * operational readout: how many connections are healthy vs. need attention,
 * plus per-row labels/derived flags for the admin card. A connection needs
 * attention when its health is not 'ok' OR it has gone stale (no successful
 * poll within the staleness window). Pure so the display logic is unit-tested.
 */

export interface EmailConnectionHealthRow {
  user_id: string;
  rep_name: string | null;
  provider: string;
  health: string; // 'ok' | 'needs_reauth' | 'error'
  last_poll_at: string | null;
  capture_start_date: string;
  last_error: string | null;
}

export interface AnnotatedConnection extends EmailConnectionHealthRow {
  /** No successful poll within the staleness window (or never polled). */
  stale: boolean;
  /** Healthy AND not stale. */
  healthy: boolean;
  /** Short operator-facing status: "Connected" | "Needs reconnect" | "Error" | "Idle". */
  statusLabel: string;
}

export interface EmailConnectionHealthSummary {
  total: number;
  healthy: number;
  attention: number; // total - healthy
  rows: AnnotatedConnection[];
}

const HEALTH_LABEL: Record<string, string> = {
  needs_reauth: "Needs reconnect",
  error: "Error",
};

/** Hours since the last successful poll beyond which a connection reads as idle. */
export const STALE_POLL_HOURS = 24;

function isStale(lastPollAt: string | null, now: Date, staleHours: number): boolean {
  if (!lastPollAt) return true;
  const last = new Date(lastPollAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > staleHours * 3600_000;
}

export function summarizeEmailConnectionHealth(
  rows: EmailConnectionHealthRow[],
  now: Date = new Date(),
  staleHours: number = STALE_POLL_HOURS,
): EmailConnectionHealthSummary {
  const annotated: AnnotatedConnection[] = rows.map((r) => {
    const stale = isStale(r.last_poll_at, now, staleHours);
    const healthOk = r.health === "ok";
    const healthy = healthOk && !stale;
    const statusLabel = !healthOk
      ? HEALTH_LABEL[r.health] ?? "Error"
      : stale
        ? "Idle"
        : "Connected";
    return { ...r, stale, healthy, statusLabel };
  });
  const healthy = annotated.filter((r) => r.healthy).length;
  return {
    total: annotated.length,
    healthy,
    attention: annotated.length - healthy,
    rows: annotated,
  };
}
