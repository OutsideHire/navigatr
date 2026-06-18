import { describe, it, expect } from "vitest";
import {
  RECOMMENDED_SELECTION, allSubtypes, selectedCategories, subtypeCount,
  isFullySelected, matchesSelection, humanizeSubtype, pruneToKnownCategories,
  type IndustrySelection,
} from "./industrySelection";

describe("industrySelection", () => {
  it("RECOMMENDED_SELECTION is the 7 payments buckets, each fully selected", () => {
    const cats = selectedCategories(RECOMMENDED_SELECTION).sort();
    expect(cats).toEqual(["automotive", "convenience_fuel", "food_beverage", "grocery_food_retail", "healthcare", "personal_services", "professional_services"].sort());
    expect(isFullySelected(RECOMMENDED_SELECTION, "convenience_fuel")).toBe(true);
  });

  it("allSubtypes returns a category's includedTypes", () => {
    expect(allSubtypes("automotive")).toContain("car_repair");
  });

  it("subtypeCount + isFullySelected reflect partial vs full", () => {
    const sel: IndustrySelection = { automotive: ["car_repair", "tire_shop"] };
    const total = allSubtypes("automotive").length;
    expect(subtypeCount(sel, "automotive")).toEqual({ selected: 2, total });
    expect(isFullySelected(sel, "automotive")).toBe(false);
    const full: IndustrySelection = { automotive: allSubtypes("automotive") };
    expect(isFullySelected(full, "automotive")).toBe(true);
  });

  it("matchesSelection: category not selected → false", () => {
    expect(matchesSelection("car_repair", "automotive", {})).toBe(false);
  });

  it("matchesSelection: full category → any of its types matches", () => {
    const full: IndustrySelection = { automotive: allSubtypes("automotive") };
    expect(matchesSelection("car_repair", "automotive", full)).toBe(true);
  });

  it("matchesSelection: partial category → only listed sub-types match", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    expect(matchesSelection("car_repair", "automotive", sel)).toBe(true);
    expect(matchesSelection("tire_shop", "automotive", sel)).toBe(false);
  });

  it("matchesSelection: null primary_type → matches its (selected) category, not dropped", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    expect(matchesSelection(null, "automotive", sel)).toBe(true);
    expect(matchesSelection(null, "general_merchandise", sel)).toBe(false);
  });

  it("humanizeSubtype turns a raw type into a label", () => {
    expect(humanizeSubtype("car_repair")).toBe("Car repair");
    expect(humanizeSubtype("fast_food_restaurant")).toBe("Fast food restaurant");
  });

  it("selectedCategories excludes stale (non-taxonomy) keys", () => {
    const sel = { retail: ["x"], food_beverage: ["y"] } as IndustrySelection;
    expect(selectedCategories(sel)).toEqual(["food_beverage"]);
  });

  it("pruneToKnownCategories drops stale keys, preserves known ones", () => {
    const sel = { retail: ["x"], food_beverage: ["y"] } as IndustrySelection;
    expect(pruneToKnownCategories(sel)).toEqual({ food_beverage: ["y"] });
  });

  it("pruneToKnownCategories on empty selection returns {}", () => {
    expect(pruneToKnownCategories({})).toEqual({});
  });
});
