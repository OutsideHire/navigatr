import { describe, it, expect } from "vitest";
import { computeFollowUpDiscipline } from "./persistenceIndex";
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
