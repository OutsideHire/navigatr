/**
 * Sprint 1 Rep Dashboard mock data.
 *
 * Theme: merchant-services agent at Outside Hire. Numbers chosen to
 * tell a coherent story across all 11 dashboard sections — the same
 * 47 active deals worth ~$163K appear in the KPI row AND drive the
 * pipeline-by-stage breakdown AND feed the conversion funnel.
 *
 * TODO Sprint 2: replace with TanStack Query hooks that hit the
 * generated SDK (Deals.listDeals, Activities.listActivities,
 * Partners.listPartners — see apps/app/src/api/generated/).
 * Until then, this file is the single source of truth for the
 * populated dashboard.
 */

import type { BadgeKind } from "@/components/navigatr";

export interface DashboardMockData {
  user: { fullName: string; role: string };
  tenant: { name: string; profession: "merchant_services" };
  date: { display: string };  // e.g. "Wed Apr 30"

  activitiesToWin: {
    value: string;             // "7.4"
    subtitle: string;          // "avg touchpoints per closed deal"
    trend: { direction: "up" | "down"; label: string; isPositive: boolean };
  };

  kpis: Array<{
    key: string;
    eyebrow: string;
    value: string;
    subtitle?: string;
    accent: "blue" | "teal" | "violet" | "orange" | "indigo" | "pink";
    trend?: { direction: "up" | "down"; label: string; isPositive: boolean };
  }>;

  pipelineByStage: Array<{
    stage: BadgeKind;
    label: string;
    count: number;
    valueCents: number;          // pipeline contribution
    percentOfPipeline: number;   // 0–100
  }>;

  todaysSnapshot: Array<{
    key: string;
    iconKind: "alert" | "map" | "clock";
    iconAccent: "warning" | "violet" | "danger";
    title: string;
    subtitle: string;
    to: string;
  }>;

  monthlyPerformance: Array<{ month: string; deals: number; valueCents: number }>;

  persistenceIndex: Array<{ eyebrow: string; value: string; caption: string }>;

  topPartners: Array<{ rank: number; name: string; referrals: number; revenueCents: number }>;

  leadSources: Array<{ label: string; percent: number; accent: "teal" | "violet" | "blue" | "orange" }>;

  conversionFunnel: Array<{ from: string; to: string; rate: number; fromCount: number; toCount: number }>;
}

export const MOCK: DashboardMockData = {
  user: { fullName: "Ryan Meo", role: "Sales Professional" },
  tenant: { name: "Outside Hire", profession: "merchant_services" },
  date: { display: "Wed Apr 30" },

  activitiesToWin: {
    value: "7.4",
    subtitle: "avg touchpoints per closed deal",
    trend: { direction: "up", label: "+18% vs last quarter", isPositive: true },
  },

  kpis: [
    {
      key: "leads",
      eyebrow: "ACTIVE LEADS",
      value: "47",
      subtitle: "active deals",
      accent: "blue",
      trend: { direction: "up", label: "+8 this month", isPositive: true },
    },
    {
      key: "pipeline",
      eyebrow: "PIPELINE VALUE",
      value: "$163K",
      subtitle: "weighted: $98K",
      accent: "teal",
    },
    {
      key: "win",
      eyebrow: "WIN RATE",
      value: "32%",
      subtitle: "last 30 days",
      accent: "violet",
      trend: { direction: "up", label: "+4% vs prior", isPositive: true },
    },
    {
      key: "close",
      eyebrow: "AVG CLOSE TIME",
      value: "21d",
      subtitle: "time to close",
      accent: "orange",
      trend: { direction: "down", label: "−3d vs prior", isPositive: true },
    },
  ],

  pipelineByStage: [
    { stage: "stage-new",        label: "New",        count: 12, valueCents: 4_300_000, percentOfPipeline: 25 },
    { stage: "stage-contacted",  label: "Contacted",  count: 15, valueCents: 5_200_000, percentOfPipeline: 32 },
    { stage: "stage-qualified",  label: "Qualified",  count: 10, valueCents: 3_400_000, percentOfPipeline: 21 },
    { stage: "stage-proposal",   label: "Proposal",   count: 7,  valueCents: 2_400_000, percentOfPipeline: 15 },
    { stage: "stage-won",        label: "Won",        count: 3,  valueCents: 1_000_000, percentOfPipeline: 7  },
  ],

  todaysSnapshot: [
    {
      key: "tasks",
      iconKind: "alert",
      iconAccent: "warning",
      title: "5 tasks due today",
      subtitle: "2 calls, 2 emails, 1 drop-in",
      to: "/activities",
    },
    {
      key: "next-stop",
      iconKind: "map",
      iconAccent: "violet",
      title: "Next stop on Path",
      subtitle: "Sunrise Cafe — 0.4 mi away",
      to: "/path",
    },
    {
      key: "overdue",
      iconKind: "clock",
      iconAccent: "danger",
      title: "3 partners overdue",
      subtitle: "Sarah Johnson, Marcus Thompson, Brandon Mitchell",
      to: "/partners",
    },
  ],

  monthlyPerformance: [
    { month: "Jan", deals: 3, valueCents: 3_200_000 },
    { month: "Feb", deals: 4, valueCents: 4_100_000 },
    { month: "Mar", deals: 6, valueCents: 5_800_000 },
    { month: "Apr", deals: 9, valueCents: 8_700_000 },
  ],

  persistenceIndex: [
    { eyebrow: "TOUCHES BEFORE WIN", value: "7.4",  caption: "vs industry avg 5.8" },
    { eyebrow: "FOLLOW-UP RATE",     value: "94%",  caption: "+12% vs prior" },
    { eyebrow: "RESPONSE WINDOW",    value: "1.8h", caption: "median response time" },
  ],

  topPartners: [
    { rank: 1, name: "Sarah Johnson",     referrals: 8, revenueCents: 8_700_000 },
    { rank: 2, name: "Marcus Thompson",   referrals: 6, revenueCents: 5_400_000 },
    { rank: 3, name: "Aisha Patel",       referrals: 5, revenueCents: 4_800_000 },
    { rank: 4, name: "David Chen",        referrals: 4, revenueCents: 3_600_000 },
    { rank: 5, name: "Brandon Mitchell",  referrals: 3, revenueCents: 2_800_000 },
  ],

  leadSources: [
    { label: "Partner Referrals", percent: 45, accent: "teal"   },
    { label: "Cold Outreach",     percent: 28, accent: "violet" },
    { label: "Inbound",           percent: 18, accent: "blue"   },
    { label: "Path Discovery",    percent:  9, accent: "orange" },
  ],

  conversionFunnel: [
    { from: "New",        to: "Contacted", rate: 76, fromCount: 12, toCount: 9 },
    { from: "Contacted",  to: "Qualified", rate: 67, fromCount: 9,  toCount: 6 },
    { from: "Qualified",  to: "Proposal",  rate: 70, fromCount: 6,  toCount: 4 },
    { from: "Proposal",   to: "Won",       rate: 75, fromCount: 4,  toCount: 3 },
  ],
};

/** Format cents → "$163K" / "$8,700" depending on scale. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}
