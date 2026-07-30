import { describe, it, expect } from "vitest";
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import { computeLeadSourcePerformance } from "./leadSourcePerformance";

const NOW = new Date("2026-07-01T00:00:00Z");

function deal(o: {
  id: string; source: string; stage: DealStage; valueCents: number; createdAt: string;
  closedWonAt?: string; days?: number; owner?: string;
}): Deal {
  return {
    id: o.id,
    leadSource: o.source,
    stage: o.stage,
    valueCents: o.valueCents,
    createdAt: o.createdAt,
    closedWonAt: o.closedWonAt ?? null,
    timeToWinCalendarDays: o.days ?? null,
    owner_id: o.owner ?? "u1",
  } as unknown as Deal;
}
function act(id: string, dealId: string, occurredAt: string, type: ActivityType = "call"): Activity {
  return { id, dealId, type, occurredAt } as unknown as Activity;
}

const DEALS: Deal[] = [
  deal({ id: "d1", source: "path", stage: "won", valueCents: 120_000, createdAt: "2026-06-01T00:00:00Z", closedWonAt: "2026-06-20T00:00:00Z", days: 19, owner: "u1" }),
  deal({ id: "d2", source: "path", stage: "qualified", valueCents: 80_000, createdAt: "2026-06-05T00:00:00Z", owner: "u1" }),
  deal({ id: "d3", source: "self_sourced_canvass", stage: "new", valueCents: 50_000, createdAt: "2026-06-10T00:00:00Z", owner: "u2" }),
  deal({ id: "d4", source: "inbound", stage: "won", valueCents: 60_000, createdAt: "2026-06-02T00:00:00Z", closedWonAt: "2026-06-10T00:00:00Z", days: 8, owner: "u2" }),
  deal({ id: "d5", source: "assigned", stage: "contacted", valueCents: 90_000, createdAt: "2026-06-03T00:00:00Z", owner: "u1" }),
  deal({ id: "d6", source: "unknown", stage: "new", valueCents: 30_000, createdAt: "2026-06-04T00:00:00Z", owner: "u2" }),
  // Prior-window won Path deal, for the trend baseline.
  deal({ id: "d7", source: "path", stage: "won", valueCents: 120_000, createdAt: "2026-02-01T00:00:00Z", closedWonAt: "2026-02-20T00:00:00Z", days: 19, owner: "u1" }),
];
const ACTS: Activity[] = [
  act("a1", "d1", "2026-06-05T00:00:00Z"),
  act("a2", "d1", "2026-06-10T00:00:00Z"),
  act("a3", "d1", "2026-06-15T00:00:00Z"),
  act("a4", "d4", "2026-06-03T00:00:00Z"),
  act("a5", "d4", "2026-06-05T00:00:00Z"),
];

describe("computeLeadSourcePerformance (created basis, all scope)", () => {
  const perf = computeLeadSourcePerformance(DEALS, ACTS, { now: NOW, windowDays: 90, basis: "created", scope: "all" });
  const bySource = Object.fromEntries(perf.rows.map((r) => [r.source, r]));

  it("computes the Path row (leads/won/win rate/MRR=value/12/yield/touches/days/trend)", () => {
    const p = bySource.path!;
    expect(p.leads).toBe(2);
    expect(p.won).toBe(1);
    expect(p.winRate).toBeCloseTo(50, 5);
    expect(p.mrrWonCents).toBe(10_000); // 120000 / 12
    expect(p.yieldCents).toBe(5_000); // 10000 / 2 leads
    expect(p.touchesToWin).toBe(3);
    expect(p.daysToClose).toBe(19);
    expect(p.trendPct).toBe(-50); // prior window yield 10000 -> 5000
  });

  it("computes the Inbound row", () => {
    const i = bySource.inbound!;
    expect(i.leads).toBe(1);
    expect(i.won).toBe(1);
    expect(i.touchesToWin).toBe(2);
    expect(i.daysToClose).toBe(8);
  });

  it("includes Assigned + Unknown in the all scope", () => {
    expect(bySource.assigned).toBeTruthy();
    expect(bySource.unknown).toBeTruthy();
    expect(perf.rows).toHaveLength(5);
  });

  it("blends the totals", () => {
    expect(perf.totals.leads).toBe(6);
    expect(perf.totals.won).toBe(2);
    expect(perf.totals.mrrWonCents).toBe(15_000);
    expect(perf.totals.yieldCents).toBe(2_500);
  });

  it("flags Inbound present, all-scope on, not mixed basis", () => {
    expect(perf.flags.hasInbound).toBe(true);
    expect(perf.flags.allScope).toBe(true);
    expect(perf.flags.mixedBasis).toBe(false);
  });
});

describe("scope + basis controls", () => {
  it("rep scope hides Assigned, Import, and Unknown", () => {
    const perf = computeLeadSourcePerformance(DEALS, ACTS, { now: NOW, windowDays: 90, basis: "created", scope: "rep" });
    const sources = perf.rows.map((r) => r.source);
    expect(sources).not.toContain("assigned");
    expect(sources).not.toContain("unknown");
    expect(sources).toEqual(expect.arrayContaining(["path", "inbound", "self_sourced_canvass"]));
  });

  it("won basis sets the mixed-cohort flag", () => {
    const perf = computeLeadSourcePerformance(DEALS, ACTS, { now: NOW, windowDays: 90, basis: "won", scope: "all" });
    expect(perf.flags.mixedBasis).toBe(true);
  });

  it("role scoping is the caller's job: filtering deals to one owner narrows the rows", () => {
    const own = DEALS.filter((d) => d.owner_id === "u2");
    const perf = computeLeadSourcePerformance(own, ACTS, { now: NOW, windowDays: 90, basis: "created", scope: "all" });
    // u2 owns canvass (d3), inbound (d4), unknown (d6) — no Path.
    expect(perf.rows.map((r) => r.source)).not.toContain("path");
    expect(perf.rows.map((r) => r.source)).toEqual(expect.arrayContaining(["inbound", "self_sourced_canvass"]));
  });
});
