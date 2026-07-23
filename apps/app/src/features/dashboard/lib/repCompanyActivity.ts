/**
 * Activities by Sales Rep and Company: pure aggregation.
 *
 * Attributes each logged activity to the OWNER of its deal (book of business)
 * and the deal's company, filtered to a date window, then rolls up
 * rep -> company -> per-type counts. Reconciles by construction: a company's
 * counts sum from its activities, a rep's from its companies, and the grand
 * total from all reps. No data fetching. "Visits" = the drop_in type.
 */
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";

export const RCA_TYPES: readonly ActivityType[] = ["call", "email", "drop_in", "appointment"];
export type RcaCountKey = ActivityType | "total";
export type RcaCounts = Record<RcaCountKey, number>;

export function emptyCounts(): RcaCounts {
  return { call: 0, email: 0, drop_in: 0, appointment: 0, total: 0 };
}

export interface AttributedActivity {
  ownerId: string | null;
  companyName: string;
  type: ActivityType;
}

/**
 * Join activities to their deal's owner + company, keeping only those whose
 * occurredAt is in range. Activities whose deal isn't in `deals` (not visible
 * under RLS, or deleted) are skipped, they can't be attributed.
 */
export function attributeActivities(
  activities: Activity[],
  deals: Deal[],
  range: DateRange,
): AttributedActivity[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const out: AttributedActivity[] = [];
  for (const a of activities) {
    if (!withinRange(a.occurredAt, range)) continue;
    const deal = byId.get(a.dealId);
    if (!deal) continue;
    out.push({ ownerId: deal.owner_id, companyName: deal.companyName, type: a.type });
  }
  return out;
}

export interface CompanyActivity {
  companyName: string;
  counts: RcaCounts;
}
export interface RepActivity {
  ownerId: string | null;
  companyCount: number;
  counts: RcaCounts;
  companies: CompanyActivity[];
}
export interface RepCompanyAggregate {
  reps: RepActivity[];
  grandTotal: RcaCounts;
}

function bump(counts: RcaCounts, type: ActivityType): void {
  counts[type] += 1;
  counts.total += 1;
}

/**
 * Group attributed rows into reps -> companies -> counts. Companies within each
 * rep are sorted by total desc (ties: company name asc). Reps are returned in
 * insertion order; callers sort by the active metric via `sortReps`.
 */
export function repCompanyAggregate(rows: AttributedActivity[]): RepCompanyAggregate {
  const repMap = new Map<string, RepActivity>();
  const grandTotal = emptyCounts();

  for (const r of rows) {
    const key = r.ownerId ?? "__unassigned__";
    let rep = repMap.get(key);
    if (!rep) {
      rep = { ownerId: r.ownerId, companyCount: 0, counts: emptyCounts(), companies: [] };
      repMap.set(key, rep);
    }
    let company = rep.companies.find((c) => c.companyName === r.companyName);
    if (!company) {
      company = { companyName: r.companyName, counts: emptyCounts() };
      rep.companies.push(company);
    }
    bump(company.counts, r.type);
    bump(rep.counts, r.type);
    bump(grandTotal, r.type);
  }

  for (const rep of repMap.values()) {
    rep.companyCount = rep.companies.length;
    rep.companies.sort(
      (a, b) => b.counts.total - a.counts.total || a.companyName.localeCompare(b.companyName),
    );
  }

  return { reps: [...repMap.values()], grandTotal };
}

/**
 * A new array of reps sorted by the selected metric (desc). Ties break by
 * total desc, then display name asc (via `nameOf`) so order is stable. Never
 * mutates the input.
 */
export function sortReps(
  reps: RepActivity[],
  metric: RcaCountKey,
  nameOf: (ownerId: string | null) => string,
): RepActivity[] {
  return [...reps].sort(
    (a, b) =>
      b.counts[metric] - a.counts[metric] ||
      b.counts.total - a.counts.total ||
      nameOf(a.ownerId).localeCompare(nameOf(b.ownerId)),
  );
}
