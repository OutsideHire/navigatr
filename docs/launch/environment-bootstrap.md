# Environment bootstrap runbook

Everything here lives **only in a Supabase dashboard or Vault**. None of it is in
the repository, none of it is created by migrations, and none of it shows up in a
schema diff. An environment can pass every automated check we have and still be
unusable because one item below is missing.

**The test of this document:** someone can take an empty Supabase project from
zero to a working login by following it top to bottom without asking questions.

## What you do NOT need to do

Verified against a database built from all 111 migrations. These are created by
the migration set and need no manual step:

- The `auth.users` signup trigger (`on_auth_user_created`)
- Storage buckets `voice-notes` and `deal-files`, and their policies
- All three `pg_cron` schedules
- Reference data: 77 business holidays, 354 chain-exclusion seeds
- Per-function `verify_jwt` posture, which is declared in `config.toml` and
  applied by `supabase functions deploy`

---

## 1. Vault secrets

The cron jobs read these by name at run time. A missing one does not raise: the
job posts to a NULL url and fails into a log nobody reads. That is how
`place_refresh_fn_url` went missing until 2026-08-12, leaving the monthly Place
ID refresh unable to run since the day it was scheduled.

| Secret | Value |
|---|---|
| `cron_secret` | A random 32-byte hex string. **Must match the `CRON_SECRET` Edge Function secret exactly.** |
| `coverage_fn_url` | Full URL of the `compute_coverage_snapshots` function |
| `persistence_fn_url` | Full URL of the `compute_persistence_snapshots` function |
| `place_refresh_fn_url` | Full URL of the `refresh_place_ids` function |

Create `cron_secret` first, inside the database so it never transits anything:

```sql
select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'cron_secret',
  'Shared secret the cron schedulers send. Must match the CRON_SECRET function secret.'
);
```

Then read it once and set the identical value as the `CRON_SECRET` Edge Function
secret (section 2). Note that migration `20260812000004` auto-creates a random
`cron_secret` when none exists, so on a fresh environment this may already be
present; you still have to copy it to the function secret.

The three URLs follow one pattern. Derive rather than type them:

```sql
-- Substitute your project's function base URL. On production this is a custom
-- domain (api.getnavigatr.io); on a new project it is
-- https://<project-ref>.supabase.co/functions/v1
select vault.create_secret('<base>/compute_coverage_snapshots',    'coverage_fn_url',      'Nightly coverage snapshot job target.');
select vault.create_secret('<base>/compute_persistence_snapshots', 'persistence_fn_url',   'Nightly persistence snapshot job target.');
select vault.create_secret('<base>/refresh_place_ids',             'place_refresh_fn_url', 'Monthly Google Place ID refresh target.');
```

**Verify before moving on.** The cron jobs are the only consumers, so test them
the way cron does rather than trusting that the rows exist:

```sql
select net.http_post(
  url     := (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_fn_url'),
  headers := jsonb_build_object('Content-Type','application/json',
             'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
  body    := '{}'::jsonb);
```

Wait 15 seconds, then `select status_code, left(content,200) from
net._http_response order by id desc limit 1;`. Expect **200**. A **401** means
`cron_secret` and `CRON_SECRET` disagree. A **null-url error** means the URL
secret is missing. Repeat for the other two.

`place_refresh_service_role_key` is legacy. Nothing reads it since
`20260813000001`; it can be deleted once a run has succeeded.

---

## 2. Edge Function secrets

Set via dashboard (Edge Functions, Secrets) or
`supabase secrets set --project-ref <ref> KEY=value`.

**Never run `supabase secrets list` unfiltered.** It prints real values, not
digests. Always `| awk '{print $1}'`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. Everything else is yours:

| Secret | Local | Staging | Demo | Production |
|---|---|---|---|---|
| `APP_ENV` | `local` | `staging` | `demo` | `production` |
| `APP_BASE_URL`, `APP_URL` | localhost | staging domain | demo domain | production domain |
| `CRON_SECRET` | auto | required | required | required |
| `PLACES_MOCK` | `1` | `1` | `1` | **unset** |
| `GEOCODE_MOCK` | `1` | `1` | `1` | unset |
| `CALENDAR_MOCK`, `MICROSOFT_CALENDAR_MOCK` | `1` | `1` | `1` | unset |
| `TRANSCRIBE_MOCK` | `1` | `1` | `1` | unset |
| `GOOGLE_PLACES_API_KEY` | not needed | not needed | not needed | required |
| `RESEND_API_KEY`, `FROM_ADDRESS` | not needed | required (test domain) | required (test domain) | required |
| `EMAIL_ALLOWLIST` | n/a | required | `` (empty, drops all) | n/a |
| `SEND_EMAIL_HOOK_SECRET` | n/a | required | required | required |
| `ASSEMBLYAI_API_KEY` | not needed | optional | not needed | required |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` | test client | test client | test client | verified client |
| `MICROSOFT_CALENDAR_CLIENT_ID` / `_SECRET` | test client | test client | test client | production client |
| `CALENDAR_CALLBACK_BASE` | localhost | staging domain | demo domain | production domain |
| `INTERCOM_IDENTITY_SECRET` | not needed | not needed | not needed | required |

**All six mock flags compare against the exact string `"1"`.** Any other value,
including `"true"` or `"false"`, disables the mock and spends real money.

---

## 3. Auth configuration

Dashboard, Authentication. Not in the repo, and the most common cause of a new
environment that renders fine and cannot log anyone in.

**Site URL.** The environment's own origin. Used to build links in every auth
email.

**Redirect allowlist** (Additional Redirect URLs). Must include the environment's
origin and every path auth redirects to. **This has already caused one production
incident:** password reset was silently broken until `app.getnavigatr.io` was
added. Nothing errors, the email just links somewhere the app rejects.

**Email rate limits.** Default is low. Raise above **200/hour** before onboarding
a cohort. Fifty invites plus retries plus magic-link logins on day one will
exceed the default, and the failure is silent: the invite simply never sends.

**Send-Email hook.** Authentication, Hooks. Points at the `send_auth_email`
function and authenticates with `SEND_EMAIL_HOOK_SECRET`. Both the URL and the
secret must be set, and the hook must be enabled. Without it, Supabase sends its
own unbranded default emails, which looks like nothing is wrong.

---

## 4. Do not run `supabase config push` yet

The CLI has a `config push` subcommand that writes `config.toml` to a linked
project. **Running it against production today would break authentication.**

`config.toml`'s `[auth]` block currently holds local development defaults:

```toml
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]
[auth.rate_limit]
email_sent = 2
```

Pushing that would set production's Site URL to localhost and its email rate
limit to 2 per hour: the redirect-allowlist incident and the invite-throttle
failure, both at once, from one command.

Managing auth config from the repo is worth doing, and `config.toml` supports
`env(VAR)` interpolation so the values can be made environment-aware. Until that
work is done deliberately, treat section 3 as manual and do not push config.

---

## 5. Acceptance test

A new environment is not ready because the page renders. Run all of these:

- [ ] `supabase db push` reports nothing pending
- [ ] The six schema digests match production (query in `docs/launch/schema-drift-report.md`)
- [ ] All 15 edge functions deploy
- [ ] `node tools/check-secrets.mjs <env>` passes
- [ ] Each of the three cron URLs returns **200** to a manual `net.http_post` with `cron_secret` (section 1)
- [ ] Each of the three cron functions returns **401** to the public anon key
- [ ] An invite email sends and arrives, rendered with the branded template
- [ ] A new user completes signup from that invite and lands with the right role
- [ ] That user logs out and logs back in
- [ ] A voice note records and transcribes (exercises Storage plus `transcribe`)
- [ ] A file attaches to a deal (exercises the other Storage bucket)
- [ ] The morning after, both nightly snapshot jobs ran and the coverage and
      Persistence Index dashboards show data

The last one cannot be short-circuited. Cron is the part of the system with no
user watching it, which is exactly why it needs a deliberate check.
