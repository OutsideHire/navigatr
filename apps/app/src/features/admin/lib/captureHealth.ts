/**
 * Capture-health summary (PRD 6.12.A Bundle 5, FR-HIER-37). Turns the
 * location_capture_health RPC rows (count of logged activities by geostamp
 * capture_status, incl. a 'no_geostamp' bucket) into an operational readout:
 * the total, the % actually captured, and an ordered, labeled breakdown.
 */

export interface CaptureHealthRow {
  capture_status: string;
  activity_count: number;
}

export interface CaptureHealthSummary {
  total: number;
  captured: number;
  pctCaptured: number; // whole percent, 0 when no activities
  breakdown: { status: string; label: string; count: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  captured: "Captured",
  permission_denied: "Permission denied",
  timed_out: "Timed out",
  unavailable: "Unavailable",
  unsupported: "Unsupported",
  no_geostamp: "No stamp",
};

// Stable display order, worst-to-explain last.
const STATUS_ORDER = [
  "captured",
  "permission_denied",
  "timed_out",
  "unavailable",
  "unsupported",
  "no_geostamp",
];

export function summarizeCaptureHealth(rows: CaptureHealthRow[]): CaptureHealthSummary {
  const byStatus = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.activity_count) || 0;
    byStatus.set(r.capture_status, (byStatus.get(r.capture_status) ?? 0) + n);
    total += n;
  }
  const captured = byStatus.get("captured") ?? 0;
  const breakdown = STATUS_ORDER.filter((s) => byStatus.has(s)).map((s) => ({
    status: s,
    label: STATUS_LABEL[s] ?? s,
    count: byStatus.get(s)!,
  }));
  return {
    total,
    captured,
    pctCaptured: total === 0 ? 0 : Math.round((captured / total) * 100),
    breakdown,
  };
}
