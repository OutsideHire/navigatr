/**
 * SP1 nightly orchestrator. Pure over an injected data layer so the batch
 * logic is unit-tested; the Deno Edge function supplies a Supabase-backed
 * SnapshotDeps. Window = trailing 30 days ending on the run date (UTC).
 */
import { buildSnapshotRow, type CoverageSnapshotRow } from "./buildSnapshot.ts";
import type { CallActivity, DialSignal } from "./matchCounts.ts";
import type { CoverageConfig } from "./config.ts";

const WINDOW_DAYS = 30;

export interface SnapshotDeps {
  listOrgs(): Promise<{ id: string; config: CoverageConfig }[]>;
  listRepIdsWithDials(orgId: string, windowStartDate: string): Promise<string[]>;
  fetchRepDials(userId: string, windowStartDate: string): Promise<DialSignal[]>;
  fetchRepCalls(userId: string, windowStartDate: string): Promise<CallActivity[]>;
  upsertSnapshot(row: CoverageSnapshotRow): Promise<void>;
  log(message: string): void;
}

export interface RunSummary {
  orgs: number;
  reps: number;
  snapshots: number;
  failures: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runSnapshots(deps: SnapshotDeps, now: Date): Promise<RunSummary> {
  const snapshotDate = isoDate(now);
  const windowEndDate = snapshotDate; // end-of-window == the run date

  const windowStartDate = isoDate(new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const summary: RunSummary = { orgs: 0, reps: 0, snapshots: 0, failures: 0 };
  const orgs = await deps.listOrgs();
  for (const org of orgs) {
    summary.orgs += 1;
    const repIds = await deps.listRepIdsWithDials(org.id, windowStartDate);
    for (const userId of repIds) {
      summary.reps += 1;
      try {
        const [dials, calls] = await Promise.all([
          deps.fetchRepDials(userId, windowStartDate),
          deps.fetchRepCalls(userId, windowStartDate),
        ]);
        const row = buildSnapshotRow({
          orgId: org.id, userId, snapshotDate, windowStartDate, windowEndDate,
          dials, calls, config: org.config, now,
        });
        if (row) {
          await deps.upsertSnapshot(row);
          summary.snapshots += 1;
        }
      } catch (err) {
        summary.failures += 1;
        deps.log(`coverage snapshot failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary;
}
