# Unified Activity Performance Report — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Consolidate the two activity reports into one "Activity performance" report driven by an outcome scope (All/Won/Lost/Open), reusing the existing engines. Frontend-only, no migration.

**Spec:** `docs/superpowers/specs/2026-07-24-unified-activity-report-phase1-design.md`

**Tech Stack:** React + TS, Tailwind tokens, vitest + @testing-library/react.

**Verified shapes (reuse, do not change):**
- `Deal` (`@/features/pipeline/mockData`): `{ id, companyName, owner_id: string|null, valueCents: number, stage: DealStage, ... }`. `DealStage` includes `"won"` and `"lost"`.
- `Activity` (`@/features/activities/mockData`): `{ dealId, type: ActivityType ("call"|"email"|"drop_in"|"appointment"), occurredAt: string, ... }`.
- `repCompanyActivity.ts`: `RcaCounts = Record<"call"|"email"|"drop_in"|"appointment"|"total", number>`, `emptyCounts()`, `RCA_TYPES`. Reuse these.
- `dateRange.ts`: `withinRange(iso, range)`, `type DateRange`, `resolveRange(key, now)`, `type RangeKey`.
- `activityToWin.ts`: `computeActivityToWin(deals, {range, filters?})`, `computeActivityToLost(deals, {range, filters?})`, `median`, `mean`, `formatBandUsd`. (Used only for won/lost value + days figures in the metric strip.)
- `repCompanyCsv.ts`: `escapeCsvCell` (formula-injection-safe). Reuse it.
- Current report page `pages/ActivityToWinReport.tsx` (route `/dashboard/activity-to-win`) — will be rebuilt. It has reusable patterns: gradient header, time-range pills (`REPORT_RANGES`), `ACCENT`/`TYPE_META` maps, `downloadCsv`, RLS role handling (`isManagerish`, `repName`, `useOrgMemberNames`).
- Current `pages/ActivitiesByRepCompanyReport.tsx` (route `/dashboard/activities-by-rep`) — will be removed.

---

## Task 1: Outcome attribution + allocation band (pure)

**Files:** Create `lib/unifiedActivityReport.ts` + `lib/unifiedActivityReport.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import type { Activity } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import { classifyDealOutcome, attributeActivitiesWithOutcome, outcomeBand, reconciliation } from "./unifiedActivityReport";

const range = { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T00:00:00.000Z" };
const deal = (id: string, owner_id: string | null, companyName: string, stage: string, valueCents = 0): Deal =>
  ({ id, owner_id, companyName, stage, valueCents } as Deal);
const act = (dealId: string, type: Activity["type"], occurredAt: string): Activity =>
  ({ id: `${dealId}-${type}-${occurredAt}`, dealId, type, occurredAt } as Activity);

const deals = [deal("w", "u1", "Acme", "won", 100), deal("l", "u1", "Beta", "lost"), deal("o", "u2", "Acme", "proposal")];

describe("classifyDealOutcome", () => {
  it("maps stage to outcome", () => {
    expect(classifyDealOutcome("won")).toBe("won");
    expect(classifyDealOutcome("lost")).toBe("lost");
    expect(classifyDealOutcome("proposal")).toBe("open");
    expect(classifyDealOutcome("new")).toBe("open");
  });
});

describe("attributeActivitiesWithOutcome", () => {
  it("tags each in-window activity with its deal outcome, owner, company; skips unmatched + out-of-window", () => {
    const acts = [
      act("w", "call", "2026-03-01T00:00:00.000Z"),
      act("l", "email", "2026-03-02T00:00:00.000Z"),
      act("o", "drop_in", "2026-03-03T00:00:00.000Z"),
      act("w", "call", "2020-01-01T00:00:00.000Z"), // out of window
      act("missing", "call", "2026-03-01T00:00:00.000Z"), // no deal
    ];
    const rows = attributeActivitiesWithOutcome(acts, deals, range);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.type === "call")!.outcome).toBe("won");
    expect(rows.find((r) => r.type === "email")!.outcome).toBe("lost");
    expect(rows.find((r) => r.type === "drop_in")!.outcome).toBe("open");
  });
});

describe("outcomeBand + reconciliation", () => {
  const rows = attributeActivitiesWithOutcome(
    [act("w", "call", "2026-03-01T00:00:00.000Z"), act("w", "email", "2026-03-02T00:00:00.000Z"), act("l", "call", "2026-03-03T00:00:00.000Z"), act("o", "call", "2026-03-04T00:00:00.000Z")],
    deals, range,
  );
  it("counts activities by outcome and totals", () => {
    const b = outcomeBand(rows);
    expect(b).toEqual({ won: 2, lost: 1, open: 1, total: 4 });
  });
  it("reconciliation splits won vs open-or-lost, unattached always 0", () => {
    expect(reconciliation(outcomeBand(rows))).toEqual({ total: 4, won: 2, openLost: 2, unattached: 0 });
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
/**
 * Unified Activity Performance report (Phase 1): classifies each logged
 * activity by its deal's outcome (won/lost/open) so one report can re-read the
 * rep -> company -> activity structure through an outcome scope. All counts
 * derive from the activities table (activity-date window) joined to their deal,
 * so the allocation band, rep table, and reconciliation footer always tie.
 * Close-date anchoring for won/lost is a Phase 2 correction.
 */
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";
import { emptyCounts, type RcaCounts } from "./repCompanyActivity";

export type Outcome = "won" | "lost" | "open";
export type ReportScope = "all" | Outcome;

export function classifyDealOutcome(stage: DealStage): Outcome {
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return "open";
}

export interface OutcomeActivity {
  ownerId: string | null;
  companyName: string;
  type: ActivityType;
  outcome: Outcome;
}

/** In-window activities joined to their deal's owner/company/outcome. Skips activities whose deal isn't visible. */
export function attributeActivitiesWithOutcome(activities: Activity[], deals: Deal[], range: DateRange): OutcomeActivity[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const out: OutcomeActivity[] = [];
  for (const a of activities) {
    if (!withinRange(a.occurredAt, range)) continue;
    const deal = byId.get(a.dealId);
    if (!deal) continue;
    out.push({ ownerId: deal.owner_id, companyName: deal.companyName, type: a.type, outcome: classifyDealOutcome(deal.stage) });
  }
  return out;
}

export interface OutcomeBand { won: number; lost: number; open: number; total: number; }

export function outcomeBand(rows: OutcomeActivity[]): OutcomeBand {
  const b: OutcomeBand = { won: 0, lost: 0, open: 0, total: 0 };
  for (const r of rows) { b[r.outcome] += 1; b.total += 1; }
  return b;
}

export interface Reconciliation { total: number; won: number; openLost: number; unattached: 0; }

export function reconciliation(band: OutcomeBand): Reconciliation {
  return { total: band.total, won: band.won, openLost: band.open + band.lost, unattached: 0 };
}

/** True when an activity belongs in the active scope. "all" accepts everything. */
export function inScope(outcome: Outcome, scope: ReportScope): boolean {
  return scope === "all" || outcome === scope;
}
```

- [ ] **Step 4: Run, verify pass; typecheck. Step 5: Commit** `feat(unified): outcome attribution + allocation band`.

---

## Task 2: Rep -> company rows (scoped) + rank divergence (pure)

**Files:** append to `lib/unifiedActivityReport.ts`; add cases to its test.

- [ ] **Step 1: Failing test (append)**

```ts
import { unifiedRepRows, rankDivergence } from "./unifiedActivityReport";

describe("unifiedRepRows", () => {
  const deals2 = [deal("w1", "u1", "Acme", "won", 20000), deal("w2", "u1", "Beta", "won", 10000), deal("o1", "u2", "Acme", "proposal", 5000)];
  const acts2 = [
    act("w1", "call", "2026-03-01T00:00:00.000Z"), act("w1", "email", "2026-03-02T00:00:00.000Z"),
    act("w2", "call", "2026-03-03T00:00:00.000Z"), act("o1", "call", "2026-03-04T00:00:00.000Z"),
  ];
  it("aggregates rep -> company activity counts + deal columns for the scope", () => {
    const rows = unifiedRepRows(acts2, deals2, range, "won");
    const u1 = rows.find((r) => r.ownerId === "u1")!;
    expect(u1.counts.total).toBe(3);
    expect(u1.companyCount).toBe(2);
    expect(u1.dealCount).toBe(2);
    expect(u1.valueCents).toBe(30000);
    // u2 has only an open deal -> excluded from the "won" scope rep list
    expect(rows.some((r) => r.ownerId === "u2")).toBe(false);
  });
  it("in the all scope every rep with activity appears", () => {
    const rows = unifiedRepRows(acts2, deals2, range, "all");
    expect(rows.map((r) => r.ownerId).sort()).toEqual(["u1", "u2"]);
  });
});

describe("rankDivergence", () => {
  it("flags reps whose effort rank and outcome rank differ by 2+", () => {
    const rows = [
      { ownerId: "a", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 30 }, valueCents: 10 } as any,
      { ownerId: "b", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 20 }, valueCents: 100 } as any,
      { ownerId: "c", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 10 }, valueCents: 50 } as any,
    ];
    const d = rankDivergence(rows);
    // a: effort #1, outcome #3 -> diverges. b: effort #2, outcome #1 -> diff 1. c: effort #3, outcome #2 -> diff 1.
    expect(d.get("a")).toEqual({ effortRank: 1, outcomeRank: 3 });
    expect(d.has("b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement (append)**

```ts
export interface UnifiedRepCompany { companyName: string; counts: RcaCounts; dealCount: number; valueCents: number; }
export interface UnifiedRepRow {
  ownerId: string | null;
  counts: RcaCounts;
  companyCount: number;
  dealCount: number;
  valueCents: number;
  companies: UnifiedRepCompany[];
}

function bump(counts: RcaCounts, type: ActivityType): void { counts[type] += 1; counts.total += 1; }

/**
 * Rep -> company rows for a scope. Activity counts come from the scoped
 * OutcomeActivity rows (so they reconcile with the band); dealCount + valueCents
 * come from the deals of that owner/company in the scope's outcome. In "all"
 * scope, deal columns aggregate won deals (the outcome that carries revenue).
 */
export function unifiedRepRows(activities: Activity[], deals: Deal[], range: DateRange, scope: ReportScope): UnifiedRepRow[] {
  const attributed = attributeActivitiesWithOutcome(activities, deals, range).filter((r) => inScope(r.outcome, scope));

  const dealOutcomeFor = scope === "all" ? "won" : scope;
  const scopedDeals = deals.filter((d) => classifyDealOutcome(d.stage) === dealOutcomeFor);

  const repMap = new Map<string, UnifiedRepRow>();
  const keyOf = (id: string | null) => id ?? "__unassigned__";
  const ensureRep = (ownerId: string | null): UnifiedRepRow => {
    const k = keyOf(ownerId);
    let rep = repMap.get(k);
    if (!rep) { rep = { ownerId, counts: emptyCounts(), companyCount: 0, dealCount: 0, valueCents: 0, companies: [] }; repMap.set(k, rep); }
    return rep;
  };
  const ensureCompany = (rep: UnifiedRepRow, companyName: string): UnifiedRepCompany => {
    let c = rep.companies.find((x) => x.companyName === companyName);
    if (!c) { c = { companyName, counts: emptyCounts(), dealCount: 0, valueCents: 0 }; rep.companies.push(c); }
    return c;
  };

  for (const r of attributed) {
    const rep = ensureRep(r.ownerId);
    const c = ensureCompany(rep, r.companyName);
    bump(c.counts, r.type); bump(rep.counts, r.type);
  }
  for (const d of scopedDeals) {
    const rep = ensureRep(d.owner_id);
    const c = ensureCompany(rep, d.companyName);
    c.dealCount += 1; c.valueCents += d.valueCents; rep.dealCount += 1; rep.valueCents += d.valueCents;
  }

  const rows = [...repMap.values()];
  for (const rep of rows) {
    // Drop reps that have neither activity nor a deal in scope (defensive).
    rep.companyCount = rep.companies.length;
    rep.companies.sort((a, b) => b.counts.total - a.counts.total || a.companyName.localeCompare(b.companyName));
  }
  // A rep with a scope deal but no in-window activity still renders (null-ish counts=0).
  return rows.filter((r) => r.counts.total > 0 || r.dealCount > 0);
}

/** effort rank by activity total desc; outcome rank by valueCents desc. Returns only reps whose ranks differ by >=2. */
export function rankDivergence(rows: Pick<UnifiedRepRow, "ownerId" | "counts" | "valueCents">[]): Map<string, { effortRank: number; outcomeRank: number }> {
  const rankBy = (metric: (r: (typeof rows)[number]) => number) => {
    const order = [...rows].sort((a, b) => metric(b) - metric(a));
    const m = new Map<string, number>();
    order.forEach((r, i) => m.set(r.ownerId ?? "__unassigned__", i + 1));
    return m;
  };
  const effort = rankBy((r) => r.counts.total);
  const outcome = rankBy((r) => r.valueCents);
  const out = new Map<string, { effortRank: number; outcomeRank: number }>();
  for (const r of rows) {
    const k = r.ownerId ?? "__unassigned__";
    const e = effort.get(k)!; const o = outcome.get(k)!;
    if (Math.abs(e - o) >= 2) out.set(k, { effortRank: e, outcomeRank: o });
  }
  return out;
}
```

- [ ] **Step 4-5:** run/verify/typecheck; commit `feat(unified): scoped rep-company rows + rank divergence`.

---

## Task 3: Scope-aware metric strip (pure)

**Files:** append to `lib/unifiedActivityReport.ts` + test.

- [ ] **Step 1: Failing test (append)**

```ts
import { unifiedMetricStrip } from "./unifiedActivityReport";

describe("unifiedMetricStrip", () => {
  const mDeals = [deal("w", "u1", "Acme", "won", 20000), deal("l", "u1", "Beta", "lost", 0), deal("o", "u2", "Acme", "proposal", 5000)];
  const mActs = [
    act("w", "call", "2026-03-01T00:00:00.000Z"), act("w", "email", "2026-03-02T00:00:00.000Z"),
    act("l", "call", "2026-03-03T00:00:00.000Z"), act("o", "call", "2026-03-04T00:00:00.000Z"),
  ];
  it("won scope: revenue won, touches per win, won deals", () => {
    const m = unifiedMetricStrip(mActs, mDeals, range, "won");
    expect(m.map((c) => c.label)).toEqual(["Revenue won", "Touches per win", "Won deals"]);
    expect(m.find((c) => c.label === "Won deals")!.value).toBe("1");
  });
  it("all scope: total activity 4, win rate 50% (1 of 2 closed)", () => {
    const m = unifiedMetricStrip(mActs, mDeals, range, "all");
    expect(m.find((c) => c.label === "Total activity")!.value).toBe("4");
    expect(m.find((c) => c.label === "Win rate")!.value).toBe("50%");
  });
  it("open scope: open pipeline, touches logged 1, open deals", () => {
    const m = unifiedMetricStrip(mActs, mDeals, range, "open");
    expect(m.map((c) => c.label)).toEqual(["Open pipeline", "Touches logged", "Open deals"]);
    expect(m.find((c) => c.label === "Touches logged")!.value).toBe("1");
  });
  it("lost scope: revenue lost, touches per loss, win rate", () => {
    const m = unifiedMetricStrip(mActs, mDeals, range, "lost");
    expect(m.map((c) => c.label)).toEqual(["Revenue lost", "Touches per loss", "Win rate"]);
  });
});
```

- [ ] **Step 2: fail. Step 3: implement** (add `formatBandUsd` to the existing `./activityToWin` import)

```ts
export interface MetricCell { label: string; value: string; }

function pct(n: number): string { return `${Math.round(n * 100)}%`; }
function num(n: number | null): string { return n == null ? "-" : Number.isInteger(n) ? String(n) : n.toFixed(1); }

/**
 * Scope-specific metric strip. Activity-date windowed (Phase 1). Revenue/day
 * figures come from the deals in the window's scope; "touches per win" is the
 * honest total-activity/wins figure (survivorship "touches on winners" is Phase 2).
 */
export function unifiedMetricStrip(activities: Activity[], deals: Deal[], range: DateRange, scope: ReportScope): MetricCell[] {
  const rows = attributeActivitiesWithOutcome(activities, deals, range);
  const band = outcomeBand(rows);
  const dealsBy = (o: Outcome) => deals.filter((d) => classifyDealOutcome(d.stage) === o);
  const won = dealsBy("won"); const lost = dealsBy("lost"); const open = dealsBy("open");
  const sumValue = (ds: Deal[]) => ds.reduce((s, d) => s + d.valueCents, 0);
  const closed = won.length + lost.length;
  const winRate = closed > 0 ? won.length / closed : null;
  const formatUsd = (cents: number) => formatBandUsd(cents);

  switch (scope) {
    case "won":
      return [
        { label: "Revenue won", value: formatUsd(sumValue(won)) },
        { label: "Touches per win", value: won.length ? num(band.total / won.length) : "-" },
        { label: "Won deals", value: String(won.length) },
      ];
    case "lost":
      return [
        { label: "Revenue lost", value: formatUsd(sumValue(lost)) },
        { label: "Touches per loss", value: lost.length ? num(band.total / lost.length) : "-" },
        { label: "Win rate", value: winRate == null ? "-" : pct(winRate) },
      ];
    case "open":
      return [
        { label: "Open pipeline", value: formatUsd(sumValue(open)) },
        { label: "Touches logged", value: String(band.open) },
        { label: "Open deals", value: String(open.length) },
      ];
    case "all":
    default:
      return [
        { label: "Total activity", value: String(band.total) },
        { label: "Deals won", value: String(won.length) },
        { label: "Win rate", value: winRate == null ? "-" : pct(winRate) },
      ];
  }
}
```
(`formatBandUsd` comes from `./activityToWin`; do not import `median` here, it is unused.)

- [ ] **Step 4-5:** run/verify/typecheck; commit `feat(unified): scope-aware metric strip`.

---

## Task 4: CSV export (pure)

**Files:** Create `lib/unifiedActivityCsv.ts` + test.

- [ ] **Step 1: Failing test** — given `unifiedRepRows` output + a `nameOf` + scope, `unifiedActivityCsv` emits a header `Rep,Company,Calls,Emails,Visits,Appointments,Total,Deals,Value` and a row per rep x company with the scoped values, quoting cells with commas (reuse `escapeCsvCell`).

- [ ] **Step 2: fail. Step 3: implement**

```ts
/** CSV for the unified report: one row per rep x company for the active scope. Reuses the formula-injection-safe escaper. */
import type { UnifiedRepRow } from "./unifiedActivityReport";
import { escapeCsvCell } from "./repCompanyCsv";
import { formatBandUsd } from "./activityToWin";

const HEADER = ["Rep", "Company", "Calls", "Emails", "Visits", "Appointments", "Total", "Deals", "Value"];

export function unifiedActivityCsv(reps: UnifiedRepRow[], nameOf: (ownerId: string | null) => string): string {
  const lines = [HEADER.join(",")];
  for (const rep of reps) {
    const name = nameOf(rep.ownerId);
    for (const c of rep.companies) {
      lines.push([
        escapeCsvCell(name), escapeCsvCell(c.companyName),
        c.counts.call, c.counts.email, c.counts.drop_in, c.counts.appointment, c.counts.total,
        c.dealCount, escapeCsvCell(formatBandUsd(c.valueCents)),
      ].map(String).join(","));
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4-5:** run/verify/typecheck; commit `feat(unified): CSV export`.

---

## Task 5: Presentational components

**Files:** Create `components/AllocationBand.tsx`, `components/ScopeMetricStrip.tsx` (+ tests). Follow the tokens/patterns in the current `ActivityToWinReport.tsx` (`ACCENT`, `Card`, brand tokens). No em/en dashes.

- [ ] **AllocationBand**: props `{ band: OutcomeBand; scope: ReportScope; onScope: (s: ReportScope) => void }`. Render a single horizontal bar with Won/Open/Lost segments sized by `count/total` (min width so tiny segments stay visible), each a button that calls `onScope(outcome)`; the active scope's segment is emphasized; a caption "N activities logged this period. Click a segment to change scope." Colors: won = teal (`bg-accent-teal`), open = blue (`bg-accent-blue`), lost = pink (`bg-accent-pink`). Test: renders three segments with counts; clicking a segment fires `onScope` with that outcome.
- [ ] **ScopeMetricStrip**: props `{ metrics: MetricCell[] }`. Render the cells in a responsive grid (reuse the KPI card style). Test: renders each label + value.

Commit each: `feat(unified): allocation band` / `feat(unified): scope metric strip`.

---

## Task 6: Rebuild the report page

**Files:** Rewrite `pages/ActivityToWinReport.tsx` (keep the export name `ActivityToWinReport` + default export + route `/dashboard/activity-to-win` so the dashboard link keeps working). Update `pages/ActivityToWinReport.test.tsx`.

- [ ] **Step 1:** Replace the page body with the unified report, PRESERVING the reusable bits (gradient header, `downloadCsv`, `ACCENT`, `useProfile`/`isManagerish`/`repName`/`useOrgMemberNames`, `useDeals`, `useActivitiesForOrg`, the `REPORT_RANGES` pills). New structure:
  - State: `scope: ReportScope` (default `"won"`), `windowKey: RangeKey` (default `"90d"`), `sort`, `expanded: Set<string>`. Read `?scope=` query param on mount to allow the Additional-reports entry to open at `"all"`.
  - `range = resolveRange(windowKey, new Date())`. `deals`/`activities` from the hooks.
  - `band = outcomeBand(attributeActivitiesWithOutcome(activities, deals, range))`.
  - `reps = unifiedRepRows(activities, deals, range, scope)`; sortable (by activity total, deal value, or deal count).
  - `metrics = unifiedMetricStrip(activities, deals, range, scope)`.
  - `divergence = rankDivergence(reps)`.
  - `recon = reconciliation(band)`.
  - Header title "Activity performance"; window label per scope: for `all`/`open` "Activity logged in the last N days" (or "All time"); for `won`/`lost` use the SAME activity-based phrasing in Phase 1 ("Activity logged in the last N days"), NOT a close-date phrase.
  - Render: back link + header; scope pills (All/Won/Lost/Open); `<AllocationBand>`; the time-range pills; `<ScopeMetricStrip>`; the rep table (rep row: rank, `repName`, activity-mix dots via `TYPE_META` colors, the scope columns Deals/Touches/Value, a divergence tag "effort X / outcome Y" when `divergence.has(key)`, expand chevron → per-company sub-table of counts + Deals + Value); the reconciliation footer (persistent, non-dismissible): "N logged · W on won · X on open or lost · 0 unattached"; an Export CSV button (`unifiedActivityCsv(sortedReps, repName)` via `downloadCsv`, filename encodes scope + date). Empty state when `band.total === 0`.
  - Keep the multiple-expand drill-down pattern (Set of rep keys), matching the rep/company report that shipped earlier.
- [ ] **Step 2:** Rewrite the page test to the unified report: default Won scope renders the metric strip + allocation band + reconciliation footer; clicking the "All" scope pill (or an allocation segment) changes the metric strip labels; expanding a rep shows its company sub-table; CSV button present. Delete assertions tied to the old averages report. Do not weaken unrelated coverage.
- [ ] **Step 3:** `pnpm --filter app test -- ActivityToWinReport` + `pnpm --filter app typecheck` green.
- [ ] **Step 4:** Commit `feat(unified): rebuild report page with outcome scopes`.

---

## Task 7: Placement rewiring + remove the standalone rep/company report

**Files:** `App.tsx`, `DashboardPage.tsx`, remove `pages/ActivitiesByRepCompanyReport.tsx` + its test + `AdditionalReports.repCompany.test.tsx` (or update it).

- [ ] **Step 1:** In `App.tsx`, remove the `ActivitiesByRepCompanyReport` lazy import and its `<Route path="/dashboard/activities-by-rep" ...>`.
- [ ] **Step 2:** In `DashboardPage.tsx` `AdditionalReports`, re-point the managers' row to `/dashboard/activity-to-win?scope=all`, relabel title "Activity performance", subtitle "Activity by outcome, rep, and company". (Keep the `viewTeamPage` gate + the return-null-when-not-manager behavior.)
- [ ] **Step 3:** Delete `pages/ActivitiesByRepCompanyReport.tsx` and `pages/ActivitiesByRepCompanyReport.test.tsx`. Update `AdditionalReports.repCompany.test.tsx` to assert the new label/route (or delete if redundant with a new assertion in the entry test). Remove now-unused helpers: if `repCompanyActivity.ts` / `repCompanyCsv.ts` still have live consumers (the unified CSV reuses `escapeCsvCell`), keep those; delete any function with zero remaining references (check with a grep). Do NOT delete `escapeCsvCell`.
- [ ] **Step 4:** `pnpm --filter app test` for the affected files; fix references. Commit `refactor(unified): retire standalone rep-company report; re-point dashboard entry`.

---

## Task 8: Full suite + typecheck + ship

- [ ] **Step 1:** `pnpm --filter app typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter app test` → all pass; no dangling imports to the removed page.
- [ ] **Step 3:** Push to main: `git push origin HEAD:main` (frontend-only).
- [ ] **Step 4: Visual check** (after deploy) on the demo org: open the report from the dashboard widget → defaults to Won; the allocation band shows the Won/Open/Lost split; switching scopes changes the metric strip + columns + window label together; expanding a rep shows the per-company table; the reconciliation footer ties (won + open-or-lost = total); CSV exports the active scope; the old `/dashboard/activities-by-rep` is gone and the managers' Additional-reports row opens the unified report at All scope.
