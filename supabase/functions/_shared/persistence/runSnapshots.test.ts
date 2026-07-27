import { describe, it, expect, vi } from "vitest";
import { runSnapshots, type SnapshotDeps, type RepSnapshotRow, type CompanySnapshotRow } from "./runSnapshots";
import { DEFAULT_PERSISTENCE_CONFIG } from "./config";
import type { ScoreDeal, ScoreActivity } from "./score";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

// Rep-1: one open deal, two recent touches -> zero silence -> full
// re-engagement points (30/30) plus a partial cadence sample (17/30, below
// the 3.5/wk target) -> composite 78 ((17+30)/60 rounded).
// Rep-2: one open deal, single touch 29 days ago (silent, never re-engaged)
// -> re-engagement points 0/30 plus a thin cadence sample (2/30) -> composite 3.
// Rep-3: owns no deals at all -> no sampled component -> composite null.
// (Exact values pinned by direct scoreRep() computation against this fixture.)
const deals: ScoreDeal[] = [
  { id: "d1", owner_id: "rep-1", stage: "open", owner_changed_at: null, has_future_appointment: false },
  { id: "d2", owner_id: "rep-2", stage: "open", owner_changed_at: null, has_future_appointment: false },
];
const activities: ScoreActivity[] = [
  { dealId: "d1", occurredAt: iso(2), followUpDate: null },
  { dealId: "d1", occurredAt: iso(1), followUpDate: null },
  { dealId: "d2", occurredAt: iso(29), followUpDate: null },
];

function deps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    listOrgs: vi.fn(async () => [{ id: "org-1", config: DEFAULT_PERSISTENCE_CONFIG }]),
    listRepIds: vi.fn(async () => ["rep-1", "rep-2", "rep-3"]),
    fetchOrgDeals: vi.fn(async () => deals),
    fetchOrgActivities: vi.fn(async () => activities),
    upsertRepSnapshot: vi.fn(async () => {}),
    upsertCompanySnapshot: vi.fn(async () => {}),
    log: vi.fn(),
    ...over,
  };
}

describe("runSnapshots", () => {
  it("upserts one rep snapshot per rep, and a company snapshot excluding null composites", async () => {
    const d = deps();
    const summary = await runSnapshots(d, NOW);

    expect(d.upsertRepSnapshot).toHaveBeenCalledTimes(3);
    const rows = (d.upsertRepSnapshot as any).mock.calls.map((c: any[]) => c[0] as RepSnapshotRow);

    const rep1 = rows.find((r: RepSnapshotRow) => r.user_id === "rep-1")!;
    expect(rep1).toMatchObject({
      org_id: "org-1",
      snapshot_date: "2026-07-26",
      composite: 78,
      reengagement_points: 30,
      reengagement_rate: null,
      deals_went_silent_count: 0,
      deals_re_engaged_count: 0,
      followup_points: 0,
      followup_below_floor: false,
      followup_due_count: 0,
      cadence_points: 17,
      response_velocity_points: null,
      formula_version: DEFAULT_PERSISTENCE_CONFIG.formulaVersion,
      window_start_date: "2026-06-26",
      window_end_date: "2026-07-26",
    });

    const rep2 = rows.find((r: RepSnapshotRow) => r.user_id === "rep-2")!;
    expect(rep2).toMatchObject({
      composite: 3,
      cadence_points: 2,
      reengagement_points: 0,
      reengagement_rate: 0,
      deals_went_silent_count: 1,
      deals_re_engaged_count: 0,
    });

    const rep3 = rows.find((r: RepSnapshotRow) => r.user_id === "rep-3")!;
    expect(rep3.composite).toBeNull();

    expect(d.upsertCompanySnapshot).toHaveBeenCalledTimes(1);
    const companyRow = (d.upsertCompanySnapshot as any).mock.calls[0][0] as CompanySnapshotRow;
    expect(companyRow).toEqual({
      org_id: "org-1",
      snapshot_date: "2026-07-26",
      composite_median: 41, // median(78, 3) = 40.5 -> rounded
      composite_p90: 71, // percentile([3,78], 0.9) = 70.5 -> rounded
      rep_count: 2, // rep-3's null composite is excluded
      formula_version: DEFAULT_PERSISTENCE_CONFIG.formulaVersion,
    });

    expect(summary).toEqual({ orgs: 1, reps: 3, repSnapshots: 3, companySnapshots: 1, failures: 0 });
  });

  it("counts a failing rep without aborting the batch, and still writes the company snapshot", async () => {
    const d = deps({
      upsertRepSnapshot: vi.fn(async (row: RepSnapshotRow) => {
        if (row.user_id === "rep-1") throw new Error("boom");
      }),
    });
    const summary = await runSnapshots(d, NOW);

    expect(summary).toEqual({ orgs: 1, reps: 3, repSnapshots: 2, companySnapshots: 1, failures: 1 });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("rep-1"));

    // rep-1's composite (78) never made it into the aggregate since its
    // upsert threw before being counted; only rep-2 (3) remains.
    const companyRow = (d.upsertCompanySnapshot as any).mock.calls[0][0] as CompanySnapshotRow;
    expect(companyRow.rep_count).toBe(1);
    expect(companyRow.composite_median).toBe(3);
    expect(companyRow.composite_p90).toBe(3);
  });

  it("writes a null-median company snapshot when no rep has a scoreable composite", async () => {
    const d = deps({
      listRepIds: vi.fn(async () => ["rep-3"]),
    });
    const summary = await runSnapshots(d, NOW);

    expect(d.upsertRepSnapshot).toHaveBeenCalledTimes(1);
    const companyRow = (d.upsertCompanySnapshot as any).mock.calls[0][0] as CompanySnapshotRow;
    expect(companyRow).toEqual({
      org_id: "org-1",
      snapshot_date: "2026-07-26",
      composite_median: null,
      composite_p90: null,
      rep_count: 0,
      formula_version: DEFAULT_PERSISTENCE_CONFIG.formulaVersion,
    });
    expect(summary).toEqual({ orgs: 1, reps: 1, repSnapshots: 1, companySnapshots: 1, failures: 0 });
  });

  it("handles an org with no reps and still writes a null company snapshot", async () => {
    const d = deps({ listRepIds: vi.fn(async () => []) });
    const summary = await runSnapshots(d, NOW);
    expect(d.upsertRepSnapshot).not.toHaveBeenCalled();
    expect(d.upsertCompanySnapshot).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ orgs: 1, reps: 0, repSnapshots: 0, companySnapshots: 1, failures: 0 });
  });

  it("fetches org deals and activities once per org, not once per rep", async () => {
    const d = deps();
    await runSnapshots(d, NOW);
    expect(d.fetchOrgDeals).toHaveBeenCalledTimes(1);
    expect(d.fetchOrgActivities).toHaveBeenCalledTimes(1);
  });
});
