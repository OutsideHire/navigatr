import { describe, it, expect } from "vitest";
import {
  leadSourceSetBy,
  isLeadSourceEditable,
  isKnownLeadSource,
  leadSourceLabel,
  leadSourceRequiresNote,
  REP_PICKABLE_SOURCES,
  REP_SOURCE_OPTIONS,
} from "./leadSources";

describe("leadSourceSetBy", () => {
  it("classifies the four system sources as system", () => {
    for (const v of ["path", "partner_referral", "assigned", "import"]) {
      expect(leadSourceSetBy(v)).toBe("system");
    }
  });
  it("classifies the rep picklist as rep", () => {
    for (const v of REP_PICKABLE_SOURCES) expect(leadSourceSetBy(v)).toBe("rep");
  });
  it("treats unknown/blank/null as unknown", () => {
    expect(leadSourceSetBy("unknown")).toBe("unknown");
    expect(leadSourceSetBy("")).toBe("unknown");
    expect(leadSourceSetBy(null)).toBe("unknown");
    expect(leadSourceSetBy(undefined)).toBe("unknown");
  });
});

describe("isLeadSourceEditable (set-once-lock)", () => {
  it("is editable only while Other or Unknown (or unset)", () => {
    expect(isLeadSourceEditable("other")).toBe(true);
    expect(isLeadSourceEditable("unknown")).toBe(true);
    expect(isLeadSourceEditable(null)).toBe(true);
    expect(isLeadSourceEditable("")).toBe(true);
  });
  it("is locked for any concrete source", () => {
    expect(isLeadSourceEditable("path")).toBe(false);
    expect(isLeadSourceEditable("partner_referral")).toBe(false);
    expect(isLeadSourceEditable("self_sourced_canvass")).toBe(false);
    expect(isLeadSourceEditable("inbound")).toBe(false);
  });
});

describe("labels + guards", () => {
  it("labels known values and falls back to Unknown", () => {
    expect(leadSourceLabel("self_sourced_canvass")).toBe("Self-Sourced Canvass");
    expect(leadSourceLabel("partner_referral")).toBe("Partner Referral");
    expect(leadSourceLabel("cold_outreach")).toBe("Unknown"); // legacy/unmapped
    expect(leadSourceLabel(null)).toBe("Unknown");
  });
  it("isKnownLeadSource narrows correctly", () => {
    expect(isKnownLeadSource("path")).toBe(true);
    expect(isKnownLeadSource("nope")).toBe(false);
    expect(isKnownLeadSource(null)).toBe(false);
  });
  it("only Other requires a note", () => {
    expect(leadSourceRequiresNote("other")).toBe(true);
    expect(leadSourceRequiresNote("inbound")).toBe(false);
    expect(leadSourceRequiresNote("path")).toBe(false);
  });
  it("rep options exclude the system sources and Unknown", () => {
    const values = REP_SOURCE_OPTIONS.map((o) => o.value);
    expect(values).not.toContain("path");
    expect(values).not.toContain("partner_referral");
    expect(values).not.toContain("unknown");
    expect(values).toContain("other");
    expect(REP_SOURCE_OPTIONS).toHaveLength(5);
  });
});
