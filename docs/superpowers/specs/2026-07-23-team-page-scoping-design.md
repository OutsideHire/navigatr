# Team Page Reporting-Tree Scoping — Design Spec

**Date:** 2026-07-23
**Status:** Approved (pending spec review)
**Module:** Admin / Team page + hierarchy visibility
**Origin:** Reviewer feedback — an SVP with no direct reports currently sees the entire org on the Team page; expected behavior is visibility limited to her team.

---

## 1. Problem

The Team page (`AgentsPage`, list + org-chart views) shows every member of the org to any manager, regardless of where they sit in the reporting tree. Root cause: the page's data comes from the `team_leaderboard(int)` RPC, which selects all profiles/invites in the caller's org with no hierarchy filter. (Separately, the `profiles` SELECT policy is intentionally org-wide in v1 so names/labels resolve everywhere; that stays.)

Meanwhile, the app already scopes *data* (deals, activities, the new rep report) to the caller's reporting subtree via the `user_can_see_owner(uuid)` predicate (role_path ltree, admins excluded from the tree → see all). The Team page simply does not apply that rule.

## 2. Goal

Make `team_leaderboard` return only the caller's reporting subtree (themselves + all descendants), reusing the existing `user_can_see_owner` visibility rule, so the Team page matches how the underlying data is already scoped. Admins keep full-org visibility.

## 3. Key decisions (locked)

| Decision | Choice |
|---|---|
| Scope depth | Caller's whole subtree: self + all descendants (every level down), not just direct reports. |
| Enforcement | Server-side, inside the `team_leaderboard` RPC (authoritative; peers' rows never leave the DB). |
| Rule reused | `public.user_can_see_owner(p_owner uuid)` — the same predicate already gating deals/activities. |
| Admins | Unchanged: admins have `role_path = NULL` → `user_can_see_owner` returns true for all → full org. |
| Members not placed in the tree | Unchanged safety fallback: a caller with `role_path = NULL` sees everyone (same as data today). Correct scoping requires the caller to have a reporting line. |
| Pending invites | Scoped by the invite's assigned manager (`manager_id`): visible if the caller can see that manager. Admins see all. |
| profiles RLS | Left org-wide (v1 decision). Not tightened here. |
| Seat-usage badge | Left org-wide (billing fact). Not changed here. |

## 4. Server change

`team_leaderboard(int)` (currently defined in `supabase/migrations/20260722000004_team_leaderboard_role_level.sql`) has two unioned arms:

1. **Members arm** (`from profiles p ... where p.org_id = v_org_id`): add `and public.user_can_see_owner(p.id)`.
   - `user_can_see_owner(self)` is true (own id short-circuit), so the caller always appears (tree root).
   - Descendants match via `target.role_path <@ caller.role_path`.
   - Admin caller (NULL path) → true for all → full org.

2. **Invites arm** (`from org_invites oi ... where oi.org_id = v_org_id and accepted_at is null and revoked_at is null`): add a manager-visibility gate so a manager only sees invites destined for their team. Precise predicate to implement:
   - `and (public.caller_role_path() is null` *(admin/unplaced caller sees all invites, matching the members-arm fallback)* `or (oi.manager_id is not null and public.user_can_see_owner(oi.manager_id)))`.
   - Rationale: a manager-less invite (`manager_id is null`) is an org-top concern; only admins/unplaced callers see it. An invite under a manager in the caller's subtree is visible to that caller.

The function stays `security definer`, keeps its existing `v_caller in ('manager','admin')` gate, and its signature/return columns are unchanged (pure WHERE-clause additions), so the frontend contract does not change.

Deployment: applied by pasting the updated `create or replace function team_leaderboard...` block into the Supabase SQL editor (standard flow for this project). Ship as a new migration file for repo history.

## 5. Client change

Minimal. The list and org-chart consume whatever rows the RPC returns, so scoping "just works" with fewer rows.

- `buildOrgTree` already promotes rows whose manager is not in the set to roots, so the caller (whose own manager is out of scope) surfaces as the tree root with their team nested. No change needed.
- **Empty/solo state:** when the returned set is just the caller (a manager with no reports yet), render a quiet hint near the org-chart / list (e.g. "No one reports to you yet.") so a single-row team reads as intentional. This is the only net-new UI.

## 6. Reporting-line dependency (verification, not new code unless broken)

Scoping keys off `role_path`, which is derived from `manager_id` via `rebuild_role_path_subtree`. Confirm that the UI path which sets a member's manager / reporting line (the reports-to picker / role-level flows from Phase 1B) triggers `rebuild_role_path_subtree` for the affected member so scoping takes effect immediately. If it does not, add that call. (For the SVP example: once she has a reporting line, her `role_path` is non-null and she is scoped to just her subtree.)

## 7. Testing

- The RPC is SQL and not covered by vitest; verify by manual QA in the app:
  - Sign in as a scoped manager (with a reporting line + some reports) → Team page shows only self + subtree, in both list and org-chart views.
  - Sign in as a manager with no reports → sees only self + the "no reports yet" hint.
  - Sign in as an admin → sees the full org (unchanged).
  - Confirm pending invites follow the same scoping.
- Any client-side helper added (e.g. an `isSoloTeam` check or empty-state condition) gets a unit test.
- Full `pnpm --filter app test` + `typecheck` stay green; no existing Team page tests break (the org-tree tests are unaffected — they test pure tree-building on given rows).

## 8. Out of scope

- Tightening the org-wide `profiles` SELECT policy.
- Changing seat-usage counting.
- Any change to admin visibility.
- Backfilling reporting lines for existing members (data setup, done via the Team UI).
