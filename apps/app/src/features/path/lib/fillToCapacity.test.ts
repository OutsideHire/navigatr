import { describe, expect, it } from "vitest";
import { fillToCapacity, type FillToCapacityOptions } from "./fillToCapacity";
import type { FlexibleStop, OrderedStop } from "./todaysPath";

const ORIGIN = { lat: 0, lng: 0 };

/** A pool candidate at an explicit coordinate. */
function flex(
  id: string,
  lat: number,
  lng: number,
  tier: FlexibleStop["tier"] = "nearby",
): FlexibleStop {
  return { id, dealId: null, name: `flex-${id}`, lat, lng, tier, ageDays: null };
}

/** A stop already placed in the ordered run. */
function orderedFlex(id: string, lat: number, lng: number): OrderedStop {
  return {
    id,
    kind: "flexible",
    tier: "nearby",
    name: `flex-${id}`,
    dealId: null,
    lat,
    lng,
    startAt: null,
    endAt: null,
    ageDays: null,
  };
}

const ids = (list: OrderedStop[]): string[] => list.map((s) => s.id);

describe("fillToCapacity", () => {
  it("fills multiple stops in one call up to remaining capacity", () => {
    // Three near-origin candidates, each ~0 drive + 15 dwell. A 60-min budget
    // holds all three (45 min of dwell + a little drive), a single fill folds
    // them all in one call.
    const pool = [flex("a", 0, 0.001), flex("b", 0, 0.002), flex("c", 0, 0.003)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 60, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity([], pool, 0, opts);

    expect(res.added.length).toBe(3);
    expect(res.proposal.length).toBe(3);
  });

  it("picks the closest-to-the-last-stop candidate first", () => {
    // Last stop of the current route sits at (0, 0.10). The pool holds a far
    // candidate first and a near one second; the near one must be appended
    // first because closeness is measured from the last stop, not pool order.
    const proposal = [orderedFlex("seed", 0, 0.1)];
    const pool = [flex("far", 0, 0.5), flex("near", 0, 0.105)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 240, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity(proposal, pool, 0, opts);

    // "near" is appended before "far".
    expect(ids(res.added)).toEqual(["near", "far"]);
  });

  it("appends in place: existing order is unchanged and new stops go at the end", () => {
    const proposal = [orderedFlex("x", 0, 0.01), orderedFlex("y", 0, 0.02)];
    const pool = [flex("z", 0, 0.03)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 120, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity(proposal, pool, 0, opts);

    expect(ids(res.proposal)).toEqual(["x", "y", "z"]);
    // First two entries are the exact original stops (not re-created / re-ordered).
    expect(res.proposal[0]).toBe(proposal[0]);
    expect(res.proposal[1]).toBe(proposal[1]);
  });

  it("never exceeds the remaining budget", () => {
    // Budget of 20 with a fixed 15-min dwell and ~0 drive: exactly one stop fits
    // (15 <= 20). A second stop would need another 15, exceeding 20.
    const pool = [flex("a", 0, 0.0001), flex("b", 0, 0.0002)];
    const opts: FillToCapacityOptions = {
      origin: ORIGIN,
      remainingMin: 20,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 15,
    };

    const res = fillToCapacity([], pool, 0, opts);

    expect(res.added.length).toBe(1);
    expect(ids(res.proposal)).toEqual(["a"]);
  });

  it("stops when the closest remaining candidate does not fit", () => {
    // A cheap near candidate fits first; the only one left after that is far
    // enough that its drive+dwell blows the remaining budget, so the fill stops.
    const pool = [flex("near", 0, 0.001), flex("far", 0, 1.0)];
    const opts: FillToCapacityOptions = {
      origin: ORIGIN,
      remainingMin: 20,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 5,
    };

    const res = fillToCapacity([], pool, 0, opts);

    // near: ~0 drive + 5 dwell = 5 <= 20, folds in. Budget now 15.
    // far: ~138 min drive from near, cannot fit, so the fill stops.
    expect(ids(res.added)).toEqual(["near"]);
  });

  it("excludes candidates whose id is already in the proposal", () => {
    const proposal = [orderedFlex("dup", 0, 0.01)];
    const pool = [flex("dup", 0, 0.01), flex("new", 0, 0.02)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 120, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity(proposal, pool, 0, opts);

    // "dup" is already routed, so only "new" is added; no duplicate appears.
    expect(ids(res.added)).toEqual(["new"]);
    expect(ids(res.proposal).filter((id) => id === "dup").length).toBe(1);
  });

  it("advances poolCursor past the consumed run", () => {
    const pool = [flex("a", 0, 0.001), flex("b", 0, 0.002), flex("c", 0, 0.5)];
    const opts: FillToCapacityOptions = {
      origin: ORIGIN,
      remainingMin: 40,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 15,
    };

    const res = fillToCapacity([], pool, 0, opts);

    // a + b fit (15 + ~0 drive each = 30 <= 40); c is far and does not fit.
    expect(ids(res.added)).toEqual(["a", "b"]);
    // Cursor advances past the leading placed run (a, b) to the first unplaced (c).
    expect(res.poolCursor).toBe(2);
  });

  it("honors poolCursor as the scan start", () => {
    // With poolCursor at 1, the candidate at index 0 is skipped entirely.
    const pool = [flex("skip", 0, 0.001), flex("take", 0, 0.002)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 120, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity([], pool, 1, opts);

    expect(ids(res.added)).toEqual(["take"]);
  });

  it("empty pool returns the proposal unchanged with no additions", () => {
    const proposal = [orderedFlex("x", 0, 0.01)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 120, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity(proposal, [], 0, opts);

    expect(res.added).toEqual([]);
    expect(res.proposal).toEqual(proposal);
    expect(res.poolCursor).toBe(0);
  });

  it("zero budget returns the proposal unchanged with no additions", () => {
    const proposal = [orderedFlex("x", 0, 0.01)];
    const pool = [flex("a", 0, 0.02)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 0, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity(proposal, pool, 0, opts);

    expect(res.added).toEqual([]);
    expect(ids(res.proposal)).toEqual(["x"]);
  });

  it("returns the leftover budget after the fill", () => {
    const pool = [flex("a", 0, 0.0001), flex("b", 0, 0.0002)];
    const opts: FillToCapacityOptions = {
      origin: ORIGIN,
      remainingMin: 60,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 15,
    };

    const res = fillToCapacity([], pool, 0, opts);

    // Two stops, ~0 drive + 15 dwell each = ~30 spent, so ~30 of 60 is left.
    expect(res.added.length).toBe(2);
    expect(res.remainingMin).toBeGreaterThan(29);
    expect(res.remainingMin).toBeLessThanOrEqual(30);
  });

  it("a follow-up fill cannot overcommit: feeding the leftover budget back refuses a stop the spent budget can no longer hold", () => {
    // 60-min budget; pool = two ~15-min near stops + one ~40-min far stop.
    const pool = [
      flex("n1", 0, 0.0001),
      flex("n2", 0, 0.0002),
      flex("far", 0, 0.1807), // ~25 min drive from origin + 15 dwell = ~40
    ];
    const res1 = fillToCapacity([], pool, 0, {
      origin: ORIGIN,
      remainingMin: 60,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 15,
    });

    // Tap 1 folds in the two near stops and correctly stops on the 40-min far.
    expect(ids(res1.added)).toEqual(["n1", "n2"]);
    expect(res1.remainingMin).toBeLessThan(40);

    // Tap 2 reuses the DEPLETED leftover, not the full 60: the far stop still
    // cannot fit, so nothing is appended and the day never exceeds 60 minutes.
    const res2 = fillToCapacity(res1.proposal, pool, res1.poolCursor, {
      origin: ORIGIN,
      remainingMin: res1.remainingMin,
      now: "2026-08-11T09:00:00Z",
      dwellMin: 15,
    });
    expect(res2.added).toEqual([]);
    expect(res2.proposal.length).toBe(2);
  });

  it("anchors closeness to the origin when the proposal is empty", () => {
    // No existing stops: the first pick is the pool candidate closest to origin.
    const pool = [flex("far", 0, 0.5), flex("near", 0, 0.01)];
    const opts: FillToCapacityOptions = { origin: ORIGIN, remainingMin: 240, now: "2026-08-11T09:00:00Z" };

    const res = fillToCapacity([], pool, 0, opts);

    expect(ids(res.added)[0]).toBe("near");
  });
});
