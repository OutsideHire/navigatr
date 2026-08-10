import { describe, it, expect } from "vitest";
import {
  assembleOwedVisits,
  type OwedTaskRow,
  type OwedDealRow,
  type OwedProspectRow,
} from "./owedVisits";

const task = (o: Partial<OwedTaskRow> = {}): OwedTaskRow => ({
  id: "t1",
  deal_id: "d1",
  type: "drop_in",
  status: "open",
  earliest_at: "2026-08-05",
  target_at: "2026-08-07",
  latest_at: "2026-08-12",
  date_source: "interval",
  exclude_from_path: false,
  source_outcome: "not_available",
  snooze_count: 0,
  created_at: "2026-07-01T12:00:00.000Z", // created well before the path date
  ...o,
});

const deal = (o: Partial<OwedDealRow> = {}): OwedDealRow => ({
  id: "d1",
  company_name: "Blue Bottle",
  address: "1 Main St",
  stage: "contacted",
  place_id: "gp-blue",
  lat: null,
  lng: null,
  ...o,
});

const prospect = (o: Partial<OwedProspectRow> = {}): OwedProspectRow => ({
  place_id: "gp-blue",
  lat: 37.77,
  lng: -122.41,
  ...o,
});

const PATH_DATE = "2026-08-08"; // past_ideal for the default band

describe("assembleOwedVisits", () => {
  it("joins a due drop-in to its deal + prospect coords and computes urgency", () => {
    const out = assembleOwedVisits([task()], [deal()], [prospect()], PATH_DATE);
    expect(out.routable).toHaveLength(1);
    expect(out.noLocation).toHaveLength(0);
    expect(out.routable[0]).toMatchObject({
      taskId: "t1",
      dealId: "d1",
      name: "Blue Bottle",
      placeId: "gp-blue",
      lat: 37.77,
      lng: -122.41,
      bandPosition: "past_ideal",
      sourceOutcome: "not_available",
    });
    expect(out.routable[0].urgency).toBeGreaterThan(1); // past_ideal is 1..2
  });

  it("surfaces (does NOT drop) an eligible task whose deal has no place_id and no direct coords", () => {
    const out = assembleOwedVisits([task()], [deal({ place_id: null })], [prospect()], PATH_DATE);
    // Not routable, but surfaced as a no-location stub so it never silently vanishes.
    expect(out.routable).toHaveLength(0);
    expect(out.noLocation).toHaveLength(1);
    expect(out.noLocation[0]).toEqual({
      taskId: "t1",
      dealId: "d1",
      name: "Blue Bottle",
      address: "1 Main St",
    });
  });

  it("routes a manual deal off its own geocoded coords when there's no prospect (P2.1)", () => {
    const manual = deal({ place_id: null, lat: 40.1, lng: -74.2 });
    const out = assembleOwedVisits([task()], [manual], [], PATH_DATE);
    expect(out.routable).toHaveLength(1);
    expect(out.noLocation).toHaveLength(0);
    expect(out.routable[0]).toMatchObject({ placeId: null, lat: 40.1, lng: -74.2 });
  });

  it("surfaces an eligible task whose prospect isn't in the coordinate cache as no-location", () => {
    const out = assembleOwedVisits([task()], [deal({ address: null })], [], PATH_DATE);
    expect(out.routable).toHaveLength(0);
    expect(out.noLocation).toHaveLength(1);
    // address may be null on the stub.
    expect(out.noLocation[0]).toEqual({ taskId: "t1", dealId: "d1", name: "Blue Bottle", address: null });
  });

  it("drops (neither routable nor no-location) a task on a won or lost deal", () => {
    for (const stage of ["won", "lost"] as const) {
      const out = assembleOwedVisits([task()], [deal({ stage, place_id: null })], [prospect()], PATH_DATE);
      expect(out.routable).toHaveLength(0);
      expect(out.noLocation).toHaveLength(0);
    }
  });

  it("drops a task before its window opens (neither routable nor no-location)", () => {
    const out = assembleOwedVisits([task()], [deal({ place_id: null })], [prospect()], "2026-08-04");
    expect(out.routable).toHaveLength(0);
    expect(out.noLocation).toHaveLength(0);
  });

  it("drops an opted-out or non-drop-in task (neither list)", () => {
    const optedOut = assembleOwedVisits([task({ exclude_from_path: true })], [deal({ place_id: null })], [prospect()], PATH_DATE);
    expect(optedOut.routable).toHaveLength(0);
    expect(optedOut.noLocation).toHaveLength(0);
    const nonDropIn = assembleOwedVisits([task({ type: "call" })], [deal({ place_id: null })], [prospect()], PATH_DATE);
    expect(nonDropIn.routable).toHaveLength(0);
    expect(nonDropIn.noLocation).toHaveLength(0);
  });

  it("drops a task with a missing or null deal reference (neither list)", () => {
    const nullDeal = assembleOwedVisits([task({ deal_id: null })], [deal()], [prospect()], PATH_DATE);
    expect(nullDeal.routable).toHaveLength(0);
    expect(nullDeal.noLocation).toHaveLength(0);
    const ghost = assembleOwedVisits([task({ deal_id: "ghost" })], [deal()], [prospect()], PATH_DATE);
    expect(ghost.routable).toHaveLength(0);
    expect(ghost.noLocation).toHaveLength(0);
  });

  it("suppresses a visit whose deal has a scheduled appointment today (supersede) from both lists", () => {
    // A superseded deal is suppressed whether or not it has coords.
    const superseded = assembleOwedVisits([task()], [deal({ place_id: null })], [prospect()], PATH_DATE, {
      supersededDealIds: new Set(["d1"]),
    });
    expect(superseded.routable).toHaveLength(0);
    expect(superseded.noLocation).toHaveLength(0);
    // A different deal in the set doesn't suppress this one.
    const kept = assembleOwedVisits([task()], [deal()], [prospect()], PATH_DATE, {
      supersededDealIds: new Set(["other"]),
    });
    expect(kept.routable).toHaveLength(1);
  });

  it("excludes a task created at/after the cutoff from both lists (created during today's path)", () => {
    const cutoff = "2026-08-08T00:00:00.000Z";
    const createdToday = task({ created_at: "2026-08-08T09:30:00.000Z" });
    const excluded = assembleOwedVisits([createdToday], [deal({ place_id: null })], [prospect()], PATH_DATE, {
      excludeCreatedAtOrAfter: cutoff,
    });
    expect(excluded.routable).toHaveLength(0);
    expect(excluded.noLocation).toHaveLength(0);
    // A task created before the cutoff still appears.
    const createdYesterday = task({ created_at: "2026-08-07T09:30:00.000Z" });
    expect(
      assembleOwedVisits([createdYesterday], [deal()], [prospect()], PATH_DATE, { excludeCreatedAtOrAfter: cutoff })
        .routable,
    ).toHaveLength(1);
  });

  it("orders routable by descending urgency, then earliest target date", () => {
    const aging = task({ id: "aging", deal_id: "dA", target_at: "2026-07-01", latest_at: "2026-07-05" });
    const inWindow = task({ id: "inwin", deal_id: "dB", earliest_at: "2026-08-08", target_at: "2026-08-20", latest_at: "2026-08-25" });
    const deals = [
      deal({ id: "dA", place_id: "gp-a" }),
      deal({ id: "dB", place_id: "gp-b" }),
    ];
    const prospects = [prospect({ place_id: "gp-a" }), prospect({ place_id: "gp-b" })];
    const out = assembleOwedVisits([inWindow, aging], deals, prospects, PATH_DATE);
    expect(out.routable.map((v) => v.taskId)).toEqual(["aging", "inwin"]); // aging (3) before in-window (~0)
  });

  it("splits a mixed batch into routable + no-location by coord availability", () => {
    const withCoords = task({ id: "has", deal_id: "dC" });
    const noCoords = task({ id: "none", deal_id: "dD" });
    const deals = [
      deal({ id: "dC", place_id: "gp-c" }),
      deal({ id: "dD", place_id: null, company_name: "No Map Co", address: "9 Off Grid Rd" }),
    ];
    const prospects = [prospect({ place_id: "gp-c" })];
    const out = assembleOwedVisits([withCoords, noCoords], deals, prospects, PATH_DATE);
    expect(out.routable.map((v) => v.taskId)).toEqual(["has"]);
    expect(out.noLocation).toEqual([
      { taskId: "none", dealId: "dD", name: "No Map Co", address: "9 Off Grid Rd" },
    ]);
  });
});
