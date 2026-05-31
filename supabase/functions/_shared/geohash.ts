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
