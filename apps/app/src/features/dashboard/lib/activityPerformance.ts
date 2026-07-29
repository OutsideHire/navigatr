/**
 * Activity-To-Win report computations (prototype parity). Each logged activity
 * is attributed to its deal; a deal that received >=1 in-window activity becomes
 * one row ("company") carrying that deal's outcome, value, close-timing, and the
 * windowed per-type activity counts. Reps and grand totals aggregate those rows.
 *
 * Mirrors the linked prototype (artifact a932ebf4) formula-for-formula so the
 * numbers match: touches-per-win uses ALL activity as the numerator (not just
 * activity on winners); "on winners only" is the survivorship view; days come
 * from the deal's precomputed close-timing columns.
 */
import type { Activity } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";
import { emptyCounts, type RcaCounts } from "./repCompanyActivity";
import { classifyDealOutcome, type Outcome, type ReportScope } from "./unifiedActivityReport";
import { formatBandUsd } from "./activityToWin";

/** Open deals with fewer than this many touches are "under the win median". */
export const WIN_MEDIAN_TOUCHES = 5;

/** One deal + its in-window activity counts + close timing. The report's drill unit. */
export interface DealPerf {
  dealId: string;
  companyName: string;
  ownerId: string | null;
  outcome: Outcome;
  valueCents: number;
  /** Calendar days to close for won/lost deals; null while open. */
  days: number | null;
  counts: RcaCounts;
}

function dealDays(deal: Deal, outcome: Outcome): number | null {
  if (outcome === "won") return deal.timeToWinCalendarDays ?? null;
  if (outcome === "lost") return deal.timeToLostCalendarDays ?? null;
  return null;
}

/** Deals that received >=1 in-window activity, each with those windowed counts + deal facts. */
export function buildDealPerf(activities: Activity[], deals: Deal[], range: DateRange): DealPerf[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const map = new Map<string, DealPerf>();
  for (const a of activities) {
    if (!withinRange(a.occurredAt, range)) continue;
    const deal = byId.get(a.dealId);
    if (!deal) continue;
    let row = map.get(deal.id);
    if (!row) {
      const outcome = classifyDealOutcome(deal.stage);
      row = {
        dealId: deal.id,
        companyName: deal.companyName,
        ownerId: deal.owner_id,
        outcome,
        valueCents: deal.valueCents,
        days: dealDays(deal, outcome),
        counts: emptyCounts(),
      };
      map.set(deal.id, row);
    }
    row.counts[a.type] += 1;
    row.counts.total += 1;
  }
  return [...map.values()];
}

/** Activity counts by outcome (the allocation band). total = all in-window activity. */
export function bandFromRows(rows: DealPerf[]): { won: number; open: number; lost: number; total: number } {
  const b = { won: 0, open: 0, lost: 0, total: 0 };
  for (const r of rows) {
    b[r.outcome] += r.counts.total;
    b.total += r.counts.total;
  }
  return b;
}

/** Per-rep aggregate across every outcome, plus that rep's deal rows for the drilldown. */
export interface RepPerf {
  ownerId: string | null;
  allAct: number;
  companyCount: number;
  mix: RcaCounts;
  wins: number;
  wonAct: number;
  wonVal: number;
  /** Mean close days over this rep's won deals that have a days value. */
  wonDays: number | null;
  losses: number;
  lostAct: number;
  lostVal: number;
  lostDays: number | null;
  open: number;
  openAct: number;
  openVal: number;
  deals: DealPerf[];
}

const meanDays = (rows: DealPerf[]): number | null => {
  const d = rows.filter((r) => r.days != null);
  return d.length ? d.reduce((n, r) => n + (r.days as number), 0) / d.length : null;
};

const keyOf = (id: string | null) => id ?? "__unassigned__";

export function repPerf(rows: DealPerf[]): RepPerf[] {
  const byRep = new Map<string, DealPerf[]>();
  for (const r of rows) {
    const k = keyOf(r.ownerId);
    const g = byRep.get(k);
    if (g) g.push(r);
    else byRep.set(k, [r]);
  }
  const out: RepPerf[] = [];
  for (const mine of byRep.values()) {
    const won = mine.filter((r) => r.outcome === "won");
    const lost = mine.filter((r) => r.outcome === "lost");
    const open = mine.filter((r) => r.outcome === "open");
    const act = (rs: DealPerf[]) => rs.reduce((n, r) => n + r.counts.total, 0);
    const val = (rs: DealPerf[]) => rs.reduce((n, r) => n + r.valueCents, 0);
    const mix = emptyCounts();
    for (const r of mine) {
      mix.call += r.counts.call;
      mix.email += r.counts.email;
      mix.drop_in += r.counts.drop_in;
      mix.appointment += r.counts.appointment;
      mix.total += r.counts.total;
    }
    out.push({
      ownerId: mine[0]!.ownerId,
      allAct: mix.total,
      companyCount: mine.length,
      mix,
      wins: won.length,
      wonAct: act(won),
      wonVal: val(won),
      wonDays: meanDays(won),
      losses: lost.length,
      lostAct: act(lost),
      lostVal: val(lost),
      lostDays: meanDays(lost),
      open: open.length,
      openAct: act(open),
      openVal: val(open),
      deals: mine,
    });
  }
  return out;
}

/** Org-wide totals derived from the per-rep rows. */
export interface GrandPerf {
  act: number;
  companyCount: number;
  repCount: number;
  wins: number;
  wonAct: number;
  wonVal: number;
  losses: number;
  lostAct: number;
  lostVal: number;
  open: number;
  openAct: number;
  openVal: number;
}

export function grandPerf(reps: RepPerf[]): GrandPerf {
  const g = (k: keyof RepPerf) => reps.reduce((n, r) => n + (r[k] as number), 0);
  return {
    act: g("allAct"),
    companyCount: g("companyCount"),
    repCount: reps.length,
    wins: g("wins"),
    wonAct: g("wonAct"),
    wonVal: g("wonVal"),
    losses: g("losses"),
    lostAct: g("lostAct"),
    lostVal: g("lostVal"),
    open: g("open"),
    openAct: g("openAct"),
    openVal: g("openVal"),
  };
}

// ── Formatting helpers (match the prototype) ──────────────────────────────
const oneDp = (n: number | null): string =>
  n == null || Number.isNaN(n) ? "n/a" : (Math.round(n * 10) / 10).toFixed(1);
const pctStr = (n: number | null): string =>
  n == null || Number.isNaN(n) ? "n/a" : `${Math.round(n * 100)}%`;
const winRateOf = (g: GrandPerf): number | null =>
  g.wins + g.losses > 0 ? g.wins / (g.wins + g.losses) : null;

export interface KpiCard {
  label: string;
  value: string;
  sub: string;
  /** The amber "effort not converted" callout card. */
  flag?: boolean;
}

/** The scope's headline cards, formatted. Parity with the prototype's drawKpis(). */
export function scopeKpis(grand: GrandPerf, rows: DealPerf[], scope: ReportScope): KpiCard[] {
  const g = grand;
  const nonWon = g.act - g.wonAct;
  const wr = winRateOf(g);
  const pctNonWon = g.act > 0 ? Math.round((nonWon / g.act) * 100) : 0;

  if (scope === "won") {
    return [
      { label: "Revenue won", value: formatBandUsd(g.wonVal), sub: `${g.wins} deals closed` },
      { label: "Touches per win", value: g.wins ? oneDp(g.act / g.wins) : "n/a", sub: "All activity divided by wins" },
      { label: "On winners only", value: g.wins ? oneDp(g.wonAct / g.wins) : "n/a", sub: "Survivorship view" },
      { label: "Days to close", value: oneDp(meanDays(rows.filter((r) => r.outcome === "won"))), sub: "Calendar days to won" },
      { label: "Effort not converted", value: String(nonWon), sub: `${pctNonWon}% of all activity`, flag: true },
    ];
  }
  if (scope === "lost") {
    return [
      { label: "Revenue lost", value: formatBandUsd(g.lostVal), sub: `${g.losses} deals lost` },
      { label: "Touches per loss", value: g.losses ? oneDp(g.lostAct / g.losses) : "n/a", sub: "Activity on lost deals only" },
      { label: "Days before loss", value: oneDp(meanDays(rows.filter((r) => r.outcome === "lost"))), sub: "Longer than the win cycle" },
      { label: "Win rate", value: pctStr(wr), sub: "Closed deals only" },
    ];
  }
  if (scope === "open") {
    const underMedian = rows.filter((r) => r.outcome === "open" && r.counts.total < WIN_MEDIAN_TOUCHES).length;
    const projected = wr == null ? null : g.open * wr;
    return [
      { label: "Open pipeline", value: formatBandUsd(g.openVal), sub: `${g.open} companies in flight` },
      { label: "Touches so far", value: String(g.openAct), sub: `${g.open ? oneDp(g.openAct / g.open) : "0"} per company` },
      { label: "Under the win median", value: String(underMedian), sub: `Companies below ${WIN_MEDIAN_TOUCHES} touches` },
      { label: "Projected wins", value: oneDp(projected), sub: "At current win rate" },
    ];
  }
  // all
  return [
    { label: "Total activity", value: String(g.act), sub: `${g.repCount} reps, ${g.companyCount} companies` },
    { label: "Deals won", value: String(g.wins), sub: `${formatBandUsd(g.wonVal)} closed` },
    { label: "Touches per win", value: g.wins ? oneDp(g.act / g.wins) : "n/a", sub: "Every activity counted" },
    { label: "Win rate", value: pctStr(wr), sub: "Of closed deals" },
    { label: "Effort not converted", value: String(nonWon), sub: "Open plus lost plus unlinked", flag: true },
  ];
}

// ── Rep table: scope-specific columns + effort/outcome divergence badges ──
export type RepMetricKey =
  | "allAct" | "companyCount" | "wins" | "wonVal" | "perWin" | "wonDays"
  | "losses" | "lostAct" | "perLoss" | "lostVal" | "open" | "openAct" | "perOpen" | "openVal";

export interface RepColumn { key: RepMetricKey; label: string }

export const REP_COLUMNS: Record<ReportScope, RepColumn[]> = {
  all: [
    { key: "allAct", label: "Activity" },
    { key: "companyCount", label: "Companies" },
    { key: "wins", label: "Wins" },
    { key: "wonVal", label: "Value" },
  ],
  won: [
    { key: "wins", label: "Wins" },
    { key: "perWin", label: "Touches / win" },
    { key: "wonDays", label: "Avg days" },
    { key: "wonVal", label: "Value" },
  ],
  lost: [
    { key: "losses", label: "Losses" },
    { key: "lostAct", label: "Activity" },
    { key: "perLoss", label: "Touches / loss" },
    { key: "lostVal", label: "Value lost" },
  ],
  open: [
    { key: "open", label: "Companies" },
    { key: "openAct", label: "Activity" },
    { key: "perOpen", label: "Touches / co" },
    { key: "openVal", label: "Pipeline" },
  ],
};

/** Raw numeric value for a rep metric (null renders as n/a). */
export function repMetric(rep: RepPerf, key: RepMetricKey): number | null {
  switch (key) {
    case "perWin": return rep.wins ? rep.allAct / rep.wins : null;
    case "perLoss": return rep.losses ? rep.lostAct / rep.losses : null;
    case "perOpen": return rep.open ? rep.openAct / rep.open : null;
    case "wonDays": return rep.wonDays;
    default: return rep[key] as number;
  }
}

/** Formatted cell text for a rep metric. */
export function repCell(rep: RepPerf, key: RepMetricKey): string {
  const v = repMetric(rep, key);
  if (v == null) return "n/a";
  if (/Val$/.test(key)) return v ? formatBandUsd(v) : "$0";
  if (/^per/.test(key) || key === "wonDays") return oneDp(v);
  return String(v);
}

/** The deal-value metric that defines "outcome" for the active scope. */
export function outcomeValueKey(scope: ReportScope): RepMetricKey {
  return scope === "lost" ? "lostVal" : scope === "open" ? "openVal" : "wonVal";
}

export type RepSortKey = "value" | "activity" | "primary";

export interface RepBadge { kind: "warn" | "good"; text: string }

export interface RankedRep {
  rep: RepPerf;
  rank: number;
  badge: RepBadge | null;
}

/**
 * Sort reps for display and attach effort-vs-outcome badges. Effort rank is by
 * total activity; outcome rank is by the scope's value. A rep whose outcome
 * trails effort by >=2 places is flagged (warn); one who beats it is praised
 * (good). Badges never show in the "all" scope.
 */
export function rankReps(reps: RepPerf[], scope: ReportScope, sortKey: RepSortKey): RankedRep[] {
  const outKey = outcomeValueKey(scope);
  const rankList = (metric: (r: RepPerf) => number) =>
    [...reps].sort((a, b) => metric(b) - metric(a)).map((r) => keyOf(r.ownerId));
  const effortOrder = rankList((r) => r.allAct);
  const outcomeOrder = rankList((r) => (repMetric(r, outKey) ?? 0));

  const primaryKey = REP_COLUMNS[scope][0]!.key;
  const sortMetric = (r: RepPerf): number =>
    (repMetric(r, sortKey === "value" ? outKey : sortKey === "activity" ? "allAct" : primaryKey) ?? -1);
  const sorted = [...reps].sort((a, b) => sortMetric(b) - sortMetric(a));

  return sorted.map((rep, i) => {
    const k = keyOf(rep.ownerId);
    const er = effortOrder.indexOf(k) + 1;
    const or = outcomeOrder.indexOf(k) + 1;
    const delta = or - er;
    let badge: RepBadge | null = null;
    if (scope !== "all" && delta >= 2) badge = { kind: "warn", text: `#${er} effort, #${or} outcome` };
    else if (scope !== "all" && delta <= -2) badge = { kind: "good", text: "outperforming effort" };
    return { rep, rank: i + 1, badge };
  });
}

/** Average per-deal activity mix for won vs lost (the "compare" toggle). */
export interface CompareRow { calls: number; emails: number; visits: number; appts: number; days: number | null }
export function wonVsLost(rows: DealPerf[]): { won: CompareRow; lost: CompareRow } {
  const avg = (outcome: Outcome): CompareRow => {
    const rs = rows.filter((r) => r.outcome === outcome);
    const n = rs.length || 1;
    const s = (k: keyof RcaCounts) => rs.reduce((a, r) => a + r.counts[k], 0) / n;
    return { calls: s("call"), emails: s("email"), visits: s("drop_in"), appts: s("appointment"), days: meanDays(rs) };
  };
  return { won: avg("won"), lost: avg("lost") };
}
