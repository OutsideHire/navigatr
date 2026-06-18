import { describe, it, expect } from "vitest";
import { applyDealFilters, activeFilterCount, EMPTY_DEAL_FILTERS } from "./filterDeals";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("filterDeals", () => {
  const deals = [
    d({ id: "a", valueCents: 100_00, probability: 20, nextFollowup: null }),
    d({ id: "b", valueCents: 900_00, probability: 80, nextFollowup: "2026-06-30" }),
  ];
  it("EMPTY is a no-op", () => {
    expect(applyDealFilters(deals, EMPTY_DEAL_FILTERS).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("minValueCents", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, minValueCents: 500_00 }).map((x) => x.id)).toEqual(["b"]);
  });
  it("minProbability", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, minProbability: 50 }).map((x) => x.id)).toEqual(["b"]);
  });
  it("followUp has / none", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, followUp: "has" }).map((x) => x.id)).toEqual(["b"]);
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, followUp: "none" }).map((x) => x.id)).toEqual(["a"]);
  });
  it("activeFilterCount", () => {
    expect(activeFilterCount(EMPTY_DEAL_FILTERS)).toBe(0);
    expect(activeFilterCount({ minValueCents: 1, minProbability: 1, followUp: "has" })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_DEAL_FILTERS, minProbability: 50 })).toBe(1);
  });
});
