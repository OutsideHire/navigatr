import { describe, it, expect, vi } from "vitest";
import { runSnapshots, type SnapshotDeps, type RepSnapshotRow, type CompanySnapshotRow } from "./runSnapshots";
import { DEFAULT_PERSISTENCE_CONFIG } from "./config";
import type { ScoreDeal, ScoreActivity } from "./score";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function isoDate(daysAgo: number): string {
  return iso(daysAgo).slice(0, 10);
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
    fetchRepTimezones: vi.fn(async () => ({})),
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

  it("excludes auto-captured activities from scoring (beta policy)", async () => {
    // Same fixture as the baseline, plus one extra touch on rep-1's deal that
    // was captured automatically. If it were scored it would raise rep-1's
    // cadence sample; because it is auto-captured it is dropped and rep-1's
    // composite stays exactly at the manual-only baseline (78).
    const autoTouch: ScoreActivity = {
      dealId: "d1",
      occurredAt: iso(1),
      followUpDate: null,
      captureSource: "automatic",
    };
    const d = deps({
      listRepIds: vi.fn(async () => ["rep-1"]),
      fetchOrgActivities: vi.fn(async () => [...activities, autoTouch]),
    });
    await runSnapshots(d, NOW);

    const rep1 = (d.upsertRepSnapshot as any).mock.calls[0][0] as RepSnapshotRow;
    expect(rep1.composite).toBe(78);
    expect(rep1.cadence_points).toBe(17);
  });

  it("treats an activity with no captureSource as manual (pre-feature rows still score)", async () => {
    // The baseline fixture carries no captureSource; it must still score as
    // before, so the exclusion never silently drops legitimate manual history.
    const d = deps({ listRepIds: vi.fn(async () => ["rep-1"]) });
    await runSnapshots(d, NOW);
    const rep1 = (d.upsertRepSnapshot as any).mock.calls[0][0] as RepSnapshotRow;
    expect(rep1.composite).toBe(78);
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

  it("marks a below-floor rep insufficient_data with a null composite, and excludes them from the company median", async () => {
    // rep-4 has exactly one due follow-up in-window (< followupFloor of 8),
    // so followUp.belowFloor is true and the composite is forced null
    // (score.ts addendum 4.3), independent of cadence/re-engagement sampling.
    const belowFloorDeal: ScoreDeal = {
      id: "d4",
      owner_id: "rep-4",
      stage: "open",
      owner_changed_at: null,
      has_future_appointment: false,
    };
    const belowFloorActivity: ScoreActivity = {
      dealId: "d4",
      occurredAt: iso(6),
      followUpDate: isoDate(5),
    };
    const d = deps({
      listRepIds: vi.fn(async () => ["rep-1", "rep-4"]),
      fetchOrgDeals: vi.fn(async () => [...deals, belowFloorDeal]),
      fetchOrgActivities: vi.fn(async () => [...activities, belowFloorActivity]),
    });
    const summary = await runSnapshots(d, NOW);

    const rows = (d.upsertRepSnapshot as any).mock.calls.map((c: any[]) => c[0] as RepSnapshotRow);
    const rep4 = rows.find((r: RepSnapshotRow) => r.user_id === "rep-4")!;
    expect(rep4.composite).toBeNull();
    expect(rep4.insufficient_data).toBe(true);
    expect(rep4.followup_below_floor).toBe(true);
    expect(rep4.followup_due_count).toBe(1);

    const rep1 = rows.find((r: RepSnapshotRow) => r.user_id === "rep-1")!;
    expect(rep1.composite).toBe(78);
    expect(rep1.insufficient_data).toBe(false);

    const companyRow = (d.upsertCompanySnapshot as any).mock.calls[0][0] as CompanySnapshotRow;
    expect(companyRow.rep_count).toBe(1); // rep-4's null composite is excluded
    expect(companyRow.composite_median).toBe(78);
    expect(companyRow.composite_p90).toBe(78);
    expect(summary).toEqual({ orgs: 1, reps: 2, repSnapshots: 2, companySnapshots: 1, failures: 0 });
  });
});

// Ticket 2 Phase 3: the nightly snapshot scores each rep in their stored zone.
describe("runSnapshots — per-rep timezone", () => {
  const zoneDeals: ScoreDeal[] = [
    { id: "dz", owner_id: "rep-1", stage: "open", owner_changed_at: null, has_future_appointment: false },
  ];
  const zoneActs: ScoreActivity[] = [
    // Follow-up promised 2026-07-20; kept at 9pm Los Angeles (07-21T04:00Z).
    { dealId: "dz", occurredAt: "2026-07-19T15:00:00.000Z", followUpDate: "2026-07-20" },
    { dealId: "dz", occurredAt: "2026-07-21T04:00:00.000Z", followUpDate: null },
  ];
  const mk = (tz: Record<string, string | null>) =>
    deps({
      listRepIds: vi.fn(async () => ["rep-1"]),
      fetchOrgDeals: vi.fn(async () => zoneDeals),
      fetchOrgActivities: vi.fn(async () => zoneActs),
      fetchRepTimezones: vi.fn(async () => tz),
    });

  it("threads the rep's zone into scoring (LA on-time vs UTC late)", async () => {
    const laDeps = mk({ "rep-1": "America/Los_Angeles" });
    await runSnapshots(laDeps, NOW);
    const laRow = (laDeps.upsertRepSnapshot as any).mock.calls[0][0] as RepSnapshotRow;

    const utcDeps = mk({}); // no stored zone -> UTC fallback
    await runSnapshots(utcDeps, NOW);
    const utcRow = (utcDeps.upsertRepSnapshot as any).mock.calls[0][0] as RepSnapshotRow;

    expect(laRow.followup_points).toBeGreaterThan(utcRow.followup_points);
    expect(utcRow.followup_points).toBe(0);
  });

  it("fetches rep timezones once per org", async () => {
    const d = mk({});
    await runSnapshots(d, NOW);
    expect(d.fetchRepTimezones).toHaveBeenCalledTimes(1);
    expect(d.fetchRepTimezones).toHaveBeenCalledWith("org-1");
  });
});
