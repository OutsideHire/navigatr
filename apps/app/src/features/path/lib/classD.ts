/**
 * Class D — drop-in-follow waypoints for Path (SP3). Pure helpers: which open
 * drop-in Tasks are routable today, and how urgent each is by its band
 * position. Path READS the task's band dates (set by SP1); it never recomputes
 * them. Coordinates come from the deal's originating prospect (place_id join,
 * free); deals without coords aren't routable in v1.
 */

/** Minimal task shape these helpers need (a subset of the SP1 Task). */
export interface ClassDTaskLike {
  type: string;
  status: string;
  earliestAt: string; // YYYY-MM-DD
  targetAt: string;
  latestAt: string;
  dateSource: string; // interval | asserted | sla
  excludeFromPath: boolean;
}

export type BandPosition = "not_yet_open" | "in_window" | "past_ideal" | "aging" | "pinned";

/** A drop-in task is a Class D candidate for `pathDate` when it's open, routable
 *  (has coords), on an open deal, not opted out, and its window has opened. */
export function isClassDEligible(
  args: {
    type: string;
    status: string;
    earliestAt: string;
    excludeFromPath: boolean;
    dealStage: string;
    hasCoords: boolean;
  },
  pathDate: string,
): boolean {
  return (
    args.type === "drop_in" &&
    args.status === "open" &&
    !args.excludeFromPath &&
    args.hasCoords &&
    args.dealStage !== "won" &&
    args.dealStage !== "lost" &&
    pathDate >= args.earliestAt
  );
}

export function bandPosition(t: ClassDTaskLike, pathDate: string): BandPosition {
  if (t.dateSource === "asserted" || t.dateSource === "sla") return "pinned";
  if (pathDate < t.earliestAt) return "not_yet_open";
  if (pathDate <= t.targetAt) return "in_window";
  if (pathDate <= t.latestAt) return "past_ideal";
  return "aging";
}

const dayNum = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86_400_000;

/** Linear position of `d` within [a, b], clamped to [0,1]; 0 when the band is
 *  collapsed (a === b). */
function frac(d: string, a: string, b: string): number {
  const span = dayNum(b) - dayNum(a);
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (dayNum(d) - dayNum(a)) / span));
}

/**
 * Urgency 0..3 by band: pinned/aging flat 3; in_window 0→1 (earliest→target);
 * past_ideal 1→2 (target→latest). Not-yet-open is 0 (and not a candidate).
 */
export function urgencyFor(t: ClassDTaskLike, pathDate: string): number {
  const band = bandPosition(t, pathDate);
  switch (band) {
    case "pinned":
    case "aging":
      return 3;
    case "not_yet_open":
      return 0;
    case "in_window":
      return frac(pathDate, t.earliestAt, t.targetAt); // 0 → 1
    case "past_ideal":
      return 1 + frac(pathDate, t.targetAt, t.latestAt); // 1 → 2
  }
}
