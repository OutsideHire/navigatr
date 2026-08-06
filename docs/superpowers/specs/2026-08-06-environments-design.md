# Environments and release pipeline

**Date:** 2026-08-06
**Status:** Design approved, not yet implemented
**Author:** Ryan Meo + Claude (lead architect role)

---

## 1. Summary

navigatr runs on a single environment today. Production is also the development
environment, the test environment, and the sales demo environment. Database
changes reach production by pasting SQL into the Supabase dashboard, so the
repository is no longer a reliable description of what is actually running.

This design replaces that with four environments (local, staging, demo,
production) sitting on top of a pipeline where the repository is the source of
truth again. The environment split is the visible part. The migration and
deployment pipeline underneath it is the part that actually reduces risk.

Production currently has no real customer data, which allows a clean
re-baseline rather than a defensive workaround. That window closes the day the
first beta ISO logs in.

---

## 2. Current state (verified 2026-08-06)

| Layer | Today |
|---|---|
| Frontend | One Vercel project. `main` deploys to `app.getnavigatr.io`. Every merge reaches real users. |
| Backend | One Supabase project (linked ref `ogvcveimjjeywfdkkinb`). Postgres + RLS + 9 edge functions. |
| Migrations | 60 files in `supabase/migrations/`, applied to production by pasting SQL into the dashboard. Production's migration history does not match the repo. |
| Edge functions | 9 functions in `supabase/functions/`, deployed by hand through the dashboard, sometimes as manually flattened single files. |
| CI | `.github/workflows/test.yml` runs typecheck and vitest only. |
| pgTAP tests | 7 files in `supabase/tests/`. Run nowhere. |
| Seed data | `config.toml` points at `supabase/seed.sql`, which does not exist. |
| Secrets | Live only in the Supabase and Vercel dashboards. No manifest of what each environment requires. |
| Docs | `README.md` describes a .NET backend at `apps/api/` that no longer exists on disk. |

### 2.1 Evidence that drift is real, not theoretical

Two findings from the 2026-08-06 inspection:

1. `PLACES_MOCK` is enabled on production to save Google Places cost. This means
   the live Places code path has never been exercised in the environment where it
   matters.
2. This local checkout of `main` is 163 commits behind `origin/main`, with a
   staged changeset of 103 tracked files (48 deletions) that reverts shipped
   features including the Persistence Index and Activity-to-Win reports. Working
   tree and index agree, so the files on disk are stale code.

Neither is caused by bad discipline. Both are what happens when there is no
pipeline making the correct thing also the easy thing.

---

## 3. Goals

1. A safe place to exercise real flows before customers see them.
2. A stable demo instance for selling to ISOs that in-progress work cannot break.
3. Confidence that a schema change cannot silently break production.
4. Gates that let a second engineer join without stepping on production.

## 4. Non-goals

- Per-pull-request ephemeral databases. Worth adding later, on top of this.
- Kubernetes, containers, or any self-hosted infrastructure. Vercel and Supabase
  managed services remain the platform.
- Multi-region or high-availability topology. Not warranted pre-launch.
- Migrating off Supabase or Vercel.

---

## 5. Environment topology

|  | Local | Staging | Demo | Production |
|---|---|---|---|---|
| Supabase | Docker via Supabase CLI | new project | new project | existing `ogvcveimjjeywfdkkinb` |
| Frontend | `localhost:5173` | `staging.getnavigatr.io` | `demo.getnavigatr.io` | `app.getnavigatr.io` |
| Deploys when | developer runs it | every merge to `main`, automatic | manual trigger, same artifact as production | manual promote from staging |
| Data | throwaway, from `seed.sql` | generated fake data, wipeable | curated multi-layer ISO org, reseeded nightly | real customers |
| `PLACES_MOCK` | `true` | `true` | `true` | unset (live Google Places) |
| Email | captured locally, never sent | allowlist only | suppressed | live via Resend |
| Sentry environment | disabled | `staging` | `demo` | `production` |
| Robots | n/a | `noindex` | `noindex` | indexable |

### 5.1 Demo is a deploy target, not a third pipeline

Demo runs the identical build artifact as production. It differs only in
environment variables and seed data. It has no branch of its own, no build of
its own, and no code path of its own. If demo ever requires its own code, that
is a defect in this design, not a feature of it.

This keeps the maintenance cost of the third environment close to zero.

### 5.2 Email safety outside production

Today the invite and auth email functions send to whatever address is in the
database. Once staging exists, one accidental bulk CSV invite on staging would
email real strangers from an unfinished build.

Requirement: `send_invite_email` and `send_auth_email` must check an
`APP_ENV` variable. When `APP_ENV != "production"`, a recipient not on an
explicit allowlist is logged and dropped, never sent. Staging and demo also use
a separate Resend sending domain so that any escape cannot damage the
deliverability reputation of the production domain.

### 5.3 OAuth clients per environment

The Google Calendar OAuth client is currently under Google verification review
(`docs/launch/google-oauth-verification/`). Adding staging and demo redirect
URIs to that client risks disturbing the review.

Requirement: staging and demo share a **separate** Google OAuth client in
testing mode, with Ryan and Robert as named test users. Production keeps the
client under review, untouched. The same separation applies to the Microsoft
Azure app registration
(`docs/launch/microsoft-outlook-setup/AZURE-APP-SETUP.md`).

---

## 6. Database pipeline

This is the core of the design. Everything else depends on it.

### 6.1 Measure the drift first

Before changing anything, produce a drift report:

1. Build a fresh database by running all 60 existing repo migrations from zero.
2. Dump production's actual schema with `supabase db dump --linked`.
3. Diff the two.

The output is a written record of every place where the repo and production
disagree. No one has ever seen this. It must be reviewed by a human before step
6.2 proceeds, because it may surface objects in production that exist in no
migration file at all.

### 6.2 Re-baseline

1. Move the 60 existing migration files to `supabase/migrations/_archive/`,
   retained for history and never executed.
2. Create a single `supabase/migrations/<timestamp>_baseline.sql` containing
   production's real schema, verbatim from the dump.
3. Use `supabase migration repair` so production's migration ledger records the
   baseline as already applied.
4. Verify that `supabase db reset` on a clean local database reproduces
   production's schema exactly, by re-running the 6.1 diff and confirming it is
   empty.

After this, repo and production are provably identical.

### 6.3 The rule that keeps it fixed

Schema changes reach any environment only through a timestamped migration file
applied by CI running `supabase db push`. The Supabase SQL Editor is not used to
change schema again, in any environment.

### 6.4 Migrations must be additive

Rollback of a frontend deploy is instant. Rollback of a migration is not, and no
tooling changes that. Therefore:

- Add columns and tables. Do not rename or drop them in the same release.
- A destructive change is split across two releases with a gap: release one adds
  the new shape and writes to both; release two removes the old shape once
  nothing reads it.

This discipline is worth more than any rollback automation.

### 6.5 Proof on every pull request

CI creates an empty Postgres, applies every migration from zero, then runs the 7
pgTAP files in `supabase/tests/`. A migration that cannot build a database from
scratch cannot merge.

### 6.6 Seed file

Create the missing `supabase/seed.sql`: one organization, one manager, a small
number of reps, and enough activity for the app to look alive on first run.
`config.toml` already references this path.

---

## 7. Edge functions

The 9 functions share code through relative `../_shared/` imports, which is why
dashboard deployment has required hand-flattening them into single files. The
Supabase CLI bundles these automatically.

Requirement: CI deploys all functions with `supabase functions deploy`. Manual
dashboard editing of function source stops. Function unit tests under
`supabase/functions/_shared/` (currently `chunk.test.ts`, `geohash.test.ts`,
`icpFilter.test.ts`, `industryTaxonomy.test.ts`, and the four under
`_shared/coverage/`) run in CI via `deno test`.

`supabase/config.toml` gains a `[functions]` section declaring `verify_jwt` per
function, so authentication posture is described in the repo rather than set by
clicking.

---

## 8. Secrets and configuration

Three environments means three sets of keys, and the predictable failure is a
missing key discovered during an incident.

Requirement: a checked-in manifest, `supabase/secrets.manifest.json`, listing
every required key **name** per environment. Values are never committed. A CI
job reads the manifest and fails if any environment is missing a declared key.

Known keys, from code inspection:

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

Frontend `VITE_*` variables are set per Vercel environment. Vercel's Production,
Preview, and a custom Staging environment map to production, pull-request
previews, and staging respectively.

Deployment credentials (Supabase access token, project refs, Vercel token) live
in GitHub Environments, one per target, so the production credential is only
reachable from the production deployment job.

---

## 9. CI/CD

### 9.1 On every pull request

- lint
- typecheck
- `pnpm build`, the real production build (not currently run; a failing build has
  previously blocked a Vercel deploy silently)
- vitest unit tests
- `deno test` for edge function shared code
- build a database from zero using every migration
- run the 7 pgTAP files against that fresh database
- secrets manifest check

### 9.2 On merge to `main`

Automatic, in order: migrate staging database, deploy staging edge functions,
deploy staging frontend. Roughly two minutes. Failure here is expected
occasionally and is the purpose of staging.

### 9.3 On promote

A manually triggered GitHub Action, "Promote staging to production". It takes the
commit currently deployed to staging, applies its migrations to production,
deploys its edge functions, deploys the same frontend artifact, and writes a
release tag as a rollback marker.

Git tags are created by the workflow rather than by hand. The operator presses a
button; they do not construct a tag under time pressure.

### 9.4 On demo refresh

A manually triggered action deploying the current production release to demo,
followed by a demo reseed. A nightly scheduled job reseeds demo so that a messy
sales call leaves no residue.

---

## 10. Branch protection and daily workflow

```
feature branch -> pull request -> required checks pass -> merge to main
                                                            |
                                                            v
                                              staging deploys automatically
                                                            |
                                                   verify on staging
                                                            |
                                                            v
                                          press "Promote to production"
```

**Required status checks on `main`: yes.** Every check in 9.1 must pass.

**Required human reviewers on `main`: no**, until a second engineer joins. A
solo operator approving their own pull requests is ceremony that teaches the
habit of clicking through gates. Passing checks are the real gate.

**Direct pushes to `main`: disabled.** This is the behavior change that makes
the rest work.

---

## 11. Data handling

All lower environments get their data from seed generators committed to the
repository. Production data is never copied down to staging or demo.

Once real ISOs are in production, their records include contact names, phone
numbers, and visit notes for real businesses. Copying that into an environment
with weaker access control and broader developer access would be a privacy
problem regardless of intent. Stating the rule now, while it costs nothing to
follow.

The existing demo-org seeding work (the flag-gated reset wrapper and curated
multi-layer synthetic org) is promoted into a versioned seed script that the
demo environment runs, rather than a production feature flag.

---

## 12. Rollback and backups

| Layer | Rollback | Time |
|---|---|---|
| Frontend | Promote the previous Vercel deployment | seconds |
| Edge functions | Redeploy from the previous release tag | about a minute |
| Database | No automatic rollback. Mitigated by the additive-migration rule in 6.4. | n/a |

**Backups.** Before the first beta ISO logs in, confirm production's backup
configuration and write down the recovery window. Supabase Pro includes daily
backups, meaning worst-case data loss is up to one day. Point-in-time recovery
is a paid add-on. Decide explicitly whether losing a day of a beta customer's
logged visits is acceptable, and price PITR if it is not. This decision is made
before launch, not after an incident.

---

## 13. Sequencing

### Must exist before the first ISO touches the product

1. Drift report and re-baseline (section 6.1, 6.2)
2. `pnpm build` added to CI (section 9.1)
3. Migration-from-scratch and pgTAP checks in CI (section 9.1)
4. Staging Supabase project and `staging.getnavigatr.io`
5. Email allowlist outside production (section 5.2)
6. Separate OAuth clients for lower environments (section 5.3)
7. Production deploys by promote, not by merge (section 9.3)
8. Branch protection with required checks (section 10)
9. Backup and recovery window confirmed (section 12)
10. `PLACES_MOCK` unset on production

### Can follow

11. Demo environment (build it the week of the first scheduled ISO demo)
12. Nightly demo reseed (reseed by hand until then)
13. Weekly schema drift alarm (section 14)
14. Per-pull-request ephemeral databases

---

## 14. Drift alarm

The re-baseline fixes today's drift. It does not prevent the habit returning at
11pm when opening the SQL Editor is faster than writing a migration.

A scheduled weekly GitHub Action dumps production's live schema, diffs it
against the repo baseline plus migrations, and opens a GitHub issue if they
disagree. Roughly 30 lines. It is the difference between fixing the problem and
keeping it fixed.

---

## 15. Cost

Estimated additional monthly cost, to be verified against the actual Supabase
organization plan and Vercel tier before commitment:

| Item | Estimate |
|---|---|
| Supabase staging project (micro compute) | about $10 |
| Supabase demo project (micro compute) | about $10 |
| Supabase Pro plan, if not already active | about $25 |
| Vercel Pro, if not already active | about $20 |
| Additional Resend sending domain | included on current plan |

Order of $65 to $85 per month all in.

Separate check, independent of this design: Vercel's Hobby plan is for
non-commercial use. If the navigatr Vercel account is on Hobby, selling the
product on it is a terms problem that must be resolved regardless.

---

## 16. Things to verify during implementation

These are checks with named owners, not open design questions.

1. Current Supabase organization plan tier and whether Pro is active. (Ryan, via
   Supabase dashboard billing.)
2. Current Vercel plan tier. (Ryan, via Vercel dashboard billing.)
3. Whether `getnavigatr.io` DNS is managed somewhere that allows adding
   `staging.` and `demo.` subdomains. (Ryan.)
4. Whether `send_auth_email` exists in production but not in the current working
   tree, and which other functions have drifted. (Resolved by the 6.1 drift
   report.)
5. Whether production contains any object created outside a migration file.
   (Resolved by the 6.1 drift report.)

---

## 17. Success criteria

The design is implemented when all of the following are true:

1. `supabase db reset` on a clean machine reproduces production's schema exactly.
2. No human has changed production schema through the SQL Editor since the
   re-baseline.
3. A pull request with a migration that cannot apply from zero is blocked by CI.
4. A merge to `main` results in a working staging deployment with no manual step.
5. Production has not been deployed to except by the promote workflow.
6. An email sent from staging to a non-allowlisted address is dropped, verified by
   test.
7. The production recovery window is documented and accepted.
8. `README.md` describes the actual architecture, with the .NET reference removed.

---

## 18. Prerequisite outside this design

This local repository checkout is 163 commits behind `origin/main` and carries a
staged changeset reverting 103 tracked files. It must be reconciled before any
implementation work begins here, or that work will be built on stale code. This
is tracked separately from this design.
