# Pre-Onboarding Checklist (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make navigatr safe to put in front of roughly 50 beta users the week of 2026-08-10, without building the full environment pipeline first.

**Architecture:** This is a runbook, not a feature. Most tasks are production configuration and verification with a small amount of code. The two highest-value items cost no engineering at all: admit the cohort in stages, and freeze the code for beta week one. Everything else closes a specific failure that would be visible to all 50 users or irreversible after they arrive.

**Tech Stack:** Supabase (Postgres, Edge Functions on Deno), Vercel, Vite + React, GitHub Actions, Sentry, Google Cloud Console, Resend.

**Source spec:** `docs/superpowers/specs/2026-08-06-environments-design.md` section 13.2.

**Ordering note:** Task 1 must complete before Task 2, and Task 9 must be the last task that touches the database. Everything else is independent and can run in any order.

---

### Task 0: Lock the two zero-cost decisions

These require no code. They are first because they change the risk profile of every other task.

**Files:**
- Create: `docs/launch/beta-onboarding-runbook.md`

- [ ] **Step 1: Write the runbook that records both decisions**

Create `docs/launch/beta-onboarding-runbook.md`:

```markdown
# Beta onboarding runbook

## Cohort admission is staged, not simultaneous

- **Wave 1 (day 1):** 3 to 5 users. Prefer navigatr's own reps or the single
  friendliest ISO contact. These people are told explicitly that they are first
  and that bugs are expected.
- **Hold for one full working day.** A rep's day is the unit of observation:
  morning route planning, midday drop-ins, end-of-day logging. A half day does
  not exercise the product.
- **Wave 2 (day 3):** the remainder, only if Wave 1 produced no unresolved
  Sentry errors and no failed invite deliveries.

Rationale: the largest risk of this beta is not a missing feature, it is one
visible failure witnessed by all 50 people at once. Staging the cohort converts
that into a bug 5 people see and 45 never hear about.

## Code freeze

- **Starts:** the day before Wave 1.
- **Ends:** the Friday of beta week one.
- **Permitted during freeze:** hotfixes for things that are actually broken in
  production, deployed only after a manual click-through of login, dashboard,
  and the path screen.
- **Not permitted:** features, refactors, dependency bumps, design changes.

Rationale: there is no staging environment yet. A frozen, manually verified
build provides most of what staging would have provided during that week, at
zero cost, and frees the week to build staging properly (Plan B) while nothing
is shipping.

## Wave 1 go / no-go gate

Do not admit Wave 2 unless all are true:

- [ ] Every Wave 1 user received their invite email.
- [ ] Every Wave 1 user completed login at least once.
- [ ] At least one Wave 1 user completed a full path: plan, drive, drop in, log.
- [ ] No unresolved Sentry issue at error level or above.
- [ ] Dashboard load time under 3 seconds for the Wave 1 org.
- [ ] Google Places spend for day 1 is within the expected range from Plan A
      Task 1.
```

- [ ] **Step 2: Confirm both decisions with Ryan before proceeding**

Ask directly: "Confirmed that we admit 3 to 5 users first and hold a full working day, and that we freeze code from the day before Wave 1 through the Friday of week one?" Do not proceed to Task 1 until both are confirmed, because the rest of this plan is sized for a staged rollout.

- [ ] **Step 3: Commit**

```bash
git add -f docs/launch/beta-onboarding-runbook.md
git commit -m "docs: beta onboarding runbook (staged cohort + code freeze)"
```

---

### Task 1: Verify the live Google Places path works

`PLACES_MOCK` has been set on production to save cost, so `discover_prospects` has never called Google from production. If this path is broken, discovery does not work for anyone on day one.

**Do the local test first.** It exercises the identical code with zero production risk.

**Files:**
- Read: `supabase/functions/discover_prospects/index.ts:55` (the flag), `:186` (the mock branch)
- Modify: none

- [ ] **Step 1: Confirm the flag's exact comparison value**

Run:

```bash
grep -n 'MOCK") ===' supabase/functions/discover_prospects/index.ts
```

Expected output:

```
55:const PLACES_MOCK = Deno.env.get("PLACES_MOCK") === "1";
```

This matters: the flag is truthy only for the exact string `"1"`. Any other value, including `"true"` or `"false"`, disables the mock and calls Google. Note this, because it means a typo in the value silently enables live spend.

- [ ] **Step 2: Get a Google Places API key with billing enabled**

In Google Cloud Console for the navigatr project, confirm the Places API (New) is enabled and an API key exists with billing attached. Record the key name, not the value.

- [ ] **Step 3: Serve the function locally against the real Places API**

```bash
supabase start
GOOGLE_PLACES_API_KEY=<real-key> supabase functions serve discover_prospects --no-verify-jwt
```

Expected: the function boots and logs that it is listening on port 54321.

Note that `PLACES_MOCK` is deliberately unset here, so the code takes the live branch at `index.ts:186`.

- [ ] **Step 4: Call it with a real location and confirm live results come back**

In a second terminal:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/discover_prospects \
  -H "Content-Type: application/json" \
  -d '{"lat":37.7749,"lng":-122.4194,"radius_m":2000}' | head -c 2000
```

Expected: a JSON response containing real San Francisco business names. If it returns the fixture businesses from `supabase/functions/discover_prospects/fixtures.ts`, the mock branch is still active and the environment variable is not reaching the function. If it returns an error mentioning `REQUEST_DENIED` or `API key not valid`, the key or the API enablement is wrong. Do not continue until real businesses come back.

- [ ] **Step 5: Measure what one call actually costs**

In Google Cloud Console, open Billing then Reports, filtered to the Places API, for today. Record the cost of the single call above.

Then compute the realistic ceiling. `discover_prospects` fires one `searchNearby` per cold category bucket per geohash cell, and `index.ts:57` sets `CELL_TTL_DAYS = 30`, so a cell stays warm for 30 days and is shared across the whole org. Write down three numbers in `docs/launch/beta-onboarding-runbook.md`:

- cost per `searchNearby` call
- number of category buckets fired on a cold cell (count from the response log)
- worst case first-week spend, assuming every rep works a territory nobody else has touched

The cell cache means the true number will be far below that ceiling once territories overlap. The ceiling is what you set the quota cap against in Task 2.

- [ ] **Step 6: Flip production to live**

```bash
supabase secrets set GOOGLE_PLACES_API_KEY=<real-key> --project-ref ogvcveimjjeywfdkkinb
supabase secrets unset PLACES_MOCK --project-ref ogvcveimjjeywfdkkinb
supabase functions deploy discover_prospects --project-ref ogvcveimjjeywfdkkinb
```

- [ ] **Step 7: Verify from the production app, once**

Log in to `app.getnavigatr.io` as your own account and run one discovery in a real location. Confirm real businesses appear, not the fixtures.

Then confirm the cache actually recorded the pull, in the Supabase SQL Editor:

```sql
select cell, bucket, fetched_at
from geo_cell_cache
order by fetched_at desc
limit 10;
```

Expected: rows with `fetched_at` within the last few minutes. If this table is empty after a successful discovery, the cache write is failing and every subsequent request will re-hit Google at full cost. That would be a launch blocker, so stop and investigate.

- [ ] **Step 8: Record the result**

Append the measured costs and the confirmation to `docs/launch/beta-onboarding-runbook.md` under a new heading `## Google Places live verification`, then:

```bash
git add -f docs/launch/beta-onboarding-runbook.md
git commit -m "docs: record live Places verification and measured cost"
```

---

### Task 2: Cap Google Places spend

Task 1 removed the cost ceiling. This puts a real one back. The alert tells you; the quota cap is what actually stops the bleeding while you are asleep.

**Files:** none (Google Cloud Console configuration)

- [ ] **Step 1: Set a hard quota cap on the Places API**

Google Cloud Console, APIs and Services, Places API (New), Quotas. Set requests per day to the worst-case first-week number from Task 1 Step 5, times 1.5 for headroom.

This is the important control. A budget alert emails you after money is spent. A quota cap makes further calls fail, which degrades discovery but cannot produce a surprise invoice.

- [ ] **Step 2: Set a budget alert**

Google Cloud Console, Billing, Budgets and alerts. Create a budget scoped to the navigatr project with alert thresholds at 50%, 90%, and 100% of your acceptable monthly Places spend. Send to an address Ryan reads on a phone.

- [ ] **Step 3: Verify the cap is real, not just saved**

Re-open the Quotas page and confirm the new limit displays as the effective value rather than the default. Screenshot it into `docs/launch/` for the record.

- [ ] **Step 4: Confirm graceful failure when the cap is hit**

Read the error path in the function:

```bash
grep -n "RESOURCE_EXHAUSTED\|catch\|!res.ok" supabase/functions/discover_prospects/index.ts | head -20
```

Confirm a failed Places call returns an error response rather than throwing an unhandled exception. If a quota rejection would produce a 500 and a blank screen for the rep, add a caught branch that returns the cached prospects already in `geo_cell_cache` for that cell with a flag indicating results may be stale. A rep seeing slightly old businesses is a far better failure than a rep seeing nothing.

---

### Task 3: Enable point-in-time recovery

**Files:** none (Supabase dashboard configuration)

- [ ] **Step 1: Enable PITR on the production project**

Supabase dashboard, project `ogvcveimjjeywfdkkinb`, Database, Backups. Enable Point-in-Time Recovery. This requires the Pro plan and is a paid add-on of roughly $100 per month.

- [ ] **Step 2: Record the actual recovery window**

The dashboard states the retention period once enabled. Write the exact number down; it feeds Task 8.

- [ ] **Step 3: Verify it is actually running**

Return to the Backups page after 30 minutes and confirm the earliest restorable timestamp is populated and advancing. An enabled toggle with no restore point is not protection.

---

### Task 4: Make sure 50 invites can actually be delivered

If invites throttle silently, half the cohort receives nothing on day one and navigatr looks broken before anyone logs in.

**Files:**
- Read: `supabase/functions/send_invite_email/index.ts`, `supabase/functions/send_auth_email/index.ts`

- [ ] **Step 1: Find the current Supabase auth rate limit**

Supabase dashboard, Authentication, Rate Limits. Record the current value for emails sent per hour. The default is low, and both the signup confirmation path and the invite path consume it.

- [ ] **Step 2: Raise it above the cohort size, with headroom**

Set the hourly email limit to at least 200. Fifty invites plus retries plus magic-link logins on day one will exceed a default limit.

- [ ] **Step 3: Confirm the Resend account can take the volume**

Resend dashboard: confirm the daily sending limit on the current plan exceeds 200, and that the production sending domain shows verified with SPF, DKIM, and DMARC all passing. An unverified domain will not throttle, it will land in spam, which is harder to notice.

- [ ] **Step 4: Rehearse with a batch of ten**

Using the CSV import wizard in the admin area, invite ten addresses you control (use plus-addressing, for example `ceo+beta01@outsidehire.com` through `ceo+beta10@outsidehire.com`).

Expected: ten emails delivered within two minutes, all rendering the branded template with a working code and link.

- [ ] **Step 5: Confirm none were silently dropped**

In the Supabase dashboard, Edge Functions, `send_invite_email`, Logs, confirm ten successful invocations and zero errors. Then in Resend, Logs, confirm ten delivered events and zero bounces or drops.

If the counts disagree, invites are being lost between the app and Resend. Fix that before onboarding; it is the single most visible possible day-one failure.

- [ ] **Step 6: Clean up the rehearsal accounts**

Revoke the ten test invites through the admin UI so they do not consume seats or appear in the beta org.

---

### Task 5: Route Sentry alerts somewhere Ryan reads

Sentry is wired into the code at `apps/app/src/lib/observability.ts:34`, but initialization is conditional on `VITE_SENTRY_DSN` being set. If that variable is missing in the Vercel production environment, error reporting is silently off.

**Files:**
- Read: `apps/app/src/lib/observability.ts:30-45`

- [ ] **Step 1: Confirm Sentry is actually initializing in production**

Read the guard:

```bash
sed -n '25,45p' apps/app/src/lib/observability.ts
```

Then, in the Vercel dashboard for the navigatr project, Settings, Environment Variables, confirm all three exist for the Production environment: `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT` set to `production`, and `VITE_RELEASE`.

If `VITE_SENTRY_DSN` is absent, Sentry has never reported anything from production and this task is more urgent than it looks.

- [ ] **Step 2: Prove it end to end with a real error**

Open `app.getnavigatr.io` in a browser, open the developer console, and run:

```js
throw new Error("sentry-smoke-test-preonboarding")
```

Expected: the event appears in the Sentry issue stream within about a minute, tagged with environment `production`. If nothing arrives, the DSN is wrong or the build did not include it, and you must fix that before onboarding.

- [ ] **Step 3: Create the alert rule**

Sentry, Alerts, Create Alert. Condition: a new issue is first seen in the `production` environment. Action: notify Ryan by email and, if available, by Slack or SMS. No throttling window on the first rule; during a 50-user beta you want every new issue, not a digest.

- [ ] **Step 4: Add a second rule for volume**

Condition: an issue is seen more than 10 times in 1 hour in `production`. This catches a bug affecting many reps at once, which is different from a new bug affecting one.

- [ ] **Step 5: Verify the alert fires**

Repeat Step 2 with a different message and confirm the notification actually arrives on Ryan's phone. An alert rule that was never tested is not an alert rule.

- [ ] **Step 6: Resolve the smoke-test issues in Sentry**

So the Wave 1 go/no-go gate in Task 0 starts from a clean board.

---

### Task 6: Add the real build to CI

CI currently runs typecheck and vitest. `tsc --noEmit` does not catch failures that only appear in `vite build`, and a failing production build silently blocks the Vercel deploy so users keep seeing old code. This has already happened once on this project.

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Confirm the build currently passes locally**

```bash
pnpm --filter app build
```

Expected: exits 0 and writes `apps/app/dist/`. If it fails, fix that first; you have a broken build right now and Vercel is serving stale code.

- [ ] **Step 2: Add the build step to the workflow**

In `.github/workflows/test.yml`, after the `Type check` step and before `Unit tests`, insert:

```yaml
      - name: Build
        run: pnpm --filter app build
```

The full jobs block after the edit reads:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # pnpm version is read from package.json's "packageManager" field.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Type check
        run: pnpm --filter app typecheck
      - name: Build
        run: pnpm --filter app build
      - name: Unit tests
        run: pnpm --filter app test
```

- [ ] **Step 3: Verify the workflow file is valid**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml')); print('valid')"
```

Expected: `valid`

- [ ] **Step 4: Commit and confirm the step runs green on GitHub**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run the real production build, not just typecheck"
git push
```

Then open the Actions tab and confirm the `Build` step appears and passes. Do not mark this task done from a local run; the point is that CI does it.

---

### Task 7: Load-check the heavy dashboards at 50-rep volume

A dashboard that is instant on five rows and takes eleven seconds on fifty reps' data is a classic way to lose a beta. The reports most at risk are the ones doing aggregate work: Persistence Index, Activity-to-Win, and coverage.

**Files:**
- Read: `supabase/migrations/20260717000001_demo_data_reset.sql`, `supabase/migrations/20260723000001_demo_org_hierarchy.sql`

- [ ] **Step 1: Read the existing seeding function's signature**

In the Supabase SQL Editor on production:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('reset_demo_data', 'reset_demo_data_base', '_seed_demo_hierarchy')
  and n.nspname = 'public';
```

Record the exact argument list. You will call it in Step 3 and must not guess the signature.

- [ ] **Step 2: Confirm the demo org exists and has the feature flag enabled**

```sql
select o.id, o.name, o.seat_limit, f.feature_key, f.enabled
from organizations o
left join org_feature_flags f on f.org_id = o.id and f.feature_key = 'demo_reset'
where f.enabled is true;
```

Expected: at least one org with `demo_reset` enabled and `seat_limit` of 50. `reset_demo_data` raises `demo_reset_not_enabled` without this flag, per `20260717000001_demo_data_reset.sql:25`.

- [ ] **Step 3: Seed the demo org to full 50-rep volume**

Call `reset_demo_data` with the arguments recorded in Step 1, targeting the demo org id from Step 2.

Then confirm the volume is actually there:

```sql
select
  (select count(*) from profiles where org_id = '<demo-org-id>') as reps,
  (select count(*) from activities a join profiles p on p.id = a.user_id
     where p.org_id = '<demo-org-id>') as activities,
  (select count(*) from deals where org_id = '<demo-org-id>') as deals;
```

Expected: roughly 50 reps and thousands of activities. If activity counts are in the hundreds, the seed is too thin to be a real load test and you must scale it up before continuing, otherwise this task proves nothing.

- [ ] **Step 4: Time each heavy report from the browser**

Log in as a manager on the demo org and open each of these with the browser Network tab recording, noting time to the last completed request:

- `/dashboard`
- `/dashboard/persistence-index`
- `/dashboard/activity-to-win`
- `/dashboard/lead-source`

Record all four times in `docs/launch/beta-onboarding-runbook.md`.

- [ ] **Step 5: Judge against a stated bar**

The bar is 3 seconds to interactive for a manager viewing a 50-rep org. Anything over that goes on the fix list. Anything over 8 seconds is a launch blocker, because a manager who cannot open the dashboard cannot evaluate the product they are being asked to buy.

- [ ] **Step 6: If anything is over the bar, find out whether it is the query or the payload**

In the Supabase dashboard, Reports, Query Performance, sort by total time for the last hour. The slowest statements from Step 4 will be at the top.

For each slow query, run `explain analyze` on it in the SQL Editor. A sequential scan over `activities` filtered by org and date is the likely finding, and the fix is an index, for example:

```sql
create index concurrently if not exists activities_user_occurred_idx
  on activities (user_id, occurred_at desc);
```

Use `concurrently` so the index build does not lock the table. Confirm the exact column names against the table first; do not apply the statement above without checking that `occurred_at` is the real column name in your schema.

- [ ] **Step 7: Record the outcome**

```bash
git add -f docs/launch/beta-onboarding-runbook.md
git commit -m "docs: record 50-rep dashboard load measurements"
```

---

### Task 8: Write the recovery window into the beta agreement

A stated limit is accepted. An unstated one discovered during an incident is a broken promise.

**Files:**
- Modify: the beta agreement document (location to be confirmed with Ryan; if none exists, create `docs/launch/beta-agreement-data-terms.md`)

- [ ] **Step 1: Confirm the numbers from Task 3**

You need the PITR retention window recorded in Task 3 Step 2 and the daily backup schedule shown on the same Backups page.

- [ ] **Step 2: Draft the data terms paragraph**

```markdown
## Data protection during beta

navigatr backs up all customer data continuously, with point-in-time recovery
retained for <N> days and full daily snapshots retained for <M> days. In the
event of a data-loss incident we can restore to any point within the retention
window.

navigatr is in beta. While we have not lost customer data and do not expect to,
you should not treat navigatr as the only record of any information that is
critical to your business during the beta period.
```

Replace `<N>` and `<M>` with the actual values from Step 1. Do not ship this paragraph with the placeholders in it.

- [ ] **Step 3: Get Ryan's sign-off on the wording**

This is customer-facing contractual language. It goes out only with explicit approval.

- [ ] **Step 4: Commit**

```bash
git add -f docs/launch/beta-agreement-data-terms.md
git commit -m "docs: beta agreement data protection terms"
```

---

### Task 9: Targeted destructive schema pass

**Run this last.** It is the only task that changes the schema, and after Wave 1 begins, every change here becomes a two-release job forever (spec section 6.4).

This is deliberately scoped to two or three fixes, not a full cleanup. The full cleanup does not fit before onboarding, and attempting it days before 50 users arrive would create more risk than it removes.

**Files:**
- Create: `supabase/migrations/<timestamp>_preonboarding_schema_cleanup.sql`

- [ ] **Step 1: List the candidates**

In the Supabase SQL Editor:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

Review with Ryan and pick at most three changes. Good candidates are a column whose name no longer matches what it holds, a column that is nullable but should never be null, or a leftover column from an abandoned feature that no code reads. Bad candidates are anything requiring a data backfill, or anything touching `profiles`, `organizations`, or the RLS policy surface, because those carry auth risk that is not worth taking this week.

- [ ] **Step 2: Prove each candidate is unreferenced before dropping it**

For every column you intend to drop:

```bash
grep -rn "<column_name>" apps/app/src supabase/functions supabase/migrations | grep -v _archive
```

Expected: hits only in the migration that created it. Any hit in `apps/app/src` or `supabase/functions` disqualifies the candidate. Do not proceed on a column you have not grepped.

- [ ] **Step 3: Write the migration**

Create the file with a timestamp ahead of the newest existing migration (the newest today is `20260731000004_demo_data_extras2.sql`, so use a `202608*` prefix). Example shape, with your real changes substituted:

```sql
-- Pre-onboarding schema cleanup. This is the last destructive migration before
-- the beta cohort arrives; from Wave 1 onward this project is additive-only
-- (see docs/superpowers/specs/2026-08-06-environments-design.md section 6.4).

begin;

alter table public.<table> drop column if exists <unused_column>;

commit;
```

- [ ] **Step 4: Prove it applies from a clean database**

```bash
supabase db reset
```

Expected: all migrations apply in order with no error. If `supabase db reset` fails for an unrelated reason (the missing `supabase/seed.sql` referenced by `config.toml`), create an empty `supabase/seed.sql` first so the reset completes and you are testing your migration rather than a known gap.

- [ ] **Step 5: Take a manual snapshot of production before applying**

Supabase dashboard, Database, Backups, create an on-demand backup. Wait for it to complete. This is the last chance to undo the whole task cheaply.

- [ ] **Step 6: Apply to production**

Paste the migration into the Supabase SQL Editor and run it. This is the current process (see the migration-apply-method note) and it changes in Plan B, not here.

- [ ] **Step 7: Verify the app still builds and the affected screens still work**

```bash
pnpm --filter app build
pnpm --filter app test
```

Expected: both pass. Then click through the screens that touch the changed tables in production.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<timestamp>_preonboarding_schema_cleanup.sql
git commit -m "feat(db): pre-onboarding schema cleanup, last destructive migration"
git push
```

- [ ] **Step 9: Mark the additive-only rule as now in force**

Append to `docs/launch/beta-onboarding-runbook.md`:

```markdown
## Additive-only rule in force

As of <date this migration was applied>, this project is additive-only. No
migration may DROP or RENAME without an explicit override comment explaining
why it is safe. CI enforcement of this rule lands in Plan B.
```

Then commit.

---

## Definition of done

Plan A is complete when all of the following are true:

- [ ] Live Google Places returns real businesses from production, and `geo_cell_cache` records the pull.
- [ ] A hard quota cap is set on the Places API and displays as the effective value.
- [ ] Point-in-time recovery is enabled and shows an advancing earliest restore point.
- [ ] Ten rehearsal invites were delivered, with edge function and Resend counts agreeing.
- [ ] A test error raised in production arrived in Sentry and produced a notification on Ryan's phone.
- [ ] The `Build` step appears green in GitHub Actions.
- [ ] All four heavy reports load in under 3 seconds against a 50-rep demo org, or their overages are documented and accepted.
- [ ] The beta agreement states the real recovery window, with no placeholders.
- [ ] The final destructive migration is applied and the additive-only rule is recorded as in force.
- [ ] The staged rollout and code freeze are confirmed in writing by Ryan.
