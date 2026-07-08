import { describe, it, expect } from "vitest";
import { driveMinutesBetween } from "./driveTime";

describe("driveMinutesBetween", () => {
  it("is 0 for identical points", () => {
    expect(driveMinutesBetween({ lat: 30, lng: -97 }, { lat: 30, lng: -97 })).toBe(0);
  });
  it("estimates minutes at ~30mph over the haversine distance", () => {
    const m = driveMinutesBetween({ lat: 35.66, lng: -97.46 }, { lat: 35.6745, lng: -97.46 });
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThan(4);
  });
});
