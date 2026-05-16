import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  formatDistance,
  nearestNeighborOrder,
  type LatLng,
} from "./distance";

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMeters({ lat: 30.27, lng: -97.74 }, { lat: 30.27, lng: -97.74 })).toBe(0);
  });

  it("matches known distance: Austin to Dallas ~ 293 km", () => {
    const austin: LatLng = { lat: 30.2672, lng: -97.7431 };
    const dallas: LatLng = { lat: 32.7767, lng: -96.797 };
    const m = haversineMeters(austin, dallas);
    // Real-world: ~293 km. Allow ±5 km for spherical approximation.
    expect(m).toBeGreaterThan(288_000);
    expect(m).toBeLessThan(298_000);
  });

  it("is symmetric", () => {
    const a: LatLng = { lat: 30.27, lng: -97.74 };
    const b: LatLng = { lat: 30.30, lng: -97.70 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe("formatDistance", () => {
  it("renders sub-0.1mi as 'less than 0.1 mi'", () => {
    expect(formatDistance(100)).toBe("less than 0.1 mi");
  });

  it("renders 1 km as '0.6 mi'", () => {
    expect(formatDistance(1000)).toBe("0.6 mi");
  });

  it("renders 5 km as '3.1 mi'", () => {
    expect(formatDistance(5000)).toBe("3.1 mi");
  });
});

describe("nearestNeighborOrder", () => {
  it("returns empty for no stops", () => {
    expect(nearestNeighborOrder({ lat: 0, lng: 0 }, [])).toEqual([]);
  });

  it("orders stops by proximity from start", () => {
    const start: LatLng = { lat: 30.27, lng: -97.74 };
    const stops: LatLng[] = [
      { lat: 30.40, lng: -97.74 }, // far north  (idx 0)
      { lat: 30.28, lng: -97.74 }, // close      (idx 1)
      { lat: 30.50, lng: -97.74 }, // farther    (idx 2)
    ];
    // From start, nearest is idx 1, then 0, then 2 (greedy north).
    expect(nearestNeighborOrder(start, stops)).toEqual([1, 0, 2]);
  });

  it("never visits the same stop twice", () => {
    const start: LatLng = { lat: 30.27, lng: -97.74 };
    const stops: LatLng[] = [
      { lat: 30.28, lng: -97.74 },
      { lat: 30.29, lng: -97.74 },
      { lat: 30.30, lng: -97.74 },
    ];
    const order = nearestNeighborOrder(start, stops);
    expect(new Set(order).size).toBe(stops.length);
  });
});
