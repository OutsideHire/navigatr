# Persistence Index — Detail Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the "underlying details" to the Persistence Index detail page: sub-component breakdown, benchmark reference lines + legend, and a stats grid. Frontend-only, no backend.

**Tech Stack:** React + TS, Tailwind tokens, vitest + @testing-library/react. Pure engine in `lib/persistenceIndex.ts`.

**Spec:** `docs/superpowers/specs/2026-07-24-persistence-index-detail-design.md`

**Verified shapes (do not change):**
- `PersistenceIndexResult = { composite:number|null, followUp:{points,max,hasSample,completionRate,dueCount}, cadence:{points,max,hasSample,medianTouchesPerWeek,activeDeals}, responseVelocity:{comingSoon:true}, windowDays, targetScore }`.
- `TeamPersistenceIndexResult = { composite, followUp:{points:number|null,max}, cadence:{points:number|null,max}, ... }`.
- `PerRepScore = { ownerId, composite:number|null, followUpPoints:number|null, cadencePoints:number|null }` (already carries sub-component points).
- `PersistencePoint = { date, composite:number|null, activityCount }`.
- Consts: `FOLLOWUP_MAX=40`, `CADENCE_MAX=30`, `TARGET_SCORE=75`. Helpers `median`, `mean`, `percentile` (return `number|null`).
- Hooks: `usePersistenceIndex()→PersistenceIndexResult|null` (viewer own), `useTeamPersistenceIndex()→TeamPersistenceIndexResult`, `usePersistenceHistory(rangeDays, targetOwnerId?)→PersistencePoint[]`, `usePerRepPersistence()→PerRepScore[]` (RLS-scoped; for a rep this is just themselves → 1 row).
- Current page: `pages/PersistenceIndexReport.tsx` has inline `TrendChart`, `VolumeChart`, `RepRoster`; state `rangeKey`, `selectedRep`; `role` via `useProfile().data?.role`; `isManager = role==="manager"||role==="admin"`.

---

## Task 1: Detail pure functions (benchmarks, peer averages, stats, labels)

**Files:**
- Modify: `apps/app/src/features/dashboard/lib/persistenceIndex.ts` (append a "Detail (Slice 5)" section)
- Test: `apps/app/src/features/dashboard/lib/persistenceIndex.detail.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
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
  ({ ownerId: "x", composite, followUpPoints: fu, cadencePoints: cad });

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
    // follow-up median of [40,20]=30 → 30/40=75%; cadence median of [30,15]=22.5 → /30≈75%
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
    expect(s.dailyActivityAvg).toBe(4); // (4+0+8)/3 = 4
    expect(s.daysAboveAvg).toBe(1); // only 76 > 70
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
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter app test -- persistenceIndex.detail` → FAIL (exports missing).

- [ ] **Step 3: Implement (append to `lib/persistenceIndex.ts`)**

```ts
// ── Detail display (Slice 5) ─────────────────────────────────────────────

export type BenchmarkStrategy = "full" | "top-performer" | "small" | "solo";

export interface BenchmarkResult {
  repCount: number;
  peerAvg: number | null;
  topDecile: number | null;
  topPerformer: number | null;
  strategy: BenchmarkStrategy;
}

/**
 * Peer benchmarks across scored reps, with §3.3.B.9 small-tenant degradation:
 * 10+ reps → average + top decile; 5-9 → average + top performer; 2-4 →
 * average only (small sample); <=1 → solo (no peer benchmarks).
 */
export function persistenceBenchmarks(composites: (number | null)[]): BenchmarkResult {
  const scored = composites.filter((c): c is number => c != null);
  const n = scored.length;
  if (n <= 1) {
    return { repCount: n, peerAvg: null, topDecile: null, topPerformer: null, strategy: "solo" };
  }
  const peerAvg = Math.round(median(scored) as number);
  if (n >= 10) {
    return { repCount: n, peerAvg, topDecile: Math.round(percentile(scored, 0.9) as number), topPerformer: null, strategy: "full" };
  }
  if (n >= 5) {
    return { repCount: n, peerAvg, topDecile: null, topPerformer: Math.round(Math.max(...scored)), strategy: "top-performer" };
  }
  return { repCount: n, peerAvg, topDecile: null, topPerformer: null, strategy: "small" };
}

export interface SubComponentPeerAverages {
  followUpAvgPct: number | null; // 0-100, median follow-up points as % of FOLLOWUP_MAX
  cadenceAvgPct: number | null;  // 0-100, median cadence points as % of CADENCE_MAX
  repCount: number;
}

/** Median sub-component points across reps, expressed as a % of each max, for the bar ticks. */
export function subComponentPeerAverages(rows: PerRepScore[]): SubComponentPeerAverages {
  const fu = rows.map((r) => r.followUpPoints).filter((p): p is number => p != null);
  const cad = rows.map((r) => r.cadencePoints).filter((p): p is number => p != null);
  return {
    followUpAvgPct: fu.length ? Math.round(((median(fu) as number) / FOLLOWUP_MAX) * 100) : null,
    cadenceAvgPct: cad.length ? Math.round(((median(cad) as number) / CADENCE_MAX) * 100) : null,
    repCount: rows.filter((r) => r.composite != null).length,
  };
}

export interface PersistenceStats {
  high: number | null;
  low: number | null;
  periodAvg: number | null;
  dailyActivityAvg: number;
  daysAboveAvg: number | null;
  scoredDays: number;
}

/** Period stats from the daily history: index high/low/avg, daily activity avg, days above peer average. */
export function persistenceStats(points: PersistencePoint[], peerAvg: number | null): PersistenceStats {
  const scored = points.filter((p) => p.composite != null).map((p) => p.composite as number);
  const dailyActivityAvg = points.length
    ? Math.round((points.reduce((s, p) => s + p.activityCount, 0) / points.length) * 10) / 10
    : 0;
  return {
    high: scored.length ? Math.max(...scored) : null,
    low: scored.length ? Math.min(...scored) : null,
    periodAvg: scored.length ? Math.round(mean(scored) as number) : null,
    dailyActivityAvg,
    daysAboveAvg: peerAvg != null && scored.length ? scored.filter((c) => c > peerAvg).length : null,
    scoredDays: scored.length,
  };
}

/** Peer-average label by viewer scope. Admin sees the whole org; managers see their team. */
export function benchmarkAvgLabel(role: string | undefined): string {
  return role === "admin" ? "Company average" : "Team average";
}
```

- [ ] **Step 4: Run, verify pass**; `pnpm --filter app test -- persistenceIndex` (all persistence tests) + `pnpm --filter app typecheck`.

- [ ] **Step 5: Commit** `feat(persistence): detail pure functions (benchmarks, peer averages, stats)`.

---

## Task 2: Benchmarks hook

**Files:**
- Create: `apps/app/src/features/dashboard/hooks/usePersistenceBenchmarks.ts`
- Test: `apps/app/src/features/dashboard/hooks/usePersistenceBenchmarks.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePersistenceBenchmarks } from "./usePersistenceBenchmarks";

let mockRows: any[] = [];
let mockRole: string | undefined = "manager";
vi.mock("./usePerRepPersistence", () => ({ usePerRepPersistence: () => mockRows }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role: mockRole } }) }));

describe("usePersistenceBenchmarks", () => {
  it("derives benchmarks, peer sub-component averages, and a scope label", () => {
    mockRows = [
      { ownerId: "a", composite: 60, followUpPoints: 20, cadencePoints: 15 },
      { ownerId: "b", composite: 80, followUpPoints: 40, cadencePoints: 30 },
    ];
    mockRole = "manager";
    const { result } = renderHook(() => usePersistenceBenchmarks());
    expect(result.current.peerAvg).toBe(70);
    expect(result.current.strategy).toBe("small");
    expect(result.current.followUpAvgPct).toBe(75);
    expect(result.current.avgLabel).toBe("Team average");
  });
  it("solo for a single rep (rep scope)", () => {
    mockRows = [{ ownerId: "a", composite: 70, followUpPoints: 30, cadencePoints: 20 }];
    const { result } = renderHook(() => usePersistenceBenchmarks());
    expect(result.current.strategy).toBe("solo");
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
/**
 * usePersistenceBenchmarks — peer benchmarks + sub-component peer averages for
 * the Persistence Index detail page, computed client-side across the reps the
 * viewer can see (RLS-scoped via usePerRepPersistence). A rep sees only
 * themselves → "solo" (no peer benchmark); managers/admins get team/company
 * benchmarks. True tenant-wide server benchmarks are a later slice.
 */
import * as React from "react";
import { useProfile } from "@/features/auth/useProfile";
import { usePerRepPersistence } from "./usePerRepPersistence";
import {
  persistenceBenchmarks,
  subComponentPeerAverages,
  benchmarkAvgLabel,
  type BenchmarkResult,
} from "../lib/persistenceIndex";

export interface PersistenceBenchmarks extends BenchmarkResult {
  followUpAvgPct: number | null;
  cadenceAvgPct: number | null;
  avgLabel: string;
}

export function usePersistenceBenchmarks(): PersistenceBenchmarks {
  const rows = usePerRepPersistence();
  const role = useProfile().data?.role;
  return React.useMemo(() => {
    const base = persistenceBenchmarks(rows.map((r) => r.composite));
    const sub = subComponentPeerAverages(rows);
    return { ...base, followUpAvgPct: sub.followUpAvgPct, cadenceAvgPct: sub.cadenceAvgPct, avgLabel: benchmarkAvgLabel(role) };
  }, [rows, role]);
}
```

- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** `feat(persistence): usePersistenceBenchmarks hook`.

---

## Task 3: Sub-component breakdown component

**Files:**
- Create: `apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx`
- Test: `apps/app/src/features/dashboard/components/PersistenceSubComponents.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceSubComponents } from "./PersistenceSubComponents";

describe("PersistenceSubComponents", () => {
  it("renders follow-up and cadence with points and a coming-soon response velocity row", () => {
    render(
      <PersistenceSubComponents
        followUpPoints={32}
        cadencePoints={20}
        peerFollowUpPct={61}
        peerCadencePct={70}
      />,
    );
    expect(screen.getByText("Follow-up discipline")).toBeInTheDocument();
    expect(screen.getByText("32 / 40 · 80%")).toBeInTheDocument();
    expect(screen.getByText("Touch cadence")).toBeInTheDocument();
    expect(screen.getByText("20 / 30 · 67%")).toBeInTheDocument();
    expect(screen.getByText("Response velocity")).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
  });
  it("shows an insufficient-data caption when a component has no sample", () => {
    render(<PersistenceSubComponents followUpPoints={null} cadencePoints={null} peerFollowUpPct={null} peerCadencePct={null} />);
    expect(screen.getAllByText(/Not enough data/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```tsx
/**
 * PersistenceSubComponents — the "where your score comes from" breakdown for
 * the Persistence Index detail page. Three rows: Follow-Up Discipline and
 * Touch Cadence (real, with a peer-average tick), plus Response Velocity shown
 * as a labeled "coming soon" row (it needs the deferred inbound-capture system,
 * so it never contributes points today).
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { FOLLOWUP_MAX, CADENCE_MAX } from "../lib/persistenceIndex";

function Row({
  label, points, max, peerPct,
}: {
  label: string; points: number | null; max: number; peerPct: number | null;
}) {
  if (points == null) {
    return (
      <div>
        <div className="mb-1 flex justify-between text-body-sm">
          <span className="text-text-default">{label}</span>
        </div>
        <p className="text-caption text-text-subtle">Not enough data in this window yet.</p>
      </div>
    );
  }
  const pct = Math.round((points / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-body-sm">
        <span className="text-text-default">{label}</span>
        <span className="text-text-muted tabular-nums">{points} / {max} · {pct}%</span>
      </div>
      <div className="relative h-2 rounded-radius-full bg-surface-sunken">
        <div className="absolute inset-y-0 left-0 rounded-radius-full bg-brand-primary" style={{ width: `${pct}%` }} />
        {peerPct != null && (
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-muted"
            style={{ left: `${Math.min(100, Math.max(0, peerPct))}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export function PersistenceSubComponents({
  followUpPoints, cadencePoints, peerFollowUpPct, peerCadencePct,
}: {
  followUpPoints: number | null;
  cadencePoints: number | null;
  peerFollowUpPct: number | null;
  peerCadencePct: number | null;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-4">
        <span className="text-body-sm font-medium text-text-default">Where your score comes from</span>
        <Row label="Follow-up discipline" points={followUpPoints} max={FOLLOWUP_MAX} peerPct={peerFollowUpPct} />
        <div className={cn("opacity-60")}>
          <div className="mb-1 flex items-center gap-2 text-body-sm">
            <span className="text-text-default">Response velocity</span>
            <span className="rounded-radius-full border border-border-subtle px-2 py-0.5 text-caption text-text-muted">Coming soon</span>
            <span className="text-caption text-text-muted">needs inbound capture</span>
          </div>
          <div className="h-2 rounded-radius-full bg-surface-sunken" aria-hidden />
        </div>
        <Row label="Touch cadence" points={cadencePoints} max={CADENCE_MAX} peerPct={peerCadencePct} />
        <p className="text-caption text-text-subtle">
          Score currently reflects the 2 components we can measure today; response velocity joins once inbound capture ships.
        </p>
      </div>
    </Card>
  );
}

export default PersistenceSubComponents;
```

- [ ] **Step 4: Run, verify pass (2/2); typecheck.**
- [ ] **Step 5: Commit** `feat(persistence): sub-component breakdown card`.

---

## Task 4: Stats grid + benchmark lines/legend + wire into the page

**Files:**
- Create: `apps/app/src/features/dashboard/components/PersistenceStatsGrid.tsx` (+ test)
- Modify: `apps/app/src/features/dashboard/pages/PersistenceIndexReport.tsx`

- [ ] **Step 1: Stats grid test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceStatsGrid } from "./PersistenceStatsGrid";

const stats = { high: 76, low: 64, periodAvg: 70, dailyActivityAvg: 5.2, daysAboveAvg: 18, scoredDays: 30 };

describe("PersistenceStatsGrid", () => {
  it("shows index + activity stats always", () => {
    render(<PersistenceStatsGrid stats={stats} peerAvg={61} topLabel="Top 10%" topValue={84} showBenchmarks />);
    expect(screen.getByText("76 / 64")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("5.2")).toBeInTheDocument();
  });
  it("hides benchmark cells when showBenchmarks is false (rep scope)", () => {
    render(<PersistenceStatsGrid stats={{ ...stats, daysAboveAvg: null }} peerAvg={null} topLabel="Top 10%" topValue={null} showBenchmarks={false} />);
    expect(screen.queryByText("Peer average")).not.toBeInTheDocument();
    expect(screen.queryByText("Days above average")).not.toBeInTheDocument();
    // "Period average" (index movement, not a benchmark) still shows.
    expect(screen.getByText("Period average")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `PersistenceStatsGrid.tsx`**

```tsx
/**
 * PersistenceStatsGrid — the "this period" stats for the Persistence Index
 * detail page. Index movement + activity always shown; benchmark cells only
 * when peer benchmarks are available (manager/admin scope). Cells with no
 * value are omitted rather than fabricated.
 */
import { Card } from "@/components/navigatr";
import type { PersistenceStats } from "../lib/persistenceIndex";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption text-text-muted">{label}</div>
      <div className="text-body-md tabular-nums text-text-default">{value}</div>
    </div>
  );
}

export function PersistenceStatsGrid({
  stats, peerAvg, topLabel, topValue, showBenchmarks,
}: {
  stats: PersistenceStats;
  peerAvg: number | null;
  topLabel: string;
  topValue: number | null;
  showBenchmarks: boolean;
}) {
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-3">
        <span className="text-body-sm font-medium text-text-default">This period</span>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {stats.high != null && stats.low != null && <Stat label="High / Low" value={`${stats.high} / ${stats.low}`} />}
          {stats.periodAvg != null && <Stat label="Period average" value={String(stats.periodAvg)} />}
          <Stat label="Daily activity avg" value={String(stats.dailyActivityAvg)} />
          {showBenchmarks && stats.daysAboveAvg != null && <Stat label="Days above average" value={`${stats.daysAboveAvg} / ${stats.scoredDays}`} />}
          {showBenchmarks && peerAvg != null && <Stat label="Peer average" value={String(peerAvg)} />}
          {showBenchmarks && topValue != null && <Stat label={topLabel} value={String(topValue)} />}
        </div>
        {showBenchmarks && stats.periodAvg != null && (
          <p className="text-caption text-text-subtle">Benchmarks are computed across the reps you can see.</p>
        )}
      </div>
    </Card>
  );
}

export default PersistenceStatsGrid;
```

- [ ] **Step 3: Wire the page** (`PersistenceIndexReport.tsx`)

Refactor the inline `TrendChart` to accept configurable reference lines and an area fill, and thread benchmarks through. Concretely:

(a) Change `TrendChart` signature to `{ points, referenceLines }` where `referenceLines: { value:number; label:string }[]`, render each as a dashed horizontal line (keep the existing dashed style), and add an area-fill `<path>` under the rep line (build the same segment path plus a baseline close, fill `text-brand-primary`/`fill-current` at low opacity). Support 1-3 lines (map over the array; never hardcode).

(b) In `PersistenceIndexReport`, add:
```tsx
import { usePersistenceBenchmarks } from "../hooks/usePersistenceBenchmarks";
import { usePersistenceIndex } from "../hooks/usePersistenceIndex";
import { useTeamPersistenceIndex } from "../hooks/useTeamPersistenceIndex";
import { persistenceStats } from "../lib/persistenceIndex";
import { PersistenceSubComponents } from "../components/PersistenceSubComponents";
import { PersistenceStatsGrid } from "../components/PersistenceStatsGrid";
```
Compute the current-view sub-component points:
```tsx
  const own = usePersistenceIndex();
  const team = useTeamPersistenceIndex();
  const bench = usePersistenceBenchmarks();
  // roster already available as `roster` (usePerRepPersistence)
  const selectedRow = selectedRep ? roster.find((r) => r.ownerId === selectedRep) ?? null : null;
  const subFollowUp = selectedRep ? (selectedRow?.followUpPoints ?? null) : isManager ? team.followUp.points : (own?.followUp.hasSample ? own.followUp.points : null);
  const subCadence  = selectedRep ? (selectedRow?.cadencePoints ?? null) : isManager ? team.cadence.points : (own?.cadence.hasSample ? own.cadence.points : null);

  const showBenchmarks = bench.strategy !== "solo";
  const topLabel = bench.strategy === "top-performer" ? "Top performer" : "Top 10%";
  const topValue = bench.topDecile ?? bench.topPerformer;
  const referenceLines = showBenchmarks
    ? [{ value: bench.peerAvg as number, label: bench.avgLabel }, ...(topValue != null ? [{ value: topValue, label: topLabel }] : [])]
    : [{ value: TARGET_SCORE, label: "Target" }];
  const stats = persistenceStats(points, bench.peerAvg);
```
Pass `referenceLines` to `TrendChart` (replacing the single target line). Below the existing score/chart card, render (when `current != null`):
```tsx
  <PersistenceSubComponents
    followUpPoints={subFollowUp}
    cadencePoints={subCadence}
    peerFollowUpPct={showBenchmarks ? bench.followUpAvgPct : null}
    peerCadencePct={showBenchmarks ? bench.cadenceAvgPct : null}
  />
  <PersistenceStatsGrid stats={stats} peerAvg={bench.peerAvg} topLabel={topLabel} topValue={topValue} showBenchmarks={showBenchmarks} />
```
Add a benchmark legend row under the chart (only when `showBenchmarks`): "You / {bench.avgLabel} {peerAvg} / {topLabel} {topValue}" with small color dots (brand for You, muted for the reference lines). Keep the existing volume chart, range pills, delta, and manager roster exactly as they are. `useTeamPersistenceIndex`/`usePersistenceIndex` are safe to call unconditionally (hooks rules).

- [ ] **Step 4: Update the existing page test** `PersistenceIndexReport.test.tsx` if it asserts on the old single-target-line chart; add assertions that the sub-component card ("Where your score comes from") and stats grid ("This period") render for a populated view. Do not weaken existing assertions; adjust only what legitimately changed.

- [ ] **Step 5: Run** `pnpm --filter app test -- Persistence` and `pnpm --filter app typecheck`; fix until green.

- [ ] **Step 6: Commit** `feat(persistence): stats grid, benchmark lines/legend, sub-component breakdown on detail page`.

---

## Task 5: Full suite + typecheck + ship

- [ ] **Step 1:** `pnpm --filter app typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter app test` → all pass; no existing persistence/dashboard tests broken.
- [ ] **Step 3:** Push to main: `git push origin HEAD:main` (frontend-only).
- [ ] **Step 4: Visual check** (after deploy) on the demo org: open the widget → detail page shows the three sub-component rows (with the Response Velocity "coming soon" row and peer ticks), benchmark reference lines + legend on the chart, and the "this period" stats grid; a rep sees the target line + no peer cells; a manager/admin sees team/company benchmarks; the manager "by rep" drill still works.
