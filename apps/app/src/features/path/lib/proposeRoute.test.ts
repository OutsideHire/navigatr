import { describe, it, expect } from "vitest";
import { candidatePool, orderStops } from "./proposeRoute";
import { allSubtypes, type IndustrySelection } from "./industrySelection";
import type { Merchant } from "../mockData";

type TestMerchant = Merchant & { distanceMeters?: number };
function m(over: Partial<TestMerchant> = {}): TestMerchant {
  return {
    id: "m1", name: "M", category: "automotive", address: "a", lat: 35.0, lng: -97.0,
    phone: "", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, primaryType: "car_repair", rating: 4.2,
    ...over,
  } as TestMerchant;
}
describe("candidatePool sub-type + rating filters", () => {
  it("with a partial selection, keeps only merchants whose primaryType is selected", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = candidatePool(
      [m({ id: "keep", primaryType: "car_repair" }), m({ id: "drop", primaryType: "tire_shop" })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(out.map((x) => x.id)).toEqual(["keep"]);
  });

  it("with a full selection, keeps every sub-type of the category", () => {
    const sel: IndustrySelection = { automotive: allSubtypes("automotive") };
    const out = candidatePool(
      [m({ id: "a", primaryType: "car_repair" }), m({ id: "b", primaryType: "tire_shop" })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a merchant with null primaryType when its category is selected", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = candidatePool(
      [m({ id: "legacy", primaryType: null })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(out.map((x) => x.id)).toEqual(["legacy"]);
  });

  it("drops a merchant whose category is not in the selection", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = candidatePool(
      [m({ id: "off", category: "retail", primaryType: "clothing_store" })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(out).toEqual([]);
  });

  it("minRating drops merchants below the bar and unrated merchants", () => {
    const out = candidatePool(
      [m({ id: "good", rating: 4.5 }), m({ id: "low", rating: 3.0 }), m({ id: "unrated", rating: undefined })],
      { industries: [], sortMode: "distance", minRating: 4 },
    );
    expect(out.map((x) => x.id)).toEqual(["good"]);
  });

  it("without a selection, falls back to the category-bucket filter (backward compatible)", () => {
    const out = candidatePool(
      [m({ id: "auto", category: "automotive" }), m({ id: "ret", category: "retail" })],
      { industries: ["automotive"], sortMode: "distance" },
    );
    expect(out.map((x) => x.id)).toEqual(["auto"]);
  });
});

describe("candidatePool", () => {
  it("returns the full filtered+sorted pool — no top-N slice", () => {
    const pool = candidatePool(
      [m({ id: "a" }), m({ id: "b" }), m({ id: "c" })],
      { industries: [], sortMode: "distance" },
    );
    expect(pool.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("excludes chains and applies minRating", () => {
    const pool = candidatePool(
      [m({ id: "ok", rating: 4.5 }), m({ id: "low", rating: 2 }), m({ id: "chain", isChain: true })],
      { industries: [], sortMode: "distance", minRating: 4 },
    );
    expect(pool.map((x) => x.id)).toEqual(["ok"]);
  });
  it("applies a sub-type selection", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const pool = candidatePool(
      [m({ id: "keep", primaryType: "car_repair" }), m({ id: "drop", primaryType: "tire_shop" })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(pool.map((x) => x.id)).toEqual(["keep"]);
  });

  it("orders by opportunity (fewest reviews first) vs distance (nearest first)", () => {
    // popular+near vs underseen+far
    const popularNear = m({ id: "popularNear", ratingCount: 500, distanceMeters: 100 });
    const underseenFar = m({ id: "underseenFar", ratingCount: 1, distanceMeters: 9000 });
    const byOpp = candidatePool([popularNear, underseenFar], { industries: [], sortMode: "opportunity" });
    expect(byOpp.map((x) => x.id)).toEqual(["underseenFar", "popularNear"]);
    const byDist = candidatePool([popularNear, underseenFar], { industries: [], sortMode: "distance" });
    expect(byDist.map((x) => x.id)).toEqual(["popularNear", "underseenFar"]);
  });
});

describe("orderStops", () => {
  it("nearest-neighbor-orders a chosen set from the origin", () => {
    const near = m({ id: "near", lat: 35.0, lng: -97.0 });
    const far = m({ id: "far", lat: 35.5, lng: -97.0 });
    const out = orderStops({ lat: 35.0, lng: -97.0 }, [far, near]);
    expect(out[0]!.id).toBe("near");
  });
  it("returns [] for an empty set", () => {
    expect(orderStops({ lat: 35.0, lng: -97.0 }, [])).toEqual([]);
  });
});
