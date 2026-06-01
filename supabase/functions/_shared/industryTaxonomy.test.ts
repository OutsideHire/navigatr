import { describe, it, expect } from "vitest";
import {
  INDUSTRIES,
  INDUSTRY_KEYS,
  TIER_1_KEYS,
  TIER_2_KEYS,
  ALL_FETCHABLE_KEYS,
  searchableTypes,
  bucketForType,
  SEARCH_UNSUPPORTED_TYPES,
  type IndustryKey,
} from "./industryTaxonomy";

describe("INDUSTRIES config", () => {
  it("has the 13 keys incl 'other' and a label + order for each", () => {
    expect(INDUSTRY_KEYS).toHaveLength(13);
    for (const k of INDUSTRY_KEYS) {
      expect(INDUSTRIES[k].label.length).toBeGreaterThan(0);
      expect(typeof INDUSTRIES[k].order).toBe("number");
    }
  });

  it("tiers: Tier 1 = the 5 core B2B families; 'other' is in no fetchable tier", () => {
    expect(new Set(TIER_1_KEYS)).toEqual(
      new Set(["manufacturing", "construction_trades", "healthcare", "professional_services", "automotive"]),
    );
    expect(ALL_FETCHABLE_KEYS).toEqual([...TIER_1_KEYS, ...TIER_2_KEYS]);
    expect(ALL_FETCHABLE_KEYS).not.toContain("other");
    expect(ALL_FETCHABLE_KEYS).toHaveLength(12);
  });

  it("Tier-1 core includes manufacturer/supplier (previously missing)", () => {
    expect(INDUSTRIES.manufacturing.includedTypes).toEqual(
      expect.arrayContaining(["manufacturer", "supplier", "corporate_office"]),
    );
  });

  it("automotive drops Table-A Exclude types (car_rental, truck_dealer)", () => {
    expect(INDUSTRIES.automotive.includedTypes).not.toContain("car_rental");
    expect(INDUSTRIES.automotive.includedTypes).not.toContain("truck_dealer");
  });
});

describe("searchableTypes", () => {
  it("strips Table B unsupported types (general_contractor)", () => {
    expect(SEARCH_UNSUPPORTED_TYPES.has("general_contractor")).toBe(true);
    expect(searchableTypes("construction_trades")).not.toContain("general_contractor");
  });
  it("returns the industry's other types intact", () => {
    expect(searchableTypes("healthcare")).toContain("dental_clinic");
  });
});

describe("bucketForType", () => {
  it("maps a known type to its industry", () => {
    expect(bucketForType(["dental_clinic"])).toBe("healthcare");
    expect(bucketForType(["manufacturer"])).toBe("manufacturing");
  });
  it("prefers primaryType over the types array", () => {
    expect(bucketForType(["bar"], "doctor")).toBe("healthcare");
  });
  it("resolves overlaps by Tier-1-first precedence", () => {
    // hardware_store is in BOTH construction_trades (Tier 1) and retail (Tier 2)
    expect(bucketForType(["hardware_store"])).toBe("construction_trades");
    // accounting is in BOTH professional_services (Tier 1) and finance_banking (Tier 2)
    expect(bucketForType(["accounting"])).toBe("professional_services");
  });
  it("falls back to 'other' for unknown/empty", () => {
    expect(bucketForType(["zzz_unknown"])).toBe("other");
    expect(bucketForType([])).toBe("other");
    expect(bucketForType(null)).toBe("other");
  });
});
