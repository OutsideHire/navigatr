// Route-around optimizer, slice 1 — the heart.
//
// Pure, deterministic day scheduler. Given a rep's fixed calendar (located
// waypoints + time-blocks), a starting origin, and a pool of selected
// prospects, it packs the prospects into the free gaps *around* the fixed
// events and returns a chronological timeline with ETAs, feasibility flags,
// and the ids it couldn't fit.
//
// No React, no network. Drive time is the slice-1 haversine heuristic shared
// with routeStats (driveMinutesBetween); a Directions API is a later upgrade.
// Every ETA here is a labeled ESTIMATE, not a promise.

import { driveMinutesBetween } from "./driveTime";
import { computeFreeWindows } from "./freeWindows";

export interface SchedLatLng {
  lat: number;
  lng: number;
}

export interface FixedWaypoint {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  lat: number;
  lng: number;
}

export interface SchedTimeBlock {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
}

export interface SchedProspect {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ScheduleInput {
  windowStart: string; // ISO
  windowEnd: string; // ISO
  origin: SchedLatLng;
  waypoints: FixedWaypoint[];
  timeBlocks: SchedTimeBlock[];
  prospects: SchedProspect[];
  dwellMin?: number; // default 20
  bufferMin?: number; // default 10
}

export type TimelineEntry =
  | { kind: "waypoint"; id: string; title: string; start: string; end: string }
  | { kind: "timeblock"; id: string; title: string; start: string; end: string }
  | { kind: "prospect"; id: string; name: string; arrive: string; depart: string };

export interface ScheduleResult {
  timeline: TimelineEntry[];
  conflicts: Array<{ betweenTitles: [string, string]; detail: string }>;
  unscheduledProspectIds: string[];
}

// --- arithmetic helpers -----------------------------------------------------

const minutesBetween = (aIso: string, bIso: string) =>
  (Date.parse(bIso) - Date.parse(aIso)) / 60000;

const addMinutes = (iso: string, min: number) =>
  new Date(Date.parse(iso) + min * 60000).toISOString();

const clampIso = (iso: string, lo: number, hi: number) => {
  const t = Math.max(lo, Math.min(hi, Date.parse(iso)));
  return new Date(t).toISOString();
};

// A fixed span already clamped to the day window. Located waypoints carry a
// lat/lng so the gap-filler can reason about drive legs into/out of them;
// time-blocks are pure calendar holds with no geography.
interface FixedSpan {
  start: string;
  end: string;
  loc: SchedLatLng | null;
  title: string;
}

export function scheduleDay(input: ScheduleInput): ScheduleResult {
  const dwell = input.dwellMin ?? 20;
  const buffer = input.bufferMin ?? 10;
  const wStart = Date.parse(input.windowStart);
  const wEnd = Date.parse(input.windowEnd);

  // --- Fixed spans: waypoints (located) + time-blocks, clamped & sorted -----
  const wpSpans: FixedSpan[] = input.waypoints.map((w) => ({
    start: clampIso(w.start, wStart, wEnd),
    end: clampIso(w.end, wStart, wEnd),
    loc: { lat: w.lat, lng: w.lng },
    title: w.title,
  }));
  const blockSpans: FixedSpan[] = input.timeBlocks.map((b) => ({
    start: clampIso(b.start, wStart, wEnd),
    end: clampIso(b.end, wStart, wEnd),
    loc: null,
    title: b.title,
  }));

  const fixedSpans = [...wpSpans, ...blockSpans].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );

  // --- Conflict pass: consecutive *located* waypoints, in start order -------
  const conflicts: ScheduleResult["conflicts"] = [];
  const locatedWps = wpSpans
    .slice()
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (let i = 1; i < locatedWps.length; i++) {
    const A = locatedWps[i - 1];
    const B = locatedWps[i];
    const need = driveMinutesBetween(A.loc!, B.loc!);
    const have = minutesBetween(A.end, B.start);
    if (need > have) {
      conflicts.push({
        betweenTitles: [A.title, B.title],
        detail: `~${Math.round(have)}min apart, need ~${Math.round(need)}min to drive`,
      });
    }
  }

  // --- Gaps: the free windows between the fixed spans -----------------------
  const gaps = computeFreeWindows(
    input.windowStart,
    input.windowEnd,
    fixedSpans.map((s) => ({ start: s.start, end: s.end })),
  );

  // Located waypoints sorted once, for entry/exit lookups per gap.
  const wpByStart = locatedWps;

  const pool = new Map(input.prospects.map((p) => [p.id, p]));
  const scheduled: Array<{ id: string; name: string; arrive: string; depart: string }> = [];

  gaps.forEach((gap, gapIndex) => {
    // entryLoc: where the rep is when the gap opens. First gap → origin.
    // Otherwise → the most-recent located waypoint that ended at/before the
    // gap start (the rep is standing wherever their last fixed meeting was).
    let entryLoc: SchedLatLng;
    if (gapIndex === 0) {
      entryLoc = input.origin;
    } else {
      const priorWps = wpByStart.filter(
        (w) => Date.parse(w.end) <= Date.parse(gap.start),
      );
      const prior = priorWps[priorWps.length - 1];
      // Fall back to origin if the gap is bounded only by time-blocks (no
      // located waypoint precedes it) — the rep's position is still origin.
      entryLoc = prior?.loc ?? input.origin;
    }

    // exit: a located waypoint whose start == gap end constrains the return
    // leg (must arrive by waypoint.start, at its location). Otherwise the gap
    // is bounded by the window end (or a time-block) and only the depart time
    // needs to fit inside the window.
    const exitWp = wpByStart.find((w) => w.start === gap.end);
    const exit: { deadline: string; loc: SchedLatLng | null } = exitWp
      ? { deadline: exitWp.start, loc: exitWp.loc }
      : { deadline: gap.end, loc: null };

    let cursor = gap.start;
    let cursorLoc = entryLoc;

    // Nearest-that-fits, greedily, until nothing more fits this gap.
    for (;;) {
      let best: {
        p: SchedProspect;
        arrive: string;
        depart: string;
        drive: number;
      } | null = null;

      for (const p of pool.values()) {
        const drive = driveMinutesBetween(cursorLoc, { lat: p.lat, lng: p.lng });
        const arrive = addMinutes(cursor, drive);
        const depart = addMinutes(arrive, dwell);

        const fits = exit.loc
          ? Date.parse(
              addMinutes(depart, driveMinutesBetween({ lat: p.lat, lng: p.lng }, exit.loc) + buffer),
            ) <= Date.parse(exit.deadline)
          : Date.parse(depart) <= Date.parse(input.windowEnd);

        if (!fits) continue;
        // Nearest-that-fits: smallest drive from the cursor. Ties broken by
        // the deterministic Map iteration order (insertion order), so the
        // first-supplied prospect wins.
        if (best === null || drive < best.drive) {
          best = { p, arrive, depart, drive };
        }
      }

      if (best === null) break; // nothing else fits → close the gap.

      scheduled.push({
        id: best.p.id,
        name: best.p.name,
        arrive: best.arrive,
        depart: best.depart,
      });
      cursor = best.depart;
      cursorLoc = { lat: best.p.lat, lng: best.p.lng };
      pool.delete(best.p.id);
    }
  });

  const unscheduledProspectIds = [...pool.keys()];

  // --- Timeline: scheduled prospects + waypoints + time-blocks, sorted ------
  const timeline: TimelineEntry[] = [
    ...scheduled.map(
      (s): TimelineEntry => ({
        kind: "prospect",
        id: s.id,
        name: s.name,
        arrive: s.arrive,
        depart: s.depart,
      }),
    ),
    ...input.waypoints.map(
      (w): TimelineEntry => ({
        kind: "waypoint",
        id: w.id,
        title: w.title,
        start: clampIso(w.start, wStart, wEnd),
        end: clampIso(w.end, wStart, wEnd),
      }),
    ),
    ...input.timeBlocks.map(
      (b): TimelineEntry => ({
        kind: "timeblock",
        id: b.id,
        title: b.title,
        start: clampIso(b.start, wStart, wEnd),
        end: clampIso(b.end, wStart, wEnd),
      }),
    ),
  ];

  const sortKey = (e: TimelineEntry) =>
    Date.parse(e.kind === "prospect" ? e.arrive : e.start);
  timeline.sort((a, b) => sortKey(a) - sortKey(b));

  return { timeline, conflicts, unscheduledProspectIds };
}
