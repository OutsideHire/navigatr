import { describe, it, expect } from "vitest";
import { routeStats } from "./routeStats";
import type { LatLng } from "@/lib/distance";

const origin: LatLng = { lat: 30.2672, lng: -97.7431 };

describe("routeStats", () => {
  it("returns a zero-ish result for an empty stop list", () => {
    const s = routeStats(origin, []);
    expect(s.stopCount).toBe(0);
    expect(s.totalRouteMeters).toBe(0);
    expect(s.nearestMeters).toBeNull();
    expect(s.furthestMeters).toBeNull();
    expect(s.etaMinutes).toBe(0);
  });

  it("nearest/furthest are measured from the origin, not leg-to-leg", () => {
    // ~1.1km and ~2.2km roughly north of origin.
    const stops: LatLng[] = [
      { lat: 30.2772, lng: -97.7431 },
      { lat: 30.2872, lng: -97.7431 },
    ];
    const s = routeStats(origin, stops);
    expect(s.stopCount).toBe(2);
    expect(s.nearestMeters).toBeGreaterThan(900);
    expect(s.nearestMeters).toBeLessThan(1300);
    expect(s.furthestMeters).toBeGreaterThan(s.nearestMeters!);
  });

  it("totalRouteMeters sums origin→stop1→stop2 legs in the given order", () => {
    const stops: LatLng[] = [
      { lat: 30.2772, lng: -97.7431 },
      { lat: 30.2872, lng: -97.7431 },
    ];
    const s = routeStats(origin, stops);
    // Two ~1.1km legs ⇒ ~2.2km total.
    expect(s.totalRouteMeters).toBeGreaterThan(2000);
    expect(s.totalRouteMeters).toBeLessThan(2600);
  });

  it("etaMinutes = drive time at avg speed + dwell per stop, rounded", () => {
    const stops: LatLng[] = [{ lat: 30.2772, lng: -97.7431 }];
    const s = routeStats(origin, stops);
    // 1 stop ⇒ ~1.1km drive (negligible at 30mph) + 15min dwell ⇒ ~16-17 min.
    expect(s.etaMinutes).toBeGreaterThanOrEqual(15);
    expect(s.etaMinutes).toBeLessThan(25);
  });
});

import { formatEta } from "./routeStats";

describe("formatEta", () => {
  it("formats hours and minutes", () => {
    expect(formatEta(0)).toBe("—");
    expect(formatEta(45)).toBe("~45m");
    expect(formatEta(60)).toBe("~1h");
    expect(formatEta(210)).toBe("~3h 30m");
  });
});
