import { describe, it, expect } from "vitest";
import { proposeRoute, candidatePool, orderStops } from "./proposeRoute";
import { sortMerchants } from "./sortMerchants";
import { nearestNeighborOrder } from "@/lib/distance";
import { allSubtypes, type IndustrySelection } from "./industrySelection";
import type { Merchant } from "../mockData";

type Row = Merchant & { distanceMeters?: number };

function makeMerchant(over: Partial<Row>): Row {
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

const origin = { lat: 30, lng: -97 };

describe("proposeRoute", () => {
  it("filters out non-geocoded merchants", () => {
    const out = proposeRoute(
      [
        makeMerchant({ id: "geo", lat: 30.01, lng: -97.01 }),
        makeMerchant({ id: "nan", lat: Number.NaN, lng: -97.02 }),
        makeMerchant({ id: "inf", lat: 30.03, lng: Number.POSITIVE_INFINITY }),
      ],
      { origin, industries: [], sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((m) => m.id)).toEqual(["geo"]);
  });

  it("excludes chains from the proposed route", () => {
    const out = proposeRoute(
      [
        makeMerchant({ id: "indie", lat: 30.01, lng: -97.01 }),
        makeMerchant({ id: "chain", lat: 30.02, lng: -97.02, isChain: true }),
      ],
      { origin, industries: [], sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((m) => m.id)).toEqual(["indie"]);
  });

  it("filters by industry when not 'all'", () => {
    const out = proposeRoute(
      [
        makeMerchant({ id: "rest", category: "food_beverage", lat: 30.01, lng: -97.01 }),
        makeMerchant({ id: "retail", category: "retail", lat: 30.02, lng: -97.02 }),
      ],
      { origin, industries: ["retail"], sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((m) => m.id)).toEqual(["retail"]);
  });

  it("includes every selected industry when multiple are chosen", () => {
    const out = proposeRoute(
      [
        makeMerchant({ id: "rest", category: "food_beverage", lat: 30.01, lng: -97.01 }),
        makeMerchant({ id: "retail", category: "retail", lat: 30.02, lng: -97.02 }),
        makeMerchant({ id: "auto", category: "automotive", lat: 30.03, lng: -97.03 }),
      ],
      { origin, industries: ["food_beverage", "automotive"], sortMode: "distance", stopCap: 10 },
    );
    expect([...out.map((m) => m.id)].sort()).toEqual(["auto", "rest"]);
  });

  it("caps at stopCap", () => {
    const out = proposeRoute(
      [
        makeMerchant({ id: "a", lat: 30.01, lng: -97.01, ratingCount: 1 }),
        makeMerchant({ id: "b", lat: 30.02, lng: -97.02, ratingCount: 2 }),
        makeMerchant({ id: "c", lat: 30.03, lng: -97.03, ratingCount: 3 }),
      ],
      { origin, industries: [], sortMode: "opportunity", stopCap: 2 },
    );
    expect(out).toHaveLength(2);
  });

  it("returns [] when nothing matches", () => {
    const out = proposeRoute([], { origin, industries: [], sortMode: "distance", stopCap: 5 });
    expect(out).toEqual([]);
  });

  it("preview order == nearestNeighborOrder applied to the selected top-N set (== PathPage queue order)", () => {
    // Five geocoded leads with known coords + ratingCount. Opportunity sort
    // (fewest reviews first) selects the top-3, then NN orders them from origin.
    const merchants = [
      makeMerchant({ id: "a", lat: 30.10, lng: -97.00, ratingCount: 5 }),
      makeMerchant({ id: "b", lat: 30.02, lng: -97.00, ratingCount: 10 }),
      makeMerchant({ id: "c", lat: 30.05, lng: -97.00, ratingCount: 20 }),
      makeMerchant({ id: "d", lat: 30.01, lng: -97.00, ratingCount: 1 }),
      makeMerchant({ id: "e", lat: 30.20, lng: -97.00, ratingCount: 9000 }),
    ];
    const opts = { origin, industries: [], sortMode: "opportunity" as const, stopCap: 3 };

    const out = proposeRoute(merchants, opts);

    // Reconstruct exactly what PathPage does: select the same top-N, then run
    // nearestNeighborOrder on those stops from the same origin.
    const topN = sortMerchants(merchants, "opportunity").slice(0, 3);
    const order = nearestNeighborOrder(origin, topN.map((m) => ({ lat: m.lat, lng: m.lng })));
    const expected = order.map((i) => topN[i]!.id);

    expect(out.map((m) => m.id)).toEqual(expected);
    // And the cut is the fewest-reviews trio (d=1, a=5, b=10), NN-ordered.
    expect([...out.map((m) => m.id)].sort()).toEqual(["a", "b", "d"]);
  });
});

type TestMerchant = Merchant & { distanceMeters?: number };
function m(over: Partial<TestMerchant> = {}): TestMerchant {
  return {
    id: "m1", name: "M", category: "automotive", address: "a", lat: 35.0, lng: -97.0,
    phone: "", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, primaryType: "car_repair", rating: 4.2,
    ...over,
  } as TestMerchant;
}
const ORIGIN = { lat: 35.0, lng: -97.0 };

describe("proposeRoute sub-type + rating filters", () => {
  it("with a partial selection, keeps only merchants whose primaryType is selected", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = proposeRoute(
      [m({ id: "keep", primaryType: "car_repair" }), m({ id: "drop", primaryType: "tire_shop" })],
      { origin: ORIGIN, industries: ["automotive"], selection: sel, sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((x) => x.id)).toEqual(["keep"]);
  });

  it("with a full selection, keeps every sub-type of the category", () => {
    const sel: IndustrySelection = { automotive: allSubtypes("automotive") };
    const out = proposeRoute(
      [m({ id: "a", primaryType: "car_repair" }), m({ id: "b", primaryType: "tire_shop" })],
      { origin: ORIGIN, industries: ["automotive"], selection: sel, sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a merchant with null primaryType when its category is selected", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = proposeRoute(
      [m({ id: "legacy", primaryType: null })],
      { origin: ORIGIN, industries: ["automotive"], selection: sel, sortMode: "distance", stopCap: 10 },
    );
    expect(out.map((x) => x.id)).toEqual(["legacy"]);
  });

  it("drops a merchant whose category is not in the selection", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const out = proposeRoute(
      [m({ id: "off", category: "retail", primaryType: "clothing_store" })],
      { origin: ORIGIN, industries: ["automotive"], selection: sel, sortMode: "distance", stopCap: 10 },
    );
    expect(out).toEqual([]);
  });

  it("minRating drops merchants below the bar and unrated merchants", () => {
    const out = proposeRoute(
      [m({ id: "good", rating: 4.5 }), m({ id: "low", rating: 3.0 }), m({ id: "unrated", rating: undefined })],
      { origin: ORIGIN, industries: [], sortMode: "distance", stopCap: 10, minRating: 4 },
    );
    expect(out.map((x) => x.id)).toEqual(["good"]);
  });

  it("without a selection, falls back to the category-bucket filter (backward compatible)", () => {
    const out = proposeRoute(
      [m({ id: "auto", category: "automotive" }), m({ id: "ret", category: "retail" })],
      { origin: ORIGIN, industries: ["automotive"], sortMode: "distance", stopCap: 10 },
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
  it("applies a sub-type selection like proposeRoute does", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    const pool = candidatePool(
      [m({ id: "keep", primaryType: "car_repair" }), m({ id: "drop", primaryType: "tire_shop" })],
      { industries: ["automotive"], selection: sel, sortMode: "distance" },
    );
    expect(pool.map((x) => x.id)).toEqual(["keep"]);
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
