# Team Page Reporting-Tree Scoping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the Team page to the caller's reporting subtree by adding the existing `user_can_see_owner` visibility rule to the `team_leaderboard` RPC, plus a "no reports yet" hint for solo managers. Admins keep full-org visibility.

**Architecture:** One SQL change (WHERE-clause additions to `team_leaderboard`, shipped as a new migration and pasted into Supabase). One tiny client helper + empty-state hint. No frontend contract change (RPC signature/columns unchanged).

**Tech Stack:** Supabase Postgres (plpgsql RPC, ltree role_path), React + TS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-team-page-scoping-design.md`

**Key facts (verified in repo):**
- `team_leaderboard(int)` current definition: `supabase/migrations/20260722000004_team_leaderboard_role_level.sql`. `security definer`, gated to `v_caller in ('manager','admin')`. Two unioned arms: members from `profiles` (`where p.org_id = v_org_id`), invites from `org_invites` (`where oi.org_id = v_org_id and oi.accepted_at is null and oi.revoked_at is null`).
- `public.user_can_see_owner(uuid)` and `public.caller_role_path()` exist (migration `20260529000001_role_hierarchy_rls.sql`); admins have NULL role_path so `user_can_see_owner` returns true for them across the org.
- `admin_set_manager(uuid,uuid)` already calls `rebuild_role_path_subtree` when a reporting line changes (migration `20260714000004_reporting_hierarchy.sql:104-115`), so scoping takes effect immediately after assigning a manager. No change needed there; just QA it.
- Team page: `apps/app/src/features/admin/pages/AgentsPage.tsx` consumes `useTeamLeaderboard(windowDays)` → `LeaderboardRow[]` and renders a list or `OrgChartTree`. `LeaderboardRow` has `agent_id`, `status: "active"|"invited"|"revoked"`, etc.

---

## Task 1: Scope the team_leaderboard RPC (SQL migration)

**Files:**
- Create: `supabase/migrations/20260723000002_team_leaderboard_scope_subtree.sql`

Note: database functions are not covered by vitest, so this task has no unit test; it is verified by manual QA in Task 3. The migration is applied by pasting into the Supabase SQL editor (repo file is the source of record).

- [ ] **Step 1: Create the migration by copying the current function verbatim and adding exactly two scoping clauses**

Open `supabase/migrations/20260722000004_team_leaderboard_role_level.sql`, copy the ENTIRE `create or replace function team_leaderboard(...) ... end $$;` block (lines ~11-142) plus the trailing `grant execute` line VERBATIM into the new migration file, then make these two edits (and ONLY these two) inside the copied body:

1. **Members arm** — find:
```sql
  from profiles p
  left join deal_aggs     da on da.owner_id  = p.id
  left join activity_aggs aa on aa.logged_by = p.id
  where p.org_id = v_org_id
```
Change the final line to:
```sql
  where p.org_id = v_org_id
    and public.user_can_see_owner(p.id)
```

2. **Invites arm** — find:
```sql
  from org_invites oi
  where oi.org_id    = v_org_id
    and oi.accepted_at is null
    and oi.revoked_at  is null;
```
Change it to:
```sql
  from org_invites oi
  where oi.org_id    = v_org_id
    and oi.accepted_at is null
    and oi.revoked_at  is null
    and (
      public.caller_role_path() is null
      or (oi.manager_id is not null and public.user_can_see_owner(oi.manager_id))
    );
```

Prefix the new migration file with a comment block explaining intent:
```sql
-- Scope team_leaderboard to the caller's reporting subtree.
-- Reuses public.user_can_see_owner (role_path ltree). Admins (NULL role_path)
-- keep full-org visibility via the predicate's NULL-caller fallback. A manager
-- with a role_path sees self + descendants only. Pending invites are scoped by
-- the visibility of their assigned manager; admins/unplaced callers see all
-- invites. Signature and return columns are unchanged (WHERE-clause only), so
-- the frontend contract is unchanged.
-- Apply: paste this whole file into the Supabase SQL editor.
```

Do NOT change the function signature, return columns, the `deal_aggs`/`activity_aggs` CTEs, the `security definer`/`set search_path`, the caller gate, or the `grant execute`. Two WHERE-clause edits only.

- [ ] **Step 2: Sanity-check the SQL locally (syntax only)**

There is no local Postgres in CI; do a careful visual diff against the source function to confirm only the two clauses changed and the `create or replace` block is complete (balanced `$$ ... $$`, ends with `end $$;` then the `grant`). Confirm `user_can_see_owner` and `caller_role_path` are referenced with the `public.` schema prefix.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260723000002_team_leaderboard_scope_subtree.sql
git commit -m "feat(hierarchy): scope team_leaderboard to caller reporting subtree"
```

(Body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

---

## Task 2: "No reports yet" solo-team hint (client)

**Files:**
- Create: `apps/app/src/features/admin/lib/teamScope.ts`
- Test: `apps/app/src/features/admin/lib/teamScope.test.ts`
- Modify: `apps/app/src/features/admin/pages/AgentsPage.tsx`

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
import { describe, it, expect } from "vitest";
import { hasNoReports } from "./teamScope";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

function row(agent_id: string, status: LeaderboardRow["status"]): LeaderboardRow {
  return { agent_id, status } as LeaderboardRow;
}

describe("hasNoReports", () => {
  it("is true when the only active member is the current user", () => {
    expect(hasNoReports([row("me", "active")], "me")).toBe(true);
  });
  it("is true when the user is alone even with pending invites present", () => {
    expect(hasNoReports([row("me", "active"), row("inv", "invited")], "me")).toBe(true);
  });
  it("is false when another active member exists", () => {
    expect(hasNoReports([row("me", "active"), row("rep", "active")], "me")).toBe(false);
  });
  it("is false when there are no rows at all (nothing loaded yet)", () => {
    expect(hasNoReports([], "me")).toBe(false);
  });
  it("is false when the current user id is unknown", () => {
    expect(hasNoReports([row("me", "active")], undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter app test -- teamScope`
Expected: FAIL (no module).

- [ ] **Step 3: Implement the helper**

```ts
/**
 * Team page scoping helpers. `team_leaderboard` is scoped server-side to the
 * caller's reporting subtree, so a manager with no reports gets back only their
 * own row. This detects that "solo" case to show a "no reports yet" hint
 * instead of an org chart of one.
 */
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

/**
 * True when the current user is the only ACTIVE member in the returned rows
 * (pending invites do not count as reports). False when rows are empty (data
 * not loaded) or the current user id is unknown.
 */
export function hasNoReports(rows: LeaderboardRow[], currentUserId: string | undefined): boolean {
  if (!currentUserId || rows.length === 0) return false;
  const otherActive = rows.some((r) => r.status === "active" && r.agent_id !== currentUserId);
  const selfPresent = rows.some((r) => r.agent_id === currentUserId);
  return selfPresent && !otherActive;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter app test -- teamScope`
Expected: PASS (5/5).

- [ ] **Step 5: Render the hint in AgentsPage**

In `apps/app/src/features/admin/pages/AgentsPage.tsx`:
- Import the helper: `import { hasNoReports } from "../lib/teamScope";`
- The page already has `const userId = useAuth((s) => s.user?.id);` and `const { data: rows = [], isLoading } = useTeamLeaderboard(windowDays);`. Compute after those:
```tsx
  const soloTeam = !isLoading && hasNoReports(rows, userId);
```
- Render a quiet hint once, just above the list/org view switch (match the page's existing muted-text / card styling — reuse the same classes sibling empty states use in this file). Example element:
```tsx
  {soloTeam && (
    <p className="text-body-sm text-text-muted" role="status">
      No one reports to you yet. As you assign reps to your team, they will appear here.
    </p>
  )}
```
Place it so it shows in both the list and org-chart views (i.e., outside the `view === "org"` branch). Do not otherwise change the existing rendering. Keep copy free of em/en dashes.

- [ ] **Step 6: Typecheck + targeted tests**

Run: `pnpm --filter app typecheck` (clean)
Run: `pnpm --filter app test -- teamScope` (pass)

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/admin/lib/teamScope.ts apps/app/src/features/admin/lib/teamScope.test.ts apps/app/src/features/admin/pages/AgentsPage.tsx
git commit -m "feat(team): solo-manager 'no reports yet' hint"
```

---

## Task 3: Full suite, typecheck, deploy handoff, QA

- [ ] **Step 1: Full typecheck + test suite**

Run: `pnpm --filter app typecheck` → clean.
Run: `pnpm --filter app test` → all pass; no existing Team page / org-tree tests break.

- [ ] **Step 2: Produce the SQL paste block for the user**

Print the full contents of `supabase/migrations/20260723000002_team_leaderboard_scope_subtree.sql` as a single fenced `sql` block so the user can paste it into the Supabase SQL editor. State plainly: this replaces the `team_leaderboard` function; run it once; it returns "Success. No rows returned."

- [ ] **Step 3: Push the frontend commits to main**

Only after the user confirms they will run (or have run) the SQL. Push the branch commits to main (`git push origin HEAD:main`) so the client hint deploys. (The client change is harmless without the SQL; the SQL is harmless without the client change.)

- [ ] **Step 4: Manual QA checklist (in the app, after SQL applied + deploy)**

- As an admin (`ceo@outsidehire.com`): Team page still shows the full org (list + org chart). Unchanged.
- As a manager with reports (use a demo-org manager, or set a reporting line via the Team UI): Team page shows only self + their subtree, in BOTH list and org-chart views; pending invites limited to their team.
- As a manager with no reports: shows only their own row plus the "No one reports to you yet" hint.
- Assign a rep to a manager via the reports-to picker, confirm the rep appears under that manager immediately (verifies `admin_set_manager` rebuilds role_path).
- Confirm no console errors and the org chart re-roots on the manager.

- [ ] **Step 5: Note any QA finding**

If a manager still sees the whole org after the SQL is applied, their `role_path` is NULL (not placed in the tree). Fix by setting their reporting line in the Team UI (which calls `admin_set_manager` → `rebuild_role_path_subtree`). This is data setup, not a code bug. Report it to the user rather than widening the query.
