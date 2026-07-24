# Team Page Declutter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Declutter the Team page: collapse the coverage card when empty and move it below the roster, make each person one truncated line, mute zero-value metrics, and regroup the header. Frontend-only, no restyle.

**Tech Stack:** React + TS, Tailwind design tokens, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-24-team-page-declutter-design.md`

**Verified facts:**
- `AgentListRow.tsx` (desktop table row): email at line ~66 is `<td className="px-3 py-2 text-body-md text-text-muted">{row.email}</td>` (NO truncation → wraps). Metric cells: open_deals, pipeline (`formatMoney(row.pipeline_cents)`), won (`formatMoney(row.won_cents_window)` + `(row.won_deals_window)`), lost, win-rate (already "—" when no deals), activities (`row.activities_window`). Does NOT currently import `cn`.
- `AgentCard.tsx` (mobile): email already truncates (`min-w-0` col + `truncate`). Stats: open_deals, pipeline, win rate via `Stat`. Imports `formatMoney`; not `cn`.
- `TeamCoverageCard.tsx`: always renders a `<ul>` over ALL `rows` with a "No data" chip for ungradeable reps. `isGradeable(r)` imported; a rep is gradeable-with-data when `isGradeable(r) && r.compositeCoverage !== null`. Card has `className="mb-4"`.
- `AgentsPage.tsx`: `<TeamCoverageCard />` renders at line ~242 (ABOVE the roster). `SeatUsageBadge` sits in the right control cluster (line ~236). The roster (list/cards or OrgChartTree) renders in the `{isLoading ? ... : view === "org" ? ... : ...}` block after the soloTeam hint. `WINDOW_OPTIONS`, `Button`, `SeatUsageBadge`, `TeamCoverageCard` already imported.

---

## Task 1: Zero-metric display helper

**Files:**
- Create: `apps/app/src/features/admin/lib/metricDisplay.ts`
- Test: `apps/app/src/features/admin/lib/metricDisplay.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { isZeroMetric } from "./metricDisplay";

describe("isZeroMetric", () => {
  it("is true for exactly zero", () => {
    expect(isZeroMetric(0)).toBe(true);
  });
  it("is false for any positive value", () => {
    expect(isZeroMetric(1)).toBe(false);
    expect(isZeroMetric(30800000)).toBe(false);
  });
  it("is false for negative values (treat as real data)", () => {
    expect(isZeroMetric(-5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `pnpm --filter app test -- metricDisplay` → FAIL (no module).

- [ ] **Step 3: Implement**

```ts
/**
 * Team roster metric display helpers. A "zero" metric (no pipeline, no deals,
 * no activity) is dimmed so the real numbers stand out. Negative is treated as
 * real data (dimming is only for the empty case).
 */
export function isZeroMetric(value: number): boolean {
  return value === 0;
}
```

- [ ] **Step 4: Run, verify passes**

Run: `pnpm --filter app test -- metricDisplay` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/admin/lib/metricDisplay.ts apps/app/src/features/admin/lib/metricDisplay.test.ts
git commit -m "feat(team): isZeroMetric helper for dimming empty roster metrics"
```

(Body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

---

## Task 2: Coverage card collapses when empty, lists only reps with data

**Files:**
- Modify: `apps/app/src/features/coverage/components/TeamCoverageCard.tsx`
- Test: `apps/app/src/features/coverage/components/TeamCoverageCard.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Mock `useCoverageRollup` to control rows. `CoverageRollupRow` shape: has `userId`, `fullName`, `compositeCoverage: number | null`, and whatever `isGradeable` checks (an ungradeable/no-data row has `compositeCoverage === null`). Read `../lib/teamCoverage` to confirm `CoverageRollupRow` fields and what makes `isGradeable` true; build fixtures accordingly.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamCoverageCard } from "./TeamCoverageCard";

let mockRows: any[] = [];
vi.mock("../hooks/useCoverageRollup", () => ({ useCoverageRollup: () => ({ rows: mockRows }) }));

describe("TeamCoverageCard", () => {
  it("shows only the empty state and no per-member rows when nobody has data", () => {
    mockRows = [
      { userId: "a", fullName: "Dana Cross", compositeCoverage: null },
      { userId: "b", fullName: "Riley Cole", compositeCoverage: null },
    ];
    render(<TeamCoverageCard />);
    expect(screen.getByText(/No team coverage data yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Dana Cross")).not.toBeInTheDocument();
    expect(screen.queryByText("Riley Cole")).not.toBeInTheDocument();
  });

  it("lists only reps that have coverage data", () => {
    mockRows = [
      { userId: "a", fullName: "Dana Cross", compositeCoverage: null },
      { userId: "b", fullName: "Riley Cole", compositeCoverage: 0.82, /* plus any fields isGradeable needs */ },
    ];
    render(<TeamCoverageCard />);
    expect(screen.queryByText("Dana Cross")).not.toBeInTheDocument();
    expect(screen.getByText("Riley Cole")).toBeInTheDocument();
  });
});
```

> Before finalizing: read `apps/app/src/features/coverage/lib/teamCoverage.ts` to learn exactly what fields `isGradeable` requires, and add them to the "Riley Cole" fixture so `isGradeable` returns true. If `isGradeable` needs more than `compositeCoverage`, the fixture must satisfy it. Adjust the fixture, NOT the assertions.

- [ ] **Step 2: Run, verify fails**

Run: `pnpm --filter app test -- TeamCoverageCard` → FAIL (lists members / no collapse).

- [ ] **Step 3: Implement**

In `TeamCoverageCard.tsx`, after `const team = teamCoverage(rows);` compute the reps that actually have data, and render the list only over them; when there are none, render the empty state with no list. Replace the `<ul>...</ul>` block so it is conditional. Concretely:

```tsx
  const team = teamCoverage(rows);
  const headline =
    team.band !== null && team.compositeCoverage !== null ? bandPresentation(team.band) : null;
  const repsWithData = rows.filter((r) => isGradeable(r) && r.compositeCoverage !== null);
```

Keep the header + the headline/empty `<p>` exactly as-is, then change the list region to:

```tsx
      {repsWithData.length > 0 && (
        <ul className="flex flex-col gap-2">
          {repsWithData.map((r) => (
            <li
              key={r.userId}
              className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
            >
              <span className="truncate text-label text-text-default">{r.fullName ?? "Unknown"}</span>
              <RepChip r={r} />
            </li>
          ))}
        </ul>
      )}
```

Also change the card wrapper margin for its new below-roster home: `className="mb-4"` → `className="mt-6"`. (`RepChip` is unchanged; ungradeable reps now simply never render, so the "No data" chip path only remains for a rep that is gradeable-but-null, which `repsWithData` already excludes — that's fine, leave RepChip as-is.)

- [ ] **Step 4: Run, verify passes**

Run: `pnpm --filter app test -- TeamCoverageCard` → PASS. Also `pnpm --filter app test -- coverage` to catch any existing coverage test that asserted the old "No data" list (update those assertions if they legitimately changed, and note it).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/coverage/components/TeamCoverageCard.tsx apps/app/src/features/coverage/components/TeamCoverageCard.test.tsx
git commit -m "feat(team): collapse coverage card when empty; list only reps with data"
```

---

## Task 3: Single-line truncated email + dimmed zero metrics (row + card)

**Files:**
- Modify: `apps/app/src/features/admin/components/AgentListRow.tsx`
- Modify: `apps/app/src/features/admin/components/AgentCard.tsx`
- Test: `apps/app/src/features/admin/components/AgentListRow.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentListRow } from "./AgentListRow";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

const base: LeaderboardRow = {
  agent_id: "u1", full_name: "Rosa Kim",
  email: "demo-rep2-3ac28035-7ab6-46c1-855c-70011b01f60f@navigatr-demo.local",
  role: "rep", role_level: "sales_professional", status: "active", manager_id: null,
  open_deals: 0, pipeline_cents: 0, won_deals_window: 0, won_cents_window: 0,
  lost_deals_window: 0, lost_cents_window: 0, activities_window: 0, last_activity: null,
} as LeaderboardRow;

function renderRow(row: LeaderboardRow) {
  const noop = () => {};
  return render(
    <table><tbody>
      <AgentListRow row={row} onNameClick={noop} onViewPipeline={noop} onResend={noop}
        onRevoke={noop} onSetRole={noop} callerRole="admin" selfId="admin" activeAdminCount={1} />
    </tbody></table>,
  );
}

describe("AgentListRow", () => {
  it("renders the email on one truncated line with the full value as a title", () => {
    renderRow(base);
    const email = screen.getByText(base.email);
    expect(email).toHaveAttribute("title", base.email);
    expect(email.className).toMatch(/truncate/);
  });

  it("dims metric cells that are zero", () => {
    const { container } = renderRow(base); // all-zero fixture
    expect(container.querySelectorAll("td.text-text-subtle").length).toBeGreaterThan(0);
  });

  it("does not dim the pipeline cell when it is non-zero", () => {
    renderRow({ ...base, pipeline_cents: 30800000 });
    const cell = screen.getByText("$308K").closest("td")!;
    expect(cell.className).not.toMatch(/text-text-subtle/);
  });
});
```

> Confirm `formatMoney(30800000)` renders `"$308K"` in `@/features/pipeline/mockData`; if the exact string differs, update the test's expected string (not the behavior). The all-zero fixture makes pipeline/open/won/lost/activities render dimmed, so the first test asserts "at least one dimmed cell"; the second uses the unique `$308K` value so the query is unambiguous.

- [ ] **Step 2: Run, verify fails**

Run: `pnpm --filter app test -- AgentListRow` → FAIL.

- [ ] **Step 3: Implement in AgentListRow.tsx**

Add `import { cn } from "@/lib/utils";` and `import { isZeroMetric } from "../lib/metricDisplay";`.

Email cell (was `<td className="px-3 py-2 text-body-md text-text-muted">{row.email}</td>`):

```tsx
      <td className="px-3 py-2 text-body-md text-text-muted">
        <span className="block max-w-[220px] truncate" title={row.email}>{row.email}</span>
      </td>
```

Open deals cell:

```tsx
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.open_deals) && "text-text-subtle")}>{row.open_deals}</td>
```

Pipeline cell:

```tsx
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.pipeline_cents) && "text-text-subtle")}>{formatMoney(row.pipeline_cents)}</td>
```

Won cell (when fully zero, render a dimmed `$0` and drop the `(count)` suffix, no dash glyph):

```tsx
      <td className={cn("px-3 py-2 text-body-md tabular-nums", row.won_cents_window === 0 && row.won_deals_window === 0 && "text-text-subtle")}>
        {formatMoney(row.won_cents_window)}
        {(row.won_cents_window !== 0 || row.won_deals_window !== 0) && (
          <span className="text-text-muted"> ({row.won_deals_window})</span>
        )}
      </td>
```

Lost cell (same pattern with `lost_cents_window` / `lost_deals_window`).

Activities cell:

```tsx
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.activities_window) && "text-text-subtle")}>{row.activities_window}</td>
```

Win-rate cell: it already computes an empty label when there are no deals. Wrap the value in a dimmed span when there are no deals, keyed off the counts (do NOT compare against the dash string): `(row.won_deals_window + row.lost_deals_window) === 0`. A real percentage stays at default emphasis. Leave the existing empty-label glyph itself unchanged (do not introduce any new dash characters).

- [ ] **Step 4: Mirror the dimming in AgentCard.tsx**

Add `import { cn } from "@/lib/utils";` and `import { isZeroMetric } from "../lib/metricDisplay";`. The email already truncates (leave it). Dim the three `Stat` values when zero by passing a dimmed node, e.g.:

```tsx
        <Stat label="Open deals" value={<span className={cn(isZeroMetric(row.open_deals) && "text-text-subtle")}>{row.open_deals}</span>} />
        <Stat label="Pipeline" value={<span className={cn(isZeroMetric(row.pipeline_cents) && "text-text-subtle")}>{formatMoney(row.pipeline_cents)}</span>} />
        <Stat label="Win rate" value={<span className={cn((row.won_deals_window + row.lost_deals_window) === 0 && "text-text-subtle")}>{winRateLabel(row)}</span>} />
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter app test -- AgentListRow` → PASS.
Run: `pnpm --filter app typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/components/AgentListRow.tsx apps/app/src/features/admin/components/AgentCard.tsx apps/app/src/features/admin/components/AgentListRow.test.tsx
git commit -m "feat(team): single-line truncated email + dimmed zero metrics"
```

---

## Task 4: Move coverage below roster + demote seat count in header

**Files:**
- Modify: `apps/app/src/features/admin/pages/AgentsPage.tsx`

- [ ] **Step 1: Move the coverage card below the roster**

Delete the `<TeamCoverageCard />` that renders at ~line 242 (above the roster) and re-insert it AFTER the `{isLoading ? ... : view === "org" ? ... : (...)}` roster block, just before the `{revokeDialogAgent && ...}` dialog. Keep the `{soloTeam && ...}` hint where it is (above the roster). Add a comment noting coverage is a secondary insight shown under the roster.

- [ ] **Step 2: Demote the seat count to a quiet chip near the title**

Move `<SeatUsageBadge />` out of the right-hand control cluster (remove the `<div className="ml-2 border-l border-border-subtle pl-3"><SeatUsageBadge /></div>` from the actions group) and place it next to the `<h1>Team</h1>` on the left, e.g.:

```tsx
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-heading-lg text-text-default">Team</h1>
          <SeatUsageBadge />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Invite (primary) + Import (secondary) */}
          {/* then the view toggle group and the window group, unchanged */}
        </div>
      </header>
```

Leave the Invite/Import buttons and the view/window grouped clusters as they are (they already use border-left separators). Do not change their behavior. If `SeatUsageBadge` looks too heavy on the left, that is fine to leave, the goal is only to stop it competing at the far right of the actions.

- [ ] **Step 3: Verify**

Run: `pnpm --filter app test -- AgentsPage` → still passes (update any assertion that depended on coverage/seat position only if it legitimately moved; note it).
Run: `pnpm --filter app typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/admin/pages/AgentsPage.tsx
git commit -m "feat(team): coverage below roster; seat count demoted to a quiet chip"
```

---

## Task 5: Full suite, typecheck, ship

- [ ] **Step 1:** `pnpm --filter app typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter app test` → all pass; no pre-existing Team/coverage tests left broken.
- [ ] **Step 3:** Push to main: `git push origin HEAD:main` (frontend-only, no migration).
- [ ] **Step 4: Visual check in the app** (after deploy): roster is the headline; each person is one line; long demo emails truncate with a hover tooltip; zeros are dimmed; the coverage card sits below the roster and shows only the one-line empty state when there is no data; the seat count reads as a quiet chip by the title.
