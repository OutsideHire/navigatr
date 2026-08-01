import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatRelative,
  MOCK_DEALS,
  STAGE_BAND_COLOR,
  STAGE_BADGE_KIND,
  STAGE_NEXT_VERB,
  STAGE_LABEL,
  STAGE_DEFAULT_PROBABILITY,
  STAGE_TONE,
  STAGE_CHIP_COUNTS,
} from "./mockData";

describe("formatMoney", () => {
  it("scales to $K above 1,000", () => {
    expect(formatMoney(800_000)).toBe("$8K");        // 8_000 dollars
    expect(formatMoney(16_300_000)).toBe("$163K");
  });

  it("scales to $M above 1,000,000", () => {
    expect(formatMoney(150_000_000)).toBe("$1.5M");  // 1.5M dollars
  });

  it("renders sub-1K values with locale commas", () => {
    expect(formatMoney(85_000)).toBe("$850");
  });
});

describe("stage → token maps", () => {
  it("covers every stage referenced by mock deals", () => {
    const stagesUsed = new Set(MOCK_DEALS.map((d) => d.stage));
    for (const stage of stagesUsed) {
      expect(STAGE_BAND_COLOR[stage]).toBeDefined();
      expect(STAGE_BADGE_KIND[stage]).toBeDefined();
    }
  });

  it("maps Won deals to success / status-won (the regression-prone pair)", () => {
    expect(STAGE_BAND_COLOR.won).toBe("success");
    expect(STAGE_BADGE_KIND.won).toBe("stage-won");
  });
});

// Regression: formatRelative used to anchor against TODAY (the hardcoded
// mock date 2026-04-30). For any real deal created after that anchor,
// `formatRelative(deal.lastActivity)` rendered "in 19d" / "in 30d" —
// future tense for a past event. The fix takes `now` as a parameter
// defaulting to current time; this test pins the contract.
describe("formatRelative", () => {
  it("renders past events with 'ago' suffix when now is provided", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(formatRelative("2026-05-17T12:00:00Z", now)).toBe("2d ago");
  });

  it("renders today/yesterday/tomorrow as words", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(formatRelative("2026-05-19T11:00:00Z", now)).toBe("today");
    expect(formatRelative("2026-05-18T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-05-20T12:00:00Z", now)).toBe("tomorrow");
  });

  it("defaults `now` to current time when omitted — so real deals don't render as future events", () => {
    // The bug was: a deal created right now would format relative to
    // the TODAY mock anchor (Apr 30 2026), producing "in 19d". With the
    // default-now fix, it should be "today" instead.
    const nowIso = new Date().toISOString();
    expect(formatRelative(nowIso)).toBe("today");
  });
});

describe("STAGE_NEXT_VERB", () => {
  it("has a default verb for every stage so DealCard never shows blank action text", () => {
    const stages = ["new", "contacted", "qualified", "proposal", "submitted", "won"] as const;
    for (const s of stages) {
      expect(STAGE_NEXT_VERB[s]).toMatch(/\w+/);
    }
  });
});

// Regression: the 'submitted' stage (merchant "application submitted",
// addendum 3.3.B.12) was added between proposal and won. Every stage-aware
// map in mockData.ts must carry a 'submitted' entry or the app isn't
// exhaustive for the new stage.
describe("'submitted' stage", () => {
  it("has a label", () => {
    expect(STAGE_LABEL.submitted).toBe("Negotiation");
  });

  it("has a default probability between proposal's and won's", () => {
    expect(STAGE_DEFAULT_PROBABILITY.submitted).toBe(85);
    expect(STAGE_DEFAULT_PROBABILITY.submitted).toBeGreaterThan(STAGE_DEFAULT_PROBABILITY.proposal);
    expect(STAGE_DEFAULT_PROBABILITY.submitted).toBeLessThan(STAGE_DEFAULT_PROBABILITY.won);
  });

  it("is present in every stage-aware map", () => {
    expect(STAGE_BADGE_KIND.submitted).toBe("stage-submitted");
    expect(STAGE_BAND_COLOR.submitted).toBeDefined();
    expect(STAGE_TONE.submitted).toBeDefined();
    expect(STAGE_NEXT_VERB.submitted).toMatch(/\w+/);
    expect(STAGE_CHIP_COUNTS.submitted).toBeDefined();
  });
});
