# Activity Logging Coverage — SP2b: Manager coverage rollup (2026-06-25)

The hierarchy-aggregates slice of the Activity Logging Coverage roadmap
(`docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`). SP2b was scoped to
**the manager/admin coverage rollup only**; the other SP2b candidates are deferred (see Out of
scope). Builds on SP0/SP1/SP2a (all live: `coverage_signal`, `coverage_snapshot` + nightly Edge job
+ cron, the rep `CoverageWidget`/`useCoverageSnapshots`/`bandPresentation`, the shared
`_shared/coverage` scoring).

SP2b gives managers/admins a **team logging-coverage rollup**: the team's composite coverage + a
per-rep breakdown, on the existing Team page. Computed **on read** (no new table/job).

## Decisions (locked in brainstorming)

- **On-read RPC, not persisted aggregates.** A `coverage_rollup()` SECURITY DEFINER RPC computes
  from the latest `coverage_snapshot` per rep on each call — mirroring `team_leaderboard`. NO
  `coverage_aggregate_snapshot` table, NO nightly-job change, NO cron change. The persisted
  aggregate entity (PRD §3.3.C.14) is deferred until historical team-trend charts are actually
  needed (nothing displays them today).
- **Placement: a section card on the existing Team page** (`/admin/agents`), above the team table
  — not a new column on the (already wide) table, not a new page.
- **Team headline = volume-weighted composite + band + "N of M reps with data"**, reusing the
  shared `composite()`/`band()`. Deliberately **no** separate aggregate confidence level (honest
  but simple).
- **Privacy:** managers see per-rep coverage **scores** only — never the underlying unmatched-call
  signals (`coverage_signal` stays rep-only, per PRD §3.3.C.10/11). The RPC returns scores.
- **Hierarchy scoping** via the existing `public.user_can_see_owner(uuid)` (manager → subtree,
  admin → org; whole-org today while `role_path` is null — same as `team_leaderboard`,
  future-correct once populated).

## Architecture

### A. RPC — `coverage_rollup()` (new migration)

SECURITY DEFINER function mirroring `team_leaderboard`'s shape (authz + org scoping + grant). No
window parameter — the snapshot's `composite_coverage` is already the rolling 30-day figure; the
RPC returns each rep's **latest** snapshot.

```sql
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
  -- Management view: reps cannot call it (they have their own widget).
  if public.user_role() not in ('manager', 'admin') then
    raise exception 'coverage_rollup: requires manager or admin';
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
    and public.user_can_see_owner(p.id);
end $$;

grant execute on function coverage_rollup() to authenticated;
```
- Reps with no snapshot → `s.*` is null (LEFT JOIN LATERAL) → returned with null coverage, so
  managers see who has no trackable activity.
- SECURITY DEFINER bypasses RLS, so the function enforces scoping itself (`user_org_id()` +
  `user_can_see_owner()`), exactly as `team_leaderboard` does.
- Hand-applied to prod with the user's authorization (repo convention); `migration repair` after.

### B. Read hook + pure aggregate (frontend)

- **`features/coverage/hooks/useCoverageRollup.ts`** — `supabase.rpc("coverage_rollup")`,
  TanStack Query (`["coverage","rollup",userId]`, `enabled: Boolean(userId)`, `staleTime: 30_000`),
  maps snake→camel to a `CoverageRollupRow` (`userId, fullName, role, snapshotDate,
  compositeCoverage, confidenceLevel, callCoverage, callEventCount, activeChannels`; coverage
  fields nullable). Error → `[]` (card shows empty/instructional state).
- **`features/coverage/lib/teamCoverage.ts`** — pure `teamCoverage(rows): { compositeCoverage:
  number | null; band: Band | null; repsWithData: number; repsTotal: number }`. Uses the shared
  `composite()` over rows that have a non-null `compositeCoverage` and `callEventCount > 0`
  (volume-weighted), and `band()` (DEFAULT thresholds) for the headline band. `repsWithData` =
  rows with a gradeable snapshot (non-null composite AND confidence ≠ `insufficient`); `repsTotal`
  = all rows. Null composite when no rep has data. Unit-tested.

### C. UI — `TeamCoverageCard` on AgentsPage (placement A)

`features/coverage/components/TeamCoverageCard.tsx`, rendered as a `Card` on
`features/admin/pages/AgentsPage.tsx` above the existing team table (the page is already
`RequireRole manager/admin`). Reads `useCoverageRollup` + derives the headline via `teamCoverage`.

- **Header:** "Team logging coverage" + the team band pill (`bandPresentation(headline.band)`,
  e.g. "Adequate · 64%") when `repsWithData > 0`; plus a muted "Based on {repsWithData} of
  {repsTotal} reps with coverage data" line.
- **Per-rep list:** one row per rollup row — `fullName` + a coverage chip: band %+label via
  `bandPresentation` when the rep has gradeable data, else a muted **"No data"** chip (covers null
  snapshot AND `insufficient`). Mirror the AgentsPage list/card styling (`SectionHeader`,
  `surface-sunken` rows) so it sits naturally on the page.
- **Empty state:** when `repsWithData === 0` (the launch reality), an instructional card —
  "No team coverage data yet — coverage appears as your reps log calls through tap-to-call." —
  matching the rep widget's help-not-warn tone. Still shows the per-rep "No data" list so managers
  see the roster.
- Reuses `bandPresentation`/`confidenceLabel` (SP2a) and the shared `composite()`/`band()`.

### D. Data flow

Nightly SP1 job → `coverage_snapshot` rows → `coverage_rollup()` RPC (per-rep latest, hierarchy +
org scoped, manager/admin only) → `useCoverageRollup` → `TeamCoverageCard` derives the team
headline via `teamCoverage` (shared `composite`/`band`) and renders per-rep chips. Managers see
scores; reps' raw unmatched-call signals are never exposed.

## Error handling / edge cases

- **Non-manager/admin calls the RPC:** raises (defensive; the UI is role-gated anyway).
- **RPC error / no rows:** hook returns `[]`; card shows the instructional empty state.
- **Rep with no snapshot:** returned with null coverage → "No data" chip; counted in `repsTotal`,
  not `repsWithData`.
- **Rep with `insufficient` confidence:** treated as "No data" in the chip and excluded from
  `repsWithData` + the team composite (consistent with SP2a hiding the % at `insufficient`).
- **All reps no/insufficient data (launch):** team headline is null → empty/instructional card +
  the roster with "No data" chips.
- **`role_path` null (current prod):** `user_can_see_owner` returns true org-wide → manager/admin
  see the whole org (same as `team_leaderboard`); scopes to subtree once the org chart is set.

## Testing

- **`teamCoverage`** (pure): volume-weighted composite across reps-with-data; `repsWithData` vs
  `repsTotal` counts; `insufficient`/null rows excluded from the composite; all-null → `{composite:
  null, band: null, repsWithData: 0}`; band boundary.
- **`useCoverageRollup`**: mocked `supabase.rpc("coverage_rollup")` → mapped camelCase rows; error
  → `[]`.
- **`TeamCoverageCard`**: populated (team band pill + "N of M" + per-rep chips incl. a "No data"
  chip for a null/insufficient rep); all-empty (instructional state + roster); headline reflects
  `teamCoverage`.
- **RPC**: no vitest DB harness (consistent with `team_leaderboard`); verified live after
  hand-apply — manager/admin scoping (own org + subtree), per-rep latest snapshot, reps-without-
  snapshot returned as null, non-manager raises.

## Out of scope (deferred)

Persisted `coverage_aggregate_snapshot` + nightly aggregate job (on-read RPC instead); historical
team/org coverage trend charts; an aggregate confidence level; the cross-cutting credibility badge
+ red-band warning on other widgets; the full thresholds-overlay rep trend chart;
calendar/email/location channels. No change to SP0/SP1/SP2a.
