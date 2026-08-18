---
name: ship-navigatr
description: How to ship, deploy, release, or promote changes for navigatr, plus the local/staging/production environment map. Use whenever shipping code, applying a migration, deploying an edge function, promoting to production, or answering where something is deployed or which URL/branch/database maps to which environment.
---

# Shipping navigatr

navigatr runs on a two-branch pipeline. Follow it. Do NOT push straight to `main`
expecting production, and do NOT hand-apply SQL to the production database. Those
were the old pre-pipeline habits; they bypass every safety gate.

## Environment map

| Layer | Staging | Production |
|---|---|---|
| App URL | https://staging.getnavigatr.io | https://app.getnavigatr.io |
| Git branch | `main` | `release` |
| Vercel scope | Preview | Production |
| Supabase ref | hjhxdznpdytnafsxvptx | ogvcveimjjeywfdkkinb |
| Supabase data API | https://hjhxdznpdytnafsxvptx.supabase.co | https://ogvcveimjjeywfdkkinb.supabase.co |
| Functions base | that ref + /functions/v1 | https://api.getnavigatr.io/functions/v1 |
| Data | test / seed | real customers |
| Mocks | all ON (no cost) | Calendar real; Places mock until the cost decision |

`api.getnavigatr.io` is a custom domain fronting PRODUCTION Supabase, used for
OAuth callbacks (Google/Outlook calendar + login). Local dev runs at
http://localhost:3000 against a local Supabase stack.

## The flow

feature branch -> Pull Request -> merge to `main` (STAGING) -> promote -> `release` (PRODUCTION)

1. Develop on a feature branch. Verify with `pnpm --filter app test`,
   `pnpm exec tsc -b`, and a real `pnpm build` (not just tsc --noEmit).
2. Open a PR. CI rebuilds the DB from zero, runs the RLS tests, runs the build,
   and blocks unannotated destructive migrations. It must pass to merge.
3. Merge to `main`. `deploy-staging.yml` auto-applies migrations + functions to
   STAGING and Vercel builds staging.getnavigatr.io. QA there (you and Robert).
4. Promote to PRODUCTION only on the user's explicit go: run the
   `promote-production` GitHub Actions workflow (workflow_dispatch), type
   `PROMOTE` to confirm. It snapshots the prod DB, applies migrations +
   functions to prod, fast-forwards `release` so the frontend deploys last,
   runs a smoke test, and tags the release.

## Rules

- Migrations live as files in `supabase/migrations/` and are applied by the
  pipeline (`supabase db push`). Do NOT paste migration SQL into the production
  SQL Editor.
- Edge functions are deployed by the pipeline. A one-off
  `supabase functions deploy <name> --project-ref <ref>` is only for a hotfix or
  ops task, and only against the correct ref.
- Mock flags (PLACES_MOCK, CALENDAR_MOCK, GEOCODE_MOCK, TRANSCRIBE_MOCK,
  MICROSOFT_CALENDAR_MOCK) compare against the exact string "1". Staging stays
  mock. Production flips deliberately, per feature.
- Do production deploy/promote ONLY on an explicit user "go". Merging to `main`
  (which ships staging) is fine as normal work once CI is green.
- Never run `supabase secrets list` unfiltered (it prints real values); pipe
  through `awk '{print $1}'`.
- No em or en dashes anywhere (code, comments, strings, chat).

## Quick reference

- Which commit is live: fetch the site's main JS bundle and read the embedded
  release SHA. `main` -> staging, `release` -> production.
- Supabase dashboards: supabase.com/dashboard/project/<ref>
  (staging hjhxdznpdytnafsxvptx, production ogvcveimjjeywfdkkinb).
- Workflows: `.github/workflows/{test,deploy-staging,promote-production}.yml`.
- Bootstrap + design docs live on branch `docs/environments-design`
  (`docs/launch/environment-bootstrap.md`, the environments design spec).
