import { describe, it, expect } from "vitest";
import { minutesToTimeValue, timeValueToMinutes, endOfDayLabel } from "./endOfDayControl";

describe("minutesToTimeValue", () => {
  it("formats the 5pm default", () => {
    expect(minutesToTimeValue(17 * 60)).toBe("17:00");
  });
  it("zero-pads hours and minutes", () => {
    expect(minutesToTimeValue(9 * 60 + 30)).toBe("09:30");
    expect(minutesToTimeValue(0)).toBe("00:00");
  });
  it("rounds fractional minutes", () => {
    expect(minutesToTimeValue(570.6)).toBe("09:31");
  });
  it("clamps out-of-range values into the day", () => {
    expect(minutesToTimeValue(-5)).toBe("00:00");
    expect(minutesToTimeValue(24 * 60)).toBe("23:59");
    expect(minutesToTimeValue(99 * 60)).toBe("23:59");
  });
});

describe("timeValueToMinutes", () => {
  it("parses a well-formed time", () => {
    expect(timeValueToMinutes("17:00")).toBe(1020);
    expect(timeValueToMinutes("09:30")).toBe(570);
    expect(timeValueToMinutes("00:00")).toBe(0);
  });
  it("tolerates a single-digit hour", () => {
    expect(timeValueToMinutes("9:30")).toBe(570);
  });
  it("returns null for blank or garbage", () => {
    expect(timeValueToMinutes("")).toBeNull();
    expect(timeValueToMinutes("nope")).toBeNull();
    expect(timeValueToMinutes("17")).toBeNull();
    expect(timeValueToMinutes("17:0")).toBeNull();
  });
  it("returns null for out-of-range parts", () => {
    expect(timeValueToMinutes("24:00")).toBeNull();
    expect(timeValueToMinutes("17:60")).toBeNull();
    expect(timeValueToMinutes("-1:00")).toBeNull();
  });
  it("round-trips with minutesToTimeValue", () => {
    for (const m of [0, 570, 1020, 1439]) {
      expect(timeValueToMinutes(minutesToTimeValue(m))).toBe(m);
    }
  });
});

describe("endOfDayLabel", () => {
  it("renders a friendly clock label", () => {
    expect(endOfDayLabel(17 * 60)).toBe("5:00 PM");
    expect(endOfDayLabel(9 * 60 + 30)).toBe("9:30 AM");
    expect(endOfDayLabel(12 * 60)).toBe("12:00 PM");
    expect(endOfDayLabel(0)).toBe("12:00 AM");
  });
});
