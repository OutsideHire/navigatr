# Persistence Index SP-B: Snapshot Pipeline + Config + Versioning (Design Spec)

**Date:** 2026-07-26
**Status:** Approved (proceeding to plan + build)
**Module:** Persistence Index server pipeline (Supabase) + dashboard benchmark-line reads
**Sub-project:** SP-B of the full-spec Persistence Index re-scope (SP-A..E). SP-A (formula swap + Re-engagement) shipped 2026-07-26.

---

## 1. Goal

Build the nightly snapshot pipeline the PRD requires (FR-METRIC-PI-01 per-rep, FR-METRIC-PI-06 company aggregate): a server job that scores every rep once a night, banks a dated snapshot, and rolls those into a daily company aggregate (median + top decile) that powers the trend chart's comparison lines. Add a per-tenant config record and a formula-version stamp. Copy the proven Logging Coverage pipeline pattern.

## 2. Decisions (locked)

- **Hybrid score freshness (user, 2026-07-26):** the live "today" widget score and the rep's own trend line KEEP computing client-side (SP-A code, unchanged). The nightly pipeline powers the daily company-average and top-decile comparison lines (the piece too expensive to compute live for a whole team) and banks per-rep snapshots for scale and future manager views. This matches Robert's own note that the rep's own line is fine live and the company aggregate is the blow-up.
- **Reuse the Logging Coverage pattern exactly:** compute in a Deno edge function whose business logic lives in dependency-free `supabase/functions/_shared/persistence/*.ts` modules (vitest-tested, mirroring `_shared/coverage/*`); table shape mirrors `coverage_snapshot` (denormalized trigger-enforced `org_id`, `unique(user_id, snapshot_date)`, SELECT-only RLS so only the service-role job writes); cron via pg_cron + pg_net http_post to the edge function using Vault secrets; team/company read via a `security definer` RPC (mirroring `coverage_rollup`).
- **No backfill (per Robert):** the pipeline starts cold and accumulates forward from cron start. Comparison lines fill in from launch. Documented in the migration header (mirroring coverage's implicit no-backfill choice).
- **Config as jsonb on `organizations`:** add `organizations.persistence_index_config jsonb not null default '{}'`, merged over code defaults by a `resolvePersistenceConfig` helper (mirrors `coverage_config` + `resolveCoverageConfig`). Fields: `silence_threshold_days` (21), `target_cadence` (3.5), `window_days` (30), `followup_floor` (8), `coverage_caveat_pct` (0.75), `coverage_suppress_pct` (0.50), `formula_version` (2). (Coverage gates are stored now for SP-D to consume; SP-B does not gate.)
- **formula_version is a stored integer, bumped by an operator when a scoring param changes (beta):** auto-increment-on-config-change (FR-METRIC-PI-10 automation) is deferred; for beta the operator bumps `formula_version` in the config when they change a param, and the snapshot copies it. The chart boundary marker (SP-D) reads it.

## 3. Architecture

```
pg_cron (nightly) --http_post--> edge fn compute_persistence_snapshots
                                    |
                                    v
     supabase/functions/_shared/persistence/*.ts  (pure, vitest-tested)
       - scoring (ported from apps/app SP-A persistenceIndex.ts)
       - runSnapshots orchestrator
       - resolvePersistenceConfig
                                    |
        per org -> per rep: compute composite + sub-components
                                    |
        upsert persistence_index_snapshot (one row / rep / day)
        aggregate rep composites -> median + p90 -> upsert persistence_company_snapshot
                                    |
   client reads company snapshot via RPC -> daily company-avg + top-decile trend lines
   (rep own line + today score stay client-computed, unchanged)
```

**Scoring is ported, not shared-by-import.** The pure SP-A functions (`computeFollowUpDiscipline`, `computeTouchCadence`, `computeReEngagement`, and the composite) are re-implemented in `_shared/persistence/score.ts` against structural types (a minimal `{ id, owner_id, stage }` deal and `{ dealId, occurredAt, followUpDate }` activity), mirroring how coverage keeps its math in `_shared`. To prevent drift between the two copies (app client vs server), a **parity test** asserts both implementations produce identical composites + sub-component points on a shared fixture set. If they ever diverge, the build fails.

## 4. Data model

Add `organizations.persistence_index_config jsonb not null default '{}'`.

`persistence_index_snapshot` (per rep, per day; manager-visible; service-role-write-only):
- `id uuid pk default gen_random_uuid()`
- `org_id uuid not null references organizations(id) on delete cascade` (denormalized, trigger-enforced consistent with `user_id`'s org)
- `user_id uuid not null references profiles(id) on delete cascade`
- `snapshot_date date not null`
- `composite numeric` (nullable; null when unscoreable that day)
- `followup_points numeric`, `followup_below_floor boolean not null default false`, `followup_due_count int not null default 0`
- `cadence_points numeric`
- `reengagement_points numeric`, `reengagement_rate numeric`, `deals_went_silent_count int not null default 0`, `deals_re_engaged_count int not null default 0`
- `response_velocity_points numeric` (permanently null; forward-compat, per Robert's data-model note)
- `formula_version int not null`
- `window_start_date date not null`, `window_end_date date not null`
- `created_at timestamptz not null default now()`
- `unique (user_id, snapshot_date)`; indexes `(user_id, snapshot_date desc)`, `(org_id, snapshot_date)`
- RLS: SELECT only, `org_id = user_org_id() and (user_id = auth.uid() or user_can_see_owner(user_id))`. No insert/update/delete policy (service-role bypasses RLS to write).
- Trigger `enforce_org_consistency` mirroring the coverage twin.

`persistence_company_snapshot` (per org, per day; org-visible):
- `id uuid pk default gen_random_uuid()`
- `org_id uuid not null references organizations(id) on delete cascade`
- `snapshot_date date not null`
- `composite_median numeric` (nullable), `composite_p90 numeric` (nullable), `rep_count int not null default 0`
- `formula_version int not null`
- `created_at timestamptz not null default now()`
- `unique (org_id, snapshot_date)`; index `(org_id, snapshot_date desc)`
- RLS: SELECT `org_id = user_org_id()`. Service-role writes.

## 5. Compute (the edge function + _shared)

`supabase/functions/_shared/persistence/`:
- `score.ts`: ported pure scoring (structural types), returns composite + all sub-component fields for one rep over a window ending on the run date.
- `config.ts`: `DEFAULT_PERSISTENCE_CONFIG` + `resolvePersistenceConfig(orgJsonb)`.
- `runSnapshots.ts`: orchestrator. For each org: resolve config; list rep ids (distinct deal owners in the org); for each rep, fetch their deals + activities, compute, upsert a `persistence_index_snapshot` row. Then compute the org's `composite_median` + `composite_p90` (p90 via the existing percentile approach) over reps whose composite is non-null, and upsert a `persistence_company_snapshot` row with `rep_count`.
- All the above are dependency-free TS (no Deno imports), unit-tested via vitest exactly like `_shared/coverage`.

`supabase/functions/compute_persistence_snapshots/index.ts`: `Deno.serve` entrypoint; builds a `Deps` object of thin Supabase service-role queries (`listOrgs`, `listRepIds`, `fetchRepDeals`, `fetchRepActivities`, `upsertRepSnapshot`, `upsertCompanySnapshot`); calls `runSnapshots(deps, new Date())`; returns a summary. Mirrors `compute_coverage_snapshots`.

## 6. Client wiring

- **Unchanged (SP-A):** the widget's live today-score and the detail page's own trend line (`computePersistenceHistory`) keep computing client-side.
- **New:** a `persistence_company_series(range_days)` `security definer` RPC returns the org's daily `{ snapshot_date, composite_median, composite_p90 }` for the range. A `usePersistenceCompanySeries` hook reads it. The detail page's `TrendChart` reference lines (which already accept N configurable dashed lines from SP-A) are fed the daily company-median and top-decile (p90) series where snapshots exist.
- **Accrual bridge:** if fewer than 2 company-snapshot days exist in range, fall back to SP-A's current static client-side benchmark (single flat line) so the chart is never bare during the first weeks. Once >= 2 snapshot days exist, use the daily lines.
- No change to the widget, sub-component card, roster, or the own-line logic.

## 7. Config + versioning

`resolvePersistenceConfig` merges the org's jsonb over `DEFAULT_PERSISTENCE_CONFIG`. The edge function passes resolved params into scoring (so silence threshold / target cadence / window / floor are config-driven server-side; the client keeps SP-A's hardcoded constants for the live score, and the parity test uses the defaults so the two agree). Every snapshot row stores the `formula_version` from config. Operator bumps `formula_version` when changing a param; SP-D draws the boundary marker.

## 8. Backfill

None. Cold start, forward-accumulating, per Robert. The migration header documents this explicitly (a stated choice, since the codebase has both precedents).

## 9. Testing

- `_shared/persistence` pure modules: vitest unit tests (scoring parity with SP-A behavior; runSnapshots orchestration with a fake Deps; median/p90 aggregation; config resolve).
- **Parity test:** a vitest that imports the app's `apps/app/src/features/dashboard/lib/persistenceIndex.ts` and the shared `score.ts` and asserts identical composite + sub-component points across a fixture matrix (empty, zero-silent, below-floor, mixed). Fails the build on drift.
- RPC + RLS + cron: manual QA in the SQL editor (a rep sees only permitted snapshots; a manager sees their subtree; the company RPC returns the org series; cron fires the edge fn). No automated harness for SQL (project norm).
- Full `pnpm --filter app test` + `typecheck` green.

## 10. Deploy (backend steps, handed to the user)

1. Paste the migrations into the Supabase SQL editor and run (config column + two snapshot tables + triggers + RLS + indexes; then the company-series RPC; then the cron migration).
2. Create two Vault secrets: `persistence_fn_url` (the deployed edge function URL) and `persistence_service_role_key` (service role key), mirroring coverage's `coverage_fn_url` / `coverage_service_role_key`.
3. Deploy the `compute_persistence_snapshots` edge function (dashboard paste of the flattened file, per project norm) BEFORE the cron migration references its URL.
4. Confirm `pg_cron` + `pg_net` are enabled (the cron migration creates them if absent).
5. Optional: manually invoke the edge function once to seed day-one snapshots so the company lines are not empty on launch day.

Frontend (own-line + today-score + the new company-series read + fallback) ships to main as usual; it is backward-compatible (empty company series simply falls back to the static benchmark).

## 11. Files (anticipated)

- Migrations: `<ts>_persistence_index_config.sql` (org jsonb column), `<ts>_persistence_snapshots.sql` (two tables + triggers + RLS + indexes), `<ts>_persistence_company_series_rpc.sql`, `<ts>_persistence_snapshot_cron.sql`.
- `supabase/functions/_shared/persistence/{score.ts, config.ts, runSnapshots.ts}` (+ vitest tests).
- `supabase/functions/compute_persistence_snapshots/index.ts`.
- Parity test (location mirrors coverage's `_shared` test setup).
- `apps/app/src/features/dashboard/hooks/usePersistenceCompanySeries.ts` + wiring the daily lines into the report's `TrendChart` (+ tests).
