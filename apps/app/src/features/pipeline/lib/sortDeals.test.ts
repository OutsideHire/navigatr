import { describe, it, expect } from "vitest";
import { sortDeals } from "./sortDeals";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("sortDeals", () => {
  it("value: highest first", () => {
    const out = sortDeals([d({ id: "a", valueCents: 100 }), d({ id: "b", valueCents: 900 }), d({ id: "c", valueCents: 500 })], "value");
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("probability: highest first", () => {
    const out = sortDeals([d({ id: "a", probability: 20 }), d({ id: "b", probability: 80 })], "probability");
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("last_activity: most recent first", () => {
    const out = sortDeals([d({ id: "old", lastActivity: "2026-01-01T00:00:00Z" }), d({ id: "new", lastActivity: "2026-06-01T00:00:00Z" })], "last_activity");
    expect(out.map((x) => x.id)).toEqual(["new", "old"]);
  });
  it("followup: soonest first, nulls last", () => {
    const out = sortDeals([
      d({ id: "none", nextFollowup: null }),
      d({ id: "late", nextFollowup: "2026-06-30" }),
      d({ id: "soon", nextFollowup: "2026-06-02" }),
    ], "followup");
    expect(out.map((x) => x.id)).toEqual(["soon", "late", "none"]);
  });
  it("does not mutate the input array", () => {
    const input = [d({ id: "a", valueCents: 1 }), d({ id: "b", valueCents: 2 })];
    const copy = [...input];
    sortDeals(input, "value");
    expect(input).toEqual(copy);
  });
});
