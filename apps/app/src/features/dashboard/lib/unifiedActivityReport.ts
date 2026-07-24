/**
 * Unified Activity Performance report (Phase 1): classifies each logged
 * activity by its deal's outcome (won/lost/open) so one report can re-read the
 * rep -> company -> activity structure through an outcome scope. All counts
 * derive from the activities table (activity-date window) joined to their deal,
 * so the allocation band, rep table, and reconciliation footer always tie.
 * Close-date anchoring for won/lost is a Phase 2 correction.
 */
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";

export type Outcome = "won" | "lost" | "open";
export type ReportScope = "all" | Outcome;

export function classifyDealOutcome(stage: DealStage): Outcome {
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return "open";
}

export interface OutcomeActivity {
  ownerId: string | null;
  companyName: string;
  type: ActivityType;
  outcome: Outcome;
}

/** In-window activities joined to their deal's owner/company/outcome. Skips activities whose deal isn't visible. */
export function attributeActivitiesWithOutcome(activities: Activity[], deals: Deal[], range: DateRange): OutcomeActivity[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const out: OutcomeActivity[] = [];
  for (const a of activities) {
    if (!withinRange(a.occurredAt, range)) continue;
    const deal = byId.get(a.dealId);
    if (!deal) continue;
    out.push({ ownerId: deal.owner_id, companyName: deal.companyName, type: a.type, outcome: classifyDealOutcome(deal.stage) });
  }
  return out;
}

export interface OutcomeBand { won: number; lost: number; open: number; total: number; }

export function outcomeBand(rows: OutcomeActivity[]): OutcomeBand {
  const b: OutcomeBand = { won: 0, lost: 0, open: 0, total: 0 };
  for (const r of rows) { b[r.outcome] += 1; b.total += 1; }
  return b;
}

export interface Reconciliation { total: number; won: number; openLost: number; unattached: 0; }

export function reconciliation(band: OutcomeBand): Reconciliation {
  return { total: band.total, won: band.won, openLost: band.open + band.lost, unattached: 0 };
}

/** True when an activity belongs in the active scope. "all" accepts everything. */
export function inScope(outcome: Outcome, scope: ReportScope): boolean {
  return scope === "all" || outcome === scope;
}
