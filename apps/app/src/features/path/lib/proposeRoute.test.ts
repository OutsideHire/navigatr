import { describe, it, expect } from "vitest";
import { proposeRoute } from "./proposeRoute";
import { sortMerchants } from "./sortMerchants";
import { nearestNeighborOrder } from "@/lib/distance";
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
