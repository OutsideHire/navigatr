import { describe, it, expect } from "vitest";
import { placeOwedVisits } from "./owedTimedPlacement";
import type { OwedVisit } from "./owedVisits";

const owed = (o: Partial<OwedVisit> = {}): OwedVisit => ({
  taskId: "t1",
  dealId: "d1",
  name: "Blue Bottle",
  address: null,
  placeId: "gp",
  lat: 40,
  lng: -74.01,
  urgency: 2,
  bandPosition: "past_ideal",
  dateSource: "interval",
  targetAt: "2026-08-07",
  earliestAt: "2026-08-05",
  latestAt: "2026-08-12",
  snoozeCount: 0,
  sourceOutcome: "not_available",
  createdAt: "2026-08-01T12:00:00.000Z",
  ...o,
});

const ctx = {
  windowStart: "2026-08-06T09:00:00.000Z",
  windowEnd: "2026-08-06T18:00:00.000Z",
  origin: { lat: 40, lng: -74 },
  waypoints: [],
  timeBlocks: [],
};

describe("placeOwedVisits", () => {
  it("returns no stops for an empty list", () => {
    expect(placeOwedVisits([], ctx)).toEqual({ placed: [], spilledTaskIds: [] });
  });

  it("places an owed visit with an approximate arrival rounded to 5 minutes", () => {
    const { placed, spilledTaskIds } = placeOwedVisits([owed()], ctx);
    expect(placed).toHaveLength(1);
    expect(spilledTaskIds).toEqual([]);
    // Arrival is within the window and rounded to a 5-minute mark.
    const ms = Date.parse(placed[0].aroundIso);
    expect(ms).toBeGreaterThanOrEqual(Date.parse(ctx.windowStart));
    expect(new Date(ms).getUTCMinutes() % 5).toBe(0);
    expect(placed[0]).toMatchObject({ taskId: "t1", dealId: "d1", bandPosition: "past_ideal" });
  });

  it("spills a visit that cannot fit before a hard window close", () => {
    // A one-minute window can't fit a 15-min dwell → the visit spills.
    const tight = { ...ctx, windowEnd: "2026-08-06T09:01:00.000Z" };
    const { placed, spilledTaskIds } = placeOwedVisits([owed()], tight);
    expect(placed).toHaveLength(0);
    expect(spilledTaskIds).toEqual(["t1"]);
  });

  it("orders by urgency — an aging visit is placed before a low-urgency one from the origin", () => {
    const aging = owed({ taskId: "aging", dealId: "dA", lat: 40, lng: -74.2, urgency: 3 }); // far but urgent
    const cool = owed({ taskId: "cool", dealId: "dB", lat: 40, lng: -74.005, urgency: 0.1 }); // near but cool
    const { placed } = placeOwedVisits([cool, aging], ctx);
    expect(placed[0].taskId).toBe("aging");
  });
});
