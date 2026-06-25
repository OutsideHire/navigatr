/**
 * SP2b team coverage rollup — types + the pure team-headline aggregator. Reuses
 * the shared composite()/band() so the team number is volume-weighted exactly
 * like a single rep's composite. A rep counts toward the headline only with a
 * gradeable snapshot (non-null composite AND confidence != "insufficient").
 */
import { band, composite } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG, type Band, type ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface CoverageRollupRow {
  userId: string;
  fullName: string | null;
  role: "rep" | "manager" | "admin";
  snapshotDate: string | null;
  compositeCoverage: number | null;
  confidenceLevel: ConfidenceLevel | null;
  callCoverage: number | null;
  callEventCount: number | null;
  activeChannels: string[];
}

export interface TeamCoverage {
  compositeCoverage: number | null;
  band: Band | null;
  repsWithData: number;
  repsTotal: number;
}

/** A rep contributes to the team headline only with a gradeable snapshot. */
export function isGradeable(r: CoverageRollupRow): boolean {
  return r.compositeCoverage !== null && r.confidenceLevel !== "insufficient";
}

export function teamCoverage(rows: CoverageRollupRow[]): TeamCoverage {
  const gradeable = rows.filter(isGradeable);
  // SP2b weights the team headline by call_event_count. Correct while coverage
  // is single-channel (call): a gradeable rep necessarily has call_event_count
  // ≥ the call minimum (> 0), so none drop out, and compositeCoverage == call.
  // When multi-channel lands (SP3+), weight by a per-rep TOTAL event count
  // instead — else a gradeable rep with non-call-only activity (callEventCount
  // 0/null) would count in repsWithData but contribute 0 to the number.
  const comp = composite(
    gradeable.map((r) => ({ coverage: r.compositeCoverage, eventCount: r.callEventCount ?? 0 })),
  );
  return {
    compositeCoverage: comp,
    band: comp === null ? null : band(comp, DEFAULT_COVERAGE_CONFIG.bandThresholds),
    repsWithData: gradeable.length,
    repsTotal: rows.length,
  };
}
