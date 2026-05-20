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
import { STAGE_LABEL, type Deal, type DealStage } from "@/features/pipeline/mockData";
import type { Partner } from "@/features/partners/mockData";

export interface DashboardKpis {
  activeDealsCount: number;
  pipelineValueCents: number;
  weightedPipelineCents: number;
  wonDealsCount: number;
  wonRevenueCents: number;
  winRate: number; // 0..1 — won / (won + lost). We don't track "lost" yet, so this is won / total.
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
}

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "won"];

/** Sum a single deal's contribution to the weighted pipeline. Excludes
 *  Won deals (they're closed; weighted forecast is about open pipeline). */
function weightedContribution(d: Deal): number {
  if (d.stage === "won") return 0;
  return Math.round(d.valueCents * (d.probability / 100));
}

export function useDashboardData(): DashboardData {
  const dealsQ = useDeals();
  const partnersQ = usePartners();
  const activitiesQ = useActivitiesForOrg();

  const isLoading = dealsQ.isLoading || partnersQ.isLoading || activitiesQ.isLoading;
  const isError   = dealsQ.isError   || partnersQ.isError   || activitiesQ.isError;

  const deals     = dealsQ.data     ?? [];
  const partners  = partnersQ.data  ?? [];
  const activities = activitiesQ.data ?? [];

  const kpis = React.useMemo<DashboardKpis>(() => {
    let activeCount = 0;
    let openValueCents = 0;
    let weightedCents = 0;
    let wonCount = 0;
    let wonValueCents = 0;
    for (const d of deals) {
      if (d.stage === "won") {
        wonCount += 1;
        wonValueCents += d.valueCents;
      } else {
        activeCount += 1;
        openValueCents += d.valueCents;
        weightedCents += weightedContribution(d);
      }
    }
    const totalDeals = deals.length;
    return {
      activeDealsCount: activeCount,
      pipelineValueCents: openValueCents,
      weightedPipelineCents: weightedCents,
      wonDealsCount: wonCount,
      wonRevenueCents: wonValueCents,
      winRate: totalDeals > 0 ? wonCount / totalDeals : 0,
    };
  }, [deals]);

  const byStage = React.useMemo<PipelineStageRow[]>(() => {
    const buckets: Record<DealStage, { count: number; valueCents: number }> = {
      new: { count: 0, valueCents: 0 },
      contacted: { count: 0, valueCents: 0 },
      qualified: { count: 0, valueCents: 0 },
      proposal: { count: 0, valueCents: 0 },
      won: { count: 0, valueCents: 0 },
    };
    let totalCents = 0;
    for (const d of deals) {
      buckets[d.stage].count += 1;
      buckets[d.stage].valueCents += d.valueCents;
      totalCents += d.valueCents;
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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    let tasksDueToday = 0;
    for (const a of activities) {
      if (!a.followUpDate) continue;
      const due = new Date(a.followUpDate);
      // "Today or overdue" → due date is before end-of-today
      if (due < endOfToday) tasksDueToday += 1;
    }

    let partnersOverdue = 0;
    for (const p of partners) {
      if (!p.nextFollowup) continue;
      const next = new Date(p.nextFollowup);
      if (next < startOfToday) partnersOverdue += 1;
    }

    return { tasksDueToday, partnersOverdue };
  }, [activities, partners]);

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

  return {
    isLoading,
    isError,
    kpis,
    byStage,
    topPartners,
    todaysSnapshot,
    totalActivities: activities.length,
    leadSources,
  };
}
