import { describe, it, expect } from "vitest";
import { computeFreeWindows, type Interval } from "./freeWindows";

const W_START = "2026-07-03T13:00:00.000Z"; // 8:00 AM local example
const W_END = "2026-07-03T23:00:00.000Z";   // 6:00 PM local example

describe("computeFreeWindows", () => {
  it("no occupied spans → single free window spanning the day", () => {
    expect(computeFreeWindows(W_START, W_END, [])).toEqual([{ start: W_START, end: W_END }]);
  });
  it("one mid-day span → two free windows around it", () => {
    const occ: Interval[] = [{ start: "2026-07-03T15:00:00.000Z", end: "2026-07-03T16:00:00.000Z" }];
    expect(computeFreeWindows(W_START, W_END, occ)).toEqual([
      { start: W_START, end: "2026-07-03T15:00:00.000Z" },
      { start: "2026-07-03T16:00:00.000Z", end: W_END },
    ]);
  });
  it("merges overlapping/adjacent spans before subtracting", () => {
    const occ: Interval[] = [
      { start: "2026-07-03T15:00:00.000Z", end: "2026-07-03T16:00:00.000Z" },
      { start: "2026-07-03T15:30:00.000Z", end: "2026-07-03T17:00:00.000Z" },
    ];
    expect(computeFreeWindows(W_START, W_END, occ)).toEqual([
      { start: W_START, end: "2026-07-03T15:00:00.000Z" },
      { start: "2026-07-03T17:00:00.000Z", end: W_END },
    ]);
  });
  it("clamps spans to the window and drops zero-length gaps", () => {
    const occ: Interval[] = [
      { start: "2026-07-03T12:00:00.000Z", end: W_START },
      { start: W_END, end: "2026-07-04T00:00:00.000Z" },
    ];
    expect(computeFreeWindows(W_START, W_END, occ)).toEqual([{ start: W_START, end: W_END }]);
  });
  it("span covering the whole window → no free windows", () => {
    const occ: Interval[] = [{ start: W_START, end: W_END }];
    expect(computeFreeWindows(W_START, W_END, occ)).toEqual([]);
  });
});
