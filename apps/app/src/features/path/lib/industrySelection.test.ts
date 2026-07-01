import { describe, it, expect } from "vitest";
import {
  RECOMMENDED_SELECTION, allSubtypes, selectedCategories, subtypeCount,
  isFullySelected, matchesSelection, humanizeSubtype, pruneToKnownCategories,
  type IndustrySelection,
} from "./industrySelection";

describe("industrySelection", () => {
  it("RECOMMENDED_SELECTION is the 7 payments buckets, each fully selected", () => {
    const cats = selectedCategories(RECOMMENDED_SELECTION).sort();
    expect(cats).toEqual(["automotive", "convenience_fuel", "healthcare", "personal_services", "professional_services", "restaurants_bars_entertainment", "retail"].sort());
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
    expect(matchesSelection(null, "retail", sel)).toBe(false);
  });

  it("humanizeSubtype turns a raw type into a label", () => {
    expect(humanizeSubtype("car_repair")).toBe("Car repair");
    expect(humanizeSubtype("fast_food_restaurant")).toBe("Fast food restaurant");
  });

  it("selectedCategories excludes stale (non-taxonomy) keys", () => {
    const sel = { totally_unknown: ["x"], retail: ["y"] } as IndustrySelection;
    expect(selectedCategories(sel)).toEqual(["retail"]);
  });

  it("pruneToKnownCategories drops truly-unknown keys, preserves known ones", () => {
    const sel = { totally_unknown: ["x"], retail: ["y"] } as IndustrySelection;
    expect(pruneToKnownCategories(sel)).toEqual({ retail: ["y"] });
  });

  it("pruneToKnownCategories folds retired retail keys into retail, unioning sub-types", () => {
    const sel = {
      grocery_food_retail: ["supermarket", "grocery_store"],
      apparel_accessories: ["clothing_store", "supermarket"],
    } as IndustrySelection;
    expect(pruneToKnownCategories(sel)).toEqual({
      retail: ["supermarket", "grocery_store", "clothing_store"],
    });
  });

  it("pruneToKnownCategories folds food_beverage + entertainment into restaurants_bars_entertainment", () => {
    const sel = {
      food_beverage: ["restaurant", "cafe"],
      entertainment: ["movie_theater"],
    } as IndustrySelection;
    expect(pruneToKnownCategories(sel)).toEqual({
      restaurants_bars_entertainment: ["restaurant", "cafe", "movie_theater"],
    });
  });

  it("pruneToKnownCategories merges a retired key into an already-present new key", () => {
    const sel = {
      retail: ["supermarket"],
      apparel_accessories: ["clothing_store", "supermarket"],
    } as IndustrySelection;
    expect(pruneToKnownCategories(sel)).toEqual({
      retail: ["supermarket", "clothing_store"],
    });
  });

  it("pruneToKnownCategories on empty selection returns {}", () => {
    expect(pruneToKnownCategories({})).toEqual({});
  });
});
