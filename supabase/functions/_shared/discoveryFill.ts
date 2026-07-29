/**
 * discoveryFill — pure helpers for the auto-widen-to-fill loop in
 * discover_prospects.
 *
 * When a discovery read returns fewer servable prospects than the rep asked
 * for, the edge function widens the search radius and re-reads until it fills
 * the requested count or hits a guardrail. These helpers hold the (Deno-free,
 * vitest-covered) decision logic so the edge function stays a thin driver and
 * the ladder/stop rules are testable in isolation.
 */

export interface RadiusLadderOpts {
  /** Hard cap on the widest search radius, in meters. Kept under Google's
   *  50 km circle cap by the caller. The final rung is exactly this value. */
  maxRadiusM: number;
  /** Growth multiplier per rung. Values <= 1 disable geometric growth (the
   *  ladder then jumps straight from start to the cap). Default 1.5. */
  factor?: number;
  /** Maximum number of rungs, including the starting radius. Default 4. */
  maxSteps?: number;
}

/**
 * Build the escalating radius ladder the fill loop walks, nearest first.
 *
 * Starts at `startM` and grows by `factor` each rung, keeping every rung
 * strictly below `maxRadiusM`, then appends `maxRadiusM` as the final rung so
 * the widest attempt always reaches the cap. Strictly increasing, integer
 * meters, at most `maxSteps` rungs.
 *
 * If `startM` is already at or beyond `maxRadiusM`, no widening is possible and
 * the ladder is just `[startM]` (the rep's own radius is never shrunk).
 */
export function buildRadiusLadder(startM: number, opts: RadiusLadderOpts): number[] {
  const start = Math.max(1, Math.round(startM));
  const maxRadiusM = Math.round(opts.maxRadiusM);
  const factor = opts.factor && opts.factor > 1 ? opts.factor : 1.5;
  const maxSteps = opts.maxSteps && opts.maxSteps >= 1 ? Math.floor(opts.maxSteps) : 4;

  // Already at/over the cap, or only one rung allowed: no widening.
  if (start >= maxRadiusM || maxSteps === 1) return [start];

  const ladder: number[] = [start];
  // Geometric rungs strictly below the cap, leaving room for the final cap rung.
  let v = start * factor;
  while (ladder.length < maxSteps - 1) {
    const rung = Math.round(v);
    if (rung >= maxRadiusM || rung <= ladder[ladder.length - 1]) break;
    ladder.push(rung);
    v *= factor;
  }
  // Final rung is always the cap (there is room: we stopped at maxSteps - 1).
  ladder.push(maxRadiusM);
  return ladder;
}

/** The loop has filled once it has at least `target` servable results. */
export function hasFilled(count: number, target: number): boolean {
  return count >= target;
}

/**
 * True when widening to the current rung produced no new servable results vs
 * the previous rung, i.e. the extra area is empty and further widening is
 * wasted Google spend.
 */
export function isDiminishing(prevCount: number, currCount: number): boolean {
  return currCount <= prevCount;
}
