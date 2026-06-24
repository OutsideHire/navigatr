import { describe, it, expect } from "vitest";
import { computeUnloggedDials, CALL_GRACE_MS } from "./unloggedDials";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("computeUnloggedDials", () => {
  it("excludes a dial that has a Call activity within the 4h grace window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }]; // 1h after the dial
    expect(computeUnloggedDials(dials, calls, now)).toEqual([]);
  });

  it("includes an unmatched dial that is past the grace window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    expect(computeUnloggedDials(dials, [], now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(6 * HOUR), dialCount: 1 },
    ]);
  });

  it("excludes a dial still within the grace window (pending)", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(1 * HOUR) }];
    expect(computeUnloggedDials(dials, [], now)).toEqual([]);
  });

  it("does NOT match a Call activity outside the 4h window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(10 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(2 * HOUR) }]; // 8h after the dial
    expect(computeUnloggedDials(dials, calls, now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(10 * HOUR), dialCount: 1 },
    ]);
  });

  it("does not match a Call activity for a different deal", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d2", occurredAt: ago(5 * HOUR) }];
    expect(computeUnloggedDials(dials, calls, now)).toHaveLength(1);
  });

  it("collapses multiple unmatched dials to one row per deal with a count + latest time", () => {
    const dials = [
      { dealId: "d1", detectedAt: ago(8 * HOUR) },
      { dealId: "d1", detectedAt: ago(6 * HOUR) },
    ];
    expect(computeUnloggedDials(dials, [], now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(6 * HOUR), dialCount: 2 },
    ]);
  });

  it("exports the 4h grace constant", () => {
    expect(CALL_GRACE_MS).toBe(4 * HOUR);
  });

  // ── Boundary conditions (the function's whole contract is its edges) ──

  it("treats a dial exactly at the grace boundary (4h old) as eligible, not pending", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(CALL_GRACE_MS) }];
    expect(computeUnloggedDials(dials, [], now)).toHaveLength(1);
  });

  it("matches a Call activity exactly at the lower edge (== dial time)", () => {
    const detectedAt = ago(6 * HOUR);
    const calls = [{ dealId: "d1", occurredAt: detectedAt }];
    expect(computeUnloggedDials([{ dealId: "d1", detectedAt }], calls, now)).toEqual([]);
  });

  it("matches a Call activity exactly at the upper edge (dial + 4h)", () => {
    const detectedAt = ago(6 * HOUR);
    const upper = new Date(new Date(detectedAt).getTime() + CALL_GRACE_MS).toISOString();
    const calls = [{ dealId: "d1", occurredAt: upper }];
    expect(computeUnloggedDials([{ dealId: "d1", detectedAt }], calls, now)).toEqual([]);
  });

  it("keeps the latest time when a newer dial is encountered before an older one", () => {
    // Reversed input order exercises the dedup retain-branch (no update).
    const dials = [
      { dealId: "d1", detectedAt: ago(6 * HOUR) },
      { dealId: "d1", detectedAt: ago(8 * HOUR) },
    ];
    expect(computeUnloggedDials(dials, [], now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(6 * HOUR), dialCount: 2 },
    ]);
  });

  it("returns empty for no dials", () => {
    expect(computeUnloggedDials([], [], now)).toEqual([]);
  });
});
