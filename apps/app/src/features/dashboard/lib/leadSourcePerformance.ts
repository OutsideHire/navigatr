/**
 * Lead Source Performance engine (LS-2a). Pure aggregation for the Lead Source
 * report (prototype 97e7756a): per-source leads, wins, win rate, median
 * touches-to-win, median days-to-close, MRR won, and MRR-per-lead yield, plus
 * a trend vs the prior window and the banner conditions the report surfaces.
 *
 * Three controls:
 *   - window:  trailing 30 / 90 / 180 days.
 *   - basis:   "created" cohorts leads by created_at (the source comparison);
 *              "won" counts wins whose close landed in the window (residual
 *              tie-back). Win rate is only a valid ratio on the created basis.
 *   - scope:   "rep" (rep-sourced prospecting only) hides Assigned/Import/Unknown;
 *              "all" shows every source.
 *
 * Role scoping (manager org-wide vs a rep's own book) is applied by the caller
 * filtering `deals` before calling this; the engine is role-agnostic.
 *
 * Revenue: MRR = deal value / 12 (fixed 12-month assumed term, per Robert).
 */
import type { Activity } from "@/features/activities/mockData";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import { isKnownLeadSource, isRepSourcedSource, leadSourceLabel, leadSourceSetBy, type LeadSource } from "@/features/pipeline/lib/leadSources";

export type AttributionBasis = "created" | "won";
export type SourceScope = "rep" | "all";

export interface LeadSourcePerfOptions {
  now: Date;
  windowDays: number;
  basis: AttributionBasis;
  scope: SourceScope;
}

export interface LeadSourceRow {
  /** Canonical source value, or "unknown" for legacy/unset. */
  source: LeadSource;
  label: string;
  repSourced: boolean;
  leads: number;
  won: number;
  winRate: number; // percent, 0-100
  /** Median activities logged on a won deal before it closed. Null if no wins. */
  touchesToWin: number | null;
  /** Median calendar days from created to won. Null if no wins with timing. */
  daysToClose: number | null;
  mrrWonCents: number;
  /** MRR won per lead (cents). */
  yieldCents: number;
  /** Percent change in yield vs the immediately prior window; null if no baseline. */
  trendPct: number | null;
}

export interface LeadSourceTotals {
  leads: number;
  won: number;
  winRate: number;
  mrrWonCents: number;
  yieldCents: number;
}

export interface LeadSourceFlags {
  /** basis==="created": sources whose window is younger than their own median
   *  time-to-close, so win rate reads low. */
  immatureSources: string[];
  worstImmature: { label: string; maturityPct: number } | null;
  /** basis==="won": win rate is not a valid ratio in this view. */
  mixedBasis: boolean;
  /** An Inbound row is present (rep-captured only; a floor, not a count). */
  hasInbound: boolean;
  /** scope==="all": Assigned + Import are included and drag the blend down. */
  allScope: boolean;
}

export interface LeadSourcePerformance {
  rows: LeadSourceRow[];
  totals: LeadSourceTotals;
  flags: LeadSourceFlags;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MRR_TERM_MONTHS = 12;

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Normalize a deal's stored source to a canonical value (legacy -> unknown). */
function sourceOf(deal: Deal): LeadSource {
  return isKnownLeadSource(deal.leadSource) ? deal.leadSource : "unknown";
}

function dealCreatedMs(deal: Deal): number | null {
  const iso = deal.createdAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function dealWonMs(deal: Deal): number | null {
  const iso = deal.closedWonAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Touches logged on a won deal before it closed (calls/drop-ins/appointments,
 *  and emails, all count as a touch per the spec). */
function touchesBeforeWin(deal: Deal, activitiesByDeal: Map<string, Activity[]>): number {
  const acts = activitiesByDeal.get(deal.id) ?? [];
  const wonAt = dealWonMs(deal);
  if (wonAt == null) return acts.length;
  return acts.filter((a) => new Date(a.occurredAt).getTime() <= wonAt).length;
}

/** Deals whose created cohort falls in [start, end]. */
function cohortInWindow(deals: Deal[], startMs: number, endMs: number): Deal[] {
  return deals.filter((d) => {
    const c = dealCreatedMs(d);
    return c != null && c >= startMs && c <= endMs;
  });
}

interface RawSourceAgg {
  leads: number;
  wonDeals: Deal[];
}

/** Group deals into per-source aggregates for the given basis + window. */
function aggregate(
  deals: Deal[],
  startMs: number,
  endMs: number,
  basis: AttributionBasis,
): Map<LeadSource, RawSourceAgg> {
  const cohort = cohortInWindow(deals, startMs, endMs);
  const out = new Map<LeadSource, RawSourceAgg>();
  const ensure = (s: LeadSource) => {
    let a = out.get(s);
    if (!a) {
      a = { leads: 0, wonDeals: [] };
      out.set(s, a);
    }
    return a;
  };
  // Leads: cohort by created date (both bases; keeps the leads column stable).
  for (const d of cohort) ensure(sourceOf(d)).leads += 1;
  // Wins: created basis = cohort deals now won; won basis = deals whose close
  // landed in the window (regardless of when created).
  if (basis === "created") {
    for (const d of cohort) if (d.stage === "won") ensure(sourceOf(d)).wonDeals.push(d);
  } else {
    for (const d of deals) {
      const w = dealWonMs(d);
      if (d.stage === "won" && w != null && w >= startMs && w <= endMs) ensure(sourceOf(d)).wonDeals.push(d);
    }
  }
  return out;
}

export function computeLeadSourcePerformance(
  deals: Deal[],
  activities: Activity[],
  opts: LeadSourcePerfOptions,
): LeadSourcePerformance {
  const endMs = opts.now.getTime();
  const startMs = endMs - opts.windowDays * DAY_MS;
  const prevEndMs = startMs;
  const prevStartMs = startMs - opts.windowDays * DAY_MS;

  const activitiesByDeal = new Map<string, Activity[]>();
  for (const a of activities) {
    const g = activitiesByDeal.get(a.dealId);
    if (g) g.push(a);
    else activitiesByDeal.set(a.dealId, [a]);
  }

  const cur = aggregate(deals, startMs, endMs, opts.basis);
  const prev = aggregate(deals, prevStartMs, prevEndMs, opts.basis);

  const yieldOf = (agg: RawSourceAgg): number => {
    const mrr = agg.wonDeals.reduce((s, d) => s + d.valueCents / MRR_TERM_MONTHS, 0);
    return agg.leads ? mrr / agg.leads : 0;
  };

  const rows: LeadSourceRow[] = [];
  for (const [source, agg] of cur.entries()) {
    const repSourced = isRepSourcedSource(source);
    if (opts.scope === "rep" && !repSourced) continue;
    if (agg.leads === 0 && agg.wonDeals.length === 0) continue;

    const mrrWonCents = Math.round(agg.wonDeals.reduce((s, d) => s + d.valueCents / MRR_TERM_MONTHS, 0));
    const yieldCents = agg.leads ? Math.round(mrrWonCents / agg.leads) : 0;
    const touches = median(agg.wonDeals.map((d) => touchesBeforeWin(d, activitiesByDeal)));
    const days = median(
      agg.wonDeals
        .map((d) => d.timeToWinCalendarDays ?? null)
        .filter((n): n is number => n != null),
    );
    const prevYield = prev.get(source) ? yieldOf(prev.get(source)!) : 0;
    const curYield = yieldOf(agg);
    const trendPct = prevYield > 0 ? Math.round(((curYield - prevYield) / prevYield) * 100) : null;

    rows.push({
      source,
      label: leadSourceLabel(source),
      repSourced,
      leads: agg.leads,
      won: agg.wonDeals.length,
      winRate: agg.leads ? (agg.wonDeals.length / agg.leads) * 100 : 0,
      touchesToWin: touches,
      daysToClose: days,
      mrrWonCents,
      yieldCents,
      trendPct,
    });
  }

  rows.sort((a, b) => b.yieldCents - a.yieldCents || b.leads - a.leads);

  const totals = rows.reduce<LeadSourceTotals>(
    (t, r) => {
      t.leads += r.leads;
      t.won += r.won;
      t.mrrWonCents += r.mrrWonCents;
      return t;
    },
    { leads: 0, won: 0, winRate: 0, mrrWonCents: 0, yieldCents: 0 },
  );
  totals.winRate = totals.leads ? (totals.won / totals.leads) * 100 : 0;
  totals.yieldCents = totals.leads ? Math.round(totals.mrrWonCents / totals.leads) : 0;

  // Cohort maturity: a window shorter than a source's own median time-to-close
  // means many of its deals cannot have resolved yet, so win rate reads low.
  const immature: string[] = [];
  let worst: { label: string; maturityPct: number } | null = null;
  if (opts.basis === "created") {
    for (const r of rows) {
      if (r.daysToClose == null || r.daysToClose <= 0) continue;
      const maturity = Math.max(0.22, Math.min(1, opts.windowDays / (r.daysToClose * 2.6)));
      if (maturity < 0.85) {
        immature.push(r.label);
        const pct = Math.round(maturity * 100);
        if (!worst || pct < worst.maturityPct) worst = { label: r.label, maturityPct: pct };
      }
    }
  }

  return {
    rows,
    totals,
    flags: {
      immatureSources: immature,
      worstImmature: worst,
      mixedBasis: opts.basis === "won",
      hasInbound: rows.some((r) => r.source === "inbound"),
      allScope: opts.scope === "all",
    },
  };
}

// ── Per-source drill-down (LS-2c) ──────────────────────────────────────────

/** One-line description of what a source is, for the drawer. */
export const LEAD_SOURCE_BLURB: Record<LeadSource, string> = {
  path: "GPS-generated stops matching the tenant target profile. Highest volume, lowest yield per lead.",
  self_sourced_canvass: "A drop-in or call the rep initiated outside a generated Path. The honest control group for Path.",
  partner_referral: "Submitted through the partner portal or partner form. Attributed to the originating relationship.",
  customer_referral: "From an existing merchant or a center of influence who is not a portal partner.",
  event_association: "Trade shows, chambers, association relationships, and referral networking groups.",
  inbound: "The prospect reached the rep directly. Reps hand out personal cell numbers, so most inbound never reaches the platform.",
  assigned: "A house lead pushed down by an admin or owner, including anything arriving from an upstream CRM.",
  import: "Existing book loaded at onboarding, plus any purchased list. Present for coverage, not for comparison.",
  other: "Rep-selected with a required note. A rising Other count is a signal the picklist is missing a value.",
  unknown: "Legacy or unset source. No origination channel was recorded at lead creation.",
};

const STAGE_ORDER: DealStage[] = ["new", "contacted", "qualified", "proposal", "submitted", "won"];

export interface StageFunnelRow { label: string; count: number; pct: number }
export interface MonthlyCohort { label: string; leads: number; won: number; winRate: number; open: boolean }
export interface RepBreakdownRow { ownerId: string | null; leads: number; won: number; winRate: number; yieldCents: number }

export interface LeadSourceDetail {
  source: LeadSource;
  label: string;
  setBy: "system" | "rep" | "unknown";
  blurb: string;
  leads: number;
  won: number;
  winRate: number;
  touchesToWin: number | null;
  mrrWonCents: number;
  yieldCents: number;
  funnel: StageFunnelRow[];
  cohorts: MonthlyCohort[];
  reps: RepBreakdownRow[];
}

/** Drill-down for a single source: stat trio, stage funnel, trailing-6-month
 *  cohorts, and rep breakdown. Cohort = deals created in the window. */
export function leadSourceDetail(
  deals: Deal[],
  activities: Activity[],
  opts: { source: LeadSource; now: Date; windowDays: number },
): LeadSourceDetail {
  const endMs = opts.now.getTime();
  const startMs = endMs - opts.windowDays * DAY_MS;
  const cohort = cohortInWindow(deals, startMs, endMs).filter((d) => sourceOf(d) === opts.source);
  const won = cohort.filter((d) => d.stage === "won");

  const activitiesByDeal = new Map<string, Activity[]>();
  for (const a of activities) {
    const g = activitiesByDeal.get(a.dealId);
    if (g) g.push(a);
    else activitiesByDeal.set(a.dealId, [a]);
  }

  const mrrWonCents = Math.round(won.reduce((s, d) => s + d.valueCents / MRR_TERM_MONTHS, 0));
  const leads = cohort.length;
  const reachedIdx = (d: Deal) => STAGE_ORDER.indexOf(d.stage); // lost -> -1 (created only)
  const countAtLeast = (idx: number) => cohort.filter((d) => reachedIdx(d) >= idx).length;
  const funnel: StageFunnelRow[] = [
    { label: "Created", count: leads },
    { label: "Contacted", count: countAtLeast(1) },
    { label: "Qualified", count: countAtLeast(2) },
    { label: "Proposal", count: countAtLeast(3) },
    { label: "Closed won", count: won.length },
  ].map((s) => ({ ...s, pct: leads ? (s.count / leads) * 100 : 0 }));

  // Trailing 6 calendar months of cohorts (by created month).
  const days = median(won.map((d) => d.timeToWinCalendarDays ?? null).filter((n): n is number => n != null));
  const cohorts: MonthlyCohort[] = [];
  const anchor = new Date(Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), 1));
  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)).getTime();
    const mEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i + 1, 1)).getTime();
    const inMonth = deals.filter((d) => {
      if (sourceOf(d) !== opts.source) return false;
      const c = dealCreatedMs(d);
      return c != null && c >= mStart && c < mEnd;
    });
    const mWon = inMonth.filter((d) => d.stage === "won").length;
    cohorts.push({
      label: new Date(mStart).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      leads: inMonth.length,
      won: mWon,
      winRate: inMonth.length ? (mWon / inMonth.length) * 100 : 0,
      // Still inside the source's median time-to-close → not fully resolved.
      open: days != null && endMs - mEnd < days * DAY_MS,
    });
  }

  // Rep breakdown ranked by yield.
  const byRep = new Map<string, Deal[]>();
  for (const d of cohort) {
    const k = d.owner_id ?? "__unassigned__";
    const g = byRep.get(k);
    if (g) g.push(d);
    else byRep.set(k, [d]);
  }
  const reps: RepBreakdownRow[] = [...byRep.values()].map((mine) => {
    const w = mine.filter((d) => d.stage === "won");
    const mrr = Math.round(w.reduce((s, d) => s + d.valueCents / MRR_TERM_MONTHS, 0));
    return {
      ownerId: mine[0]!.owner_id,
      leads: mine.length,
      won: w.length,
      winRate: mine.length ? (w.length / mine.length) * 100 : 0,
      yieldCents: mine.length ? Math.round(mrr / mine.length) : 0,
    };
  });
  reps.sort((a, b) => b.yieldCents - a.yieldCents || b.leads - a.leads);

  return {
    source: opts.source,
    label: leadSourceLabel(opts.source),
    setBy: leadSourceSetBy(opts.source),
    blurb: LEAD_SOURCE_BLURB[opts.source],
    leads,
    won: won.length,
    winRate: leads ? (won.length / leads) * 100 : 0,
    touchesToWin: median(won.map((d) => touchesBeforeWin(d, activitiesByDeal))),
    mrrWonCents,
    yieldCents: leads ? Math.round(mrrWonCents / leads) : 0,
    funnel,
    cohorts,
    reps,
  };
}
