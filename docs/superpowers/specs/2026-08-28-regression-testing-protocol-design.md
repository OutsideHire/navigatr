# navigatr Regression Testing Protocol

**Status:** approved design, phased rollout starting Phase 1
**Date:** 2026-08-28
**Goal:** Every change (bug fix, feature, migration) is automatically verified before it can reach production, so a beta ISO never sees a regression. We do not break production for users.

---

## 1. Why this exists

navigatr is heading into a paid beta. The cost of a regression is now a customer, not a test row. Twice recently a bug reached a live beta account (the Path drop-in outcomes, and the bulk-CSV invite failure) even though the full automated suite was green. Both were the same shape: the individual pieces were unit-tested, but nothing exercised the whole journey the way a real user does, so a wiring mistake passed every check.

This protocol closes that gap and makes "verified before it ships" the default for all future work, not a thing we remember to do.

## 2. Where we stand today (honest current state)

Two of the three test layers are already strong. One has a hole.

| Layer | Tool | State today |
| --- | --- | --- |
| Unit / component | Vitest + React Testing Library | Strong. ~370 test files; every money/logic module (follow-up scheduling, dedupe, CSV role matching, report engines, capability map) has adjacent tests. |
| Database / security | psql regression scripts (`supabase/tests`, run by `tools/run-db-tests.sh`) | Solid. DB rebuilds from zero on every PR; within-org RLS/hierarchy scoping is asserted. |
| End to end (real user in a browser) | Playwright (`apps/app/e2e`) | **The hole.** Only two specs exist: an unauthenticated smoke test and an admin onboarding walk that deliberately skips the invite step. Nothing signs in as a rep with data and walks a full journey. |

Two structural gaps compound the E2E hole:
- **No cross-tenant isolation test.** Every RLS script seeds exactly one org. The predicate that separates ISO A from ISO B is never exercised, so a base-policy regression that leaked one ISO's pipeline to another would pass CI. This is the worst-case trust failure for a multi-tenant beta.
- **No coverage measurement.** `vitest run` has no `--coverage`; nothing reports or gates on it, so a change landing in an untested file passes silently, which quietly contradicts the "test every function" rule.

## 3. The protocol: definition of done for every change

A change is not "done" until all three hold:

1. **Bug-to-test rule.** Every bug fix ships with a test that fails before the fix and passes after. Every feature ships with tests for its new behavior. That test is a permanent tripwire against the same break returning.
2. **The layered net passes.** Unit + database security + the end-to-end golden paths all green.
3. **The gates allow it through.** The pipeline blocks any change that fails a required check, and every production release is confirmed live by an authenticated check before we consider it shipped.

## 4. Test layers and when to use each

- **Unit / component (Vitest + RTL):** pure logic and single screens in isolation. Fast, run on every change. Default home for new logic.
- **Database / security (psql scripts):** RLS boundaries, cross-tenant isolation, migration-from-zero, data invariants. Runs in the CI `database` job on ARM against a from-scratch database.
- **End to end (Playwright):** a real user's whole journey in a browser against a real local Supabase. Catches "the pieces work but are wired wrong," the class that unit tests structurally cannot catch. Reserved for the golden paths below (kept small and high-value so PRs stay fast).

## 5. Golden-path catalog (the journeys that must never silently break)

P0 = a rep cannot run their day / an ISO cannot trust the product without it.

| # | Journey | Audience | Priority | What the test proves |
| --- | --- | --- | --- | --- |
| 1 | Open today's Path | rep | P0 | The rep's home screen loads a seeded day (real stops, not a stuck spinner or false empty). Smoke test for the whole rep app; also the harness prerequisite for the rest. |
| 2 | Drop-in creates a deal + activity + follow-up | rep | P0 | One outcome tap fans out for real: queue disposition recorded, deal lands in pipeline, one activity row with correct owner/org, follow-up appointment appears. The exact journey that broke. |
| 3 | Move a deal across the pipeline board | rep | P0 | Drag-to-column opens the stage modal and commits; the deal's stage/probability actually update. Drives the win-rate numbers the ISO evaluates. |
| 4 | Admin invites a rep, rep accepts, lands under the right manager | both | P0 | The full invite seam: token written, invite page renders it, claim links the profile at the right role and reports_to, rep lands on the dashboard. The onboarding make-or-break; the invite bug's class. |
| 5 | Cross-tenant isolation (org A vs org B) | infra | P0 | Two seeded orgs; each user sees only their org's team, deals, and activities (including the admin path). Zero cross-org bleed. |
| 6 | Run the driving carousel + carry unfinished stops to tomorrow | rep | P1 | The in-car loop advances/resolves stops correctly and carried stops reappear the next day. |
| 7 | Plan-a-route wizard (search to saved path) | rep | P1 | The create half of the Path lifecycle: search (Places), pick stops, schedule, save, and the path then appears in Upcoming. Note prod runs live Google, so this guards an integration mocked unit tests cannot see. |

## 6. Coverage gaps being closed (highest severity first)

- **E2E authenticated rep harness + seed (high):** none exists. This single gap blocks every rep golden path and is Phase 1's first deliverable.
- **Cross-tenant isolation DB test (high):** add `supabase/tests/0xx_cross_org_isolation.sql` (two orgs, zero bleed) into the existing `database` job.
- **`stores/auth.ts` untested (high):** the session store (sign-in variants, signUp, reset, sign-out, invite-code OAuth carrier) has no adjacent test. Backfill the pure helpers first, then the flows via the invite E2E.
- **Edge function entry points untested (high):** all 17 handlers (`send_invite_email`, `discover_prospects`, `sync_path`, `sync_appointment`, calendar OAuth, transcribe, snapshot crons) have no tests; only their `_shared` helpers do. Deno runtime, so they need their own integration job (Phase 3).
- **No coverage measurement (high):** add `--coverage` reporting, then ratchet.
- **Post-deploy prod smoke is unauthenticated only (high):** the promote smoke only checks the login page renders. Add an authenticated canary (Phase 3).
- **Newer tables lack isolation scripts (medium):** `email_capture`, `scheduled_appointments` (PII-adjacent), `ownership_history`.
- **Seat-limit RPC + capability-vs-server-gate parity (medium):** no test asserts `admin_bulk_invite` returns seat-cap-reached at the boundary, nor that the client capability map agrees with the server gates (they can drift).
- **Path owed/due-today + self-serve auth pages + dedupe hooks (medium).**
- **Lint defined but never run in CI (low).**

## 7. CI and pipeline gates

Current gates (on every PR and push to `main`):
- `test.yml`: typecheck, real production build, unit tests, destructive-migration check, secrets-manifest audit.
- `database` job: build DB from zero + RLS regression scripts (ARM, pinned CLI).
- `e2e-onboarding.yml`: boots local Supabase + drives the admin onboarding walk.
- Branch protection blocks merge to `main` on failure; `deploy-staging.yml` ships staging; `promote-production.yml` snapshots, applies migrations + functions, fast-forwards `release`, runs a smoke test, tags.

Gates to add (where each slots):
- **Rep golden-path E2E job** (extend `e2e-onboarding.yml`): the rep seed + login fixture + the drop-in-spine and Path-load specs. Non-blocking first, then required.
- **Invite round-trip E2E** (same job): required once stable.
- **Coverage reporting then a ratchet** (`test.yml`): report first to set a baseline, then fail on a drop below baseline, with a hard floor on pure-logic dirs (`src/lib`, `src/features/*/lib`, `supabase/functions/_shared`).
- **New-table-RLS check** (`database` job): fail when a migration adds a table with an RLS policy but no `supabase/tests` script references it.
- **Authenticated post-deploy canary** (`promote-production.yml`): after the frontend goes live, sign in a dedicated seeded prod canary account, load `/dashboard`, assert a real data widget renders.
- **Lint gate** (`test.yml`): `pnpm --filter app lint` (fix the current backlog first so it starts green).
- **Prod secrets re-check** (`promote-production.yml`): `node tools/check-secrets.mjs production` after functions deploy.
- **Rehearsed rollback runbook-as-script:** revert `release` to the prior tag + re-run functions deploy, plus a tested snapshot restore into a scratch project. Drill once before beta.

## 8. Enforcement posture

**Non-blocking first, then enforce.** Each new golden-path E2E and the coverage gate land as a visible-but-not-blocking check first. Once a test has run clean for a few days (not flaky), it flips to a required check that blocks merges. This keeps a flaky new test from stalling beta shipping while still moving every check toward mandatory. The end state is that all P0 golden paths, cross-tenant isolation, unit, build, and coverage-baseline are required to merge, and every production release is confirmed by the authenticated canary.

## 9. Phased rollout (value first)

- **Phase 1 (now): stand up authenticated rep E2E and lock the two worst silent-failure classes.**
  - Build the Playwright rep project + rep seed (org + rep + saved path + a couple of deals) + a storageState login fixture; wire into `e2e-onboarding.yml`.
  - Land golden paths #2 (drop-in fan-out) and #1 (authenticated Path load) as the first rep specs, non-blocking.
  - Add `supabase/tests/0xx_cross_org_isolation.sql` (#5) into the `database` job (blocking; DB tests are already stable).
  - Add lint + coverage reporting (non-blocking) to `test.yml`.
  - Write the one-page bug-to-test policy + a PR-template checkbox; backfill `stores/auth.ts` pure-helper tests as the first debt paydown.
- **Phase 2: broaden E2E + close admin seams.** Invite round-trip (#4), Kanban drag-commit (#3), running carousel (#6); seat-cap + capability parity; RLS scripts for `email_capture` and `scheduled_appointments` + the new-table-RLS check; turn the coverage ratchet on.
- **Phase 3: edge functions + production safety.** Edge-function integration job; authenticated post-deploy canary; prod secrets re-check; write and drill the rollback runbook; Plan-wizard E2E (#7) + owed/due-today tests.
- **Phase 4 (optional for beta): drift guards.** Optional Playwright screenshot snapshots on a few key screens (light + dark); Lighthouse-CI or bundle-size budget on login + dashboard; client drift check; extend the destructive-migration guard to flag `TRUNCATE`, `ALTER COLUMN ... TYPE`, and bare `DELETE`/`UPDATE` without `WHERE`.

## 10. Phase 1 task breakdown (near-term plan)

1. **Rep seed:** a seed script/migration that creates one org + one admin + one rep + a saved path with a few stops + a couple of deals, reusable by the E2E harness and integration tests. Mirror the local-Supabase boot already in `e2e-onboarding.yml`.
2. **Login fixture:** a Playwright storageState fixture that signs the seeded rep in once and reuses the session across specs (fast). Reading generated invite tokens straight from the local DB is the established pattern (`supabase/tests` 006/022) for the later invite E2E.
3. **Spec: authenticated Path load (#1):** seeded rep signs in, opens `/path`, asserts the day's stops render with counts.
4. **Spec: drop-in fan-out (#2):** seeded rep opens a stop, logs a follow-up outcome with a note, then asserts against the real local DB that the deal shows on `/pipeline`, exactly one activity row exists with correct type/owner/org, and the follow-up appointment appears.
5. **DB test: cross-org isolation (#5):** two orgs, assert zero cross-org bleed for team, deals, and activities, including the admin path.
6. **CI wiring:** rep specs run non-blocking in `e2e-onboarding.yml`; the cross-org DB test runs blocking in the `database` job; add `--coverage` reporting and the lint step to `test.yml` (non-blocking).
7. **Policy:** commit the one-page bug-to-test policy and a PR-template checkbox.

## 11. Tooling and honest constraints

- **All of this extends what exists; no new frameworks.** Playwright, Vitest, the psql harness, and GitHub Actions are already in place.
- **Mock-flag posture:** staging runs all mock flags ON; prod has `PLACES_MOCK` OFF (live Google) since 2026-08-20. Seed or mock Places results deterministically inside E2E rather than hitting live Google in CI. Keep the authenticated prod canary strictly read-only.
- **Flake controls:** dnd-kit drag and the geolocation/day-load path are the likely flake sources. Use Playwright's built-in drag with explicit target assertions, stub geolocation via the browser context, and assert on persisted DB state (not toasts) so a passing test proves a real write.
- **Edge functions** run on Deno and cannot be reached by Vitest; they need their own integration job (Phase 3).
- **Scope for a beta team, not Google:** keep the required-on-PR set to the handful of P0 golden paths; run heavier jobs (edge-runtime integration, visual, Lighthouse) as separate or optional jobs so PR latency stays low.
- The `promote-production` actor allowlist is an in-file check, not a security boundary. The Terms page is still DRAFT while consent binds, so gate any consent-version test on a published (non-draft) version. The dev server serves `main`, not worktrees, so authenticated screens are verified via tests + the seeded harness, not a local preview of a feature branch.
