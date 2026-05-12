import { describe, it, expect } from "vitest";
import { formatMoney, MOCK_DEALS, STAGE_BAND_COLOR, STAGE_BADGE_KIND } from "./mockData";

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
