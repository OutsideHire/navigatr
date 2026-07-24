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
import { emptyCounts, type RcaCounts } from "./repCompanyActivity";

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

export interface UnifiedRepCompany { companyName: string; counts: RcaCounts; dealCount: number; valueCents: number; }
export interface UnifiedRepRow {
  ownerId: string | null;
  counts: RcaCounts;
  companyCount: number;
  dealCount: number;
  valueCents: number;
  companies: UnifiedRepCompany[];
}

function bump(counts: RcaCounts, type: ActivityType): void { counts[type] += 1; counts.total += 1; }

/**
 * Rep -> company rows for a scope. Activity counts come from the scoped
 * OutcomeActivity rows (so they reconcile with the band); dealCount + valueCents
 * come from the deals of that owner/company in the scope's outcome. In "all"
 * scope, deal columns aggregate won deals (the outcome that carries revenue).
 */
export function unifiedRepRows(activities: Activity[], deals: Deal[], range: DateRange, scope: ReportScope): UnifiedRepRow[] {
  const attributed = attributeActivitiesWithOutcome(activities, deals, range).filter((r) => inScope(r.outcome, scope));

  const dealOutcomeFor: Outcome = scope === "all" ? "won" : scope;
  const scopedDeals = deals.filter((d) => classifyDealOutcome(d.stage) === dealOutcomeFor);

  const repMap = new Map<string, UnifiedRepRow>();
  const keyOf = (id: string | null) => id ?? "__unassigned__";
  const ensureRep = (ownerId: string | null): UnifiedRepRow => {
    const k = keyOf(ownerId);
    let rep = repMap.get(k);
    if (!rep) { rep = { ownerId, counts: emptyCounts(), companyCount: 0, dealCount: 0, valueCents: 0, companies: [] }; repMap.set(k, rep); }
    return rep;
  };
  const ensureCompany = (rep: UnifiedRepRow, companyName: string): UnifiedRepCompany => {
    let c = rep.companies.find((x) => x.companyName === companyName);
    if (!c) { c = { companyName, counts: emptyCounts(), dealCount: 0, valueCents: 0 }; rep.companies.push(c); }
    return c;
  };

  for (const r of attributed) {
    const rep = ensureRep(r.ownerId);
    const c = ensureCompany(rep, r.companyName);
    bump(c.counts, r.type); bump(rep.counts, r.type);
  }
  for (const d of scopedDeals) {
    const rep = ensureRep(d.owner_id);
    const c = ensureCompany(rep, d.companyName);
    c.dealCount += 1; c.valueCents += d.valueCents; rep.dealCount += 1; rep.valueCents += d.valueCents;
  }

  const rows = [...repMap.values()];
  for (const rep of rows) {
    rep.companyCount = rep.companies.length;
    rep.companies.sort((a, b) => b.counts.total - a.counts.total || a.companyName.localeCompare(b.companyName));
  }
  return rows.filter((r) => r.counts.total > 0 || r.dealCount > 0);
}

/** effort rank by activity total desc; outcome rank by valueCents desc. Returns only reps whose ranks differ by >=2. */
export function rankDivergence(rows: Pick<UnifiedRepRow, "ownerId" | "counts" | "valueCents">[]): Map<string, { effortRank: number; outcomeRank: number }> {
  const rankBy = (metric: (r: (typeof rows)[number]) => number) => {
    const order = [...rows].sort((a, b) => metric(b) - metric(a));
    const m = new Map<string, number>();
    order.forEach((r, i) => m.set(r.ownerId ?? "__unassigned__", i + 1));
    return m;
  };
  const effort = rankBy((r) => r.counts.total);
  const outcome = rankBy((r) => r.valueCents);
  const out = new Map<string, { effortRank: number; outcomeRank: number }>();
  for (const r of rows) {
    const k = r.ownerId ?? "__unassigned__";
    const e = effort.get(k)!; const o = outcome.get(k)!;
    if (Math.abs(e - o) >= 2) out.set(k, { effortRank: e, outcomeRank: o });
  }
  return out;
}
