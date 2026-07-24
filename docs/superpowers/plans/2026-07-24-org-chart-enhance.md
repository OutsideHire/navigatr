# Org Chart Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Enhance `OrgChartTree` with connector rails, initials avatars, role chips, and direct-report counts, keeping the indented structure, expand/collapse, click-through, and accessibility.

**Tech Stack:** React + TS, Tailwind tokens, `@/components/navigatr` (Avatar, Badge), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-24-org-chart-enhance-design.md`

**Verified facts:**
- `OrgChartTree.tsx` renders `buildOrgTree(rows)` as nested `<ul>/<li>`. `TreeNode` currently indents via inline `style={{ paddingLeft: depth * 20 + 4 }}` and renders: chevron button (if children) | spacer, then a name button containing the name + a muted role label + optional status Badge.
- `buildOrgTree` (orgTree.ts) is unchanged; `node.children.length` = direct reports; `node.children` are already sorted.
- `Avatar` (`@/components/navigatr`) API: `<Avatar alt={name} size="xs" />` renders 24px circle with initials derived from `alt` (e.g. "Sam Vance" → "SV") and a deterministic per-name accent color. Initials render as visible text.
- Keep the file's `ROLE_LABEL` / `roleLabel` / `STATUS_HINT` helpers and the `OrgChartTree` wrapper (root `<ul className="list-none">`, collapse state, empty state) UNCHANGED. Only the `TreeNode` render + one import change.
- Tokens in use elsewhere and safe here: `border-border-subtle`, `text-caption`, `text-text-muted`, `rounded-radius-full`, `bg-surface-sunken`.

---

## Task 1: Enhance TreeNode (rails, avatar, role chip, report count)

**Files:**
- Modify: `apps/app/src/features/admin/components/OrgChartTree.tsx`
- Test: `apps/app/src/features/admin/components/OrgChartTree.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrgChartTree } from "./OrgChartTree";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

function row(agent_id: string, full_name: string, role_level: string, manager_id: string | null): LeaderboardRow {
  return {
    agent_id, full_name, email: `${agent_id}@x.com`, role: "manager", role_level,
    status: "active", manager_id, open_deals: 0, pipeline_cents: 0, won_deals_window: 0,
    won_cents_window: 0, lost_deals_window: 0, lost_cents_window: 0, activities_window: 0,
    last_activity: null,
  } as LeaderboardRow;
}

const rows: LeaderboardRow[] = [
  row("u_sam", "Sam Vance", "svp_sales", null),
  row("u_vic", "Victor Pratt", "vp_sales", "u_sam"),
  row("u_vera", "Vera Powell", "vp_sales", "u_sam"),
];

describe("OrgChartTree", () => {
  it("shows a manager's direct-report count with pluralization", () => {
    render(<OrgChartTree rows={rows} />);
    expect(screen.getByText("2 reports")).toBeInTheDocument();
  });

  it("uses the singular 'report' for one direct report", () => {
    render(<OrgChartTree rows={[row("u_sam", "Sam Vance", "svp_sales", null), row("u_vic", "Victor Pratt", "vp_sales", "u_sam")]} />);
    expect(screen.getByText("1 report")).toBeInTheDocument();
  });

  it("does not show a report count on a leaf node", () => {
    render(<OrgChartTree rows={rows} />);
    expect(screen.queryByText(/0 report/)).not.toBeInTheDocument();
  });

  it("renders an initials avatar and a role chip for a person", () => {
    render(<OrgChartTree rows={rows} />);
    expect(screen.getByText("SV")).toBeInTheDocument();          // Sam Vance initials
    expect(screen.getByText("SVP of Sales")).toBeInTheDocument(); // role chip
  });

  it("fires onSelect with the agent id when a name is clicked", () => {
    const onSelect = vi.fn();
    render(<OrgChartTree rows={rows} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Sam Vance"));
    expect(onSelect).toHaveBeenCalledWith("u_sam");
  });

  it("collapses a branch when the chevron is clicked", () => {
    render(<OrgChartTree rows={rows} />);
    expect(screen.getByText("Victor Pratt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Collapse Sam Vance/i }));
    expect(screen.queryByText("Victor Pratt")).not.toBeInTheDocument();
  });
});
```

> Note: Victor Pratt and Vera Powell both derive initials "VP" and share the role label "VP of Sales", so the assertions deliberately use the unique "Sam Vance" values ("SV", "SVP of Sales"). Keep it that way.

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter app test -- OrgChartTree`
Expected: FAIL (no "2 reports", no "SV" avatar, no role chip, etc.).

- [ ] **Step 3: Implement**

Add `Avatar` to the navigatr import (it currently imports `Badge` only):

```tsx
import { Avatar, Badge } from "@/components/navigatr";
```

Update the file header comment to mention the new affordances (rails, avatars, report counts). Then replace the `TreeNode` component with this version (helpers `ROLE_LABEL`/`roleLabel`/`STATUS_HINT` above it and the `OrgChartTree` wrapper below it stay UNCHANGED):

```tsx
function TreeNode({
  node,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: OrgTreeNode<LeaderboardRow>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect?: (agentId: string) => void;
}) {
  const { row, children } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(row.agent_id);
  const hint = STATUS_HINT[row.status];
  const name = row.full_name ?? row.email;

  return (
    <li>
      <div className="flex items-center gap-2 rounded-radius-sm py-1.5 pr-2 hover:bg-surface-sunken">
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${name}` : `Collapse ${name}`}
            onClick={() => onToggle(row.agent_id)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => onSelect?.(row.agent_id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-radius-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <Avatar alt={name} size="xs" />
          <span className="truncate text-body-md font-medium text-text-default hover:underline">{name}</span>
          <span className="shrink-0 rounded-radius-full border border-border-subtle px-2 py-0.5 text-caption text-text-muted">
            {roleLabel(row.role_level)}
          </span>
          {hasChildren && (
            <span className="shrink-0 text-caption text-text-muted">
              {children.length} {children.length === 1 ? "report" : "reports"}
            </span>
          )}
          {hint && (
            <Badge kind={hint.kind} className="shrink-0">
              {hint.label}
            </Badge>
          )}
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="ml-2 list-none border-l border-border-subtle pl-3">
          {children.map((child) => (
            <TreeNode
              key={child.row.agent_id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
```

Key changes vs the old version: dropped the inline `paddingLeft` depth math (indentation now comes from the nested `<ul>`'s `ml-2 border-l border-border-subtle pl-3` rail); added `<Avatar alt={name} size="xs" />`; the role label is now a bordered chip; a direct-report count renders for nodes with children. `depth` is no longer destructured or used (leave the `OrgTreeNode` type as-is).

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter app test -- OrgChartTree`
Expected: PASS (6/6).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter app typecheck` → clean. (If TS flags `depth` as unused anywhere, it was only used in the old inline style, which is now gone; ensure no leftover reference.)

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/components/OrgChartTree.tsx apps/app/src/features/admin/components/OrgChartTree.test.tsx
git commit -m "feat(team): enhance org chart with rails, avatars, role chips, report counts"
```

(Body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

---

## Task 2: Full suite, typecheck, ship

- [ ] **Step 1:** `pnpm --filter app typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter app test` → all pass; no existing org-chart / AgentsPage tests break (if an existing OrgChartTree test asserted the old bare markup or `paddingLeft`, update it minimally to the new structure and note it).
- [ ] **Step 3:** Push to main: `git push origin HEAD:main` (frontend-only, no migration).
- [ ] **Step 4: Visual check** (after deploy) on the demo org's 7-layer tree: connector rails trace each branch; initials avatars anchor each person; managers show a "N reports" count; role chips read cleanly; expand/collapse and click-to-detail still work; nothing overflows horizontally and it still reads on mobile width.
