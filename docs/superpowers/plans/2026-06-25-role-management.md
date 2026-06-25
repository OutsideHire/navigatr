# Member role management (promote / demote) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let admins change a member's role (rep/manager/admin) from the Team page via a real `admin_set_role` RPC + role-change menu items, with no-self-change and no-sole-admin-demotion guards.

**Architecture:** An admin-only SECURITY DEFINER `admin_set_role` RPC (mirrors `admin_revoke_member`). A pure `settableRoles`/`roleChangeLabel` helper drives the menu affordances; a `useSetMemberRole` hook calls the RPC + invalidates the leaderboard. AgentListRow/AgentCard render the role items; AgentsPage wires a confirm + the mutation. `role_path` is untouched (visibility unchanged).

**Tech Stack:** Supabase Postgres RPC, React + TypeScript, TanStack Query, Radix DropdownMenu, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-role-management-design.md`

Run pnpm from `.../apps/app`. Run `git` as its OWN command from the worktree ROOT `/Users/ryanmeo/navigatr/.claude/worktrees/role-mgmt`. (`docs/` is gitignored → force-add docs only.)

---

### Task 1: `admin_set_role` RPC migration

**Files:** Create `supabase/migrations/20260625000002_admin_set_role.sql`.

DB migration — no vitest (consistent with sibling admin RPCs); hand-applied to prod with the user's authorization. Mirror `admin_revoke_member` in `supabase/migrations/20260523000002_admin_portal_rpcs.sql`.

- [ ] **Step 1: READ** `admin_revoke_member` in `20260523000002_admin_portal_rpcs.sql` (the `not_authenticated` / `select org+role` / `forbidden` / `cannot_deactivate_self` idioms + the `grant execute … to authenticated` footer). Confirm `user_role` enum = `('rep','manager','admin')` and `profiles` has `role`, `org_id`, `deactivated_at`.

- [ ] **Step 2: Write** `supabase/migrations/20260625000002_admin_set_role.sql`:
```sql
-- admin_set_role: change a member's role (rep/manager/admin). Admin-only.
-- Mirrors admin_revoke_member's authz. Guards: not self, not the sole admin's
-- demotion. role_path (reporting hierarchy) is NOT touched here — visibility
-- (deals/activities RLS, coverage rollup) is unchanged.

create or replace function admin_set_role(p_profile_id uuid, p_new_role user_role)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_target_role user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'admin' then
    raise exception 'forbidden';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'cannot_change_own_role';
  end if;

  select p.role into v_target_role
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target_role is null then
    raise exception 'profile_not_found';
  end if;

  if v_target_role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from profiles
            where org_id = v_org_id and role = 'admin' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  update profiles set role = p_new_role where id = p_profile_id and org_id = v_org_id;
end $$;

grant execute on function admin_set_role(uuid, user_role) to authenticated;
```
(If `admin_revoke_member` uses a different soft-delete column or auth idiom, MATCH it + report.)

- [ ] **Step 3: Verify.** Run: `grep -cE "raise exception|security definer|grant execute" supabase/migrations/20260625000002_admin_set_role.sql` → expect `7` (5 raises + 1 security definer + 1 grant). Confirm `role_path` does NOT appear in the file (`grep -c role_path … ` → `0`).

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260625000002_admin_set_role.sql
git commit -m "feat(admin): admin_set_role RPC — admin-only role change with self + sole-admin guards"
```

---

### Task 2: `roleActions` pure helpers (TDD)

**Files:** Create `apps/app/src/features/admin/lib/roleActions.ts` + `.test.ts`.

- [ ] **Step 1: Write the failing test** `roleActions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { settableRoles, roleChangeLabel, type UserRole } from "./roleActions";

const t = (over: Partial<{ id: string; role: UserRole; status: "active" | "invited" | "revoked" }> = {}) => ({
  id: "u2", role: "rep" as UserRole, status: "active" as const, ...over,
});
const ctx = (over: Partial<{ selfId: string | undefined; activeAdminCount: number }> = {}) => ({
  selfId: "me", activeAdminCount: 2, ...over,
});

describe("settableRoles", () => {
  it("offers nothing to a non-admin caller", () => {
    expect(settableRoles("manager", t(), ctx())).toEqual([]);
    expect(settableRoles("rep", t(), ctx())).toEqual([]);
  });
  it("offers the two other roles to an admin", () => {
    expect(settableRoles("admin", t({ role: "rep" }), ctx())).toEqual(["manager", "admin"]);
    expect(settableRoles("admin", t({ role: "manager" }), ctx())).toEqual(["rep", "admin"]);
  });
  it("offers nothing for the caller's own row", () => {
    expect(settableRoles("admin", t({ id: "me" }), ctx({ selfId: "me" }))).toEqual([]);
  });
  it("offers nothing for an inactive member", () => {
    expect(settableRoles("admin", t({ status: "invited" }), ctx())).toEqual([]);
    expect(settableRoles("admin", t({ status: "revoked" }), ctx())).toEqual([]);
  });
  it("suppresses demoting the sole active admin", () => {
    expect(settableRoles("admin", t({ role: "admin" }), ctx({ activeAdminCount: 1 }))).toEqual([]);
    expect(settableRoles("admin", t({ role: "admin" }), ctx({ activeAdminCount: 2 }))).toEqual(["rep", "manager"]);
  });
});

describe("roleChangeLabel", () => {
  it("labels elevations as Promote and reductions as Demote", () => {
    expect(roleChangeLabel("rep", "manager")).toBe("Promote to manager");
    expect(roleChangeLabel("rep", "admin")).toBe("Promote to admin");
    expect(roleChangeLabel("admin", "manager")).toBe("Demote to manager");
    expect(roleChangeLabel("manager", "rep")).toBe("Demote to rep");
  });
});
```

- [ ] **Step 2: Run** `pnpm test roleActions` → FAIL.

- [ ] **Step 3: Implement** `roleActions.ts`:
```ts
/**
 * Role-management affordance helpers (admin-only role changes). Pure — the UI
 * uses these to decide which role-change menu items to show; the admin_set_role
 * RPC enforces the same rules authoritatively server-side.
 */
export type UserRole = "rep" | "manager" | "admin";

type LeaderboardStatus = "active" | "invited" | "revoked";

const ALL_ROLES: UserRole[] = ["rep", "manager", "admin"];
const RANK: Record<UserRole, number> = { rep: 0, manager: 1, admin: 2 };

/** Roles an admin caller may set for `target` (drives the row's menu items). */
export function settableRoles(
  callerRole: UserRole | undefined,
  target: { id: string; role: UserRole; status: LeaderboardStatus },
  ctx: { selfId: string | undefined; activeAdminCount: number },
): UserRole[] {
  if (callerRole !== "admin") return [];
  if (target.id === ctx.selfId) return [];           // no self-change
  if (target.status !== "active") return [];          // only active members
  return ALL_ROLES.filter((r) => {
    if (r === target.role) return false;              // not the current role
    // don't offer demoting the only active admin
    if (target.role === "admin" && r !== "admin" && ctx.activeAdminCount <= 1) return false;
    return true;
  });
}

/** Directional menu label, e.g. "Promote to manager" / "Demote to rep". */
export function roleChangeLabel(current: UserRole, target: UserRole): string {
  return RANK[target] > RANK[current] ? `Promote to ${target}` : `Demote to ${target}`;
}
```

- [ ] **Step 4: Run** `pnpm test roleActions` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/admin/lib/roleActions.ts apps/app/src/features/admin/lib/roleActions.test.ts
git commit -m "feat(admin): settableRoles + roleChangeLabel affordance helpers"
```

---

### Task 3: `useSetMemberRole` hook (TDD)

**Files:** Create `apps/app/src/features/admin/hooks/useSetMemberRole.ts` + `.test.tsx`.

- [ ] **Step 1: Write the failing test** `useSetMemberRole.test.tsx` (mirror `useRevokeMember`'s mock style):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSetMemberRole } from "./useSetMemberRole";

let rpcResult: { error: Error | null };
const rpcMock = vi.fn(() => Promise.resolve(rpcResult));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "me" } }),
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { rpcResult = { error: null }; rpcMock.mockClear(); });

describe("useSetMemberRole", () => {
  it("calls admin_set_role with the profile id + new role and invalidates the leaderboard", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetMemberRole(), { wrapper: wrapper(client) });
    result.current.mutate({ profileId: "u2", newRole: "manager" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("admin_set_role", { p_profile_id: "u2", p_new_role: "manager" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "leaderboard", "me"] });
  });

  it("surfaces an RPC error", async () => {
    rpcResult = { error: new Error("cannot_demote_sole_admin") };
    const { result } = renderHook(() => useSetMemberRole(), { wrapper: wrapper(new QueryClient()) });
    result.current.mutate({ profileId: "u2", newRole: "rep" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("cannot_demote_sole_admin"));
  });
});
```

- [ ] **Step 2: Run** `pnpm test useSetMemberRole` → FAIL.

- [ ] **Step 3: Implement** `useSetMemberRole.ts`:
```ts
/**
 * useSetMemberRole — change a member's role via the admin_set_role RPC (admin-
 * only, enforced server-side). Invalidates the team-leaderboard so the role
 * badge updates. Mirrors useRevokeMember.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { UserRole } from "../lib/roleActions";

export interface SetMemberRoleInput {
  profileId: string;
  newRole: UserRole;
}

export function useSetMemberRole() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: SetMemberRoleInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_set_role", {
        p_profile_id: input.profileId,
        p_new_role: input.newRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "leaderboard", userId ?? "anon"],
      });
    },
  });
}
```

- [ ] **Step 4: Run** `pnpm test useSetMemberRole` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/admin/hooks/useSetMemberRole.ts apps/app/src/features/admin/hooks/useSetMemberRole.test.tsx
git commit -m "feat(admin): useSetMemberRole — call admin_set_role + refresh leaderboard"
```

---

### Task 4: Wire role-change items into the Team page (TDD)

**Files:** Modify `apps/app/src/features/admin/components/AgentListRow.tsx`, `AgentCard.tsx`, `apps/app/src/features/admin/pages/AgentsPage.tsx`, and the existing AgentsPage test (`AgentsPage.test.tsx` / regression test if present).

- [ ] **Step 1: READ** `AgentListRow.tsx` + `AgentCard.tsx` (the `onPromote` prop + the `row.status === "active" && row.role === "rep"` promote `DropdownMenuItem`) and `AgentsPage.tsx` (the `onPromote={() => toast("Promote — coming in v1.1")}` call sites + how `useAuth`/`rows`/`useRevokeMember` are used).

- [ ] **Step 2: Update `AgentListRow.tsx` + `AgentCard.tsx`** — replace the single hardcoded promote item with role items from `settableRoles`. In BOTH files:
  - Imports: `import { settableRoles, roleChangeLabel, type UserRole } from "../lib/roleActions";`
  - Replace the prop `onPromote: (row: LeaderboardRow) => void;` in the props interface with:
    ```tsx
    onSetRole: (row: LeaderboardRow, newRole: UserRole) => void;
    callerRole: UserRole | undefined;
    selfId: string | undefined;
    activeAdminCount: number;
    ```
    (destructure the new props in the component signature; drop `onPromote`).
  - Replace the promote `{row.status === "active" && row.role === "rep" && (<DropdownMenuItem onSelect={() => onPromote(row)}>Promote to manager</DropdownMenuItem>)}` block with:
    ```tsx
    {settableRoles(callerRole, { id: row.agent_id, role: row.role, status: row.status }, { selfId, activeAdminCount }).map((r) => (
      <DropdownMenuItem key={r} onSelect={() => onSetRole(row, r)}>
        {roleChangeLabel(row.role, r)}
      </DropdownMenuItem>
    ))}
    ```
  (`LeaderboardRow.role` is `"rep"|"manager"|"admin"` — assignable to `UserRole`. If TS complains, the row's `role` field already matches; no cast needed.)

- [ ] **Step 3: Update `AgentsPage.tsx`** — wire the hook + confirm + new props:
  - Imports: `import { useSetMemberRole } from "../hooks/useSetMemberRole";` and `import type { UserRole } from "../lib/roleActions";` (toast is already imported).
  - Near the other hooks: `const setRole = useSetMemberRole();` and derive context from the existing `rows` + `userId` (`const userId = useAuth((s) => s.user?.id)` already exists; if not, add it):
    ```tsx
    const callerRole = rows.find((r) => r.agent_id === userId)?.role as UserRole | undefined;
    const activeAdminCount = rows.filter((r) => r.role === "admin" && r.status === "active").length;
    ```
  - Add the handler:
    ```tsx
    const handleSetRole = (row: LeaderboardRow, newRole: UserRole) => {
      const who = row.full_name ?? row.email;
      const message =
        newRole === "admin"
          ? `Make ${who} an admin? This gives them full control of the organization, including billing and member management.`
          : `Change ${who}'s role to ${newRole}?`;
      if (!window.confirm(message)) return;
      setRole.mutate(
        { profileId: row.agent_id, newRole },
        {
          onSuccess: () => toast.success("Role updated"),
          onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change role"),
        },
      );
    };
    ```
  - Replace BOTH `onPromote={() => toast("Promote — coming in v1.1")}` props (the AgentListRow render + the AgentCard render) with:
    ```tsx
    onSetRole={handleSetRole}
    callerRole={callerRole}
    selfId={userId}
    activeAdminCount={activeAdminCount}
    ```

- [ ] **Step 4: Update the AgentsPage test.** READ the existing AgentsPage test. It renders the page with mocked `useTeamLeaderboard`; the page now also calls `useSetMemberRole` → `supabase.rpc`. Mock the hook near the other mocks:
  ```tsx
  const setRoleMutate = vi.fn();
  vi.mock("../hooks/useSetMemberRole", () => ({
    useSetMemberRole: () => ({ mutate: setRoleMutate }),
  }));
  ```
  Ensure the mocked leaderboard rows include the current user as an `admin` (so role items render) — match how the test sets `useAuth`/`useProfile` + the rows. Add a test: an admin viewing a `rep` row opens the menu, sees "Promote to manager"/"Promote to admin", and selecting one (with `window.confirm` stubbed to `true` via `vi.spyOn(window, "confirm").mockReturnValue(true)`) calls `setRoleMutate` with `{ profileId, newRole }`. Keep all existing assertions green; if existing tests don't set the caller as admin, the new role items simply won't render (helper returns `[]`) — adjust only as needed to keep them passing (do NOT weaken existing assertions). If AgentListRow/AgentCard have their own tests that passed `onPromote`, update them to the new props (`onSetRole`/`callerRole`/`selfId`/`activeAdminCount`).

- [ ] **Step 5: Run** `pnpm typecheck && pnpm test` (FULL) → clean, all green.

- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/admin/
git commit -m "feat(admin): real role-change actions on the Team page (admin-only, confirmed)"
```

---

### Final

After all tasks: `pnpm typecheck && pnpm test` (full) → clean/green. Then finishing-a-development-branch (merge + push). **Then the RPC migration is hand-applied to prod with the user's authorization:** `supabase db query --linked -f supabase/migrations/20260625000002_admin_set_role.sql` → `supabase migration repair --status applied 20260625000002` → smoke-test (function exists + grant; calling under no-auth raises `not_authenticated`; verify the guard logic by reading the function). The frontend is inert until the RPC exists (the hook errors → toast; menu still renders but the action fails gracefully) — but ideally apply the RPC right after merge so the feature works.

## Notes for the implementer
- DRY: the UI affordance (`settableRoles`) and the RPC enforce the SAME rules; the RPC is authoritative, the helper just shapes the menu.
- YAGNI: NO `role_path` writes (visibility unchanged), NO reporting-hierarchy, NO bulk changes, NO audit log, NO last-admin guard on the revoke path.
- Admin-only: managers get an empty role menu (helper returns `[]`) AND the RPC raises `forbidden`.
- `window.confirm` (consistent with the page's invite-revoke confirm) carries the emphatic admin-grant copy.
- Run git from the worktree root; force-add only `docs/`.
