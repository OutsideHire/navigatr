import { describe, it, expect } from "vitest";
import { summarizeCaptureHealth } from "./captureHealth";

describe("summarizeCaptureHealth", () => {
  it("computes total + % captured + ordered labeled breakdown", () => {
    const s = summarizeCaptureHealth([
      { capture_status: "no_geostamp", activity_count: 1 },
      { capture_status: "captured", activity_count: 6 },
      { capture_status: "permission_denied", activity_count: 3 },
    ]);
    expect(s.total).toBe(10);
    expect(s.captured).toBe(6);
    expect(s.pctCaptured).toBe(60);
    // captured first, no_geostamp last per STATUS_ORDER
    expect(s.breakdown.map((b) => b.status)).toEqual(["captured", "permission_denied", "no_geostamp"]);
    expect(s.breakdown[0].label).toBe("Captured");
  });
  it("is 0% with no activities", () => {
    const s = summarizeCaptureHealth([]);
    expect(s).toMatchObject({ total: 0, captured: 0, pctCaptured: 0, breakdown: [] });
  });
  it("coerces string counts from PostgREST bigint", () => {
    const s = summarizeCaptureHealth([{ capture_status: "captured", activity_count: "4" as unknown as number }]);
    expect(s.total).toBe(4);
    expect(s.pctCaptured).toBe(100);
  });
});
