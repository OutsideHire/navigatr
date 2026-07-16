/**
 * useDashboardData — composes the deals / activities / partners hooks
 * and rolls them up into the metrics the Dashboard renders.
 *
 * Why client-side aggregation:
 *   At small org scale (<1000 deals, <10k activities) computing in the
 *   browser is cheap — every consumer is already paying for the same
 *   list query. A server-side dashboard RPC saves bandwidth but adds a
 *   maintenance surface (a SQL function that has to evolve alongside
 *   the schema). We'll cross that bridge when an org's dashboard takes
 *   measurably longer than its other pages.
 *
 * What's NOT in here:
 *   - Conversion funnel rates — we don't store deal stage transition
 *     history, so we can't truthfully compute "% of New that reached
 *     Contacted". Adding a deal_stage_history table is a real backend
 *     piece, not something to fake from the current snapshot.
 *   - Persistence index "follow-up rate" — needs scheduled-vs-completed
 *     activity tracking, same gap as the funnel.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { usePartners } from "@/features/partners/hooks/usePartners";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useStageHistory } from "@/features/pipeline/hooks/useStageHistory";
import { STAGE_LABEL, type Deal, type DealStage } from "@/features/pipeline/mockData";
import type { Partner } from "@/features/partners/mockData";
import { withinRange, type DateRange } from "../lib/dateRange";
import { computeActivityToWin, MIN_SAMPLE } from "../lib/activityToWin";
import { calendarDayDelta } from "@/lib/calendarDate";

export interface DashboardKpis {
  activeDealsCount: number;
  pipelineValueCents: number;
  weightedPipelineCents: number;
  wonDealsCount: number;
  wonRevenueCents: number;
  winRate: number; // 0..1 — won / (won + lost). Open deals are excluded; 0 when there are no closed deals.
}

export interface PipelineStageRow {
  stage: DealStage;
  label: string;
  count: number;
  valueCents: number;
  percentOfPipeline: number; // 0..100
}

export interface TopPartnerRow {
  rank: number;
  partner: Partner;
  referrals: number;
  revenueCents: number;
}

export interface TodaysSnapshot {
  /** Activities whose follow_up_date is today (overdue + due-today). */
  tasksDueToday: number;
  /** Partners whose next_followup_at is in the past or today. */
  partnersOverdue: number;
}

export interface LeadSourceRow {
  label: string;
  count: number;
  percent: number; // 0..100, rounded
}

export interface MonthlyPerformanceRow {
  /** "Jan", "Feb", … — short month label used in the chart x-axis. */
  monthLabel: string;
  /** YYYY-MM key for stable identity across renders. */
  monthKey: string;
  /** Won deals whose updated_at lands in this month. */
  deals: number;
  /** Sum of value_cents for those deals. */
  valueCents: number;
}

export interface ConversionFunnelRow {
  from: DealStage;
  to: DealStage;
  fromLabel: string;
  toLabel: string;
  /** Distinct deals that have ever entered the `from` stage. */
  fromCount: number;
  /** Distinct deals that have ever entered the `to` stage. */
  toCount: number;
  /** toCount / fromCount × 100, rounded. 0 when fromCount is 0. */
  rate: number;
}

export interface PersistenceStat {
  /** Eyebrow label (UPPERCASE), e.g. "TOUCHES BEFORE WIN". */
  eyebrow: string;
  /** Formatted value, e.g. "3.5" or "—" when no data. */
  value: string;
  /** Caption beneath the value, e.g. "across 2 wins". */
  caption: string;
  /** When true, the UI dims the card to signal "we don't track this yet". */
  comingSoon?: boolean;
}

export interface ActivitiesToWin {
  /** Avg activities per won deal — null when there are no wins yet
   *  (division would be nonsense; UI shows an empty-state hint). */
  ratio: number | null;
  /** Raw count of activities in the org — useful as the subtitle when
   *  ratio is null. */
  totalActivities: number;
  /** Count of won deals — denominator visibility for the rep. */
  wonDealsCount: number;
}

export interface DashboardData {
  isLoading: boolean;
  isError: boolean;
  kpis: DashboardKpis;
  byStage: PipelineStageRow[];
  topPartners: TopPartnerRow[];
  todaysSnapshot: TodaysSnapshot;
  /** Total activities logged in this org — feeds the "activities-to-win" hero. */
  totalActivities: number;
  /** Lead source breakdown — empty leadSource bucketed as "Other". */
  leadSources: LeadSourceRow[];
  /** Last 4 months of won-deal performance. Buckets are always the
   *  trailing 4 months ending at "now" — empty months render as zero
   *  bars so the axis stays stable. */
  monthlyPerformance: MonthlyPerformanceRow[];
  /** Hero "activities to win" — avg activities per won deal. */
  activitiesToWin: ActivitiesToWin;
  /** Stage-to-stage transition rates, computed from deal_stage_history. */
  conversionFunnel: ConversionFunnelRow[];
  /** Three persistence stats. Some are "coming soon" until we track
   *  scheduled-vs-completed activities + response-window timestamps. */
  persistenceIndex: PersistenceStat[];
}

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "won"];

/** The stages the by-stage breakdown renders (everything except "lost").
 *  The %-of-pipeline denominator is summed over exactly this set so the bars
 *  sum to 100% and a terminal "lost" deal never dilutes them. */
const DISPLAYED_STAGES = new Set<DealStage>(STAGES);

/** Sum a single deal's contribution to the weighted pipeline. Excludes
 *  terminal deals — both Won and Lost (weighted forecast is about the open
 *  pipeline; a lost deal has no forecast value). */
function weightedContribution(d: Deal): number {
  if (d.stage === "won" || d.stage === "lost") return 0;
  return Math.round(d.valueCents * (d.probability / 100));
}

export function useDashboardData(range: DateRange): DashboardData {
  const dealsQ = useDeals();
  const partnersQ = usePartners();
  const activitiesQ = useActivitiesForOrg();
  const stageHistoryQ = useStageHistory();

  const isLoading =
    dealsQ.isLoading || partnersQ.isLoading || activitiesQ.isLoading || stageHistoryQ.isLoading;
  const isError =
    dealsQ.isError || partnersQ.isError || activitiesQ.isError || stageHistoryQ.isError;

  const deals     = dealsQ.data     ?? [];
  const partners  = partnersQ.data  ?? [];
  const activities = activitiesQ.data ?? [];
  const stageHistory = stageHistoryQ.data ?? [];

  const kpis = React.useMemo<DashboardKpis>(() => {
    let activeCount = 0;
    let openValueCents = 0;
    let weightedCents = 0;
    let wonCount = 0;
    let wonValueCents = 0;
    let lostCount = 0;
    for (const d of deals) {
      if (d.stage === "won") {
        wonCount += 1;
        wonValueCents += d.valueCents;
      } else if (d.stage === "lost") {
        // Terminal: a lost deal is neither won nor active. It contributes to
        // nothing but the win-rate denominator below.
        lostCount += 1;
      } else {
        activeCount += 1;
        openValueCents += d.valueCents;
        weightedCents += weightedContribution(d);
      }
    }
    // Win rate is won / (won + lost) — the closed-deal outcome rate. Open
    // deals are excluded (matches AgentsPage). 0 when nothing has closed.
    const closedCount = wonCount + lostCount;
    return {
      activeDealsCount: activeCount,
      pipelineValueCents: openValueCents,
      weightedPipelineCents: weightedCents,
      wonDealsCount: wonCount,
      wonRevenueCents: wonValueCents,
      winRate: closedCount > 0 ? wonCount / closedCount : 0,
    };
  }, [deals]);

  const byStage = React.useMemo<PipelineStageRow[]>(() => {
    const buckets: Record<DealStage, { count: number; valueCents: number }> = {
      new: { count: 0, valueCents: 0 },
      contacted: { count: 0, valueCents: 0 },
      qualified: { count: 0, valueCents: 0 },
      proposal: { count: 0, valueCents: 0 },
      won: { count: 0, valueCents: 0 },
      lost: { count: 0, valueCents: 0 },
    };
    let totalCents = 0;
    for (const d of deals) {
      buckets[d.stage].count += 1;
      buckets[d.stage].valueCents += d.valueCents;
      // Denominator spans only the displayed stages (excludes "lost"), so the
      // rendered rows' percentages are internally consistent and sum to 100%.
      if (DISPLAYED_STAGES.has(d.stage)) totalCents += d.valueCents;
    }
    return STAGES.map((stage) => ({
      stage,
      label: STAGE_LABEL[stage],
      count: buckets[stage].count,
      valueCents: buckets[stage].valueCents,
      percentOfPipeline: totalCents > 0
        ? Math.round((buckets[stage].valueCents / totalCents) * 100)
        : 0,
    }));
  }, [deals]);

  const topPartners = React.useMemo<TopPartnerRow[]>(() => {
    const dealById = new Map(deals.map((d) => [d.id, d]));
    const revenueByPartner: Array<{ partner: Partner; referrals: number; revenue: number }> = [];
    for (const p of partners) {
      let revenue = 0;
      let referrals = 0;
      for (const id of p.attributedDealIds) {
        const d = dealById.get(id);
        if (!d) continue;
        referrals += 1;
        revenue += d.valueCents;
      }
      revenueByPartner.push({ partner: p, referrals, revenue });
    }
    return revenueByPartner
      .sort((a, b) => b.revenue - a.revenue || a.partner.name.localeCompare(b.partner.name))
      .slice(0, 5)
      .map((row, i) => ({
        rank: i + 1,
        partner: row.partner,
        referrals: row.referrals,
        revenueCents: row.revenue,
      }));
  }, [partners, deals]);

  const todaysSnapshot = React.useMemo<TodaysSnapshot>(() => {
    const now = new Date();
    const dealById = new Map(deals.map((d) => [d.id, d]));

    // Same guard + date logic as useFollowUpReminders (the notification bell)
    // so the dashboard count and the bell badge never disagree: skip
    // orphaned (parent deleted) and closed-won parents, and compare calendar
    // DAYS via the shared tz-stable helper rather than raw instants.
    let tasksDueToday = 0;
    for (const a of activities) {
      if (!a.followUpDate) continue;
      const deal = dealById.get(a.dealId);
      if (!deal) continue; // orphan — parent deleted
      if (deal.stage === "won") continue; // closed-won; no follow-up needed
      // delta <= 0 → due today or overdue.
      if (calendarDayDelta(now, new Date(a.followUpDate)) <= 0) tasksDueToday += 1;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let partnersOverdue = 0;
    for (const p of partners) {
      if (!p.nextFollowup) continue;
      const next = new Date(p.nextFollowup);
      if (next < startOfToday) partnersOverdue += 1;
    }

    return { tasksDueToday, partnersOverdue };
  }, [activities, partners, deals]);

  const leadSources = React.useMemo<LeadSourceRow[]>(() => {
    if (deals.length === 0) return [];
    const counts = new Map<string, number>();
    for (const d of deals) {
      // Normalize: trim whitespace, collapse empty/whitespace to "Other"
      // bucket. Free-text comes from the AddDealSheet's lead_source field,
      // so we expect some inconsistency ("partner referral" vs "Partner
      // Referral"). Case-insensitive grouping prevents fragmentation.
      const raw = (d.leadSource ?? "").trim();
      const key = raw === "" ? "Other" : raw;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = deals.length;
    return Array.from(counts.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / total) * 100),
      }))
      // Largest source first; ties broken alphabetically for stability.
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [deals]);

  const monthlyPerformance = React.useMemo<MonthlyPerformanceRow[]>(() => {
    // Build the trailing 4 months ending at this month, in chronological
    // order (left = oldest, right = current month). Empty buckets stay so
    // the chart's x-axis is stable for new orgs.
    const now = new Date();
    const buckets: MonthlyPerformanceRow[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = d.toLocaleString("en-US", { month: "short" });
      buckets.push({ monthKey, monthLabel, deals: 0, valueCents: 0 });
    }
    const indexByKey = new Map(buckets.map((b, i) => [b.monthKey, i]));

    for (const d of deals) {
      if (d.stage !== "won") continue;
      const ts = new Date(d.updatedAt);
      const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`;
      const idx = indexByKey.get(key);
      if (idx === undefined) continue; // outside the last 4 months
      buckets[idx]!.deals += 1;
      buckets[idx]!.valueCents += d.valueCents;
    }
    return buckets;
  }, [deals]);

  // Flow metrics re-scope to the selected date range. Activities by their
  // occurredAt; "wins in range" by the deal's updatedAt (the same won-date
  // proxy the monthly chart uses). Stock metrics above ignore `range`.
  const activitiesInRange = React.useMemo(
    () => activities.filter((a) => withinRange(a.occurredAt, range)),
    [activities, range],
  );

  const wonInRange = React.useMemo(
    () =>
      deals.filter((d) => d.stage === "won" && withinRange(d.updatedAt, range)).length,
    [deals, range],
  );

  const activitiesToWin = React.useMemo<ActivitiesToWin>(() => {
    const totalActivities = activitiesInRange.length;
    const wonDealsCount = wonInRange;
    return {
      // Divide-by-zero guard. Null tells the UI to show an empty state
      // ("Close a deal to start tracking your touchpoint efficiency")
      // instead of a misleading 0.0 or NaN.
      ratio: wonDealsCount > 0 ? totalActivities / wonDealsCount : null,
      totalActivities,
      wonDealsCount,
    };
  }, [activitiesInRange, wonInRange]);

  const conversionFunnel = React.useMemo<ConversionFunnelRow[]>(() => {
    // "Ever entered" set per stage: distinct deal_ids that ever
    // transitioned INTO this stage (to_stage row exists).
    const everIn: Record<DealStage, Set<string>> = {
      new: new Set(),
      contacted: new Set(),
      qualified: new Set(),
      proposal: new Set(),
      won: new Set(),
      lost: new Set(),
    };
    for (const row of stageHistory) {
      everIn[row.toStage].add(row.dealId);
    }
    const transitions: Array<[DealStage, DealStage]> = [
      ["new", "contacted"],
      ["contacted", "qualified"],
      ["qualified", "proposal"],
      ["proposal", "won"],
    ];
    return transitions.map(([from, to]) => {
      const fromCount = everIn[from].size;
      const toCount = everIn[to].size;
      return {
        from,
        to,
        fromLabel: STAGE_LABEL[from],
        toLabel: STAGE_LABEL[to],
        fromCount,
        toCount,
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
      };
    });
  }, [stageHistory]);

  // Activity-to-Win aggregate — the SAME engine the hero uses (median touches
  // per won deal from the snapshot columns), so this card can't disagree with
  // the headline the way the old activities/wins average did.
  const activityToWinAgg = React.useMemo(
    () => computeActivityToWin(deals, { range }),
    [deals, range],
  );

  const persistenceIndex = React.useMemo<PersistenceStat[]>(() => {
    // 1. Touches before win — the median touches-to-close, gated the same way
    //    as the hero (needs MIN_SAMPLE measured wins) so the two always match.
    const med = activityToWinAgg.medianTotal;
    const touchesBeforeWin: PersistenceStat =
      !activityToWinAgg.insufficientData && med !== null
        ? {
            eyebrow: "TOUCHES BEFORE WIN",
            value: Number.isInteger(med) ? String(med) : med.toFixed(1),
            caption: `median across ${activityToWinAgg.sampleSize} ${activityToWinAgg.sampleSize === 1 ? "win" : "wins"}`,
          }
        : {
            eyebrow: "TOUCHES BEFORE WIN",
            value: "—",
            caption: `needs ${MIN_SAMPLE}+ measured wins`,
          };

    // 2 + 3. Follow-up rate + response window require data we don't yet
    //    capture (scheduled-vs-completed activities, response timestamps
    //    on inbound emails). Marked coming-soon — the UI dims these
    //    cards so reps know they're real-but-blocked, not bugs.
    return [
      touchesBeforeWin,
      {
        eyebrow: "FOLLOW-UP RATE",
        value: "—",
        caption: "tracking lands with scheduled-activity coverage",
        comingSoon: true,
      },
      {
        eyebrow: "RESPONSE WINDOW",
        value: "—",
        caption: "needs inbound-email timestamps",
        comingSoon: true,
      },
    ];
  }, [activityToWinAgg]);

  return {
    isLoading,
    isError,
    kpis,
    byStage,
    topPartners,
    todaysSnapshot,
    totalActivities: activitiesInRange.length,
    leadSources,
    monthlyPerformance,
    activitiesToWin,
    conversionFunnel,
    persistenceIndex,
  };
}
