/**
 * Activities Report helpers — the average-based views layered on the
 * Activity-to-Win won-deal rows for the dashboard's Activities Report
 * (US-04..US-09). Pure functions over ActivityToWinRow[]; no data fetching.
 * The dashboard AW *widget* stays median-based; this report is averages by
 * design (per the user-stories doc). "Visits" = the dropin activity type.
 */
import { mean, type ActivityToWinRow, type AwActivityType } from "./activityToWin";

export interface ReportKpis {
  dealsClosed: number;
  totalValueCents: number;
  avgActivities: number | null;
  avgBusinessDays: number | null;
  mostEfficient: { company: string; count: number } | null;
  highestValue: { company: string; valueCents: number } | null;
}

/** The four headline KPI-card values (US-04). Averages over the given rows. */
export function activitiesReportKpis(rows: ActivityToWinRow[]): ReportKpis {
  const dealsClosed = rows.length;
  const totalValueCents = rows.reduce((s, r) => s + r.valueCents, 0);
  const avgActivities = mean(rows.map((r) => r.counts.total));
  const dayVals = rows.filter((r) => r.businessDays != null).map((r) => r.businessDays as number);
  const avgBusinessDays = mean(dayVals);

  // Most efficient = fewest activities among deals that logged any (a
  // zero-activity win isn't "efficient", it's unmeasured). Ties broken toward
  // the higher-value deal so the pick is deterministic.
  let effRow: ActivityToWinRow | null = null;
  for (const r of rows) {
    if (r.counts.total <= 0) continue;
    if (
      effRow == null ||
      r.counts.total < effRow.counts.total ||
      (r.counts.total === effRow.counts.total && r.valueCents > effRow.valueCents)
    ) {
      effRow = r;
    }
  }
  const mostEfficient = effRow ? { company: effRow.companyName, count: effRow.counts.total } : null;

  // Highest value = largest deal; ties broken toward fewer activities.
  let valRow: ActivityToWinRow | null = null;
  for (const r of rows) {
    if (
      valRow == null ||
      r.valueCents > valRow.valueCents ||
      (r.valueCents === valRow.valueCents && r.counts.total < valRow.counts.total)
    ) {
      valRow = r;
    }
  }
  const highestValue = valRow ? { company: valRow.companyName, valueCents: valRow.valueCents } : null;

  return { dealsClosed, totalValueCents, avgActivities, avgBusinessDays, mostEfficient, highestValue };
}

export interface RepPerformance {
  ownerId: string | null;
  dealsClosed: number;
  totalRevenueCents: number;
  avgActivities: number | null;
  avgBusinessDays: number | null;
  avgDealCents: number;
}

/** Per-rep rollup, sorted by total revenue desc (ties: more deals first). US-05. */
export function salespersonRanking(rows: ActivityToWinRow[]): RepPerformance[] {
  const groups = new Map<string, ActivityToWinRow[]>();
  for (const r of rows) {
    const key = r.ownerId ?? "__unassigned__";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: RepPerformance[] = [];
  for (const [key, g] of groups) {
    const totalRevenueCents = g.reduce((s, r) => s + r.valueCents, 0);
    const dayVals = g.filter((r) => r.businessDays != null).map((r) => r.businessDays as number);
    out.push({
      ownerId: key === "__unassigned__" ? null : key,
      dealsClosed: g.length,
      totalRevenueCents,
      avgActivities: mean(g.map((r) => r.counts.total)),
      avgBusinessDays: mean(dayVals),
      avgDealCents: g.length ? totalRevenueCents / g.length : 0,
    });
  }

  out.sort((a, b) => b.totalRevenueCents - a.totalRevenueCents || b.dealsClosed - a.dealsClosed);
  return out;
}

/** Mean activities of each type, per deal, across all rows (US-06). */
export function avgActivitiesByType(rows: ActivityToWinRow[]): Record<AwActivityType, number | null> {
  return {
    call: mean(rows.map((r) => r.counts.call)),
    email: mean(rows.map((r) => r.counts.email)),
    dropin: mean(rows.map((r) => r.counts.dropin)),
    appointment: mean(rows.map((r) => r.counts.appointment)),
  };
}

export type ReportSortColumn =
  | "company" | "value" | "call" | "email" | "dropin" | "appointment" | "total" | "days";
export type SortDir = "asc" | "desc";

/**
 * A new array of rows sorted by the given column/direction (US-08). String
 * column ("company") sorts lexicographically; numeric columns sort by value
 * with null business-days sorted last on ascending (first on descending, the
 * natural reverse). Never mutates the input.
 */
export function sortReportRows(
  rows: ActivityToWinRow[],
  column: ReportSortColumn,
  dir: SortDir,
): ActivityToWinRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (column === "company") return a.companyName.localeCompare(b.companyName);
    const na = column === "value" ? a.valueCents : column === "days" ? a.businessDays : a.counts[column];
    const nb = column === "value" ? b.valueCents : column === "days" ? b.businessDays : b.counts[column];
    if (na == null && nb == null) return 0;
    if (na == null) return 1; // nulls last (ascending)
    if (nb == null) return -1;
    return na - nb;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

const TYPE_NOUN: Record<AwActivityType, string> = {
  call: "Calls",
  email: "Emails",
  dropin: "Visits",
  appointment: "Appointments",
};

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Auto-generated Key Insights strings (US-09), in reading order. `nameOf`
 * (when given) resolves a rep ownerId to a display name for the top-performer
 * line; omit it (e.g. a rep with no team-name map) to skip that line. Returns
 * an empty array when there are no rows.
 */
export function activitiesReportInsights(
  rows: ActivityToWinRow[],
  ranking: RepPerformance[],
  nameOf?: (ownerId: string | null) => string,
): string[] {
  if (rows.length === 0) return [];
  const out: string[] = [];
  const kpis = activitiesReportKpis(rows);

  if (kpis.avgActivities != null && kpis.avgBusinessDays != null) {
    out.push(
      `On average, a won deal took ${fmtNum(kpis.avgActivities)} activities over ${fmtNum(kpis.avgBusinessDays)} business days to close.`,
    );
  } else if (kpis.avgActivities != null) {
    out.push(`On average, a won deal took ${fmtNum(kpis.avgActivities)} activities to close.`);
  }

  const byType = avgActivitiesByType(rows);
  const topType = (Object.keys(byType) as AwActivityType[])
    .map((t) => ({ t, m: byType[t] ?? 0 }))
    .sort((a, b) => b.m - a.m)[0];
  if (topType && topType.m > 0) {
    out.push(`${TYPE_NOUN[topType.t]} were the most-used activity type, averaging ${fmtNum(topType.m)} per deal.`);
  }

  if (kpis.mostEfficient) {
    out.push(
      `${kpis.mostEfficient.company} closed most efficiently, in just ${kpis.mostEfficient.count} ${kpis.mostEfficient.count === 1 ? "activity" : "activities"}.`,
    );
  }

  let intense: ActivityToWinRow | null = null;
  for (const r of rows) {
    if (r.counts.total <= 0) continue;
    if (intense == null || r.counts.total > intense.counts.total) intense = r;
  }
  if (intense && (!kpis.mostEfficient || intense.companyName !== kpis.mostEfficient.company)) {
    out.push(`${intense.companyName} took the most work, at ${intense.counts.total} activities.`);
  }

  if (nameOf && ranking.length > 0) {
    const top = ranking[0]!;
    out.push(
      `${nameOf(top.ownerId)} led on revenue with ${top.dealsClosed} ${top.dealsClosed === 1 ? "deal" : "deals"} closed.`,
    );
  }

  return out;
}
