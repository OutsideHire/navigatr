import { describe, it, expect } from "vitest";
import { formatConversion, formatPortalDate, formatPortalMoney } from "./portalFormat";

describe("portal formatting", () => {
  it("formats dates for a phone screen", () => {
    expect(formatPortalDate("2026-10-05T12:00:00Z")).toBe("Oct 5, 2026");
    expect(formatPortalDate("not a date")).toBe("");
  });

  it("formats cents as whole dollars", () => {
    expect(formatPortalMoney(500000)).toBe("$5,000");
    expect(formatPortalMoney(0)).toBe("$0");
  });

  it("formats conversion, or says nothing has closed", () => {
    expect(formatConversion(0.5)).toBe("50%");
    expect(formatConversion(1 / 3)).toBe("33%");
    expect(formatConversion(null)).toBe("No closed referrals yet");
  });
});
