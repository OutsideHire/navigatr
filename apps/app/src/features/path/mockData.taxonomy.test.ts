import { describe, it, expect } from "vitest";
import { CATEGORY_LABEL, labelForCategory, type MerchantCategory } from "./mockData";
import {
  INDUSTRIES,
  INDUSTRY_KEYS,
  INDUSTRY_GROUPS,
  ALL_FETCHABLE_KEYS,
  industryDisplayNodes,
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
  it("labelForCategory returns new labels and falls back for retired keys", () => {
    expect(labelForCategory("convenience_fuel")).toBe("Convenience & Fuel");
    expect(labelForCategory("retail")).toBe("Retail");
    expect(labelForCategory("manufacturing")).toBe("Manufacturing");
    expect(labelForCategory("totally_unknown")).toBe("Other");
  });
});

describe("industry display grouping", () => {
  it("every group key is a valid, non-'other' industry, with no key in two groups", () => {
    const seen = new Set<string>();
    for (const g of INDUSTRY_GROUPS) {
      for (const k of g.keys) {
        expect(INDUSTRY_KEYS).toContain(k);
        expect(k).not.toBe("other");
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it("Retail groups the six retail industries", () => {
    const retail = INDUSTRY_GROUPS.find((g) => g.label === "Retail");
    expect(retail?.keys).toEqual([
      "grocery_food_retail", "apparel_accessories", "home_hardware",
      "electronics_specialty", "pharmacy_health_retail", "general_merchandise",
    ]);
  });

  it("display nodes are ordered and cover every fetchable industry exactly once", () => {
    const nodes = industryDisplayNodes();
    // Sorted ascending by order.
    const orders = nodes.map((n) => n.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    // Flatten to the industry keys each node contributes.
    const covered: string[] = [];
    for (const n of nodes) {
      if (n.kind === "group") covered.push(...n.keys);
      else covered.push(n.key);
    }
    expect(new Set(covered)).toEqual(new Set(ALL_FETCHABLE_KEYS));
    expect(covered.length).toBe(ALL_FETCHABLE_KEYS.length); // no duplicates
  });

  it("each configured group appears once as a group node", () => {
    const groupLabels = industryDisplayNodes()
      .filter((n) => n.kind === "group")
      .map((n) => (n as { label: string }).label);
    expect(groupLabels).toEqual(INDUSTRY_GROUPS.map((g) => g.label));
  });
});
