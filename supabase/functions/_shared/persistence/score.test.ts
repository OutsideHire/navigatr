import { describe, it, expect } from "vitest";
import { scoreRep, DEFAULT_SCORE_PARAMS, type ScoreDeal, type ScoreActivity } from "./score";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const OWNER = "rep-1";

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/** Deal factory: fills the two re-engagement exclusion fields with their
 *  "not excluded" defaults so existing callers don't need to spell them out. */
function deal(o: {
  id: string;
  owner_id: string | null;
  stage: string;
  owner_changed_at?: string | null;
  has_future_appointment?: boolean;
}): ScoreDeal {
  return {
    id: o.id,
    owner_id: o.owner_id,
    stage: o.stage,
    owner_changed_at: o.owner_changed_at ?? null,
    has_future_appointment: o.has_future_appointment ?? false,
  };
}

describe("scoreRep", () => {
  it("returns a null composite with no deals/activities", () => {
    const r = scoreRep([], [], OWNER, NOW);
    expect(r.composite).toBeNull();
    expect(r.followupPoints).toBe(0);
    expect(r.followupBelowFloor).toBe(false);
    expect(r.followupDueCount).toBe(0);
    expect(r.cadencePoints).toBe(0);
    expect(r.reengagementPoints).toBe(0);
    expect(r.reengagementRate).toBeNull();
    expect(r.formulaVersion).toBe(DEFAULT_SCORE_PARAMS.formulaVersion);
  });

  it("scores full re-engagement points with active deals and zero silence", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    const activities: ScoreActivity[] = [
      { dealId: "d1", occurredAt: iso(2), followUpDate: null },
      { dealId: "d1", occurredAt: iso(1), followUpDate: null },
    ];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.reengagementPoints).toBe(30);
    expect(r.reengagementRate).toBeNull();
    expect(r.dealsWentSilentCount).toBe(0);
    expect(r.dealsReEngagedCount).toBe(0);
  });

  it("marks follow-up discipline below the floor when due count is under 8", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // 3 due follow-ups, all kept on time; dueCount 3 < floor 8.
    const activities: ScoreActivity[] = [];
    for (let i = 0; i < 3; i++) {
      const followUpDate = iso(10 - i).slice(0, 10);
      activities.push({ dealId: "d1", occurredAt: iso(15 - i), followUpDate });
      activities.push({ dealId: "d1", occurredAt: iso(9 - i), followUpDate: null });
    }
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.followupDueCount).toBeGreaterThan(0);
    expect(r.followupDueCount).toBeLessThan(DEFAULT_SCORE_PARAMS.followupFloor);
    expect(r.followupBelowFloor).toBe(true);
  });

  it("re-engaged deal case: a later touch after the silence window counts as re-engaged", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // Last touch 25 days ago -> onset at 25-21=4 days ago, inside [30,7]... wait must be
    // windowStartMs..fairnessCutoffMs i.e. onset between 30 and 7 days ago.
    // touch at day 29 ago, next touch at day 3 ago (28 days later > 21 silence threshold)
    // onset = 29 - 21 = 8 days ago, which is within [30,7] window -> qualifies, and reEngaged true.
    const activities: ScoreActivity[] = [
      { dealId: "d1", occurredAt: iso(29), followUpDate: null },
      { dealId: "d1", occurredAt: iso(3), followUpDate: null },
    ];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.dealsWentSilentCount).toBe(1);
    expect(r.dealsReEngagedCount).toBe(1);
    expect(r.reengagementRate).toBe(1);
    expect(r.reengagementPoints).toBe(30);
  });

  it("still-silent deal: no later touch after the silence onset does not re-engage", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // Single touch 29 days ago -> onset 29-21=8 days ago, within [30,7] window, no later touch.
    const activities: ScoreActivity[] = [{ dealId: "d1", occurredAt: iso(29), followUpDate: null }];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.dealsWentSilentCount).toBe(1);
    expect(r.dealsReEngagedCount).toBe(0);
    expect(r.reengagementRate).toBe(0);
    expect(r.reengagementPoints).toBe(0);
  });

  it("has no re-engagement sample when there are no active (open) deals", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "won" })];
    const activities: ScoreActivity[] = [{ dealId: "d1", occurredAt: iso(29), followUpDate: null }];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.reengagementPoints).toBe(0);
    expect(r.reengagementRate).toBeNull();
    expect(r.dealsWentSilentCount).toBe(0);
    // composite should not include re-engagement's max in the denominator;
    // with no other sampled component either, composite is null.
    expect(r.composite).toBeNull();
  });

  it("computes cadence points at the max when median touches/week meets the target", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // Many touches within the last week to exceed the 3.5/wk target easily.
    const activities: ScoreActivity[] = [
      { dealId: "d1", occurredAt: iso(6), followUpDate: null },
      { dealId: "d1", occurredAt: iso(5), followUpDate: null },
      { dealId: "d1", occurredAt: iso(4), followUpDate: null },
      { dealId: "d1", occurredAt: iso(3), followUpDate: null },
      { dealId: "d1", occurredAt: iso(2), followUpDate: null },
    ];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.cadencePoints).toBe(DEFAULT_SCORE_PARAMS.cadenceMax);
  });

  it("uses custom params instead of the hardcoded defaults", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    const activities: ScoreActivity[] = [
      { dealId: "d1", occurredAt: iso(2), followUpDate: null },
    ];
    const params = { ...DEFAULT_SCORE_PARAMS, reengagementMax: 50 };
    const r = scoreRep(deals, activities, OWNER, NOW, params);
    expect(r.reengagementPoints).toBe(50);
    expect(r.formulaVersion).toBe(DEFAULT_SCORE_PARAMS.formulaVersion);
  });

  it("excludes a deal with a future appointment from the re-engagement denominator, even though it would otherwise be a silent miss", () => {
    const deals: ScoreDeal[] = [
      deal({ id: "d1", owner_id: OWNER, stage: "open", has_future_appointment: true }),
    ];
    // Single touch 29 days ago -> onset 8 days ago, within [30,7] window, no later touch:
    // would otherwise be a silent miss, but the future appointment excludes it entirely.
    const activities: ScoreActivity[] = [{ dealId: "d1", occurredAt: iso(29), followUpDate: null }];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.dealsWentSilentCount).toBe(0);
    expect(r.dealsReEngagedCount).toBe(0);
    expect(r.reengagementPoints).toBe(30); // zero silent deals with an active deal present scores full
  });

  it("excludes a deal reassigned within the trailing 30 days from the re-engagement denominator", () => {
    const deals: ScoreDeal[] = [
      deal({ id: "d1", owner_id: OWNER, stage: "open", owner_changed_at: iso(10) }),
    ];
    const activities: ScoreActivity[] = [{ dealId: "d1", occurredAt: iso(29), followUpDate: null }];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.dealsWentSilentCount).toBe(0);
    expect(r.reengagementPoints).toBe(30);
  });

  it("includes a deal reassigned 40 days ago (outside the 30-day lookback) in the re-engagement denominator", () => {
    const deals: ScoreDeal[] = [
      deal({ id: "d1", owner_id: OWNER, stage: "open", owner_changed_at: iso(40) }),
    ];
    const activities: ScoreActivity[] = [{ dealId: "d1", occurredAt: iso(29), followUpDate: null }];
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.dealsWentSilentCount).toBe(1);
    expect(r.dealsReEngagedCount).toBe(0);
  });

  it("forces the composite to null and sets insufficientData when follow-up discipline is below the volume floor", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // 3 due follow-ups, all kept on time; dueCount 3 < floor 8. Also give the deal
    // cadence + re-engagement samples so those points remain available.
    const activities: ScoreActivity[] = [
      { dealId: "d1", occurredAt: iso(2), followUpDate: null },
      { dealId: "d1", occurredAt: iso(1), followUpDate: null },
    ];
    for (let i = 0; i < 3; i++) {
      const followUpDate = iso(10 - i).slice(0, 10);
      activities.push({ dealId: "d1", occurredAt: iso(15 - i), followUpDate });
      activities.push({ dealId: "d1", occurredAt: iso(9 - i), followUpDate: null });
    }
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.followupBelowFloor).toBe(true);
    expect(r.composite).toBeNull();
    expect(r.insufficientData).toBe(true);
    // Component points themselves are unaffected: still available for a /60 display.
    expect(typeof r.cadencePoints).toBe("number");
    expect(typeof r.reengagementPoints).toBe("number");
  });

  it("leaves the composite numeric and insufficientData false when follow-up discipline is above the volume floor", () => {
    const deals: ScoreDeal[] = [deal({ id: "d1", owner_id: OWNER, stage: "open" })];
    // 8 due-and-kept follow-ups clears the floor (8).
    const activities: ScoreActivity[] = [];
    for (let i = 0; i < 8; i++) {
      const followUpDate = iso(20 - i).slice(0, 10);
      activities.push({ dealId: "d1", occurredAt: iso(25 - i), followUpDate });
      activities.push({ dealId: "d1", occurredAt: iso(19 - i), followUpDate: null });
    }
    const r = scoreRep(deals, activities, OWNER, NOW);
    expect(r.followupBelowFloor).toBe(false);
    expect(r.insufficientData).toBe(false);
    expect(typeof r.composite).toBe("number");
  });
});
