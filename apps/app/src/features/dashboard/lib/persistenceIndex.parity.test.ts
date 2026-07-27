/**
 * Parity test between the app's Persistence Index scoring
 * (apps/app/src/features/dashboard/lib/persistenceIndex.ts, SP-A) and its
 * dependency-free port for the nightly snapshot job
 * (supabase/functions/_shared/persistence/score.ts, SP-B Task 2). This is
 * the correctness contract: both implementations must produce identical
 * results for the same fixtures, so they cannot silently drift apart.
 */
import { describe, it, expect } from "vitest";
import { computePersistenceIndex } from "./persistenceIndex";
import { scoreRep, DEFAULT_SCORE_PARAMS, type ScoreDeal, type ScoreActivity } from "../../../../../../supabase/functions/_shared/persistence/score";
import type { Deal } from "@/features/pipeline/mockData";
import type { Activity } from "@/features/activities/mockData";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const OWNER = "rep-1";

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/** Minimal deal fixture; app + port read id/owner_id/stage plus the two
 *  re-engagement exclusion fields (owner_changed_at, has_future_appointment). */
function deal(
  id: string,
  ownerId: string | null,
  stage: Deal["stage"],
  extra: { owner_changed_at?: string | null; has_future_appointment?: boolean } = {},
): ScoreDeal {
  return {
    id,
    owner_id: ownerId,
    stage,
    owner_changed_at: extra.owner_changed_at ?? null,
    has_future_appointment: extra.has_future_appointment ?? false,
  };
}

/** Minimal activity fixture; app + port only read dealId/occurredAt/followUpDate. */
function activity(dealId: string, occurredAt: string, followUpDate: string | null = null): ScoreActivity {
  return { dealId, occurredAt, followUpDate };
}

function assertParity(deals: ScoreDeal[], activities: ScoreActivity[], ownerId = OWNER) {
  const r = scoreRep(deals, activities, ownerId, NOW, DEFAULT_SCORE_PARAMS);
  const a = computePersistenceIndex(deals as Deal[], activities as Activity[], { ownerId, now: NOW });

  expect(r.composite).toBe(a.composite);
  expect(r.insufficientData).toBe(a.insufficientData);
  expect(r.followupPoints).toBe(a.followUp.points);
  expect(r.followupBelowFloor).toBe(a.followUp.belowFloor);
  expect(r.followupDueCount).toBe(a.followUp.dueCount);
  expect(r.cadencePoints).toBe(a.cadence.points);
  expect(r.reengagementPoints).toBe(a.reEngagement.points);
  expect(r.reengagementRate).toBe(a.reEngagement.rate);
  expect(r.dealsWentSilentCount).toBe(a.reEngagement.silentCount);
  expect(r.dealsReEngagedCount).toBe(a.reEngagement.reEngagedCount);
}

describe("persistenceIndex parity: app vs. shared port", () => {
  it("fixture 1: empty deals/activities", () => {
    assertParity([], []);
  });

  it("fixture 2: zero-silent with active deals plus cadence activity", () => {
    const deals = [deal("d1", OWNER, "qualified"), deal("d2", OWNER, "proposal")];
    const activities = [
      activity("d1", iso(6)),
      activity("d1", iso(5)),
      activity("d1", iso(4)),
      activity("d1", iso(3)),
      activity("d1", iso(2)),
      activity("d2", iso(2)),
    ];
    assertParity(deals, activities);
  });

  it("fixture 3: below-floor follow-ups (dueCount 1..7)", () => {
    const deals = [deal("d1", OWNER, "qualified")];
    const activities: ScoreActivity[] = [];
    for (let i = 0; i < 5; i++) {
      const followUpDate = iso(10 - i).slice(0, 10);
      activities.push(activity("d1", iso(15 - i), followUpDate));
      activities.push(activity("d1", iso(9 - i)));
    }
    assertParity(deals, activities);
  });

  it("fixture 4: mix - one re-engaged, one still silent, plus >=8 follow-ups due", () => {
    const deals = [
      deal("silent-recovered", OWNER, "qualified"),
      deal("still-silent", OWNER, "proposal"),
      deal("followups", OWNER, "contacted"),
    ];
    const activities: ScoreActivity[] = [
      // silent-recovered: touch 29 days ago, then a later touch 3 days ago
      // (28-day gap > 21-day silence threshold) -> onset qualifies, re-engaged.
      activity("silent-recovered", iso(29)),
      activity("silent-recovered", iso(3)),
      // still-silent: single touch 29 days ago -> onset qualifies, no later touch.
      activity("still-silent", iso(29)),
    ];
    // 8 due follow-ups, all kept on time, to clear the follow-up floor.
    for (let i = 0; i < 8; i++) {
      const followUpDate = iso(20 - i).slice(0, 10);
      activities.push(activity("followups", iso(25 - i), followUpDate));
      activities.push(activity("followups", iso(19 - i)));
    }
    assertParity(deals, activities);
  });

  it("fixture 5: no active deals (all won/lost) yields no cadence/re-engagement sample", () => {
    const deals = [deal("d1", OWNER, "won"), deal("d2", OWNER, "lost")];
    const activities = [activity("d1", iso(2)), activity("d2", iso(2))];
    assertParity(deals, activities);
  });

  it("fixture 6: unowned / other-owner deals are excluded", () => {
    const deals = [deal("d1", OWNER, "qualified"), deal("d2", "someone-else", "qualified")];
    const activities = [activity("d1", iso(2)), activity("d2", iso(1))];
    assertParity(deals, activities);
  });

  it("fixture 7: a deal with a future appointment is excluded from re-engagement even though it would otherwise be a silent miss", () => {
    const deals = [deal("d1", OWNER, "qualified", { has_future_appointment: true })];
    const activities = [activity("d1", iso(29))]; // would otherwise onset-qualify as a silent miss
    assertParity(deals, activities);
  });

  it("fixture 8: a deal reassigned within the trailing 30 days is excluded from re-engagement", () => {
    const deals = [deal("d1", OWNER, "qualified", { owner_changed_at: iso(10) })];
    const activities = [activity("d1", iso(29))]; // would otherwise onset-qualify as a silent miss
    assertParity(deals, activities);
  });

  it("fixture 9: a deal reassigned 40 days ago (outside the lookback) is NOT excluded from re-engagement", () => {
    const deals = [deal("d1", OWNER, "qualified", { owner_changed_at: iso(40) })];
    const activities = [activity("d1", iso(29))];
    assertParity(deals, activities);
  });

  it("fixture 10: below-floor follow-ups force a null composite + insufficientData true in both implementations", () => {
    const deals = [deal("d1", OWNER, "qualified")];
    const activities: ScoreActivity[] = [];
    // 3 due-and-kept follow-ups, below the FOLLOWUP_FLOOR (8).
    for (let i = 0; i < 3; i++) {
      const followUpDate = iso(10 - i).slice(0, 10);
      activities.push(activity("d1", iso(15 - i), followUpDate));
      activities.push(activity("d1", iso(9 - i)));
    }
    assertParity(deals, activities);
    const r = scoreRep(deals, activities, OWNER, NOW, DEFAULT_SCORE_PARAMS);
    expect(r.followupBelowFloor).toBe(true);
    expect(r.composite).toBeNull();
    expect(r.insufficientData).toBe(true);
  });
});
