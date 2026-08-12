# Environment Pipeline Implementation Plan (merged)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put staging and a real release pipeline in front of production, so that after the beta code freeze lifts, nothing reaches customers without having been built, tested, and exercised first.

**Architecture:** Four phases. Phase 0 closes a security hole found while scoping. Phase 1 finishes the foundations (the migration ledger, seeds, tests, bootstrap docs, schema cleanup, org move). Phase 2 adds CI gates. Phase 3 stands up staging and the two-branch release flow. Phase 4 is the pre-onboarding checklist. Order matters between phases; within a phase it mostly does not.

**Tech Stack:** Supabase (PostgreSQL 17.6, Edge Functions on Deno), Vercel, Vite + React + TypeScript, GitHub Actions, Playwright, Sentry, Resend.

**Source spec:** `docs/superpowers/specs/2026-08-06-environments-design.md` (v2). This plan supersedes both v1 plans, which are banner-marked DO NOT EXECUTE.

---

## What is already done (do not redo)

Verified 2026-08-12. The spec's Phase 1 assumed a re-baseline; that turned out to be unnecessary.

| | Status |
|---|---|
| Schema drift | **Resolved.** All six object-class digests match between repo and production. See `docs/launch/schema-drift-report.md`. |
| Repo builds from zero | **Yes.** All 110 migrations apply to an empty database. Duplicate version `20260618000001` fixed. |
| Baseline / supplements migration | **Not needed.** Migrations alone recreate the `auth.users` trigger, both storage buckets, all three cron schedules, and reference data (77 holidays, 354 exclusion seeds). Verified against a database built from migrations. |
| `supabase/seed.sql` | Exists, currently empty (Task 5 fills it). |
| Security review findings | Shipped and live (PR #61, #62). |
| Cron authentication | On `CRON_SECRET`, verified end to end. |

## Environment facts that constrain the work

Learned the hard way; ignoring any of these produces silent failures.

1. **`--project-ref` is not valid** on `db push`, `db dump`, `migration repair`, or `migration list`. Verified on CLI v2.98.2. Only `functions deploy` and `secrets` accept it. Everything else needs `supabase link` first, or `--db-url`.
2. **Supabase direct database connections are IPv6-only.** The dev machine has no IPv6 egress, and GitHub-hosted runners are IPv4-only too. **Every database command in CI must use `--db-url` with a Session pooler connection string**, not `--linked`. This is the single most likely thing to break the deploy workflows.
3. **`supabase db dump` exits 0 while writing an empty file** when the connection drops. Any workflow that diffs dumps must assert a non-empty result.
4. **Pasting SQL produces drift even when the SQL is correct**, because reformatting changes the stored function definition. This is why migrations must be applied only from CI.
5. **`supabase secrets list` prints real values, not digests.** Always pipe through `awk '{print $1}'`.
6. **Six mock flags compare against the exact string `"1"`.** Any other value, including `"false"`, disables the mock and spends real money.
7. There are **15 edge functions** plus `_shared`.

---

## Phase 0: close the hole found while scoping

### Task 1: Require a cron credential on `refresh_place_ids`

`refresh_place_ids` runs monthly, builds a service-role client, and updates rows across every org, with no caller check (`index.ts:81-95`). Platform `verify_jwt` is not an authorization boundary: the public anon key in the browser bundle satisfies it. Anyone with that key can trigger an all-tenant refresh, burning Google Places quota.

Same defect the 2026-07-30 security review found twice; this function was written after it.

**Files:**
- Modify: `supabase/functions/refresh_place_ids/index.ts`
- Modify: `supabase/config.toml`
- Create: `supabase/migrations/20260813000001_place_refresh_cron_secret.sql`

- [ ] **Step 1: Confirm the hole is real before changing anything**

```bash
grep -n "requireCronCaller" supabase/functions/refresh_place_ids/index.ts
```

Expected: no output. If `requireCronCaller` is already there, stop; this task is done.

- [ ] **Step 2: Add the guard**

In `supabase/functions/refresh_place_ids/index.ts`, add to the imports:

```ts
import { requireCronCaller } from "../_shared/cronAuth.ts";
```

Add beside the other env reads near line 24:

```ts
const CRON_SECRET = Deno.env.get("CRON_SECRET");
```

Then, inside `Deno.serve(async (req) => {`, immediately after the `OPTIONS` and method checks and **before** the `createClient` call:

```ts
  // Cron-only. This job updates place_id and place_synced_at for EVERY org with
  // the service-role key, and each run costs Google Places calls. Platform
  // verify_jwt does not gate it: the public anon key in the browser bundle and
  // any logged-in rep's JWT both clear that check. See _shared/cronAuth.ts.
  const denied = requireCronCaller(req, CRON_SECRET);
  if (denied) return denied;
```

- [ ] **Step 3: Declare the JWT posture**

`CRON_SECRET` is a raw string, not a JWT, so platform `verify_jwt` would reject the scheduler with `UNAUTHORIZED_INVALID_JWT_FORMAT` before the guard runs. In `supabase/config.toml`, beside the two existing snapshot entries:

```toml
[functions.refresh_place_ids]
verify_jwt = false
```

- [ ] **Step 4: Repoint the cron job to `cron_secret`**

Create `supabase/migrations/20260813000001_place_refresh_cron_secret.sql`:

```sql
-- Switch place-id-refresh-monthly from sending the service-role key to the
-- dedicated cron_secret, matching 20260812000004. Same reasoning: comparing
-- against a platform-managed key breaks silently on any rotation or format
-- migration, and a full-access credential should not be used to answer "is this
-- the scheduler?".

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret the cron schedulers send. An operator must set the matching CRON_SECRET Edge Function secret before the jobs can authenticate.'
    );
  end if;
end;
$$;

select cron.unschedule('place-id-refresh-monthly')
where exists (select 1 from cron.job where jobname = 'place-id-refresh-monthly');

select cron.schedule(
  'place-id-refresh-monthly',
  '0 8 1 * *',  -- 08:00 UTC on the 1st, unchanged
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'place_refresh_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 5: Prove it still builds from zero**

```bash
supabase db reset
```

Expected: all migrations apply with no error.

- [ ] **Step 6: Run the suite**

```bash
pnpm --filter app test && pnpm --filter app typecheck && pnpm --filter app build
```

Expected: all pass. The existing `cronAuth.test.ts` already covers the guard's behaviour.

- [ ] **Step 7: Deploy and verify rejection**

```bash
supabase functions deploy refresh_place_ids --project-ref ogvcveimjjeywfdkkinb --use-api --no-verify-jwt
```

Then confirm the public key is refused:

```bash
ANON=$(grep VITE_SUPABASE_ANON_KEY apps/app/.env.local | cut -d= -f2)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://ogvcveimjjeywfdkkinb.supabase.co/functions/v1/refresh_place_ids" \
  -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'
```

Expected: `401`.

- [ ] **Step 8: Apply the migration to production and verify acceptance**

Paste the migration into the SQL Editor (last time this is the process; Phase 2 moves it to CI). Then confirm the scheduler's own credential works:

```sql
select net.http_post(
  url     := (select decrypted_secret from vault.decrypted_secrets where name = 'place_refresh_fn_url'),
  headers := jsonb_build_object('Content-Type','application/json',
             'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
  body    := '{}'::jsonb) as request_id;
```

Wait 15 seconds, then:

```sql
select status_code, left(content,200) from net._http_response order by id desc limit 1;
```

Expected: `200`. A `401` means `place_refresh_fn_url` or `CRON_SECRET` is wrong.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/refresh_place_ids/index.ts supabase/config.toml supabase/migrations/20260813000001_place_refresh_cron_secret.sql
git commit -m "fix(security): require a cron credential on refresh_place_ids"
```

---

### Task 2: Declare JWT posture for every function

`config.toml` declares `verify_jwt` for three of fifteen functions. The rest are set by dashboard clicks, invisible to review, and will not be reproduced on staging.

**Files:** Modify `supabase/config.toml`

- [ ] **Step 1: Read the real posture from the dashboard**

For each of the 15 functions, Supabase dashboard, Edge Functions, open it, note whether JWT verification is on. Record them; do not guess.

- [ ] **Step 2: Write a `[functions.*]` block for each**

Add one entry per function. The three cron-driven ones (`compute_coverage_snapshots`, `compute_persistence_snapshots`, `refresh_place_ids`) are `false` because they authenticate with `CRON_SECRET`, which is not a JWT. `send_auth_email` is `false` because it is called by the Supabase auth hook with a webhook signature. `calendar_oauth` **must** be `false`: its `/callback` route is a provider redirect carrying no Supabase JWT (`calendar_oauth/index.ts:16`), and setting it true breaks calendar connect. Everything else that a signed-in user calls stays `true`.

- [ ] **Step 3: Verify against the dashboard once more, then commit**

A wrong value here either breaks a working feature or exposes an endpoint. Re-read each before committing.

```bash
git add supabase/config.toml
git commit -m "chore(config): declare verify_jwt posture for all 15 edge functions"
```

---

## Phase 1: finish the foundations

### Task 3: Repair production's migration ledger

Production recorded 54 migrations and stops at `20260708160000`, because SQL Editor pastes are never recorded. The repo has 110. Until the ledger matches, `supabase db push` will refuse to run, so Phase 3 cannot deploy anything.

The schema already matches (drift report), so this records history without changing objects.

**Files:** none (remote state)

- [ ] **Step 1: Get a pooler connection string**

Supabase dashboard, Connect, **Session pooler**. Store it in your password manager as `NAVIGATR_PROD_DB_URL`. You will reuse it in Task 12. Direct connections are IPv6-only and will not work.

- [ ] **Step 2: List what production thinks it has applied**

```bash
supabase migration list --db-url "$NAVIGATR_PROD_DB_URL"
```

Expected: `Local` populated for all 110, `Remote` populated for 54.

- [ ] **Step 3: Mark the unrecorded migrations as applied**

For every version present locally but not remotely:

```bash
supabase migration repair --status applied <version> --db-url "$NAVIGATR_PROD_DB_URL"
```

`migration repair` accepts multiple versions in one call. Do **not** run `db push` first; that would try to re-apply migrations whose objects already exist.

- [ ] **Step 4: Confirm the ledger is clean**

```bash
supabase migration list --db-url "$NAVIGATR_PROD_DB_URL"
```

Expected: every row has both a local and a remote timestamp, and nothing is pending.

- [ ] **Step 5: Prove `db push` is now a no-op**

```bash
supabase db push --db-url "$NAVIGATR_PROD_DB_URL" --dry-run
```

Expected: reports nothing to apply. If it wants to apply migrations, Step 3 was incomplete. **Do not proceed to Phase 3 until this is clean**; the deploy workflows depend on it.

---

### Task 4: Audit and repair the database test scripts

`supabase/tests/` holds 9 files. They are **not pgTAP** (zero `plan()` calls); they are psql scripts using `do $$ ... raise` assertions. They run nowhere and target early-June schema. Their value is RLS regression coverage, which is the surface most expensive to get wrong.

**Files:** Modify `supabase/tests/*.sql`; create `tools/run-db-tests.sh`

- [ ] **Step 1: Run each against the local database and record which fail**

```bash
for f in supabase/tests/*.sql; do
  echo "=== $f ==="
  docker exec -i $(docker ps --format '{{.Names}}' | grep supabase_db_) \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < "$f" >/dev/null 2>/tmp/err.txt \
    && echo "PASS" || { echo "FAIL"; tail -3 /tmp/err.txt; }
done
```

- [ ] **Step 2: Exclude the one that is not a test**

`supabase/tests/demo_data_reset.sql` is documented manual checks needing a signed-in JWT context, not an executable test. Exclude it rather than deleting it.

- [ ] **Step 3: Fix failures against current schema, do not delete them**

`prospects_nearby` has been redefined roughly ten times since these were written, and the pipeline de-duplication work changed what it returns (in-pipeline prospects are now hidden), so `007_path_prospect_store.sql` count assertions are the likely casualties. Update the assertions to the current contract; do not weaken them to pass.

- [ ] **Step 4: Write the runner**

Create `tools/run-db-tests.sh` taking a connection string, running every `supabase/tests/*.sql` except `demo_data_reset.sql` with `ON_ERROR_STOP=1`, and exiting non-zero on the first failure.

- [ ] **Step 5: Verify it passes locally, then commit**

```bash
supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
git add supabase/tests tools/run-db-tests.sh
git commit -m "test(db): repair the RLS regression scripts and add a runner"
```

---

### Task 5: Write the real seed file

`supabase/seed.sql` exists but is empty, so a fresh local database has no data and the app shows empty states everywhere.

**Files:** Modify `supabase/seed.sql`

- [ ] **Step 1: Reuse the shapes that already work**

```bash
grep -n "insert into" supabase/migrations/20260717000001_demo_data_reset.sql | head -30
```

Take column names and enum values from there. Do not invent them.

- [ ] **Step 2: Seed a loginable user correctly**

This is where implementations usually thrash. A loginable user needs rows in `auth.users` **and** `auth.identities`, and inserting into `auth.users` fires the `on_auth_user_created` trigger, which reads `raw_user_meta_data->>'invite_code'`. `supabase/tests/007_path_prospect_store.sql` shows the working pattern; follow it.

- [ ] **Step 3: Keep it small**

One organization, one manager, three reps reporting to that manager, five prospects, three deals across different stages, ten activities over the last fourteen days. Fixed UUIDs so runs are reproducible. Volume seeding is Task 15, not this.

- [ ] **Step 4: Verify**

```bash
supabase db reset && pnpm dev:app
```

Log in as the seeded manager at `http://localhost:5173`. Dashboard, pipeline, and activities should render with data.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql && git commit -m "feat(db): local development seed"
```

---

### Task 6: Write the per-environment bootstrap runbook

Everything below lives only in a dashboard. It is invisible to the repo and to any schema diff, and none of it is recreated by migrations. Without this document, staging's login is broken out of the box and a "does the page render" check still passes.

**Files:** Create `docs/launch/environment-bootstrap.md`

- [ ] **Step 1: Enumerate the Vault secrets the cron jobs need**

Verified: `cron_secret`, `coverage_fn_url`, `persistence_fn_url`, `place_refresh_fn_url`, `place_refresh_service_role_key`. Regenerate the list rather than trusting this one:

```sql
select distinct m[1] from cron.job, regexp_matches(command, 'name = ''([a-z_]+)''', 'g') as m order by 1;
```

Note `place_refresh_service_role_key` becomes unused after Phase 0 Task 1 and can be dropped once a run succeeds on the new credential.

- [ ] **Step 2: Document the auth configuration**

Site URL; the redirect allowlist (a past production incident: password reset was silently broken until this was corrected); auth email rate limits (raise above 200 before onboarding 50 users); the Send-Email hook URL, its enablement, and `SEND_EMAIL_HOOK_SECRET`.

- [ ] **Step 3: Document the function secrets per environment**

Reference `supabase/secrets.manifest.json` (Task 11) rather than duplicating the list.

- [ ] **Step 4: Write it as a checklist someone can follow top to bottom**

The test is whether a new environment can be brought from empty to working login by following it without asking questions.

- [ ] **Step 5: Commit**

```bash
git add -f docs/launch/environment-bootstrap.md
git commit -m "docs: per-environment bootstrap runbook"
```

---

### Task 7: Destructive schema cleanup

The last chance to rename or drop anything for free. After the first real user, every one of these becomes a two-release job forever (spec 6.4).

**Files:** Create `supabase/migrations/20260813000002_schema_cleanup.sql`

- [ ] **Step 1: Build the candidate list**

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

Review with Ryan. Good candidates: a column whose name no longer matches its contents, a column that should never be null, a leftover from an abandoned feature. Bad candidates: anything needing a data backfill, and anything touching the RLS policy surface, which is currently verified identical to production and not worth disturbing.

- [ ] **Step 2: Prove each candidate is unreferenced**

```bash
grep -rn "<column_name>" apps/app/src supabase/functions supabase/migrations
```

Any hit in `apps/app/src` or `supabase/functions` disqualifies it. Do not proceed on a column you have not grepped.

- [ ] **Step 3: Write the migration, annotated**

The CI check from Task 10 will block destructive statements, so each needs an override comment:

```sql
-- destructive-ok: <column> is unreferenced in app and function code (grepped
-- 2026-08-13) and no customer data exists yet. This is the last release before
-- the additive-only rule takes effect.
alter table public.<table> drop column if exists <column>;
```

- [ ] **Step 4: Prove it builds from zero, then apply**

```bash
supabase db reset
```

Then apply to production via `db push` (the ledger is repaired, so this now works):

```bash
supabase db push --db-url "$NAVIGATR_PROD_DB_URL"
```

- [ ] **Step 5: Verify the app still builds and the affected screens work**

```bash
pnpm --filter app build && pnpm --filter app test
```

- [ ] **Step 6: Record that the rule is now in force**

Append to `docs/launch/environment-bootstrap.md`: from this date, additive-only, enforced by CI.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260813000002_schema_cleanup.sql
git commit -m "feat(db): final destructive schema cleanup before additive-only"
```

---

### Task 8: Move navigatr to its own Supabase organization

Production shares organization `lwicvufjihaqvlebwulb` with 13 unrelated projects. Anyone with org access reaches navigatr production; billing and spend limits are org-wide; and navigatr's buyers are payment and payroll ISOs who will ask where their reps' data lives. Navigatr LLC is a separate entity from OutsideHire.

Do this **before** enabling PITR (Task 22), since add-ons can block a transfer, and before customers exist, when downtime is free.

**Files:** none

- [ ] **Step 1: Confirm whether transfer causes downtime**

Check current Supabase documentation and confirm in writing. Do not proceed on an assumption. If it does, schedule it outside working hours.

- [ ] **Step 2: Create the organization**

Named for Navigatr LLC, on Pro, with Ryan as the only owner initially.

- [ ] **Step 3: Transfer the project**

Do **not** create a new project. The Google OAuth client under verification is bound to the current project ref; a new ref would invalidate it.

- [ ] **Step 4: Verify after transfer**

Project ref unchanged; app loads; `supabase secrets list --project-ref ogvcveimjjeywfdkkinb | awk '{print $1}'` still lists every expected key; the three cron jobs still scheduled.

- [ ] **Step 5: Audit membership on the old organization**

Confirm nobody outside Navigatr LLC retains access.

---

## Phase 2: gates

### Task 9: Full CI on every pull request

Today CI runs typecheck and vitest. It does not run the real build, which has already caused a silently blocked deploy on this project.

**Files:** Modify `.github/workflows/test.yml`

- [ ] **Step 1: Add build and lint to the existing job**

After the `Type check` step:

```yaml
      - name: Lint
        run: pnpm --filter app lint
      - name: Build
        run: pnpm --filter app build
```

- [ ] **Step 2: Add the database job**

```yaml
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start local Supabase
        run: supabase start
      - name: Rebuild the database from every migration
        run: supabase db reset
      - name: RLS regression tests
        run: ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

`db reset` applies all migrations from empty, so a migration that cannot build from scratch fails here. That is exactly what caught the duplicate-version bug.

**Do not add a `deno test` job.** The 15 `_shared` tests already run under vitest via `apps/app/vitest.config.ts:31`, and they import vitest, so `deno test` would fail. Any new edge function test must be written vitest-style.

- [ ] **Step 3: Validate the YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml')); print('valid')"
```

- [ ] **Step 4: Commit and confirm both jobs pass on GitHub**

Do not mark this done from a local run; the point is that CI does it.

---

### Task 10: Block unannotated destructive migrations

**Files:** Create `tools/check-destructive-migrations.mjs` and its test; modify `.github/workflows/test.yml`

- [ ] **Step 1: Write the failing test**

Create `tools/check-destructive-migrations.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-destructive-migrations.mjs";

test("flags an unannotated drop column", () => {
  assert.deepEqual(findViolations("alter table public.deals drop column notes;"), ["DROP COLUMN"]);
});

test("flags drop table and rename", () => {
  const sql = "drop table public.old_thing;\nalter table a rename to b;";
  assert.deepEqual(findViolations(sql).sort(), ["DROP TABLE", "RENAME"]);
});

test("allows a destructive statement with an override comment", () => {
  const sql = "-- destructive-ok: unreferenced, no customer data\nalter table public.deals drop column notes;";
  assert.deepEqual(findViolations(sql), []);
});

test("ignores drop index, which is not data loss", () => {
  assert.deepEqual(findViolations("drop index if exists deals_org_idx;"), []);
});

test("passes a purely additive migration", () => {
  assert.deepEqual(findViolations("alter table public.deals add column source text;"), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tools/check-destructive-migrations.test.mjs
```

Expected: cannot find module.

- [ ] **Step 3: Implement**

Create `tools/check-destructive-migrations.mjs`:

```js
// Fails CI on a migration that drops or renames data-bearing objects without an
// explicit override. See docs/superpowers/specs/2026-08-06-environments-design.md
// section 6.4.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\balter\s+table\b[\s\S]*?\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\brename\s+(to|column)\b/i, "RENAME"],
];

export function findViolations(sql) {
  if (/--\s*destructive-ok:/i.test(sql)) return [];
  return PATTERNS.filter(([re]) => re.test(sql)).map(([, name]) => name);
}

export function checkDirectory(dir) {
  const failures = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue;
    const violations = findViolations(readFileSync(join(dir, file), "utf8"));
    if (violations.length) failures.push({ file, violations });
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = checkDirectory("supabase/migrations");
  for (const { file, violations } of failures) console.error(`${file}: ${violations.join(", ")}`);
  if (failures.length) {
    console.error("\nSplit into two releases, or add '-- destructive-ok: <reason>'.");
    process.exit(1);
  }
  console.log("No destructive migrations.");
}
```

- [ ] **Step 4: Tests pass, and it passes against the current tree**

```bash
node --test tools/check-destructive-migrations.test.mjs && node tools/check-destructive-migrations.mjs
```

The Task 7 cleanup migration carries an override comment, so this should report clean.

- [ ] **Step 5: Add to CI and commit**

```yaml
      - name: Check for destructive migrations
        run: node tools/check-destructive-migrations.mjs
```

---

### Task 11: Secrets manifest

**Files:** Create `supabase/secrets.manifest.json` and `tools/check-secrets.mjs`

- [ ] **Step 1: Enumerate what the code actually reads**

```bash
grep -rhoE 'Deno\.env\.get\("[A-Z_]+' supabase/functions | sed 's/.*"//' | sort -u
```

Use that output as authoritative. Keys the spec's draft table missed: `SEND_EMAIL_HOOK_SECRET`, `ASSEMBLYAI_API_KEY`, `CALENDAR_CALLBACK_BASE`, `TRANSCRIBE_MOCK`, `CRON_SECRET`.

- [ ] **Step 2: Write the manifest, names only**

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are platform-injected and excluded. Never commit a value.

- [ ] **Step 3: Write the checker**

`tools/check-secrets.mjs` reads the manifest, runs `supabase secrets list --project-ref $SUPABASE_PROJECT_REF`, takes **column one only** (the command prints real values), and exits 1 listing missing names. Print names, never values.

- [ ] **Step 4: Run it against production and fix what it finds**

```bash
SUPABASE_PROJECT_REF=ogvcveimjjeywfdkkinb node tools/check-secrets.mjs production
```

A first run that reports gaps is the check working.

- [ ] **Step 5: Commit**

---

### Task 12: Branch protection

**Files:** none

- [ ] **Step 1: Note the exact check names from a recent Actions run**

`test` and `database`. Match the strings exactly.

- [ ] **Step 2: Create the ruleset on `main`**

Require a pull request; **required approvals: 0**; require status checks `test` and `database`; require branches up to date; block force pushes.

Zero approvals is deliberate (spec section 10): a solo operator approving their own pull requests learns to click through gates. Raise to 1 when a second engineer joins.

- [ ] **Step 3: Protect `release` the same way**, since Task 15 makes it the production branch.

- [ ] **Step 4: Verify it blocks a bad merge**

Open a pull request that breaks a test, confirm merge is disabled, close it without merging.

---

## Phase 3: staging and the release flow

### Task 13: Stand up staging

**Files:** Create `apps/app/.env.staging.example`

- [ ] **Step 1: Create the project**

`navigatr-staging`, same region as production (West US, North California), in the new organization from Task 8.

- [ ] **Step 2: Apply the migrations**

```bash
supabase db push --db-url "<staging pooler connection string>"
```

All 110 apply from empty. No baseline, no supplements: migrations alone recreate the `auth.users` trigger, both storage buckets, all three cron schedules, and reference data. Verified.

- [ ] **Step 3: Prove staging matches production**

Run the fingerprint query from `docs/launch/schema-drift-report.md` against both and compare all six digests. This is the first proof the pipeline works.

- [ ] **Step 4: Bootstrap from the runbook**

Follow `docs/launch/environment-bootstrap.md` end to end: Vault secrets, auth Site URL and redirect allowlist, email rate limits, the Send-Email hook.

- [ ] **Step 5: Set the function secrets**

```bash
supabase secrets set --project-ref <staging-ref> \
  APP_ENV=staging PLACES_MOCK=1 GEOCODE_MOCK=1 CALENDAR_MOCK=1 \
  MICROSOFT_CALENDAR_MOCK=1 TRANSCRIBE_MOCK=1 \
  APP_BASE_URL=https://staging.getnavigatr.io APP_URL=https://staging.getnavigatr.io
```

The mock flags must be exactly `1`.

- [ ] **Step 6: Deploy the functions**

```bash
supabase functions deploy --project-ref <staging-ref> --use-api
```

All 15. This also proves CLI deployment handles the `../_shared/` imports without hand-flattening.

- [ ] **Step 7: Verify the manifest**

```bash
SUPABASE_PROJECT_REF=<staging-ref> node tools/check-secrets.mjs staging
```

- [ ] **Step 8: End-to-end acceptance, not a schema diff**

This is the real verification (spec 6.3). On staging: send an invite, complete signup, log in, record a voice note, attach a file to a deal, and confirm the overnight cron produced snapshots. A schema diff cannot see any of these.

---

### Task 14: Move Vercel Preview off production

Today there is one Supabase project, so every pull request preview build carries production credentials. Every preview URL is a live client against real data.

**Files:** none

- [ ] **Step 1: Repoint Preview environment variables**

Vercel, Settings, Environment Variables, **Preview** scope: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to staging, `VITE_SENTRY_ENVIRONMENT=preview`.

- [ ] **Step 2: Verify on a real pull request**

Open the preview, check the network tab, confirm requests go to the staging project. Do not assume.

---

### Task 15: The two-branch release flow

The spec's original design had promote controlling the database and functions while Vercel deployed the frontend on every merge, so any change needing both would break production in the gap. Vercel has no tag-based deploy.

**Files:** Create `.github/workflows/deploy-staging.yml`, `.github/workflows/promote-production.yml`, `apps/app/e2e/smoke.spec.ts`

- [ ] **Step 1: Create the `release` branch and repoint Vercel**

```bash
git checkout -b release main && git push -u origin release
```

In Vercel, set the Production Branch to `release`. Add `staging.getnavigatr.io` pointing at `main` deployments, with an `X-Robots-Tag: noindex` header.

- [ ] **Step 2: Create GitHub Environments**

`staging` and `production`, each holding `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_URL` (the **pooler** connection string; runners have no IPv6). Add Ryan as a required reviewer on `production`.

- [ ] **Step 3: Write the staging deploy workflow**

On push to `main`: `supabase db push --db-url "${{ secrets.SUPABASE_DB_URL }}"` then `supabase functions deploy --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} --use-api`. Add `concurrency: { group: deploy-staging, cancel-in-progress: false }` so two quick merges cannot run `db push` simultaneously. Vercel handles the frontend from `main`.

- [ ] **Step 4: Write the smoke test**

`apps/app/e2e/smoke.spec.ts` against `process.env.SMOKE_BASE_URL`: load `/login`, assert a sub-400 status and a visible sign-in control. Keep assertions loose enough to survive Sentry and Intercom console noise; a flaky smoke step trains the habit of overriding the gate.

- [ ] **Step 5: Write the promote workflow**

`workflow_dispatch` with a typed `PROMOTE` confirmation, `environment: production`, and `permissions: { contents: write }`. Steps in order: dump a pre-migration snapshot and **assert the file is non-empty** (the CLI exits 0 on failure); upload it as an artifact; `db push` against the production pooler URL; `functions deploy`; fast-forward `release` to `main` so Vercel deploys the frontend last, after the backend is ready; run the smoke test against production; tag the release.

- [ ] **Step 6: Verify the confirmation guard refuses**

Trigger with anything other than `PROMOTE`. Expected: first step fails, nothing else runs.

- [ ] **Step 7: Run a real promote and confirm every step**

Snapshot artifact attached, tag created, smoke test green.

---

### Task 16: Email allowlist outside production

**Ordering hazard, and it is severe.** The guard fails closed. Deploying it before `APP_ENV=production` is set on production would silently drop every invite and every auth email. That is the exact day-one catastrophe this program exists to prevent.

**Files:** Create `supabase/functions/_shared/emailGuard.ts` and its vitest test; modify `send_invite_email/index.ts` and `send_auth_email/index.ts`

- [ ] **Step 1: Set `APP_ENV=production` on production FIRST and verify**

```bash
supabase secrets set APP_ENV=production --project-ref ogvcveimjjeywfdkkinb
supabase secrets list --project-ref ogvcveimjjeywfdkkinb | awk '{print $1}' | grep APP_ENV
```

Do not write the guard until this is confirmed.

- [ ] **Step 2: Write the failing test, vitest-style**

`supabase/functions/_shared/emailGuard.test.ts` using `describe`/`it`/`expect`, matching the 15 existing `_shared` tests. A Deno-style test would be picked up by the vitest glob and break the suite. Cover: production sends to anyone; staging sends to an allowlisted address; staging drops a non-allowlisted one; matching ignores case and whitespace; an empty allowlist drops everything; **an unset `APP_ENV` drops** (fails closed).

- [ ] **Step 3: Implement `shouldSend(appEnv, allowlist, recipient)`**

Returns true only when `appEnv === "production"` or the recipient is on the comma-separated allowlist, compared case-insensitively and trimmed.

- [ ] **Step 4: Wire into both send functions**

Immediately before each Resend call. Return **200**, not an error: `send_auth_email` is called by a Supabase auth hook that expects `application/json` (commit `76eb9a5`), and a non-200 breaks login rather than quietly skipping an email. Substitute the real recipient variable name in each file; do not assume it is `recipient`.

- [ ] **Step 5: Set `EMAIL_ALLOWLIST` on staging and add it to the manifest**

- [ ] **Step 6: Verify on staging with real sends**

Invite an allowlisted address (expect delivery) and a non-allowlisted one (expect no delivery plus a dropped line in the function logs).

- [ ] **Step 7: Verify production email still works**

Send one real invite from production and confirm it arrives. This is the step that catches the ordering hazard.

---

### Task 17: Seed staging at 50-rep volume and measure

A dashboard that is instant on five rows and takes eleven seconds on fifty reps is a classic way to lose a beta, and the buyer is the person looking at those reports.

**Files:** Create `supabase/seeds/staging-volume.sql`

- [ ] **Step 1: Write the volume seed**

`generate_series` producing, for one organization: 50 reps across a three-level hierarchy, 400 prospects, 150 deals across every stage, 6000 activities spread over 90 days. Base column names and enum values on `20260717000001_demo_data_reset.sql`.

- [ ] **Step 2: Apply and verify counts**

Roughly 50 / 6000 / 150.

- [ ] **Step 3: Measure the heavy reports**

`/dashboard`, `/dashboard/persistence-index`, `/dashboard/activity-to-win`, `/dashboard/lead-source`. Record time to last completed request.

- [ ] **Step 4: Judge against a stated bar**

3 seconds to interactive for a manager on a 50-rep org. Over 8 seconds is a launch blocker.

- [ ] **Step 5: If over, find whether it is the query or the payload**

Supabase Reports, Query Performance, sort by total time. `explain analyze` the worst. Confirm real column names before adding an index: `activities` uses `logged_by`, not `user_id`, and `activities_logged_by_occurred_idx` already exists.

---

## Phase 4: pre-onboarding

### Task 18: Take Google Places live, capped

`PLACES_MOCK` is still set on production, so the live Places path has never run there. If it is broken, discovery does not work for anyone on day one.

- [ ] **Step 1: Exercise the live path on staging first**, with the real key and `PLACES_MOCK` unset, and confirm real businesses come back rather than `fixtures.ts` data. Note that `discover_prospects` requires a real user JWT (`index.ts:293`), so drive it from the app, not curl.
- [ ] **Step 2: Measure cost per call and per cold cell.** `CELL_TTL_DAYS = 30` and cells are shared org-wide, so the true number is far below the naive ceiling. Measure rather than assume.
- [ ] **Step 3: Set a hard quota cap** on Places API (New) in Google Cloud Console, sized from Step 2 with 1.5x headroom. The cap is what stops the bleeding; an alert only tells you afterwards.
- [ ] **Step 4: Set a budget alert** at 50/90/100 percent to an address Ryan reads on a phone.
- [ ] **Step 5: Confirm graceful failure** when the cap is hit: a quota rejection must not produce a 500 and a blank screen. Returning cached prospects with a staleness flag is far better than nothing.
- [ ] **Step 6: Unset `PLACES_MOCK` on production, redeploy `discover_prospects`, run one discovery, and confirm `geo_cell_cache` recorded the pull.** An empty cache after a successful discovery means every request re-hits Google at full cost.

### Task 19: Rotate the AssemblyAI key

It passed through a chat transcript and must be treated as public.

- [ ] Create a new key in the AssemblyAI dashboard; update `ASSEMBLYAI_API_KEY` on production and staging; redeploy `transcribe`; record a voice note end to end to confirm; revoke the old key.

### Task 20: Rehearse inviting fifty people

If invites throttle silently, half the cohort gets nothing on day one and navigatr looks broken before anyone logs in.

- [ ] Raise the Supabase auth email rate limit above 200/hour. Confirm the Resend plan's daily limit and that the sending domain shows SPF, DKIM and DMARC passing. Invite ten plus-addressed addresses you control via the CSV wizard. Confirm ten successful `send_invite_email` invocations **and** ten Resend delivered events; disagreeing counts mean invites are being lost. Revoke the rehearsal invites afterwards.

### Task 21: Prove Sentry actually reports

Initialization is conditional on `VITE_SENTRY_DSN` (`apps/app/src/lib/observability.ts:34`). If that variable is absent in Vercel's production environment, Sentry has never reported anything.

- [ ] Confirm `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT=production`, and `VITE_RELEASE` exist in Vercel Production. Throw a test error from the production console and confirm it arrives. Create two alert rules: any new issue in `production`, and any issue seen more than 10 times in an hour. **Verify a notification actually reaches Ryan's phone**; an untested alert rule is not an alert rule. Resolve the smoke-test issues afterwards.

### Task 22: Enable point-in-time recovery

Last, because it protects data that does not exist yet, costs roughly $100/month, and can block the Task 8 organization transfer.

- [ ] Enable PITR on production. Record the retention window. Return after 30 minutes and confirm the earliest restore point is populated and advancing; an enabled toggle with no restore point is not protection.

### Task 23: Beta agreement data terms

- [ ] Write the retention window from Task 22 into the beta agreement, with an explicit statement that navigatr is in beta and should not be the sole record of business-critical information. Get Ryan's sign-off; this is customer-facing contractual language.

### Task 24: Correct the README

- [ ] `README.md` describes a .NET 9 backend at `apps/api/` that does not exist, and `package.json` has dead `dev:api`, `db:up`, and `db:down` scripts alongside a `docker-compose.yml` serving the removed stack. Rewrite Layout, Prerequisites, and Quick start around Vite plus Supabase, replace the Docker Postgres instructions with `supabase start`, delete the dead scripts and compose file, and add an Environments section linking the spec. Verify the quick start works from a clean clone.

### Task 25: Staged cohort runbook

- [ ] Write `docs/launch/beta-onboarding-runbook.md`: Wave 1 of three to five users, held a full working day; Wave 2 only if no unresolved Sentry issues and no failed invite deliveries; code freeze from the day before Wave 1 through the Friday of week one, hotfixes only. Include the go/no-go checklist. This and the freeze remain the two highest-value items in the whole program, and they cost nothing.

---

## Deferred until after onboarding

- **Demo environment.** Build it the week an ISO demo is scheduled. Same artifact as production, different environment variables and seed data, `EMAIL_ALLOWLIST` empty so the fail-closed guard drops everything.
- **Separate OAuth clients** for staging and demo, once Google verification of the production client completes. Touching the client under review risks resetting it. Until then staging runs `CALENDAR_MOCK=1`.
- **Weekly drift alarm.** With branch protection on and the paste habit broken, it insures against a failure the pipeline already blocks. **It must assert a non-empty dump**, or it will report "no drift" forever. It must also not target a GitHub Environment with required reviewers, or scheduled runs hang awaiting approval, and it needs `permissions: { issues: write }`.

---

## Definition of done

- [ ] `supabase db reset` on a clean machine reproduces production, proven by the Task 13 end-to-end pass, not by a schema diff.
- [ ] Production's migration ledger matches the repo and `db push --dry-run` reports nothing pending.
- [ ] A migration that cannot apply from zero is blocked by CI.
- [ ] An unannotated destructive migration is blocked by CI.
- [ ] A merge to `main` produces a working staging deployment with no manual step.
- [ ] Production moves only via the promote workflow, frontend and backend together.
- [ ] Vercel Preview builds point at staging.
- [ ] An email from staging to a non-allowlisted address is dropped, proven by test, **and production email still sends**.
- [ ] All three cron-driven functions reject the public anon key and accept `cron_secret`.
- [ ] Live Google Places works in production behind a hard quota cap.
- [ ] A test error raised in production reaches Ryan's phone.
- [ ] `README.md` describes the real architecture.
