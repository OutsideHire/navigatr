# Environment Pipeline (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **SUPERSEDED 2026-08-12. DO NOT EXECUTE.**
>
> This plan was written against a checkout 163 commits behind `origin/main` and
> contains verified factual errors (wrong migration count, wrong table and column
> names, invalid Supabase CLI flags, a CI job that cannot run, a re-baseline whose
> verification step is blind to what it loses, and an email-guard rollout that would
> silently drop all production email). It also assumes production holds real beta
> data, which it does not; that assumption is load-bearing in a dozen steps.
>
> See `docs/superpowers/specs/2026-08-06-environments-design.md` v2, section 19,
> for the full correction list. A single merged replacement plan is being written.

**Goal:** Make the repository the source of truth for navigatr's database and backend again, and put a staging environment plus real CI gates in front of production, so the code freeze ends onto a pipeline instead of back onto push-to-production.

**Architecture:** Three phases. Phase 1 makes the database reproducible (drift report, then a non-destructive re-baseline) and stands up staging on top of it. Phase 2 adds the gates: CI checks that prove a migration can build a database from zero, a promote workflow that snapshots before it migrates, and branch protection. Phase 3 handles the items that were deliberately deferred past onboarding. Order matters between phases and mostly does not matter within them.

**Tech Stack:** Supabase CLI, Postgres, pgTAP, Deno, GitHub Actions, Vercel, Vite + React, Playwright.

**Source spec:** `docs/superpowers/specs/2026-08-06-environments-design.md` section 13.3.

**Precondition:** Plan A is complete and the beta code freeze is in effect. This plan is executed while nothing is shipping to users.

**A note on Task 2:** the re-baseline steps depend on what Task 1's drift report actually finds. Task 1 ends in a human review gate for exactly that reason. Do not start Task 2 before that gate.

---

## Phase 1: Make the database reproducible

### Task 1: Produce the drift report

Nobody has ever seen the difference between the 60 repo migrations and production's real schema. This task produces that document and nothing else. It changes no production state.

**Files:**
- Create: `docs/launch/schema-drift-report.md`
- Create: `supabase/seed.sql` (empty placeholder, so `db reset` completes)

- [ ] **Step 1: Create the missing seed file so `db reset` can run**

`supabase/config.toml:65` sets `sql_paths = ["./seed.sql"]`, but that file does not exist, which breaks `supabase db reset`. Create `supabase/seed.sql`:

```sql
-- Local development seed. Runs after migrations during `supabase db reset`.
-- Populated in Task 3; intentionally empty here so the reset completes.
```

- [ ] **Step 2: Build a fresh database from the repo migrations**

```bash
supabase start
supabase db reset
```

Expected: all 60 migrations apply in order with no error. If any fail, record which and stop; a repo that cannot build itself is a finding in its own right and belongs at the top of the report.

- [ ] **Step 3: Dump the schema the repo produces**

```bash
supabase db dump --local -f /tmp/schema-from-repo.sql
```

- [ ] **Step 4: Dump production's real schema**

```bash
supabase db dump --linked -f /tmp/schema-from-prod.sql
```

Verify the link points at production first:

```bash
cat supabase/.temp/project-ref
```

Expected: `ogvcveimjjeywfdkkinb`

- [ ] **Step 5: Diff them**

```bash
diff -u /tmp/schema-from-repo.sql /tmp/schema-from-prod.sql > /tmp/schema-drift.diff
wc -l /tmp/schema-drift.diff
```

- [ ] **Step 6: Write the report**

Create `docs/launch/schema-drift-report.md` containing: the raw diff line count, and then a categorized list with one line per finding. Categories to sort every difference into:

1. **Exists in production, in no migration.** The dangerous category. These objects would vanish if the database were ever rebuilt from the repo.
2. **Exists in the repo, not in production.** A migration that was written but never pasted.
3. **Exists in both, defined differently.** Column type, default, nullability, or an RLS policy body that drifted.
4. **Cosmetic.** Ordering, whitespace, comments. No action.

For each finding in categories 1 through 3, state which is correct: production or the repo.

- [ ] **Step 7: Human review gate**

Present the report to Ryan. Do not proceed to Task 2 until it has been read and the category 1 findings in particular have been acknowledged, because those determine whether the baseline is simply production's dump or needs manual correction first.

- [ ] **Step 8: Commit**

```bash
git add supabase/seed.sql
git add -f docs/launch/schema-drift-report.md
git commit -m "docs: schema drift report, repo migrations vs production reality"
```

---

### Task 2: Re-baseline the migrations against production

Production now holds real beta data, so this is non-destructive: it changes the migration ledger and the repo, never the data.

**Files:**
- Create: `supabase/migrations/_archive/` (holding the existing 60 files)
- Create: `supabase/migrations/20260810000000_baseline.sql`
- Modify: `supabase/migrations/` (the 60 existing files move)

- [ ] **Step 1: Take an on-demand production backup**

Supabase dashboard, Database, Backups, create an on-demand backup and wait for completion. PITR from Plan A Task 3 also covers you, but an explicit restore point before a ledger change is worth the two minutes.

- [ ] **Step 2: Archive the existing migrations**

```bash
mkdir -p supabase/migrations/_archive
git mv supabase/migrations/*.sql supabase/migrations/_archive/
```

Verify nothing remains that the CLI would try to run:

```bash
ls supabase/migrations/*.sql 2>&1
```

Expected: `no matches found` or `No such file or directory`.

- [ ] **Step 3: Create the baseline from production's real schema**

```bash
supabase db dump --linked -f supabase/migrations/20260810000000_baseline.sql
```

Then open the file and add this header above the first line:

```sql
-- BASELINE. This is production's schema as of 2026-08-10, captured verbatim.
-- The 60 migrations that preceded it are retained in _archive/ for history and
-- are never executed. Every schema change from this point forward is a new
-- timestamped file applied by CI. Do not edit this file.
```

- [ ] **Step 4: Apply the category 1 and 3 corrections from Task 1, if any**

If the drift report found objects where the repo was correct and production was wrong, do not fix them in the baseline. The baseline must match production exactly. Instead write a separate follow-up migration, `20260810000001_post_baseline_corrections.sql`, containing only additive corrections. Skip this step if the report found none.

- [ ] **Step 5: Prove the baseline rebuilds production's schema exactly**

```bash
supabase db reset
supabase db dump --local -f /tmp/schema-from-baseline.sql
diff -u /tmp/schema-from-baseline.sql /tmp/schema-from-prod.sql
```

Expected: no output, or only the cosmetic category 4 differences identified in Task 1. Any structural difference means the baseline is wrong and must be recaptured. Do not continue past this step on a non-empty structural diff; every later task assumes this diff is clean.

- [ ] **Step 6: Repair production's migration ledger**

```bash
supabase migration repair --status applied 20260810000000 --project-ref ogvcveimjjeywfdkkinb
```

- [ ] **Step 7: Confirm production now reports itself as up to date**

```bash
supabase migration list --project-ref ogvcveimjjeywfdkkinb
```

Expected: the baseline row shows both a local and a remote timestamp, and no migration is listed as pending.

- [ ] **Step 8: Commit**

```bash
git add -A supabase/migrations
git commit -m "feat(db): re-baseline migrations against production schema

The 60 prior migrations are archived, not deleted. Production's ledger is
repaired to the baseline. From this commit, supabase db reset reproduces
production exactly and schema changes only reach any environment through a
timestamped migration applied by CI."
git push
```

---

### Task 3: Write the real seed file

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Read what the demo seeding functions already build**

```bash
grep -n "insert into" supabase/migrations/_archive/20260717000001_demo_data_reset.sql | head -30
```

Reuse the shapes and column names from there rather than inventing new ones.

- [ ] **Step 2: Write a minimal local seed**

Replace `supabase/seed.sql` with inserts creating exactly: one organization, one manager profile, three rep profiles reporting to that manager, five prospects, three deals across different stages, and ten activities spread over the last fourteen days. Use fixed UUIDs so local runs are reproducible.

Keep it small. This is for opening the app locally and having it look alive, not for load testing. Volume seeding for staging is Task 5.

- [ ] **Step 3: Verify it applies**

```bash
supabase db reset
```

Expected: migrations apply, then the seed applies, with no error.

- [ ] **Step 4: Verify the app renders against it**

```bash
pnpm dev:app
```

Open `http://localhost:5173`, log in as the seeded manager, and confirm the dashboard, pipeline, and activities screens render with data rather than empty states.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): local development seed"
```

---

### Task 4: Stand up the staging environment

**Files:**
- Create: `apps/app/.env.staging.example`

- [ ] **Step 1: Create the staging Supabase project**

Supabase dashboard, create a new project named `navigatr-staging` in the same region as production (West US, North California) so latency behaves comparably. Record the project ref.

- [ ] **Step 2: Apply the baseline to staging**

```bash
supabase link --project-ref <staging-ref>
supabase db push
```

Expected: the baseline migration applies. Then confirm:

```bash
supabase db dump --linked -f /tmp/schema-staging.sql
diff -u /tmp/schema-staging.sql /tmp/schema-from-prod.sql
```

Expected: no structural differences. This is the first proof that the re-baseline actually bought you anything.

- [ ] **Step 3: Relink to production so no later command targets staging by accident**

```bash
supabase link --project-ref ogvcveimjjeywfdkkinb
cat supabase/.temp/project-ref
```

Expected: `ogvcveimjjeywfdkkinb`

- [ ] **Step 4: Set the staging secrets**

```bash
supabase secrets set --project-ref <staging-ref> \
  APP_ENV=staging \
  PLACES_MOCK=1 \
  GEOCODE_MOCK=1 \
  CALENDAR_MOCK=1 \
  MICROSOFT_CALENDAR_MOCK=1 \
  TRANSCRIBE_MOCK=1 \
  APP_BASE_URL=https://staging.getnavigatr.io \
  APP_URL=https://staging.getnavigatr.io
```

Note the mock flags use the string `1`, matching the comparisons in the function source (for example `discover_prospects/index.ts:55`). Any other value disables the mock and spends real money.

- [ ] **Step 5: Deploy the edge functions to staging**

```bash
supabase functions deploy --project-ref <staging-ref>
```

Expected: all twelve functions deploy. This is also the first proof that CLI deployment handles the `../_shared/` imports without hand-flattening.

- [ ] **Step 6: Create the Vercel staging environment**

In the Vercel project settings, create a custom environment named `staging` attached to the `main` branch, with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` pointing at the staging project, `VITE_SENTRY_ENVIRONMENT=staging`, and the production Sentry DSN.

- [ ] **Step 7: Point the domain at it**

Add `staging.getnavigatr.io` in Vercel and create the DNS record. Confirm it serves the app and that the Supabase URL in the network tab is the staging project, not production. Getting this wrong means staging silently writes to your beta customers' database, so verify it explicitly rather than assuming.

- [ ] **Step 8: Block search engines**

Add to `apps/app/vercel.json` in the `headers` array, as a new entry:

```json
    {
      "source": "/(.*)",
      "has": [{ "type": "host", "value": "staging.getnavigatr.io" }],
      "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
    }
```

- [ ] **Step 9: Document the staging env vars**

Create `apps/app/.env.staging.example` mirroring `.env.local.example` with staging values and no secrets.

- [ ] **Step 10: Commit**

```bash
git add apps/app/vercel.json apps/app/.env.staging.example
git commit -m "feat(env): staging environment, noindex and env var template"
```

---

### Task 5: Seed staging at fifty-rep volume

**Files:**
- Create: `supabase/seeds/staging-volume.sql`

- [ ] **Step 1: Write the volume seed**

Create `supabase/seeds/staging-volume.sql` using `generate_series` to produce, for one organization: 50 rep profiles across a three-level reporting hierarchy, 400 prospects, 150 deals spread across every stage, and 6000 activities distributed over the last 90 days with realistic types and dispositions.

Base the column names and enum values on `supabase/migrations/_archive/20260717000001_demo_data_reset.sql` rather than guessing them.

- [ ] **Step 2: Apply it to staging**

```bash
psql "<staging-connection-string>" -f supabase/seeds/staging-volume.sql
```

- [ ] **Step 3: Verify the volume landed**

```sql
select
  (select count(*) from profiles) as reps,
  (select count(*) from activities) as activities,
  (select count(*) from deals) as deals;
```

Expected: roughly 50, 6000, and 150.

- [ ] **Step 4: Re-run the Plan A load measurements against staging**

Open `/dashboard`, `/dashboard/persistence-index`, `/dashboard/activity-to-win`, and `/dashboard/lead-source` on `staging.getnavigatr.io` and record load times. Compare against the Plan A Task 7 numbers. From now on, this is where performance regressions get caught before customers see them.

- [ ] **Step 5: Commit**

```bash
git add supabase/seeds/staging-volume.sql
git commit -m "feat(db): staging volume seed at 50-rep scale"
```

---

## Phase 2: Put gates in front of production

### Task 6: Make CI prove migrations build from zero

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add the database job**

Append to `.github/workflows/test.yml` under `jobs:`:

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
      - name: Rebuild database from every migration
        run: supabase db reset
      - name: Run pgTAP tests
        run: supabase test db
```

`supabase db reset` applies every migration from an empty database and then the seed, so a migration that cannot build from scratch fails here.

- [ ] **Step 2: Add the edge function test job**

```yaml
  functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x
      - name: Edge function unit tests
        run: deno test --allow-all supabase/functions/_shared/
```

These tests exist today (`chunk.test.ts`, `geohash.test.ts`, `icpFilter.test.ts`, `industryTaxonomy.test.ts`, and four under `_shared/coverage/`) and run nowhere.

- [ ] **Step 3: Add lint to the existing test job**

After the `Type check` step:

```yaml
      - name: Lint
        run: pnpm --filter app lint
```

- [ ] **Step 4: Verify the YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml')); print('valid')"
```

Expected: `valid`

- [ ] **Step 5: Commit and confirm all jobs run green**

```bash
git add .github/workflows/test.yml
git commit -m "ci: rebuild database from migrations, run pgTAP and edge function tests"
git push
```

Open the Actions tab and confirm `test`, `database`, and `functions` all pass. If `supabase test db` fails, the pgTAP files have drifted from the schema since June; fix the tests, do not delete them.

---

### Task 7: Enforce the additive-migration rule in CI

**Files:**
- Create: `tools/check-destructive-migrations.mjs`
- Create: `tools/check-destructive-migrations.test.mjs`
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Write the failing test**

Create `tools/check-destructive-migrations.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-destructive-migrations.mjs";

test("flags an unannotated drop column", () => {
  const sql = "alter table public.deals drop column notes;";
  assert.deepEqual(findViolations(sql), ["DROP COLUMN"]);
});

test("flags drop table and rename", () => {
  const sql = "drop table public.old_thing;\nalter table a rename to b;";
  assert.deepEqual(findViolations(sql).sort(), ["DROP TABLE", "RENAME"]);
});

test("allows a destructive statement with an override comment", () => {
  const sql = "-- destructive-ok: column added and unused in this same release\nalter table public.deals drop column notes;";
  assert.deepEqual(findViolations(sql), []);
});

test("ignores drop if exists on an index, which is not data loss", () => {
  const sql = "drop index if exists deals_org_idx;";
  assert.deepEqual(findViolations(sql), []);
});

test("passes a purely additive migration", () => {
  const sql = "alter table public.deals add column source text;";
  assert.deepEqual(findViolations(sql), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tools/check-destructive-migrations.test.mjs
```

Expected: FAIL, cannot find module `./check-destructive-migrations.mjs`.

- [ ] **Step 3: Write the implementation**

Create `tools/check-destructive-migrations.mjs`:

```js
// Fails CI on a migration that drops or renames data-bearing objects without an
// explicit override. See docs/superpowers/specs/2026-08-06-environments-design.md
// section 6.4: this project has been additive-only since the beta cohort arrived.
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
  for (const { file, violations } of failures) {
    console.error(`${file}: ${violations.join(", ")}`);
  }
  if (failures.length) {
    console.error(
      "\nDestructive migrations found. Split into two releases, or add a\n" +
        "'-- destructive-ok: <reason>' comment explaining why this is safe.",
    );
    process.exit(1);
  }
  console.log("No destructive migrations.");
}
```

Note this checks `supabase/migrations` only, not `_archive`, so the pre-baseline history does not fail the build.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tools/check-destructive-migrations.test.mjs
```

Expected: all 5 tests pass.

- [ ] **Step 5: Verify it passes against the current migrations**

```bash
node tools/check-destructive-migrations.mjs
```

Expected: `No destructive migrations.`

- [ ] **Step 6: Add it to CI**

In the `test` job of `.github/workflows/test.yml`, after `Lint`:

```yaml
      - name: Check for destructive migrations
        run: node tools/check-destructive-migrations.mjs
```

- [ ] **Step 7: Commit**

```bash
git add tools/check-destructive-migrations.mjs tools/check-destructive-migrations.test.mjs .github/workflows/test.yml
git commit -m "ci: block unannotated destructive migrations"
git push
```

---

### Task 8: Secrets manifest and drift check

**Files:**
- Create: `supabase/secrets.manifest.json`
- Create: `tools/check-secrets.mjs`
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Enumerate every secret the code actually reads**

```bash
grep -rhoE 'Deno\.env\.get\("[A-Z_]+' supabase/functions | sed 's/.*"//' | sort -u
```

Use the output as the authoritative key list; do not write the manifest from memory.

- [ ] **Step 2: Write the manifest**

Create `supabase/secrets.manifest.json` with names only, never values, following the table in spec section 8. Shape:

```json
{
  "environments": {
    "staging": ["APP_ENV", "APP_BASE_URL", "APP_URL", "PLACES_MOCK", "GEOCODE_MOCK", "CALENDAR_MOCK", "MICROSOFT_CALENDAR_MOCK", "TRANSCRIBE_MOCK", "RESEND_API_KEY", "FROM_ADDRESS"],
    "production": ["APP_ENV", "APP_BASE_URL", "APP_URL", "GOOGLE_PLACES_API_KEY", "RESEND_API_KEY", "FROM_ADDRESS", "GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"]
  }
}
```

Add the demo environment in Task 15. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform and are deliberately excluded.

- [ ] **Step 3: Write the checker**

Create `tools/check-secrets.mjs`:

```js
// Fails if an environment is missing a secret its code requires. Prints key
// NAMES only. Never prints or logs a value.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const env = process.argv[2];
const ref = process.env.SUPABASE_PROJECT_REF;

if (!env || !ref) {
  console.error("usage: SUPABASE_PROJECT_REF=<ref> node tools/check-secrets.mjs <environment>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync("supabase/secrets.manifest.json", "utf8"));
const required = manifest.environments[env];

if (!required) {
  console.error(`No manifest entry for environment "${env}".`);
  process.exit(2);
}

// `supabase secrets list` prints a table: NAME | DIGEST. Take column one,
// dropping the header and the separator rules.
const raw = execFileSync("supabase", ["secrets", "list", "--project-ref", ref], {
  encoding: "utf8",
});
const present = new Set(
  raw
    .split("\n")
    .map((line) => line.split("|")[0]?.trim())
    .filter((name) => name && name !== "NAME" && !/^-+$/.test(name)),
);

const missing = required.filter((key) => !present.has(key));

if (missing.length) {
  console.error(`Environment "${env}" is missing: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Environment "${env}" has all ${required.length} required secrets.`);
```

- [ ] **Step 4: Verify it catches a real gap**

```bash
SUPABASE_PROJECT_REF=<staging-ref> node tools/check-secrets.mjs staging
```

Expected: either a clean pass or a specific list of missing keys. If it reports missing keys, set them and re-run until clean. That is the check doing its job on its first run.

- [ ] **Step 5: Commit**

```bash
git add supabase/secrets.manifest.json tools/check-secrets.mjs
git commit -m "ci: secrets manifest and per-environment completeness check"
```

---

### Task 9: Email allowlist outside production

Staging shares the codebase with production. Without this, one bulk CSV invite on staging emails real strangers from an unfinished build.

**Files:**
- Create: `supabase/functions/_shared/emailGuard.ts`
- Create: `supabase/functions/_shared/emailGuard.test.ts`
- Modify: `supabase/functions/send_invite_email/index.ts`, `supabase/functions/send_auth_email/index.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/emailGuard.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldSend } from "./emailGuard.ts";

Deno.test("production sends to anyone", () => {
  assertEquals(shouldSend("production", "", "stranger@example.com"), true);
});

Deno.test("staging sends to an allowlisted address", () => {
  assertEquals(
    shouldSend("staging", "ceo@outsidehire.com,robert@outsidehire.com", "ceo@outsidehire.com"),
    true,
  );
});

Deno.test("staging drops a non-allowlisted address", () => {
  assertEquals(shouldSend("staging", "ceo@outsidehire.com", "stranger@example.com"), false);
});

Deno.test("allowlist matching ignores case and surrounding whitespace", () => {
  assertEquals(shouldSend("staging", " CEO@OutsideHire.com ", "ceo@outsidehire.com"), true);
});

Deno.test("staging with an empty allowlist drops everything", () => {
  assertEquals(shouldSend("staging", "", "ceo@outsidehire.com"), false);
});

Deno.test("an unset APP_ENV is treated as non-production and drops", () => {
  assertEquals(shouldSend(undefined, "", "stranger@example.com"), false);
});
```

The last case is the important one: an unset variable must fail closed, not open.

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test --allow-all supabase/functions/_shared/emailGuard.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/emailGuard.ts`:

```ts
// Outside production, only allowlisted recipients receive mail. Fails closed:
// an unset APP_ENV drops the send rather than delivering to a real person from
// a non-production build. See design spec section 5.2.

export function shouldSend(
  appEnv: string | undefined,
  allowlist: string,
  recipient: string,
): boolean {
  if (appEnv === "production") return true;
  const allowed = allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(recipient.trim().toLowerCase());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
deno test --allow-all supabase/functions/_shared/emailGuard.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Wire it into both send functions**

Read each function first to find where it calls Resend:

```bash
grep -n "resend\|fetch(" supabase/functions/send_invite_email/index.ts supabase/functions/send_auth_email/index.ts
```

Immediately before each send, insert:

```ts
import { shouldSend } from "../_shared/emailGuard.ts";

// ... inside the handler, before the Resend call:
if (!shouldSend(Deno.env.get("APP_ENV"), Deno.env.get("EMAIL_ALLOWLIST") ?? "", recipient)) {
  console.log(`[emailGuard] dropped non-allowlisted recipient in ${Deno.env.get("APP_ENV")}`);
  return new Response(JSON.stringify({ dropped: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
```

Return 200, not an error. `send_auth_email` is called by a Supabase auth hook that expects `application/json` (see commit `76eb9a5`), and a non-200 there would break the login flow rather than quietly skip an email.

Substitute the real variable name holding the recipient address in each file; do not assume it is called `recipient`.

- [ ] **Step 6: Add `EMAIL_ALLOWLIST` to staging and to the manifest**

```bash
supabase secrets set --project-ref <staging-ref> EMAIL_ALLOWLIST=ceo@outsidehire.com
```

Add `EMAIL_ALLOWLIST` to the `staging` array in `supabase/secrets.manifest.json`.

- [ ] **Step 7: Verify on staging with a real send**

Deploy to staging, then invite `ceo@outsidehire.com` (expect delivery) and `dropped-test@example.com` (expect no delivery, and a `[emailGuard] dropped` line in the function logs).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/emailGuard.ts supabase/functions/_shared/emailGuard.test.ts supabase/functions/send_invite_email/index.ts supabase/functions/send_auth_email/index.ts supabase/secrets.manifest.json
git commit -m "feat(email): drop non-allowlisted recipients outside production"
```

---

### Task 10: Deploy staging automatically on merge to main

**Files:**
- Create: `.github/workflows/deploy-staging.yml`

- [ ] **Step 1: Store the credentials**

In GitHub repository settings, Environments, create an environment named `staging` with secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (the staging ref), and `SUPABASE_DB_PASSWORD`.

Using a GitHub Environment rather than repository-wide secrets is what keeps the production credential unreachable from the staging job in Task 11.

- [ ] **Step 2: Declare per-function auth posture in the repo**

`supabase/config.toml` has no `[functions]` section, so whether each function
verifies a JWT is currently set by clicking in the dashboard rather than
described in the repo (spec section 7). Add one entry per deployed function.

First read the current posture from the dashboard (Edge Functions, each
function, Details) and record whether JWT verification is on. Then append to
`supabase/config.toml`, substituting the real values you just read:

```toml
[functions.discover_prospects]
verify_jwt = true

[functions.geocode]
verify_jwt = true

[functions.calendar_oauth]
verify_jwt = true

[functions.read_calendar_events]
verify_jwt = true

[functions.sync_appointment]
verify_jwt = true

[functions.sync_followup]
verify_jwt = true

[functions.sync_path]
verify_jwt = true

[functions.transcribe]
verify_jwt = true

[functions.send_invite_email]
verify_jwt = true

[functions.compute_coverage_snapshots]
verify_jwt = false

[functions.compute_persistence_snapshots]
verify_jwt = false

[functions.send_auth_email]
verify_jwt = false
```

The three set to `false` are called by Supabase itself rather than by a signed-in
user: the two snapshot functions run on a schedule, and `send_auth_email` is
invoked by the auth Send-Email hook. Verify each of those three against the
dashboard before committing this; setting `verify_jwt = true` on the auth hook
would break login, and setting `false` on a user-facing function would expose it.

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/deploy-staging.yml`:

```yaml
name: deploy-staging

on:
  push:
    branches: [main]

concurrency:
  group: deploy-staging
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Migrate staging database
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
        run: supabase db push --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
      - name: Deploy staging edge functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: supabase functions deploy --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
```

`concurrency` with `cancel-in-progress: false` matters: two merges in quick succession must not run `db push` simultaneously.

The Vercel frontend deploy is handled by Vercel's own `main` branch integration and needs no step here.

- [ ] **Step 4: Verify with a trivial merge**

Merge a no-op change to `main` and confirm the workflow runs green and that `staging.getnavigatr.io` reflects it.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-staging.yml
git commit -m "ci: auto-deploy staging on merge to main"
```

---

### Task 11: Promote workflow with pre-migration snapshot and smoke test

**Files:**
- Create: `.github/workflows/promote-production.yml`
- Create: `apps/app/e2e/smoke.spec.ts`

- [ ] **Step 1: Write the smoke test**

Create `apps/app/e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const BASE = process.env.SMOKE_BASE_URL!;

test("login page renders", async ({ page }) => {
  const response = await page.goto(`${BASE}/login`);
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("button", { name: /sign in|continue/i })).toBeVisible();
});

test("no console errors on the login page", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
```

This deliberately covers only unauthenticated surface. It catches the failure it is meant to catch, a build that deploys but renders blank, without needing credentials in CI.

- [ ] **Step 2: Run it against staging to verify it passes**

```bash
cd apps/app && SMOKE_BASE_URL=https://staging.getnavigatr.io npx playwright test e2e/smoke.spec.ts
```

Expected: 2 passed. If Playwright is not yet a dependency, add it with `pnpm --filter app add -D @playwright/test` and `npx playwright install --with-deps chromium` first.

- [ ] **Step 3: Create the production GitHub Environment**

Settings, Environments, create `production` with the production `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` set to `ogvcveimjjeywfdkkinb`, and `SUPABASE_DB_PASSWORD`. Enable "Required reviewers" and add Ryan, so promotion needs a human click even if the workflow is triggered by mistake.

- [ ] **Step 4: Write the promote workflow**

Create `.github/workflows/promote-production.yml`:

```yaml
name: promote-production

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type PROMOTE to confirm deploying the current main to production'
        required: true

concurrency:
  group: promote-production
  cancel-in-progress: false

jobs:
  promote:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Refuse unless explicitly confirmed
        run: |
          if [ "${{ github.event.inputs.confirm }}" != "PROMOTE" ]; then
            echo "Confirmation text did not match. Nothing was deployed."
            exit 1
          fi

      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Snapshot production before migrating
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          supabase db dump --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} \
            --data-only -f pre-promote-data-${{ github.sha }}.sql
          supabase db dump --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} \
            -f pre-promote-schema-${{ github.sha }}.sql

      - name: Upload the snapshot
        uses: actions/upload-artifact@v4
        with:
          name: pre-promote-snapshot-${{ github.sha }}
          path: pre-promote-*.sql
          retention-days: 30

      - name: Migrate production
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
        run: supabase db push --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}

      - name: Deploy production edge functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: supabase functions deploy --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Smoke test production
        env:
          SMOKE_BASE_URL: https://app.getnavigatr.io
        run: cd apps/app && npx playwright test e2e/smoke.spec.ts

      - name: Tag the release
        run: |
          git tag "release-$(date -u +%Y%m%d-%H%M%S)-${GITHUB_SHA::7}"
          git push origin --tags
```

The dump-based snapshot is belt and braces alongside the PITR enabled in Plan A. It costs a minute and gives you a file you can diff, which PITR does not.

The Vercel production deploy is triggered by Vercel's own integration; if the Vercel project is set to deploy `main` automatically, change it to deploy only on this workflow's tag before relying on the promote button as the sole path to production.

- [ ] **Step 5: Verify the confirmation guard actually refuses**

Trigger the workflow from the Actions tab typing anything other than `PROMOTE`. Expected: the first step fails and nothing else runs.

- [ ] **Step 6: Run a real promote**

Trigger with `PROMOTE`, approve the environment prompt, and confirm every step passes, the snapshot artifact is attached to the run, and a `release-*` tag appears.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/promote-production.yml apps/app/e2e/smoke.spec.ts apps/app/package.json pnpm-lock.yaml
git commit -m "ci: promote-to-production workflow with pre-migration snapshot and smoke test"
```

---

### Task 12: Branch protection

**Files:** none (GitHub repository settings)

- [ ] **Step 1: Confirm every check name from a recent run**

Open the Actions tab and note the exact job names as GitHub reports them: `test`, `database`, `functions`. You must match these strings exactly.

- [ ] **Step 2: Add the ruleset**

Settings, Rules, Rulesets, new branch ruleset targeting `main`:

- Require a pull request before merging: **on**
- Required approvals: **0**
- Require status checks to pass: **on**, adding `test`, `database`, and `functions`
- Require branches to be up to date before merging: **on**
- Block force pushes: **on**

Zero required approvals is deliberate, per spec section 10: a solo operator approving their own pull requests teaches the habit of clicking through gates. Raise this to 1 when a second engineer joins.

- [ ] **Step 3: Verify it blocks a bad merge**

Open a pull request that deliberately breaks a test. Confirm the merge button is disabled until the check passes. Then close the pull request without merging.

- [ ] **Step 4: Verify direct pushes are refused**

```bash
git checkout main && git commit --allow-empty -m "test: direct push should be refused" && git push
```

Expected: rejected by the ruleset. Then `git reset --hard origin/main` to discard the local commit.

---

## Phase 3: Deferred items

### Task 13: Move navigatr to its own Supabase organization

Production currently shares organization `lwicvufjihaqvlebwulb` with 13 unrelated projects (spec section 2.2). Do this in a planned window, not during a beta week.

- [ ] **Step 1: Confirm whether transfer causes downtime**

Check current Supabase documentation for project transfer between organizations, and confirm in writing whether the project is unavailable during the move. Do not proceed on an assumption. If it does cause downtime, schedule it outside working hours for the beta cohort and notify them.

- [ ] **Step 2: Create the new organization**

Named for Navigatr LLC, on the Pro plan, with only Ryan as owner initially.

- [ ] **Step 3: Transfer production, then staging**

Production first, verified working, before touching staging.

- [ ] **Step 4: Verify after each transfer**

Confirm the project ref is unchanged (so no environment variable needs updating), the app still loads, PITR is still enabled, and all secrets are still present via `node tools/check-secrets.mjs production`.

- [ ] **Step 5: Audit membership on the old organization**

Confirm nobody outside Navigatr LLC retains access to navigatr data.

---

### Task 14: Separate OAuth clients for lower environments

Blocked until Google verification of the production client completes (spec section 5.3). Touching the client under review risks resetting it.

- [ ] **Step 1: Confirm Google verification has completed**

Check the Google Cloud Console OAuth consent screen status. Do not start until it reads verified.

- [ ] **Step 2: Create a separate OAuth client in testing mode**

Redirect URIs for `staging.getnavigatr.io` and `demo.getnavigatr.io`. Add Ryan and Robert as test users.

- [ ] **Step 3: Set the staging secrets**

```bash
supabase secrets set --project-ref <staging-ref> \
  GOOGLE_CALENDAR_CLIENT_ID=<test-client-id> \
  GOOGLE_CALENDAR_CLIENT_SECRET=<test-client-secret>
```

Then unset `CALENDAR_MOCK` on staging so the real OAuth path is exercised there.

- [ ] **Step 4: Repeat for the Microsoft Azure app registration**

Following `docs/launch/microsoft-outlook-setup/AZURE-APP-SETUP.md`.

- [ ] **Step 5: Verify a full calendar connect on staging**

Connect a calendar end to end on `staging.getnavigatr.io` and confirm production's client was never touched.

---

### Task 15: Demo environment

Build this the week of the first scheduled ISO demo, not before. Demo runs the identical artifact as production (spec section 5.1).

- [ ] **Step 1: Create the `navigatr-demo` Supabase project and apply the baseline**

Same steps as Task 4 Steps 1 through 3, substituting the demo ref.

- [ ] **Step 2: Set demo secrets, including a suppressing allowlist**

Same as Task 4 Step 4 with `APP_ENV=demo` and `APP_BASE_URL=https://demo.getnavigatr.io`, plus `EMAIL_ALLOWLIST=` set to an empty string, which the `shouldSend` guard from Task 9 treats as dropping every recipient.

- [ ] **Step 3: Add the demo environment to the secrets manifest**

- [ ] **Step 4: Create the Vercel demo environment and domain, with `noindex`**

Same as Task 4 Steps 6 through 8.

- [ ] **Step 5: Write the demo seed**

Create `supabase/seeds/demo-org.sql` from the curated multi-layer org logic in `supabase/migrations/_archive/20260717000001_demo_data_reset.sql` and `20260723000001_demo_org_hierarchy.sql`, converting it from a production feature flag into a plain seed script (spec section 11).

- [ ] **Step 6: Add a nightly reseed workflow**

`.github/workflows/reseed-demo.yml` on a `schedule` cron at 08:00 UTC, running the demo seed against the demo project so a messy sales call leaves no residue.

- [ ] **Step 7: Add a manual demo deploy workflow**

A `workflow_dispatch` copy of the promote workflow targeting the demo environment, deploying the current production release.

---

### Task 16: Weekly drift alarm

**Files:**
- Create: `.github/workflows/drift-alarm.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/drift-alarm.yml`:

```yaml
name: drift-alarm

on:
  schedule:
    - cron: "0 13 * * 1"
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Build the schema the repo describes
        run: |
          supabase start
          supabase db reset
          supabase db dump --local -f /tmp/repo.sql
      - name: Dump production's live schema
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: supabase db dump --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} -f /tmp/prod.sql
      - name: Compare
        run: diff -u /tmp/repo.sql /tmp/prod.sql > /tmp/drift.diff || true
      - name: Open an issue if they disagree
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if [ -s /tmp/drift.diff ]; then
            gh issue create \
              --title "Schema drift detected $(date -u +%Y-%m-%d)" \
              --body "$(printf 'Production schema differs from the repo.\n\n```diff\n%s\n```\n' "$(head -c 60000 /tmp/drift.diff)")"
          else
            echo "No drift."
          fi
```

- [ ] **Step 2: Run it manually and confirm it reports no drift**

Trigger via `workflow_dispatch`. Expected: `No drift.` If it opens an issue on the first run, either the re-baseline was incomplete or someone has changed production schema outside a migration, and both are worth knowing immediately.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/drift-alarm.yml
git commit -m "ci: weekly production schema drift alarm"
```

---

### Task 17: Correct the README

`README.md` describes a .NET 9 backend at `apps/api/` that does not exist, a `pnpm dev:api` script that cannot work, and a Sprint 0 status.

**Files:**
- Modify: `README.md`
- Modify: `package.json` (remove the dead `dev:api` script)

- [ ] **Step 1: Confirm the backend really is gone**

```bash
ls apps/
```

Expected: `app` only.

- [ ] **Step 2: Rewrite the Layout, Prerequisites, and Quick start sections**

Describe the actual architecture: a Vite and React frontend on Vercel, with Supabase providing Postgres, RLS, auth, and edge functions. Replace the Docker Postgres instructions with `supabase start`. Remove the .NET SDK prerequisite.

- [ ] **Step 3: Remove the dead scripts**

Delete `dev:api`, `db:up`, and `db:down` from `package.json`, and delete `docker-compose.yml`, all of which serve the removed .NET stack.

- [ ] **Step 4: Add an Environments section**

A short table of local, staging, demo, and production with their URLs, plus a pointer to `docs/superpowers/specs/2026-08-06-environments-design.md`.

- [ ] **Step 5: Verify the quick start actually works from a clean clone**

Follow your own instructions in a fresh directory. Anything that does not work as written is a bug in the README.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json
git rm docker-compose.yml
git commit -m "docs: README describes the real architecture"
```

---

## Definition of done

- [ ] `supabase db reset` on a clean machine reproduces production's schema exactly (spec 17.1).
- [ ] Production's migration ledger matches the repo baseline (spec 17.2).
- [ ] A pull request whose migration cannot apply from zero is blocked by CI (spec 17.3).
- [ ] A pull request with an unannotated destructive migration is blocked by CI (spec 17.4).
- [ ] A merge to `main` produces a working staging deployment with no manual step (spec 17.5).
- [ ] Production has been deployed only by the promote workflow since Task 11 (spec 17.6).
- [ ] An email from staging to a non-allowlisted address is dropped, proven by test (spec 17.7).
- [ ] `README.md` describes the real architecture (spec 17.10).
