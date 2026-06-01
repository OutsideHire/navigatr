import { describe, it, expect } from "vitest";
import { sortMerchants } from "./sortMerchants";
import type { Merchant } from "../mockData";

type Row = Merchant & { distanceMeters?: number };

function m(over: Partial<Row>): Row {
  return {
    id: "x",
    name: "Biz",
    category: "food_beverage",
    address: "1 St",
    lat: 30,
    lng: -97,
    phone: "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    ...over,
  } as Row;
}

describe("sortMerchants", () => {
  it("distance: nearest first, missing distance sinks to the bottom", () => {
    const out = sortMerchants(
      [m({ id: "far", distanceMeters: 900 }), m({ id: "near", distanceMeters: 100 }), m({ id: "none" })],
      "distance",
    );
    expect(out.map((r) => r.id)).toEqual(["near", "far", "none"]);
  });

  it("popularity: highest review count first", () => {
    const out = sortMerchants(
      [m({ id: "a", ratingCount: 30 }), m({ id: "b", ratingCount: 800 }), m({ id: "c", ratingCount: undefined })],
      "popularity",
    );
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("opportunity: fewest reviews first (underseen wins)", () => {
    const out = sortMerchants(
      [m({ id: "chain", ratingCount: 800 }), m({ id: "fresh", ratingCount: 5 })],
      "opportunity",
    );
    expect(out.map((r) => r.id)).toEqual(["fresh", "chain"]);
  });

  it("is stable: equal keys keep input order (the distance tiebreak)", () => {
    const out = sortMerchants(
      [m({ id: "first", ratingCount: 20 }), m({ id: "second", ratingCount: 20 })],
      "opportunity",
    );
    expect(out.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("does not mutate the input array", () => {
    const input = [m({ id: "a", ratingCount: 1 }), m({ id: "b", ratingCount: 9 })];
    const before = input.map((r) => r.id);
    sortMerchants(input, "popularity");
    expect(input.map((r) => r.id)).toEqual(before);
  });
});
