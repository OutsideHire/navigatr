import { describe, it, expect } from "vitest";
import { capacitySentence, fullDaySentence } from "./dayCapacity";

describe("capacitySentence", () => {
  it("reads the remaining minutes plainly", () => {
    expect(capacitySentence(50)).toBe("about 50 minutes still open");
  });

  it("rounds to the nearest 10 minutes for a calm reading", () => {
    expect(capacitySentence(52)).toBe("about 50 minutes still open");
  });

  it("never goes negative and handles zero", () => {
    expect(capacitySentence(0)).toBe("about 0 minutes still open");
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
