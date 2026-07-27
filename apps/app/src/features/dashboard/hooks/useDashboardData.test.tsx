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
import type { DateRange } from "../lib/dateRange";
import type { Deal } from "@/features/pipeline/mockData";
import type { Partner } from "@/features/partners/mockData";
import type { Activity } from "@/features/activities/mockData";
import { dateOnlyToNoonUtcIso, toDateOnly } from "@/lib/calendarDate";

// All-time range with a far-future upper bound — preserves the original
// all-data assertions without depending on the system clock. Flow tests
// below use explicit narrower ranges.
const ALL: DateRange = { fromIso: null, toIso: "2099-01-01T00:00:00.000Z" };

// Mock the four composing hooks.
let dealsData: Deal[];
let partnersData: Partner[];
let activitiesData: Activity[];
let stageHistoryData: Array<{
  id: string;
  dealId: string;
  fromStage: Deal["stage"] | null;
  toStage: Deal["stage"];
  transitionedAt: string;
}>;

vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsData, isLoading: false, isError: false }),
}));
vi.mock("@/features/partners/hooks/usePartners", () => ({
  usePartners: () => ({ data: partnersData, isLoading: false, isError: false }),
}));
vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivitiesForOrg: () => ({ data: activitiesData, isLoading: false, isError: false }),
}));
vi.mock("@/features/pipeline/hooks/useStageHistory", () => ({
  useStageHistory: () => ({ data: stageHistoryData, isLoading: false, isError: false }),
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
    address: null,
    employeeCountRange: "1-10",
    leadSource,
    updatedAt,
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function partner(id: string, name: string, dealIds: string[] = []): Partner {
  return {
    id, name, company: `${name} & Co`, type: "cpa_bookkeeper", status: "active",
    phone: "+12025550100", email: `${id}@x.x`, city: "",
    lastTouch: null, nextFollowup: null,
    attributedDealIds: dealIds, outboundDealIds: [], notes: "",
  };
}

function activity(
  dealId: string,
  followUpDate: string | null,
  occurredAt = "2026-05-19T10:00:00Z",
): Activity {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    dealId, type: "call", disposition: "positive_engagement",
    durationMinutes: 10, outcomeNotes: "",
    occurredAt, followUpDate,
  };
}

beforeEach(() => {
  dealsData = [];
  partnersData = [];
  activitiesData = [];
  stageHistoryData = [];
});

describe("useDashboardData / KPIs", () => {
  it("zero deals → all KPIs zero", () => {
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.kpis.activeDealsCount).toBe(2);
    expect(result.current.kpis.wonDealsCount).toBe(2);
    expect(result.current.kpis.wonRevenueCents).toBe(800_000);
    // win rate = won / (won + lost). 2 won, 0 lost → 2/2 = 1.0.
    // (The old buggy formula was won / all-deals = 2/4 = 0.5.)
    expect(result.current.kpis.winRate).toBe(1);
  });

  it("pipeline value excludes won deals; weighted applies probability", () => {
    dealsData = [
      deal("a", "new", 100_000, 20),    // weighted 20_000
      deal("b", "qualified", 100_000, 55), // weighted 55_000
      deal("c", "won", 500_000, 100),    // EXCLUDED — closed
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.kpis.pipelineValueCents).toBe(200_000);
    // 100_000 * 0.20 + 100_000 * 0.55 = 75_000
    expect(result.current.kpis.weightedPipelineCents).toBe(75_000);
  });

  it("treats a lost deal as terminal — not active, not open pipeline, not weighted", () => {
    // Bug 1 regression. A lost deal carries value + a high probability; none
    // of it may leak into the active count, open pipeline, or weighted total.
    dealsData = [
      deal("open", "qualified", 100_000, 60),
      deal("lost", "lost", 400_000, 90),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.kpis.activeDealsCount).toBe(1);
    expect(result.current.kpis.pipelineValueCents).toBe(100_000);
    // Only the open deal contributes: 100_000 * 0.60 = 60_000.
    // (Buggy code added the lost deal's 400_000 * 0.90 = 360_000 too.)
    expect(result.current.kpis.weightedPipelineCents).toBe(60_000);
  });

  it("winRate = won / (won + lost), ignoring still-open deals", () => {
    // Bug 3 regression. 5 won + 5 lost + 40 open.
    dealsData = [
      ...Array.from({ length: 5 }, (_, i) => deal(`won-${i}`, "won", 100_000)),
      ...Array.from({ length: 5 }, (_, i) => deal(`lost-${i}`, "lost", 100_000)),
      ...Array.from({ length: 40 }, (_, i) => deal(`open-${i}`, "qualified", 100_000)),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    // 5 / (5 + 5) = 0.5 — NOT the buggy 5 / 50 = 0.1.
    expect(result.current.kpis.winRate).toBe(0.5);
  });

  it("winRate is 0 when there are no closed deals (divide-by-zero guard)", () => {
    dealsData = [deal("a", "qualified", 100_000), deal("b", "new", 100_000)];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.kpis.winRate).toBe(0);
  });
});

describe("useDashboardData / by-stage", () => {
  it("always returns all 6 stages, even when some are empty", () => {
    dealsData = [deal("a", "new", 100_000)];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const stages = result.current.byStage.map((s) => s.stage);
    expect(stages).toEqual(["new", "contacted", "qualified", "proposal", "submitted", "won"]);
    expect(result.current.byStage.find((s) => s.stage === "won")?.count).toBe(0);
  });

  it("computes per-stage count + value + % of total pipeline", () => {
    dealsData = [
      deal("a", "new", 100_000),
      deal("b", "new", 100_000),
      deal("c", "qualified", 200_000),
      deal("d", "won", 100_000),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const newRow = result.current.byStage.find((s) => s.stage === "new")!;
    expect(newRow.count).toBe(2);
    expect(newRow.valueCents).toBe(200_000);
    // 200K out of 500K total = 40%
    expect(newRow.percentOfPipeline).toBe(40);
  });

  it("percentages of the visible stages sum to 100% and a lost deal doesn't dilute them", () => {
    // Bug 2 regression. The lost deal's value must NOT enter the % denominator
    // (the rendered rows exclude lost), so the visible bars still sum to 100%.
    dealsData = [
      deal("a", "new", 100_000),
      deal("b", "qualified", 100_000),
      deal("c", "proposal", 200_000),
      deal("d", "lost", 600_000),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const sum = result.current.byStage.reduce((s, r) => s + r.percentOfPipeline, 0);
    expect(sum).toBe(100);
    const newRow = result.current.byStage.find((s) => s.stage === "new")!;
    // 100K of 400K visible-stage pipeline = 25%.
    // (Buggy code divided by 1,000K incl. the lost deal → 10%, sum → 40%.)
    expect(newRow.percentOfPipeline).toBe(25);
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.topPartners[0].referrals).toBe(1);
    expect(result.current.topPartners[0].revenueCents).toBe(10_000_00);
  });
});

describe("useDashboardData / lead sources", () => {
  it("returns empty array when there are no deals", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const labels = result.current.leadSources.map((s) => s.label);
    expect(labels).toContain("Other");
    expect(labels).toContain("Inbound");
    const other = result.current.leadSources.find((s) => s.label === "Other")!;
    expect(other.count).toBe(2);
  });
});

describe("useDashboardData / activities to win", () => {
  it("null ratio when no wins yet — UI shows the empty-state copy", () => {
    dealsData = [deal("a", "qualified", 100, 55)];
    activitiesData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.activitiesToWin.ratio).toBeNull();
    expect(result.current.activitiesToWin.wonDealsCount).toBe(0);
  });

  it("divides total activities by won deals when at least one win exists", () => {
    dealsData = [
      deal("won1", "won", 100, 100),
      deal("won2", "won", 100, 100),
      deal("open", "qualified", 100, 55),
    ];
    // Build 7 activities — irrelevant which deal they're tied to;
    // the metric is org-wide.
    activitiesData = Array.from({ length: 7 }, (_, i) => ({
      id: `a-${i}`, dealId: "won1", type: "call" as const,
      disposition: "positive_engagement" as const,
      durationMinutes: 10, outcomeNotes: "",
      occurredAt: "2026-05-19T10:00:00Z", followUpDate: null,
    }));
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    // 7 activities / 2 wins = 3.5
    expect(result.current.activitiesToWin.ratio).toBe(3.5);
    expect(result.current.activitiesToWin.totalActivities).toBe(7);
    expect(result.current.activitiesToWin.wonDealsCount).toBe(2);
  });
});

describe("useDashboardData / monthly performance", () => {
  it("always returns 4 trailing months, even with zero data", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
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
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const currentMonth = result.current.monthlyPerformance[3]!; // last bucket = this month
    expect(currentMonth.deals).toBe(1);
    expect(currentMonth.valueCents).toBe(100_000_00);
  });

  it("ignores wins older than the trailing 4 months window", () => {
    // Force a deal with updated_at ~6 months ago — outside the window.
    const longAgo = new Date();
    longAgo.setMonth(longAgo.getMonth() - 6);
    dealsData = [deal("old-win", "won", 50_000_00, 100, "", longAgo.toISOString())];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const total = result.current.monthlyPerformance.reduce((s, m) => s + m.deals, 0);
    expect(total).toBe(0);
  });

  it("month buckets are in chronological order (oldest first, current last)", () => {
    dealsData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const keys = result.current.monthlyPerformance.map((m) => m.monthKey);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe("useDashboardData / conversion funnel", () => {
  function transition(dealId: string, toStage: Deal["stage"], fromStage: Deal["stage"] | null = null) {
    return {
      id: `h-${Math.random().toString(36).slice(2)}`,
      dealId, fromStage, toStage,
      transitionedAt: "2026-05-19T10:00:00Z",
    };
  }

  it("returns 4 stage pairs (new→contacted ... proposal→won) always", () => {
    stageHistoryData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.conversionFunnel).toHaveLength(4);
    expect(result.current.conversionFunnel.map((r) => `${r.from}->${r.to}`)).toEqual([
      "new->contacted",
      "contacted->qualified",
      "qualified->proposal",
      "proposal->won",
    ]);
  });

  it("0% rate when no transitions yet", () => {
    stageHistoryData = [];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    for (const step of result.current.conversionFunnel) {
      expect(step.rate).toBe(0);
      expect(step.fromCount).toBe(0);
      expect(step.toCount).toBe(0);
    }
  });

  it("computes rate = (deals that reached toStage) / (deals that reached fromStage)", () => {
    // 4 deals reached New; 3 of them reached Contacted; 1 reached Qualified.
    stageHistoryData = [
      transition("d1", "new"),
      transition("d2", "new"),
      transition("d3", "new"),
      transition("d4", "new"),
      transition("d1", "contacted", "new"),
      transition("d2", "contacted", "new"),
      transition("d3", "contacted", "new"),
      transition("d1", "qualified", "contacted"),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const newToContacted = result.current.conversionFunnel.find((s) => s.from === "new")!;
    expect(newToContacted).toMatchObject({ fromCount: 4, toCount: 3, rate: 75 });
    const contactedToQualified = result.current.conversionFunnel.find((s) => s.from === "contacted")!;
    expect(contactedToQualified).toMatchObject({ fromCount: 3, toCount: 1, rate: 33 });
  });

  it("counts each deal once per stage even if it transitions in/out multiple times", () => {
    // Same deal goes new → contacted → new → contacted again. Both
    // counts should remain 1 (set-based "ever entered").
    stageHistoryData = [
      transition("d1", "new"),
      transition("d1", "contacted", "new"),
      transition("d1", "new", "contacted"),
      transition("d1", "contacted", "new"),
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    const newToContacted = result.current.conversionFunnel.find((s) => s.from === "new")!;
    expect(newToContacted).toMatchObject({ fromCount: 1, toCount: 1, rate: 100 });
  });
});

describe("useDashboardData / today's snapshot", () => {
  // Follow-up dates are stored at noon-UTC of a calendar day (the app
  // convention in lib/calendarDate); tasks-due compares them via the shared
  // calendarDayDelta, so this offset builder matches production exactly.
  function dueOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return dateOnlyToNoonUtcIso(toDateOnly(d));
  }

  it("counts activities with follow_up_date today or earlier as tasks-due", () => {
    // Parent deals must exist and be open — tasks-due now mirrors the bell's
    // guard (orphaned/won parents are skipped), so every counted activity
    // needs an open parent deal.
    dealsData = [
      deal("d1", "qualified", 100_00),
      deal("d2", "qualified", 100_00),
      deal("d3", "qualified", 100_00),
      deal("d4", "qualified", 100_00),
    ];
    activitiesData = [
      activity("d1", dueOffset(-1)),  // overdue — counts
      activity("d2", dueOffset(0)),   // today — counts
      activity("d3", dueOffset(1)),   // future — does NOT count
      activity("d4", null),           // no follow-up — does NOT count
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.todaysSnapshot.tasksDueToday).toBe(2);
  });

  it("tasksDueToday skips follow-ups whose parent deal is won or missing (matches the bell)", () => {
    // Bug 4 regression. Same guard as useFollowUpReminders: an activity on a
    // won or orphaned deal is not an open task, so it must not be counted.
    dealsData = [
      deal("open", "qualified", 100_00),
      deal("wonDeal", "won", 100_00),
    ];
    activitiesData = [
      activity("open", dueOffset(0)),     // open parent — counts
      activity("wonDeal", dueOffset(0)),  // won parent — skipped
      activity("ghost", dueOffset(0)),    // orphan (no such deal) — skipped
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.todaysSnapshot.tasksDueToday).toBe(1);
  });

  it("counts partners with nextFollowup before today as overdue", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow  = new Date(Date.now() + 86_400_000).toISOString();
    partnersData = [
      { ...partner("p1", "Late"),    nextFollowup: yesterday },
      { ...partner("p2", "OnTrack"), nextFollowup: tomorrow },
      { ...partner("p3", "None"),    nextFollowup: null },
    ];
    const { result } = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(result.current.todaysSnapshot.partnersOverdue).toBe(1);
  });
});

describe("useDashboardData / date-range scoping", () => {
  // Flow metrics (activities, activities-to-win) honor the range; stock
  // metrics (open pipeline) do not.
  const NARROW: DateRange = {
    fromIso: "2026-06-20T00:00:00.000Z",
    toIso: "2026-06-25T00:00:00.000Z",
  };

  beforeEach(() => {
    dealsData = [
      deal("open", "qualified", 100_00, 50),
      // Won inside the narrow window (updatedAt is the won-date proxy).
      deal("won", "won", 500_00, 100, "", "2026-06-23T10:00:00.000Z"),
    ];
    activitiesData = [
      activity("open", null, "2026-06-22T10:00:00.000Z"), // inside NARROW
      activity("open", null, "2026-01-01T10:00:00.000Z"), // outside NARROW
    ];
  });

  it("totalActivities counts only activities inside the range", () => {
    const narrow = renderHook(() => useDashboardData(NARROW), { wrapper });
    expect(narrow.result.current.totalActivities).toBe(1);

    const all = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(all.result.current.totalActivities).toBe(2);
  });

  it("activitiesToWin re-scopes its ratio to the range", () => {
    const narrow = renderHook(() => useDashboardData(NARROW), { wrapper });
    // 1 in-range activity ÷ 1 in-range win = 1.0
    expect(narrow.result.current.activitiesToWin).toEqual({
      ratio: 1,
      totalActivities: 1,
      wonDealsCount: 1,
    });

    const all = renderHook(() => useDashboardData(ALL), { wrapper });
    // 2 activities ÷ 1 win = 2.0
    expect(all.result.current.activitiesToWin.ratio).toBe(2);
  });

  it("stock metrics (open pipeline) are identical regardless of range", () => {
    const narrow = renderHook(() => useDashboardData(NARROW), { wrapper });
    const all = renderHook(() => useDashboardData(ALL), { wrapper });
    expect(narrow.result.current.kpis.pipelineValueCents).toBe(100_00);
    expect(all.result.current.kpis.pipelineValueCents).toBe(100_00);
  });
});
