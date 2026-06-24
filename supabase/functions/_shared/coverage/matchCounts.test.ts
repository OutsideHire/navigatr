import { describe, it, expect } from "vitest";
import { countCallDials } from "./matchCounts";
import { CALL_GRACE_MS } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("countCallDials", () => {
  it("counts a past-grace dial as total, matched if a call falls in the window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }];
    expect(countCallDials(dials, calls, now)).toEqual({ totalDials: 1, matchedDials: 1 });
  });
  it("counts an unmatched past-grace dial as total but not matched", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(6 * HOUR) }], [], now)).toEqual({
      totalDials: 1, matchedDials: 0,
    });
  });
  it("excludes a dial still within the grace window from totals", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(1 * HOUR) }], [], now)).toEqual({
      totalDials: 0, matchedDials: 0,
    });
  });
  it("does not match a call outside the 4h window or for another deal", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(10 * HOUR) }];
    expect(countCallDials(dials, [{ dealId: "d1", occurredAt: ago(2 * HOUR) }], now))
      .toEqual({ totalDials: 1, matchedDials: 0 }); // 8h after dial
    expect(countCallDials(dials, [{ dealId: "d2", occurredAt: ago(9 * HOUR) }], now))
      .toEqual({ totalDials: 1, matchedDials: 0 });
  });
  it("matches at the exact window edges", () => {
    const detectedAt = ago(6 * HOUR);
    const upper = new Date(new Date(detectedAt).getTime() + CALL_GRACE_MS).toISOString();
    expect(countCallDials([{ dealId: "d1", detectedAt }], [{ dealId: "d1", occurredAt: detectedAt }], now).matchedDials).toBe(1);
    expect(countCallDials([{ dealId: "d1", detectedAt }], [{ dealId: "d1", occurredAt: upper }], now).matchedDials).toBe(1);
  });
  it("treats a dial exactly at grace age as counted (not pending)", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(CALL_GRACE_MS) }], [], now).totalDials).toBe(1);
  });
  it("returns zeros for no dials", () => {
    expect(countCallDials([], [], now)).toEqual({ totalDials: 0, matchedDials: 0 });
  });
});
