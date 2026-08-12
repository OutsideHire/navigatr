# Schema drift report, 2026-08-12

**Result: production and the repository are now provably identical.** All six
object-class digests match exactly. This is the first time the repo has been a
reliable description of the running database.

| Object class | Count | Digest (both sides) |
|---|---|---|
| columns | 436 | `251beeb87863bf04532d7e95dc61550a` |
| functions | 156 | `a17ff2a2ea33c35ef44f0409567f601a` |
| indexes | 119 | `a3294ad476c7de312f56373bc1683d37` |
| policies | 74 | `092d46300a0d0a0e14aee6c89fe7e08b` |
| RLS-enabled tables | 34 | `c453e02f55efd50e1ae0db3ee5d2b558` |
| triggers | 32 | `abe67195308f8c7f57e186566d8871d2` |

---

## How this was measured

`supabase db dump --linked` could not be used. Supabase direct database
connections are IPv6-only and the machine has no IPv6 egress, so `pg_dump` died
with `SSL SYSCALL error: EOF detected` partway through.

**The CLI exits 0 and writes an empty file when this happens.** Any CI job that
diffs dumps without checking for a non-empty result would report "no drift"
forever. The planned weekly drift alarm must assert file size.

Method used instead: build a local database from all 110 repo migrations, run
matching catalog-fingerprint queries on both sides, and diff the digests.

---

## What was found, and what was done

### 1. The repo could not build a database at all

`20260618000001_deal_contacts.sql` and `20260618000001_partner_deal_direction.sql`
shared a version. The migration ledger uses version as a primary key, so the
second always failed with a unique-constraint violation.

Renumbered the second to `20260618000003`. They touch different tables
(`deal_contacts` vs `partner_deals`) and are order-independent.

This also explains a discrepancy: 55 migration *files* at or before the ledger
cutoff, but 54 distinct *versions*, which is exactly what production recorded.

### 2. `20260812000004_cron_shared_secret.sql` blocked every fresh build

It raised an exception when the `cron_secret` Vault entry was absent. Correct for
production, wrong for reproducibility. Now generates a random secret when none
exists, which stays fail-closed because the schedulers cannot authenticate until
an operator sets the matching `CRON_SECRET` function secret.

### 3. `supabase/seed.sql` never existed

`config.toml:65` had referenced it since the project was created.

### 4. A migration was never applied, and it broke a live feature

`20260804000003_phone_digits_search.sql` had not reached production, so
`deals.contact_phone_digits`, `partners.phone_digits` and their two indexes were
absent. `useGlobalSearch.ts:99,104` queries those columns, so **searching by
phone number was broken in production**. Applied and verified.

### 5. The migration ledger stops at 2026-07-08

Production recorded 54 migrations, `20260517000001` through `20260708160000`, and
nothing after. Migrations applied by pasting into the SQL Editor are never
recorded. Everything before July 8 applied correctly; for the ~55 after it, the
ledger is silent.

### 6. 34 of 76 application functions had different definitions

Including `handle_new_user_signup`, `claim_invite_code`, `admin_bulk_invite`,
`business_days_between`, `create_organization`, `admin_set_role_level`, and the
whole de-duplication family.

**Root cause: reformatted pastes, not stale logic.** Production's function bodies
came from SQL that had been reformatted or stripped of comments relative to the
migration files. Comments and whitespace inside a function body are part of its
stored definition, so the digests differed while behaviour did not.

Demonstrated twice:

- `set_primary_calendar_provider` was written on 2026-08-12 and drifted the same
  day, because the version pasted into chat had two explanatory comments removed
  for readability.
- `admin_reassign_deals` and `is_feature_enabled` are each created by exactly one
  migration, from May, recorded as applied, and neither file has been edited
  since its original commit. Both were diffed in full: the only differences were
  comments, indentation, and one line wrap. No production-only logic existed.

Resolved by re-applying the repo's definitions for all 34 via `CREATE OR REPLACE`,
then forcing recomputation of `deals.dedupe_key` (a stored generated column whose
expression calls `deal_dedupe_key`, so replacing that function does not update
already-stored values).

---

## Consequences for the environments design

1. **Baseline strategy is repo-canonical.** Structural drift was tiny and nothing
   existed in production that no migration creates. The repo is now authoritative
   by construction rather than by assertion.
2. **The drift alarm must assert a non-empty dump**, per the CLI failure above.
3. **CI must build the database from zero on every pull request.** Two of the
   findings here (duplicate versions, the failing bootstrap guard) were invisible
   to code review and surfaced the instant a build from zero was attempted.
4. **The SQL Editor paste habit produces drift even when the SQL is correct.**
   Reformatting on the way through is enough. This is an argument for applying
   migrations only from CI, not merely for applying them consistently.
