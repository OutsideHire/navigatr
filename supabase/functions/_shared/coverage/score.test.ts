import { describe, it, expect } from "vitest";
import { callCoverage, composite, confidence, band } from "./score";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

describe("callCoverage", () => {
  it("is matched / total", () => expect(callCoverage(3, 4)).toBe(0.75));
  it("is null when total is 0", () => expect(callCoverage(0, 0)).toBeNull());
});

describe("composite", () => {
  it("is the single channel's coverage when only one is active", () => {
    expect(composite([{ coverage: 0.6, eventCount: 200 }])).toBe(0.6);
  });
  it("volume-weights across channels and ignores null-coverage ones", () => {
    expect(composite([
      { coverage: 0.8, eventCount: 200 },
      { coverage: 0.3, eventCount: 5 },
      { coverage: null, eventCount: 0 },
    ])).toBeCloseTo((0.8 * 200 + 0.3 * 5) / 205, 6);
  });
  it("is null when no channel is active", () => expect(composite([])).toBeNull());
});

describe("confidence", () => {
  const cfg = DEFAULT_COVERAGE_CONFIG; // min call = 20
  it("is insufficient with no active channels", () => {
    expect(confidence([], cfg)).toBe("insufficient");
  });
  it("is low with one active channel at/above its minimum", () => {
    expect(confidence([{ channel: "call", eventCount: 20 }], cfg)).toBe("low");
  });
  it("is insufficient when the only channel is below its minimum", () => {
    expect(confidence([{ channel: "call", eventCount: 19 }], cfg)).toBe("insufficient");
  });
  it("is medium with two active channels above minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 30 },
    ], cfg)).toBe("medium");
  });
  it("is high with three active channels above minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 30 },
      { channel: "meeting", eventCount: 30 },
    ], cfg)).toBe("high");
  });
  it("demotes high to medium when one of three channels is below minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 30 },
      { channel: "meeting", eventCount: 1 }, // below min 5
    ], cfg)).toBe("medium");
  });
  it("demotes medium to low when one of two channels is below minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 1 }, // below min 20
    ], cfg)).toBe("low");
  });
});

describe("band", () => {
  const t = DEFAULT_COVERAGE_CONFIG.bandThresholds;
  it("maps each tier incl. exact boundaries", () => {
    expect(band(0.95, t)).toBe("excellent");
    expect(band(0.90, t)).toBe("excellent");
    expect(band(0.89, t)).toBe("good");
    expect(band(0.75, t)).toBe("good");
    expect(band(0.60, t)).toBe("adequate");
    expect(band(0.59, t)).toBe("poor");
    expect(band(0.40, t)).toBe("poor");
    expect(band(0.39, t)).toBe("unreliable");
  });
});
