import { describe, it, expect } from "vitest";
import {
  encodeGeohash,
  decodeGeohashBounds,
  decodeGeohash,
  cellsCovering,
} from "./geohash";

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

describe("decodeGeohashBounds", () => {
  it("returns bounds that contain the encoded point", () => {
    const b = decodeGeohashBounds(encodeGeohash(30.2672, -97.7431, 5));
    expect(30.2672).toBeGreaterThanOrEqual(b.latLo);
    expect(30.2672).toBeLessThanOrEqual(b.latHi);
    expect(-97.7431).toBeGreaterThanOrEqual(b.lngLo);
    expect(-97.7431).toBeLessThanOrEqual(b.lngHi);
  });

  it("precision-5 cell is roughly 0.044° on each side", () => {
    const b = decodeGeohashBounds("9v6kn");
    expect(b.latHi - b.latLo).toBeCloseTo(0.0439, 3);
    expect(b.lngHi - b.lngLo).toBeCloseTo(0.0439, 3);
  });

  it("higher precision yields a tighter box", () => {
    const wide = decodeGeohashBounds(encodeGeohash(30.2672, -97.7431, 5));
    const tight = decodeGeohashBounds(encodeGeohash(30.2672, -97.7431, 7));
    expect(tight.latHi - tight.latLo).toBeLessThan(wide.latHi - wide.latLo);
  });

  it("throws on an empty hash", () => {
    expect(() => decodeGeohashBounds("")).toThrow(/empty/);
  });

  it("throws on an invalid geohash character", () => {
    // 'a', 'i', 'l', 'o' are not in the base32 geohash alphabet.
    expect(() => decodeGeohashBounds("9v6a")).toThrow(/invalid/);
  });
});

describe("decodeGeohash (cell center)", () => {
  it("reverses encode within one cell of the original point", () => {
    // Canonical vector: decoding "u4pruydqqvj" lands near (57.64911, 10.40744).
    const c = decodeGeohash("u4pruydqqvj");
    expect(c.lat).toBeCloseTo(57.64911, 3);
    expect(c.lng).toBeCloseTo(10.40744, 3);
  });

  it("re-encoding a cell's center returns the same cell", () => {
    const cell = encodeGeohash(30.2672, -97.7431, 5);
    const c = decodeGeohash(cell);
    expect(encodeGeohash(c.lat, c.lng, 5)).toBe(cell);
  });
});

describe("cellsCovering", () => {
  const AUSTIN = { lat: 30.2672, lng: -97.7431 };
  const CELL = encodeGeohash(AUSTIN.lat, AUSTIN.lng, 5);
  // Use the cell CENTER as origin for the geometry tests so neighbor distances
  // are deterministic (independent of where Austin sits inside its cell):
  // orthogonal neighbors ~2.2km away, diagonals ~3.2km, two-over ~6.3km.
  const CENTER = decodeGeohash(CELL);

  it("returns only the origin cell for a zero radius", () => {
    expect(cellsCovering(AUSTIN.lat, AUSTIN.lng, 0, 5)).toEqual([CELL]);
  });

  it("returns only the origin cell for a sub-cell radius from the cell center", () => {
    // 200m from the center can't reach any neighbor's edge (~2.2km away).
    expect(cellsCovering(CENTER.lat, CENTER.lng, 200, 5)).toEqual([CELL]);
  });

  it("origin cell is always first (nearest)", () => {
    const cells = cellsCovering(AUSTIN.lat, AUSTIN.lng, 8000, 5);
    expect(cells[0]).toBe(CELL);
  });

  it("a 4km radius from the cell center pulls exactly the surrounding 3x3 block", () => {
    // From center: 8 neighbors (orthogonal ~2.2km, diagonal ~3.2km) are inside
    // 4km; the two-over cells (~6.3km) are not. → origin + 8 = 9.
    const cells = cellsCovering(CENTER.lat, CENTER.lng, 4000, 5);
    expect(cells.length).toBe(9);
    expect(new Set(cells).size).toBe(9);
    expect(cells).toContain(CELL);
  });

  it("a wider radius covers more cells", () => {
    const near = cellsCovering(CENTER.lat, CENTER.lng, 4000, 5, 200);
    const far = cellsCovering(CENTER.lat, CENTER.lng, 12000, 5, 200);
    expect(far.length).toBeGreaterThan(near.length);
  });

  it("never exceeds maxCells (cost guardrail)", () => {
    const cells = cellsCovering(AUSTIN.lat, AUSTIN.lng, 20000, 5, 9);
    expect(cells.length).toBe(9);
    expect(new Set(cells).size).toBe(9);
  });

  it("every returned cell is unique", () => {
    const cells = cellsCovering(AUSTIN.lat, AUSTIN.lng, 15000, 5, 200);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("throws on non-finite coordinates", () => {
    expect(() => cellsCovering(Number.NaN, -97.7431, 5000)).toThrow(/finite/);
  });
});
