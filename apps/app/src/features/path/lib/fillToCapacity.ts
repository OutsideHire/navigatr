/**
 * fillToCapacity (v2.2 Ticket B, Section 4.4 + defaults 5/6/7): the landing
 * "Add more stops" fill rule.
 *
 * ONE tap fills the REMAINING CAPACITY, not a single stop: this folds pool
 * candidates into the day, one after another, until the budget cannot hold the
 * closest remaining candidate (or the pool is exhausted). It replaces the old
 * one-stop-per-tap `insertStop` behavior on the landing.
 *
 * Contract (4.4):
 *  - "Closest" is measured from the LAST stop in the current route order (or the
 *    rep's origin when the route is empty), because a fill APPENDS to the end of
 *    the day. As each candidate is appended, the anchor advances to it, so the
 *    next pick is closest-to-the-new-last-stop (a greedy nearest-neighbor append).
 *  - Added stops APPEND in place. The optimizer does NOT re-run; the existing
 *    order never changes; new stops go after the current last stop, never spliced
 *    mid-route.
 *  - A fill never exceeds `remainingMin`. Per-stop cost is the same independent
 *    estimate the assembler uses: drive(lastStop -> candidate) + dwell.
 *
 * Stop-vs-skip choice: when the CLOSEST remaining candidate does not fit, the
 * fill STOPS (it does not scan ahead for a smaller/cheaper one). A fill is a
 * contiguous nearest-neighbor append to capacity; the simpler "stop on the first
 * non-fit" rule is correct for that and matches how the landing budget behaves
 * (once the closest cannot fit, the day is effectively full for this pool).
 *
 * Exclusion set (4.4): businesses already routed today, already visited/skipped
 * today, outside the active industry settings, or do-not-contact. The retained
 * pool passed here has ALREADY cleared industry filtering + pipeline dedup
 * upstream, so the only live exclusion applied here is "already routed today"
 * (id already in the proposal). The visited/skipped/industry/DNC cases are
 * upstream, or belong to the live-refetch path (see the 4.1 TODO in the view).
 *
 * Pure: `now` is a parameter (reserved for future time-aware fills; the budget
 * math today is minute-based via `remainingMin`), no Date.now(), no randomness.
 */

import type { LatLng } from "@/lib/distance";
import { driveMinutesBetween } from "./driveTime";
import { dwellMinutesForKind } from "./pathCapacityDefaults";
import type { OrderedStop, FlexibleStop } from "./todaysPath";

export interface FillToCapacityOptions {
  origin: LatLng;
  /** Budget still open on the day (from the assembler's remainingMin). */
  remainingMin: number;
  /** ISO/epoch clock start (callers pass an explicit now; pure, no Date.now()). */
  now: string | number;
  /** Fixed dwell override for EVERY appended stop. When omitted, dwell is
   *  per-kind via `dwellMinutesForKind` (15 for a flexible fill). For tests. */
  dwellMin?: number;
}

export interface FillToCapacityResult {
  /** The day with the appended fills (existing order unchanged, fills at the end). */
  proposal: OrderedStop[];
  /** The stops added by THIS fill, in append order (for the notice + attribution). */
  added: OrderedStop[];
  /** New low-water mark into the pool: the first index (from the scan start)
   *  whose id is not yet placed. Everything before it is routed; the caller
   *  advances its cursor to this. Equals `pool.length` when the pool is drained. */
  poolCursor: number;
  /** Budget minutes still open AFTER this fill (input `remainingMin` minus the
   *  cost of every appended stop). The caller carries this forward so repeated
   *  taps deplete a single budget instead of each re-spending the full amount. */
  remainingMin: number;
}

const hasCoords = (s: {
  lat: number | null;
  lng: number | null;
}): s is { lat: number; lng: number } =>
  s.lat != null &&
  s.lng != null &&
  Number.isFinite(s.lat) &&
  Number.isFinite(s.lng);

/** Normalize a pool candidate into an OrderedStop, matching the assembler. */
const flexibleToOrdered = (s: FlexibleStop): OrderedStop => ({
  id: s.id,
  kind: "flexible",
  tier: s.tier,
  name: s.name,
  dealId: s.dealId,
  lat: s.lat,
  lng: s.lng,
  startAt: null,
  endAt: null,
  ageDays: s.ageDays,
});

/**
 * Fill the day's remaining capacity from `pool`, appending closest-to-the-last
 * stop first. Returns the new proposal, the stops added by this fill, and the
 * advanced pool cursor. Never reorders placed stops; never re-runs the optimizer.
 */
export function fillToCapacity(
  proposal: OrderedStop[],
  pool: FlexibleStop[],
  poolCursor: number,
  opts: FillToCapacityOptions,
): FillToCapacityResult {
  const { origin, remainingMin, dwellMin } = opts;
  const dwellFor = (tier: string): number => dwellMin ?? dwellMinutesForKind(tier);

  // Clamp the scan start into range; anything before it is already routed.
  const start = Number.isFinite(poolCursor) && poolCursor > 0 ? Math.floor(poolCursor) : 0;

  const result = [...proposal];
  const added: OrderedStop[] = [];
  const placed = new Set(proposal.map((s) => s.id));
  let budget = Number.isFinite(remainingMin) ? remainingMin : 0;

  // Anchor for "closest" = the last stop's coords (or origin on an empty day).
  const lastWithCoords = [...result].reverse().find((s) => hasCoords(s));
  let anchor: LatLng = lastWithCoords
    ? { lat: lastWithCoords.lat as number, lng: lastWithCoords.lng as number }
    : origin;

  // Greedy nearest-neighbor append: each pass picks the closest remaining
  // candidate to the current anchor; if it fits the budget, append and advance
  // the anchor to it, else STOP (contiguous fill-to-capacity).
  for (;;) {
    let best: FlexibleStop | null = null;
    let bestDrive = Infinity;
    for (let i = start; i < pool.length; i++) {
      const c = pool[i]!;
      if (placed.has(c.id) || !hasCoords(c)) continue;
      const drive = driveMinutesBetween(anchor, { lat: c.lat, lng: c.lng });
      if (drive < bestDrive) {
        bestDrive = drive;
        best = c;
      }
    }
    if (!best) break; // pool exhausted (nothing unplaced left to try)

    const cost = bestDrive + dwellFor(best.tier);
    if (cost > budget) break; // closest remaining does not fit: stop

    const ordered = flexibleToOrdered(best);
    result.push(ordered);
    added.push(ordered);
    placed.add(best.id);
    budget -= cost;
    anchor = { lat: best.lat, lng: best.lng };
  }

  // Advance the cursor past the leading run of now-placed pool items, so the
  // caller resumes at the first candidate still worth trying. Never skips an
  // unplaced candidate (proximity picks can be non-contiguous).
  let cursor = start;
  while (cursor < pool.length && placed.has(pool[cursor]!.id)) cursor++;

  return { proposal: result, added, poolCursor: cursor, remainingMin: budget };
}
