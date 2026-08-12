import { describe, it, expect } from "vitest";
import { capacitySentence, fullDaySentence } from "./dayCapacity";

describe("capacitySentence", () => {
  it("reads the remaining minutes plainly, hedged with 'about'", () => {
    // Exactly a quarter-hour boundary reads back unchanged.
    expect(capacitySentence(45)).toBe("about 45 minutes still open");
  });

  it("rounds DOWN to the nearest quarter hour when below the half-quarter", () => {
    // 50 is closer to 45 than to 60 -> 45 (spec: '50 -> 45', never '47').
    expect(capacitySentence(50)).toBe("about 45 minutes still open");
    expect(capacitySentence(52)).toBe("about 45 minutes still open");
  });

  it("rounds UP to the nearest quarter hour when at/above the half-quarter", () => {
    // 53 is closer to 60 than to 45 -> 60.
    expect(capacitySentence(53)).toBe("about 60 minutes still open");
  });

  it("rounds at the quarter-hour boundaries", () => {
    // round(7/15) = 0, round(8/15) = 1 -> 15.
    expect(capacitySentence(7)).toBe("about 0 minutes still open");
    expect(capacitySentence(8)).toBe("about 15 minutes still open");
    // The 22/23 boundary between 15 and 30.
    expect(capacitySentence(22)).toBe("about 15 minutes still open");
    expect(capacitySentence(23)).toBe("about 30 minutes still open");
  });

  it("never goes negative and handles zero", () => {
    expect(capacitySentence(0)).toBe("about 0 minutes still open");
    expect(capacitySentence(-30)).toBe("about 0 minutes still open");
  });
});

describe("fullDaySentence", () => {
  it("formats a 24h window end as a plain clock time", () => {
    expect(fullDaySentence(18)).toBe("that's a full day, nothing else fits before 6:00");
  });

  it("formats a 5pm end", () => {
    expect(fullDaySentence(17)).toBe("that's a full day, nothing else fits before 5:00");
  });
});
