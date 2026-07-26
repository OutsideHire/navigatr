import { describe, it, expect } from "vitest";
import {
  computeFollowUpDiscipline,
  computeTouchCadence,
  computeReEngagement,
  computePersistenceIndex,
  computeTeamPersistenceIndex,
  computePersistenceHistory,
  computePerRepPersistence,
  historyDelta,
  RANGE_PRESETS,
  SILENCE_THRESHOLD_DAYS,
  FAIRNESS_WINDOW_DAYS,
  REENGAGEMENT_MAX,
  FOLLOWUP_FLOOR,
  FORMULA_VERSION,
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
    // Below the FOLLOWUP_FLOOR (8 due), so it doesn't count as a sample yet.
    expect(result.belowFloor).toBe(true);
    expect(result.hasSample).toBe(false);
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
    // Below the FOLLOWUP_FLOOR (8 due), so it doesn't count as a sample yet.
    expect(result.belowFloor).toBe(true);
    expect(result.hasSample).toBe(false);
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

describe("computeFollowUpDiscipline volume floor", () => {
  it("3 due (below FOLLOWUP_FLOOR of 8): not a sample yet, but points still computed", () => {
    const deals = [deal({ id: "d1" }), deal({ id: "d2" }), deal({ id: "d3" })];
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      activity({ id: "a2", dealId: "d2", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
      activity({ id: "a3", dealId: "d3", occurredAt: "2026-06-05T00:00:00.000Z", followUpDate: "2026-06-10" }),
    ];
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(3);
    expect(result.belowFloor).toBe(true);
    expect(result.hasSample).toBe(false);
    expect(typeof result.points).toBe("number");
    expect(Number.isNaN(result.points)).toBe(false);
  });

  it("0 due: not a sample, and not below floor (nothing to floor)", () => {
    const deals = [deal({ id: "d1" })];
    const result = computeFollowUpDiscipline(deals, [], OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(0);
    expect(result.hasSample).toBe(false);
    expect(result.belowFloor).toBe(false);
  });

  it("8+ due (meets FOLLOWUP_FLOOR): a real sample, scores normally", () => {
    const deals = [deal({ id: "d1" })];
    const activities: ReturnType<typeof activity>[] = [];
    for (let i = 0; i < FOLLOWUP_FLOOR; i++) {
      activities.push(
        activity({ id: `due${i}`, dealId: "d1", occurredAt: dayOffset(3 * i), followUpDate: dayOffset(3 * i + 2).slice(0, 10) }),
      );
      activities.push(activity({ id: `kept${i}`, dealId: "d1", occurredAt: dayOffset(3 * i + 1), followUpDate: null }));
    }
    const result = computeFollowUpDiscipline(deals, activities, OWNER, WINDOW_START, WINDOW_END);
    expect(result.dueCount).toBe(8);
    expect(result.belowFloor).toBe(false);
    expect(result.hasSample).toBe(true);
    expect(result.completionRate).toBe(1);
    expect(result.points).toBe(40);
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
  it("blends follow-up discipline, touch cadence, and re-engagement into a composite out of 100", () => {
    const deals = [deal({ id: "d1" })]; // qualified, eligible for all three components
    // 8 due-and-kept follow-up pairs (meets FOLLOWUP_FLOOR) spread across the window,
    // frequent enough to also max out cadence and leave no qualifying silence.
    const activities: ReturnType<typeof activity>[] = [];
    for (let i = 0; i < FOLLOWUP_FLOOR; i++) {
      activities.push(
        activity({ id: `due${i}`, dealId: "d1", occurredAt: dayOffset(3 * i), followUpDate: dayOffset(3 * i + 2).slice(0, 10) }),
      );
      activities.push(activity({ id: `kept${i}`, dealId: "d1", occurredAt: dayOffset(3 * i + 1), followUpDate: null }));
    }
    const result = computePersistenceIndex(deals, activities, { ownerId: OWNER, now: NOW });

    expect(result.followUp.hasSample).toBe(true);
    expect(result.followUp.belowFloor).toBe(false);
    expect(result.cadence.hasSample).toBe(true);
    expect(result.reEngagement.hasSample).toBe(true);
    expect(result.windowDays).toBe(30);
    expect(result.targetScore).toBe(75);
    expect(result.formulaVersion).toBe(2);
    expect("responseVelocity" in result).toBe(false);
    expect(result.components.map((c) => c.key)).toEqual(["followUp", "cadence", "reEngagement"]);

    const availPoints = result.followUp.points + result.cadence.points + result.reEngagement.points;
    const availMax = result.followUp.max + result.cadence.max + result.reEngagement.max;
    expect(result.composite).toBe(Math.round((availPoints / availMax) * 100));
  });

  it("returns a null composite when there is no data at all", () => {
    const result = computePersistenceIndex([], [], { ownerId: OWNER, now: NOW });
    expect(result.composite).toBeNull();
    expect(result.followUp.hasSample).toBe(false);
    expect(result.cadence.hasSample).toBe(false);
    expect(result.reEngagement.hasSample).toBe(false);
  });

  it("scales off only the sampled component when a won deal excludes cadence and re-engagement", () => {
    const deals = [deal({ id: "d1", stage: "won" })];
    // 8 due-and-kept pairs so follow-up discipline meets the volume floor (won deals are
    // still eligible for follow-up, only cadence/re-engagement exclude won/lost stages).
    const activities: ReturnType<typeof activity>[] = [];
    for (let i = 0; i < FOLLOWUP_FLOOR; i++) {
      activities.push(
        activity({ id: `due${i}`, dealId: "d1", occurredAt: dayOffset(3 * i), followUpDate: dayOffset(3 * i + 2).slice(0, 10) }),
      );
      activities.push(activity({ id: `kept${i}`, dealId: "d1", occurredAt: dayOffset(3 * i + 1), followUpDate: null }));
    }
    const result = computePersistenceIndex(deals, activities, { ownerId: OWNER, now: NOW });

    expect(result.followUp.hasSample).toBe(true);
    expect(result.cadence.hasSample).toBe(false);
    expect(result.reEngagement.hasSample).toBe(false);
    expect(result.composite).toBe(Math.round((result.followUp.points / result.followUp.max) * 100));
  });

  it("blends a composite from cadence + re-engagement alone when follow-up is below the volume floor", () => {
    const deals = [
      deal({ id: "d1", owner_id: "rep-floor" }),
      deal({ id: "d2", owner_id: "rep-floor" }),
      deal({ id: "d3", owner_id: "rep-floor" }),
    ];
    // Each deal gets exactly 1 due follow-up -> dueCount 3, below FOLLOWUP_FLOOR (8).
    // Each deal also gets exactly 1 touch in-window, which is frequent enough for a
    // cadence sample but too recent to have gone silent (re-engagement scores full).
    const floorNow = new Date("2026-07-26T00:00:00Z");
    const activities = [
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-07-10T00:00:00Z", followUpDate: "2026-07-15" }),
      activity({ id: "a2", dealId: "d2", occurredAt: "2026-07-10T00:00:00Z", followUpDate: "2026-07-15" }),
      activity({ id: "a3", dealId: "d3", occurredAt: "2026-07-10T00:00:00Z", followUpDate: "2026-07-15" }),
    ];
    const result = computePersistenceIndex(deals, activities, { ownerId: "rep-floor", now: floorNow });

    expect(result.followUp.dueCount).toBe(3);
    expect(result.followUp.belowFloor).toBe(true);
    expect(result.followUp.hasSample).toBe(false);
    expect(result.cadence.hasSample).toBe(true);
    expect(result.reEngagement.hasSample).toBe(true);

    expect(typeof result.composite).toBe("number");
    expect(result.caveats.followUpBelowFloor).toBe(true);
    expect(result.components).toHaveLength(3);
    expect(result.components.map((c) => c.key)).toEqual(["followUp", "cadence", "reEngagement"]);
    expect(result.formulaVersion).toBe(2);
    expect("responseVelocity" in result).toBe(false);

    // Composite is scaled only over the components with a sample (cadence + re-engagement).
    const availPoints = result.cadence.points + result.reEngagement.points;
    const availMax = result.cadence.max + result.reEngagement.max;
    expect(result.composite).toBe(Math.round((availPoints / availMax) * 100));
  });
});

describe("computeReEngagement", () => {
  const now = new Date("2026-07-26T00:00:00Z");

  it("exposes its tuning constants", () => {
    expect(SILENCE_THRESHOLD_DAYS).toBe(21);
    expect(FAIRNESS_WINDOW_DAYS).toBe(7);
    expect(REENGAGEMENT_MAX).toBe(30);
    expect(FOLLOWUP_FLOOR).toBe(8);
    expect(FORMULA_VERSION).toBe(2);
  });

  it("counts a deal that went silent (25-day gap) and was later re-engaged", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      // 30 days before now: silence onset = 30-ago + 21 = 9 days before now,
      // which falls inside [now-30, now-7] -> qualifies.
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-26T00:00:00Z" }),
      // 5 days before now: the later touch that broke the 25-day silence gap.
      activity({ id: "a2", dealId: "d1", occurredAt: "2026-07-21T00:00:00Z" }),
    ];
    const result = computeReEngagement(deals, activities, OWNER, now);
    expect(result.silentCount).toBe(1);
    expect(result.reEngagedCount).toBe(1);
    expect(result.points).toBe(30);
    expect(result.hasSample).toBe(true);
  });

  it("counts a deal that went silent (40 days ago) and is still silent (trailing, no later touch)", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      // 40 days before now: onset = 40-ago + 21 = 19 days before now, inside [now-30, now-7].
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-16T00:00:00Z" }),
    ];
    const result = computeReEngagement(deals, activities, OWNER, now);
    expect(result.silentCount).toBe(1);
    expect(result.reEngagedCount).toBe(0);
    expect(result.points).toBe(0);
    expect(result.hasSample).toBe(true);
  });

  it("does not count a deal whose silence onset is too recent to be fair (inside the fairness window)", () => {
    const deals = [deal({ id: "d1" })];
    const activities = [
      // 25 days before now: onset = 25-ago + 21 = 4 days before now, AFTER the
      // fairness cutoff (now-7) -> not yet a fair chance to re-engage.
      activity({ id: "a1", dealId: "d1", occurredAt: "2026-07-01T00:00:00Z" }),
    ];
    const result = computeReEngagement(deals, activities, OWNER, now);
    expect(result.silentCount).toBe(0);
    // Zero silent deals with active deals present scores the full max, not "excluded".
    expect(result.points).toBe(30);
    expect(result.hasSample).toBe(true);
  });

  it("has no sample when the owner has no active deals", () => {
    const deals = [deal({ id: "d1", stage: "won" })];
    const activities = [activity({ id: "a1", dealId: "d1", occurredAt: "2026-06-16T00:00:00Z" })];
    const result = computeReEngagement(deals, activities, OWNER, now);
    expect(result.hasSample).toBe(false);
    expect(result.points).toBe(0);
  });

  it("excludes closed-lost deals from the denominator even with a qualifying silent gap", () => {
    const deals = [
      deal({ id: "d-lost", stage: "lost" }),
      deal({ id: "d-active", stage: "qualified" }),
    ];
    const activities = [
      // d-lost has a clearly qualifying silent gap, but is excluded by stage.
      activity({ id: "a1", dealId: "d-lost", occurredAt: "2026-06-16T00:00:00Z" }),
      // d-active has one recent touch, not yet silent.
      activity({ id: "a2", dealId: "d-active", occurredAt: "2026-07-21T00:00:00Z" }),
    ];
    const result = computeReEngagement(deals, activities, OWNER, now);
    expect(result.silentCount).toBe(0);
    expect(result.reEngagedCount).toBe(0);
    expect(result.points).toBe(30);
    expect(result.hasSample).toBe(true);
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
    // rep2's deal is closed-lost (not just quiet), so none of the three components
    // apply to it; an open-but-untouched deal would still score full re-engagement
    // (zero silent deals isn't "excluded"), so this uses a closed deal to test the
    // genuinely-no-data case.
    const deals = [repDeal("d1", "rep1"), deal({ id: "d2", owner_id: "rep2", stage: "lost" })];
    const t = computeTeamPersistenceIndex(deals, keptPair("d1", "2026-06-05"), { now: TEAM_NOW });
    expect(t.repCount).toBe(1);
    expect(t.range).toBeNull(); // <2 scored reps
  });

  it("returns null composite when no rep has data", () => {
    // Closed-lost so re-engagement (which would otherwise score a full, untouched,
    // open deal as "zero silent deals") doesn't give this rep a computable score.
    const t = computeTeamPersistenceIndex(
      [deal({ id: "d1", owner_id: "rep1", stage: "lost" })],
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
    // repZ's deal is closed-lost: an open-but-untouched deal would still score full
    // re-engagement (zero silent deals isn't "excluded"), so this uses a closed deal
    // to represent genuinely no data.
    const deals = [
      deal({ id: "d1", owner_id: "repA", stage: "qualified" }),
      deal({ id: "d2", owner_id: "repZ", stage: "lost" }),
    ];
    const rows = computePerRepPersistence(deals, [...kept("d1")], { now: NOW }); // repZ has no activity
    expect(rows[rows.length - 1].ownerId).toBe("repZ");
    expect(rows[rows.length - 1].composite).toBeNull();
  });

  it("nulls sub-component points when that sub-component has no sample", () => {
    // 8 due-and-kept pairs (meets FOLLOWUP_FLOOR) so follow-up discipline actually
    // has a sample to check.
    const deals = [deal({ id: "d1", owner_id: "repA", stage: "qualified" })];
    const activities: Activity[] = [];
    for (let i = 0; i < FOLLOWUP_FLOOR; i++) {
      activities.push(
        activity({ id: `due${i}`, dealId: "d1", occurredAt: dayOffset(3 * i), followUpDate: dayOffset(3 * i + 2).slice(0, 10) }),
      );
      activities.push(activity({ id: `kept${i}`, dealId: "d1", occurredAt: dayOffset(3 * i + 1), followUpDate: null }));
    }
    const rows = computePerRepPersistence(deals, activities, { now: NOW });
    expect(rows[0].followUpPoints).not.toBeNull(); // has a follow-up sample
  });
});
