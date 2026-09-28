import { describe, it, expect } from "vitest";
import { buildBlockedSentence, capacitySentence, fullDaySentence } from "./dayCapacity";

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

describe("buildBlockedSentence", () => {
  const at6 = { endHour: 18, minutesLeft: 0 };

  it("tells a rep with nothing nearby that widening is the move", () => {
    expect(buildBlockedSentence("pool-empty", { endHour: 18, minutesLeft: 240 })).toMatch(
      /couldn't find any businesses near you/i,
    );
  });

  it("tells a rep who used up the pool that there is nothing left, without blaming the search", () => {
    const s = buildBlockedSentence("pool-exhausted", { endHour: 18, minutesLeft: 240 });
    expect(s).toMatch(/already been through everything nearby/i);
    expect(s).not.toMatch(/couldn't find/i);
  });

  it("names the workday end when the day is over, and points at the setting", () => {
    const s = buildBlockedSentence("budget-exhausted", at6);
    expect(s).toMatch(/end at 6:00/);
    expect(s).toMatch(/Path settings/);
  });

  it("distinguishes 'day is over' from 'not quite enough time left'", () => {
    const over = buildBlockedSentence("budget-exhausted", at6);
    const tight = buildBlockedSentence("budget-exhausted", { endHour: 18, minutesLeft: 10 });
    expect(tight).not.toBe(over);
    expect(tight).toMatch(/enough time left before 6:00/i);
  });
});
