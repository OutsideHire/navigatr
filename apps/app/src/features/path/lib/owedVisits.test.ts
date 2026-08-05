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
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      taskId: "t1",
      dealId: "d1",
      name: "Blue Bottle",
      placeId: "gp-blue",
      lat: 37.77,
      lng: -122.41,
      bandPosition: "past_ideal",
      sourceOutcome: "not_available",
    });
    expect(out[0].urgency).toBeGreaterThan(1); // past_ideal is 1..2
  });

  it("drops a task whose deal has no place_id and no direct coords (manual deal, ungeocoded)", () => {
    const out = assembleOwedVisits([task()], [deal({ place_id: null })], [prospect()], PATH_DATE);
    expect(out).toHaveLength(0);
  });

  it("routes a manual deal off its own geocoded coords when there's no prospect (P2.1)", () => {
    const manual = deal({ place_id: null, lat: 40.1, lng: -74.2 });
    const out = assembleOwedVisits([task()], [manual], [], PATH_DATE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ placeId: null, lat: 40.1, lng: -74.2 });
  });

  it("drops a task whose prospect isn't in the coordinate cache", () => {
    const out = assembleOwedVisits([task()], [deal()], [], PATH_DATE);
    expect(out).toHaveLength(0);
  });

  it("drops a task on a won or lost deal", () => {
    expect(assembleOwedVisits([task()], [deal({ stage: "won" })], [prospect()], PATH_DATE)).toHaveLength(0);
    expect(assembleOwedVisits([task()], [deal({ stage: "lost" })], [prospect()], PATH_DATE)).toHaveLength(0);
  });

  it("drops a task before its window opens", () => {
    const out = assembleOwedVisits([task()], [deal()], [prospect()], "2026-08-04");
    expect(out).toHaveLength(0);
  });

  it("drops an opted-out or non-drop-in task", () => {
    expect(assembleOwedVisits([task({ exclude_from_path: true })], [deal()], [prospect()], PATH_DATE)).toHaveLength(0);
    expect(assembleOwedVisits([task({ type: "call" })], [deal()], [prospect()], PATH_DATE)).toHaveLength(0);
  });

  it("drops a task with a missing or null deal reference", () => {
    expect(assembleOwedVisits([task({ deal_id: null })], [deal()], [prospect()], PATH_DATE)).toHaveLength(0);
    expect(assembleOwedVisits([task({ deal_id: "ghost" })], [deal()], [prospect()], PATH_DATE)).toHaveLength(0);
  });

  it("suppresses a visit whose deal has a scheduled appointment today (supersede)", () => {
    const superseded = assembleOwedVisits([task()], [deal()], [prospect()], PATH_DATE, {
      supersededDealIds: new Set(["d1"]),
    });
    expect(superseded).toHaveLength(0);
    // A different deal in the set doesn't suppress this one.
    const kept = assembleOwedVisits([task()], [deal()], [prospect()], PATH_DATE, {
      supersededDealIds: new Set(["other"]),
    });
    expect(kept).toHaveLength(1);
  });

  it("excludes a task created at/after the cutoff (created during today's path)", () => {
    const cutoff = "2026-08-08T00:00:00.000Z";
    const createdToday = task({ created_at: "2026-08-08T09:30:00.000Z" });
    expect(assembleOwedVisits([createdToday], [deal()], [prospect()], PATH_DATE, { excludeCreatedAtOrAfter: cutoff })).toHaveLength(0);
    // A task created before the cutoff still appears.
    const createdYesterday = task({ created_at: "2026-08-07T09:30:00.000Z" });
    expect(assembleOwedVisits([createdYesterday], [deal()], [prospect()], PATH_DATE, { excludeCreatedAtOrAfter: cutoff })).toHaveLength(1);
  });

  it("orders by descending urgency, then earliest target date", () => {
    const aging = task({ id: "aging", deal_id: "dA", target_at: "2026-07-01", latest_at: "2026-07-05" });
    const inWindow = task({ id: "inwin", deal_id: "dB", earliest_at: "2026-08-08", target_at: "2026-08-20", latest_at: "2026-08-25" });
    const deals = [
      deal({ id: "dA", place_id: "gp-a" }),
      deal({ id: "dB", place_id: "gp-b" }),
    ];
    const prospects = [prospect({ place_id: "gp-a" }), prospect({ place_id: "gp-b" })];
    const out = assembleOwedVisits([inWindow, aging], deals, prospects, PATH_DATE);
    expect(out.map((v) => v.taskId)).toEqual(["aging", "inwin"]); // aging (3) before in-window (~0)
  });
});
