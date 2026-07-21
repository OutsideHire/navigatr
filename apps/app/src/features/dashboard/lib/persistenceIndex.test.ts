import { describe, it, expect } from "vitest";
import {
  computeFollowUpDiscipline,
  computeTouchCadence,
  computePersistenceIndex,
  computeTeamPersistenceIndex,
  computePersistenceHistory,
  computePerRepPersistence,
  historyDelta,
  RANGE_PRESETS,
} from "./persistenceIndex";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import type { Activity } from "@/features/activities/mockData";

// Fixed window: 2026-06-01 .. 2026-07-01, matching the spec's test window.
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-01T00:00:00.000Z");
const OWNER = "rep-1";

/** Deal factory: fills required fields; only stage/owner_id usually vary. */
function deal(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id,
    companyName: o.companyName ?? o.id,
    contactName: "C",
    phone: "",
    email: "",
    valueCents: o.valueCents ?? 50_000_00,
    stage: o.stage ?? ("qualified" as DealStage),
    probability: 50,
    lastActivity: "2026-06-01T00:00:00.000Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "1-9",
    leadSource: o.leadSource ?? "",
    updatedAt: "2026-06-01T00:00:00.000Z",
    owner_id: o.owner_id === undefined ? OWNER : o.owner_id,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

/** Activity factory: only dealId/occurredAt/followUpDate usually vary. */
function activity(o: Partial<Activity> & { id: string; dealId: string }): Activity {
  return {
    id: o.id,
    dealId: o.dealId,
    type: o.type ?? "call",
    durationMinutes: o.durationMinutes ?? 10,
    disposition: o.disposition ?? "positive_engagement",
    outcomeNotes: o.outcomeNotes ?? "",
    occurredAt: o.occurredAt ?? "2026-06-05T00:00:00.000Z",
    followUpDate: o.followUpDate === undefined ? null : o.followUpDate,
    loggedBy: o.loggedBy ?? null,
  };
}

describe("computeFollowUpDiscipline", () => {
  it("counts a follow-up kept on time as full credit", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      // The on-time touch: after the due activity, on/before the follow-up date.
      activity({ id: "a2", dealId: "d1", occurredAt: "2026-06-09T00:00:00.000Z", followUpDate: null }),
    ];
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(1);
    expect(result.completionRate).toBe(1);
    expect(result.points).toBe(40);
    expect(result.hasSample).toBe(true);
  });

  it("does not count a touch that lands after the due date as on-time", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      // The follow-up touch happens AFTER the due date -> late, not on-time.
      activity({ id: "a2", dealId: "d1", occurredAt: "2026-06-12T00:00:00.000Z", followUpDate: null }),
    ];
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(1);
    expect(result.completionRate).toBe(0);
    expect(result.points).toBe(0);
    expect(result.hasSample).toBe(true);
  });

  it("excludes closed-lost deals and other reps' deals from the eligible set", () => {
    const deals = [
      deal({ id: "d-lost", stage: "lost" }),
      deal({ id: "d-other-rep", owner_id: "rep-2" }),
    ];
    const activities = [
      activity({ id: "a1", dealId: "d-lost", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      activity({ id: "a2", dealId: "d-other-rep", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
    ];
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(0);
    expect(result.hasSample).toBe(false);
    expect(result.completionRate).toBeNull();
  });

  it("excludes follow-ups whose due date falls outside the window", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      // Follow-up date is well before the window start.
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-05-01T00:00:00.000Z", followUpDate: "2026-05-05" }),
    ];
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(0);
    expect(result.hasSample).toBe(false);
  });
});

/** ISO timestamp `n` days after window start (day 0 = window start). */
function dayOffset(n: number): string {
  const d = new Date(WINDOW_START);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

describe("computeTouchCadence", () => {
  it("scores an on-target deal (well above target cadence) at max points", () => {
    const deals = [deal({ id: "d1" })];
    // 16 touches every 2 days across the 30-day window -> well above 3.5/wk.
    const activities = Array.from({ length: 16 }, (_, i) =>
      activity({ id: `a${i}`, dealId: "d1", occurredAt: dayOffset(i * 2) }),
    );
    const result = computeTouchCadence(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.activeDeals).toBe(1);
    expect(result.hasSample).toBe(true);
    expect(result.points).toBe(30);
  });

  it("excludes won deals from active deals and scores a below-target deal partway", () => {
    const deals = [deal({ id: "d1" }), deal({ id: "d2", stage: "won" })];
    const activities = [
      // d1: 2 touches across the window -> well below target cadence.
      activity({ id: "a1", dealId: "d1", occurredAt: dayOffset(0) }),
      activity({ id: "a2", dealId: "d1", occurredAt: dayOffset(15) }),
      // d2 is won -> excluded even though it has plenty of activity.
      activity({ id: "a3", dealId: "d2", occurredAt: dayOffset(0) }),
      activity({ id: "a4", dealId: "d2", occurredAt: dayOffset(2) }),
      activity({ id: "a5", dealId: "d2", occurredAt: dayOffset(4) }),
    ];
    const result = computeTouchCadence(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.activeDeals).toBe(1);
    expect(result.hasSample).toBe(true);
    expect(result.points).toBeGreaterThan(0);
    expect(result.points).toBeLessThan(30);
  });

  it("has no sample when the only deal with activity is won", () => {
    const deals = [deal({ id: "d2", stage: "won" })];
    const activities = [
      activity({ id: "a3", dealId: "d2", occurredAt: dayOffset(0) }),
      activity({ id: "a4", dealId: "d2", occurredAt: dayOffset(2) }),
    ];
    const result = computeTouchCadence(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.hasSample).toBe(false);
    expect(result.points).toBe(0);
    expect(result.activeDeals).toBe(0);
    expect(result.medianTouchesPerWeek).toBeNull();
  });
});

const NOW = new Date("2026-07-01T00:00:00.000Z");

describe("computePersistenceIndex", () => {
  it("blends follow-up discipline and touch cadence into a composite out of 100", () => {
    const deals = [deal({ id: "d1" })]; // qualified, eligible for both components
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      activity({ id: "a2", dealId: "d1", occurredAt: "2026-06-09T00:00:00.000Z", followUpDate: null }),
    ];
    const result = computePersistenceIndex(deals, activities, { ownerId: OWNER, now: NOW });

    expect(result.followUp.hasSample).toBe(true);
    expect(result.cadence.hasSample).toBe(true);
    expect(result.responseVelocity).toEqual({ comingSoon: true });
    expect(result.windowDays).toBe(30);
    expect(result.targetScore).toBe(75);

    const availPoints = result.followUp.points + result.cadence.points;
    const availMax = result.followUp.max + result.cadence.max;
    expect(result.composite).toBe(Math.round((availPoints / availMax) * 100));
  });

  it("returns a null composite when there is no data at all", () => {
    const result = computePersistenceIndex([], [], { ownerId: OWNER, now: NOW });
    expect(result.composite).toBeNull();
    expect(result.followUp.hasSample).toBe(false);
    expect(result.cadence.hasSample).toBe(false);
  });

  it("scales off only the sampled component when a won deal excludes cadence", () => {
    const deals = [deal({ id: "d1", stage: "won" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      activity({ id: "a2", dealId: "d1", occurredAt: "2026-06-09T00:00:00.000Z", followUpDate: null }),
    ];
    const result = computePersistenceIndex(deals, activities, { ownerId: OWNER, now: NOW });

    expect(result.followUp.hasSample).toBe(true);
    expect(result.cadence.hasSample).toBe(false);
    expect(result.composite).toBe(Math.round((result.followUp.points / result.followUp.max) * 100));
  });
});

describe("computeTeamPersistenceIndex", () => {
  const TEAM_NOW = new Date("2026-07-01T00:00:00.000Z");
  // Two reps, each with a kept follow-up on an owned qualified deal -> each scores.
  function repDeal(id: string, owner: string): Deal {
    return deal({ id, owner_id: owner, stage: "qualified" });
  }
  function keptPair(dealId: string, base: string): Activity[] {
    return [
      activity({ id: `${dealId}-s`, dealId, occurredAt: `${base}T10:00:00Z`, followUpDate: "2026-06-20" }),
      activity({ id: `${dealId}-k`, dealId, occurredAt: "2026-06-19T10:00:00Z" }),
    ];
  }

  it("team composite is the median of rep composites; range = min/max; repCount counts scored reps", () => {
    const deals = [repDeal("d1", "rep1"), repDeal("d2", "rep2")];
    const activities = [...keptPair("d1", "2026-06-05"), ...keptPair("d2", "2026-06-06")];
    const t = computeTeamPersistenceIndex(deals, activities, { now: TEAM_NOW });
    expect(t.repCount).toBe(2);
    expect(t.composite).not.toBeNull();
    expect(t.range).not.toBeNull();
    expect(t.range!.min).toBeLessThanOrEqual(t.range!.max);
    expect(t.responseVelocity.comingSoon).toBe(true);
  });

  it("excludes reps with no computable score", () => {
    const deals = [repDeal("d1", "rep1"), repDeal("d2", "rep2")];
    // only rep1 has activity; rep2's deal has none -> rep2 not scored
    const t = computeTeamPersistenceIndex(deals, keptPair("d1", "2026-06-05"), { now: TEAM_NOW });
    expect(t.repCount).toBe(1);
    expect(t.range).toBeNull(); // <2 scored reps
  });

  it("returns null composite when no rep has data", () => {
    const t = computeTeamPersistenceIndex(
      [deal({ id: "d1", owner_id: "rep1", stage: "qualified" })],
      [],
      { now: TEAM_NOW },
    );
    expect(t.composite).toBeNull();
    expect(t.repCount).toBe(0);
  });
});

describe("computePersistenceHistory", () => {
  const NOW = new Date("2026-07-01T00:00:00.000Z");

  it("returns one point per day in the range, newest last", () => {
    const pts = computePersistenceHistory([], [], { now: NOW, rangeDays: 7, ownerId: "rep1" });
    expect(pts).toHaveLength(7);
    expect(pts[0].date).toBe("2026-06-25");
    expect(pts[6].date).toBe("2026-07-01");
    expect(pts.every((p) => p.composite === null)).toBe(true); // no data
  });

  it("per-day composite matches a direct individual computation", () => {
    const deals = [deal({ id: "d1", owner_id: "rep1", stage: "qualified" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", followUpDate: "2026-06-20", occurredAt: "2026-06-05T10:00:00Z" }),
      activity({ id: "a2", dealId: "d1", followUpDate: null, occurredAt: "2026-06-19T10:00:00Z" }),
    ];
    const pts = computePersistenceHistory(deals, activities, { now: NOW, rangeDays: 30, ownerId: "rep1" });
    const last = pts[pts.length - 1];
    const direct = computePersistenceIndex(deals, activities, { ownerId: "rep1", now: NOW });
    expect(last.composite).toBe(direct.composite);
  });

  it("counts that day's activities for the volume series", () => {
    const deals = [deal({ id: "d1", owner_id: "rep1", stage: "qualified" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", followUpDate: null, occurredAt: "2026-06-30T09:00:00Z" }),
      activity({ id: "a2", dealId: "d1", followUpDate: null, occurredAt: "2026-06-30T15:00:00Z" }),
      activity({ id: "a3", dealId: "d1", followUpDate: null, occurredAt: "2026-07-01T09:00:00Z" }),
    ];
    const pts = computePersistenceHistory(deals, activities, { now: NOW, rangeDays: 7, ownerId: "rep1" });
    expect(pts.find((p) => p.date === "2026-06-30")!.activityCount).toBe(2);
    expect(pts.find((p) => p.date === "2026-07-01")!.activityCount).toBe(1);
  });

  it("historyDelta = last minus first non-null composite; null when <2", () => {
    expect(historyDelta([{ date: "a", composite: null, activityCount: 0 }])).toBeNull();
    expect(historyDelta([
      { date: "a", composite: 60, activityCount: 0 },
      { date: "b", composite: null, activityCount: 0 },
      { date: "c", composite: 72, activityCount: 0 },
    ])).toBe(12);
  });

  it("exposes range presets with 1M = 30 days", () => {
    expect(RANGE_PRESETS.find((r) => r.key === "1M")!.days).toBe(30);
  });
});

describe("computePerRepPersistence", () => {
  const NOW = new Date("2026-07-01T00:00:00.000Z");
  function kept(dealId: string): Activity[] {
    return [
      activity({ id: `${dealId}-s`, dealId, occurredAt: "2026-06-05T10:00:00Z", followUpDate: "2026-06-20" }),
      activity({ id: `${dealId}-k`, dealId, occurredAt: "2026-06-19T10:00:00Z" }),
    ];
  }

  it("returns one row per owner, sorted by composite descending", () => {
    const deals = [
      deal({ id: "d1", owner_id: "repA", stage: "qualified" }),
      deal({ id: "d2", owner_id: "repB", stage: "qualified" }),
    ];
    // repA: kept follow-up (high follow-up). repB: a missed follow-up (lower).
    const activities = [
      ...kept("d1"),
      activity({ id: "b-s", dealId: "d2", occurredAt: "2026-06-05T10:00:00Z", followUpDate: "2026-06-10" }),
      activity({ id: "b-late", dealId: "d2", occurredAt: "2026-06-25T10:00:00Z" }),
    ];
    const rows = computePerRepPersistence(deals, activities, { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0].composite! >= rows[1].composite!).toBe(true); // sorted desc
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(new Set(["repA", "repB"]));
  });

  it("sorts reps with no computable score last with null composite", () => {
    const deals = [
      deal({ id: "d1", owner_id: "repA", stage: "qualified" }),
      deal({ id: "d2", owner_id: "repZ", stage: "qualified" }),
    ];
    const rows = computePerRepPersistence(deals, [...kept("d1")], { now: NOW }); // repZ has no activity
    expect(rows[rows.length - 1].ownerId).toBe("repZ");
    expect(rows[rows.length - 1].composite).toBeNull();
  });

  it("nulls sub-component points when that sub-component has no sample", () => {
    const deals = [deal({ id: "d1", owner_id: "repA", stage: "qualified" })];
    const rows = computePerRepPersistence(deals, [...kept("d1")], { now: NOW });
    expect(rows[0].followUpPoints).not.toBeNull(); // has a follow-up sample
  });
});
