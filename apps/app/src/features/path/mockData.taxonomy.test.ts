import { describe, it, expect } from "vitest";
import { CATEGORY_LABEL, labelForCategory, type MerchantCategory } from "./mockData";
import {
  INDUSTRIES,
  INDUSTRY_KEYS,
  bucketForType,
  categoriesForIndustries,
} from "../../../../../supabase/functions/_shared/industryTaxonomy";

describe("frontend taxonomy mirrors the shared industry config", () => {
  it("MerchantCategory keys === shared INDUSTRY_KEYS", () => {
    const feKeys = Object.keys(CATEGORY_LABEL) as MerchantCategory[];
    expect(new Set(feKeys)).toEqual(new Set(INDUSTRY_KEYS));
  });
  it("labels match the shared config", () => {
    for (const k of INDUSTRY_KEYS) {
      expect(CATEGORY_LABEL[k as MerchantCategory]).toBe(INDUSTRIES[k].label);
    }
  });
  it("labelForCategory returns new labels and folds retired keys to the merged label", () => {
    expect(labelForCategory("convenience_fuel")).toBe("Convenience & Fuel");
    expect(labelForCategory("retail")).toBe("Retail");
    expect(labelForCategory("restaurants_bars_entertainment")).toBe("Restaurants, Bars & Entertainment");
    expect(labelForCategory("grocery_food_retail")).toBe("Retail");
    expect(labelForCategory("food_beverage")).toBe("Restaurants, Bars & Entertainment");
    expect(labelForCategory("entertainment")).toBe("Restaurants, Bars & Entertainment");
    expect(labelForCategory("manufacturing")).toBe("Manufacturing");
    expect(labelForCategory("totally_unknown")).toBe("Other");
  });
});

describe("merged retail / restaurants-bars-entertainment taxonomy", () => {
  it("the 8 merged keys are gone; the 2 new keys exist", () => {
    for (const gone of [
      "grocery_food_retail", "apparel_accessories", "home_hardware",
      "electronics_specialty", "pharmacy_health_retail", "general_merchandise",
      "food_beverage", "entertainment",
    ]) {
      expect(INDUSTRY_KEYS).not.toContain(gone);
    }
    expect(INDUSTRY_KEYS).toContain("retail");
    expect(INDUSTRY_KEYS).toContain("restaurants_bars_entertainment");
  });

  it("retail unions a type from each former retail bucket", () => {
    const retail = INDUSTRIES.retail.includedTypes;
    for (const t of ["supermarket", "clothing_store", "hardware_store", "electronics_store", "pharmacy", "department_store"]) {
      expect(retail).toContain(t);
    }
    expect(INDUSTRIES.retail.order).toBe(8);
  });

  it("restaurants_bars_entertainment unions food_beverage + entertainment types", () => {
    const rbe = INDUSTRIES.restaurants_bars_entertainment.includedTypes;
    expect(rbe).toContain("restaurant");
    expect(rbe).toContain("movie_theater");
    expect(INDUSTRIES.restaurants_bars_entertainment.order).toBe(14);
  });

  it("bucketForType maps former sub-types to the merged key", () => {
    expect(bucketForType(["clothing_store"])).toBe("retail");
    expect(bucketForType(["supermarket"])).toBe("retail");
    expect(bucketForType(["movie_theater"])).toBe("restaurants_bars_entertainment");
    expect(bucketForType(["restaurant"])).toBe("restaurants_bars_entertainment");
  });

  it("the type→bucket map stays one-to-one (no type in two buckets)", () => {
    const seen = new Map<string, string>();
    for (const k of INDUSTRY_KEYS) {
      for (const t of INDUSTRIES[k].includedTypes) {
        expect(seen.has(t)).toBe(false);
        seen.set(t, k);
      }
    }
  });
});

describe("categoriesForIndustries (prospects_nearby read filter)", () => {
  it("expands a merged industry to its key + legacy split keys", () => {
    const retail = categoriesForIndustries(["retail"]);
    expect(retail).toContain("retail");
    // Pre-merge retail buckets still carried by older, not-yet-re-ingested rows.
    for (const legacy of ["grocery_food_retail", "apparel_accessories", "home_hardware",
      "electronics_specialty", "pharmacy_health_retail", "general_merchandise"]) {
      expect(retail).toContain(legacy);
    }

    const rbe = categoriesForIndustries(["restaurants_bars_entertainment"]);
    expect(rbe).toEqual(expect.arrayContaining([
      "restaurants_bars_entertainment", "food_beverage", "entertainment",
    ]));
  });

  it("leaves un-merged industries as just their own key", () => {
    expect(categoriesForIndustries(["healthcare"])).toEqual(["healthcare"]);
    expect(categoriesForIndustries([])).toEqual([]);
  });
});
