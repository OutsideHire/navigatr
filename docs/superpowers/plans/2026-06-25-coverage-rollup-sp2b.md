# Activity Logging Coverage — SP2b: Manager coverage rollup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give managers/admins a team logging-coverage rollup on the Team page — a `coverage_rollup` on-read RPC (per-rep latest snapshot, hierarchy-scoped) surfaced as a `TeamCoverageCard` with a volume-weighted team headline + per-rep coverage chips.

**Architecture:** A SECURITY DEFINER `coverage_rollup()` RPC mirrors `team_leaderboard` (org + `user_can_see_owner` scoping, manager/admin gate). A pure `teamCoverage()` helper reuses the shared `composite()`/`band()` for the headline. `useCoverageRollup` reads the RPC; `TeamCoverageCard` renders on `/admin/agents`. No new table/job — on-read only.

**Tech Stack:** Supabase Postgres RPC + RLS, React + TypeScript, TanStack Query, Vitest; reuses `_shared/coverage` (`composite`/`band`/`config`) + SP2a `bandPresentation`.

**Spec:** `docs/superpowers/specs/2026-06-25-coverage-rollup-sp2b-design.md`

Run pnpm from `.../apps/app`. Run `git` as its OWN command from the worktree ROOT `/Users/ryanmeo/navigatr/.claude/worktrees/coverage-sp2b`. (`docs/` is gitignored — force-add docs only; source under `apps/app` + `supabase` tracks normally.)

---

### Task 1: `coverage_rollup()` RPC migration

**Files:** Create `supabase/migrations/20260625000001_coverage_rollup.sql`.

DB migration — no vitest (consistent with `team_leaderboard`); hand-applied to prod with the user's authorization. Mirror `supabase/migrations/20260524000001_team_leaderboard.sql`'s authz + grant style.

- [ ] **Step 1: READ** `supabase/migrations/20260524000001_team_leaderboard.sql` to confirm the authz pattern (`raise exception 'not_authenticated'` when `auth.uid()` is null; `raise exception 'forbidden'` when role not in manager/admin), `security definer` + `set search_path = public`, and the `grant execute … to authenticated` footer. Confirm `coverage_snapshot` columns from `supabase/migrations/20260624000003_coverage_snapshot.sql` and that `public.user_can_see_owner(uuid)` / `public.user_org_id()` / `public.user_role()` exist.

- [ ] **Step 2: Write** `supabase/migrations/20260625000001_coverage_rollup.sql`:
```sql
-- coverage_rollup(): manager/admin view of per-rep Activity Logging Coverage
-- (SP2b). On-read aggregation (no persisted coverage_aggregate_snapshot) — one
-- row per visible rep with their LATEST coverage_snapshot, hierarchy-scoped via
-- user_can_see_owner (manager → subtree, admin → org). Returns SCORES only;
-- raw coverage_signal rows stay rep-only (PRD §3.3.C.10/11). Mirrors the
-- team_leaderboard authz + SECURITY DEFINER pattern.

create or replace function coverage_rollup()
returns table (
  user_id            uuid,
  full_name          text,
  role               user_role,
  snapshot_date      date,
  composite_coverage numeric,
  confidence_level   text,
  call_coverage      numeric,
  call_event_count   int,
  active_channels    text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if public.user_role() not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  return query
  select p.id, p.full_name, p.role,
         s.snapshot_date, s.composite_coverage, s.confidence_level,
         s.call_coverage, s.call_event_count, s.active_channels
  from profiles p
  left join lateral (
    select cs.snapshot_date, cs.composite_coverage, cs.confidence_level,
           cs.call_coverage, cs.call_event_count, cs.active_channels
    from coverage_snapshot cs
    where cs.user_id = p.id
    order by cs.snapshot_date desc
    limit 1
  ) s on true
  where p.org_id = public.user_org_id()
    and p.deactivated_at is null
    and public.user_can_see_owner(p.id)
  order by p.full_name;
end $$;

grant execute on function coverage_rollup() to authenticated;
```
(If `team_leaderboard` uses a slightly different auth-check idiom or the `profiles` column for soft-delete is named differently than `deactivated_at`, MATCH the real names and note it.)

- [ ] **Step 3: Verify structure.** Run: `grep -cE "security definer|grant execute|raise exception" supabase/migrations/20260625000001_coverage_rollup.sql` → expect `4` (1 security definer + 1 grant + 2 raises). Confirm `deactivated_at` is the real `profiles` soft-delete column (grep the profiles/role-hierarchy migrations); if it's different, fix.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260625000001_coverage_rollup.sql
git commit -m "feat(coverage): coverage_rollup RPC — manager/admin per-rep coverage (on-read, hierarchy-scoped)"
```

---

### Task 2: `teamCoverage` pure aggregate helper (TDD)

**Files:** Create `apps/app/src/features/coverage/lib/teamCoverage.ts` + `.test.ts`.

Defines the rollup row type (consumed by the hook + card) and the pure team-headline aggregator, reusing the shared `composite()`/`band()`.

- [ ] **Step 1: Write the failing test** `teamCoverage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { teamCoverage, type CoverageRollupRow } from "./teamCoverage";

const row = (over: Partial<CoverageRollupRow> = {}): CoverageRollupRow => ({
  userId: "u", fullName: "Rep", role: "rep", snapshotDate: "2026-06-25",
  compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8, callEventCount: 10,
  activeChannels: ["phone"], ...over,
});

describe("teamCoverage", () => {
  it("volume-weights the composite across reps with gradeable data", () => {
    const t = teamCoverage([
      row({ userId: "a", compositeCoverage: 0.8, callEventCount: 200 }),
      row({ userId: "b", compositeCoverage: 0.3, callEventCount: 5 }),
    ]);
    expect(t.compositeCoverage).toBeCloseTo((0.8 * 200 + 0.3 * 5) / 205, 6);
    expect(t.repsWithData).toBe(2);
    expect(t.repsTotal).toBe(2);
    expect(t.band).toBe("good"); // ~0.79 → good (>=0.75)
  });

  it("excludes null and insufficient rows from the composite + repsWithData but counts them in repsTotal", () => {
    const t = teamCoverage([
      row({ userId: "a", compositeCoverage: 0.9, callEventCount: 10 }),
      row({ userId: "b", compositeCoverage: null, confidenceLevel: null, callEventCount: null }), // no snapshot
      row({ userId: "c", compositeCoverage: 0.2, confidenceLevel: "insufficient", callEventCount: 3 }),
    ]);
    expect(t.compositeCoverage).toBe(0.9);
    expect(t.repsWithData).toBe(1);
    expect(t.repsTotal).toBe(3);
  });

  it("returns a null headline when no rep has gradeable data", () => {
    const t = teamCoverage([
      row({ compositeCoverage: null, confidenceLevel: null, callEventCount: null }),
      row({ userId: "c", confidenceLevel: "insufficient" }),
    ]);
    expect(t.compositeCoverage).toBeNull();
    expect(t.band).toBeNull();
    expect(t.repsWithData).toBe(0);
    expect(t.repsTotal).toBe(2);
  });
});
```

- [ ] **Step 2: Run** `pnpm test teamCoverage` → FAIL.

- [ ] **Step 3: Implement** `teamCoverage.ts`:
```ts
/**
 * SP2b team coverage rollup — types + the pure team-headline aggregator. Reuses
 * the shared composite()/band() so the team number is volume-weighted exactly
 * like a single rep's composite. A rep counts toward the headline only with a
 * gradeable snapshot (non-null composite AND confidence != "insufficient").
 */
import { band, composite } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG, type Band, type ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface CoverageRollupRow {
  userId: string;
  fullName: string | null;
  role: "rep" | "manager" | "admin";
  snapshotDate: string | null;
  compositeCoverage: number | null;
  confidenceLevel: ConfidenceLevel | null;
  callCoverage: number | null;
  callEventCount: number | null;
  activeChannels: string[];
}

export interface TeamCoverage {
  compositeCoverage: number | null;
  band: Band | null;
  repsWithData: number;
  repsTotal: number;
}

/** A rep contributes to the team headline only with a gradeable snapshot. */
export function isGradeable(r: CoverageRollupRow): boolean {
  return r.compositeCoverage !== null && r.confidenceLevel !== "insufficient";
}

export function teamCoverage(rows: CoverageRollupRow[]): TeamCoverage {
  const gradeable = rows.filter(isGradeable);
  const comp = composite(
    gradeable.map((r) => ({ coverage: r.compositeCoverage, eventCount: r.callEventCount ?? 0 })),
  );
  return {
    compositeCoverage: comp,
    band: comp === null ? null : band(comp, DEFAULT_COVERAGE_CONFIG.bandThresholds),
    repsWithData: gradeable.length,
    repsTotal: rows.length,
  };
}
```

- [ ] **Step 4: Run** `pnpm test teamCoverage` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/coverage/lib/teamCoverage.ts apps/app/src/features/coverage/lib/teamCoverage.test.ts
git commit -m "feat(coverage): SP2b teamCoverage — volume-weighted team headline (shared composite/band)"
```

---

### Task 3: `useCoverageRollup` hook (TDD)

**Files:** Create `apps/app/src/features/coverage/hooks/useCoverageRollup.ts` + `.test.tsx`.

- [ ] **Step 1: Write the failing test** `useCoverageRollup.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCoverageRollup } from "./useCoverageRollup";

let rows: unknown[];
let err: Error | null;
const rpcMock = vi.fn(() => Promise.resolve({ data: err ? null : rows, error: err }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "mgr" } }),
}));

function wrapper() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

beforeEach(() => { rows = []; err = null; rpcMock.mockClear(); });

describe("useCoverageRollup", () => {
  it("calls the coverage_rollup RPC and maps rows to camelCase", async () => {
    rows = [{
      user_id: "u1", full_name: "Alex", role: "rep", snapshot_date: "2026-06-25",
      composite_coverage: 0.8, confidence_level: "low", call_coverage: 0.8,
      call_event_count: 12, active_channels: ["phone"],
    }];
    const { result } = renderHook(() => useCoverageRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(rpcMock).toHaveBeenCalledWith("coverage_rollup");
    expect(result.current.rows[0]).toEqual({
      userId: "u1", fullName: "Alex", role: "rep", snapshotDate: "2026-06-25",
      compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8,
      callEventCount: 12, activeChannels: ["phone"],
    });
  });

  it("returns [] on error", async () => {
    err = new Error("forbidden");
    const { result } = renderHook(() => useCoverageRollup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm test useCoverageRollup` → FAIL.

- [ ] **Step 3: Implement** `useCoverageRollup.ts`:
```ts
/**
 * useCoverageRollup — manager/admin team coverage rollup (SP2b). Calls the
 * coverage_rollup RPC (per-rep latest snapshot, hierarchy + role scoped server-
 * side) and maps to CoverageRollupRow. An RPC error (incl. a non-manager hitting
 * it) is treated as no-data so the card shows its empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { CoverageRollupRow } from "../lib/teamCoverage";
import type { ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

interface RollupRpcRow {
  user_id: string;
  full_name: string | null;
  role: "rep" | "manager" | "admin";
  snapshot_date: string | null;
  composite_coverage: number | null;
  confidence_level: ConfidenceLevel | null;
  call_coverage: number | null;
  call_event_count: number | null;
  active_channels: string[] | null;
}

export const COVERAGE_ROLLUP_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "rollup", userId ?? "anon"] as const;

export function useCoverageRollup(): { rows: CoverageRollupRow[]; isLoading: boolean } {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: COVERAGE_ROLLUP_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CoverageRollupRow[]> => {
      const { data, error } = await supabase.rpc("coverage_rollup");
      if (error) throw error;
      return ((data ?? []) as unknown as RollupRpcRow[]).map((r) => ({
        userId: r.user_id,
        fullName: r.full_name,
        role: r.role,
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
  return { rows: query.data ?? [], isLoading: query.isLoading };
}
```

- [ ] **Step 4: Run** `pnpm test useCoverageRollup` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/coverage/hooks/useCoverageRollup.ts apps/app/src/features/coverage/hooks/useCoverageRollup.test.tsx
git commit -m "feat(coverage): SP2b useCoverageRollup — read the coverage_rollup RPC"
```

---

### Task 4: `TeamCoverageCard` component (TDD)

**Files:** Create `apps/app/src/features/coverage/components/TeamCoverageCard.tsx` + `.test.tsx`.

- [ ] **Step 1: Write the failing test** `TeamCoverageCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamCoverageCard } from "./TeamCoverageCard";
import type { CoverageRollupRow } from "../lib/teamCoverage";

let rows: CoverageRollupRow[];
vi.mock("../hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows, isLoading: false }),
}));

const row = (over: Partial<CoverageRollupRow> = {}): CoverageRollupRow => ({
  userId: "u", fullName: "Rep", role: "rep", snapshotDate: "2026-06-25",
  compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8, callEventCount: 10,
  activeChannels: ["phone"], ...over,
});

beforeEach(() => { rows = []; });

describe("TeamCoverageCard", () => {
  it("shows the team headline band + reps-with-data and a chip per rep", () => {
    rows = [
      row({ userId: "a", fullName: "Alex", compositeCoverage: 0.82, callEventCount: 30 }),
      row({ userId: "b", fullName: "Sam", compositeCoverage: null, confidenceLevel: null, callEventCount: null }),
    ];
    render(<TeamCoverageCard />);
    expect(screen.getByText(/team logging coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 reps/i)).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText(/no data/i)).toBeInTheDocument(); // Sam's chip
  });

  it("shows the instructional empty state when no rep has gradeable data", () => {
    rows = [row({ fullName: "Sam", compositeCoverage: null, confidenceLevel: null, callEventCount: null })];
    render(<TeamCoverageCard />);
    expect(screen.getByText(/no team coverage data yet/i)).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument(); // roster still shown
  });

  it("renders nothing when there are no reps at all", () => {
    rows = [];
    const { container } = render(<TeamCoverageCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run** `pnpm test TeamCoverageCard` → FAIL.

- [ ] **Step 3: Implement** `TeamCoverageCard.tsx`. (Confirm `Card` accepts `padding`/`shadow` and reuse `bandPresentation` from SP2a as the rep widget does.)
```tsx
/**
 * TeamCoverageCard — SP2b manager/admin rollup on the Team page. Team headline
 * (volume-weighted composite + band + "N of M reps with data") via the pure
 * teamCoverage(), plus a per-rep coverage chip ("No data" for null/insufficient).
 * Scores only — never raw signals. Data-quality framing, never compliance.
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useCoverageRollup } from "../hooks/useCoverageRollup";
import { teamCoverage, isGradeable, type CoverageRollupRow } from "../lib/teamCoverage";
import { bandPresentation } from "../lib/bandPresentation";
import { band } from "../../../../../../supabase/functions/_shared/coverage/score";
import { DEFAULT_COVERAGE_CONFIG } from "../../../../../../supabase/functions/_shared/coverage/config";

function RepChip({ r }: { r: CoverageRollupRow }) {
  if (!isGradeable(r) || r.compositeCoverage === null) {
    return (
      <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-subtle">
        No data
      </span>
    );
  }
  const pres = bandPresentation(band(r.compositeCoverage, DEFAULT_COVERAGE_CONFIG.bandThresholds));
  return (
    <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", pres.pillClass)}>
      {pres.label} {Math.round(r.compositeCoverage * 100)}%
    </span>
  );
}

export function TeamCoverageCard() {
  const { rows } = useCoverageRollup();
  if (rows.length === 0) return null;

  const team = teamCoverage(rows);
  const headline = team.band !== null && team.compositeCoverage !== null
    ? bandPresentation(team.band)
    : null;

  return (
    <Card padding="lg" shadow="sm" className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-heading-sm text-text-default">Team logging coverage</h2>
        {headline && (
          <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-semibold", headline.pillClass)}>
            {headline.label} · {Math.round((team.compositeCoverage as number) * 100)}%
          </span>
        )}
      </div>

      {headline ? (
        <p className="mb-3 text-body-sm text-text-muted">
          Based on {team.repsWithData} of {team.repsTotal} reps with coverage data.
        </p>
      ) : (
        <p className="mb-3 text-body-sm text-text-muted">
          No team coverage data yet — coverage appears as your reps log calls through tap-to-call.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
          >
            <span className="truncate text-label text-text-default">{r.fullName ?? "Unknown"}</span>
            <RepChip r={r} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
```
(Confirm `bandPresentation` is exported from `../lib/bandPresentation` (SP2a) and `Card` accepts `className`; both are used by the rep `CoverageWidget` already.)

- [ ] **Step 4: Run** `pnpm test TeamCoverageCard` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/coverage/components/TeamCoverageCard.tsx apps/app/src/features/coverage/components/TeamCoverageCard.test.tsx
git commit -m "feat(coverage): SP2b TeamCoverageCard — team headline + per-rep chips"
```

---

### Task 5: Wire `TeamCoverageCard` into AgentsPage (TDD)

**Files:** Modify `apps/app/src/features/admin/pages/AgentsPage.tsx`; modify the AgentsPage test if one exists.

- [ ] **Step 1: Render it.** In `AgentsPage.tsx`, import and render `<TeamCoverageCard />` immediately AFTER the `</header>` element and BEFORE the `{isLoading ? … }` block:
```tsx
import { TeamCoverageCard } from "@/features/coverage/components/TeamCoverageCard";
```
```tsx
      </header>

      {/* SP2b — team logging-coverage rollup (manager/admin) */}
      <TeamCoverageCard />

      {isLoading ? (
```

- [ ] **Step 2: Keep the AgentsPage test green.** READ for an existing `AgentsPage.test.tsx` (the mobile-parity work added AgentCard + tests). `AgentsPage` now mounts `TeamCoverageCard` → `useCoverageRollup` → `supabase.rpc("coverage_rollup")`. If a test renders AgentsPage, mock the hook deterministically near the other mocks:
```tsx
vi.mock("@/features/coverage/hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows: [], isLoading: false }),
}));
```
With `rows: []`, `TeamCoverageCard` returns `null`, so it adds nothing to existing assertions (and won't error on the rpc). Keep all existing assertions intact. If NO AgentsPage test exists, note it — the card is covered by its own component test and the wiring is a one-line render.

- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` (FULL) → clean, all green.

- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/admin/pages/AgentsPage.tsx apps/app/src/features/admin/pages/AgentsPage.test.tsx
git commit -m "feat(coverage): show the team coverage rollup on the Team page"
```
(If no AgentsPage test file exists, omit it from the add.)

---

### Final

After all tasks: `pnpm typecheck && pnpm test` (full) → clean/green. Then finishing-a-development-branch (merge + push). **Then the RPC migration is hand-applied to prod with the user's authorization:** `supabase db query --linked -f supabase/migrations/20260625000001_coverage_rollup.sql` → `supabase migration repair --status applied 20260625000001` → smoke-test (call `coverage_rollup` as a manager; verify rows scoped to org, reps-without-snapshot returned null). The frontend is inert until the RPC exists (the hook errors → card shows nothing/empty), so deploy order is safe.

## Notes for the implementer
- DRY: the team headline reuses the shared `composite()`/`band()` (no new aggregation math); chips reuse SP2a `bandPresentation`.
- YAGNI: NO persisted `coverage_aggregate_snapshot`/job, NO badges/warning, NO trend chart — on-read RPC + one card only.
- Privacy: the RPC returns scores only; never expose `coverage_signal`. Manager/admin-gated server-side AND by the page's `RequireRole`.
- `insufficient` confidence is treated as "No data" everywhere (chip + excluded from the team composite), consistent with SP2a.
- Run git from the worktree root; force-add only `docs/`.
