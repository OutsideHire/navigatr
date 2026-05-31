// Geohash encoding — used to bucket prospects into cache cells.
//
// The prospect store caches Places results per geohash cell so a second rep
// in the same area is served from our DB instead of re-billing Google. We use
// precision 5 (~4.9km × 4.9km) so one cell comfortably brackets the default
// ~3km path-build radius. (Edge cases where a query straddles a cell boundary
// are acceptable for Phase 1; the auto-widen + scheduled-refresh work in later
// phases tightens coverage.)
//
// Pure + dependency-free so it's unit-testable and shared between the client
// and the Deno ingest Edge Function.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"; // geohash alphabet (no a,i,l,o)

/**
 * Encode a lat/lng to a geohash string of the given precision (default 5).
 * Standard interleaved-bit algorithm.
 */
export function encodeGeohash(lat: number, lng: number, precision = 5): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("encodeGeohash: lat/lng must be finite numbers");
  }
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;

  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true; // start by bisecting longitude

  while (hash.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        ch = (ch << 1) + 1;
        lngLo = mid;
      } else {
        ch = ch << 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) + 1;
        latLo = mid;
      } else {
        ch = ch << 1;
        latHi = mid;
      }
    }
    even = !even;

    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export interface GeoBounds {
  latLo: number;
  latHi: number;
  lngLo: number;
  lngHi: number;
}

/**
 * Decode a geohash to its bounding box. The inverse of encodeGeohash: walk the
 * same interleaved-bit sequence, but instead of choosing a half from the point
 * we narrow the box by the stored bit. Longitude is bisected first (even bit),
 * matching the encoder.
 */
export function decodeGeohashBounds(hash: string): GeoBounds {
  if (!hash) throw new Error("decodeGeohashBounds: hash must be a non-empty string");
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let even = true;
  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) throw new Error(`decodeGeohashBounds: invalid geohash character "${c}"`);
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (bit === 1) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bit === 1) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latLo, latHi, lngLo, lngHi };
}

/** Decode a geohash to the center point of its cell. */
export function decodeGeohash(hash: string): { lat: number; lng: number } {
  const b = decodeGeohashBounds(hash);
  return { lat: (b.latLo + b.latHi) / 2, lng: (b.lngLo + b.lngHi) / 2 };
}

/**
 * Enumerate the geohash cells that a circle of `radiusM` around (lat,lng)
 * touches, nearest-first, capped at `maxCells`. This is the tiling primitive
 * for wide-radius prospect ingest: instead of one searchNearby (capped at 20
 * results, popularity-skewed), we fetch each covered cell from its own center
 * so coverage stays dense across a driving territory.
 *
 * A cell is "touched" if the nearest point of its bounding box is within
 * `radiusM` of the origin — i.e. the cell can actually contain a prospect the
 * rep's radius would show. (Center-distance would over-fetch cells the radius
 * can't reach; box-nearest is exact and cost-minimal.) The origin cell is
 * always included (even at radius 0). `maxCells` is the cost guardrail: each
 * returned cell is up to one Google ingest, so the caller bounds worst-case
 * spend by capping the list. Returned nearest-first (by box distance) so a
 * truncated list keeps the most relevant cells.
 *
 * The grid is walked at half-cell steps so no cell is skipped by alignment;
 * dedup collapses the repeats.
 */
export function cellsCovering(
  lat: number,
  lng: number,
  radiusM: number,
  precision = 5,
  maxCells = 25,
): string[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("cellsCovering: lat/lng must be finite numbers");
  }
  const r = Math.max(0, radiusM);
  const originCell = encodeGeohash(lat, lng, precision);
  const bounds = decodeGeohashBounds(originCell);
  const cellLatDeg = bounds.latHi - bounds.latLo;
  const cellLngDeg = bounds.lngHi - bounds.lngLo;

  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = Math.max(1, 111_320 * Math.cos(latRad));

  // Walk one cell past the radius so edge cells get sampled.
  const latReach = r / mPerDegLat + cellLatDeg;
  const lngReach = r / mPerDegLng + cellLngDeg;
  const stepLat = cellLatDeg / 2;
  const stepLng = cellLngDeg / 2;

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  const seen = new Map<string, number>(); // cell -> box-nearest distance (m)
  for (let dLat = -latReach; dLat <= latReach + 1e-9; dLat += stepLat) {
    for (let dLng = -lngReach; dLng <= lngReach + 1e-9; dLng += stepLng) {
      const cell = encodeGeohash(lat + dLat, lng + dLng, precision);
      if (seen.has(cell)) continue;
      const cb = decodeGeohashBounds(cell);
      // Nearest point of this cell's box to the origin (origin inside → 0).
      const nLat = clamp(lat, cb.latLo, cb.latHi);
      const nLng = clamp(lng, cb.lngLo, cb.lngHi);
      const ddLat = (nLat - lat) * mPerDegLat;
      const ddLng = (nLng - lng) * mPerDegLng;
      const distM = Math.sqrt(ddLat * ddLat + ddLng * ddLng);
      if (distM <= r) seen.set(cell, distM);
    }
  }
  // Guarantee the origin cell is present even if floating-point grid sampling
  // somehow missed it (it shouldn't, but the rep's own cell must never drop).
  if (!seen.has(originCell)) seen.set(originCell, 0);

  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, Math.max(1, maxCells))
    .map(([cell]) => cell);
}
