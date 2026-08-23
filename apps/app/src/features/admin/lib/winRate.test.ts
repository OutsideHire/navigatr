import { describe, it, expect } from "vitest";
import { formatWinRate, winRatio, hasWinRate, WIN_RATE_MIN_CLOSED } from "./winRate";

describe("formatWinRate (FR-HIER-30 volume floor)", () => {
  it("dashes below the closed-deal floor, even at a perfect record", () => {
    expect(formatWinRate(3, 0)).toBe("—"); // 3 wins, 0 losses -> not 100%
    expect(formatWinRate(0, 0)).toBe("—");
    expect(formatWinRate(4, 0)).toBe("—"); // 4 closed < floor of 5
    expect(hasWinRate(3, 0)).toBe(false);
  });
  it("shows a whole-percent rate at or above the floor", () => {
    expect(formatWinRate(5, 0)).toBe("100%"); // exactly the floor
    expect(formatWinRate(3, 3)).toBe("50%");
    expect(formatWinRate(7, 3)).toBe("70%");
    expect(hasWinRate(5, 0)).toBe(true);
  });
  it("floor is 5 closed deals", () => {
    expect(WIN_RATE_MIN_CLOSED).toBe(5);
  });
});

describe("winRatio (sorting)", () => {
  it("is -1 with no closed deals and the raw ratio otherwise", () => {
    expect(winRatio(0, 0)).toBe(-1);
    expect(winRatio(3, 1)).toBeCloseTo(0.75);
  });
});
