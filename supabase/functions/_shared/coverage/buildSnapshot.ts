/**
 * SP1 per-rep snapshot row builder. Pure: composes countCallDials + scoring
 * into the coverage_snapshot insert payload. Returns null when the rep has no
 * gradeable (past-grace) dials in the window — those reps get no snapshot.
 */
import { type CallActivity, countCallDials, type DialSignal } from "./matchCounts.ts";
import { callCoverage, composite, confidence } from "./score.ts";
import type { ConfidenceLevel, CoverageConfig } from "./config.ts";

export interface BuildSnapshotInput {
  orgId: string;
  userId: string;
  snapshotDate: string;
  windowStartDate: string;
  windowEndDate: string;
  dials: DialSignal[];
  calls: CallActivity[];
  config: CoverageConfig;
  now: Date;
}

export interface CoverageSnapshotRow {
  org_id: string;
  user_id: string;
  snapshot_date: string;
  composite_coverage: number;
  confidence_level: ConfidenceLevel;
  call_coverage: number | null;
  call_event_count: number;
  active_channels: string[];
  window_start_date: string;
  window_end_date: string;
}

export function buildSnapshotRow(input: BuildSnapshotInput): CoverageSnapshotRow | null {
  const { totalDials, matchedDials } = countCallDials(input.dials, input.calls, input.now);
  if (totalDials === 0) return null; // nothing gradeable → no snapshot

  const cc = callCoverage(matchedDials, totalDials);
  const comp = composite([{ coverage: cc, eventCount: totalDials }]);
  const conf = confidence([{ channel: "call", eventCount: totalDials }], input.config);

  return {
    org_id: input.orgId,
    user_id: input.userId,
    snapshot_date: input.snapshotDate,
    composite_coverage: comp as number, // non-null: totalDials > 0
    confidence_level: conf,
    call_coverage: cc,
    call_event_count: totalDials,
    // 'phone' is the surfaced channel label (matches coverage_signal.channel);
    // confidence keys on 'call' (the activity/metric vocabulary). Both denote the
    // call channel — see config.ts. SP1 always has exactly this one channel.
    active_channels: ["phone"],
    window_start_date: input.windowStartDate,
    window_end_date: input.windowEndDate,
  };
}
