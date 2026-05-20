// Tests the aggregation logic — KPI sums, by-stage bucketing, top-partner
// ranking, today's snapshot counting. Mocks the three child hooks so this
// stays a pure unit test of the math, not an integration test of Supabase.
//
// The math is where this hook earns its keep — a wrong "$163K weighted"
// or a missing won-deal in the KPI row is the kind of bug that erodes
// rep trust in the product. Lock the contracts here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDashboardData } from "./useDashboardData";
import type { Deal } from "@/features/pipeline/mockData";
import type { Partner } from "@/features/partners/mockData";
import type { Activity } from "@/features/activities/mockData";

// Mock the three composing hooks.
let dealsData: Deal[];
let partnersData: Partner[];
let activitiesData: Activity[];

vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsData, isLoading: false, isError: false }),
}));
vi.mock("@/features/partners/hooks/usePartners", () => ({
  usePartners: () => ({ data: partnersData, isLoading: false, isError: false }),
}));
vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivitiesForOrg: () => ({ data: activitiesData, isLoading: false, isError: false }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function deal(
  id: string,
  stage: Deal["stage"],
  valueCents: number,
  probability = 50,
  leadSource = "",
  updatedAt = "2026-05-18T12:00:00Z",
): Deal {
  return {
    id, companyName: `Co-${id}`, contactName: "X",
    phone: "+12025550100", email: "x@x.x",
    valueCents, stage, probability,
    lastActivity: "2026-05-18T12:00:00Z", nextFollowup: null,
    employeeCountRange: "1-10",
    leadSource,
    updatedAt,
  };
}

function partner(id: string, name: string, dealIds: string[] = []): Partner {
  return {
    id, name, company: `${name} & Co`, type: "cpa", status: "active",
    phone: "+12025550100", email: `${id}@x.x`, city: "",
    lastTouch: null, nextFollowup: null,
    attributedDealIds: dealIds, notes: "",
  };
}

function activity(dealId: string, followUpDate: string | null): Activity {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    dealId, type: "call", disposition: "positive_engagement",
    durationMinutes: 10, outcomeNotes: "",
    occurredAt: "2026-05-19T10:00:00Z", followUpDate,
  };
}

beforeEach(() => {
  dealsData = [];
  partnersData = [];
  activitiesData = [];
});

describe("useDashboardData / KPIs", () => {
  it("zero deals → all KPIs zero", () => {
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.kpis).toEqual({
      activeDealsCount: 0,
      pipelineValueCents: 0,
      weightedPipelineCents: 0,
      wonDealsCount: 0,
      wonRevenueCents: 0,
      winRate: 0,
    });
  });

  it("counts non-won deals as active, won deals separately", () => {
    dealsData = [
      deal("a", "new", 100_000),
      deal("b", "qualified", 200_000),
      deal("c", "won", 500_000),
      deal("d", "won", 300_000),
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.kpis.activeDealsCount).toBe(2);
    expect(result.current.kpis.wonDealsCount).toBe(2);
    expect(result.current.kpis.wonRevenueCents).toBe(800_000);
    // win rate = 2 won / 4 total = 0.5
    expect(result.current.kpis.winRate).toBe(0.5);
  });

  it("pipeline value excludes won deals; weighted applies probability", () => {
    dealsData = [
      deal("a", "new", 100_000, 20),    // weighted 20_000
      deal("b", "qualified", 100_000, 55), // weighted 55_000
      deal("c", "won", 500_000, 100),    // EXCLUDED — closed
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.kpis.pipelineValueCents).toBe(200_000);
    // 100_000 * 0.20 + 100_000 * 0.55 = 75_000
    expect(result.current.kpis.weightedPipelineCents).toBe(75_000);
  });
});

describe("useDashboardData / by-stage", () => {
  it("always returns all 5 stages, even when some are empty", () => {
    dealsData = [deal("a", "new", 100_000)];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const stages = result.current.byStage.map((s) => s.stage);
    expect(stages).toEqual(["new", "contacted", "qualified", "proposal", "won"]);
    expect(result.current.byStage.find((s) => s.stage === "won")?.count).toBe(0);
  });

  it("computes per-stage count + value + % of total pipeline", () => {
    dealsData = [
      deal("a", "new", 100_000),
      deal("b", "new", 100_000),
      deal("c", "qualified", 200_000),
      deal("d", "won", 100_000),
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const newRow = result.current.byStage.find((s) => s.stage === "new")!;
    expect(newRow.count).toBe(2);
    expect(newRow.valueCents).toBe(200_000);
    // 200K out of 500K total = 40%
    expect(newRow.percentOfPipeline).toBe(40);
  });
});

describe("useDashboardData / top partners", () => {
  it("ranks partners by attributed revenue, top 5 only", () => {
    dealsData = [
      deal("d1", "qualified", 10_000_00),
      deal("d2", "won", 50_000_00),
      deal("d3", "proposal", 30_000_00),
    ];
    partnersData = [
      partner("p1", "Alice",   ["d1"]),         // 10K
      partner("p2", "Bob",     ["d2"]),         // 50K
      partner("p3", "Carol",   ["d1", "d3"]),   // 40K
      partner("p4", "Dave",    []),             // 0
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const ranks = result.current.topPartners.map((r) => ({ name: r.partner.name, revenue: r.revenueCents }));
    // Sorted by revenue desc — Bob (50K) > Carol (40K) > Alice (10K) > Dave (0)
    expect(ranks).toEqual([
      { name: "Bob", revenue: 50_000_00 },
      { name: "Carol", revenue: 40_000_00 },
      { name: "Alice", revenue: 10_000_00 },
      { name: "Dave", revenue: 0 },
    ]);
    expect(result.current.topPartners[0].rank).toBe(1);
  });

  it("attribution to a deal that no longer exists is dropped (no orphan count)", () => {
    dealsData = [deal("d1", "qualified", 10_000_00)];
    partnersData = [
      partner("p1", "Alice", ["d1", "d-deleted"]),  // d-deleted has been removed
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.topPartners[0].referrals).toBe(1);
    expect(result.current.topPartners[0].revenueCents).toBe(10_000_00);
  });
});

describe("useDashboardData / lead sources", () => {
  it("returns empty array when there are no deals", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.leadSources).toEqual([]);
  });

  it("groups by leadSource, sorted by count desc with alphabetical tiebreak", () => {
    dealsData = [
      deal("d1", "new", 100, 20, "Partner referral"),
      deal("d2", "new", 100, 20, "Partner referral"),
      deal("d3", "new", 100, 20, "Cold outreach"),
      deal("d4", "new", 100, 20, "Cold outreach"),
      deal("d5", "new", 100, 20, "Inbound"),
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    // Cold outreach (2) sorts before Partner referral (2) alphabetically when tied
    expect(result.current.leadSources.map((s) => s.label)).toEqual([
      "Cold outreach",
      "Partner referral",
      "Inbound",
    ]);
    expect(result.current.leadSources[0]).toMatchObject({
      label: "Cold outreach",
      count: 2,
      percent: 40, // 2 / 5
    });
  });

  it("collapses empty / whitespace leadSource into an 'Other' bucket", () => {
    dealsData = [
      deal("d1", "new", 100, 20, ""),
      deal("d2", "new", 100, 20, "   "),
      deal("d3", "new", 100, 20, "Inbound"),
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const labels = result.current.leadSources.map((s) => s.label);
    expect(labels).toContain("Other");
    expect(labels).toContain("Inbound");
    const other = result.current.leadSources.find((s) => s.label === "Other")!;
    expect(other.count).toBe(2);
  });
});

describe("useDashboardData / monthly performance", () => {
  it("always returns 4 trailing months, even with zero data", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.monthlyPerformance).toHaveLength(4);
    for (const m of result.current.monthlyPerformance) {
      expect(m.deals).toBe(0);
      expect(m.valueCents).toBe(0);
    }
  });

  it("only counts won deals; pipeline-stage deals don't show up", () => {
    const thisMonth = new Date().toISOString();
    dealsData = [
      deal("won", "won", 100_000_00, 100, "", thisMonth),
      deal("open", "qualified", 50_000_00, 55, "", thisMonth),
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const currentMonth = result.current.monthlyPerformance[3]!; // last bucket = this month
    expect(currentMonth.deals).toBe(1);
    expect(currentMonth.valueCents).toBe(100_000_00);
  });

  it("ignores wins older than the trailing 4 months window", () => {
    // Force a deal with updated_at ~6 months ago — outside the window.
    const longAgo = new Date();
    longAgo.setMonth(longAgo.getMonth() - 6);
    dealsData = [deal("old-win", "won", 50_000_00, 100, "", longAgo.toISOString())];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const total = result.current.monthlyPerformance.reduce((s, m) => s + m.deals, 0);
    expect(total).toBe(0);
  });

  it("month buckets are in chronological order (oldest first, current last)", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    const keys = result.current.monthlyPerformance.map((m) => m.monthKey);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe("useDashboardData / today's snapshot", () => {
  it("counts activities with follow_up_date today or earlier as tasks-due", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    activitiesData = [
      activity("d1", yesterday.toISOString()),  // overdue — counts
      activity("d2", today.toISOString()),      // today — counts
      activity("d3", tomorrow.toISOString()),   // future — does NOT count
      activity("d4", null),                     // no follow-up — does NOT count
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.todaysSnapshot.tasksDueToday).toBe(2);
  });

  it("counts partners with nextFollowup before today as overdue", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow  = new Date(Date.now() + 86_400_000).toISOString();
    partnersData = [
      { ...partner("p1", "Late"),    nextFollowup: yesterday },
      { ...partner("p2", "OnTrack"), nextFollowup: tomorrow },
      { ...partner("p3", "None"),    nextFollowup: null },
    ];
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    expect(result.current.todaysSnapshot.partnersOverdue).toBe(1);
  });
});
