import { describe, it, expect } from "vitest";
import { CATEGORY_LABEL, type MerchantCategory } from "./mockData";
import { INDUSTRIES, INDUSTRY_KEYS } from "../../../../../supabase/functions/_shared/industryTaxonomy";

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
});
