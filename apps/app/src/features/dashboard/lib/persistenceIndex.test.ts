import { describe, it, expect } from "vitest";
import { computeFollowUpDiscipline, computeTouchCadence } from "./persistenceIndex";
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
