# Environments and release pipeline

**Date:** 2026-08-06, substantially revised 2026-08-12
**Status:** Design v2. Supersedes v1 (commits `a419825`, `0027cbe`).
**Author:** Ryan Meo + Claude, reviewed adversarially by Fable 5 on 2026-08-12

> **v1 was wrong on facts and on one point of architecture.** It was written
> against a checkout 163 commits behind `origin/main`, which is the exact hazard
> section 2.1 documents. Corrections are recorded in section 19 rather than
> silently absorbed, because the errors are instructive. The two implementation
> plans written from v1 are superseded and must not be executed.

---

## 1. Summary

navigatr runs on a single Supabase project that is simultaneously production,
development, and demo. Schema changes reach it by pasting SQL into the dashboard,
so the repository is not a reliable description of what is running.

This design replaces that with local, staging, and production environments on a
pipeline where the repository is the source of truth. The environment split is
the visible part; the migration pipeline underneath is what reduces risk.

**Governing constraint (changed 2026-08-12):** roughly 50 beta users are ready
but **have not been onboarded**. Production holds only Ryan's own test accounts
and demo data. A code freeze is in effect and the pipeline is built *before*
onboarding, reversing v1's plan. Two consequences dominate this revision:

1. Destructive schema changes are still free. The full cleanup is back on.
2. Nothing here needs to be non-destructive or rushed. v1's compressed triage
   is discarded.

---

## 2. Current state (verified against the live checkout 2026-08-12)

| Layer | Today |
|---|---|
| Frontend | One Vercel project. `main` deploys to `app.getnavigatr.io`. Every merge reaches production. |
| Backend | One Supabase project, ref `ogvcveimjjeywfdkkinb`, West US (North California). |
| Migrations | **100** files in `supabase/migrations/`, applied to production by pasting SQL into the dashboard. |
| Edge functions | **12** functions plus `_shared/`, deployed by hand, sometimes hand-flattened. |
| CI | `.github/workflows/test.yml`: typecheck and vitest only. No build, no lint, no database checks, no deploy. |
| Frontend + shared tests | `apps/app/vitest.config.ts:31` already includes `supabase/functions/_shared/**`, so those 15 tests **do** run in CI today. |
| Database tests | **9 files** in `supabase/tests/`. **Not pgTAP** (zero `plan()` calls). Plain psql scripts using `do $$ ... raise` assertions, run via `psql -f`. They run nowhere. |
| Seed data | `config.toml:65` references `supabase/seed.sql`, which does not exist, so `supabase db reset` does not complete. |
| Secrets | Dashboards only. No manifest. |
| Supabase org | Production shares org `lwicvufjihaqvlebwulb` with 13 unrelated projects. |
| Docs | `README.md` describes a .NET backend at `apps/api/` that does not exist. |

### 2.1 Evidence that drift is real

1. `PLACES_MOCK` is set on production to save cost, so the live Google Places
   path has never run in production.
2. On 2026-08-06 the local checkout was 163 commits behind `origin/main` with a
   staged revert of 103 tracked files, including shipped features and the
   `send_auth_email` function. Resolved by `git reset --hard origin/main`.
3. Per the security review of 2026-07-30, two security migrations from commit
   `fc8aa87` were never applied to production. The drift report should expect to
   find them.

### 2.2 Shared Supabase organization

Production sits alongside RewardHire, JIBPayments-Prod, Bison Payments,
Invoisure Demo and others. Anyone with org access reaches navigatr production;
billing and spend limits are org-wide; and navigatr's buyers are payment and
payroll ISOs who will ask where their reps' data lives. Navigatr LLC is a
separate entity from OutsideHire.

**Resolution: transfer to a dedicated organization now**, before onboarding and
**before enabling PITR**, since add-ons can block a transfer. Downtime is free
while there are no customers. Do **not** create a new project: the Google OAuth
client under verification is bound to the current project ref.

---

## 3. Goals

1. A safe place to exercise real flows before customers see them.
2. Confidence that a schema change cannot silently break production.
3. Gates that let a second engineer join without stepping on production.
4. An operational load, once built, of roughly: nothing daily, one button to
   release, one alarm to read weekly.

## 4. Non-goals

- **A separate QA environment.** QA stages exist to serialize handoffs between
  developers, QA engineers, and release managers. Those roles do not exist here.
  Staging *is* QA; the promote step is what makes it so. Revisit when a second
  engineer starts stepping on staging.
- **A custom super-admin tool for watching the pipeline.** GitHub Environments,
  the Actions tab, Vercel's deployment list, Supabase logs, and Sentry already
  are that dashboard, with approval gates built in. Building a second product
  with production credentials, serving one user, is not worth the rot. See
  section 16 for the cheap alternative and for the in-app admin surface that
  *is* worth building, later, as a product feature.
- **A demo environment, for now.** The flag-gated `reset_demo_data` demo org
  already works. Build the separate environment the week an ISO demo is actually
  scheduled (section 15), not before.
- Per-pull-request ephemeral databases; self-hosting; multi-region.

---

## 5. Environment topology

|  | Local | Staging | Production |
|---|---|---|---|
| Supabase | Docker via CLI | new project | existing `ogvcveimjjeywfdkkinb` |
| Frontend | `localhost:5173` | `staging.getnavigatr.io` | `app.getnavigatr.io` |
| Git branch | any | `main` | `release` |
| Deploys when | developer runs it | every merge to `main` | promote button only |
| Data | `seed.sql` | generated, 50-rep volume | real customers |
| Mock flags | all `1` | all `1` except as noted | unset |
| Email | captured locally | allowlist only | live via Resend |
| `APP_ENV` | `local` | `staging` | `production` |
| Robots | n/a | `noindex` | indexable |

### 5.1 The two-branch model (corrects a v1 error)

v1 had promote controlling the database and edge functions while Vercel deployed
the frontend on every merge to `main`. Any change needing both a migration and
frontend code would break production in the gap. v1 also proposed deploying
Vercel on a git tag, which Vercel does not support.

Corrected model, using only native Vercel behavior:

- Vercel's **production branch is `release`**.
- `main` is the staging branch; `staging.getnavigatr.io` serves `main`.
- **Promote** is one workflow: migrate the production database, deploy production
  edge functions, then fast-forward `release` to `main`. Vercel deploys the
  frontend last, automatically, after the backend is ready.

One button moves everything, in the correct order, with no Vercel CLI.

### 5.2 Vercel Preview deployments must not point at production

Today there is one Supabase project, so every pull request preview build carries
production credentials. Any preview link is a live client against real data. The
moment staging exists, Vercel's Preview environment variables move to staging.
Two minutes, closes a real hole.

### 5.3 Email safety outside production

`send_invite_email` and `send_auth_email` consult a shared guard. When
`APP_ENV != "production"`, a recipient not on an explicit allowlist is logged and
dropped. The guard **fails closed**: an unset `APP_ENV` drops the send.

**Ordering hazard, and it is severe.** Because the guard fails closed, deploying
it to production before `APP_ENV=production` is set there would silently drop
every invite and every auth email. `APP_ENV=production` must be set on the
production project as an explicit, verified step *before* the guard code reaches
it.

Staging and demo use a separate Resend sending domain so an escape cannot damage
production's deliverability reputation.

### 5.4 OAuth clients per environment

The Google Calendar client is under verification; adding redirect URIs risks
resetting the review. Staging gets a separate client in testing mode, scheduled
**after** verification completes. Until then staging runs `CALENDAR_MOCK=1`.

---

## 6. Database pipeline

### 6.1 Drift report first

Build a database from the 100 repo migrations, dump production's schema, diff
them. Sort every difference into: exists in production but no migration; exists
in the repo but not production; exists in both but defined differently; cosmetic.

This report decides section 6.2, and must be read by a human before anything is
changed.

### 6.2 Baseline strategy: a decision, not a foregone conclusion

v1 assumed the baseline must be a dump of production. With no customer data, a
better option exists:

| | Repo-canonical | Production-canonical |
|---|---|---|
| Method | Fix the 100 migrations until `db reset` builds clean, then make production match the repo | Dump production's schema as a single baseline, archive the 100 files |
| Result | The repo is canonical by construction | Years of paste-drift enshrined as the permanent baseline |
| Cost | Higher, proportional to drift | Lower, fixed |
| Preferred | **Yes, if drift is small** | Fallback if drift is large |

The drift report decides. Either way, section 6.3 is mandatory.

### 6.3 What a schema dump silently loses (the deepest v1 error)

`supabase db dump` covers `public` only. It captures none of the following, and
critically, **a diff of two dumps is blind to the same omissions on both sides**,
so v1's verification step would have passed while staging was broken:

| Lost | Source | Consequence |
|---|---|---|
| Trigger on `auth.users` | `20260517000002_signup_trigger.sql:64` | No signup path. Invites do not work. |
| Storage buckets and policies | `20260608000001_voice_notes.sql:11`, `20260618000002_deal_notes_files.sql:46` | Voice notes and deal files broken |
| Two `pg_cron` schedules | `20260624000004`, `20260727000003` | Coverage and Persistence Index dashboards silently stale |
| Vault secrets read by those jobs | `vault.decrypted_secrets` | Cron jobs fail |
| Reference data | 33 migrations contain `insert into` | Chain exclusion off, business-day math wrong |

**Required:** a `baseline_supplements.sql` migration recreating the auth trigger,
storage buckets and policies, and cron schedules; a reference-data seed; and the
bootstrap runbook in section 8.2.

**Verification is not the diff.** It is staging's first end-to-end pass: send an
invite, complete signup, log in, record a voice note, attach a deal file, and
confirm the overnight cron produced snapshots.

### 6.4 Additive migrations, switching on at onboarding day

Before onboarding there is no data to protect, so the rule costs time and buys
nothing. **The full destructive cleanup happens now**, while it is free. v1's
"two or three worst names" triage was a concession to a date that has moved.

From the first real user onward: additive only. Destructive changes split across
two releases. Enforced by a CI check that fails any migration containing
`DROP TABLE`, `DROP COLUMN`, or `RENAME` without an explicit override comment.

### 6.5 Proof on every pull request

CI creates an empty database, applies every migration from zero, then runs the 9
psql test scripts. A migration that cannot build a database from scratch cannot
merge.

### 6.6 Migration ledger cleanup

If production's `schema_migrations` holds rows from past `db push` attempts,
archiving the files orphans them and `db push` will refuse. Each orphan must be
repaired to `reverted`. v1 handled only the happy path.

---

## 7. Testing, corrected

v1 claimed 7 pgTAP files that "run nowhere" and proposed a `deno test` CI job.
Both were wrong.

| Suite | Count | Runs today? | Plan |
|---|---|---|---|
| Frontend vitest | many | Yes | Add `pnpm build` and lint alongside |
| `supabase/functions/_shared/**` | 15 | **Yes**, via `vitest.config.ts:31` | Leave alone. No `deno test` job. |
| `supabase/tests/*.sql` | 9, not pgTAP | **No** | Run via a `psql -f` loop against the local stack |

One of the nine (`demo_data_reset.sql`) is documented manual checks needing a
signed-in JWT, not an executable test. Exclude it from the loop.

Any new edge function test is written **vitest-style**, matching the 15 that
already exist. A Deno-style test would be picked up by the vitest glob and break
the suite.

The psql scripts target early-June schema and their main value is RLS regression
coverage. `prospects_nearby` has been redefined roughly 10 times since. Auditing
and repairing them is drift-report homework, not a CI-time surprise.

---

## 8. Configuration

### 8.1 Secrets manifest

`supabase/secrets.manifest.json` lists required key **names** per environment;
values are never committed. A checker runs inside the deploy workflows, where the
access token already exists, rather than as a pull request gate.

Keys v1's table omitted, found by grepping the functions: `SEND_EMAIL_HOOK_SECRET`
(without it `send_auth_email` fails and login emails stop), `ASSEMBLYAI_API_KEY`,
`CALENDAR_CALLBACK_BASE`, `TRANSCRIBE_MOCK`.

All six mock flags compare against the exact string `"1"`. Any other value,
including `"false"`, disables the mock and spends real money.

### 8.2 The bootstrap runbook (missing entirely from v1)

Per-project settings that live only in the dashboard, are invisible to the repo
and to any schema diff, and must be recreated for every new environment:

- Auth Site URL and redirect allowlist (a past production incident: password
  reset was silently broken until the allowlist was corrected)
- Auth email rate limits
- The Send-Email hook URL, its enablement, and `SEND_EMAIL_HOOK_SECRET`
- Vault secrets: `coverage_fn_url`, `coverage_service_role_key`,
  `persistence_fn_url`, `persistence_service_role_key`
- Per-function `verify_jwt` posture

Without this, staging's login is broken out of the box and a "does the page
render" check would still pass.

### 8.3 Per-function JWT posture

`config.toml` gains a `[functions]` section. **`calendar_oauth` must be
`verify_jwt = false`**: its `/callback` route is a provider redirect carrying no
Supabase JWT (`calendar_oauth/index.ts:16`). v1's example set it `true`, which
would break calendar connect. Read each function's real posture from the
dashboard before writing this section.

### 8.4 Credential rotation

The AssemblyAI key passed through a chat transcript and is pending rotation. This
program also creates new long-lived credentials (`SUPABASE_ACCESS_TOKEN` in
GitHub). Rotate the known-exposed key as part of this work.

---

## 9. CI/CD

**Supabase CLI reality (corrects a v1 error):** `--project-ref` is **not** a valid
flag on `db push`, `db dump`, `migration repair`, or `migration list`. Verified
against CLI v2.98.2. Only `functions deploy` and the `secrets` commands accept it.
Everything else requires `supabase link --project-ref $REF` first, or `--db-url`.
Four of v1's workflow steps would have failed on this.

**On every pull request:** lint; typecheck; `pnpm build`; vitest (frontend plus
the 15 shared tests); database built from zero; the psql test loop;
destructive-migration check.

**On merge to `main`:** migrate staging, deploy staging functions. Vercel deploys
the staging frontend from `main` automatically.

**On promote:** snapshot production, migrate production, deploy production
functions, fast-forward `release` to `main`, run the smoke test, write a release
tag. `workflow_dispatch` with a typed confirmation and a required reviewer.

**Smoke test:** a short Playwright run against the deployed environment. Keep the
assertions loose enough to survive Sentry and Intercom console noise; a flaky
smoke step trains the habit of overriding the gate.

**Scheduled workflows must not target a GitHub Environment with required
reviewers**, or they hang waiting for approval. They also need explicit
`permissions:` blocks (`issues: write` to open issues, `contents: write` to push
tags).

---

## 10. Branch protection

- Required status checks on `main`: yes, all of section 9's pull request checks.
- Required human reviewers: **no**, until a second engineer joins. A solo
  operator approving their own pull requests learns to click through gates.
- Direct pushes to `main` and `release`: disabled.

---

## 11. Data handling

Lower environments get data from seed generators in the repository. Production
data is never copied down. Seeding a loginable user means inserting into
`auth.users` and `auth.identities` and fires the signup trigger, which consumes
invite metadata; `supabase/tests/007_path_prospect_store.sql` shows the working
pattern and should be followed rather than reinvented.

---

## 12. Backups and rollback

| Layer | Rollback | Time |
|---|---|---|
| Frontend | Promote the previous Vercel deployment | seconds |
| Edge functions | Redeploy from the previous release tag | about a minute |
| Database | No automatic rollback. Mitigated by 6.4 and pre-promote snapshots. | n/a |

**Point-in-time recovery is enabled as the final step before onboarding**, not
now. It protects real data, of which there is none yet; enabling it early costs
about $100/month during the build and can block the organization transfer.

Rationale for buying it at all: field-sales data is unreconstructable, nobody
recalls twenty business names from a Tuesday, and a loss event during beta costs
the conversion rather than the visits. Pre-promote snapshots remain in addition;
they cover "the migration I just ran was wrong," PITR covers "something has been
corrupting data since this morning."

The recovery window is stated in the beta agreement.

---

## 13. Sequencing

### 13.1 Rollout strategy (unchanged, still the highest-value items)

**Stagger the cohort.** Three to five users first, held a full working day, then
the rest. Converts "50 people witness the same failure" into "5 people hit a bug
45 never hear about."

**Code freeze** through the build and beta week one. Hotfixes only.

### 13.2 Order

**Phase 1, foundations.** Drift report; baseline decision; baseline with
supplements; full destructive cleanup; `seed.sql`; psql test audit and repair;
bootstrap runbook written; Supabase organization transfer.

**Phase 2, gates.** CI: build, lint, database from zero, psql loop, destructive
check. Branch protection.

**Phase 3, staging and release.** Staging project bootstrapped from the runbook;
Vercel two-branch restructure; Preview variables moved to staging;
`APP_ENV=production` set on production **before** the email guard deploys; email
guard; deploy-staging workflow; promote workflow; 50-rep volume seed and load
check on staging.

**Phase 4, pre-onboarding.** Live Places test and quota cap; invite rehearsal of
ten; Sentry alert routing proven end to end; README corrected; beta agreement
data terms; PITR enabled last; staged-cohort runbook and go/no-go gate.

**After onboarding.** Demo environment when a demo is scheduled; OAuth client
split when Google verification clears; weekly drift alarm.

---

## 14. Drift alarm

A weekly scheduled job diffs production's schema against the repo and opens an
issue on disagreement. **Deferred until after onboarding**: with branch
protection on and the dashboard habit broken, it insures against a failure the
pipeline already blocks.

---

## 15. Demo environment (deferred)

When built, demo runs the identical artifact as production, differing only in
environment variables and seed data. No branch, build, or code path of its own.
`EMAIL_ALLOWLIST` empty, which the fail-closed guard treats as dropping everything.

---

## 16. Operational visibility without building a tool

Instead of a custom pipeline dashboard: route Sentry alerts, GitHub Actions
failures, and the Google Cloud budget alert into one channel Ryan reads, and add
a links section to `README.md` covering the five existing dashboards. Add a
`/version` route printing the git SHA and `APP_ENV`, which answers the one
question those dashboards do not.

**Separately, and worth building later as a product feature**, an in-app admin
surface for operating the business: org health, user impersonation with an audit
log, per-org feature flags (the `org_features` table already exists), stuck
onboarding, data health. That earns its keep on support load once 50 reps are
live. It is not a devops tool and it comes after this program.

---

## 17. Cost

| Item | Estimate | When |
|---|---|---|
| Supabase staging project | about $10/mo | Phase 3 |
| Supabase Pro, if not active | about $25/mo | Now |
| Vercel Pro, if not active | about $20/mo | Now |
| Point-in-time recovery | about $100/mo | Phase 4, last |
| Demo project | about $10/mo | Deferred |

Verify against the actual plan tiers. Vercel's Hobby plan is non-commercial only;
if navigatr is on Hobby that is a terms problem independent of this design.

Google Places is metered. Cost per rep per day must be measured and a hard quota
cap set before 50 reps run discovery. The existing geohash cell cache
(`discover_prospects/index.ts:57`, 30-day TTL, shared org-wide) reduces this
substantially, so measure before assuming.

---

## 18. Success criteria

1. `supabase db reset` on a clean machine reproduces production, **verified by an
   end-to-end pass** (invite, signup, login, voice note, deal file, overnight
   cron), not by a schema diff.
2. Production's migration ledger matches the repo.
3. A migration that cannot apply from zero is blocked by CI.
4. An unannotated destructive migration is blocked by CI.
5. A merge to `main` produces a working staging deployment with no manual step.
6. Production moves only via the promote workflow, frontend and backend together.
7. Vercel Preview builds point at staging, not production.
8. An email from staging to a non-allowlisted address is dropped, proven by test.
9. Production invites and auth emails still send after the guard deploys.
10. The cohort was admitted in stages.
11. `README.md` describes the real architecture.

---

## 19. Corrections from v1

Recorded rather than absorbed, because the pattern matters more than the items.

| v1 claimed | Reality |
|---|---|
| 60 migrations | 100 |
| 10 edge functions | 12 |
| 7 pgTAP test files | 9 files, none pgTAP |
| `_shared` tests run nowhere | They run today via `vitest.config.ts:31` |
| Add a `deno test` CI job | Would fail; the tests import vitest |
| `org_feature_flags` | `org_features` |
| `activities.user_id` | `activities.logged_by` |
| Add index on `(user_id, occurred_at)` | Already exists as `activities_logged_by_occurred_idx` |
| `--project-ref` on `db push` / `db dump` / `migration repair` | Rejected; use `supabase link` |
| Baseline verified by schema diff | Diff is blind to auth, storage, cron, vault, reference data |
| Vercel deploys on a git tag | Vercel has no such feature |
| `calendar_oauth` `verify_jwt = true` | Must be `false`; the callback carries no JWT |
| Email guard shipped without prod `APP_ENV` | Would silently drop all production email |

**Root cause:** v1 was written against a checkout 163 commits behind, and inferred
what it could not see. The lesson is the one this design exists to institutionalize:
verify against the running system, and prefer checks that fail loudly over
carefulness that depends on memory.
