import { describe, it, expect } from "vitest";
import { buildSnapshotRow } from "./buildSnapshot";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const win = { snapshotDate: "2026-06-24", windowStartDate: "2026-05-25", windowEndDate: "2026-06-24" };

describe("buildSnapshotRow", () => {
  it("builds a call-channel snapshot row from dials + calls", () => {
    const dials = [
      { dealId: "d1", detectedAt: ago(6 * HOUR) }, // matched
      { dealId: "d2", detectedAt: ago(6 * HOUR) }, // unmatched
    ];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }];
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win,
      dials, calls, config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row).toEqual({
      org_id: "org-1", user_id: "u1", snapshot_date: "2026-06-24",
      composite_coverage: 0.5, confidence_level: "insufficient", // 2 dials < min 20
      call_coverage: 0.5, call_event_count: 2,
      active_channels: ["phone"],
      window_start_date: "2026-05-25", window_end_date: "2026-06-24",
    });
  });

  it("returns null when there are no gradeable (past-grace) dials", () => {
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win,
      dials: [{ dealId: "d1", detectedAt: ago(1 * HOUR) }], // still pending
      calls: [], config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row).toBeNull();
  });

  it("reports low confidence once call volume meets the minimum", () => {
    const dials = Array.from({ length: 20 }, (_, i) => ({ dealId: `d${i}`, detectedAt: ago(6 * HOUR) }));
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win, dials, calls: [], config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row?.confidence_level).toBe("low");
    expect(row?.composite_coverage).toBe(0); // none matched
    expect(row?.call_event_count).toBe(20);
  });

  it("yields full coverage when the only gradeable dial is matched (totalDials=1 boundary)", () => {
    // Also guards the non-null composite invariant the `as number` cast relies on:
    // a single gradeable dial must still produce a real composite, not null.
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win,
      dials: [{ dealId: "d1", detectedAt: ago(6 * HOUR) }],
      calls: [{ dealId: "d1", occurredAt: ago(5 * HOUR) }],
      config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row?.composite_coverage).toBe(1);
    expect(row?.call_coverage).toBe(1);
    expect(row?.call_event_count).toBe(1);
  });
});
