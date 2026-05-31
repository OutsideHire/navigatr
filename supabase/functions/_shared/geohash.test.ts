import { describe, it, expect } from "vitest";
import { encodeGeohash } from "./geohash";

describe("encodeGeohash", () => {
  it("matches the canonical Wikipedia geohash test vector", () => {
    // The reference example from the geohash spec: (57.64911, 10.40744) → "u4pruydqqvj".
    // Verifies the interleaved-bit algorithm against an authoritative value.
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("encodes Austin downtown into the 9v6 region", () => {
    expect(encodeGeohash(30.2672, -97.7431, 5)).toMatch(/^9v6/);
  });

  it("respects precision length", () => {
    expect(encodeGeohash(30.2672, -97.7431, 7)).toHaveLength(7);
    expect(encodeGeohash(30.2672, -97.7431, 5)).toHaveLength(5);
  });

  it("nearby points (within ~1km) share the same precision-5 cell", () => {
    const a = encodeGeohash(30.2672, -97.7431, 5);
    const b = encodeGeohash(30.2705, -97.7405, 5); // ~450m away
    expect(a).toBe(b);
  });

  it("far-apart points fall in different cells", () => {
    const austin = encodeGeohash(30.2672, -97.7431, 5);
    const nyc = encodeGeohash(40.7128, -74.006, 5);
    expect(austin).not.toBe(nyc);
  });

  it("throws on non-finite coordinates (NaN sentinel guard)", () => {
    expect(() => encodeGeohash(Number.NaN, -97.7431)).toThrow(/finite/);
    expect(() => encodeGeohash(30.2672, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});
