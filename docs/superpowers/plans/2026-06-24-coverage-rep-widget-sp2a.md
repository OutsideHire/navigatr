# Activity Logging Coverage — SP2a: Rep coverage widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface each rep's logging-coverage % on their dashboard via one new "Logging coverage" card that reads the rep's own `coverage_snapshot` (band-colored %, confidence qualifier, channel summary, trend sparkline, "how calculated" popover, instructional empty state).

**Architecture:** A `useCoverageSnapshots` hook reads the rep's snapshots (RLS-scoped). A pure frontend `bandPresentation`/`confidenceLabel` helper maps band/confidence → tokens+labels. `CoverageWidget` reuses the shared `band()` math from `_shared/coverage` and renders three states. Wired into the populated dashboard's right-column grid. No backend changes.

**Tech Stack:** React + TypeScript, TanStack Query, Radix Popover, Vitest + Testing Library; reuses Deno `_shared/coverage` pure modules.

**Spec:** `docs/superpowers/specs/2026-06-24-coverage-rep-widget-sp2a-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/coverage-sp2a/apps/app`. Run `git` from the worktree ROOT `/Users/ryanmeo/navigatr/.claude/worktrees/coverage-sp2a`.

---

### Task 1: `bandPresentation` + `confidenceLabel` helper + tsconfig include (TDD)

**Files:**
- Modify: `apps/app/tsconfig.app.json` (add the two `_shared/coverage` files to `include`)
- Create: `apps/app/src/features/coverage/lib/bandPresentation.ts`
- Test: `apps/app/src/features/coverage/lib/bandPresentation.test.ts`

Context: the band/confidence string types live in `supabase/functions/_shared/coverage/config.ts`. The frontend imports them by deep relative path (precedent: `useMerchants` imports `industryTaxonomy`), and the file must be listed in `tsconfig.app.json`'s `include` to typecheck. This task also pre-adds `score.ts` (used by Task 3).

- [ ] **Step 1: Extend the tsconfig include.** In `apps/app/tsconfig.app.json`, the `include` array currently ends with `"../../supabase/functions/_shared/industryTaxonomy.ts"`. Add the two coverage files:
```json
  "include": [
    "src",
    "../../supabase/functions/_shared/industryTaxonomy.ts",
    "../../supabase/functions/_shared/coverage/config.ts",
    "../../supabase/functions/_shared/coverage/score.ts"
  ]
```
(Match the file's existing formatting; just add the two entries.)

- [ ] **Step 2: Confirm the status token utility names.** READ `apps/app/tailwind.config.ts` and find the status color tokens. The explore identified `status-success` / `status-warning` / `status-danger` (text) and `*-bg` tint variants. Confirm the EXACT utility class names available (e.g. `text-status-success`, `bg-status-success-bg`) and use the real ones in Step 4. If the bg-tint token is named differently (e.g. `bg-status-success/10` or a distinct token), use whatever actually exists — do not invent a class.

- [ ] **Step 3: Write the failing test** `bandPresentation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bandPresentation, confidenceLabel } from "./bandPresentation";

describe("bandPresentation", () => {
  it("maps green bands to success, amber to warning, red to danger", () => {
    expect(bandPresentation("excellent").tokenClass).toContain("success");
    expect(bandPresentation("good").tokenClass).toContain("success");
    expect(bandPresentation("adequate").tokenClass).toContain("warning");
    expect(bandPresentation("poor").tokenClass).toContain("warning");
    expect(bandPresentation("unreliable").tokenClass).toContain("danger");
  });
  it("gives a human label per band", () => {
    expect(bandPresentation("excellent").label).toBe("Excellent");
    expect(bandPresentation("unreliable").label).toBe("Unreliable");
  });
  it("returns a pill class for each band", () => {
    expect(bandPresentation("good").pillClass).toBeTruthy();
  });
});

describe("confidenceLabel", () => {
  it("qualifies low/medium and omits for high", () => {
    expect(confidenceLabel("low")).toBe("Estimated · low confidence");
    expect(confidenceLabel("medium")).toBe("Estimated");
    expect(confidenceLabel("high")).toBeNull();
  });
  it("qualifies insufficient defensively (not normally rendered)", () => {
    expect(confidenceLabel("insufficient")).toBe("Estimated · low confidence");
  });
});
```

- [ ] **Step 4: Run** `pnpm test bandPresentation` → FAIL. Then implement `bandPresentation.ts` (replace `text-status-*`/`bg-status-*-bg` with the EXACT classes confirmed in Step 2 if they differ):
```ts
/**
 * SP2a presentation helpers — map a coverage band / confidence level to Tailwind
 * status tokens + human labels. The band MATH (composite → band) stays in the
 * shared _shared/coverage/score.ts; this is the frontend's token/label layer.
 */
import type { Band, ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface BandPresentation {
  label: string;
  /** text color utility for the % */
  tokenClass: string;
  /** background+text utilities for the band pill */
  pillClass: string;
}

const BAND_PRESENTATION: Record<Band, BandPresentation> = {
  excellent:  { label: "Excellent",  tokenClass: "text-status-success", pillClass: "bg-status-success-bg text-status-success" },
  good:       { label: "Good",       tokenClass: "text-status-success", pillClass: "bg-status-success-bg text-status-success" },
  adequate:   { label: "Adequate",   tokenClass: "text-status-warning", pillClass: "bg-status-warning-bg text-status-warning" },
  poor:       { label: "Poor",       tokenClass: "text-status-warning", pillClass: "bg-status-warning-bg text-status-warning" },
  unreliable: { label: "Unreliable", tokenClass: "text-status-danger",  pillClass: "bg-status-danger-bg text-status-danger" },
};

export function bandPresentation(band: Band): BandPresentation {
  return BAND_PRESENTATION[band];
}

/** Confidence qualifier shown beside the %. `high` → no qualifier. */
export function confidenceLabel(level: ConfidenceLevel): string | null {
  switch (level) {
    case "high": return null;
    case "medium": return "Estimated";
    case "low": return "Estimated · low confidence";
    case "insufficient": return "Estimated · low confidence"; // defensive — insufficient renders the empty state
  }
}
```

- [ ] **Step 5: Run** `pnpm test bandPresentation` → PASS. `pnpm typecheck` → clean (confirms the deep import + tsconfig include resolve).

- [ ] **Step 6: Commit**
```bash
git add apps/app/tsconfig.app.json apps/app/src/features/coverage/lib/bandPresentation.ts apps/app/src/features/coverage/lib/bandPresentation.test.ts
git commit -m "feat(coverage): SP2a band/confidence presentation helpers + tsconfig include"
```

---

### Task 2: `useCoverageSnapshots` hook (TDD)

**Files:**
- Create: `apps/app/src/features/coverage/hooks/useCoverageSnapshots.ts`
- Test: `apps/app/src/features/coverage/hooks/useCoverageSnapshots.test.tsx`

- [ ] **Step 1: Write the failing test** (mirror the supabase thenable-builder + auth mock used in `features/activities/hooks/useUnloggedDials.test.tsx`):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCoverageSnapshots } from "./useCoverageSnapshots";

let rows: Array<Record<string, unknown>>;
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
  return b;
}
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => builder() } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "u1" } }),
}));

function wrapper() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

const snap = (d: string, composite: number, conf = "low") => ({
  snapshot_date: d, composite_coverage: composite, confidence_level: conf,
  call_coverage: composite, call_event_count: 10, active_channels: ["phone"],
});

beforeEach(() => { rows = []; });

describe("useCoverageSnapshots", () => {
  it("returns the newest snapshot as latest and the series in chronological order", async () => {
    // query returns newest-first
    rows = [snap("2026-06-24", 0.8), snap("2026-06-23", 0.5)];
    const { result } = renderHook(() => useCoverageSnapshots(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.latest?.snapshotDate).toBe("2026-06-24");
    expect(result.current.latest?.compositeCoverage).toBe(0.8);
    expect(result.current.series.map((s) => s.snapshotDate)).toEqual(["2026-06-23", "2026-06-24"]);
  });

  it("returns null latest + empty series when there are no snapshots", async () => {
    rows = [];
    const { result } = renderHook(() => useCoverageSnapshots(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.latest).toBeNull();
    expect(result.current.series).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm test useCoverageSnapshots` → FAIL.

- [ ] **Step 3: Implement** `useCoverageSnapshots.ts`:
```ts
/**
 * useCoverageSnapshots — the current rep's Activity Logging Coverage snapshots
 * (SP2a). RLS scopes coverage_snapshot to the rep's own rows. Returns the latest
 * snapshot (headline) + the trailing series in chronological order (sparkline).
 * A query error is treated as no-data (the widget shows its instructional state).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface CoverageSnapshot {
  snapshotDate: string;
  compositeCoverage: number;
  confidenceLevel: ConfidenceLevel;
  callCoverage: number | null;
  callEventCount: number;
  activeChannels: string[];
}

interface SnapshotRow {
  snapshot_date: string;
  composite_coverage: number;
  confidence_level: ConfidenceLevel;
  call_coverage: number | null;
  call_event_count: number;
  active_channels: string[] | null;
}

export const COVERAGE_SNAPSHOTS_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "snapshots", userId ?? "anon"] as const;

export function useCoverageSnapshots(): {
  latest: CoverageSnapshot | null;
  series: CoverageSnapshot[];
  isLoading: boolean;
} {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: COVERAGE_SNAPSHOTS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CoverageSnapshot[]> => {
      const { data, error } = await supabase
        .from("coverage_snapshot")
        .select("snapshot_date, composite_coverage, confidence_level, call_coverage, call_event_count, active_channels")
        .order("snapshot_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return ((data ?? []) as unknown as SnapshotRow[]).map((r) => ({
        snapshotDate: r.snapshot_date,
        compositeCoverage: r.composite_coverage,
        confidenceLevel: r.confidence_level,
        callCoverage: r.call_coverage,
        callEventCount: r.call_event_count,
        activeChannels: r.active_channels ?? [],
      }));
    },
    staleTime: 30_000,
  });

  const rows = query.data ?? [];
  return {
    latest: rows[0] ?? null,
    series: [...rows].reverse(), // newest-first → chronological for the sparkline
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 4: Run** `pnpm test useCoverageSnapshots` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/coverage/hooks/useCoverageSnapshots.ts apps/app/src/features/coverage/hooks/useCoverageSnapshots.test.tsx
git commit -m "feat(coverage): SP2a useCoverageSnapshots — rep's snapshots (latest + series)"
```

---

### Task 3: `CoverageWidget` component (TDD)

**Files:**
- Create: `apps/app/src/features/coverage/components/CoverageWidget.tsx`
- Test: `apps/app/src/features/coverage/components/CoverageWidget.test.tsx`

- [ ] **Step 1: Write the failing test** (mock the hook + the shared `band`):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CoverageWidget } from "./CoverageWidget";
import type { CoverageSnapshot } from "../hooks/useCoverageSnapshots";

let latest: CoverageSnapshot | null;
let series: CoverageSnapshot[];
vi.mock("../hooks/useCoverageSnapshots", () => ({
  useCoverageSnapshots: () => ({ latest, series, isLoading: false }),
}));

const snap = (over: Partial<CoverageSnapshot> = {}): CoverageSnapshot => ({
  snapshotDate: "2026-06-24", compositeCoverage: 0.8, confidenceLevel: "high",
  callCoverage: 0.8, callEventCount: 10, activeChannels: ["phone"], ...over,
});

beforeEach(() => { latest = null; series = []; });

describe("CoverageWidget", () => {
  it("shows the instructional empty state when there is no snapshot", () => {
    render(<CoverageWidget />);
    expect(screen.getByText(/logging coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/no coverage data yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("treats insufficient confidence as the empty state (no %)", () => {
    latest = snap({ confidenceLevel: "insufficient", compositeCoverage: 0.25 });
    render(<CoverageWidget />);
    expect(screen.getByText(/no coverage data yet/i)).toBeInTheDocument();
    expect(screen.queryByText("25%")).not.toBeInTheDocument();
  });

  it("renders the band % with a low-confidence qualifier for thin data", () => {
    latest = snap({ confidenceLevel: "low", compositeCoverage: 0.78, callEventCount: 18, callCoverage: 0.78 });
    series = [snap({ snapshotDate: "2026-06-23", compositeCoverage: 0.7 }), latest];
    render(<CoverageWidget />);
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText(/estimated · low confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/phone/i)).toBeInTheDocument();
  });

  it("renders the % with no qualifier for high confidence", () => {
    latest = snap({ confidenceLevel: "high", compositeCoverage: 0.92 });
    render(<CoverageWidget />);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.queryByText(/estimated/i)).not.toBeInTheDocument();
  });

  it("omits the sparkline with fewer than 2 snapshots", () => {
    latest = snap({ confidenceLevel: "high" });
    series = [latest];
    render(<CoverageWidget />);
    expect(screen.queryByTestId("coverage-sparkline")).not.toBeInTheDocument();
  });

  it("shows the sparkline with 2+ snapshots", () => {
    latest = snap({ confidenceLevel: "high" });
    series = [snap({ snapshotDate: "2026-06-23", compositeCoverage: 0.6 }), latest];
    render(<CoverageWidget />);
    expect(screen.getByTestId("coverage-sparkline")).toBeInTheDocument();
  });

  it("opens the methodology popover", () => {
    latest = snap({ confidenceLevel: "high" });
    render(<CoverageWidget />);
    fireEvent.click(screen.getByRole("button", { name: /how is this calculated/i }));
    expect(screen.getByText(/within 4 hours/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** `pnpm test CoverageWidget` → FAIL.

- [ ] **Step 3: Implement** `CoverageWidget.tsx`. (Confirm `Card` accepts `padding`/`shadow` like the other dashboard widgets; `@radix-ui/react-popover` import matches `features/pipeline/components/PipelineFilterPopover.tsx`.)
```tsx
/**
 * CoverageWidget — SP2a rep dashboard card surfacing Activity Logging Coverage.
 * Reads the rep's own snapshots; derives the band from the shared band() math;
 * renders an instructional empty state (no data / insufficient), a thin-data
 * state (% + "Estimated · low confidence"), or a solid state (% only). Trend
 * sparkline reuses the DIY flex-bar idiom. Data-quality framing, never compliance.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Phone } from "lucide-react";
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useCoverageSnapshots } from "../hooks/useCoverageSnapshots";
import { bandPresentation, confidenceLabel } from "../lib/bandPresentation";
import { band } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG } from "../../../../../../supabase/functions/_shared/coverage/config";

function Methodology() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="text-body-sm text-brand-primary hover:underline">
          How is this calculated?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-radius-md border border-border-default bg-surface-default p-4 text-body-sm text-text-muted shadow-card-hover"
        >
          <p className="mb-2 font-semibold text-text-default">How logging coverage works</p>
          <p className="mb-2">
            We estimate how much of your calling is captured. A tap-to-call counts as
            <strong> logged</strong> when you log a Call activity for that deal within 4 hours.
          </p>
          <p>
            It's a data-quality guide, not a score — low coverage just means some calls weren't
            logged yet. More channels (calendar, email) will sharpen the estimate later.
          </p>
          <Popover.Arrow className="fill-surface-default" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CoverageWidget() {
  const { latest, series } = useCoverageSnapshots();
  const hasData = latest != null && latest.confidenceLevel !== "insufficient";

  if (!hasData) {
    return (
      <Card padding="lg" shadow="sm">
        <div className="flex items-center justify-between">
          <h3 className="text-body-md font-semibold text-text-default">Logging coverage</h3>
          <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-subtle">
            No data yet
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-radius-md bg-surface-sunken text-text-subtle">
            <Phone className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-body-md font-semibold text-text-default">No coverage data yet</p>
          <p className="text-body-sm text-text-muted">
            Make calls with tap-to-call and log the outcome — once you have a few, we'll show how
            much of your calling is captured.
          </p>
          <div className="mt-1"><Methodology /></div>
        </div>
      </Card>
    );
  }

  const pct = Math.round(latest.compositeCoverage * 100);
  const b = band(latest.compositeCoverage, DEFAULT_COVERAGE_CONFIG.bandThresholds);
  const pres = bandPresentation(b);
  const qualifier = confidenceLabel(latest.confidenceLevel);
  const logged = Math.round((latest.callCoverage ?? 0) * latest.callEventCount);
  const maxComposite = Math.max(...series.map((s) => s.compositeCoverage), 0.01);

  return (
    <Card padding="lg" shadow="sm">
      <div className="flex items-center justify-between">
        <h3 className="text-body-md font-semibold text-text-default">Logging coverage</h3>
        <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", pres.pillClass)}>
          {pres.label}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-kpi-lg font-bold tabular-nums", pres.tokenClass)}>{pct}%</span>
        {qualifier && <span className="text-body-sm text-text-muted">{qualifier}</span>}
      </div>

      <p className="mt-1 text-body-sm text-text-muted">
        Phone · {latest.callEventCount} calls · {logged} logged
      </p>

      {series.length >= 2 && (
        <div data-testid="coverage-sparkline" className="mt-3 flex h-9 items-end gap-1" aria-hidden>
          {series.map((s) => (
            <span
              key={s.snapshotDate}
              className={cn("flex-1 rounded-t-radius-sm", pres.tokenClass.replace("text-", "bg-"))}
              style={{ height: `${Math.max((s.compositeCoverage / maxComposite) * 100, 4)}%`, opacity: 0.85 }}
            />
          ))}
        </div>
      )}

      <div className="mt-3"><Methodology /></div>
    </Card>
  );
}
```
NOTE on the sparkline color: `pres.tokenClass.replace("text-", "bg-")` turns `text-status-success` → `bg-status-success`. Confirm that `bg-status-*` (the solid, non-`-bg` variant) is a real utility from Step-2's token check; if the solid background token has a different name, set the bar color explicitly instead of the string-replace. Keep it simple and correct.

- [ ] **Step 4: Run** `pnpm test CoverageWidget` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/coverage/components/CoverageWidget.tsx apps/app/src/features/coverage/components/CoverageWidget.test.tsx
git commit -m "feat(coverage): SP2a CoverageWidget — band %, confidence, channel line, sparkline, methodology"
```

---

### Task 4: Wire `CoverageWidget` into the dashboard (TDD)

**Files:**
- Modify: `apps/app/src/features/dashboard/pages/DashboardPage.tsx`
- Modify: `apps/app/src/features/dashboard/pages/DashboardPage.test.tsx` (or the page's existing test file)

- [ ] **Step 1: Render the widget.** In `DashboardPage.tsx`, import it and place it in the populated right-column 2-col grid immediately after the `<PersistenceIndex stats={data.persistenceIndex} />` line:
```tsx
import { CoverageWidget } from "@/features/coverage/components/CoverageWidget";
```
```tsx
          <PersistenceIndex stats={data.persistenceIndex} />
          {/* SP2a — rep logging-coverage widget (reads its own coverage_snapshot) */}
          <CoverageWidget />
```

- [ ] **Step 2: Update the dashboard test.** READ the existing `DashboardPage` test. It renders the populated dashboard with mocked dashboard data. `CoverageWidget` calls `useCoverageSnapshots` → `supabase.from("coverage_snapshot")`; if the test's supabase mock doesn't cover that table the query errors and the widget falls back to its empty state (acceptable — no throw). To keep the test deterministic, mock the hook at the top of the test file:
```tsx
vi.mock("@/features/coverage/hooks/useCoverageSnapshots", () => ({
  useCoverageSnapshots: () => ({ latest: null, series: [], isLoading: false }),
}));
```
Then add an assertion that the populated dashboard shows the coverage card:
```tsx
expect(screen.getByText(/logging coverage/i)).toBeInTheDocument();
```
(If the dashboard test renders the EMPTY/onboarding dashboard by default, ensure it's the populated path — match how existing populated-dashboard assertions are set up. If `useCoverageSnapshots` is already harmlessly falling back, the mock just makes it deterministic. Keep all existing assertions green.)

- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` (full) → clean, all green.

- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/dashboard/pages/DashboardPage.tsx apps/app/src/features/dashboard/pages/DashboardPage.test.tsx
git commit -m "feat(coverage): show the rep coverage widget on the dashboard"
```

---

### Final

After all tasks: `pnpm typecheck && pnpm test` (full) → clean/green. Then finishing-a-development-branch (merge + push). **No migration, no Edge function, no deploy** — SP2a is pure frontend reading SP1's existing `coverage_snapshot`. Verification note: the widget only renders meaningfully on the authed dashboard, so it's covered by the component/hook tests; the live populated state depends on the SP1 cron producing snapshots (and reps generating dials), which the user confirms in their own session.

## Notes for the implementer
- DRY: band MATH is reused from `_shared/coverage/score.ts`; only token/label mapping is new (`bandPresentation`). Do NOT re-implement banding in the frontend.
- YAGNI: no badges/warnings on other widgets, no aggregate views, no per-org threshold overrides — all SP2b/later.
- The empty/instructional state covers both "no snapshot" AND `confidence_level === 'insufficient'` (PRD: insufficient shows no %).
- Confirm exact Tailwind status-token utility names in Task 1 Step 2 and use the real ones everywhere (pill, %, sparkline bar).
- Run git from the worktree root; run pnpm from `apps/app`.
