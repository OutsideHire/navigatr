import { describe, it, expect } from "vitest";
import {
  persistenceBenchmarks,
  subComponentPeerAverages,
  persistenceStats,
  benchmarkAvgLabel,
  type PersistenceStats,
} from "./persistenceIndex";
import type { PerRepScore, PersistencePoint } from "./persistenceIndex";

const rep = (composite: number | null, fu: number | null = null, cad: number | null = null): PerRepScore =>
  ({ ownerId: "x", composite, followUpPoints: fu, cadencePoints: cad, reEngagementPoints: null, followUpBelowFloor: false });

describe("persistenceBenchmarks", () => {
  it("solo (<=1 scored rep) yields no peer benchmarks", () => {
    expect(persistenceBenchmarks([70]).strategy).toBe("solo");
    expect(persistenceBenchmarks([]).strategy).toBe("solo");
    expect(persistenceBenchmarks([70]).peerAvg).toBeNull();
  });
  it("2-4 reps: average only, small-sample strategy", () => {
    const b = persistenceBenchmarks([60, 80, 70]);
    expect(b.strategy).toBe("small");
    expect(b.peerAvg).toBe(70);
    expect(b.topDecile).toBeNull();
    expect(b.topPerformer).toBeNull();
  });
  it("5-9 reps: average + top performer, no decile", () => {
    const b = persistenceBenchmarks([50, 60, 70, 80, 90]);
    expect(b.strategy).toBe("top-performer");
    expect(b.peerAvg).toBe(70);
    expect(b.topPerformer).toBe(90);
    expect(b.topDecile).toBeNull();
  });
  it("10+ reps: average + top decile", () => {
    const b = persistenceBenchmarks([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(b.strategy).toBe("full");
    expect(b.peerAvg).toBe(55);
    expect(typeof b.topDecile).toBe("number");
  });
  it("ignores null composites", () => {
    expect(persistenceBenchmarks([70, null, 80]).repCount).toBe(2);
  });
});

describe("subComponentPeerAverages", () => {
  it("medians follow-up and cadence points as percentages of their maxes", () => {
    const r = subComponentPeerAverages([rep(70, 40, 30), rep(60, 20, 15), rep(null, null, null)]);
    expect(r.followUpAvgPct).toBe(75);
    expect(r.cadenceAvgPct).toBe(75);
    expect(r.repCount).toBe(2);
  });
  it("null when no rep has a sample for a component", () => {
    expect(subComponentPeerAverages([rep(70, null, null)]).followUpAvgPct).toBeNull();
  });
});

describe("persistenceStats", () => {
  const pts: PersistencePoint[] = [
    { date: "2026-07-01", composite: 64, activityCount: 4 },
    { date: "2026-07-02", composite: null, activityCount: 0 },
    { date: "2026-07-03", composite: 76, activityCount: 8 },
  ];
  it("computes high/low/avg, daily activity avg, and days above peer", () => {
    const s: PersistenceStats = persistenceStats(pts, 70);
    expect(s.high).toBe(76);
    expect(s.low).toBe(64);
    expect(s.periodAvg).toBe(70);
    expect(s.dailyActivityAvg).toBe(4);
    expect(s.daysAboveAvg).toBe(1);
    expect(s.scoredDays).toBe(2);
  });
  it("daysAboveAvg null when no peer average", () => {
    expect(persistenceStats(pts, null).daysAboveAvg).toBeNull();
  });
});

describe("benchmarkAvgLabel", () => {
  it("labels by scope", () => {
    expect(benchmarkAvgLabel("admin")).toBe("Company average");
    expect(benchmarkAvgLabel("manager")).toBe("Team average");
  });
});
