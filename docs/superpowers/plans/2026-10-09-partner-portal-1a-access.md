# Partner Portal Phase 1A (Partner access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ISO turn on a branded partner portal, invite a referral partner from the partner record, and let that partner accept the ISO's terms and sign in with a 6-digit email code, with sessions an internal user can suspend or revoke instantly. A minimal signed-in landing page proves the session works; submission and dashboards are Phase 1B.

**Architecture:** Partners are never Supabase Auth users. Every secret (invite token, sign-in code, session token) is generated, hashed, rate limited, expired and consumed inside SECURITY DEFINER SQL functions that only the service role can execute, so plain-psql DB tests cover the whole security model. Two edge functions sit in front: `portal_api` (verify_jwt off, partner-facing, session in an `x-portal-session` header) and `portal_invite` (verify_jwt on, called by a signed-in rep). Both delegate to pure, vitest-tested handler modules in `supabase/functions/_shared`. The SPA mounts a separate `/p/:slug/*` route tree that talks to `portal_api` with plain `fetch`, keeps its session in `localStorage` per slug, and themes itself from the tenant's branding before sign-in.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pgcrypto in the `extensions` schema), Deno edge functions with Resend, React 19 + TypeScript, React Router, TanStack Query, vitest + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (sections 5.1 to 5.4, 5.10, 5.11, 6 and 7 are this plan; section 2 R1 and R2 give the sign-in decisions).

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261009000001_...` onward, applied in filename order. The latest existing migration is `20261007000004`. Never hand-apply SQL to staging or production; CI and `promote-production` apply them.
- Partners are never Supabase Auth users (brief D1, spec R2). Nothing in this plan calls `supabase.auth` for a partner.
- All secret generation, hashing, rate limiting, expiry and state transitions live in SQL (brief D2). Every portal SQL function is `security definer set search_path = public, extensions`.
- pgcrypto calls are always schema-qualified: `extensions.gen_random_bytes(...)` and `extensions.digest(...)`. An unqualified `gen_random_bytes` fails at call time under a pinned search_path (it broke `rotate_invite_code` for seven weeks).
- Portal-side SQL functions are service-role only (brief D3): `revoke execute ... from public, anon, authenticated;` then `grant execute ... to service_role;`. Supabase grants `authenticated` directly, so it is revoked by name. Private helpers (`_portal_*`) are also revoked from `service_role`. They return a raw secret once and store only its SHA-256 hash.
- Internal-side RPCs callable by the app (`get_portal_settings`, `update_portal_settings`, `get_portal_status`, `portal_set_access`) use `security definer set search_path = public, extensions`, re-check visibility or admin rights inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`.
- Every portal table has `org_id NOT NULL`, RLS enabled, and `revoke all ... from anon` (brief D16). `portal_tokens`, `portal_sessions` and `portal_audit_log` are also `revoke all ... from authenticated`. `portal_users` gets a column-level SELECT grant for `authenticated` (id, org_id, partner_id, status, invited_at, activated_at, last_login_at) behind a `can_see_partner` policy, and no write grants. Emails are stored lowercased with a unique `(org_id, lower(email))` index and a unique `partner_id`.
- Admin signal in SQL is `public.caller_is_admin()`. Partner visibility is `public.can_see_partner(partner uuid)`. Explicit-viewer hierarchy check is `public.profile_can_see_owner(viewer uuid, owner uuid)` (service-only, from Phase 0). Org is `public.user_org_id()`.
- DB tests: plain psql scripts in `supabase/tests/NNN_name.sql` starting at `037`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Assert function privileges with `has_function_privilege` and column privileges with `has_column_privilege`, never by calling a function the role cannot execute: local Postgres 17.6 segfaults on a live function-level permission-denied.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`.
- `_shared` modules are dependency-free TS with no Deno globals at module scope, import each other with the `.ts` extension, and their tests import without the extension. New `_shared` source files are added to the `include` list in `apps/app/tsconfig.app.json` so `tsc -b` typechecks them.
- `portal_api` responses are built from explicit allowlists, never by passing rows through. `request_code` always answers `200 { "ok": true }`. A failed `verify_code` always answers `401 { "error": "invalid_code" }`.
- The partner's session token travels only in the `x-portal-session` header. `portal_api` never reads `Authorization` for identity.
- The frontend portal client uses plain `fetch` (never `supabase.functions.invoke`, whose session guard swaps the anon bearer for an internal user's JWT). The session lives in `localStorage` under `navigatr-portal-session:<slug>`, every access wrapped in try/catch.
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. Tests live next to source. No `act()` warnings.
- Before any push: `pnpm --filter app build` must pass (it runs `tsc -b && vite build`; `tsc --noEmit` alone is not enough).
- Partner-facing copy names the ISO (organization name), never "navigatr". Copy is plain, short and readable on a 360px phone.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

**Create**
- `supabase/migrations/20261009000001_portal_access_schema.sql`: organizations portal columns, enums, `portal_users`, `portal_tokens`, `portal_sessions`, `portal_audit_log`, privileges, RLS, `get_portal_settings`, `update_portal_settings`.
- `supabase/migrations/20261009000002_portal_invites.sql`: private helpers (`_portal_hash`, `_portal_new_token`, `_portal_audit`, `_portal_create_session`), `portal_create_invite`, `portal_peek_invite`, `portal_accept_invite`.
- `supabase/migrations/20261009000003_portal_sign_in.sql`: `portal_brand`, `portal_issue_code`, `portal_verify_code`, `portal_session_lookup`, `portal_sign_out`.
- `supabase/migrations/20261009000004_portal_internal_access.sql`: `get_portal_status`, `portal_set_access`.
- `supabase/tests/037_portal_schema_settings.sql`, `038_portal_invites.sql`, `039_portal_sign_in.sql`, `040_portal_internal_access.sql`.
- `supabase/functions/_shared/portalEmail.ts` (+ `.test.ts`): sender address, portal URLs, invite and sign-in code emails.
- `supabase/functions/_shared/portalApi.ts` (+ `.test.ts`): `handlePortalRequest(req, deps)` and header helpers.
- `supabase/functions/_shared/portalInvite.ts` (+ `.test.ts`): `handlePortalInvite(req, deps)`.
- `supabase/functions/portal_api/index.ts`, `supabase/functions/portal_api/deno.json`.
- `supabase/functions/portal_invite/index.ts`, `supabase/functions/portal_invite/deno.json`.
- `apps/app/src/features/portal/lib/portalApi.ts` (+ test): fetch client.
- `apps/app/src/features/portal/lib/portalSession.ts` (+ test): per-slug session storage.
- `apps/app/src/features/portal/lib/portalAddress.ts` (+ test): the shareable portal URL.
- `apps/app/src/features/portal/PortalBrandProvider.tsx` (+ test).
- `apps/app/src/features/portal/components/PortalShell.tsx`.
- `apps/app/src/features/portal/pages/PortalRoot.tsx` (+ test), `PortalUnavailablePage.tsx`, `PortalSignInPage.tsx`, `PortalHomePage.tsx`, `PortalInvitePage.tsx` (+ test).
- `apps/app/src/features/partners/hooks/usePortalAccess.ts` (+ test).
- `apps/app/src/features/partners/components/PortalAccess.tsx` (+ test).
- `apps/app/src/features/settings-hub/usePortalSettings.ts`.
- `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx` (+ test).

**Modify**
- `supabase/config.toml`: `[functions.portal_api] verify_jwt = false` with a reason, `[functions.portal_invite] verify_jwt = true`.
- `apps/app/tsconfig.app.json`: include the three new `_shared` files.
- `apps/app/src/App.tsx`: lazy `PortalRoot`, bare `/p/:slug/*` route in the public block.
- `apps/app/src/features/partners/pages/PartnerDetailPage.tsx` (+ test): invite button in the hero row, portal status line in the contact card.
- `apps/app/src/features/settings-hub/tabs.ts` (+ test), `SettingsHubPage.tsx` (+ test): the "Partner portal" admin tab.

**Deviations from spec, recorded here:**

1. **Session header, not `Authorization: Portal`.** Spec 5.1 sketches `Authorization: Portal <token>`. The Supabase gateway and the app's session guard both treat `Authorization` as theirs, so the token rides in `x-portal-session` (brief D5). `portal_api` still never accepts a Supabase JWT as identity.
2. **Branding provider.** Spec 5.11 says `BrandProvider` is fed from the `brand` action. `BrandProvider` reads the signed-in org and takes no brand prop, so the portal gets a small `PortalBrandProvider` that reuses `deriveBrandVars` (brief D11).
3. **Emails keep the navigatr header in 1A.** Spec 5.8 extends the email template with a tenant brand. In 1A the invite and code emails carry the ISO's name in the sender, subject and body, but the template header still shows the navigatr logo and wordmark. Per-tenant logo and color in emails, the "Powered by" footer rule, and Reply-To land in Phase 1C with the referral emails.
4. **Portal pages in 1A.** Spec 5.11 lists dashboard, referral detail, submit and profile pages. 1A ships sign-in, code entry, invite accept with terms, an unavailable page, and a minimal signed-in landing page. The rest is Phase 1B.
5. **Audit log reads.** Spec 5.2 says admins can SELECT `portal_audit_log`. In 1A it is service-role only; an admin report reads it later (brief D16).
6. **Terms text is a placeholder.** When an admin first turns the portal on, the terms field is seeded with a plain placeholder naming the ISO. Robert's attorney review of navigatr-level partner terms is still open (spec 10); the admin can edit the text and every edit bumps the version so partners accept again.
7. **Restore needs a fresh invite.** "Restore access" moves a suspended or revoked partner back to Invited; the rep then sends a new invite (no silent reactivation of old sessions).
8. **Overflow actions are an inline "Manage" disclosure,** not a Radix dropdown, to stay compact and reliably testable in jsdom.
9. **No changes to the global 401 handler, `PublicOnlyRoute`, or the PWA fallback.** The 401 handler only wraps the axios client, the portal route sits outside `PublicOnlyRoute`, and the PWA `navigateFallbackDenylist` only lists `/auth/`, so `/p/*` already behaves (spec 5.11 asked for this to be checked).
10. **Security test coverage split.** Spec 6 asks for a test that `portal_api` rejects a Supabase JWT (Task 6 covers it) and that the app API rejects a portal token. The second holds by construction (a portal token is 64 hex characters, not a signed JWT, so the gateway and PostgREST reject it) and is checked on staging in the PR test plan rather than by an automated test, because it needs a live gateway.
11. **Small schema additions beyond spec 5.2:** `portal_tokens.revoked_at` (resend and revoke invalidate without pretending a token was used), `portal_sessions.ip`, `portal_users.invited_by`, `portal_audit_log.actor_user_id`, and audit actions `invite`, `code_request`, `sign_out`, `suspend`, `restore`. Sign-in code hashes are not unique (they are salted per user and the same 6 digits can recur over time); invite hashes are.

---

### Task 1: Portal tables, tenant settings columns, settings RPCs

**Files:**
- Create: `supabase/migrations/20261009000001_portal_access_schema.sql`
- Test: `supabase/tests/037_portal_schema_settings.sql`

**Interfaces:**
- Consumes (SQL): `public.caller_is_admin() returns boolean`, `public.user_org_id() returns uuid`, `public.can_see_partner(uuid) returns boolean`.
- Produces (SQL):
  - Columns on `organizations`: `portal_enabled boolean not null default false`, `partner_value_visibility boolean not null default false`, `partner_terms_text text`, `partner_terms_version integer not null default 0`, `consent_text text`, `consent_version integer not null default 0`.
  - Types: `portal_user_status ('invited','active','suspended','revoked')`, `portal_token_type ('invite','sign_in_code')`, `portal_audit_action ('invite','code_request','sign_in','sign_out','terms_accept','suspend','revoke','restore','submit','withdraw','view_referral')`.
  - Tables: `portal_users`, `portal_tokens`, `portal_sessions`, `portal_audit_log` (columns in Step 3).
  - `public.get_portal_settings() returns table (enabled boolean, terms_text text, terms_version integer, consent_text text, consent_version integer, value_visibility boolean, slug text, org_name text)`; admin only, raises `not_authorized`.
  - `public.update_portal_settings(p_enabled boolean, p_terms_text text, p_consent_text text, p_value_visibility boolean)` returns the same table; admin only. Blank text keeps the stored text. Turning the portal on with no terms or consent seeds the defaults. A version bumps only when its text actually changes.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/037_portal_schema_settings.sql`:

```sql
-- Tests for 20261009000001_portal_access_schema (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/037_portal_schema_settings.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org PS, slug portal-set): boss administrator, rep sales_professional.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000000f71', 'Portal Settings Org', 'portal-set', 'portal-set-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f7100000-0000-0000-0000-000000000001', 'boss@ps.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f7100000-0000-0000-0000-000000000002', 'rep@ps.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('f7100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f71', 'admin', 'administrator',      'Boss', 'boss@ps.example', 'boss'::ltree,     null),
  ('f7100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f71', 'rep',   'sales_professional', 'Rep',  'rep@ps.example',  'boss.rep'::ltree, 'f7100000-0000-0000-0000-000000000001');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Runs p_sql and asserts it raises an error whose message contains p_token.
create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

-- New organization columns default to off and empty.
do $$ declare o organizations; begin
  select * into o from organizations where id = '00000000-0000-0000-0000-000000000f71';
  if o.portal_enabled or o.partner_value_visibility then raise exception 'portal flags should default to false'; end if;
  if o.partner_terms_text is not null or o.consent_text is not null then raise exception 'portal texts should default to null'; end if;
  if o.partner_terms_version is distinct from 0 or o.consent_version is distinct from 0 then raise exception 'portal versions should default to 0'; end if;
end $$;

-- Table privileges and RLS.
do $$ declare t text; begin
  foreach t in array array['public.portal_users','public.portal_tokens','public.portal_sessions','public.portal_audit_log'] loop
    if has_any_column_privilege('anon', t, 'SELECT') or has_table_privilege('anon', t, 'INSERT')
       or has_table_privilege('anon', t, 'UPDATE') or has_table_privilege('anon', t, 'DELETE') then
      raise exception 'anon must have no access to %', t;
    end if;
    if has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE')
       or has_table_privilege('authenticated', t, 'DELETE') then
      raise exception 'authenticated must not write %', t;
    end if;
  end loop;
  foreach t in array array['public.portal_tokens','public.portal_sessions','public.portal_audit_log'] loop
    if has_any_column_privilege('authenticated', t, 'SELECT') then
      raise exception 'authenticated must not read %', t;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.portal_users', 'status', 'SELECT') then
    raise exception 'authenticated should read portal_users.status';
  end if;
  if not has_column_privilege('authenticated', 'public.portal_users', 'last_login_at', 'SELECT') then
    raise exception 'authenticated should read portal_users.last_login_at';
  end if;
  if has_column_privilege('authenticated', 'public.portal_users', 'email', 'SELECT') then
    raise exception 'authenticated must not read portal_users.email';
  end if;
  if has_column_privilege('authenticated', 'public.portal_users', 'terms_ip', 'SELECT') then
    raise exception 'authenticated must not read portal_users.terms_ip';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in ('portal_users','portal_tokens','portal_sessions','portal_audit_log')
                and not c.relrowsecurity) then
    raise exception 'RLS must be enabled on every portal table';
  end if;
end $$;

-- Function privileges.
do $$ begin
  if has_function_privilege('anon', 'public.get_portal_settings()', 'EXECUTE') then raise exception 'anon must not execute get_portal_settings'; end if;
  if has_function_privilege('anon', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then raise exception 'anon must not execute update_portal_settings'; end if;
  if not has_function_privilege('authenticated', 'public.get_portal_settings()', 'EXECUTE') then raise exception 'authenticated should execute get_portal_settings'; end if;
  if not has_function_privilege('authenticated', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then raise exception 'authenticated should execute update_portal_settings'; end if;
end $$;

-- Admin flow (role switches from here on).
do $$ declare r record; begin
  perform _t_act('f7100000-0000-0000-0000-000000000001');

  select * into r from public.update_portal_settings(true, null, null, false);
  if r.enabled is distinct from true then raise exception 'portal should be enabled'; end if;
  if r.terms_text is distinct from 'By using this portal you agree to share business referrals with Portal Settings Org and to only submit contact details you have permission to share. Portal Settings Org may contact the businesses you refer.' then
    raise exception 'default terms not seeded, got %', r.terms_text;
  end if;
  if r.consent_text is distinct from 'I have permission to share this business''s contact details.' then
    raise exception 'default consent not seeded, got %', r.consent_text;
  end if;
  if r.terms_version is distinct from 1 or r.consent_version is distinct from 1 then
    raise exception 'seeding should bump both versions to 1, got % %', r.terms_version, r.consent_version;
  end if;
  if r.slug is distinct from 'portal-set' or r.org_name is distinct from 'Portal Settings Org' then
    raise exception 'slug and org name should come back, got % %', r.slug, r.org_name;
  end if;

  select * into r from public.update_portal_settings(true, r.terms_text, r.consent_text, true);
  if r.terms_version is distinct from 1 or r.consent_version is distinct from 1 then
    raise exception 'saving unchanged text must not bump versions';
  end if;
  if r.value_visibility is distinct from true then raise exception 'value visibility should save'; end if;

  select * into r from public.update_portal_settings(true, '  New terms.  ', '', true);
  if r.terms_text is distinct from 'New terms.' or r.terms_version is distinct from 2 then
    raise exception 'changed terms should be trimmed and bump to 2, got % %', r.terms_text, r.terms_version;
  end if;
  if r.consent_version is distinct from 1 then raise exception 'blank consent must keep its text and version'; end if;

  select * into r from public.update_portal_settings(false, null, 'New consent.', false);
  if r.enabled is distinct from false or r.terms_text is distinct from 'New terms.' or r.terms_version is distinct from 2 then
    raise exception 'turning off must keep the terms';
  end if;
  if r.consent_text is distinct from 'New consent.' or r.consent_version is distinct from 2 then
    raise exception 'changed consent should bump to 2';
  end if;

  select * into r from public.get_portal_settings();
  if r.consent_text is distinct from 'New consent.' or r.enabled is distinct from false then
    raise exception 'get_portal_settings should read back the saved state';
  end if;
end $$;

-- Non-admins are refused.
do $$ begin
  perform _t_act('f7100000-0000-0000-0000-000000000002');
  perform _t_raises('select * from public.update_portal_settings(true, null, null, false)', 'not_authorized');
  perform _t_raises('select * from public.get_portal_settings()', 'not_authorized');
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `037_portal_schema_settings.sql FAIL` (column `portal_enabled` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261009000001_portal_access_schema.sql`:

```sql
-- 20261009000001_portal_access_schema.sql
--
-- Partner Portal Phase 1A (spec docs/superpowers/specs/2026-10-07-partner-portal-design.md,
-- sections 5.2 and 5.10). Partners sign in with the portal's own tokens and are
-- never Supabase Auth users (spec R2). This migration adds the tenant settings,
-- the portal identity table, one-time tokens, sessions and the audit trail.
--
-- Access model:
--   portal_tokens, portal_sessions, portal_audit_log: service role only (the
--     portal_api and portal_invite edge functions, through SECURITY DEFINER SQL).
--   portal_users: internal users who can see the partner read a few safe columns
--     (status and dates, never the email, IP or terms detail). Nobody writes it
--     directly; SECURITY DEFINER functions do (20261009000002..000004).

-- Tenant settings -------------------------------------------------------------
alter table organizations
  add column if not exists portal_enabled           boolean not null default false,
  add column if not exists partner_value_visibility boolean not null default false,
  add column if not exists partner_terms_text       text,
  add column if not exists partner_terms_version    integer not null default 0,
  add column if not exists consent_text             text,
  add column if not exists consent_version          integer not null default 0;

-- Types -------------------------------------------------------------------------
create type portal_user_status as enum ('invited','active','suspended','revoked');
create type portal_token_type  as enum ('invite','sign_in_code');
create type portal_audit_action as enum (
  'invite','code_request','sign_in','sign_out','terms_accept',
  'suspend','revoke','restore','submit','withdraw','view_referral'
);

-- Portal identities: one per partner, one per email inside an org --------------
create table portal_users (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  partner_id         uuid not null unique references partners(id) on delete cascade,
  email              text not null check (email = lower(btrim(email)) and email <> ''),
  status             portal_user_status not null default 'invited',
  invited_at         timestamptz,
  invited_by         uuid references profiles(id) on delete set null,
  activated_at       timestamptz,
  last_login_at      timestamptz,
  terms_accepted_at  timestamptz,
  terms_version      integer,
  terms_ip           text,
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index portal_users_org_email_uidx on portal_users (org_id, lower(email));

-- One-time secrets. Only the SHA-256 hash is stored. Invite hashes are unique;
-- sign-in code hashes are salted per user and may legitimately repeat over time.
create table portal_tokens (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  token_type     portal_token_type not null,
  token_hash     text not null,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  revoked_at     timestamptz,
  attempts       integer not null default 0,
  ip             text
);
create unique index portal_tokens_invite_hash_uidx on portal_tokens (token_hash) where token_type = 'invite';
create index portal_tokens_hash_idx on portal_tokens (token_hash);
create index portal_tokens_user_type_idx on portal_tokens (portal_user_id, token_type, issued_at);

create table portal_sessions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  ip             text,
  user_agent     text
);
create index portal_sessions_user_idx on portal_sessions (portal_user_id);

create table portal_audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  actor_user_id  uuid references profiles(id) on delete set null,
  action         portal_audit_action not null,
  referral_id    uuid references referrals(id) on delete set null,
  ip             text,
  created_at     timestamptz not null default now()
);
create index portal_audit_log_rate_idx on portal_audit_log (action, ip, created_at);
create index portal_audit_log_org_idx  on portal_audit_log (org_id, created_at);

-- Privileges + RLS --------------------------------------------------------------
alter table portal_users     enable row level security;
alter table portal_tokens    enable row level security;
alter table portal_sessions  enable row level security;
alter table portal_audit_log enable row level security;

-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on portal_users, portal_tokens, portal_sessions, portal_audit_log from anon;
revoke all on portal_users, portal_tokens, portal_sessions, portal_audit_log from authenticated;

grant select (id, org_id, partner_id, status, invited_at, activated_at, last_login_at)
  on portal_users to authenticated;

create policy portal_users_select on portal_users for select to authenticated using (
  org_id = public.user_org_id() and public.can_see_partner(partner_id)
);

-- Tenant settings RPCs (spec 5.10) ----------------------------------------------
create or replace function public.get_portal_settings()
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select o.portal_enabled, o.partner_terms_text, o.partner_terms_version, o.consent_text,
           o.consent_version, o.partner_value_visibility, o.slug, o.name
      from organizations o
     where o.id = public.user_org_id();
end $$;

create or replace function public.update_portal_settings(
  p_enabled          boolean,
  p_terms_text       text,
  p_consent_text     text,
  p_value_visibility boolean
)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org     organizations;
  v_enabled boolean := coalesce(p_enabled, false);
  v_terms   text := nullif(btrim(coalesce(p_terms_text, '')), '');
  v_consent text := nullif(btrim(coalesce(p_consent_text, '')), '');
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_org from organizations o where o.id = public.user_org_id() for update;
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Blank input keeps what is stored; texts can be replaced, not cleared.
  v_terms   := coalesce(v_terms, v_org.partner_terms_text);
  v_consent := coalesce(v_consent, v_org.consent_text);

  -- First switch-on seeds editable placeholders (attorney review pending, spec 10).
  if v_enabled and v_terms is null then
    v_terms := format(
      'By using this portal you agree to share business referrals with %s and to only submit contact details you have permission to share. %s may contact the businesses you refer.',
      v_org.name, v_org.name);
  end if;
  if v_enabled and v_consent is null then
    v_consent := 'I have permission to share this business''s contact details.';
  end if;

  update organizations o
     set portal_enabled           = v_enabled,
         partner_value_visibility = coalesce(p_value_visibility, false),
         partner_terms_text       = v_terms,
         partner_terms_version    = o.partner_terms_version
                                    + case when v_terms is distinct from v_org.partner_terms_text then 1 else 0 end,
         consent_text             = v_consent,
         consent_version          = o.consent_version
                                    + case when v_consent is distinct from v_org.consent_text then 1 else 0 end
   where o.id = v_org.id;

  return query select * from public.get_portal_settings();
end $$;

revoke execute on function public.get_portal_settings() from public, anon;
revoke execute on function public.update_portal_settings(boolean, text, text, boolean) from public, anon;
grant execute on function public.get_portal_settings() to authenticated;
grant execute on function public.update_portal_settings(boolean, text, text, boolean) to authenticated;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `037_portal_schema_settings.sql PASS` and every previously passing test still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000001_portal_access_schema.sql supabase/tests/037_portal_schema_settings.sql
git commit -m "$(cat <<'EOF'
feat(portal): portal tables, tenant portal settings, and admin settings RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Invite SQL (create, peek, accept) and private helpers

**Files:**
- Create: `supabase/migrations/20261009000002_portal_invites.sql`
- Test: `supabase/tests/038_portal_invites.sql`

**Interfaces:**
- Consumes (SQL): tables and types from Task 1; `public.profile_can_see_owner(p_viewer uuid, p_owner uuid) returns boolean` (Phase 0, service-only).
- Produces (SQL, private, executable by no API role):
  - `public._portal_hash(p_value text) returns text` (hex SHA-256 via `extensions.digest`).
  - `public._portal_new_token() returns text` (64 hex chars from `extensions.gen_random_bytes(32)`).
  - `public._portal_audit(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid) returns void`.
  - `public._portal_create_session(p_portal_user_id uuid, p_ip text, p_user_agent text) returns table (session_token text, session_expires_at timestamptz)` (30 days).
- Produces (SQL, service role only):
  - `public.portal_create_invite(p_partner_id uuid, p_actor uuid) returns table (invite_token text, invite_email text, partner_name text, org_name text, org_slug text)`. Errors (message tokens): `partner_not_found`, `not_authorized`, `portal_disabled`, `partner_email_required`, `portal_already_active`, `portal_email_in_use`.
  - `public.portal_peek_invite(p_slug text, p_token text) returns table (partner_name text, org_name text, terms_text text, terms_version integer)`; zero rows when the invite is not valid for that slug.
  - `public.portal_accept_invite(p_slug text, p_token text, p_terms_version integer, p_ip text, p_user_agent text) returns table (session_token text, session_expires_at timestamptz)`. Errors: `invalid_invite`, `terms_changed`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/038_portal_invites.sql`:

```sql
-- Tests for 20261009000002_portal_invites (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/038_portal_invites.sql
-- Self-cleans via ROLLBACK. Everything runs as postgres: these functions are
-- service-role only, so there is no role switch in this file.
--
-- Fixture:
--   org PI  (portal-inv, enabled, terms "Terms v3" version 3)
--     boss administrator; rep1 boss.rep1; rep2 boss.rep2
--     P1 Jane CPA (rep1, Jane@Example.com)   P2 Pat CPA (rep2, pat@example.com)
--     P3 No Email (rep1, no email)           P4 Jane Twin (rep2, same email as P1)
--   org PB  (portal-inv-b, enabled): oboss administrator
--   org PO  (portal-inv-off, portal OFF): cboss administrator, PC Cara CPA

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_terms_text, partner_terms_version) values
  ('00000000-0000-0000-0000-000000000f81', 'Portal Invite Org', 'portal-inv',     'portal-inv-a1', true,  'Terms v3',    3),
  ('00000000-0000-0000-0000-000000000f82', 'Other Portal Org',  'portal-inv-b',   'portal-inv-b1', true,  'Other terms', 1),
  ('00000000-0000-0000-0000-000000000f83', 'Portal Off Org',    'portal-inv-off', 'portal-inv-c1', false, null,          0);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f8100000-0000-0000-0000-000000000001', 'boss@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000002', 'rep1@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000003', 'rep2@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000004', 'oboss@pi.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000005', 'cboss@pi.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('f8100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f81', 'admin', 'administrator',      'Boss',  'boss@pi.example',  'boss'::ltree,      null),
  ('f8100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f81', 'rep',   'sales_professional', 'Rep1',  'rep1@pi.example',  'boss.rep1'::ltree, 'f8100000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f81', 'rep',   'sales_professional', 'Rep2',  'rep2@pi.example',  'boss.rep2'::ltree, 'f8100000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f82', 'admin', 'administrator',      'OBoss', 'oboss@pi.example', 'oboss'::ltree,     null),
  ('f8100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f83', 'admin', 'administrator',      'CBoss', 'cboss@pi.example', 'cboss'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('f81a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000002', 'Jane CPA',  'Jane & Co', 'cpa', 'Jane@Example.com'),
  ('f81a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000003', 'f8100000-0000-0000-0000-000000000003', 'Pat CPA',   'Pat & Co',  'cpa', 'pat@example.com'),
  ('f81a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000002', 'No Email',  'NE & Co',   'cpa', null),
  ('f81a0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000003', 'f8100000-0000-0000-0000-000000000003', 'Jane Twin', 'Twin & Co', 'cpa', ' JANE@example.com '),
  ('f81a0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f83', 'f8100000-0000-0000-0000-000000000005', 'f8100000-0000-0000-0000-000000000005', 'Cara CPA',  'Cara & Co', 'cpa', 'cara@example.com');

create temp table _t (k text primary key, v text) on commit drop;

create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

-- Privileges: portal functions are service-role only; helpers are executable by no API role.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_create_invite(uuid, uuid)',
    'public.portal_peek_invite(text, text)',
    'public.portal_accept_invite(text, text, integer, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
  foreach f in array array[
    'public._portal_hash(text)',
    'public._portal_new_token()',
    'public._portal_audit(uuid, uuid, public.portal_audit_action, text, uuid)',
    'public._portal_create_session(uuid, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'private helper % must not be executable by an API role', f;
    end if;
  end loop;
end $$;

-- rep1 invites P1: raw token comes back once; the email is lowercased.
do $$ declare r record; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000002');
  if r.invite_token is null or r.invite_token !~ '^[0-9a-f]{64}$' then raise exception 'invite token should be 64 hex chars, got %', r.invite_token; end if;
  if r.invite_email is distinct from 'jane@example.com' then raise exception 'email should be trimmed and lowercased, got %', r.invite_email; end if;
  if r.partner_name is distinct from 'Jane CPA' or r.org_name is distinct from 'Portal Invite Org' or r.org_slug is distinct from 'portal-inv' then
    raise exception 'invite metadata wrong: % % %', r.partner_name, r.org_name, r.org_slug;
  end if;
  insert into _t values ('tok1', r.invite_token);
end $$;

-- Only the hash is stored; the portal user is invited.
do $$ declare v_tok text := (select v from _t where k = 'tok1'); begin
  if exists (select 1 from portal_tokens t where t::text like '%' || v_tok || '%') then
    raise exception 'raw invite token must never be stored';
  end if;
  if not exists (select 1 from portal_tokens
                  where token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex')
                    and token_type = 'invite'
                    and expires_at > now() + interval '6 days 23 hours') then
    raise exception 'invite should be stored as its SHA-256 hash with a 7 day expiry';
  end if;
  if (select status::text from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000001') is distinct from 'invited' then
    raise exception 'portal user should be invited';
  end if;
  if not exists (select 1 from portal_audit_log where action = 'invite' and actor_user_id = 'f8100000-0000-0000-0000-000000000002') then
    raise exception 'invite should be audited with the inviting rep';
  end if;
end $$;

-- Refusals.
do $$ begin
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000003'')', 'not_authorized');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000004'')', 'not_authorized');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000003'', ''f8100000-0000-0000-0000-000000000002'')', 'partner_email_required');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000005'', ''f8100000-0000-0000-0000-000000000005'')', 'portal_disabled');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-0000000000ff'', ''f8100000-0000-0000-0000-000000000001'')', 'partner_not_found');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000004'', ''f8100000-0000-0000-0000-000000000003'')', 'portal_email_in_use');
end $$;

-- Peek: valid only for the right slug.
do $$ declare v_tok text := (select v from _t where k = 'tok1'); r record; n int; begin
  select * into r from public.portal_peek_invite('portal-inv', v_tok);
  if r.partner_name is distinct from 'Jane CPA' or r.org_name is distinct from 'Portal Invite Org'
     or r.terms_text is distinct from 'Terms v3' or r.terms_version is distinct from 3 then
    raise exception 'peek returned the wrong invite: %', row_to_json(r);
  end if;
  select count(*) into n from public.portal_peek_invite('portal-inv-b', v_tok);
  if n <> 0 then raise exception 'another org slug must not resolve this invite'; end if;
  select count(*) into n from public.portal_peek_invite('portal-inv', 'not-a-token');
  if n <> 0 then raise exception 'an unknown token must not resolve'; end if;
end $$;

-- Resend (the admin, who sees everything) invalidates the first invite.
do $$ declare r record; n int; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000001');
  insert into _t values ('tok2', r.invite_token);
  select count(*) into n from public.portal_peek_invite('portal-inv', (select v from _t where k = 'tok1'));
  if n <> 0 then raise exception 'resending must invalidate the earlier invite'; end if;
  select count(*) into n from public.portal_peek_invite('portal-inv', r.invite_token);
  if n <> 1 then raise exception 'the new invite should be valid'; end if;
end $$;

-- Accept refusals leave the invite usable.
do $$ declare v_tok text := (select v from _t where k = 'tok2'); n int; begin
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 2, %L, %L)', 'portal-inv', v_tok, '203.0.113.9', 'ua'), 'terms_changed');
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 1, null, null)', 'portal-inv-b', v_tok), 'invalid_invite');
  select count(*) into n from public.portal_peek_invite('portal-inv', v_tok);
  if n <> 1 then raise exception 'a refused accept must not consume the invite'; end if;
end $$;

-- Accept: active, terms recorded, session issued, invite consumed.
do $$ declare v_tok text := (select v from _t where k = 'tok2'); r record; u portal_users; n int; begin
  select * into r from public.portal_accept_invite('portal-inv', v_tok, 3, '203.0.113.9', 'Mozilla/5.0');
  if r.session_token is null or r.session_token !~ '^[0-9a-f]{64}$' then raise exception 'accept should return a 64 hex session token'; end if;
  if r.session_expires_at < now() + interval '29 days' then raise exception 'session should last 30 days'; end if;

  select * into u from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000001';
  if u.status::text is distinct from 'active' or u.activated_at is null or u.terms_accepted_at is null
     or u.terms_version is distinct from 3 or u.terms_ip is distinct from '203.0.113.9' then
    raise exception 'accept should activate and record terms, got %', row_to_json(u);
  end if;

  if exists (select 1 from portal_sessions s where s::text like '%' || r.session_token || '%') then
    raise exception 'raw session token must never be stored';
  end if;
  if not exists (select 1 from portal_sessions where token_hash = encode(extensions.digest(r.session_token, 'sha256'), 'hex')
                    and user_agent = 'Mozilla/5.0') then
    raise exception 'session should be stored as its hash with the user agent';
  end if;

  select count(*) into n from portal_audit_log where portal_user_id = u.id and action in ('terms_accept', 'sign_in');
  if n <> 2 then raise exception 'accept should audit terms_accept and sign_in, got % rows', n; end if;

  select count(*) into n from public.portal_peek_invite('portal-inv', v_tok);
  if n <> 0 then raise exception 'an accepted invite must be consumed'; end if;
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 3, null, null)', 'portal-inv', v_tok), 'invalid_invite');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000002'')', 'portal_already_active');
end $$;

-- Expired invites are rejected; a revoked user can be invited again.
do $$ declare r record; n int; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000003');
  update portal_tokens set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(r.invite_token, 'sha256'), 'hex');
  select count(*) into n from public.portal_peek_invite('portal-inv', r.invite_token);
  if n <> 0 then raise exception 'an expired invite must not resolve'; end if;
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 3, null, null)', 'portal-inv', r.invite_token), 'invalid_invite');

  update portal_users set status = 'revoked' where partner_id = 'f81a0000-0000-0000-0000-000000000002';
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000003');
  if (select status::text from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000002') is distinct from 'invited' then
    raise exception 'inviting a revoked partner should move them back to invited';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `038_portal_invites.sql FAIL` (function `public.portal_create_invite(uuid, uuid)` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261009000002_portal_invites.sql`:

```sql
-- 20261009000002_portal_invites.sql
--
-- Partner Portal Phase 1A (spec 5.3): invite, peek, accept. Called only by the
-- portal_invite and portal_api edge functions with the service role. Raw secrets
-- are returned once and never stored; only their SHA-256 hashes are.
--
-- pgcrypto lives in the extensions schema. Always call extensions.digest and
-- extensions.gen_random_bytes by their qualified names.

-- Private helpers ---------------------------------------------------------------
create or replace function public._portal_hash(p_value text)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_value, ''), 'sha256'), 'hex')
$$;

create or replace function public._portal_new_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select encode(extensions.gen_random_bytes(32), 'hex')
$$;

create or replace function public._portal_audit(
  p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid
) returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_audit_log (org_id, portal_user_id, action, ip, actor_user_id)
  values (p_org, p_portal_user, p_action, nullif(btrim(coalesce(p_ip, '')), ''), p_actor)
$$;

create or replace function public._portal_create_session(p_portal_user_id uuid, p_ip text, p_user_agent text)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_token   text := public._portal_new_token();
  v_expires timestamptz := now() + interval '30 days';
begin
  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at, ip, user_agent)
  select u.org_id, u.id, public._portal_hash(v_token), v_expires,
         nullif(btrim(coalesce(p_ip, '')), ''), left(p_user_agent, 512)
    from portal_users u
   where u.id = p_portal_user_id;
  return query select v_token, v_expires;
end $$;

-- Invite (spec 5.3, brief D4) ---------------------------------------------------
-- p_actor is the internal user the edge function verified with auth.getUser().
-- Visibility is re-checked here with an explicit viewer, because the service
-- role has no auth.uid().
create or replace function public.portal_create_invite(p_partner_id uuid, p_actor uuid)
returns table (invite_token text, invite_email text, partner_name text, org_name text, org_slug text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_partner   partners;
  v_org       organizations;
  v_actor_org uuid;
  v_email     text;
  v_user_id   uuid;
  v_status    portal_user_status;
  v_token     text := public._portal_new_token();
begin
  select * into v_partner from partners p where p.id = p_partner_id;
  if v_partner.id is null then
    raise exception 'partner_not_found' using errcode = 'P0002';
  end if;

  select pr.org_id into v_actor_org from profiles pr where pr.id = p_actor and pr.deactivated_at is null;
  if v_actor_org is null or v_actor_org <> v_partner.org_id
     or not public.profile_can_see_owner(p_actor, v_partner.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_org from organizations o where o.id = v_partner.org_id;
  if not v_org.portal_enabled or v_org.is_disabled then
    raise exception 'portal_disabled' using errcode = '55000';
  end if;

  v_email := lower(btrim(coalesce(v_partner.email, '')));
  if v_email = '' then
    raise exception 'partner_email_required' using errcode = '22023';
  end if;

  select u.id, u.status into v_user_id, v_status from portal_users u where u.partner_id = p_partner_id for update;
  if v_status = 'active' then
    raise exception 'portal_already_active' using errcode = '55000';
  end if;

  begin
    if v_user_id is null then
      insert into portal_users (org_id, partner_id, email, status, invited_at, invited_by)
      values (v_partner.org_id, p_partner_id, v_email, 'invited', now(), p_actor)
      returning id into v_user_id;
    else
      update portal_users
         set email = v_email, status = 'invited', invited_at = now(), invited_by = p_actor, updated_at = now()
       where id = v_user_id;
    end if;
  exception when unique_violation then
    raise exception 'portal_email_in_use' using errcode = '23505';
  end;

  -- Resend invalidates every earlier invite for this partner.
  update portal_tokens t
     set revoked_at = now()
   where t.portal_user_id = v_user_id and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null;

  insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at)
  values (v_partner.org_id, v_user_id, 'invite', public._portal_hash(v_token), now() + interval '7 days');

  perform public._portal_audit(v_partner.org_id, v_user_id, 'invite', null, p_actor);

  return query select v_token, v_email, v_partner.name, v_org.name, v_org.slug;
end $$;

-- Peek: what the invite page shows before the partner accepts ------------------
create or replace function public.portal_peek_invite(p_slug text, p_token text)
returns table (partner_name text, org_name text, terms_text text, terms_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select p.name, o.name, o.partner_terms_text, o.partner_terms_version
    from portal_tokens t
    join portal_users u  on u.id = t.portal_user_id
    join partners p      on p.id = u.partner_id
    join organizations o on o.id = t.org_id
   where t.token_hash = public._portal_hash(p_token)
     and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
     and u.status = 'invited'
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- Accept: consume the invite, record the terms, activate, open a session -------
create or replace function public.portal_accept_invite(
  p_slug text, p_token text, p_terms_version integer, p_ip text, p_user_agent text
)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_token_id      uuid;
  v_user_id       uuid;
  v_org_id        uuid;
  v_terms_version integer;
begin
  select t.id, u.id, o.id, o.partner_terms_version
    into v_token_id, v_user_id, v_org_id, v_terms_version
    from portal_tokens t
    join portal_users u  on u.id = t.portal_user_id
    join organizations o on o.id = t.org_id
   where t.token_hash = public._portal_hash(p_token)
     and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
     and u.status = 'invited'
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
     for update of t, u;
  if v_token_id is null then
    raise exception 'invalid_invite' using errcode = 'P0002';
  end if;
  if p_terms_version is distinct from v_terms_version then
    raise exception 'terms_changed' using errcode = 'P0001';
  end if;

  update portal_tokens set consumed_at = now() where id = v_token_id;
  update portal_users
     set status            = 'active',
         activated_at      = coalesce(activated_at, now()),
         last_login_at     = now(),
         terms_accepted_at = now(),
         terms_version     = p_terms_version,
         terms_ip          = nullif(btrim(coalesce(p_ip, '')), ''),
         updated_at        = now()
   where id = v_user_id;

  perform public._portal_audit(v_org_id, v_user_id, 'terms_accept', p_ip, null);
  perform public._portal_audit(v_org_id, v_user_id, 'sign_in', p_ip, null);

  return query select * from public._portal_create_session(v_user_id, p_ip, p_user_agent);
end $$;

-- Privileges --------------------------------------------------------------------
revoke execute on function public._portal_hash(text)                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_new_token()                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_audit(uuid, uuid, portal_audit_action, text, uuid)   from public, anon, authenticated, service_role;
revoke execute on function public._portal_create_session(uuid, text, text)                     from public, anon, authenticated, service_role;

revoke execute on function public.portal_create_invite(uuid, uuid)                             from public, anon, authenticated;
revoke execute on function public.portal_peek_invite(text, text)                               from public, anon, authenticated;
revoke execute on function public.portal_accept_invite(text, text, integer, text, text)        from public, anon, authenticated;
grant  execute on function public.portal_create_invite(uuid, uuid)                             to service_role;
grant  execute on function public.portal_peek_invite(text, text)                               to service_role;
grant  execute on function public.portal_accept_invite(text, text, integer, text, text)        to service_role;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `037_portal_schema_settings.sql PASS`, `038_portal_invites.sql PASS`, and every previously passing test still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000002_portal_invites.sql supabase/tests/038_portal_invites.sql
git commit -m "$(cat <<'EOF'
feat(portal): hashed single-use invites with terms acceptance and sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Code sign-in, sessions, sign-out, branding SQL

**Files:**
- Create: `supabase/migrations/20261009000003_portal_sign_in.sql`
- Test: `supabase/tests/039_portal_sign_in.sql`

**Interfaces:**
- Consumes (SQL): Task 1 tables; Task 2 helpers `_portal_hash`, `_portal_audit`, `_portal_create_session`.
- Produces (SQL, service role only):
  - `public.portal_brand(p_slug text) returns table (org_name text, product_name text, primary_color text, logo_url text, dark_logo_url text)`; zero rows unless the portal is enabled and the org is not disabled.
  - `public.portal_issue_code(p_slug text, p_email text, p_ip text) returns table (code text, recipient text, org_name text, org_slug text)`; zero rows when no code should be sent (unknown email, not `active`, rate limited, portal off). Limits: 5 codes per user per hour, 20 requests per IP per hour (counted from `code_request` audit rows, known and unknown emails alike). Code: 6 digits, 15 minutes, stored as `_portal_hash(code || ':' || portal_user_id)`.
  - `public.portal_verify_code(p_slug text, p_email text, p_code text, p_ip text, p_user_agent text) returns table (session_token text, session_expires_at timestamptz)`; zero rows on any failure (never raises, so the attempt counter is not rolled back). Max 5 attempts per code; a success consumes the code and revokes the user's other live codes.
  - `public.portal_session_lookup(p_slug text, p_token text) returns table (portal_user_id uuid, org_id uuid, partner_id uuid, partner_name text, user_email text, org_name text, org_slug text)`; zero rows unless the session is live, the user is `active`, the session's org matches the slug, and the portal is on.
  - `public.portal_sign_out(p_token text) returns void`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/039_portal_sign_in.sql`:

```sql
-- Tests for 20261009000003_portal_sign_in (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/039_portal_sign_in.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture:
--   org S1 portal-sign (enabled, branded):
--     U1 Jane CPA   jane@example.com   active
--     U2 Sam CPA    sam@example.com    suspended
--     U3 Rate CPA   rate@example.com   active   (per-user rate limit)
--     U4 New CPA    new@example.com    invited
--     U5 Cap CPA    ipcap@example.com  active   (per-IP rate limit)
--   org S2 portal-sign-b (enabled): UB jane@example.com active (same email, other tenant)
--   org S3 portal-sign-off (portal OFF): UC off@example.com active

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000000f91', 'Portal Sign Org', 'portal-sign',     'portal-sign-a1', true),
  ('00000000-0000-0000-0000-000000000f92', 'Portal Sign B',   'portal-sign-b',   'portal-sign-b1', true),
  ('00000000-0000-0000-0000-000000000f93', 'Portal Sign Off', 'portal-sign-off', 'portal-sign-c1', false);

insert into org_branding (org_id, product_name, primary_color, logo_url) values
  ('00000000-0000-0000-0000-000000000f91', 'Acme Portal', '#0f766e', 'https://cdn.example/logo.png');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f9100000-0000-0000-0000-000000000001', 'a@ps1.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f9100000-0000-0000-0000-000000000002', 'b@ps1.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f9100000-0000-0000-0000-000000000003', 'c@ps1.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('f9100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'admin', 'administrator', 'A', 'a@ps1.example', 'sa'::ltree),
  ('f9100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f92', 'admin', 'administrator', 'B', 'b@ps1.example', 'sb'::ltree),
  ('f9100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f93', 'admin', 'administrator', 'C', 'c@ps1.example', 'sc'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('f91a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Jane CPA', 'J & Co', 'cpa', 'jane@example.com'),
  ('f91a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Sam CPA',  'S & Co', 'cpa', 'sam@example.com'),
  ('f91a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Rate CPA', 'R & Co', 'cpa', 'rate@example.com'),
  ('f91a0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'New CPA',  'N & Co', 'cpa', 'new@example.com'),
  ('f91a0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Cap CPA',  'C & Co', 'cpa', 'ipcap@example.com'),
  ('f91a0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000f92', 'f9100000-0000-0000-0000-000000000002', 'f9100000-0000-0000-0000-000000000002', 'Jane B',   'JB & Co', 'cpa', 'jane@example.com'),
  ('f91a0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000f93', 'f9100000-0000-0000-0000-000000000003', 'f9100000-0000-0000-0000-000000000003', 'Off CPA',  'O & Co', 'cpa', 'off@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('f91b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000001', 'jane@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000002', 'sam@example.com',   'suspended'),
  ('f91b0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000003', 'rate@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000004', 'new@example.com',   'invited'),
  ('f91b0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000005', 'ipcap@example.com', 'active'),
  ('f91b0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000f92', 'f91a0000-0000-0000-0000-000000000006', 'jane@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000f93', 'f91a0000-0000-0000-0000-000000000007', 'off@example.com',   'active');

create temp table _t (k text primary key, v text) on commit drop;

-- Privileges.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_brand(text)',
    'public.portal_issue_code(text, text, text)',
    'public.portal_verify_code(text, text, text, text, text)',
    'public.portal_session_lookup(text, text)',
    'public.portal_sign_out(text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Branding before sign-in.
do $$ declare r record; n int; begin
  select * into r from public.portal_brand(' Portal-Sign ');
  if r.org_name is distinct from 'Portal Sign Org' or r.product_name is distinct from 'Acme Portal'
     or r.primary_color is distinct from '#0f766e' or r.logo_url is distinct from 'https://cdn.example/logo.png' then
    raise exception 'brand for portal-sign is wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_brand('portal-sign-b');
  if r.product_name is distinct from 'navigatr' or r.primary_color is not null then
    raise exception 'an org without a branding row gets the defaults';
  end if;
  select count(*) into n from public.portal_brand('portal-sign-off');
  if n <> 0 then raise exception 'a disabled portal must not expose branding'; end if;
  select count(*) into n from public.portal_brand('no-such-portal');
  if n <> 0 then raise exception 'an unknown slug must return nothing'; end if;
end $$;

-- Issue a code: 6 digits, hashed with the user id, 15 minutes, IP recorded.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-sign', ' Jane@Example.com ', '10.0.0.1');
  if r.code is null or r.code !~ '^[0-9]{6}$' then raise exception 'expected a 6-digit code, got %', r.code; end if;
  if r.recipient is distinct from 'jane@example.com' or r.org_name is distinct from 'Portal Sign Org'
     or r.org_slug is distinct from 'portal-sign' then
    raise exception 'issue metadata wrong: %', row_to_json(r);
  end if;
  if not exists (
    select 1 from portal_tokens t
     where t.portal_user_id = 'f91b0000-0000-0000-0000-000000000001'
       and t.token_type = 'sign_in_code'
       and t.token_hash = encode(extensions.digest(r.code || ':' || 'f91b0000-0000-0000-0000-000000000001', 'sha256'), 'hex')
       and t.expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
       and t.ip = '10.0.0.1') then
    raise exception 'code should be stored hashed with the user id salt, a 15 minute expiry and the IP';
  end if;
  if exists (select 1 from portal_tokens t where t.token_hash = r.code) then
    raise exception 'raw code must never be stored';
  end if;
  insert into _t values ('code1', r.code);
end $$;

-- No code for unknown, suspended, invited, or a disabled portal.
do $$ declare n int; begin
  select count(*) into n from public.portal_issue_code('portal-sign', 'nobody@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'unknown email must get no code'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'sam@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'suspended user must get no code'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'new@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'invited user must use the invite link first'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign-off', 'off@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'disabled portal must issue no code'; end if;
  if exists (select 1 from portal_tokens where portal_user_id in (
      'f91b0000-0000-0000-0000-000000000002', 'f91b0000-0000-0000-0000-000000000004', 'f91b0000-0000-0000-0000-000000000007')) then
    raise exception 'no token may be issued for those users';
  end if;
end $$;

-- Verify: other tenant, wrong code, right code, reuse.
do $$ declare v_code text := (select v from _t where k = 'code1'); v_wrong text; r record; n int; begin
  v_wrong := case when v_code = '000000' then '000001' else '000000' end;

  select count(*) into n from public.portal_verify_code('portal-sign-b', 'jane@example.com', v_code, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a code from one tenant must not sign in to another'; end if;

  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', v_wrong, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a wrong code must not sign in'; end if;
  if (select attempts from portal_tokens
       where portal_user_id = 'f91b0000-0000-0000-0000-000000000001' and consumed_at is null) is distinct from 1 then
    raise exception 'a wrong guess should count one attempt';
  end if;

  select * into r from public.portal_verify_code('portal-sign', 'JANE@example.com', v_code, '10.0.0.1', 'Mozilla/5.0');
  if r.session_token is null or r.session_token !~ '^[0-9a-f]{64}$' then raise exception 'right code should return a session'; end if;
  if r.session_expires_at < now() + interval '29 days' then raise exception 'session should last 30 days'; end if;
  if exists (select 1 from portal_sessions s where s.token_hash = r.session_token) then
    raise exception 'raw session token must never be stored';
  end if;
  if (select last_login_at from portal_users where id = 'f91b0000-0000-0000-0000-000000000001') is null then
    raise exception 'sign-in should stamp last_login_at';
  end if;

  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', v_code, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a code works only once'; end if;
  insert into _t values ('sess1', r.session_token);
end $$;

-- Session lookup is scoped to the session's own tenant.
do $$ declare v text := (select v from _t where k = 'sess1'); r record; n int; begin
  select * into r from public.portal_session_lookup('portal-sign', v);
  if r.partner_id is distinct from 'f91a0000-0000-0000-0000-000000000001' or r.user_email is distinct from 'jane@example.com'
     or r.partner_name is distinct from 'Jane CPA' or r.org_slug is distinct from 'portal-sign' then
    raise exception 'lookup returned the wrong identity: %', row_to_json(r);
  end if;
  select count(*) into n from public.portal_session_lookup('portal-sign-b', v);
  if n <> 0 then raise exception 'a session must not open another tenant''s portal'; end if;
end $$;

-- Five wrong guesses kill a code.
do $$ declare r record; v_wrong text; n int; i int; begin
  select * into r from public.portal_issue_code('portal-sign', 'jane@example.com', '10.0.0.2');
  v_wrong := case when r.code = '000000' then '000001' else '000000' end;
  for i in 1..5 loop
    perform public.portal_verify_code('portal-sign', 'jane@example.com', v_wrong, '10.0.0.2', 'ua');
  end loop;
  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', r.code, '10.0.0.2', 'ua');
  if n <> 0 then raise exception 'a code must be dead after 5 wrong attempts'; end if;
end $$;

-- Expired codes are rejected.
do $$ declare r record; n int; begin
  select * into r from public.portal_issue_code('portal-sign', 'jane@example.com', '10.0.0.3');
  update portal_tokens set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(r.code || ':' || 'f91b0000-0000-0000-0000-000000000001', 'sha256'), 'hex');
  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', r.code, '10.0.0.3', 'ua');
  if n <> 0 then raise exception 'an expired code must be rejected'; end if;
end $$;

-- Per-user limit: 5 codes an hour.
do $$ declare i int; n int; begin
  for i in 1..5 loop
    select count(*) into n from public.portal_issue_code('portal-sign', 'rate@example.com', '10.0.1.' || i);
    if n <> 1 then raise exception 'code % of 5 should be issued', i; end if;
  end loop;
  select count(*) into n from public.portal_issue_code('portal-sign', 'rate@example.com', '10.0.1.6');
  if n <> 0 then raise exception 'the sixth code in an hour must be refused'; end if;
end $$;

-- Per-IP limit: 20 requests an hour, known or unknown emails alike.
do $$ declare i int; n int; begin
  for i in 1..20 loop
    perform public.portal_issue_code('portal-sign', 'nobody' || i || '@example.com', '9.9.9.9');
  end loop;
  select count(*) into n from public.portal_issue_code('portal-sign', 'ipcap@example.com', '9.9.9.9');
  if n <> 0 then raise exception 'the 21st request from one IP in an hour must be refused'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'ipcap@example.com', '9.9.9.10');
  if n <> 1 then raise exception 'a different IP must not be affected'; end if;
end $$;

-- Sign-out, expiry, revoke and portal-off all end a session on the next lookup.
do $$ declare v text := (select v from _t where k = 'sess1'); n int; begin
  perform public.portal_sign_out(v);
  select count(*) into n from public.portal_session_lookup('portal-sign', v);
  if n <> 0 then raise exception 'a signed-out session must be rejected'; end if;
  if not exists (select 1 from portal_audit_log
                  where portal_user_id = 'f91b0000-0000-0000-0000-000000000001' and action = 'sign_out') then
    raise exception 'sign-out should be audited';
  end if;

  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
    ('00000000-0000-0000-0000-000000000f91', 'f91b0000-0000-0000-0000-000000000001', encode(extensions.digest('sess-expired', 'sha256'), 'hex'), now() - interval '1 minute'),
    ('00000000-0000-0000-0000-000000000f91', 'f91b0000-0000-0000-0000-000000000001', encode(extensions.digest('sess-live', 'sha256'), 'hex'),    now() + interval '1 day');
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-expired');
  if n <> 0 then raise exception 'an expired session must be rejected'; end if;
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 1 then raise exception 'a live session should resolve'; end if;

  update portal_users set status = 'revoked' where id = 'f91b0000-0000-0000-0000-000000000001';
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 0 then raise exception 'a revoked user''s session must be rejected on the next lookup'; end if;

  update portal_users set status = 'active' where id = 'f91b0000-0000-0000-0000-000000000001';
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000000f91';
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 0 then raise exception 'turning the portal off must reject every session'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `039_portal_sign_in.sql FAIL` (function `public.portal_brand(text)` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261009000003_portal_sign_in.sql`:

```sql
-- 20261009000003_portal_sign_in.sql
--
-- Partner Portal Phase 1A (spec 5.3, 5.4, R1): branding before sign-in, 6-digit
-- email codes, session lookup and sign-out. Service role only (portal_api).
--
-- The issue and verify functions never raise for an expected failure. They
-- return zero rows instead, so portal_api can answer generically
-- (NFR-PORT-04) and so a wrong guess's attempt counter is committed rather than
-- rolled back with an exception.

-- Branding before sign-in (spec 5.4) --------------------------------------------
create or replace function public.portal_brand(p_slug text)
returns table (org_name text, product_name text, primary_color text, logo_url text, dark_logo_url text)
language sql stable security definer set search_path = public, extensions as $$
  select o.name, coalesce(b.product_name, 'navigatr'), b.primary_color, b.logo_url, b.dark_logo_url
    from organizations o
    left join org_branding b on b.org_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- Issue a sign-in code ----------------------------------------------------------
create or replace function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org   organizations;
  v_user  portal_users;
  v_ip    text := coalesce(nullif(btrim(coalesce(p_ip, '')), ''), 'unknown');
  v_bytes bytea;
  v_code  text;
begin
  select * into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org.id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org.id and lower(u.email) = lower(btrim(coalesce(p_email, '')));

  -- Every request counts toward the per-IP limit, whether or not the email exists.
  perform public._portal_audit(v_org.id, v_user.id, 'code_request', v_ip, null);
  if (select count(*) from portal_audit_log a
       where a.action = 'code_request' and a.ip = v_ip
         and a.created_at > now() - interval '1 hour') > 20 then
    return;
  end if;

  if v_user.id is null or v_user.status <> 'active' then
    return;
  end if;
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '1 hour') >= 5 then
    return;
  end if;

  -- Parenthesized: in Postgres << and | share one precedence level.
  v_bytes := extensions.gen_random_bytes(3);
  v_code  := lpad(
    (((get_byte(v_bytes, 0) << 16) | (get_byte(v_bytes, 1) << 8) | get_byte(v_bytes, 2)) % 1000000)::text,
    6, '0');

  insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at, ip)
  values (v_org.id, v_user.id, 'sign_in_code', public._portal_hash(v_code || ':' || v_user.id::text),
          now() + interval '15 minutes', v_ip);

  return query select v_code, v_user.email, v_org.name, v_org.slug;
end $$;

-- Verify a code and open a session -----------------------------------------------
create or replace function public.portal_verify_code(
  p_slug text, p_email text, p_code text, p_ip text, p_user_agent text
)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org_id uuid;
  v_user   portal_users;
  v_hash   text;
  v_hit    uuid;
begin
  select o.id into v_org_id from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org_id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org_id and lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.status = 'active';
  if v_user.id is null then
    return;
  end if;

  -- Lock this user's live codes so parallel guesses cannot slip past the cap.
  perform 1 from portal_tokens t
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5
     for update;

  v_hash := public._portal_hash(btrim(coalesce(p_code, '')) || ':' || v_user.id::text);
  select t.id into v_hit from portal_tokens t
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5
     and t.token_hash = v_hash
   limit 1;

  if v_hit is null then
    update portal_tokens t
       set attempts = t.attempts + 1
     where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
       and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5;
    return;
  end if;

  update portal_tokens set consumed_at = now() where id = v_hit;
  update portal_tokens t
     set revoked_at = now()
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null;
  update portal_users set last_login_at = now(), updated_at = now() where id = v_user.id;
  perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in', p_ip, null);

  return query select * from public._portal_create_session(v_user.id, p_ip, p_user_agent);
end $$;

-- Who is this session? (every signed-in portal_api action calls this first) ------
create or replace function public.portal_session_lookup(p_slug text, p_token text)
returns table (
  portal_user_id uuid, org_id uuid, partner_id uuid, partner_name text,
  user_email text, org_name text, org_slug text
)
language sql stable security definer set search_path = public, extensions as $$
  select u.id, u.org_id, u.partner_id, p.name, u.email, o.name, o.slug
    from portal_sessions s
    join portal_users u  on u.id = s.portal_user_id
    join partners p      on p.id = u.partner_id
    join organizations o on o.id = s.org_id
   where s.token_hash = public._portal_hash(p_token)
     and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and u.org_id = s.org_id
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

create or replace function public.portal_sign_out(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  update portal_sessions s
     set revoked_at = now()
   where s.token_hash = public._portal_hash(p_token) and s.revoked_at is null
  returning s.portal_user_id, s.org_id into v_user, v_org;
  if v_user is not null then
    perform public._portal_audit(v_org, v_user, 'sign_out', null, null);
  end if;
end $$;

-- Privileges --------------------------------------------------------------------
revoke execute on function public.portal_brand(text)                                   from public, anon, authenticated;
revoke execute on function public.portal_issue_code(text, text, text)                  from public, anon, authenticated;
revoke execute on function public.portal_verify_code(text, text, text, text, text)     from public, anon, authenticated;
revoke execute on function public.portal_session_lookup(text, text)                    from public, anon, authenticated;
revoke execute on function public.portal_sign_out(text)                                from public, anon, authenticated;
grant  execute on function public.portal_brand(text)                                   to service_role;
grant  execute on function public.portal_issue_code(text, text, text)                  to service_role;
grant  execute on function public.portal_verify_code(text, text, text, text, text)     to service_role;
grant  execute on function public.portal_session_lookup(text, text)                    to service_role;
grant  execute on function public.portal_sign_out(text)                                to service_role;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `037` to `039` PASS and every previously passing test still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000003_portal_sign_in.sql supabase/tests/039_portal_sign_in.sql
git commit -m "$(cat <<'EOF'
feat(portal): 6-digit email code sign-in, rate limits, sessions, branding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Internal access control SQL (status, suspend, revoke, restore)

**Files:**
- Create: `supabase/migrations/20261009000004_portal_internal_access.sql`
- Test: `supabase/tests/040_portal_internal_access.sql`

**Interfaces:**
- Consumes (SQL): Task 1 tables and the `portal_users_select` policy; Task 2 `_portal_audit`; Task 3 `portal_session_lookup` (test only).
- Produces (SQL, `authenticated`):
  - `public.get_portal_status() returns table (enabled boolean, slug text)`: any org member; `enabled` is `portal_enabled and not is_disabled`.
  - `public.portal_set_access(p_partner_id uuid, p_status text) returns text`: `p_status` in `('suspended','revoked','invited')`. Requires `can_see_partner`. Suspend or revoke stamps `revoked_at` on every live session and every unconsumed token, and audits `suspend` / `revoke` with the acting user. `'invited'` restores a suspended or revoked partner (audit `restore`); the rep then sends a fresh invite. Errors: `not_authorized`, `partner_not_visible`, `invalid_status`, `portal_user_not_found`, `portal_not_restorable`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/040_portal_internal_access.sql`:

```sql
-- Tests for 20261009000004_portal_internal_access (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/040_portal_internal_access.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org IA, slug portal-ia, portal on):
--   boss administrator; mgr sales_manager boss.mgr;
--   rep1 boss.mgr.rep1 owns P1; rep2 boss.mgr.rep2 owns P2
--   U1 (P1) active with a live session "ia-sess-1" and an unused sign-in code
--   U2 (P2) invited with an unused invite
-- Org IX (portal-ia-x): ox administrator, PX, UX active.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000000fa1', 'Portal Access Org', 'portal-ia',   'portal-ia-a1', true),
  ('00000000-0000-0000-0000-000000000fa2', 'Portal Access X',   'portal-ia-x', 'portal-ia-b1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('fa100000-0000-0000-0000-000000000001', 'boss@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000002', 'mgr@ia.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000003', 'rep1@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000004', 'rep2@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000005', 'ox@ia.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('fa100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'admin',   'administrator',      'Boss', 'boss@ia.example', 'boss'::ltree,          null),
  ('fa100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'manager', 'sales_manager',      'Mgr',  'mgr@ia.example',  'boss.mgr'::ltree,      'fa100000-0000-0000-0000-000000000001'),
  ('fa100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa1', 'rep',     'sales_professional', 'Rep1', 'rep1@ia.example', 'boss.mgr.rep1'::ltree, 'fa100000-0000-0000-0000-000000000002'),
  ('fa100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000fa1', 'rep',     'sales_professional', 'Rep2', 'rep2@ia.example', 'boss.mgr.rep2'::ltree, 'fa100000-0000-0000-0000-000000000002'),
  ('fa100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000fa2', 'admin',   'administrator',      'OX',   'ox@ia.example',   'ox'::ltree,            null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('fa1a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'fa100000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000003', 'Jane CPA', 'J & Co', 'cpa', 'jane@example.com'),
  ('fa1a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'fa100000-0000-0000-0000-000000000004', 'fa100000-0000-0000-0000-000000000004', 'Pat CPA',  'P & Co', 'cpa', 'pat@example.com'),
  ('fa1a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa2', 'fa100000-0000-0000-0000-000000000005', 'fa100000-0000-0000-0000-000000000005', 'X CPA',    'X & Co', 'cpa', 'x@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('fa1b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'fa1a0000-0000-0000-0000-000000000001', 'jane@example.com', 'active'),
  ('fa1b0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'fa1a0000-0000-0000-0000-000000000002', 'pat@example.com',  'invited'),
  ('fa1b0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa2', 'fa1a0000-0000-0000-0000-000000000003', 'x@example.com',    'active');

insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', encode(extensions.digest('ia-sess-1', 'sha256'), 'hex'), now() + interval '1 day');

insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at) values
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', 'sign_in_code', encode(extensions.digest('123456:x', 'sha256'), 'hex'), now() + interval '10 minutes'),
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000002', 'invite',       encode(extensions.digest('ia-invite-2', 'sha256'), 'hex'), now() + interval '6 days');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

create or replace function _t_portal_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(id) into n from portal_users;
  return n;
end $$;

-- Privileges (before any role switch).
do $$ begin
  if has_function_privilege('anon', 'public.portal_set_access(uuid, text)', 'EXECUTE') then raise exception 'anon must not execute portal_set_access'; end if;
  if not has_function_privilege('authenticated', 'public.portal_set_access(uuid, text)', 'EXECUTE') then raise exception 'authenticated should execute portal_set_access'; end if;
  if has_function_privilege('anon', 'public.get_portal_status()', 'EXECUTE') then raise exception 'anon must not execute get_portal_status'; end if;
  if not has_function_privilege('authenticated', 'public.get_portal_status()', 'EXECUTE') then raise exception 'authenticated should execute get_portal_status'; end if;
end $$;

-- portal_users visibility follows the partner (role switches from here on).
do $$ begin
  if _t_portal_rows('fa100000-0000-0000-0000-000000000003') <> 1 then raise exception 'rep1 should see only P1''s portal user'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000004') <> 1 then raise exception 'rep2 should see only P2''s portal user'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000002') <> 2 then raise exception 'mgr should see both'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000001') <> 2 then raise exception 'admin should see both in their org'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000005') <> 1 then raise exception 'another org sees only its own'; end if;
end $$;

-- rep1: status, refusals, suspend.
do $$ declare r record; begin
  perform _t_act('fa100000-0000-0000-0000-000000000003');
  select * into r from public.get_portal_status();
  if r.enabled is distinct from true or r.slug is distinct from 'portal-ia' then
    raise exception 'get_portal_status should report the org portal, got %', row_to_json(r);
  end if;
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000002'', ''suspended'')', 'partner_not_visible');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000003'', ''suspended'')', 'partner_not_visible');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000001'', ''active'')', 'invalid_status');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000001'', ''invited'')', 'portal_not_restorable');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'suspended') is distinct from 'suspended' then
    raise exception 'suspend should return suspended';
  end if;
end $$;

-- Suspension ends the session on the next lookup and kills unused codes.
do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-1');
  if n <> 0 then raise exception 'a suspended partner''s session must be rejected on the next lookup'; end if;
  if exists (select 1 from portal_sessions where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and revoked_at is null) then
    raise exception 'suspend should stamp revoked_at on every session';
  end if;
  if exists (select 1 from portal_tokens where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and consumed_at is null and revoked_at is null) then
    raise exception 'suspend should revoke every unused token';
  end if;
  if not exists (select 1 from portal_audit_log where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001'
                    and action = 'suspend' and actor_user_id = 'fa100000-0000-0000-0000-000000000003') then
    raise exception 'suspend should be audited with the acting rep';
  end if;
end $$;

-- Restore moves the partner back to invited.
do $$ begin
  perform _t_act('fa100000-0000-0000-0000-000000000003');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'invited') is distinct from 'invited' then
    raise exception 'restore should return invited';
  end if;
end $$;

do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  if (select status::text from portal_users where id = 'fa1b0000-0000-0000-0000-000000000001') is distinct from 'invited' then
    raise exception 'restore should leave the partner invited';
  end if;
  if not exists (select 1 from portal_audit_log where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and action = 'restore') then
    raise exception 'restore should be audited';
  end if;
  update portal_users set status = 'active' where id = 'fa1b0000-0000-0000-0000-000000000001';
  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
    ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', encode(extensions.digest('ia-sess-2', 'sha256'), 'hex'), now() + interval '1 day');
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-2');
  if n <> 1 then raise exception 'a fresh session should resolve before the revoke'; end if;
end $$;

-- The manager revokes both partners.
do $$ begin
  perform _t_act('fa100000-0000-0000-0000-000000000002');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'revoked') is distinct from 'revoked' then
    raise exception 'mgr revoke of P1 should succeed';
  end if;
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000002', 'revoked') is distinct from 'revoked' then
    raise exception 'mgr revoke of invited P2 should succeed';
  end if;
end $$;

do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-2');
  if n <> 0 then raise exception 'a revoked partner''s session must be rejected on the next lookup'; end if;
  if exists (select 1 from portal_tokens where portal_user_id = 'fa1b0000-0000-0000-0000-000000000002' and consumed_at is null and revoked_at is null) then
    raise exception 'revoking must kill the outstanding invite';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `040_portal_internal_access.sql FAIL` (function `public.portal_set_access(uuid, text)` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261009000004_portal_internal_access.sql`:

```sql
-- 20261009000004_portal_internal_access.sql
--
-- Partner Portal Phase 1A (spec 5.3 suspend/revoke, FR-PORT-13): the in-app
-- controls on the partner record. Callable by signed-in internal users; each
-- re-checks visibility of the partner.

-- Is the portal on for my org, and what is its address? Safe for any member.
create or replace function public.get_portal_status()
returns table (enabled boolean, slug text)
language sql stable security definer set search_path = public, extensions as $$
  select o.portal_enabled and not o.is_disabled, o.slug
    from organizations o
   where o.id = public.user_org_id()
$$;

-- Suspend, revoke, or restore a partner's portal access.
create or replace function public.portal_set_access(p_partner_id uuid, p_status text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.user_org_id();
  v_user portal_users;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('suspended', 'revoked', 'invited') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_user from portal_users u
   where u.partner_id = p_partner_id and u.org_id = v_org
   for update;
  if v_user.id is null then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;

  if p_status = 'invited' then
    if v_user.status not in ('suspended', 'revoked') then
      raise exception 'portal_not_restorable' using errcode = '55000';
    end if;
    update portal_users set status = 'invited', updated_at = now() where id = v_user.id;
    perform public._portal_audit(v_org, v_user.id, 'restore', null, auth.uid());
    return 'invited';
  end if;

  update portal_users set status = p_status::portal_user_status, updated_at = now() where id = v_user.id;
  -- Every request looks the session up, so the very next one fails (spec 5.3).
  update portal_sessions s set revoked_at = now()
   where s.portal_user_id = v_user.id and s.revoked_at is null;
  update portal_tokens t set revoked_at = now()
   where t.portal_user_id = v_user.id and t.consumed_at is null and t.revoked_at is null;
  perform public._portal_audit(
    v_org, v_user.id,
    (case when p_status = 'suspended' then 'suspend' else 'revoke' end)::portal_audit_action,
    null, auth.uid());
  return p_status;
end $$;

revoke execute on function public.get_portal_status()             from public, anon;
revoke execute on function public.portal_set_access(uuid, text)   from public, anon;
grant  execute on function public.get_portal_status()             to authenticated;
grant  execute on function public.portal_set_access(uuid, text)   to authenticated;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `037` to `040` PASS and every previously passing test still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261009000004_portal_internal_access.sql supabase/tests/040_portal_internal_access.sql
git commit -m "$(cat <<'EOF'
feat(portal): suspend, revoke, and restore partner portal access in-app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Portal email builders (`_shared/portalEmail.ts`)

**Files:**
- Create: `supabase/functions/_shared/portalEmail.ts`
- Test: `supabase/functions/_shared/portalEmail.test.ts`
- Modify: `apps/app/tsconfig.app.json` (include the new file)

**Interfaces:**
- Consumes: `EmailOptions` from `supabase/functions/_shared/emailTemplate.ts` (`preheader, heading, bodyLines, ctaLabel, ctaUrl, footnote, code?`); `renderEmail(opts): { html: string; text: string }` (tests only).
- Produces:
  - `interface PortalEmail extends EmailOptions { subject: string }`
  - `portalFromAddress(fromEnv: string, orgName: string): string` returns `"<clean org name>" <address part of fromEnv>`, or the bare address when the name is empty.
  - `portalUrl(appBaseUrl: string, slug: string, suffix?: string): string` returns `<base without trailing slash>/p/<slug><suffix>`.
  - `portalInviteEmail(args: { orgName: string; partnerName: string; inviteUrl: string }): PortalEmail`
  - `portalCodeEmail(args: { orgName: string; code: string; signInUrl: string }): PortalEmail`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalEmail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { portalCodeEmail, portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail";
import { renderEmail } from "./emailTemplate";

describe("portalFromAddress", () => {
  it("shows the ISO name with the address part of FROM_ADDRESS", () => {
    expect(portalFromAddress("navigatr <invites@send.getnavigatr.io>", "Acme ISO")).toBe(
      '"Acme ISO" <invites@send.getnavigatr.io>',
    );
  });

  it("accepts a bare FROM_ADDRESS", () => {
    expect(portalFromAddress("invites@send.getnavigatr.io", "Acme ISO")).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
  });

  it("strips quotes, angle brackets, backslashes and line breaks from the name", () => {
    expect(portalFromAddress("x <a@b.co>", 'Evil "ISO" <hi>\\\r\nBcc: z@z.co')).toBe('"Evil ISO hi Bcc: z@z.co" <a@b.co>');
  });

  it("falls back to the bare address when nothing is left of the name", () => {
    expect(portalFromAddress("x <a@b.co>", ' "<>" ')).toBe("a@b.co");
  });
});

describe("portalUrl", () => {
  it("joins the base, slug and suffix without a double slash", () => {
    expect(portalUrl("https://app.getnavigatr.io/", "acme")).toBe("https://app.getnavigatr.io/p/acme");
    expect(portalUrl("https://app.getnavigatr.io", "acme", "/invite?token=abc")).toBe(
      "https://app.getnavigatr.io/p/acme/invite?token=abc",
    );
  });
});

describe("portalInviteEmail", () => {
  const e = portalInviteEmail({
    orgName: "Acme ISO",
    partnerName: "Jane",
    inviteUrl: "https://app.getnavigatr.io/p/acme/invite?token=abc",
  });

  it("names the ISO and the partner and links to the invite", () => {
    expect(e.subject).toBe("Acme ISO invited you to their referral portal");
    expect(e.bodyLines.join(" ")).toContain("Hi Jane,");
    expect(e.bodyLines.join(" ")).toContain("Acme ISO");
    expect(e.bodyLines.join(" ")).toContain("7 days");
    expect(e.ctaLabel).toBe("Accept invite");
    expect(e.ctaUrl).toBe("https://app.getnavigatr.io/p/acme/invite?token=abc");
  });

  it("never says navigatr in the subject or body", () => {
    expect(`${e.subject} ${e.preheader} ${e.heading} ${e.bodyLines.join(" ")}`.toLowerCase()).not.toContain("navigatr");
  });

  it("renders through the shared template", () => {
    const { html, text } = renderEmail(e);
    expect(html).toContain("Acme ISO");
    expect(text).toContain("Accept invite: https://app.getnavigatr.io/p/acme/invite?token=abc");
  });
});

describe("portalCodeEmail", () => {
  const e = portalCodeEmail({ orgName: "Acme ISO", code: "042917", signInUrl: "https://app.getnavigatr.io/p/acme" });

  it("carries the code, the expiry and the sign-in page", () => {
    expect(e.subject).toBe("Your sign-in code for Acme ISO");
    expect(e.code).toBe("042917");
    expect(e.preheader).toContain("042917");
    expect(e.bodyLines.join(" ")).toContain("15 minutes");
    expect(e.ctaUrl).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("renders the code prominently", () => {
    const { html, text } = renderEmail(e);
    expect(html).toContain("042917");
    expect(text).toContain("Code: 042917");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- _shared/portalEmail.test.ts`
Expected: FAIL, cannot resolve `./portalEmail`.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/portalEmail.ts`:

```ts
/**
 * Partner portal emails (spec 5.8, the Phase 1A subset): the invite and the
 * sign-in code. Built on the shared branded template (emailTemplate.ts).
 *
 * The ISO's name is the sender display name and appears in the copy. The
 * template header still shows the navigatr mark until per-tenant email
 * branding lands with the referral emails in Phase 1C.
 *
 * Pure, dependency-free TS (no Deno globals) so the app's vitest can verify it,
 * matching the other _shared modules.
 */
import type { EmailOptions } from "./emailTemplate.ts";

export interface PortalEmail extends EmailOptions {
  subject: string;
}

/**
 * Sender for portal emails: the shared navigatr address with the ISO's name as
 * the display name (spec 5.8). Characters that could break or inject into the
 * From header are removed from the name.
 */
export function portalFromAddress(fromEnv: string, orgName: string): string {
  const match = /<([^<>]+)>/.exec(fromEnv);
  const address = (match ? match[1] : fromEnv).trim();
  const name = orgName.replace(/["<>\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return name ? `"${name}" <${address}>` : address;
}

/** The partner portal address for a tenant, optionally with a sub-path. */
export function portalUrl(appBaseUrl: string, slug: string, suffix = ""): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}${suffix}`;
}

export function portalInviteEmail(args: {
  orgName: string;
  partnerName: string;
  inviteUrl: string;
}): PortalEmail {
  return {
    subject: `${args.orgName} invited you to their referral portal`,
    preheader: `Accept your invite to send referrals to ${args.orgName}.`,
    heading: `Join the ${args.orgName} referral portal`,
    bodyLines: [
      `Hi ${args.partnerName},`,
      `${args.orgName} invited you to their referral portal. You can send them businesses and see how each referral is going.`,
      "This link works once and expires in 7 days.",
    ],
    ctaLabel: "Accept invite",
    ctaUrl: args.inviteUrl,
    footnote: "If you weren't expecting this, you can ignore this email.",
  };
}

export function portalCodeEmail(args: { orgName: string; code: string; signInUrl: string }): PortalEmail {
  return {
    subject: `Your sign-in code for ${args.orgName}`,
    preheader: `Your code is ${args.code}. It expires in 15 minutes.`,
    heading: "Your sign-in code",
    bodyLines: [
      `Enter this code to sign in to the ${args.orgName} referral portal. It expires in 15 minutes.`,
    ],
    code: args.code,
    ctaLabel: "Open the sign-in page",
    ctaUrl: args.signInUrl,
    footnote: "If you didn't ask for this code, you can ignore this email.",
  };
}
```

In `apps/app/tsconfig.app.json`, replace:

```json
    "../../supabase/functions/_shared/persistence/zonedDate.ts"
  ]
```

with:

```json
    "../../supabase/functions/_shared/persistence/zonedDate.ts",
    "../../supabase/functions/_shared/portalEmail.ts"
  ]
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- _shared/portalEmail.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalEmail.ts supabase/functions/_shared/portalEmail.test.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): invite and sign-in code emails sent in the ISO's name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `portal_api` handler, edge function, and config

**Files:**
- Create: `supabase/functions/_shared/portalApi.ts`
- Test: `supabase/functions/_shared/portalApi.test.ts`
- Create: `supabase/functions/portal_api/index.ts`, `supabase/functions/portal_api/deno.json`
- Modify: `supabase/config.toml`, `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: `shouldSend(appEnv, allowlist, recipient): boolean` (emailGuard.ts); `renderEmail` (emailTemplate.ts); `portalCodeEmail`, `portalFromAddress`, `portalUrl` (Task 5); SQL `portal_brand`, `portal_issue_code`, `portal_verify_code`, `portal_peek_invite`, `portal_accept_invite`, `portal_session_lookup`, `portal_sign_out` (Tasks 2 and 3).
- Produces (TS):
  - `PORTAL_CORS_HEADERS: Record<string, string>` (allow headers include `x-portal-session`).
  - `interface PortalRpcResult { data: unknown; error: { message: string } | null }`
  - `interface PortalEmailMessage { from: string; to: string; subject: string; html: string; text: string }`
  - `interface PortalEnv { appBaseUrl: string; fromAddress: string; appEnv: string | null | undefined; emailAllowlist: string }`
  - `interface PortalApiDeps { rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>; sendEmail(msg: PortalEmailMessage): Promise<void>; now?(): Date; env: PortalEnv }`
  - `interface HeaderReader { get(name: string): string | null }`
  - `type PortalAction = "brand" | "request_code" | "verify_code" | "peek_invite" | "accept_invite" | "me" | "sign_out"`
  - `jsonResponse(body: unknown, status?: number, headers?: Record<string, string>): Response`
  - `portalAction(url: string): string`, `clientIp(headers: HeaderReader): string | null`, `sessionTokenFrom(headers: HeaderReader): string`, `firstRow<T>(data: unknown): T | null`
  - `handlePortalRequest(req: Request, deps: PortalApiDeps): Promise<Response>`
- Produces (HTTP, all `POST /functions/v1/portal_api/<action>` with a JSON body):

| Action | Body | Success | Failure |
|---|---|---|---|
| `brand` | `{ slug }` | `200 { brand: { orgName, productName, primaryColor, logoUrl, darkLogoUrl } }` | `404 { error: "not_available" }`, `500 { error: "server_error" }` |
| `request_code` | `{ slug, email }` | always `200 { ok: true }` | none |
| `verify_code` | `{ slug, email, code }` | `200 { sessionToken, expiresAt }` | `401 { error: "invalid_code" }` |
| `peek_invite` | `{ slug, token }` | `200 { invite: { partnerName, orgName, termsText, termsVersion } }` | `404 { error: "invalid_invite" }`, `500 { error: "server_error" }` |
| `accept_invite` | `{ slug, token, termsVersion }` | `200 { sessionToken, expiresAt }` | `400 invalid_body`, `409 terms_changed`, `404 invalid_invite` |
| `me` | `{ slug }` + header `x-portal-session` | `200 { me: { partnerName, email, orgName } }` | `401 { error: "unauthorized" }` |
| `sign_out` | `{}` + header `x-portal-session` | `200 { ok: true }` | none |

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clientIp,
  firstRow,
  handlePortalRequest,
  portalAction,
  sessionTokenFrom,
  type PortalApiDeps,
  type PortalEmailMessage,
  type PortalEnv,
  type PortalRpcResult,
} from "./portalApi";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io/",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

function setup(rpcImpl: (name: string, args: Record<string, unknown>) => PortalRpcResult, env: PortalEnv = ENV) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args));
  const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
  const deps: PortalApiDeps = { rpc, sendEmail, env };
  return { deps, rpc, sendEmail };
}

const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";

function post(action: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${URL_BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("parses the action from the last path segment", () => {
    expect(portalAction(`${URL_BASE}/brand`)).toBe("brand");
    expect(portalAction("not a url")).toBe("");
  });

  it("takes the first x-forwarded-for entry as the client IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.5 , 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("reads the session only from x-portal-session", () => {
    expect(sessionTokenFrom(new Headers({ "x-portal-session": "  abc " }))).toBe("abc");
    expect(sessionTokenFrom(new Headers({ authorization: "Bearer eyJhbGciOi" }))).toBe("");
  });

  it("returns the first row of an RPC result", () => {
    expect(firstRow([{ a: 1 }])).toEqual({ a: 1 });
    expect(firstRow([])).toBeNull();
    expect(firstRow(null)).toBeNull();
    expect(firstRow({ a: 2 })).toEqual({ a: 2 });
  });
});

describe("routing", () => {
  it("answers CORS preflight and allows the session header", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(new Request(`${URL_BASE}/me`, { method: "OPTIONS" }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("x-portal-session");
  });

  it("404s an unknown action without touching the database", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("drop_tables", {}), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("405s a non-POST request", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(new Request(`${URL_BASE}/brand`, { method: "GET" }), deps);
    expect(res.status).toBe(405);
  });

  it("400s a body that is not JSON", async () => {
    const { deps } = setup(() => ok(null));
    const res = await handlePortalRequest(post("brand", "{not json"), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("brand", () => {
  it("returns only the allowlisted branding fields for a normalized slug", async () => {
    const { deps, rpc } = setup(() =>
      ok([
        {
          org_name: "Acme ISO",
          product_name: "Acme",
          primary_color: "#0f766e",
          logo_url: "https://cdn.example/l.png",
          dark_logo_url: null,
          org_id: "secret-org-id",
          partner_terms_text: "internal",
        },
      ]),
    );
    const res = await handlePortalRequest(post("brand", { slug: "  ACME " }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_brand", { p_slug: "acme" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      brand: {
        orgName: "Acme ISO",
        productName: "Acme",
        primaryColor: "#0f766e",
        logoUrl: "https://cdn.example/l.png",
        darkLogoUrl: null,
      },
    });
  });

  it("404s an unknown or disabled portal with no tenant detail", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("brand", { slug: "nope" }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_available" });
  });

  it("500s when the database fails", async () => {
    const { deps } = setup(() => fail("boom"));
    const res = await handlePortalRequest(post("brand", { slug: "acme" }), deps);
    expect(res.status).toBe(500);
  });
});

describe("request_code", () => {
  const ISSUED = ok([{ code: "123456", recipient: "jane@example.com", org_name: "Acme ISO", org_slug: "acme" }]);

  it.each([
    ["a code was issued", ISSUED],
    ["no such user", ok([])],
    ["rate limited, inactive, or portal off", ok(null)],
    ["the database failed", fail("boom")],
  ])("always answers { ok: true } when %s", async (_label, result) => {
    const { deps } = setup(() => result);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers { ok: true } for a malformed email without calling the database", async () => {
    const { deps, rpc } = setup(() => ISSUED);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "nope" }), deps);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the client IP and emails the code in the ISO's name", async () => {
    const { deps, rpc, sendEmail } = setup(() => ISSUED);
    await handlePortalRequest(
      post("request_code", { slug: "acme", email: "jane@example.com" }, { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_issue_code", {
      p_slug: "acme",
      p_email: "jane@example.com",
      p_ip: "203.0.113.5",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("jane@example.com");
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.subject).toBe("Your sign-in code for Acme ISO");
    expect(msg.html).toContain("123456");
    expect(msg.text).toContain("https://app.getnavigatr.io/p/acme");
  });

  it("respects the non-production allowlist and still answers { ok: true }", async () => {
    const staging: PortalEnv = { ...ENV, appEnv: "staging", emailAllowlist: "someone@else.com" };
    const { deps, sendEmail } = setup(() => ISSUED, staging);
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true });

    const allowed = setup(() => ISSUED, { ...staging, emailAllowlist: "jane@example.com" });
    await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), allowed.deps);
    expect(allowed.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("answers { ok: true } even when the email provider fails", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    sendEmail.mockRejectedValueOnce(new Error("resend down"));
    const res = await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("verify_code", () => {
  it("returns only the session token and expiry", async () => {
    const { deps, rpc } = setup(() =>
      ok([{ session_token: "t".repeat(64), session_expires_at: "2026-11-08T00:00:00Z", portal_user_id: "u-1" }]),
    );
    const res = await handlePortalRequest(
      post(
        "verify_code",
        { slug: "acme", email: "jane@example.com", code: "123 456" },
        { "x-forwarded-for": "198.51.100.7", "user-agent": "Mozilla/5.0" },
      ),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_verify_code", {
      p_slug: "acme",
      p_email: "jane@example.com",
      p_code: "123456",
      p_ip: "198.51.100.7",
      p_user_agent: "Mozilla/5.0",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionToken: "t".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
  });

  it("answers a generic 401 for a wrong code", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "000000" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("answers the same 401 for a malformed code without calling the database", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "12ab" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the same 401 when the database fails", async () => {
    const { deps } = setup(() => fail("boom"));
    const res = await handlePortalRequest(post("verify_code", { slug: "acme", email: "jane@example.com", code: "123456" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });
});

describe("peek_invite", () => {
  it("returns only the allowlisted invite fields", async () => {
    const { deps, rpc } = setup(() =>
      ok([{ partner_name: "Jane", org_name: "Acme ISO", terms_text: "Be fair.", terms_version: 2, org_id: "secret" }]),
    );
    const res = await handlePortalRequest(post("peek_invite", { slug: "acme", token: "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_peek_invite", { p_slug: "acme", p_token: "tok" });
    expect(await res.json()).toEqual({
      invite: { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 },
    });
  });

  it("404s an invalid invite and a missing token", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("peek_invite", { slug: "acme", token: "bad" }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invite" });

    rpc.mockClear();
    const missing = await handlePortalRequest(post("peek_invite", { slug: "acme" }), deps);
    expect(missing.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("accept_invite", () => {
  it("accepts with the terms version and returns a session", async () => {
    const { deps, rpc } = setup(() => ok([{ session_token: "s".repeat(64), session_expires_at: "2026-11-08T00:00:00Z" }]));
    const res = await handlePortalRequest(
      post("accept_invite", { slug: "acme", token: "tok", termsVersion: 2 }, { "x-forwarded-for": "203.0.113.9", "user-agent": "UA" }),
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_accept_invite", {
      p_slug: "acme",
      p_token: "tok",
      p_terms_version: 2,
      p_ip: "203.0.113.9",
      p_user_agent: "UA",
    });
    expect(await res.json()).toEqual({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
  });

  it("409s when the terms changed since the partner read them", async () => {
    const { deps } = setup(() => fail("terms_changed"));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok", termsVersion: 1 }), deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "terms_changed" });
  });

  it("404s any other failure", async () => {
    const { deps } = setup(() => fail("invalid_invite"));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok", termsVersion: 1 }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
  });

  it("400s a missing terms version without calling the database", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(post("accept_invite", { slug: "acme", token: "tok" }), deps);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("me", () => {
  it("rejects a Supabase JWT: identity only ever comes from x-portal-session", async () => {
    const { deps, rpc } = setup(() => ok([]));
    const res = await handlePortalRequest(
      post("me", { slug: "acme" }, { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns only the partner name, email and ISO name", async () => {
    const { deps, rpc } = setup(() =>
      ok([
        {
          portal_user_id: "u-1",
          org_id: "o-1",
          partner_id: "p-1",
          partner_name: "Jane",
          user_email: "jane@example.com",
          org_name: "Acme ISO",
          org_slug: "acme",
        },
      ]),
    );
    const res = await handlePortalRequest(post("me", { slug: "acme" }, { "x-portal-session": "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_session_lookup", { p_slug: "acme", p_token: "tok" });
    expect(await res.json()).toEqual({ me: { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" } });
  });

  it("401s a dead session", async () => {
    const { deps } = setup(() => ok([]));
    const res = await handlePortalRequest(post("me", { slug: "acme" }, { "x-portal-session": "old" }), deps);
    expect(res.status).toBe(401);
  });
});

describe("sign_out", () => {
  it("revokes the session from the header", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("sign_out", {}, { "x-portal-session": "tok" }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_sign_out", { p_token: "tok" });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is a no-op without a session", async () => {
    const { deps, rpc } = setup(() => ok(null));
    const res = await handlePortalRequest(post("sign_out", {}), deps);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- _shared/portalApi.test.ts`
Expected: FAIL, cannot resolve `./portalApi`.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/_shared/portalApi.ts`:

```ts
/**
 * Request handler for the portal_api edge function (Partner Portal, spec 5.1).
 *
 * Partners are never Supabase Auth users (spec R2). Identity comes only from the
 * x-portal-session header, checked by portal_session_lookup in SQL on every
 * request; Authorization is never read for identity. Secrets, rate limits,
 * expiry and state changes all live in service-role-only SQL functions, so this
 * module only routes, shapes responses from explicit allowlists (never passing a
 * row through), and sends the sign-in code email.
 *
 * Pure TS with injected dependencies and no Deno globals at module scope, so the
 * app's vitest run covers it. portal_api/index.ts wires the real service-role
 * client and Resend.
 */
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { portalCodeEmail, portalFromAddress, portalUrl } from "./portalEmail.ts";

export const PORTAL_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface PortalRpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface PortalEmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface PortalEnv {
  appBaseUrl: string;
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
}

export interface PortalApiDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>;
  sendEmail(msg: PortalEmailMessage): Promise<void>;
  /** Reserved for later phases; Phase 1A keeps every clock in SQL. */
  now?(): Date;
  env: PortalEnv;
}

/** Narrower than Headers so tests and callers can pass any header bag. */
export interface HeaderReader {
  get(name: string): string | null;
}

export type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out";

const ACTIONS: ReadonlySet<string> = new Set<PortalAction>([
  "brand",
  "request_code",
  "verify_code",
  "peek_invite",
  "accept_invite",
  "me",
  "sign_out",
]);

interface BrandRow {
  org_name: string;
  product_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  dark_logo_url: string | null;
}

interface IssuedCodeRow {
  code: string;
  recipient: string;
  org_name: string;
  org_slug: string;
}

interface SessionRow {
  session_token: string;
  session_expires_at: string;
}

interface InviteRow {
  partner_name: string;
  org_name: string;
  terms_text: string | null;
  terms_version: number;
}

interface LookupRow {
  portal_user_id: string;
  partner_name: string;
  user_email: string;
  org_name: string;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = PORTAL_CORS_HEADERS,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Sub-route = last path segment: /functions/v1/portal_api/<action>. */
export function portalAction(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** First x-forwarded-for entry (the client as seen by the edge), or null. */
export function clientIp(headers: HeaderReader): string | null {
  const raw = headers.get("x-forwarded-for");
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first || null;
}

export function sessionTokenFrom(headers: HeaderReader): string {
  return (headers.get("x-portal-session") ?? "").trim();
}

/** RETURNS TABLE functions come back from PostgREST as arrays. */
export function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data.length > 0 ? (data[0] as T) : null;
  return data !== null && typeof data === "object" ? (data as T) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function handlePortalRequest(req: Request, deps: PortalApiDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PORTAL_CORS_HEADERS });

  const action = portalAction(req.url);
  if (!ACTIONS.has(action)) return jsonResponse({ error: "not_found" }, 404);
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    body = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const slug = str(body.slug).trim().toLowerCase();
  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");

  switch (action as PortalAction) {
    case "brand":
      return brand(slug, deps);
    case "request_code":
      return requestCode(slug, str(body.email).trim(), ip, deps);
    case "verify_code":
      return verifyCode(slug, str(body.email).trim(), str(body.code), ip, userAgent, deps);
    case "peek_invite":
      return peekInvite(slug, str(body.token).trim(), deps);
    case "accept_invite":
      return acceptInvite(slug, str(body.token).trim(), body.termsVersion, ip, userAgent, deps);
    case "me":
      return me(slug, sessionTokenFrom(req.headers), deps);
    case "sign_out":
      return signOut(sessionTokenFrom(req.headers), deps);
    default:
      return jsonResponse({ error: "not_found" }, 404);
  }
}

async function brand(slug: string, deps: PortalApiDeps): Promise<Response> {
  const { data, error } = await deps.rpc("portal_brand", { p_slug: slug });
  if (error) {
    console.error("[portal_api] brand failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<BrandRow>(data);
  if (!row) return jsonResponse({ error: "not_available" }, 404);
  return jsonResponse({
    brand: {
      orgName: row.org_name,
      productName: row.product_name ?? "navigatr",
      primaryColor: row.primary_color ?? null,
      logoUrl: row.logo_url ?? null,
      darkLogoUrl: row.dark_logo_url ?? null,
    },
  });
}

/** Always { ok: true }, whatever happened (NFR-PORT-04). */
async function requestCode(slug: string, email: string, ip: string | null, deps: PortalApiDeps): Promise<Response> {
  const generic = () => jsonResponse({ ok: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic();
  try {
    const { data, error } = await deps.rpc("portal_issue_code", { p_slug: slug, p_email: email, p_ip: ip });
    if (error) {
      console.error("[portal_api] issue code failed:", error.message);
      return generic();
    }
    const row = firstRow<IssuedCodeRow>(data);
    if (!row?.code) return generic();
    if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.recipient)) {
      console.log(`[portal_api][emailGuard] dropped a sign-in code in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
      return generic();
    }
    const built = portalCodeEmail({
      orgName: row.org_name,
      code: row.code,
      signInUrl: portalUrl(deps.env.appBaseUrl, row.org_slug),
    });
    const { html, text } = renderEmail(built);
    await deps.sendEmail({
      from: portalFromAddress(deps.env.fromAddress, row.org_name),
      to: row.recipient,
      subject: built.subject,
      html,
      text,
    });
  } catch (e) {
    console.error("[portal_api] sign-in code send failed:", e instanceof Error ? e.message : String(e));
  }
  return generic();
}

async function verifyCode(
  slug: string,
  email: string,
  rawCode: string,
  ip: string | null,
  userAgent: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  const invalid = () => jsonResponse({ error: "invalid_code" }, 401);
  const code = rawCode.replace(/\s+/g, "");
  if (!email || !/^\d{6}$/.test(code)) return invalid();
  const { data, error } = await deps.rpc("portal_verify_code", {
    p_slug: slug,
    p_email: email,
    p_code: code,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) {
    console.error("[portal_api] verify failed:", error.message);
    return invalid();
  }
  const row = firstRow<SessionRow>(data);
  if (!row?.session_token) return invalid();
  return jsonResponse({ sessionToken: row.session_token, expiresAt: row.session_expires_at });
}

async function peekInvite(slug: string, token: string, deps: PortalApiDeps): Promise<Response> {
  if (!token) return jsonResponse({ error: "invalid_invite" }, 404);
  const { data, error } = await deps.rpc("portal_peek_invite", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] peek failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<InviteRow>(data);
  if (!row) return jsonResponse({ error: "invalid_invite" }, 404);
  return jsonResponse({
    invite: {
      partnerName: row.partner_name,
      orgName: row.org_name,
      termsText: row.terms_text ?? "",
      termsVersion: row.terms_version,
    },
  });
}

async function acceptInvite(
  slug: string,
  token: string,
  termsVersion: unknown,
  ip: string | null,
  userAgent: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  if (!token || typeof termsVersion !== "number" || !Number.isInteger(termsVersion)) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const { data, error } = await deps.rpc("portal_accept_invite", {
    p_slug: slug,
    p_token: token,
    p_terms_version: termsVersion,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) {
    if (error.message.includes("terms_changed")) return jsonResponse({ error: "terms_changed" }, 409);
    return jsonResponse({ error: "invalid_invite" }, 404);
  }
  const row = firstRow<SessionRow>(data);
  if (!row?.session_token) return jsonResponse({ error: "invalid_invite" }, 404);
  return jsonResponse({ sessionToken: row.session_token, expiresAt: row.session_expires_at });
}

async function me(slug: string, token: string, deps: PortalApiDeps): Promise<Response> {
  const unauthorized = () => jsonResponse({ error: "unauthorized" }, 401);
  if (!token) return unauthorized();
  const { data, error } = await deps.rpc("portal_session_lookup", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] session lookup failed:", error.message);
    return unauthorized();
  }
  const row = firstRow<LookupRow>(data);
  if (!row?.portal_user_id) return unauthorized();
  return jsonResponse({ me: { partnerName: row.partner_name, email: row.user_email, orgName: row.org_name } });
}

async function signOut(token: string, deps: PortalApiDeps): Promise<Response> {
  if (token) {
    const { error } = await deps.rpc("portal_sign_out", { p_token: token });
    if (error) console.error("[portal_api] sign out failed:", error.message);
  }
  return jsonResponse({ ok: true });
}
```

In `apps/app/tsconfig.app.json`, replace:

```json
    "../../supabase/functions/_shared/portalEmail.ts"
  ]
```

with:

```json
    "../../supabase/functions/_shared/portalEmail.ts",
    "../../supabase/functions/_shared/portalApi.ts"
  ]
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- _shared/portalApi.test.ts`
Expected: PASS (all `helpers`, `routing`, `brand`, `request_code`, `verify_code`, `peek_invite`, `accept_invite`, `me`, `sign_out` tests).

- [ ] **Step 5: Wire the edge function**

Create `supabase/functions/portal_api/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2",
    "resend": "npm:resend@4.1.1"
  }
}
```

Create `supabase/functions/portal_api/index.ts`:

```ts
// Supabase Edge Function: portal_api (Partner Portal, spec 5.1).
//
// The partner-facing API. verify_jwt is OFF in config.toml because partners are
// never Supabase Auth users (spec R2): there is no JWT to verify. Identity is the
// x-portal-session header, checked in SQL on every request. All logic lives in
// _shared/portalApi.ts (unit-tested); this file only wires real dependencies.
//
// Routes: POST /functions/v1/portal_api/<action>, where action is one of
//   brand | request_code | verify_code | peek_invite | accept_invite | me | sign_out

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalRequest, type PortalApiDeps } from "../_shared/portalApi.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable; unset APP_ENV
// fails closed. See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

const deps: PortalApiDeps = {
  rpc: async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  },
  sendEmail: async (msg) => {
    const res = await resend.emails.send(msg);
    if ((res as { error?: unknown }).error) {
      throw new Error(JSON.stringify((res as { error: unknown }).error));
    }
  },
  env: {
    appBaseUrl: APP_BASE_URL,
    fromAddress: FROM_ADDRESS,
    appEnv: APP_ENV,
    emailAllowlist: EMAIL_ALLOWLIST,
  },
};

Deno.serve((req) => handlePortalRequest(req, deps));
```

In `supabase/config.toml`, replace:

```toml
[functions.send_auth_email]
verify_jwt = false
```

with:

```toml
[functions.send_auth_email]
verify_jwt = false

# portal_api: the partner portal's API. Partners are never Supabase Auth users
# (spec R2), so there is no JWT to verify and platform verification would reject
# every partner request. Identity is the x-portal-session token, hashed and
# checked against portal_sessions in SQL on every request; the functions it
# calls are service-role only.
[functions.portal_api]
verify_jwt = false
```

- [ ] **Step 6: Check the function bundles**

Run: `deno check supabase/functions/portal_api/index.ts`
Expected: exits 0. If `deno` is not installed locally, skip this step; `supabase functions deploy` in CI type-checks the bundle, and `pnpm --filter app build` (Task 13) typechecks the shared module.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalApi.ts supabase/functions/_shared/portalApi.test.ts supabase/functions/portal_api apps/app/tsconfig.app.json supabase/config.toml
git commit -m "$(cat <<'EOF'
feat(portal): portal_api edge function with session header and allowlisted responses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `portal_invite` handler and edge function

**Files:**
- Create: `supabase/functions/_shared/portalInvite.ts`
- Test: `supabase/functions/_shared/portalInvite.test.ts`
- Create: `supabase/functions/portal_invite/index.ts`, `supabase/functions/portal_invite/deno.json`
- Modify: `supabase/config.toml`, `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: `firstRow`, `jsonResponse`, `PortalEmailMessage`, `PortalEnv`, `PortalRpcResult` (Task 6); `portalFromAddress`, `portalInviteEmail`, `portalUrl` (Task 5); `shouldSend`, `renderEmail`; SQL `portal_create_invite(p_partner_id uuid, p_actor uuid)` (Task 2).
- Produces (TS):
  - `INVITE_CORS_HEADERS: Record<string, string>`
  - `INVITE_ERROR_STATUS: Record<string, number>` (`not_authorized` 403, `partner_not_found` 404, `portal_disabled` 409, `partner_email_required` 422, `portal_already_active` 409, `portal_email_in_use` 409)
  - `interface PortalInviteDeps { getUserId(): Promise<string | null>; rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>; sendEmail(msg: PortalEmailMessage): Promise<void>; env: PortalEnv }`
  - `handlePortalInvite(req: Request, deps: PortalInviteDeps): Promise<Response>`
- Produces (HTTP): `POST /functions/v1/portal_invite` with the rep's JWT and body `{ partnerId }`. Success `200 { ok: true, emailed: boolean }` (never the token). Errors: `401 unauthorized`, `400 invalid_body`, the mapped statuses above with `{ error: <token> }`, `500 invite_failed`, `502 email_failed`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalInvite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalInvite, type PortalInviteDeps } from "./portalInvite";
import type { PortalEmailMessage, PortalEnv, PortalRpcResult } from "./portalApi";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const TOKEN = "a".repeat(64);
const ROW = {
  invite_token: TOKEN,
  invite_email: "jane@example.com",
  partner_name: "Jane",
  org_name: "Acme ISO",
  org_slug: "acme",
};
const PARTNER = "11111111-2222-3333-4444-555555555555";

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

function setup(opts: { userId?: string | null; result?: PortalRpcResult; env?: PortalEnv } = {}) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => opts.result ?? ok([ROW]));
  const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
  const getUserId = vi.fn(async () => (opts.userId === undefined ? "user-1" : opts.userId));
  const deps: PortalInviteDeps = { getUserId, rpc, sendEmail, env: opts.env ?? ENV };
  return { deps, rpc, sendEmail };
}

function post(body: unknown): Request {
  return new Request("https://proj.supabase.co/functions/v1/portal_invite", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-jwt" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePortalInvite", () => {
  it("answers CORS preflight and rejects other methods", async () => {
    const { deps } = setup();
    const pre = await handlePortalInvite(new Request("https://x/functions/v1/portal_invite", { method: "OPTIONS" }), deps);
    expect(pre.status).toBe(200);
    const get = await handlePortalInvite(new Request("https://x/functions/v1/portal_invite", { method: "GET" }), deps);
    expect(get.status).toBe(405);
  });

  it("401s when the caller is not a signed-in internal user", async () => {
    const { deps, rpc } = setup({ userId: null });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s a missing or malformed partner id", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalInvite(post({ partnerId: "not-a-uuid" }), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates the invite as the verified user and emails the link, never returning the token", async () => {
    const { deps, rpc, sendEmail } = setup();
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(rpc).toHaveBeenCalledWith("portal_create_invite", { p_partner_id: PARTNER, p_actor: "user-1" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("jane@example.com");
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.subject).toBe("Acme ISO invited you to their referral portal");
    expect(msg.html).toContain(`https://app.getnavigatr.io/p/acme/invite?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, emailed: true });
    expect(text).not.toContain(TOKEN);
  });

  it.each([
    ["not_authorized", 403],
    ["partner_not_found", 404],
    ["portal_disabled", 409],
    ["partner_email_required", 422],
    ["portal_already_active", 409],
    ["portal_email_in_use", 409],
  ])("maps %s to %i", async (token, status) => {
    const { deps, sendEmail } = setup({ result: fail(token) });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: token });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("500s an unexpected database error", async () => {
    const { deps } = setup({ result: fail("connection reset") });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "invite_failed" });
  });

  it("respects the non-production allowlist", async () => {
    const { deps, sendEmail } = setup({ env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, emailed: false });
  });

  it("502s when the email provider fails", async () => {
    const { deps, sendEmail } = setup();
    sendEmail.mockRejectedValueOnce(new Error("resend down"));
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "email_failed" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- _shared/portalInvite.test.ts`
Expected: FAIL, cannot resolve `./portalInvite`.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/_shared/portalInvite.ts`:

```ts
/**
 * Request handler for the portal_invite edge function (Partner Portal, spec 5.3).
 *
 * A signed-in rep (or anyone above them who can see the partner, or an admin)
 * invites a partner. The caller is verified with auth.getUser() in index.ts and
 * passed in as getUserId(); portal_create_invite re-checks that this user can see
 * the partner, that the portal is on, and that the partner has an email. The raw
 * invite token goes only into the email: reps never handle the link.
 *
 * Pure TS with injected dependencies (no Deno globals at module scope) so the
 * app's vitest run covers it.
 */
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail.ts";
import {
  firstRow,
  jsonResponse,
  type PortalEmailMessage,
  type PortalEnv,
  type PortalRpcResult,
} from "./portalApi.ts";

export const INVITE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const INVITE_ERROR_STATUS: Record<string, number> = {
  not_authorized: 403,
  partner_not_found: 404,
  portal_disabled: 409,
  partner_email_required: 422,
  portal_already_active: 409,
  portal_email_in_use: 409,
};

export interface PortalInviteDeps {
  getUserId(): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>;
  sendEmail(msg: PortalEmailMessage): Promise<void>;
  env: PortalEnv;
}

interface CreatedInviteRow {
  invite_token: string;
  invite_email: string;
  partner_name: string;
  org_name: string;
  org_slug: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handlePortalInvite(req: Request, deps: PortalInviteDeps): Promise<Response> {
  const json = (body: unknown, status = 200) => jsonResponse(body, status, INVITE_CORS_HEADERS);

  if (req.method === "OPTIONS") return new Response("ok", { headers: INVITE_CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const userId = await deps.getUserId();
  if (!userId) return json({ error: "unauthorized" }, 401);

  let partnerId = "";
  try {
    const parsed = (await req.json()) as { partnerId?: unknown } | null;
    partnerId = typeof parsed?.partnerId === "string" ? parsed.partnerId : "";
  } catch {
    partnerId = "";
  }
  if (!UUID_RE.test(partnerId)) return json({ error: "invalid_body" }, 400);

  const { data, error } = await deps.rpc("portal_create_invite", { p_partner_id: partnerId, p_actor: userId });
  if (error) {
    const message = error.message;
    const code = Object.keys(INVITE_ERROR_STATUS).find((token) => message.includes(token));
    if (!code) {
      console.error("[portal_invite] create failed:", message);
      return json({ error: "invite_failed" }, 500);
    }
    return json({ error: code }, INVITE_ERROR_STATUS[code]);
  }

  const row = firstRow<CreatedInviteRow>(data);
  if (!row?.invite_token) return json({ error: "invite_failed" }, 500);

  if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.invite_email)) {
    console.log(`[portal_invite][emailGuard] dropped an invite in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
    return json({ ok: true, emailed: false });
  }

  const built = portalInviteEmail({
    orgName: row.org_name,
    partnerName: row.partner_name,
    inviteUrl: portalUrl(deps.env.appBaseUrl, row.org_slug, `/invite?token=${encodeURIComponent(row.invite_token)}`),
  });
  const { html, text } = renderEmail(built);
  try {
    await deps.sendEmail({
      from: portalFromAddress(deps.env.fromAddress, row.org_name),
      to: row.invite_email,
      subject: built.subject,
      html,
      text,
    });
  } catch (e) {
    console.error("[portal_invite] send failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "email_failed" }, 502);
  }
  return json({ ok: true, emailed: true });
}
```

In `apps/app/tsconfig.app.json`, replace:

```json
    "../../supabase/functions/_shared/portalApi.ts"
  ]
```

with:

```json
    "../../supabase/functions/_shared/portalApi.ts",
    "../../supabase/functions/_shared/portalInvite.ts"
  ]
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- _shared/portalInvite.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Wire the edge function**

Create `supabase/functions/portal_invite/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2",
    "resend": "npm:resend@4.1.1"
  }
}
```

Create `supabase/functions/portal_invite/index.ts`:

```ts
// Supabase Edge Function: portal_invite (Partner Portal, spec 5.3).
//
// Called by a signed-in rep from the partner record (supabase.functions.invoke,
// verify_jwt = true). The caller is verified with auth.getUser() through a
// user-JWT client; the invite itself is created by the service-role-only SQL
// function portal_create_invite, which re-checks visibility for that user. All
// logic lives in _shared/portalInvite.ts (unit-tested).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalInvite } from "../_shared/portalInvite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

Deno.serve((req) =>
  handlePortalInvite(req, {
    getUserId: async () => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return null;
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data, error } = await userClient.auth.getUser();
      return error || !data?.user ? null : data.user.id;
    },
    rpc: async (name, args) => {
      const { data, error } = await db.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    },
    sendEmail: async (msg) => {
      const res = await resend.emails.send(msg);
      if ((res as { error?: unknown }).error) {
        throw new Error(JSON.stringify((res as { error: unknown }).error));
      }
    },
    env: {
      appBaseUrl: APP_BASE_URL,
      fromAddress: FROM_ADDRESS,
      appEnv: APP_ENV,
      emailAllowlist: EMAIL_ALLOWLIST,
    },
  })
);
```

In `supabase/config.toml`, replace:

```toml
[functions.intercom_user_hash]
verify_jwt = true
```

with:

```toml
[functions.intercom_user_hash]
verify_jwt = true

[functions.portal_invite]
verify_jwt = true
```

- [ ] **Step 6: Check the function bundles**

Run: `deno check supabase/functions/portal_invite/index.ts`
Expected: exits 0 (skip if `deno` is not installed locally, as in Task 6).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalInvite.ts supabase/functions/_shared/portalInvite.test.ts supabase/functions/portal_invite apps/app/tsconfig.app.json supabase/config.toml
git commit -m "$(cat <<'EOF'
feat(portal): portal_invite edge function emails a single-use invite link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Frontend portal client, session storage, portal address, brand provider

**Files:**
- Create: `apps/app/src/features/portal/lib/portalApi.ts` (+ `portalApi.test.ts`)
- Create: `apps/app/src/features/portal/lib/portalSession.ts` (+ `portalSession.test.ts`)
- Create: `apps/app/src/features/portal/lib/portalAddress.ts` (+ `portalAddress.test.ts`)
- Create: `apps/app/src/features/portal/PortalBrandProvider.tsx` (+ `PortalBrandProvider.test.tsx`)

**Interfaces:**
- Consumes: the `portal_api` HTTP contract (Task 6); `deriveBrandVars(hex: string, isDark: boolean): BrandVars | null` from `@/features/branding/colorShades`; `useTheme` from `@/stores/theme` (`resolvedTheme: "light" | "dark"`).
- Produces:
  - `PORTAL_API_URL: string` (`${VITE_SUPABASE_URL}/functions/v1/portal_api`)
  - `interface PortalBrand { orgName: string; productName: string; primaryColor: string | null; logoUrl: string | null; darkLogoUrl: string | null }`
  - `interface PortalInvite { partnerName: string; orgName: string; termsText: string; termsVersion: number }`
  - `interface PortalSession { sessionToken: string; expiresAt: string }`
  - `interface PortalMe { partnerName: string; email: string; orgName: string }`
  - `class PortalApiError extends Error { readonly status: number; readonly code: string }`
  - `portalApi: { brand(slug): Promise<PortalBrand | null>; requestCode(slug, email): Promise<void>; verifyCode(slug, email, code): Promise<PortalSession>; peekInvite(slug, token): Promise<PortalInvite | null>; acceptInvite(slug, token, termsVersion): Promise<PortalSession>; me(slug, sessionToken): Promise<PortalMe | null>; signOut(sessionToken): Promise<void> }`
  - `portalSessionKey(slug: string): string`, `readPortalSession(slug: string): string | null`, `writePortalSession(slug: string, token: string): void`, `clearPortalSession(slug: string): void`
  - `portalAddress(slug: string, origin?: string): string`
  - `PORTAL_BRAND_VARS: readonly string[]`, `applyPortalBrandVars(primaryColor: string | null, isDark: boolean): void`, `PortalBrandProvider({ brand, children }: { brand: PortalBrand; children: React.ReactNode })`

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/portal/lib/portalApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PORTAL_API_URL, PortalApiError, portalApi } from "./portalApi";

const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as unknown,
  };
}

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portalApi", () => {
  it("POSTs to the action path with the anon key and no session header", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { brand: BRAND }));
    await expect(portalApi.brand("acme")).resolves.toEqual(BRAND);
    const call = lastCall();
    expect(call.url).toBe(`${PORTAL_API_URL}/brand`);
    expect(call.init.method).toBe("POST");
    expect(call.headers.apikey).toBeTruthy();
    expect(call.headers.Authorization).toBe(`Bearer ${call.headers.apikey}`);
    expect(call.headers["x-portal-session"]).toBeUndefined();
    expect(call.body).toEqual({ slug: "acme" });
  });

  it("returns null for an unavailable portal and throws on a server error", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_available" }));
    await expect(portalApi.brand("nope")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(respond(500, { error: "server_error" }));
    await expect(portalApi.brand("acme")).rejects.toMatchObject({ status: 500, code: "server_error" });
  });

  it("requests a code with the slug and email", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.requestCode("acme", "jane@example.com");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/request_code`);
    expect(lastCall().body).toEqual({ slug: "acme", email: "jane@example.com" });
  });

  it("verifies a code and surfaces invalid_code as a PortalApiError", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { sessionToken: "t1", expiresAt: "2026-11-08T00:00:00Z" }));
    await expect(portalApi.verifyCode("acme", "jane@example.com", "123456")).resolves.toEqual({
      sessionToken: "t1",
      expiresAt: "2026-11-08T00:00:00Z",
    });
    expect(lastCall().body).toEqual({ slug: "acme", email: "jane@example.com", code: "123456" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "invalid_code" }));
    const err = await portalApi.verifyCode("acme", "jane@example.com", "000000").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortalApiError);
    expect(err).toMatchObject({ status: 401, code: "invalid_code" });
  });

  it("peeks an invite and returns null when it is no longer valid", async () => {
    const invite = { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 };
    fetchMock.mockResolvedValueOnce(respond(200, { invite }));
    await expect(portalApi.peekInvite("acme", "tok")).resolves.toEqual(invite);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok" });
    fetchMock.mockResolvedValueOnce(respond(404, { error: "invalid_invite" }));
    await expect(portalApi.peekInvite("acme", "old")).resolves.toBeNull();
  });

  it("accepts an invite with the terms version and reports terms_changed", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { sessionToken: "t2", expiresAt: "x" }));
    await portalApi.acceptInvite("acme", "tok", 2);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok", termsVersion: 2 });
    fetchMock.mockResolvedValueOnce(respond(409, { error: "terms_changed" }));
    await expect(portalApi.acceptInvite("acme", "tok", 1)).rejects.toMatchObject({ status: 409, code: "terms_changed" });
  });

  it("sends the session in x-portal-session for me and sign_out", async () => {
    const me = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
    fetchMock.mockResolvedValueOnce(respond(200, { me }));
    await expect(portalApi.me("acme", "sess")).resolves.toEqual(me);
    expect(lastCall().headers["x-portal-session"]).toBe("sess");
    expect(lastCall().body).toEqual({ slug: "acme" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "unauthorized" }));
    await expect(portalApi.me("acme", "dead")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.signOut("sess");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/sign_out`);
    expect(lastCall().headers["x-portal-session"]).toBe("sess");
  });

  it("maps a network failure and a non-JSON error body", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(portalApi.requestCode("acme", "a@b.co")).rejects.toMatchObject({ status: 0, code: "network_error" });
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(portalApi.requestCode("acme", "a@b.co")).rejects.toMatchObject({ status: 502, code: "request_failed" });
  });
});
```

Create `apps/app/src/features/portal/lib/portalSession.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearPortalSession, portalSessionKey, readPortalSession, writePortalSession } from "./portalSession";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPortalSession("acme");
  clearPortalSession("beta");
});

describe("portal session storage", () => {
  it("keeps one session per slug under a portal-only key", () => {
    writePortalSession("acme", "t1");
    writePortalSession("beta", "t2");
    expect(portalSessionKey("acme")).toBe("navigatr-portal-session:acme");
    expect(localStorage.getItem("navigatr-portal-session:acme")).toBe("t1");
    expect(readPortalSession("beta")).toBe("t2");
    expect(Object.keys(localStorage).every((k) => k.startsWith("navigatr-portal-session:"))).toBe(true);
  });

  it("clears a session", () => {
    writePortalSession("acme", "t1");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readPortalSession("acme")).toBeNull();
  });

  it("falls back to memory when storage throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writePortalSession("acme", "t3");
    expect(readPortalSession("acme")).toBe("t3");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });
});
```

Create `apps/app/src/features/portal/lib/portalAddress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { portalAddress } from "./portalAddress";

describe("portalAddress", () => {
  it("builds the shareable portal address from an origin and slug", () => {
    expect(portalAddress("acme", "https://app.getnavigatr.io/")).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("defaults to the current origin", () => {
    expect(portalAddress("acme")).toBe(`${window.location.origin}/p/acme`);
  });
});
```

Create `apps/app/src/features/portal/PortalBrandProvider.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PortalBrandProvider } from "./PortalBrandProvider";
import { deriveBrandVars } from "@/features/branding/colorShades";
import { useTheme } from "@/stores/theme";
import type { PortalBrand } from "./lib/portalApi";

const BRAND: PortalBrand = {
  orgName: "Acme ISO",
  productName: "navigatr",
  primaryColor: "#0f766e",
  logoUrl: null,
  darkLogoUrl: null,
};

describe("PortalBrandProvider", () => {
  it("applies the tenant color and tab title, and resets both on unmount", () => {
    document.title = "navigatr";
    const { unmount, getByText } = render(
      <PortalBrandProvider brand={BRAND}>
        <p>child</p>
      </PortalBrandProvider>,
    );
    expect(getByText("child")).toBeInTheDocument();
    const isDark = useTheme.getState().resolvedTheme === "dark";
    const expected = deriveBrandVars("#0f766e", isDark);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-brand-primary")).toBe(expected?.primary);
    expect(root.style.getPropertyValue("--color-brand-primary-foreground")).toBe(expected?.foreground);
    expect(document.title).toBe("Acme ISO");

    unmount();
    expect(root.style.getPropertyValue("--color-brand-primary")).toBe("");
    expect(document.title).toBe("navigatr");
  });

  it("keeps the design-system defaults when the tenant has no color", () => {
    render(
      <PortalBrandProvider brand={{ ...BRAND, primaryColor: null }}>
        <p>child</p>
      </PortalBrandProvider>,
    );
    expect(document.documentElement.style.getPropertyValue("--color-brand-primary")).toBe("");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/portal`
Expected: FAIL, cannot resolve `./portalApi`, `./portalSession`, `./portalAddress`, `./PortalBrandProvider`.

- [ ] **Step 3: Implement**

Create `apps/app/src/features/portal/lib/portalApi.ts`:

```ts
/**
 * Partner portal API client (spec 5.11).
 *
 * Talks to the portal_api edge function with plain fetch, deliberately NOT
 * supabase.functions.invoke: the app's session guard (lib/sessionGuard.ts)
 * rewrites an anon bearer into an internal user's JWT, and a partner request
 * must never carry one. The partner's own session travels in x-portal-session.
 *
 * Expected outcomes come back as values, not errors (an unavailable portal or a
 * dead invite is null, a dead session from me() is null), so React Query does
 * not report them to Sentry as failures.
 */
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321";
const ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || "test-anon-key-placeholder";

export const PORTAL_API_URL = `${SUPABASE_URL}/functions/v1/portal_api`;

export interface PortalBrand {
  orgName: string;
  productName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
}

export interface PortalInvite {
  partnerName: string;
  orgName: string;
  termsText: string;
  termsVersion: number;
}

export interface PortalSession {
  sessionToken: string;
  expiresAt: string;
}

export interface PortalMe {
  partnerName: string;
  email: string;
  orgName: string;
}

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "PortalApiError";
    this.status = status;
    this.code = code;
  }
}

type PortalAction = "brand" | "request_code" | "verify_code" | "peek_invite" | "accept_invite" | "me" | "sign_out";

async function portalRequest<T>(
  action: PortalAction,
  body: Record<string, unknown>,
  sessionToken?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
  if (sessionToken) headers["x-portal-session"] = sessionToken;

  let res: Response;
  try {
    res = await fetch(`${PORTAL_API_URL}/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new PortalApiError(0, "network_error");
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const code =
      payload !== null && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "request_failed";
    throw new PortalApiError(res.status, code);
  }
  return payload as T;
}

function nullOn(status: number) {
  return (err: unknown): null => {
    if (err instanceof PortalApiError && err.status === status) return null;
    throw err;
  };
}

export const portalApi = {
  brand(slug: string): Promise<PortalBrand | null> {
    return portalRequest<{ brand: PortalBrand }>("brand", { slug }).then((r) => r.brand, nullOn(404));
  },

  async requestCode(slug: string, email: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("request_code", { slug, email });
  },

  verifyCode(slug: string, email: string, code: string): Promise<PortalSession> {
    return portalRequest<PortalSession>("verify_code", { slug, email, code });
  },

  peekInvite(slug: string, token: string): Promise<PortalInvite | null> {
    return portalRequest<{ invite: PortalInvite }>("peek_invite", { slug, token }).then((r) => r.invite, nullOn(404));
  },

  acceptInvite(slug: string, token: string, termsVersion: number): Promise<PortalSession> {
    return portalRequest<PortalSession>("accept_invite", { slug, token, termsVersion });
  },

  me(slug: string, sessionToken: string): Promise<PortalMe | null> {
    return portalRequest<{ me: PortalMe }>("me", { slug }, sessionToken).then((r) => r.me, nullOn(401));
  },

  async signOut(sessionToken: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("sign_out", {}, sessionToken);
  },
};
```

Create `apps/app/src/features/portal/lib/portalSession.ts`:

```ts
/**
 * Partner portal session storage (spec 5.3). One token per tenant slug, under a
 * portal-only key, never shared with the app's Supabase session. Every storage
 * access is wrapped: private browsing or blocked site data must not break
 * sign-in, so a write that storage refuses is kept in memory for this page view.
 */
const memory = new Map<string, string>();

export function portalSessionKey(slug: string): string {
  return `navigatr-portal-session:${slug}`;
}

export function readPortalSession(slug: string): string | null {
  const key = portalSessionKey(slug);
  try {
    return window.localStorage.getItem(key) || null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePortalSession(slug: string, token: string): void {
  const key = portalSessionKey(slug);
  memory.set(key, token);
  try {
    window.localStorage.setItem(key, token);
  } catch {
    // Storage refused (private mode); the in-memory copy covers this page view.
  }
}

export function clearPortalSession(slug: string): void {
  const key = portalSessionKey(slug);
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored that we can reach; the in-memory copy is already gone.
  }
}
```

Create `apps/app/src/features/portal/lib/portalAddress.ts`:

```ts
/** The partner-facing portal address for a tenant (spec 5.3, FR-PORT-23). */
export function portalAddress(slug: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}`;
}
```

Create `apps/app/src/features/portal/PortalBrandProvider.tsx`:

```tsx
/**
 * PortalBrandProvider: themes the partner portal with the tenant's color and
 * name before anyone signs in (spec 5.4).
 *
 * The app's BrandProvider reads the signed-in org and takes no brand prop, so
 * the portal sets the same CSS variables from the brand the portal_api returned,
 * reusing deriveBrandVars so a tenant color looks the same in both places. On
 * unmount it removes the overrides and restores the tab title.
 */
import * as React from "react";
import { useTheme } from "@/stores/theme";
import { deriveBrandVars } from "@/features/branding/colorShades";
import type { PortalBrand } from "./lib/portalApi";

export const PORTAL_BRAND_VARS = [
  "--color-brand-primary",
  "--color-brand-primary-hover",
  "--color-brand-primary-pressed",
  "--color-brand-primary-foreground",
  "--color-brand-primary-10",
  "--color-brand-gradient-from",
  "--color-brand-gradient-via",
  "--color-brand-gradient-to",
] as const;

export function applyPortalBrandVars(primaryColor: string | null, isDark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = primaryColor ? deriveBrandVars(primaryColor, isDark) : null;
  if (!vars) {
    PORTAL_BRAND_VARS.forEach((name) => root.style.removeProperty(name));
    return;
  }
  root.style.setProperty("--color-brand-primary", vars.primary);
  root.style.setProperty("--color-brand-primary-hover", vars.hover);
  root.style.setProperty("--color-brand-primary-pressed", vars.pressed);
  root.style.setProperty("--color-brand-primary-foreground", vars.foreground);
  root.style.setProperty("--color-brand-primary-10", vars.tint10);
  root.style.setProperty("--color-brand-gradient-from", vars.gradientFrom);
  root.style.setProperty("--color-brand-gradient-via", vars.gradientVia);
  root.style.setProperty("--color-brand-gradient-to", vars.gradientTo);
}

export function PortalBrandProvider({ brand, children }: { brand: PortalBrand; children: React.ReactNode }) {
  const isDark = useTheme((s) => s.resolvedTheme) === "dark";

  React.useEffect(() => {
    applyPortalBrandVars(brand.primaryColor, isDark);
    return () => applyPortalBrandVars(null, isDark);
  }, [brand.primaryColor, isDark]);

  React.useEffect(() => {
    const previous = document.title;
    document.title = brand.orgName;
    return () => {
      document.title = previous;
    };
  }, [brand.orgName]);

  return <>{children}</>;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS (`portalApi.test.ts` 8, `portalSession.test.ts` 4, `portalAddress.test.ts` 2, `PortalBrandProvider.test.tsx` 2).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/portal
git commit -m "$(cat <<'EOF'
feat(portal): fetch client, per-slug session storage, and tenant theming

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Portal route tree, sign-in, landing page, unavailable page

**Files:**
- Create: `apps/app/src/features/portal/components/PortalShell.tsx`
- Create: `apps/app/src/features/portal/pages/PortalUnavailablePage.tsx`
- Create: `apps/app/src/features/portal/pages/PortalSignInPage.tsx`
- Create: `apps/app/src/features/portal/pages/PortalHomePage.tsx`
- Create: `apps/app/src/features/portal/pages/PortalRoot.tsx`
- Test: `apps/app/src/features/portal/pages/PortalRoot.test.tsx`
- Modify: `apps/app/src/App.tsx`

**Interfaces:**
- Consumes: Task 8 (`portalApi`, `PortalApiError`, `PortalBrand`, `readPortalSession`, `writePortalSession`, `clearPortalSession`, `PortalBrandProvider`); `Logo` (`@/components/layout/Logo`, props `size`, `wordmark`, `logoSrc`, `logoSrcDark`); `Button`, `Card`, `FormField`, `Input` from `@/components/navigatr`.
- Produces:
  - `PortalShell({ brand, children }: { brand: PortalBrand; children: React.ReactNode })`
  - `PortalUnavailablePage()`
  - `PortalSignInPage({ slug, brand }: { slug: string; brand: PortalBrand })`
  - `PortalHomePage({ slug }: { slug: string })`
  - `PortalRoot()` mounted at `/p/:slug/*`: index is sign-in, `home` is the landing page, anything else redirects to `/p/:slug`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalRoot.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { clearPortalSession, readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  clearPortalSession("acme");
  localStorage.clear();
});

describe("PortalRoot", () => {
  it("shows a generic page with no tenant detail for an unknown or disabled portal", async () => {
    api.brand.mockResolvedValue(null);
    renderAt("/p/nope");
    expect(await screen.findByRole("heading", { name: "This portal isn't available" })).toBeInTheDocument();
    expect(screen.queryByText(/acme/i)).toBeNull();
    expect(api.brand).toHaveBeenCalledWith("nope");
  });

  it("signs a partner in with an email code and lands on the home page", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockResolvedValue(undefined);
    api.verifyCode.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue(ME);

    renderAt("/p/acme");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(screen.queryByText(/navigatr/i)).toBeNull();

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(api.requestCode).toHaveBeenCalledWith("acme", "jane@example.com");
    expect(await screen.findByText(/we sent a 6-digit code/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(api.verifyCode).toHaveBeenCalledWith("acme", "jane@example.com", "123456");

    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.me).toHaveBeenCalledWith("acme", "s".repeat(64));
    expect(readPortalSession("acme")).toBe("s".repeat(64));
  });

  it("asks for a valid email before sending a code", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it("says plainly when a code is wrong", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockResolvedValue(undefined);
    api.verifyCode.mockRejectedValue(new PortalApiError(401, "invalid_code"));

    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work. Check it, or send a new one.");
    expect(readPortalSession("acme")).toBeNull();
  });

  it("sends a partner with an expired session back to sign-in and forgets it", async () => {
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(null);
    writePortalSession("acme", "old");

    renderAt("/p/acme/home");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("goes straight to home when a session is already stored", async () => {
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    writePortalSession("acme", "live");

    renderAt("/p/acme");
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
  });

  it("signs out, revoking the session server-side", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    api.signOut.mockResolvedValue(undefined);
    writePortalSession("acme", "live");

    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(api.signOut).toHaveBeenCalledWith("live");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalRoot.test.tsx`
Expected: FAIL, cannot resolve `./PortalRoot`.

- [ ] **Step 3: Implement the shell and pages**

Create `apps/app/src/features/portal/components/PortalShell.tsx`:

```tsx
/**
 * PortalShell: the partner-facing frame. Shows the ISO's logo and name, never
 * the navigatr mark (AuthShell hardcodes it, so the portal has its own shell).
 * Mobile-first: one narrow column that reads well at 360px.
 */
import * as React from "react";
import { Logo } from "@/components/layout/Logo";
import type { PortalBrand } from "../lib/portalApi";

export function PortalShell({ brand, children }: { brand: PortalBrand; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-14 items-center border-b border-border-subtle bg-surface-default px-4">
        {brand.logoUrl ? (
          <Logo
            size="sm"
            wordmark={brand.orgName}
            logoSrc={brand.logoUrl}
            logoSrcDark={brand.darkLogoUrl ?? undefined}
          />
        ) : (
          <span className="truncate text-heading-sm text-text-default">{brand.orgName}</span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">{children}</main>
    </div>
  );
}
```

Create `apps/app/src/features/portal/pages/PortalUnavailablePage.tsx`:

```tsx
/**
 * Shown for an unknown slug or a portal that is turned off. Deliberately says
 * nothing about any tenant (spec 5.4).
 */
import { Unlink } from "lucide-react";

export function PortalUnavailablePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
          <Unlink className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-heading-lg text-text-default">This portal isn&apos;t available</h1>
        <p className="text-body-md text-text-muted">
          Check the link you were sent, or ask the person who invited you for a new one.
        </p>
      </div>
    </div>
  );
}
```

Create `apps/app/src/features/portal/pages/PortalSignInPage.tsx`:

```tsx
/**
 * Partner sign-in (spec 5.3, R1): email, then a 6-digit code. The server always
 * answers the same way whether or not the email has access (NFR-PORT-04), so
 * this page never says "no account found".
 */
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { Button, Card, FormField, Input } from "@/components/navigatr";
import { PortalApiError, portalApi, type PortalBrand } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PortalSignInPage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const [existing] = React.useState(() => readPortalSession(slug));
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (existing) return <Navigate to={`/p/${slug}/home`} replace />;

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await portalApi.requestCode(slug, trimmed);
      setCode("");
      setStep("code");
    } catch {
      setError("We couldn't send a code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await portalApi.verifyCode(slug, email.trim(), code);
      writePortalSession(slug, session.sessionToken);
      navigate(`/p/${slug}/home`, { replace: true });
    } catch (err) {
      setError(
        err instanceof PortalApiError && err.status === 401
          ? "That code didn't work. Check it, or send a new one."
          : "We couldn't sign you in. Try again.",
      );
      setBusy(false);
    }
  };

  if (step === "code") {
    return (
      <Card padding="lg">
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-brand-primary-10 text-brand-primary">
            <Mail className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Check your email</h1>
            <p className="text-body-md text-text-muted">
              If {email.trim()} has access, we sent a 6-digit code. It works for 15 minutes.
            </p>
          </div>
          <FormField label="6-digit code" htmlFor="portal-code">
            <Input
              id="portal-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-heading-sm tracking-[0.4em] tabular-nums"
            />
          </FormField>
          {error && (
            <p role="alert" className="text-body-sm text-status-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={code.length !== 6 || busy}>
            Sign in
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="md"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            Send a new code
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Sign in to {brand.orgName}</h1>
          <p className="text-body-md text-text-muted">
            Use the email {brand.orgName} invited. We&apos;ll send you a 6-digit code.
          </p>
        </div>
        <FormField label="Email" htmlFor="portal-email">
          <Input
            id="portal-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        {error && (
          <p role="alert" className="text-body-sm text-status-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy} disabled={busy}>
          Email me a code
        </Button>
      </form>
    </Card>
  );
}
```

Create `apps/app/src/features/portal/pages/PortalHomePage.tsx`:

```tsx
/**
 * Signed-in landing page (Phase 1A). Proves the session works and lets the
 * partner sign out. Referral submission and tracking arrive in Phase 1B.
 */
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { portalApi } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";

export function PortalHomePage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [token] = React.useState(() => readPortalSession(slug));
  const [signingOut, setSigningOut] = React.useState(false);

  const me = useQuery({
    queryKey: ["portal", "me", slug, token],
    queryFn: () => portalApi.me(slug, token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  const expired = me.isSuccess && me.data === null;
  React.useEffect(() => {
    if (!expired) return;
    clearPortalSession(slug);
    navigate(`/p/${slug}`, { replace: true });
  }, [expired, slug, navigate]);

  if (!token) return <Navigate to={`/p/${slug}`} replace />;
  const sessionToken: string = token;

  if (me.isPending || expired) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  if (me.isError || !me.data) {
    return (
      <Card padding="lg" className="flex flex-col gap-3">
        <p className="text-body-md text-text-default">
          We couldn&apos;t load your account. Check your connection and try again.
        </p>
        <Button variant="secondary" size="md" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const account = me.data;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await portalApi.signOut(sessionToken);
    } catch {
      // The session is forgotten on this device either way.
    }
    clearPortalSession(slug);
    navigate(`/p/${slug}`, { replace: true });
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <h1 className="text-heading-lg text-text-default">You&apos;re signed in</h1>
      <p className="text-body-md text-text-default">
        Signed in as {account.partnerName} at {account.orgName}
      </p>
      <p className="text-body-md text-text-muted">
        Soon you&apos;ll be able to send referrals and follow each one here.
      </p>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        leadingIcon={LogOut}
        loading={signingOut}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </Card>
  );
}
```

Create `apps/app/src/features/portal/pages/PortalRoot.tsx`:

```tsx
/**
 * PortalRoot: the partner portal's route tree, mounted at /p/:slug/* outside
 * ProtectedRoute and PublicOnlyRoute (spec 5.11). Partners have no Supabase
 * session; this tree only talks to portal_api.
 *
 * Branding loads first, with no session (spec 5.4). An unknown or disabled slug
 * renders a generic page with no tenant detail.
 */
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { portalApi } from "../lib/portalApi";
import { PortalBrandProvider } from "../PortalBrandProvider";
import { PortalShell } from "../components/PortalShell";
import { PortalUnavailablePage } from "./PortalUnavailablePage";
import { PortalSignInPage } from "./PortalSignInPage";
import { PortalHomePage } from "./PortalHomePage";

export function PortalRoot() {
  const { slug: rawSlug = "" } = useParams<{ slug: string }>();
  const slug = rawSlug.trim().toLowerCase();

  const brand = useQuery({
    queryKey: ["portal", "brand", slug],
    queryFn: () => portalApi.brand(slug),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (brand.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (brand.isError || !brand.data) return <PortalUnavailablePage />;

  const data = brand.data;
  return (
    <PortalBrandProvider brand={data}>
      <PortalShell brand={data}>
        <Routes>
          <Route index element={<PortalSignInPage slug={slug} brand={data} />} />
          <Route path="home" element={<PortalHomePage slug={slug} />} />
          <Route path="*" element={<Navigate to={`/p/${slug}`} replace />} />
        </Routes>
      </PortalShell>
    </PortalBrandProvider>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalRoot.test.tsx`
Expected: PASS (7 tests), no `act()` warnings in the output.

- [ ] **Step 5: Mount the route in `App.tsx`**

In `apps/app/src/App.tsx`, replace:

```tsx
const PrivacyPage = lazy(() =>
  import("@/features/legal/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
```

with:

```tsx
const PrivacyPage = lazy(() =>
  import("@/features/legal/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);

// Partner portal (public, its own sign-in; partners are never Supabase users).
const PortalRoot = lazy(() =>
  import("@/features/portal/pages/PortalRoot").then((m) => ({ default: m.PortalRoot })),
);
```

and replace:

```tsx
          <Route path="/privacy" element={<PrivacyPage />} />
```

with:

```tsx
          <Route path="/privacy" element={<PrivacyPage />} />

          {/* ===== Partner portal ===== */}
          {/* Its own session in localStorage, never a Supabase session. Must
              stay outside PublicOnlyRoute and ProtectedRoute (spec 5.11). */}
          <Route path="/p/:slug/*" element={<PortalRoot />} />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter app exec tsc -b`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/portal apps/app/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(portal): branded partner sign-in with email code and a signed-in landing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Invite accept and terms page

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalInvitePage.tsx`
- Test: `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: `portalApi.peekInvite`, `portalApi.acceptInvite`, `PortalApiError`, `PortalBrand` (Task 8); `writePortalSession` (Task 8); `Button`, `Card`, `Checkbox` from `@/components/navigatr` (`Checkbox` props `checked`, `onCheckedChange(checked: boolean)`, `id`, `label`).
- Produces: `PortalInvitePage({ slug, brand }: { slug: string; brand: PortalBrand })` at `/p/:slug/invite?token=...`. Shows the terms; "Accept and continue" posts the version the partner read; `terms_changed` reloads the terms and asks again; a dead invite shows a plain explanation and a link to sign in.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const INVITE = { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 };

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  clearPortalSession("acme");
  localStorage.clear();
});

describe("PortalInvitePage", () => {
  it("shows the ISO's terms and only accepts once the partner agrees", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });

    renderAt("/p/acme/invite?token=tok");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenCalledWith("acme", "tok");
    expect(screen.getByText("Be fair.")).toBeInTheDocument();

    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "I agree to these terms" }));
    expect(accept).toBeEnabled();
    await user.click(accept);

    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "tok", 2);
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(readPortalSession("acme")).toBe("s".repeat(64));
  });

  it("reloads the terms and asks again when they changed", async () => {
    const user = userEvent.setup();
    api.peekInvite
      .mockResolvedValueOnce(INVITE)
      .mockResolvedValueOnce({ ...INVITE, termsText: "New terms.", termsVersion: 3 });
    api.acceptInvite.mockRejectedValueOnce(new PortalApiError(409, "terms_changed"));

    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: "I agree to these terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The terms were just updated. Please read them again.");
    expect(await screen.findByText("New terms.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I agree to these terms" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("explains an expired or used invite", async () => {
    api.peekInvite.mockResolvedValue(null);
    renderAt("/p/acme/invite?token=old");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask your contact at Acme ISO/)).toBeInTheDocument();
  });

  it("treats a link with no token as expired without calling the server", async () => {
    renderAt("/p/acme/invite");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(api.peekInvite).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalInvitePage.test.tsx`
Expected: FAIL (the `invite` path falls through to the catch-all redirect, so the "Welcome, Jane" heading never renders).

- [ ] **Step 3: Implement**

Create `apps/app/src/features/portal/pages/PortalInvitePage.tsx`:

```tsx
/**
 * Accept a portal invite (spec 5.3, FR-PORT-18): read the ISO's partner terms,
 * agree, continue. Accepting records the time, IP and terms version server-side
 * and signs the partner in. A partner who does not agree just leaves; nothing
 * changes.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button, Card, Checkbox } from "@/components/navigatr";
import { PortalApiError, portalApi, type PortalBrand } from "../lib/portalApi";
import { writePortalSession } from "../lib/portalSession";

function InviteUnavailable({ slug, orgName }: { slug: string; orgName: string }) {
  const navigate = useNavigate();
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h1 className="text-heading-lg text-text-default">This invite link has expired or was already used</h1>
      <p className="text-body-md text-text-muted">
        Ask your contact at {orgName} to send a new one. If you already accepted, sign in instead.
      </p>
      <Button variant="secondary" size="md" onClick={() => navigate(`/p/${slug}`)}>
        Go to sign in
      </Button>
    </Card>
  );
}

export function PortalInvitePage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = (params.get("token") ?? "").trim();
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const invite = useQuery({
    queryKey: ["portal", "invite", slug, token],
    queryFn: () => portalApi.peekInvite(slug, token),
    enabled: token.length > 0,
    retry: false,
  });

  if (!token) return <InviteUnavailable slug={slug} orgName={brand.orgName} />;
  if (invite.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (invite.isError || !invite.data) return <InviteUnavailable slug={slug} orgName={brand.orgName} />;

  const data = invite.data;

  const accept = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const session = await portalApi.acceptInvite(slug, token, data.termsVersion);
      writePortalSession(slug, session.sessionToken);
      navigate(`/p/${slug}/home`, { replace: true });
    } catch (err) {
      if (err instanceof PortalApiError && err.code === "terms_changed") {
        setAgreed(false);
        setNotice("The terms were just updated. Please read them again.");
        await invite.refetch();
      } else {
        setNotice("This invite can't be used anymore. Ask your contact for a new one.");
      }
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">Welcome, {data.partnerName}</h1>
        <p className="text-body-md text-text-muted">
          {data.orgName} invited you to their referral portal. Read and accept the terms to continue.
        </p>
      </div>

      <section aria-labelledby="portal-terms-heading" className="flex flex-col gap-2">
        <h2 id="portal-terms-heading" className="text-body-strong text-text-default">
          Partner terms
        </h2>
        <div
          tabIndex={0}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-radius-md border border-border-default bg-surface-sunken p-3 text-body-md text-text-default"
        >
          {data.termsText}
        </div>
      </section>

      {notice && (
        <p role="alert" className="text-body-sm text-status-danger">
          {notice}
        </p>
      )}

      <Checkbox
        id="portal-terms-agree"
        checked={agreed}
        onCheckedChange={setAgreed}
        label="I agree to these terms"
      />

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!agreed || busy}
        onClick={() => void accept()}
      >
        Accept and continue
      </Button>
      <p className="text-caption text-text-subtle">If you don&apos;t agree, just close this page.</p>
    </Card>
  );
}
```

In `apps/app/src/features/portal/pages/PortalRoot.tsx`, replace:

```tsx
import { PortalHomePage } from "./PortalHomePage";
```

with:

```tsx
import { PortalHomePage } from "./PortalHomePage";
import { PortalInvitePage } from "./PortalInvitePage";
```

and replace:

```tsx
          <Route path="home" element={<PortalHomePage slug={slug} />} />
```

with:

```tsx
          <Route path="invite" element={<PortalInvitePage slug={slug} brand={data} />} />
          <Route path="home" element={<PortalHomePage slug={slug} />} />
```

- [ ] **Step 4: Run the portal tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS (all portal tests, including `PortalInvitePage.test.tsx` 4 tests), no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/portal
git commit -m "$(cat <<'EOF'
feat(portal): accept an invite by agreeing to the ISO's partner terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Portal controls on Partner Detail (invite, status, suspend, revoke, restore, copy address)

**Files:**
- Create: `apps/app/src/features/partners/lib/portalAccess.ts` (+ `portalAccess.test.ts`)
- Create: `apps/app/src/features/partners/hooks/usePortalAccess.ts` (+ `usePortalAccess.test.tsx`)
- Create: `apps/app/src/features/partners/components/PortalAccess.tsx` (+ `PortalAccess.test.tsx`)
- Modify: `apps/app/src/features/partners/pages/PartnerDetailPage.tsx` (+ `PartnerDetailPage.test.tsx`)

**Interfaces:**
- Consumes: SQL `get_portal_status()`, `portal_set_access(p_partner_id uuid, p_status text)`, table `portal_users` columns `partner_id, status, invited_at, activated_at, last_login_at` (Tasks 1 and 4); the `portal_invite` edge function (Task 7); `portalAddress` (Task 8); `useAuth` from `@/stores/auth`.
- Produces:
  - `lib/portalAccess.ts`: `type PortalUserStatus = "invited" | "active" | "suspended" | "revoked"`, `type PortalAccessChange = "suspended" | "revoked" | "invited"`, `PORTAL_STATUS_LABEL: Record<PortalUserStatus, string>`, `portalAccessErrorMessage(err: unknown): string`, `functionErrorCode(error: unknown, fallback: string): Promise<string>`.
  - `hooks/usePortalAccess.ts`: `interface PortalStatus { enabled: boolean; slug: string }`, `interface PartnerPortalUser { partnerId: string; status: PortalUserStatus; invitedAt: string | null; activatedAt: string | null; lastLoginAt: string | null }`, `PORTAL_STATUS_QUERY_KEY(userId?: string)`, `PARTNER_PORTAL_USER_QUERY_KEY(partnerId?: string)`, `usePortalStatus()`, `usePartnerPortalUser(partnerId: string | undefined)`, `useInviteToPortal()` (mutation `(partnerId: string) => Promise<{ emailed: boolean }>`), `useSetPortalAccess()` (mutation `({ partnerId, status }: { partnerId: string; status: PortalAccessChange }) => Promise<PortalUserStatus>`).
  - `components/PortalAccess.tsx`: `PortalInviteButton({ partnerId, email }: { partnerId: string; email: string | null | undefined })`, `PortalAccessLine({ partnerId }: { partnerId: string })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/lib/portalAccess.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PORTAL_STATUS_LABEL, functionErrorCode, portalAccessErrorMessage } from "./portalAccess";

describe("PORTAL_STATUS_LABEL", () => {
  it("labels every portal status", () => {
    expect(PORTAL_STATUS_LABEL).toEqual({
      invited: "Invited",
      active: "Active",
      suspended: "Suspended",
      revoked: "Revoked",
    });
  });
});

describe("portalAccessErrorMessage", () => {
  it("maps server tokens to plain copy", () => {
    expect(portalAccessErrorMessage(new Error("portal_disabled"))).toBe(
      "The partner portal is turned off. An admin can turn it on in Settings.",
    );
    expect(portalAccessErrorMessage({ message: "partner_email_required" })).toBe("Add an email for this partner first.");
    expect(portalAccessErrorMessage({ message: "portal_email_in_use" })).toBe(
      "Another partner already uses this email for the portal.",
    );
    expect(portalAccessErrorMessage({ message: "email_failed" })).toBe(
      "The invite was created but the email didn't send. Try Resend invite.",
    );
    expect(portalAccessErrorMessage({ message: "partner_not_visible" })).toBe("You don't have access to do that.");
  });

  it("falls back for anything else", () => {
    expect(portalAccessErrorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
    expect(portalAccessErrorMessage(undefined)).toBe("Something went wrong. Try again.");
  });
});

describe("functionErrorCode", () => {
  it("reads the error token from an edge function error response", async () => {
    const error = { message: "non-2xx", context: new Response(JSON.stringify({ error: "portal_disabled" }), { status: 409 }) };
    await expect(functionErrorCode(error, "invite_failed")).resolves.toBe("portal_disabled");
  });

  it("falls back when there is no readable body", async () => {
    await expect(functionErrorCode({ message: "x" }, "invite_failed")).resolves.toBe("invite_failed");
    const html = { context: new Response("<html></html>", { status: 502 }) };
    await expect(functionErrorCode(html, "invite_failed")).resolves.toBe("invite_failed");
  });
});
```

Create `apps/app/src/features/partners/hooks/usePortalAccess.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const maybeSingleMock = vi.fn();
const calls: unknown[][] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => {
          calls.push(["select", ...a]);
          return chain;
        },
        eq: (...a: unknown[]) => {
          calls.push(["eq", ...a]);
          return chain;
        },
        maybeSingle: () => maybeSingleMock(),
      };
      return chain;
    },
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import {
  useInviteToPortal,
  usePartnerPortalUser,
  usePortalStatus,
  useSetPortalAccess,
} from "./usePortalAccess";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  maybeSingleMock.mockReset();
  calls.length = 0;
});

describe("usePortalStatus", () => {
  it("reads whether the org portal is on and its slug", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ enabled: true, slug: "acme" }], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePortalStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ enabled: true, slug: "acme" });
    expect(rpcMock).toHaveBeenCalledWith("get_portal_status");
  });
});

describe("usePartnerPortalUser", () => {
  it("reads only the safe portal_users columns", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { partner_id: "p-1", status: "active", invited_at: "a", activated_at: "b", last_login_at: "c" },
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePartnerPortalUser("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      partnerId: "p-1",
      status: "active",
      invitedAt: "a",
      activatedAt: "b",
      lastLoginAt: "c",
    });
    expect(calls).toContainEqual(["from", "portal_users"]);
    expect(calls).toContainEqual(["select", "partner_id, status, invited_at, activated_at, last_login_at"]);
    expect(calls).toContainEqual(["eq", "partner_id", "p-1"]);
  });

  it("returns null when the partner was never invited", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePartnerPortalUser("p-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useInviteToPortal", () => {
  it("invokes portal_invite and refreshes the partner's portal status", async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, emailed: true }, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).resolves.toEqual({ emailed: true });
    expect(invokeMock).toHaveBeenCalledWith("portal_invite", { body: { partnerId: "p-1" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });

  it("surfaces the server's error token", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ error: "portal_disabled" }), { status: 409 }) },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).rejects.toThrow("portal_disabled");
  });
});

describe("useSetPortalAccess", () => {
  it("calls portal_set_access and refreshes the partner's portal status", async () => {
    rpcMock.mockResolvedValueOnce({ data: "revoked", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useSetPortalAccess(), { wrapper });
    await expect(result.current.mutateAsync({ partnerId: "p-1", status: "revoked" })).resolves.toBe("revoked");
    expect(rpcMock).toHaveBeenCalledWith("portal_set_access", { p_partner_id: "p-1", p_status: "revoked" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });
});
```

Create `apps/app/src/features/partners/components/PortalAccess.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerPortalUser } from "../hooks/usePortalAccess";
import type { PortalUserStatus } from "../lib/portalAccess";

const state: {
  status: { data?: { enabled: boolean; slug: string } };
  user: { data: PartnerPortalUser | null; isPending: boolean };
} = {
  status: { data: { enabled: true, slug: "acme" } },
  user: { data: null, isPending: false },
};
const inviteMutate = vi.fn();
const setAccessMutate = vi.fn();

vi.mock("../hooks/usePortalAccess", () => ({
  usePortalStatus: () => state.status,
  usePartnerPortalUser: () => state.user,
  useInviteToPortal: () => ({ mutateAsync: inviteMutate, isPending: false }),
  useSetPortalAccess: () => ({ mutateAsync: setAccessMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { PortalAccessLine, PortalInviteButton } from "./PortalAccess";

function portalUser(status: PortalUserStatus): PartnerPortalUser {
  return { partnerId: "p-1", status, invitedAt: null, activatedAt: null, lastLoginAt: null };
}

beforeEach(() => {
  state.status = { data: { enabled: true, slug: "acme" } };
  state.user = { data: null, isPending: false };
  inviteMutate.mockReset();
  setAccessMutate.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PortalInviteButton", () => {
  it("is hidden when the org portal is off", () => {
    state.status = { data: { enabled: false, slug: "acme" } };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.queryByRole("button", { name: "Invite to portal" })).toBeNull();
  });

  it("is hidden when the partner has no email", () => {
    render(<PortalInviteButton partnerId="p-1" email="  " />);
    expect(screen.queryByRole("button", { name: "Invite to portal" })).toBeNull();
  });

  it("is hidden once the partner has access", () => {
    state.user = { data: portalUser("active"), isPending: false };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  });

  it("invites a partner who has not been invited", async () => {
    const user = userEvent.setup();
    inviteMutate.mockResolvedValueOnce({ emailed: true });
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    await user.click(screen.getByRole("button", { name: "Invite to portal" }));
    expect(inviteMutate).toHaveBeenCalledWith("p-1");
    expect(toast.success).toHaveBeenCalledWith("Invite sent to jane@example.com");
  });

  it("offers Resend invite while the invite is pending", () => {
    state.user = { data: portalUser("invited"), isPending: false };
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
  });

  it("explains a refusal in plain words", async () => {
    const user = userEvent.setup();
    inviteMutate.mockRejectedValueOnce(new Error("portal_disabled"));
    render(<PortalInviteButton partnerId="p-1" email="jane@example.com" />);
    await user.click(screen.getByRole("button", { name: "Invite to portal" }));
    expect(toast.error).toHaveBeenCalledWith("The partner portal is turned off. An admin can turn it on in Settings.");
  });
});

describe("PortalAccessLine", () => {
  it("is hidden when the org portal is off", () => {
    state.status = { data: { enabled: false, slug: "acme" } };
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.queryByText(/Portal:/)).toBeNull();
  });

  it("shows Not invited and copies the portal address", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.getByText("Portal: Not invited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Revoke access" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy portal address" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/acme`);
    expect(toast.success).toHaveBeenCalledWith("Portal address copied");
  });

  it("suspends or revokes an active partner", async () => {
    const user = userEvent.setup();
    state.user = { data: portalUser("active"), isPending: false };
    setAccessMutate.mockResolvedValueOnce("revoked");
    render(<PortalAccessLine partnerId="p-1" />);
    expect(screen.getByText("Portal: Active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Suspend access" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(setAccessMutate).toHaveBeenCalledWith({ partnerId: "p-1", status: "revoked" });
    expect(toast.success).toHaveBeenCalledWith("Portal access revoked");
  });

  it("restores a suspended partner back to invited", async () => {
    const user = userEvent.setup();
    state.user = { data: portalUser("suspended"), isPending: false };
    setAccessMutate.mockResolvedValueOnce("invited");
    render(<PortalAccessLine partnerId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Restore access" }));
    expect(setAccessMutate).toHaveBeenCalledWith({ partnerId: "p-1", status: "invited" });
  });
});
```

In `apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx`, replace:

```tsx
vi.mock("../components/ReferralPreviewSheet", () => ({
  ReferralPreviewSheet: ({ deal, open }: { deal: { id: string } | null; open: boolean }) =>
    open && deal ? <div data-testid="referral-preview" data-deal={deal.id} /> : null,
}));
```

with:

```tsx
vi.mock("../components/ReferralPreviewSheet", () => ({
  ReferralPreviewSheet: ({ deal, open }: { deal: { id: string } | null; open: boolean }) =>
    open && deal ? <div data-testid="referral-preview" data-deal={deal.id} /> : null,
}));
// Portal controls are exercised in PortalAccess.test.tsx; here we only check
// that the page mounts them for this partner.
vi.mock("../components/PortalAccess", () => ({
  PortalInviteButton: ({ partnerId, email }: { partnerId: string; email: string | null | undefined }) => (
    <div data-testid="portal-invite" data-partner={partnerId} data-email={email ?? ""} />
  ),
  PortalAccessLine: ({ partnerId }: { partnerId: string }) => (
    <div data-testid="portal-access" data-partner={partnerId} />
  ),
}));
```

and append at the end of the file:

```tsx
describe("PartnerDetailPage / partner portal controls", () => {
  it("mounts the invite button and the access line for this partner", () => {
    renderPage({ partners: [partner({ id: "p1" })], deals: [], partnerId: "p1" });
    expect(screen.getByTestId("portal-invite")).toHaveAttribute("data-partner", "p1");
    expect(screen.getByTestId("portal-invite")).toHaveAttribute("data-email", "p1@example.com");
    expect(screen.getByTestId("portal-access")).toHaveAttribute("data-partner", "p1");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners`
Expected: FAIL, cannot resolve `./portalAccess`, `./usePortalAccess`, `./PortalAccess`; `PartnerDetailPage.test.tsx` fails to find `portal-invite`.

- [ ] **Step 3: Implement**

Create `apps/app/src/features/partners/lib/portalAccess.ts`:

```ts
/**
 * Partner portal access vocabulary for the in-app partner record (rep-facing).
 * Partner-facing copy lives in features/portal and never mixes with this.
 */
export type PortalUserStatus = "invited" | "active" | "suspended" | "revoked";
export type PortalAccessChange = "suspended" | "revoked" | "invited";

export const PORTAL_STATUS_LABEL: Record<PortalUserStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
};

const ERROR_COPY: Array<[token: string, copy: string]> = [
  ["portal_disabled", "The partner portal is turned off. An admin can turn it on in Settings."],
  ["partner_email_required", "Add an email for this partner first."],
  ["portal_already_active", "This partner already has portal access."],
  ["portal_email_in_use", "Another partner already uses this email for the portal."],
  ["email_failed", "The invite was created but the email didn't send. Try Resend invite."],
  ["portal_user_not_found", "This partner hasn't been invited yet."],
  ["portal_not_restorable", "This partner's access is already open."],
  ["partner_not_visible", "You don't have access to do that."],
  ["not_authorized", "You don't have access to do that."],
];

export function portalAccessErrorMessage(err: unknown): string {
  const message =
    err !== null && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  const hit = ERROR_COPY.find(([token]) => message.includes(token));
  return hit ? hit[1] : "Something went wrong. Try again.";
}

/**
 * supabase.functions.invoke reports a non-2xx as an error whose `context` is the
 * raw Response. Read our `{ error: "<token>" }` body out of it.
 */
export async function functionErrorCode(error: unknown, fallback: string): Promise<string> {
  const context =
    error !== null && typeof error === "object" ? (error as { context?: unknown }).context : undefined;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string") return body.error;
    } catch {
      // Not JSON; fall through to the generic token.
    }
  }
  return fallback;
}
```

Create `apps/app/src/features/partners/hooks/usePortalAccess.ts`:

```ts
/**
 * Partner portal access from the partner record (spec 5.3, FR-PORT-13/20/23).
 *
 * Status reads go through the portal_users SELECT policy (can_see_partner) and
 * only the columns granted to the app role. The invite goes through the
 * portal_invite edge function, so a rep never sees the invite link. Suspend,
 * revoke and restore go through portal_set_access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { functionErrorCode, type PortalAccessChange, type PortalUserStatus } from "../lib/portalAccess";

export interface PortalStatus {
  enabled: boolean;
  slug: string;
}

export interface PartnerPortalUser {
  partnerId: string;
  status: PortalUserStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  lastLoginAt: string | null;
}

interface PortalUserRow {
  partner_id: string;
  status: PortalUserStatus;
  invited_at: string | null;
  activated_at: string | null;
  last_login_at: string | null;
}

export const PORTAL_STATUS_QUERY_KEY = (userId: string | undefined) => ["portal", "status", userId ?? "anon"] as const;
export const PARTNER_PORTAL_USER_QUERY_KEY = (partnerId: string | undefined) =>
  ["portal", "user", partnerId ?? "none"] as const;

export function usePortalStatus() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: PORTAL_STATUS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PortalStatus> => {
      const { data, error } = await supabase.rpc("get_portal_status");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { enabled?: boolean; slug?: string } | null | undefined;
      return { enabled: Boolean(row?.enabled), slug: row?.slug ?? "" };
    },
    staleTime: 5 * 60_000,
  });
}

export function usePartnerPortalUser(partnerId: string | undefined) {
  return useQuery({
    queryKey: PARTNER_PORTAL_USER_QUERY_KEY(partnerId),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<PartnerPortalUser | null> => {
      const { data, error } = await supabase
        .from("portal_users")
        .select("partner_id, status, invited_at, activated_at, last_login_at")
        .eq("partner_id", partnerId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as PortalUserRow;
      return {
        partnerId: row.partner_id,
        status: row.status,
        invitedAt: row.invited_at,
        activatedAt: row.activated_at,
        lastLoginAt: row.last_login_at,
      };
    },
    staleTime: 30_000,
  });
}

export function useInviteToPortal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partnerId: string): Promise<{ emailed: boolean }> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; emailed?: boolean }>("portal_invite", {
        body: { partnerId },
      });
      if (error) throw new Error(await functionErrorCode(error, "invite_failed"));
      return { emailed: Boolean(data?.emailed) };
    },
    onSuccess: (_result, partnerId) => {
      void queryClient.invalidateQueries({ queryKey: PARTNER_PORTAL_USER_QUERY_KEY(partnerId) });
    },
  });
}

export function useSetPortalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { partnerId: string; status: PortalAccessChange }): Promise<PortalUserStatus> => {
      const { data, error } = await supabase.rpc("portal_set_access", {
        p_partner_id: args.partnerId,
        p_status: args.status,
      });
      if (error) throw error;
      return data as PortalUserStatus;
    },
    onSuccess: (_result, args) => {
      void queryClient.invalidateQueries({ queryKey: PARTNER_PORTAL_USER_QUERY_KEY(args.partnerId) });
    },
  });
}
```

Create `apps/app/src/features/partners/components/PortalAccess.tsx`:

```tsx
/**
 * Partner portal controls on the partner record.
 *
 *   PortalInviteButton : hero-row button. "Invite to portal" (or "Resend invite"
 *                        while pending). Shown only when the org portal is on and
 *                        the partner has an email.
 *   PortalAccessLine   : contact-card line "Portal: <status>" with a compact
 *                        Manage disclosure (suspend, revoke, restore, copy address).
 *
 * The server re-checks every action (can_see_partner); these only hide what the
 * viewer cannot meaningfully do.
 */
import * as React from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Send } from "lucide-react";
import { Button } from "@/components/navigatr";
import { portalAddress } from "@/features/portal/lib/portalAddress";
import { PORTAL_STATUS_LABEL, portalAccessErrorMessage, type PortalAccessChange } from "../lib/portalAccess";
import { useInviteToPortal, usePartnerPortalUser, usePortalStatus, useSetPortalAccess } from "../hooks/usePortalAccess";

export function PortalInviteButton({ partnerId, email }: { partnerId: string; email: string | null | undefined }) {
  const status = usePortalStatus();
  const portalUser = usePartnerPortalUser(partnerId);
  const invite = useInviteToPortal();
  const address = (email ?? "").trim();

  if (!status.data?.enabled || !address || portalUser.isPending) return null;
  const current = portalUser.data?.status ?? null;
  if (current !== null && current !== "invited") return null;

  const onClick = async () => {
    try {
      const result = await invite.mutateAsync(partnerId);
      toast.success(result.emailed ? `Invite sent to ${address}` : "Invite created. Email sending is off in this environment.");
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  return (
    <Button variant="secondary" size="md" leadingIcon={Send} loading={invite.isPending} onClick={() => void onClick()}>
      {current === "invited" ? "Resend invite" : "Invite to portal"}
    </Button>
  );
}

const CHANGE_COPY: Record<PortalAccessChange, { label: string; done: string }> = {
  suspended: { label: "Suspend access", done: "Portal access suspended" },
  revoked: { label: "Revoke access", done: "Portal access revoked" },
  invited: { label: "Restore access", done: "Access restored. Send a new invite so they can sign in." },
};

export function PortalAccessLine({ partnerId }: { partnerId: string }) {
  const status = usePortalStatus();
  const portalUser = usePartnerPortalUser(partnerId);
  const setAccess = useSetPortalAccess();
  const [open, setOpen] = React.useState(false);

  if (!status.data?.enabled) return null;
  const slug = status.data.slug;
  const current = portalUser.data?.status ?? null;
  const changes: PortalAccessChange[] =
    current === "active" || current === "invited"
      ? ["suspended", "revoked"]
      : current === "suspended"
        ? ["invited", "revoked"]
        : current === "revoked"
          ? ["invited"]
          : [];

  const change = async (next: PortalAccessChange) => {
    try {
      await setAccess.mutateAsync({ partnerId, status: next });
      toast.success(CHANGE_COPY[next].done);
      setOpen(false);
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portalAddress(slug));
      toast.success("Portal address copied");
    } catch {
      toast.error("Couldn't copy. Long-press the address to copy it.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
          <KeyRound className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-body-md text-text-default">
          Portal: {current ? PORTAL_STATUS_LABEL[current] : "Not invited"}
        </span>
        <Button variant="tertiary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Manage
        </Button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 pl-12">
          {changes.map((next) => (
            <Button
              key={next}
              variant="secondary"
              size="sm"
              loading={setAccess.isPending}
              onClick={() => void change(next)}
            >
              {CHANGE_COPY[next].label}
            </Button>
          ))}
          <Button variant="secondary" size="sm" leadingIcon={Copy} onClick={() => void copy()}>
            Copy portal address
          </Button>
        </div>
      )}
    </div>
  );
}
```

In `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`:

Replace:

```tsx
import { ReferralPreviewSheet } from "../components/ReferralPreviewSheet";
```

with:

```tsx
import { ReferralPreviewSheet } from "../components/ReferralPreviewSheet";
import { PortalAccessLine, PortalInviteButton } from "../components/PortalAccess";
```

Replace (the end of `HeroCard`):

```tsx
            Edit
          </Button>
        )}
      </div>
    </Card>
  );
}
```

with:

```tsx
            Edit
          </Button>
        )}
        <PortalInviteButton partnerId={partner.id} email={partner.email} />
      </div>
    </Card>
  );
}
```

Replace (the email row in `ContactCard`):

```tsx
          <a href={`mailto:${partner.email}`} className="truncate text-body-md text-text-default hover:underline">
            {partner.email}
          </a>
        </div>
```

with:

```tsx
          <a href={`mailto:${partner.email}`} className="truncate text-body-md text-text-default hover:underline">
            {partner.email}
          </a>
        </div>
        <PortalAccessLine partnerId={partner.id} />
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS (`portalAccess.test.ts` 5, `usePortalAccess.test.tsx` 6, `PortalAccess.test.tsx` 10, `PartnerDetailPage.test.tsx` all existing tests plus the new one), no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners
git commit -m "$(cat <<'EOF'
feat(partners): invite to portal, portal status, and suspend/revoke on Partner Detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: "Partner portal" admin settings tab

**Files:**
- Create: `apps/app/src/features/settings-hub/usePortalSettings.ts`
- Create: `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx`
- Test: `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.test.tsx`
- Modify: `apps/app/src/features/settings-hub/tabs.ts` (+ `tabs.test.ts`), `SettingsHubPage.tsx` (+ `SettingsHubPage.test.tsx`)

**Interfaces:**
- Consumes: SQL `get_portal_settings()`, `update_portal_settings(p_enabled, p_terms_text, p_consent_text, p_value_visibility)` (Task 1); `portalAddress` (Task 8); `TabHeader`; `Button`, `Card`, `Checkbox` (`variant="toggle"`), `FormField`, `Input`, `Textarea` from `@/components/navigatr`.
- Produces:
  - `interface PortalSettings { enabled: boolean; termsText: string | null; termsVersion: number; consentText: string | null; consentVersion: number; valueVisibility: boolean; slug: string; orgName: string }`
  - `interface PortalSettingsInput { enabled: boolean; termsText: string; consentText: string; valueVisibility: boolean }`
  - `PORTAL_SETTINGS_QUERY_KEY = ["portal", "settings"] as const`
  - `usePortalSettings()`, `useUpdatePortalSettings()` (mutation `(input: PortalSettingsInput) => Promise<PortalSettings>`; on success writes the cache and invalidates `["portal", "status"]`)
  - `PartnerPortalTab()`; tab id `"partner-portal"` added to `SettingsTabId`, admin only, group `workspace`, after Branding.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { PartnerPortalTab } from "./PartnerPortalTab";

const OFF = {
  enabled: false,
  terms_text: null,
  terms_version: 0,
  consent_text: null,
  consent_version: 0,
  value_visibility: false,
  slug: "acme",
  org_name: "Acme ISO",
};
const SEEDED = {
  ...OFF,
  enabled: true,
  terms_text:
    "By using this portal you agree to share business referrals with Acme ISO and to only submit contact details you have permission to share. Acme ISO may contact the businesses you refer.",
  terms_version: 1,
  consent_text: "I have permission to share this business's contact details.",
  consent_version: 1,
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartnerPortalTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PartnerPortalTab", () => {
  it("loads the settings and shows the portal address", async () => {
    rpcMock.mockResolvedValueOnce({ data: [OFF], error: null });
    renderTab();
    expect(await screen.findByRole("switch", { name: "Turn on the partner portal" })).not.toBeChecked();
    expect(rpcMock).toHaveBeenCalledWith("get_portal_settings");
    expect(screen.getByLabelText("Portal address")).toHaveValue(`${window.location.origin}/p/acme`);
  });

  it("turns the portal on and shows the starting terms with their version", async () => {
    const user = userEvent.setup();
    rpcMock.mockResolvedValueOnce({ data: [OFF], error: null }).mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Turn on the partner portal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(rpcMock).toHaveBeenLastCalledWith("update_portal_settings", {
      p_enabled: true,
      p_terms_text: "",
      p_consent_text: "",
      p_value_visibility: false,
    });
    expect(await screen.findByDisplayValue(SEEDED.terms_text)).toBeInTheDocument();
    expect(screen.getByText(/Version 1\./)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Turn on the partner portal" })).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith("Portal settings saved");
  });

  it("saves edited terms and the value toggle, and shows the new version", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [SEEDED], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, terms_text: "New terms.", terms_version: 2, value_visibility: true }], error: null });
    renderTab();
    const terms = await screen.findByLabelText("Partner terms");
    await user.clear(terms);
    await user.type(terms, "New terms.");
    await user.click(screen.getByRole("switch", { name: "Show closed-won value to partners" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(rpcMock).toHaveBeenLastCalledWith("update_portal_settings", {
      p_enabled: true,
      p_terms_text: "New terms.",
      p_consent_text: SEEDED.consent_text,
      p_value_visibility: true,
    });
    expect(await screen.findByText(/Version 2\./)).toBeInTheDocument();
  });

  it("copies the portal address", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/acme`);
  });

  it("says so when saving fails", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [SEEDED], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the portal settings. Try again.");
  });
});
```

In `apps/app/src/features/settings-hub/tabs.test.ts`, replace:

```ts
  it("returns every tab for an admin", () => {
    const result = visibleTabs("admin");
    expect(result.map((t) => t.id)).toEqual([
      "personal",
      "organization",
      "integrations",
      "branding",
      "profession",
      "danger",
    ]);
  });
```

with:

```ts
  it("returns every tab for an admin", () => {
    const result = visibleTabs("admin");
    expect(result.map((t) => t.id)).toEqual([
      "personal",
      "organization",
      "integrations",
      "branding",
      "partner-portal",
      "profession",
      "danger",
    ]);
  });

  it("keeps the partner portal tab admin-only", () => {
    expect(visibleTabs("manager").map((t) => t.id)).not.toContain("partner-portal");
    expect(resolveTab("partner-portal", "manager")).toEqual({ id: "personal", redirected: true });
    expect(resolveTab("partner-portal", "admin")).toEqual({ id: "partner-portal", redirected: false });
  });
```

In `apps/app/src/features/settings-hub/SettingsHubPage.test.tsx`, replace:

```tsx
vi.mock("./tabs/BrandingTab", () => ({
  BrandingTab: () => <div data-testid="tab-content">BRANDING_TAB_CONTENT</div>,
}));
```

with:

```tsx
vi.mock("./tabs/BrandingTab", () => ({
  BrandingTab: () => <div data-testid="tab-content">BRANDING_TAB_CONTENT</div>,
}));
vi.mock("./tabs/PartnerPortalTab", () => ({
  PartnerPortalTab: () => <div data-testid="tab-content">PARTNER_PORTAL_TAB_CONTENT</div>,
}));
```

and replace:

```tsx
  it("shows all 6 tabs to an admin in the rail", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist", { name: /settings sections/i });
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(6);
    const labels = Array.from(tabs).map((t) => t.textContent);
    expect(labels).toEqual([
      "Personal",
      "Organization",
      "Integrations",
      "Branding",
      "Profession",
      "Danger zone",
    ]);
  });
```

with:

```tsx
  it("shows all 7 tabs to an admin in the rail", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings");
    const tablist = screen.getByRole("tablist", { name: /settings sections/i });
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(7);
    const labels = Array.from(tabs).map((t) => t.textContent);
    expect(labels).toEqual([
      "Personal",
      "Organization",
      "Integrations",
      "Branding",
      "Partner portal",
      "Profession",
      "Danger zone",
    ]);
  });

  it("renders the Partner portal tab for an admin", () => {
    profileShape = { data: { role: "admin" } };
    renderAt("/settings?tab=partner-portal");
    expect(screen.getByTestId("tab-content")).toHaveTextContent("PARTNER_PORTAL_TAB_CONTENT");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/settings-hub`
Expected: FAIL (`./PartnerPortalTab` cannot be resolved; `tabs.test.ts` and `SettingsHubPage.test.tsx` miss `partner-portal`).

- [ ] **Step 3: Implement**

Create `apps/app/src/features/settings-hub/usePortalSettings.ts`:

```ts
/**
 * Partner portal tenant settings (spec 5.10). Admin only, enforced in SQL by
 * get_portal_settings / update_portal_settings (caller_is_admin). Reading through
 * an RPC keeps the organizations RLS policy unchanged.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PortalSettings {
  enabled: boolean;
  termsText: string | null;
  termsVersion: number;
  consentText: string | null;
  consentVersion: number;
  valueVisibility: boolean;
  slug: string;
  orgName: string;
}

export interface PortalSettingsInput {
  enabled: boolean;
  termsText: string;
  consentText: string;
  valueVisibility: boolean;
}

interface PortalSettingsRow {
  enabled: boolean;
  terms_text: string | null;
  terms_version: number;
  consent_text: string | null;
  consent_version: number;
  value_visibility: boolean;
  slug: string;
  org_name: string;
}

export const PORTAL_SETTINGS_QUERY_KEY = ["portal", "settings"] as const;

function toSettings(data: unknown): PortalSettings {
  const row = (Array.isArray(data) ? data[0] : data) as PortalSettingsRow | null | undefined;
  if (!row) throw new Error("portal_settings_missing");
  return {
    enabled: row.enabled,
    termsText: row.terms_text,
    termsVersion: row.terms_version,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    valueVisibility: row.value_visibility,
    slug: row.slug,
    orgName: row.org_name,
  };
}

export function usePortalSettings() {
  return useQuery({
    queryKey: PORTAL_SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("get_portal_settings");
      if (error) throw error;
      return toSettings(data);
    },
  });
}

export function useUpdatePortalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PortalSettingsInput): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("update_portal_settings", {
        p_enabled: input.enabled,
        p_terms_text: input.termsText,
        p_consent_text: input.consentText,
        p_value_visibility: input.valueVisibility,
      });
      if (error) throw error;
      return toSettings(data);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(PORTAL_SETTINGS_QUERY_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: ["portal", "status"] });
    },
  });
}
```

Create `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx`:

```tsx
/**
 * PartnerPortalTab: the admin "Partner portal" settings card (spec 5.10).
 * Turn the portal on, edit the partner terms (every change bumps the version so
 * partners accept again) and the consent line, choose whether partners see
 * closed-won value, and copy the portal address.
 *
 * The form remounts whenever the saved state changes (key below), so it always
 * starts from what the server stored, including seeded starting text.
 */
import * as React from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/navigatr";
import { portalAddress } from "@/features/portal/lib/portalAddress";
import { TabHeader } from "./TabHeader";
import { usePortalSettings, useUpdatePortalSettings, type PortalSettings } from "../usePortalSettings";

function formKey(s: PortalSettings): string {
  return [s.enabled, s.termsVersion, s.consentVersion, s.valueVisibility].join(":");
}

export function PartnerPortalTab() {
  const settings = usePortalSettings();
  return (
    <>
      <TabHeader
        title="Partner portal"
        subtitle="Let referral partners sign in, send you businesses, and follow each referral."
      />
      {settings.isPending ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
        </div>
      ) : settings.isError || !settings.data ? (
        <p className="text-body-md text-text-muted">We couldn&apos;t load the portal settings. Refresh to try again.</p>
      ) : (
        <PartnerPortalForm key={formKey(settings.data)} initial={settings.data} />
      )}
    </>
  );
}

function PartnerPortalForm({ initial }: { initial: PortalSettings }) {
  const update = useUpdatePortalSettings();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [termsText, setTermsText] = React.useState(initial.termsText ?? "");
  const [consentText, setConsentText] = React.useState(initial.consentText ?? "");
  const [valueVisibility, setValueVisibility] = React.useState(initial.valueVisibility);
  const address = initial.slug ? portalAddress(initial.slug) : "";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ enabled, termsText, consentText, valueVisibility });
      toast.success("Portal settings saved");
    } catch {
      toast.error("Couldn't save the portal settings. Try again.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Portal address copied");
    } catch {
      toast.error("Couldn't copy. Select the address to copy it.");
    }
  };

  const termsHelper =
    initial.termsVersion > 0
      ? `Version ${initial.termsVersion}. Partners accept again after you change them.`
      : "Partners accept these before they first sign in. Leave blank to start from a draft.";

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <Card padding="lg" className="flex flex-col gap-5">
        <Checkbox
          variant="toggle"
          id="portal-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          label="Turn on the partner portal"
          helper="Partners you invite can sign in at your portal address."
        />

        <div className="flex items-end gap-2">
          <FormField
            label="Portal address"
            htmlFor="portal-address"
            helper="Share it with partners you've invited."
            className="min-w-0 flex-1"
          >
            <Input id="portal-address" readOnly value={address} />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            size="md"
            leadingIcon={Copy}
            disabled={!address}
            onClick={() => void copy()}
          >
            Copy
          </Button>
        </div>

        <FormField label="Partner terms" htmlFor="portal-terms" helper={termsHelper}>
          <Textarea id="portal-terms" rows={6} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
        </FormField>
        <p className="-mt-3 text-caption text-text-subtle">
          Have your legal team review these terms before you invite partners.
        </p>

        <FormField
          label="Consent line"
          htmlFor="portal-consent"
          helper="Partners confirm this each time they send a referral."
        >
          <Input id="portal-consent" value={consentText} onChange={(e) => setConsentText(e.target.value)} />
        </FormField>

        <Checkbox
          variant="toggle"
          id="portal-value-visibility"
          checked={valueVisibility}
          onCheckedChange={setValueVisibility}
          label="Show closed-won value to partners"
          helper="When off, partners see that a referral closed, but not its value."
        />
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="md" loading={update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
```

In `apps/app/src/features/settings-hub/tabs.ts`, replace:

```ts
  | "branding"
  | "profession"
```

with:

```ts
  | "branding"
  | "partner-portal"
  | "profession"
```

and replace:

```ts
  { id: "branding",     label: "Branding",     roles: ["admin"],                   group: "workspace" },
```

with:

```ts
  { id: "branding",     label: "Branding",     roles: ["admin"],                   group: "workspace" },
  { id: "partner-portal", label: "Partner portal", roles: ["admin"],               group: "workspace" },
```

In `apps/app/src/features/settings-hub/SettingsHubPage.tsx`, replace:

```tsx
import { BrandingTab } from "./tabs/BrandingTab";
```

with:

```tsx
import { BrandingTab } from "./tabs/BrandingTab";
import { PartnerPortalTab } from "./tabs/PartnerPortalTab";
```

and replace:

```tsx
  branding:     BrandingTab,
```

with:

```tsx
  branding:     BrandingTab,
  "partner-portal": PartnerPortalTab,
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/settings-hub`
Expected: PASS (`PartnerPortalTab.test.tsx` 5, `tabs.test.ts` and `SettingsHubPage.test.tsx` with the new cases), no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/settings-hub
git commit -m "$(cat <<'EOF'
feat(settings): admin Partner portal tab (enable, terms, consent, value, address)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification and PR to main

**Files:** none new.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`037` to `040` included), the two documented SKIPs unchanged.

- [ ] **Step 2: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds unchanged or higher, no `act()` warnings from the new files.

- [ ] **Step 3: Real production build**

Run: `pnpm --filter app build`
Expected: exits 0 (`tsc -b` typechecks the three new `_shared` files through the include list, and `vite build` succeeds).

- [ ] **Step 4: No long dashes, no stray secrets in responses**

Run: `git diff --name-only main...HEAD | xargs perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof'`
Expected: no output.

Run: `grep -n "invite_token\|session_token" apps/app/src/features/partners -r`
Expected: no output (reps never handle a portal secret).

- [ ] **Step 5: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal Phase 1A: partner access (invite, terms, email-code sign-in, revoke)" --body "$(cat <<'EOF'
## Summary
- Partners get their own sign-in, separate from rep logins: invite email, accept the ISO's terms, then a 6-digit email code. Partners are never Supabase users.
- All tokens, codes and sessions are generated, hashed (SHA-256), rate limited and expired in service-role-only SQL; raw values leave the database once and are never stored.
- `portal_api` (verify_jwt off, session in `x-portal-session`) and `portal_invite` (verify_jwt on) edge functions, logic in unit-tested `_shared` modules with allowlisted responses.
- Branded `/p/<slug>` portal: ISO logo, color and name before sign-in; a generic page for unknown or disabled portals; a minimal signed-in landing page.
- Partner Detail: Invite to portal / Resend invite, portal status, Suspend / Revoke / Restore, Copy portal address. Suspend and revoke end the partner's session on their next request.
- Settings: admin "Partner portal" tab (turn on, terms with versioning, consent line, closed-won value toggle, portal address).

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (sections 5.1 to 5.4, 5.10, 5.11, 6, 7)
Plan: docs/superpowers/plans/2026-10-09-partner-portal-1a-access.md

## Before the first real invite
- The partner terms are a placeholder until Robert's attorney review comes back.
- Confirm the portal web address (shared domain + slug).
- The portal is off for every tenant by default (`portal_enabled = false`).

## Not in this PR (Phase 1B / 1C)
- Referral submission, partner dashboard, referral detail, profile
- Referral emails, per-tenant email logo, same-day nudge, "Share update with partner"

## Test plan
- [ ] DB tests 037 to 040 pass in CI from an empty database
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging: an admin turns the portal on; a rep invites a partner with an allowlisted email; the partner accepts the terms and lands signed in
- [ ] Staging: sign out, sign back in with an email code; a wrong code is refused; an unknown email gets the same "we sent a code" answer
- [ ] Staging: the rep suspends the partner and the partner's next page load returns to sign-in
- [ ] Staging: `/p/not-a-tenant` shows "This portal isn't available"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Bind the PR**

Use the ccd_pr `get_status` tool; if it does not report this PR, call `bind_pr` with its URL. Do not merge or promote without the user's go.
