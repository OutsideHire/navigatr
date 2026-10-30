import { describe, it, expect } from "vitest";
import {
  NAVIGATR_PORTAL_TERMS_TEXT,
  NAVIGATR_PORTAL_TERMS_TITLE,
  NAVIGATR_PORTAL_TERMS_VERSION,
  navigatrTermsCurrent,
} from "./portalNavigatrTerms";

describe("navigatr Referral Portal Terms", () => {
  it("carries the approved wording with all seven numbered terms, title kept out of the body", () => {
    expect(NAVIGATR_PORTAL_TERMS_TITLE).toBe("Navigatr Referral Portal Terms");
    expect(NAVIGATR_PORTAL_TERMS_TEXT.startsWith("By accessing or using the Navigatr Referral Portal")).toBe(true);
    expect(NAVIGATR_PORTAL_TERMS_TEXT).not.toContain(NAVIGATR_PORTAL_TERMS_TITLE);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(NAVIGATR_PORTAL_TERMS_TEXT).toMatch(new RegExp(`^${n}\\. `, "m"));
    expect(NAVIGATR_PORTAL_TERMS_TEXT).toContain(
      "6. Platform Role: Navigatr provides the technology supporting referral exchanges but does not guarantee referral acceptance, conversion, or resulting business opportunities.",
    );
    expect(NAVIGATR_PORTAL_TERMS_TEXT).not.toMatch(/[\u2013\u2014]/);
  });

  it("has a date version", () => {
    expect(NAVIGATR_PORTAL_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is current only for the exact current version", () => {
    expect(navigatrTermsCurrent(NAVIGATR_PORTAL_TERMS_VERSION)).toBe(true);
    for (const v of [null, undefined, "", "2026-01-01", 20261030, ` ${NAVIGATR_PORTAL_TERMS_VERSION}`]) {
      expect(navigatrTermsCurrent(v)).toBe(false);
    }
  });
});
