import { describe, it, expect } from "vitest";
import {
  INDUSTRIES, INDUSTRY_KEYS, ALL_FETCHABLE_KEYS, RECOMMENDED_KEYS,
  SEARCH_UNSUPPORTED_TYPES, searchableTypes, bucketForType,
} from "./industryTaxonomy";

describe("industryTaxonomy (revised mapping)", () => {
  it("has 17 fetchable buckets + the 'other' fallback", () => {
    expect(INDUSTRY_KEYS).toContain("other");
    expect(ALL_FETCHABLE_KEYS).toHaveLength(17);
    expect(ALL_FETCHABLE_KEYS).not.toContain("other");
  });
  it("is one-to-one: no place type appears in more than one fetchable bucket", () => {
    const seen = new Map<string, string>();
    for (const k of ALL_FETCHABLE_KEYS) {
      for (const t of INDUSTRIES[k].includedTypes) {
        expect(seen.has(t), `${t} in both ${seen.get(t)} and ${k}`).toBe(false);
        seen.set(t, k);
      }
    }
  });
  it("RECOMMENDED_KEYS is exactly the 7 payments buckets", () => {
    expect([...RECOMMENDED_KEYS].sort()).toEqual(
      ["automotive","convenience_fuel","healthcare","personal_services","professional_services","restaurants_bars_entertainment","retail"],
    );
  });
  it("buckets relocated types to their new home", () => {
    expect(bucketForType(["gas_station"])).toBe("convenience_fuel");
    expect(bucketForType(["accounting"])).toBe("finance_banking");
    expect(bucketForType(["veterinary_care"])).toBe("veterinary_pet");
    expect(bucketForType(["pharmacy"])).toBe("retail");
    expect(bucketForType(["hardware_store"])).toBe("retail");
    expect(bucketForType(["wholesaler"])).toBe("manufacturing_wholesale");
    expect(bucketForType(["pizza_restaurant"])).toBe("restaurants_bars_entertainment");
  });
  it("merges the retail buckets and the restaurants/bars/entertainment buckets", () => {
    expect(bucketForType(["supermarket"])).toBe("retail");
    expect(bucketForType(["clothing_store"])).toBe("retail");
    expect(bucketForType(["electronics_store"])).toBe("retail");
    expect(bucketForType(["department_store"])).toBe("retail");
    expect(bucketForType(["restaurant"])).toBe("restaurants_bars_entertainment");
    expect(bucketForType(["movie_theater"])).toBe("restaurants_bars_entertainment");
    expect(INDUSTRIES.retail.order).toBe(8);
    expect(INDUSTRIES.restaurants_bars_entertainment.order).toBe(14);
  });
  it("strips general_contractor from searchable types but keeps it for bucketing", () => {
    expect(SEARCH_UNSUPPORTED_TYPES.has("general_contractor")).toBe(true);
    expect(searchableTypes("construction_trades")).not.toContain("general_contractor");
    expect(bucketForType(["general_contractor"])).toBe("construction_trades");
  });
  it("unknown types fall back to 'other'", () => {
    expect(bucketForType(["something_unknown"])).toBe("other");
    expect(bucketForType([])).toBe("other");
  });
});
