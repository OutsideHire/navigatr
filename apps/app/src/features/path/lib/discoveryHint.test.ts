import { describe, it, expect } from "vitest";
import { discoveryShortfallHint } from "./discoveryHint";

const base = {
  shown: 25,
  requested: 25,
  requestedRadiusM: 8047,
  effectiveRadiusM: 8047,
  hidden: { chains: 0, inPipeline: 0 },
};

describe("discoveryShortfallHint", () => {
  it("returns null when filled at the requested radius with nothing hidden", () => {
    expect(discoveryShortfallHint(base)).toBeNull();
  });

  it("returns null when filled and nothing hidden, even if some were hidden but count met", () => {
    // Filled at requested radius: stay quiet even if chains existed nearby.
    expect(discoveryShortfallHint({ ...base, hidden: { chains: 4, inPipeline: 1 } })).toBeNull();
  });

  it("reports a plain shortfall with no widening and nothing hidden", () => {
    expect(discoveryShortfallHint({ ...base, shown: 20 })).toBe("Showing 20 of 25 requested");
  });

  it("explains a shortfall with both hidden classes", () => {
    expect(
      discoveryShortfallHint({ ...base, shown: 19, hidden: { chains: 4, inPipeline: 2 } }),
    ).toBe("Showing 19 of 25 requested · 4 chains and 2 already in your pipeline were hidden nearby");
  });

  it("omits the zero hidden part and uses singular for one chain", () => {
    expect(
      discoveryShortfallHint({ ...base, shown: 24, hidden: { chains: 1, inPipeline: 0 } }),
    ).toBe("Showing 24 of 25 requested · 1 chain was hidden nearby");
  });

  it("reports only the in-pipeline part when no chains were hidden", () => {
    expect(
      discoveryShortfallHint({ ...base, shown: 23, hidden: { chains: 0, inPipeline: 2 } }),
    ).toBe("Showing 23 of 25 requested · 2 already in your pipeline were hidden nearby");
  });

  it("notes the widened radius when filled by widening (no shortfall clause)", () => {
    // Widened from 5mi to ~8mi and reached 25: mention the widen, not a shortfall.
    expect(
      discoveryShortfallHint({ ...base, shown: 25, effectiveRadiusM: 12875 }),
    ).toBe("widened to 8 mi");
  });

  it("combines shortfall + widened + hidden", () => {
    expect(
      discoveryShortfallHint({
        shown: 20,
        requested: 25,
        requestedRadiusM: 8047,
        effectiveRadiusM: 40000,
        hidden: { chains: 3, inPipeline: 2 },
      }),
    ).toBe(
      "Showing 20 of 25 requested · widened to 25 mi · 3 chains and 2 already in your pipeline were hidden nearby",
    );
  });
});
