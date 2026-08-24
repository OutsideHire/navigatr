/**
 * Persistence Index SP-B nightly orchestrator. Pure over an injected data
 * layer so the batch logic is unit-tested; the Deno Edge function supplies
 * a Supabase-backed SnapshotDeps. Window = trailing config.windowDays ending
 * on the run date (UTC). Mirrors coverage/runSnapshots.ts.
 */
import { scoreRep, type ScoreDeal, type ScoreActivity } from "./score.ts";
import type { PersistenceConfig } from "./config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RepSnapshotRow {
  org_id: string;
  user_id: string;
  snapshot_date: string;
  composite: number | null;
  /** True when composite is null because follow-up discipline is below the
   *  volume floor (mirrors RepScore.insufficientData; see score.ts). */
  insufficient_data: boolean;
  followup_points: number;
  followup_below_floor: boolean;
  followup_due_count: number;
  cadence_points: number;
  reengagement_points: number;
  reengagement_rate: number | null;
  deals_went_silent_count: number;
  deals_re_engaged_count: number;
  response_velocity_points: null;
  formula_version: number;
  window_start_date: string;
  window_end_date: string;
}

export interface CompanySnapshotRow {
  org_id: string;
  snapshot_date: string;
  composite_median: number | null;
  composite_p90: number | null;
  rep_count: number;
  formula_version: number;
}

export interface SnapshotDeps {
  listOrgs(): Promise<{ id: string; config: PersistenceConfig }[]>;
  listRepIds(orgId: string): Promise<string[]>;
  /** IANA zone per rep id for the org, from path_preferences.timezone. A rep
   *  with no stored zone is absent (or null), and scoring falls back to UTC. */
  fetchRepTimezones(orgId: string): Promise<Record<string, string | null>>;
  fetchOrgDeals(orgId: string): Promise<ScoreDeal[]>;
  fetchOrgActivities(orgId: string): Promise<ScoreActivity[]>;
  upsertRepSnapshot(row: RepSnapshotRow): Promise<void>;
  upsertCompanySnapshot(row: CompanySnapshotRow): Promise<void>;
  log(message: string): void;
}

export interface RunSummary {
  orgs: number;
  reps: number;
  repSnapshots: number;
  companySnapshots: number;
  failures: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Stats helpers (copied from apps/app activityToWin.ts; kept dependency-free) ──

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Linear-interpolation percentile (R-7 / Excel PERCENTILE.INC). p in [0,1]. */
function percentile(nums: number[], p: number): number | null {
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0]!;
  const s = [...nums].sort((a, b) => a - b);
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (idx - lo) * (s[hi]! - s[lo]!);
}

export async function runSnapshots(deps: SnapshotDeps, now: Date): Promise<RunSummary> {
  const snapshotDate = isoDate(now);
  const windowEndDate = snapshotDate;

  const summary: RunSummary = { orgs: 0, reps: 0, repSnapshots: 0, companySnapshots: 0, failures: 0 };
  const orgs = await deps.listOrgs();
  for (const org of orgs) {
    summary.orgs += 1;
    const windowStartDate = isoDate(new Date(now.getTime() - org.config.windowDays * DAY_MS));

    const [deals, allActivities, repIds, repTz] = await Promise.all([
      deps.fetchOrgDeals(org.id),
      deps.fetchOrgActivities(org.id),
      deps.listRepIds(org.id),
      deps.fetchRepTimezones(org.id),
    ]);

    // Beta policy: auto-captured activities (e.g. confirmed email suggestions,
    // capture_source='automatic') are excluded from Persistence Index scoring
    // until their precision is proven. They remain real, rep-confirmed
    // activities everywhere else; they just don't move the score yet. Absent
    // captureSource is treated as manual (all pre-feature rows).
    const activities = allActivities.filter((a) => a.captureSource !== "automatic");

    const composites: number[] = [];
    for (const repId of repIds) {
      summary.reps += 1;
      try {
        const s = scoreRep(deals, activities, repId, now, org.config, repTz[repId] ?? null);
        const row: RepSnapshotRow = {
          org_id: org.id,
          user_id: repId,
          snapshot_date: snapshotDate,
          composite: s.composite,
          insufficient_data: s.insufficientData,
          followup_points: s.followupPoints,
          followup_below_floor: s.followupBelowFloor,
          followup_due_count: s.followupDueCount,
          cadence_points: s.cadencePoints,
          reengagement_points: s.reengagementPoints,
          reengagement_rate: s.reengagementRate,
          deals_went_silent_count: s.dealsWentSilentCount,
          deals_re_engaged_count: s.dealsReEngagedCount,
          response_velocity_points: null,
          formula_version: s.formulaVersion,
          window_start_date: windowStartDate,
          window_end_date: windowEndDate,
        };
        await deps.upsertRepSnapshot(row);
        summary.repSnapshots += 1;
        if (s.composite !== null) composites.push(s.composite);
      } catch (err) {
        summary.failures += 1;
        deps.log(`persistence snapshot failed for user ${repId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const composite_median = composites.length > 0 ? Math.round(median(composites) as number) : null;
    const composite_p90 = composites.length > 0 ? Math.round(percentile(composites, 0.9) as number) : null;
    await deps.upsertCompanySnapshot({
      org_id: org.id,
      snapshot_date: snapshotDate,
      composite_median,
      composite_p90,
      rep_count: composites.length,
      formula_version: org.config.formulaVersion,
    });
    summary.companySnapshots += 1;
  }
  return summary;
}
