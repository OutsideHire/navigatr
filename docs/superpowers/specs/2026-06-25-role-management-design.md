# Member role management (promote / demote) — Design (2026-06-25)

## Problem

The Team page (`/admin/agents`) shows a "Promote to manager" action, but it's a stub
(`toast("Promote — coming in v1.1")`). The `user_role` enum (`rep`/`manager`/`admin`) and the
admin-RPC pattern exist, but there's **no way to change a member's role from the UI** and **no
RPC** to do it. This builds that: an admin-only `admin_set_role` RPC + the Team-page UI to change a
member's role, with the safety guards the codebase is currently missing (no self-change, no
demoting the last admin).

## Scope (locked in brainstorming)

- **Role management only.** Changes `profiles.role` (rep ↔ manager ↔ admin). **`role_path` (the
  reporting-hierarchy ltree) is untouched** — it stays NULL, so visibility (deals/activities RLS,
  the coverage rollup) is unchanged. The reporting-hierarchy / `role_path` population + subtree
  scoping is a deferred follow-up (see Out of scope).
- **Permission model: admin-only.** Only an active admin may change any role. Managers see no role
  actions (they still run their team's deals/activities). Consistent with the existing admin-only
  `admin_reactivate_member`.
- **Non-negotiable invariants:** a user cannot change their **own** role (prevents self-lockout);
  the **last remaining active admin** cannot be demoted out of `admin`.
- **Confirm before applying** every role change; emphatic wording when granting `admin` (hands over
  full org control). Simple confirm dialog — no typed-confirmation ceremony.

## Architecture

### A. RPC — `admin_set_role(p_profile_id uuid, p_new_role user_role)`

New migration, mirroring `admin_revoke_member` (`20260523000002_admin_portal_rpcs.sql`):
SECURITY DEFINER, `set search_path = public`, returns void.

```sql
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
    raise exception 'forbidden';                      -- admin-only
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'cannot_change_own_role';
  end if;

  -- Target must be an active member of the caller's org.
  select p.role into v_target_role
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target_role is null then
    raise exception 'profile_not_found';
  end if;

  -- Last-admin guard: don't demote the only active admin out of admin.
  if v_target_role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from profiles
            where org_id = v_org_id and role = 'admin' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  update profiles set role = p_new_role where id = p_profile_id and org_id = v_org_id;
end $$;

grant execute on function admin_set_role(uuid, user_role) to authenticated;
```
- A same-role update is a harmless no-op (no special-case needed).
- `role_path` is never read or written here.
- Hand-applied to prod with the user's authorization (repo convention) + `migration repair`.

### B. Pure affordance helper + hook

- **`features/admin/lib/roleActions.ts`** — pure, unit-tested:
  ```ts
  export function settableRoles(
    callerRole: UserRole,
    target: { id: string; role: UserRole; status: LeaderboardStatus },
    ctx: { selfId: string | undefined; activeAdminCount: number },
  ): UserRole[]
  ```
  Returns `[]` unless `callerRole === "admin"`; `[]` for self (`target.id === ctx.selfId`) or a
  non-`active` target; otherwise the two `user_role`s other than `target.role` — but **excludes any
  non-admin role when `target.role === "admin"` and `ctx.activeAdminCount <= 1`** (so the UI never
  offers a sole-admin demotion the RPC would reject). The server remains authoritative; this only
  shapes the menu.
- **`features/admin/hooks/useSetMemberRole.ts`** — `supabase.rpc("admin_set_role", { p_profile_id,
  p_new_role })`; on success invalidates the `team_leaderboard` query (`TEAM_LEADERBOARD_QUERY_KEY`)
  + `toast.success`; on error `toast.error` surfacing the message (`cannot_demote_sole_admin`,
  `forbidden`, etc.). Mirrors `useRevokeMember`.

### C. UI — AgentsPage / AgentListRow / AgentCard

Replace the `onPromote` stub. Both the desktop row (`AgentListRow`) and mobile card (`AgentCard`)
render role-change `DropdownMenuItem`s computed from `settableRoles(callerRole, row, { selfId,
activeAdminCount })` — labelled "Make manager" / "Make admin" / "Demote to rep" / etc. `AgentsPage`:
- Derives `callerRole` (from `useProfile`) + `activeAdminCount` (count of `rows` with
  `role === "admin"` && `status === "active"`) + `selfId` (from `useAuth`), threads them down.
- A confirm step before calling the mutation (e.g. an AlertDialog or `window.confirm`), with
  emphatic copy for `→ admin` ("This gives {name} full control of the organization, including
  billing and member management.").
- On confirm → `useSetMemberRole`. Managers get no items (helper returns `[]`); the old
  `onPromote`/"coming in v1.1" toast is removed.

## Data flow

Admin opens a member's row menu → `settableRoles` offers valid target roles → admin picks one →
confirm dialog → `useSetMemberRole` → `admin_set_role` RPC (re-checks admin + invariants
server-side) → on success the leaderboard query refetches and the role badge updates.

## Error handling / edge cases

- **Non-admin caller:** sees no role items (helper) AND the RPC raises `forbidden` (defense-in-depth).
- **Self:** never offered (helper) + RPC raises `cannot_change_own_role`.
- **Sole admin demotion:** not offered when `activeAdminCount <= 1` (helper) + RPC raises
  `cannot_demote_sole_admin` (authoritative, e.g. if the roster is stale).
- **Inactive / cross-org / missing target:** not offered; RPC raises `profile_not_found`.
- **Same-role pick:** harmless no-op (not offered, since helper excludes the current role).
- **Stale roster** (helper offered something the RPC now rejects): the RPC error surfaces via toast;
  the leaderboard refetch corrects the UI.

## Testing

- **`settableRoles`** (pure, exhaustive): non-admin caller → `[]`; admin → the other two roles;
  self → `[]`; inactive target → `[]`; `target.role==="admin"` with `activeAdminCount<=1` → demote
  options excluded (and with `>1` → included).
- **`useSetMemberRole`**: mocked `supabase.rpc("admin_set_role", …)` with the right args; success →
  invalidates `team_leaderboard` + success toast; error → error toast (message surfaced).
- **AgentsPage / AgentListRow / AgentCard**: an admin sees role items per `settableRoles`; a manager
  sees none; selecting one opens the confirm and (on confirm) calls the hook; the admin-grant item
  shows the emphatic copy. Keep existing AgentsPage tests green (mock the new hook).
- **RPC**: no vitest DB harness (consistent with the sibling admin RPCs); verified live after apply
  — admin changes a role; non-admin → `forbidden`; self → `cannot_change_own_role`; sole-admin
  demotion → `cannot_demote_sole_admin`; manager/rep promote works.

## Out of scope (deferred)

Reporting-hierarchy: populating/maintaining `profiles.role_path` (ltree) + subtree recompute on
reassignment + the org-wide visibility rollout (the follow-up that would make the coverage rollup
and deals/activities scope to a manager's team); a last-admin guard on the `admin_revoke_member`
path (only `admin_set_role` here); bulk role changes; a role-change audit log.
