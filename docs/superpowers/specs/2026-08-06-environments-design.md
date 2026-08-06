# Environments and release pipeline

**Date:** 2026-08-06
**Status:** Design approved. Split into two implementation plans (see section 13).
**Author:** Ryan Meo + Claude (lead architect role)

---

## 1. Summary

navigatr runs on a single environment. Production is also the development
environment, the test environment, and the sales demo environment. Database
changes reach production by pasting SQL into the Supabase dashboard, so the
repository is no longer a reliable description of what is running.

This design replaces that with four environments (local, staging, demo,
production) on top of a pipeline where the repository is the source of truth
again. The environment split is the visible part. The migration and deployment
pipeline underneath it is what actually reduces risk.

**Governing constraint:** roughly 50 beta users are onboarding the week of
2026-08-10. That date is fixed and the full pipeline cannot be built before it.
The work is therefore split into a short pre-onboarding checklist and a larger
program executed during a code freeze after onboarding begins.

---

## 2. Current state (verified 2026-08-06)

| Layer | Today |
|---|---|
| Frontend | One Vercel project. `main` deploys to `app.getnavigatr.io`. Every merge reaches real users. |
| Backend | One Supabase project (ref `ogvcveimjjeywfdkkinb`, West US North California). Postgres + RLS + 10 edge functions. |
| Migrations | 60 files in `supabase/migrations/`, applied to production by pasting SQL into the dashboard. Production's migration ledger does not match the repo. |
| Edge functions | Deployed by hand through the dashboard, sometimes as manually flattened single files. |
| CI | `.github/workflows/test.yml` runs typecheck and vitest only. No build, no lint, no database checks, no deploy. |
| pgTAP tests | 7 files in `supabase/tests/`. Run nowhere. |
| Seed data | `config.toml` references `supabase/seed.sql`, which does not exist. |
| Secrets | Live only in the Supabase and Vercel dashboards. No manifest of what each environment requires. |
| Supabase org | navigatr production shares organization `lwicvufjihaqvlebwulb` with 13 unrelated projects. |
| Docs | `README.md` describes a .NET backend at `apps/api/` that no longer exists. |

### 2.1 Evidence that drift is real

1. `PLACES_MOCK` is enabled on production to save Google Places cost. The live
   Places code path has never been exercised in the environment that matters.
2. On 2026-08-06 the local `main` checkout was 163 commits behind `origin/main`
   with a staged changeset reverting 103 tracked files, including shipped
   Persistence Index and Activity-to-Win features and the `send_auth_email`
   edge function. Resolved by `git reset --hard origin/main` the same day.

Neither is a discipline failure. Both are what happens when no pipeline makes
the correct action also the easy one.

### 2.2 Shared Supabase organization

navigatr production sits in an organization alongside RewardHire,
JIBPayments-Prod, JIBPayments-UAT, BisonJIB-Development, Bison Payments,
Invoisure Demo, Palo Tayo, Fan Fair Partner Portal and others.

Consequences: anyone with organization access can reach navigatr production
data; billing and spend limits are organization-wide; and navigatr's buyers are
payment and payroll ISOs who will ask where their reps' data lives during
diligence. Navigatr LLC is also a separate legal entity from OutsideHire.

Resolution: transfer navigatr to its own Supabase organization, and create
staging and demo inside it. Deferred until after onboarding stabilizes because
it is a production change, and pending confirmation of whether project transfer
causes downtime.

---

## 3. Goals

1. A safe place to exercise real flows before customers see them.
2. A stable demo instance that in-progress work cannot break.
3. Confidence that a schema change cannot silently break production.
4. Gates that let a second engineer join without stepping on production.

## 4. Non-goals

- Per-pull-request ephemeral databases. Worth adding later, on top of this.
- Self-hosted infrastructure. Vercel and Supabase managed services remain the platform.
- Multi-region or high-availability topology.
- Migrating off Supabase or Vercel.

---

## 5. Environment topology

|  | Local | Staging | Demo | Production |
|---|---|---|---|---|
| Supabase | Docker via Supabase CLI | new project | new project | existing `ogvcveimjjeywfdkkinb` |
| Frontend | `localhost:5173` | `staging.getnavigatr.io` | `demo.getnavigatr.io` | `app.getnavigatr.io` |
| Deploys when | developer runs it | every merge to `main`, automatic | manual, same artifact as production | manual promote from staging |
| Data | throwaway, from `seed.sql` | generated fake data at 50-rep volume | curated ISO org, reseeded nightly | real customers |
| `PLACES_MOCK` | `true` | `true` | `true` | unset (live Places) |
| Email | captured locally | allowlist only | suppressed | live via Resend |
| Sentry environment | disabled | `staging` | `demo` | `production` |
| Robots | n/a | `noindex` | `noindex` | indexable |

### 5.1 Demo is a deploy target, not a third pipeline

Demo runs the identical build artifact as production, differing only in
environment variables and seed data. No branch of its own, no build of its own,
no code path of its own. If demo ever needs its own code, that is a defect in
this design. This keeps the third environment's maintenance cost near zero.

### 5.2 Email safety outside production

`send_invite_email` and `send_auth_email` must check an `APP_ENV` variable. When
`APP_ENV != "production"`, a recipient not on an explicit allowlist is logged
and dropped, never sent. Staging and demo use a separate Resend sending domain
so any escape cannot damage the production domain's deliverability reputation.

### 5.3 OAuth clients per environment

The Google Calendar OAuth client is under Google verification review
(`docs/launch/google-oauth-verification/`). Adding staging and demo redirect
URIs risks disturbing that review.

Staging and demo share a separate Google OAuth client in testing mode with Ryan
and Robert as named test users. Production keeps the client under review,
untouched. Same separation for the Microsoft Azure app registration
(`docs/launch/microsoft-outlook-setup/AZURE-APP-SETUP.md`). Scheduled after
Google verification completes.

---

## 6. Database pipeline

### 6.1 Measure the drift first

1. Build a fresh database from all 60 existing repo migrations.
2. Dump production's actual schema with `supabase db dump --linked`.
3. Diff the two.

The output is a written record of every disagreement between repo and
production. It must be reviewed by a human before 6.2 proceeds, because it may
surface production objects that exist in no migration file.

### 6.2 Re-baseline

1. Move the 60 existing migration files to `supabase/migrations/_archive/`,
   retained for history, never executed.
2. Create `supabase/migrations/<timestamp>_baseline.sql` containing production's
   real schema, verbatim from the dump.
3. Use `supabase migration repair` so production's ledger records the baseline
   as applied.
4. Verify `supabase db reset` on a clean local database reproduces production's
   schema exactly, by re-running the 6.1 diff and confirming it is empty.

Because onboarding precedes this work, the re-baseline is performed
non-destructively against a production database that already holds real data.

### 6.3 The rule that keeps it fixed

Schema changes reach any environment only through a timestamped migration file
applied by CI running `supabase db push`. The Supabase SQL Editor is not used to
change schema again, in any environment.

### 6.4 Additive migrations, switching on at onboarding day

The additive rule exists because a destructive migration cannot be undone once
real data exists. Before onboarding day there is no real data, so the rule
protects nothing and only costs time.

- **Until onboarding day:** destructive schema changes are free and encouraged.
  Given the compressed timeline, this is reduced to a targeted pass fixing only
  the two or three worst names or shapes, rather than a full cleanup sweep.
- **From onboarding day onward:** additive only. Add columns and tables; do not
  rename or drop in the same release. Destructive changes split across two
  releases: release one adds the new shape and writes to both, release two
  removes the old shape once nothing reads it.

Enforced mechanically, not by memory: a CI check fails any migration containing
`DROP TABLE`, `DROP COLUMN`, or `RENAME` unless the file carries an explicit
override comment explaining why it is safe.

**Accepted cost of the 2026-08-10 date:** the free-destructive-change window
closes with only a partial cleanup done. Remaining schema regrets become
permanent two-release chores. This is a knowing trade for hitting the date.

### 6.5 Proof on every pull request

CI creates an empty Postgres, applies every migration from zero, then runs the 7
pgTAP files. A migration that cannot build a database from scratch cannot merge.

### 6.6 Seed file

Create the missing `supabase/seed.sql`: one organization, one manager, a small
number of reps, and enough activity for the app to look alive on first run.

---

## 7. Edge functions

The functions share code through relative `../_shared/` imports, which is why
dashboard deployment has required hand-flattening them. The Supabase CLI bundles
these automatically.

CI deploys all functions with `supabase functions deploy`. Manual dashboard
editing of function source stops. Function unit tests under
`supabase/functions/_shared/` run in CI via `deno test`. `supabase/config.toml`
gains a `[functions]` section declaring `verify_jwt` per function, so
authentication posture is described in the repo rather than set by clicking.

---

## 8. Secrets and configuration

A checked-in manifest, `supabase/secrets.manifest.json`, lists every required
key **name** per environment. Values are never committed. A CI job reads the
manifest and fails if any environment is missing a declared key.

| Key | Local | Staging | Demo | Production |
|---|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | auto | required | required | required |
| `GOOGLE_PLACES_API_KEY` | not needed | not needed | not needed | required |
| `PLACES_MOCK` | `true` | `true` | `true` | unset |
| `GEOCODE_MOCK`, `CALENDAR_MOCK`, `MICROSOFT_CALENDAR_MOCK` | `true` | `true` | `true` | unset |
| `RESEND_API_KEY`, `FROM_ADDRESS` | not needed | required (test domain) | required (test domain) | required |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | test client | test client | test client | verified client |
| `APP_BASE_URL`, `APP_URL` | localhost | staging domain | demo domain | production domain |
| `APP_ENV` (new) | `local` | `staging` | `demo` | `production` |

Frontend `VITE_*` variables are set per Vercel environment. Deployment
credentials live in GitHub Environments, one per target, so the production
credential is only reachable from the production deployment job.

---

## 9. CI/CD

**On every pull request:** lint; typecheck; `pnpm build` (the real production
build, not currently run); vitest; `deno test` for edge function shared code;
build a database from zero using every migration; run the 7 pgTAP files against
it; destructive-migration check (6.4); secrets manifest check.

**On merge to `main`:** automatically migrate the staging database, deploy
staging edge functions, deploy the staging frontend. Roughly two minutes.
Failure here is expected occasionally and is staging's purpose.

**On promote:** a manually triggered action, "Promote staging to production".
It snapshots the production database, applies the staging commit's migrations,
deploys its edge functions, deploys the same frontend artifact, runs the smoke
test, and writes a release tag as a rollback marker. Tags are created by the
workflow, not by hand under time pressure.

**Post-deploy smoke test:** a short Playwright run against the deployed
environment that logs in, loads the dashboard, and opens the path screen. Catches
the case where the build succeeded but the app renders blank.

**On demo refresh:** a manual action deploying the current production release to
demo, followed by a reseed. A nightly job reseeds demo so a messy sales call
leaves no residue.

---

## 10. Branch protection and daily workflow

```
feature branch -> pull request -> required checks pass -> merge to main
                                                            |
                                              staging deploys automatically
                                                            |
                                                   verify on staging
                                                            |
                                          press "Promote to production"
```

- **Required status checks on `main`: yes.** Every check in section 9.
- **Required human reviewers: no**, until a second engineer joins. A solo
  operator approving their own pull requests teaches the habit of clicking
  through gates.
- **Direct pushes to `main`: disabled.**

---

## 11. Data handling

All lower environments get data from seed generators committed to the
repository. Production data is never copied down to staging or demo. Real ISO
records contain contact names, phone numbers, and visit notes for real
businesses; copying them into an environment with weaker access control would be
a privacy problem regardless of intent.

The existing demo-org seeding work (the flag-gated reset wrapper and curated
multi-layer synthetic org) is promoted into a versioned seed script the demo
environment runs, rather than a production feature flag.

---

## 12. Backups and rollback

| Layer | Rollback | Time |
|---|---|---|
| Frontend | Promote the previous Vercel deployment | seconds |
| Edge functions | Redeploy from the previous release tag | about a minute |
| Database | No automatic rollback. Mitigated by 6.4 and by pre-migration snapshots. | n/a |

**Point-in-time recovery is enabled before onboarding day.** This reverses an
earlier recommendation made when production held no real data. With roughly 50
beta users:

- Field-sales data is unreconstructable. Nobody can recall 20 business names and
  dispositions from a Tuesday, and there is no upstream system to re-import from.
- A data-loss event during beta does not cost visits, it costs the conversion.
  Word travels inside an ISO, and these orgs are the first revenue.
- With real traffic, slow corruption discovered hours later becomes plausible.
  Daily backups cannot address that; PITR can.

At roughly $100/month against the entire go-to-market, this is not a close call.

**Pre-migration snapshots remain, in addition.** The promote workflow snapshots
production immediately before applying any migration. The two cover different
failures: the snapshot handles "the migration I just ran was wrong," PITR handles
"something has been quietly corrupting data since this morning."

The recovery window is stated in the beta agreement. Beta customers accept a
stated limit; they do not accept an unstated one discovered during an incident.

---

## 13. Sequencing

### 13.1 Rollout strategy

**Stagger the cohort.** Onboard three to five users first, ideally the friendliest
ISO or navigatr's own reps, and watch for a full working day before admitting the
rest. This converts the largest risk, fifty people witnessing the same failure
simultaneously, into five people hitting a bug that forty-five never see.

**Code freeze** from the day before onboarding through the end of week one.
Hotfixes only. A frozen, manually verified build provides roughly what staging
would have provided that week, at zero cost, and frees the week to build staging
properly while nothing ships.

### 13.2 Plan A: pre-onboarding checklist (about 1.5 days)

Must complete before the first rep logs in.

| | Item | Estimate |
|---|---|---|
| 1 | Test live Google Places end to end with `PLACES_MOCK` off | 1-2 hrs |
| 2 | Hard quota cap and budget alert on the Places API, plus a per-org daily discovery limit if time allows | 30 min |
| 3 | Enable point-in-time recovery | 10 min |
| 4 | Check and raise Supabase auth email rate limits; test-send a batch of ten invites | 1 hr |
| 5 | Route Sentry alerts to a channel Ryan actually reads | 15 min |
| 6 | Add `pnpm build` to CI | 10 min |
| 7 | Load-check Persistence Index, Activity-to-Win, and coverage dashboards at 50-rep volume using the existing demo seeding tools | half day |
| 8 | Confirm the backup and recovery window; state it in the beta agreement | 30 min |
| 9 | Targeted destructive schema pass on the two or three worst names or shapes (6.4) | half day |

Consciously deferred from this list: the email allowlist (only matters once
staging exists), the Supabase organization move (a production change too close
to onboarding), branch protection and the promote workflow (for a team that is
shipping, and this one is about to freeze).

### 13.3 Plan B: pipeline program (during the freeze)

- **Beta week 1:** drift report (6.1), non-destructive re-baseline (6.2),
  staging project and domain, staging seeded at 50-rep volume.
- **Beta week 2:** CI gates (9), promote workflow with pre-migration snapshot,
  branch protection (10), post-deploy smoke test, email allowlist (5.2),
  secrets manifest (8), edge function deploys from CI (7). The freeze ends onto
  a real pipeline rather than back onto push-to-production.
- **Beta week 3 and beyond:** own Supabase organization in a planned window
  (2.2), separate OAuth clients once Google verification completes (5.3), demo
  environment, weekly drift alarm (14), `README.md` corrected.

---

## 14. Drift alarm

A scheduled weekly GitHub Action dumps production's live schema, diffs it
against the repo baseline plus migrations, and opens a GitHub issue if they
disagree. Roughly 30 lines. It is the difference between fixing the problem and
keeping it fixed.

---

## 15. Cost

To be verified against the actual Supabase organization plan and Vercel tier.

| Item | Estimate |
|---|---|
| Point-in-time recovery (before onboarding) | about $100 |
| Supabase staging project (micro compute) | about $10 |
| Supabase demo project (micro compute) | about $10 |
| Supabase Pro plan, if not already active | about $25 |
| Vercel Pro, if not already active | about $20 |
| Additional Resend sending domain | included on current plan |

Order of $165 to $185 per month once fully built, of which about $100 is PITR
and required before onboarding.

Google Places is metered and uncapped by default. Cost per rep per day must be
measured (13.2 item 1) and a hard quota cap set (item 2) before fifty reps run
discovery daily.

Separate check, independent of this design: Vercel's Hobby plan is for
non-commercial use. If the navigatr account is on Hobby, selling the product on
it is a terms problem to resolve regardless.

---

## 16. Things to verify during implementation

1. Current Supabase organization plan tier and whether Pro is active. (Ryan.)
2. Current Vercel plan tier. (Ryan.)
3. Production Supabase compute instance size, relative to 50 concurrent reps.
   (Resolved by 13.2 item 7.)
4. Whether `getnavigatr.io` DNS allows adding `staging.` and `demo.` subdomains.
   (Ryan.)
5. Whether a Supabase project transfer between organizations causes downtime.
   (Blocks 2.2.)
6. Which production objects exist in no migration file. (Resolved by 6.1.)

---

## 17. Success criteria

1. `supabase db reset` on a clean machine reproduces production's schema exactly.
2. No human has changed production schema through the SQL Editor since the
   re-baseline.
3. A pull request with a migration that cannot apply from zero is blocked by CI.
4. A pull request with an unannotated destructive migration is blocked by CI.
5. A merge to `main` produces a working staging deployment with no manual step.
6. Production has not been deployed to except by the promote workflow.
7. An email sent from staging to a non-allowlisted address is dropped, verified
   by test.
8. Point-in-time recovery is on, and the recovery window appears in the beta
   agreement.
9. The beta cohort was admitted in stages, not all at once.
10. `README.md` describes the actual architecture, with the .NET reference removed.
