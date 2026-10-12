# Partner Portal Phase 1B (Partner submits and tracks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in referral partner can send a business to the ISO from a phone (with an optional dictated note), gets a soft "may already be in progress" warning, sees a confirmation with a reference, and then follows every referral on a dashboard and a detail page that only ever shows partner labels (Received, Accepted, In Progress, Closed Won, Not Moving Forward, Withdrawn). The rep's review sheet shows when a referral came through the portal and when it looks like a duplicate, and accepting a flagged one needs a written reason.

**Architecture:** Same shape as 1A. All partner data access is in service-role-only SECURITY DEFINER SQL functions that take `(p_org, p_partner[, p_portal_user])`, and `portal_api` gets those ids only from `portal_session_lookup`. The pure handler in `supabase/functions/_shared/portalReferralApi.ts` builds every response field by field and maps internal statuses through one shared label module (`_shared/portalLabels.ts`). Duplicate matching reuses the existing `deal_phone_key`, `deal_dedupe_key` and `deal_name_key` normalizers, scoped by the partner owner's visibility through `profile_can_see_owner`. The AssemblyAI call moves into `_shared/transcribe.ts` so `transcribe` and `portal_api` share it. The SPA adds a signed-in layout under `/p/:slug/*` with the dashboard (`home`), submit form (`new`) and detail (`r/:referralId`) pages, all polling every 30 seconds.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pgcrypto in `extensions`), Deno edge functions, React 18 + TypeScript, React Router 6, TanStack Query 5, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` sections 5.5, 5.6, 6 and 7. Design brief decisions D1 to D12 are binding and are referenced by number below.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261012000001_...` onward, applied in filename order. The latest existing migration is `20261009000004`. Every migration is additive (brief D12). Never hand-apply SQL to staging or production; CI and `promote-production` apply them.
- `ALTER TYPE ... ADD VALUE` lives alone in the first migration of the phase, because a new enum value cannot be used in the transaction that adds it (brief D12).
- Partners are never Supabase Auth users. Nothing in this plan calls `supabase.auth` for a partner.
- Every partner-side SQL function is `security definer set search_path = public, extensions`, then `revoke execute ... from public, anon, authenticated;` and `grant execute ... to service_role;` (brief D2). Private helpers (`_portal_*`) are also revoked from `service_role`. Supabase grants `authenticated` directly, so it is revoked by name.
- Partner-side functions take `p_org`, `p_partner` and (when they write or audit) `p_portal_user`, and `portal_api` passes only the values `portal_session_lookup` returned. Request bodies never supply an org, partner or portal user id. A referral id from another partner or another org behaves exactly like a missing one (brief D2).
- Internal-side RPCs (`accept_referral`, `accept_referral_override`) keep the Phase 0 posture: `security definer set search_path = public`, re-check triage rights inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`.
- pgcrypto calls are always schema-qualified (`extensions.digest`, `extensions.gen_random_bytes`). This plan adds none, but the 1A functions it replaces keep their qualified calls.
- DB tests: plain psql scripts `supabase/tests/NNN_name.sql` starting at `041`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Service-role-only functions are called as `postgres`. Assert function privileges with `has_function_privilege`, never by calling a function the role cannot execute: local Postgres 17.6 segfaults on a live function-level permission-denied.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`.
- `_shared` modules are dependency-free TS with no Deno globals at module scope, import each other with the `.ts` extension, and their tests import without the extension. Every new `_shared` source file is added to the `include` list in `apps/app/tsconfig.app.json` so `tsc -b` typechecks it.
- `portal_api` responses are explicit allowlists built field by field (brief D1). They never contain an internal status name, a decline reason, a deal stage, a rep or deal note, activities, or any other partner's data. The partner's session token travels only in `x-portal-session`.
- Expected `portal_api` errors: `400 { error: "invalid_body", field? }`, `401 { error: "unauthorized" }`, `404 { error: "not_found" }`, `409 { error: "consent_changed" | "not_withdrawable" }`, `413 { error: "audio_too_large" }`, `429 { error: "rate_limited" }`, `502 { error: "transcription_failed" }`, `500 { error: "server_error" }`.
- The frontend portal client uses plain `fetch` (never `supabase.functions.invoke`). Session in `localStorage` under `navigatr-portal-session:<slug>`, draft under `navigatr-portal-draft:<slug>`, pending invite token in `sessionStorage` under `navigatr-portal-invite:<slug>`; every storage access is wrapped in try/catch.
- React Query keys for partner data are `["portal", "data", slug, token, ...]` (built by `portalDataKey`), so sign-out can drop them all. Dashboard, list and detail use `refetchInterval: 30_000` (`PORTAL_POLL_MS`).
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. Tests live next to source. No `act()` warnings. Node 25 ships a broken global `localStorage` (and `sessionStorage`), so every test file that touches storage installs its own in-memory `Storage` shim in `beforeEach` and restores the original in `afterEach` (the 1A pattern). The shim is defined per file, never shared.
- Before any push: `pnpm --filter app build` must pass (`tsc -b && vite build`; `tsc --noEmit` alone is not enough).
- Partner-facing copy names the ISO (organization name), never "navigatr". Copy is plain, short and readable on a 360px phone. Tap targets are at least 44px tall. Partner-facing copy never uses the lowercase words submitted, accepted, working, won, lost, declined or withdrawn (the string audit in Task 14 enforces this), so "won't" and "can't be withdrawn" are out.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

**Create**
- `supabase/migrations/20261012000001_portal_audit_actions_1b.sql`: audit enum values `sign_in_failed`, `dup_check`, `transcribe`.
- `supabase/migrations/20261012000002_portal_sign_in_caps.sql`: daily code cap in `portal_issue_code`, `sign_in_failed` audit in `portal_verify_code`, per-user audit index.
- `supabase/migrations/20261012000003_portal_referral_submit.sql`: `referrals.urgency`, partner actor in the history trigger, `_portal_assert_scope`, `_portal_audit_referral`, `_portal_referral_ref`, `_portal_find_duplicates`, `portal_form_context`, `portal_dup_check`, `portal_submit_referral`.
- `supabase/migrations/20261012000004_portal_referral_read.sql`: `portal_list_referrals`, `portal_get_referral`, `portal_referral_history`, `portal_dashboard_stats`, `portal_withdraw_referral`, `portal_claim_transcribe`.
- `supabase/migrations/20261012000005_accept_referral_override.sql`: `accept_referral` refuses a flagged referral without a reason; new `accept_referral_override`.
- `supabase/tests/041_portal_sign_in_caps.sql`, `042_portal_referral_submit.sql`, `043_portal_referral_read.sql`, `044_accept_referral_override.sql`.
- `supabase/functions/_shared/portalLabels.ts` (+ `.test.ts`): status to partner label, history collapse.
- `supabase/functions/_shared/portalSubmission.ts` (+ `.test.ts`): field limits, industry and urgency lists, time windows, `validateSubmission`.
- `supabase/functions/_shared/transcribe.ts` (+ `.test.ts`): AssemblyAI batch call with injected fetch.
- `supabase/functions/_shared/portalReferralApi.ts` (+ `.test.ts`): signed-in referral actions.
- `apps/app/src/features/portal/lib/portalDraft.ts` (+ test), `portalInviteToken.ts` (+ test), `portalFormat.ts` (+ test), `portalSignedIn.ts`.
- `apps/app/src/features/portal/hooks/usePortalDictation.ts` (+ test).
- `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`, `PortalLabelChip.tsx`.
- `apps/app/src/features/portal/pages/PortalDashboardPage.tsx` (+ test), `PortalSubmitPage.tsx` (+ test), `PortalReferralPage.tsx` (+ test).
- `apps/app/src/features/portal/portalStringAudit.test.tsx`.

**Modify**
- `supabase/functions/_shared/portalApi.ts`: route the new actions through a session lookup to `portalReferralApi.ts`; `transcribe` dependency.
- `supabase/functions/portal_api/index.ts`: wire the transcriber.
- `supabase/functions/transcribe/index.ts`: use `_shared/transcribe.ts` (same responses).
- `apps/app/tsconfig.app.json`: include the four new `_shared` files.
- `apps/app/src/hooks/useVoiceDictation.ts`: export `blobToBase64` (one word, no behavior change).
- `apps/app/src/features/portal/lib/portalApi.ts` (+ test): new actions, `field` on errors, `portalDataKey`, `PORTAL_POLL_MS`, `isPortalUnauthorized`.
- `apps/app/src/features/portal/pages/PortalRoot.tsx` (+ test), `PortalInvitePage.tsx` (+ test).
- `apps/app/src/features/partners/hooks/useReferralQueue.ts` (+ test), `hooks/useReferralMutations.ts` (+ test), `lib/referrals.ts`, `components/ReviewReferralSheet.tsx` (+ test).

**Delete**
- `apps/app/src/features/portal/pages/PortalHomePage.tsx` (replaced by the signed-in layout and the dashboard).

**Deviations from spec and brief, recorded here:**

1. **Address is plain text (brief D7).** Spec 5.5 proxies Places autocomplete through `portal_api`; 1B keeps Google billing off the public surface. `place_id` stays null; the duplicate check still uses name, address key and phone.
2. **Email is not part of any duplicate match (brief D3, spec R8).** Robert's ruling is "try without email" for deals, and spec 9 defers "email in the duplicate rule". Using email for referral-to-referral matching only would make the two rules disagree, so it is left out entirely and `portal_dup_check` has no email parameter. The client still starts the check once a company plus a phone or an email is entered, as the brief asks.
3. **Name-only match only when an address is missing.** A match is: same phone key, or same name+address key, or same name key when either side has no usable address. Two businesses with the same name at two known, different addresses are not flagged (they are the "second location" case the Add Deal tiers already treat as soft).
4. **Consent version is checked, not just stored (brief D4).** The client sends the consent version it showed. The server always stores its own `organizations.consent_version` and refuses a mismatch with `409 consent_changed`, so a partner never consents to wording they did not see. Mirrors 1A's `terms_changed`.
5. **Sign-out moves to a top bar of the signed-in layout.** Brief D10 says "keep sign-out in the shell header", but 1A's sign-out was in the landing card and `PortalShell`'s header is shared with the signed-out pages. The new `PortalSignedInLayout` shows "Signed in as ... at ..." and a Sign out button above every signed-in page.
6. **Rep-logged referrals show, without rep-typed detail.** The partner's list and stats include every inbound referral of that partner, including `rep_entered` ones, because they are the partner's referrals. For those, the detail returns company name, label, dates and the rep contact only; contact fields and notes were typed by a rep, and spec 6 forbids partner-visible text from internal free-text fields. Only `portal_signed_in` referrals can be withdrawn from the portal.
7. **Detail views are audited at most once per referral per partner per hour,** because the page polls every 30 seconds.
8. **Accept-despite-duplicate is a new RPC.** FR-PORT-47's written reason is `accept_referral_override(p_referral_id, p_override_reason)`, not an overload of `accept_referral` (PostgREST overload resolution by argument names is fragile). Plain `accept_referral` now refuses a flagged referral with `override_reason_required`; the reason lands in the history note.
9. **Industry picklist reuses the Add Deal form's seven keys** (`restaurant`, `retail`, `healthcare`, `professional_services`, `personal_services`, `automotive`, `other`), so an accepted referral's deal round-trips in the app's industry select.
10. **Urgency needs a new column.** Spec 4.1 has no urgency on `referrals`; `referrals.urgency` (`this_week`, `this_month`, `no_rush`) is added.
11. **Windows filter on `submitted_at`** for both the tiles and the list. "Active" is Received + Accepted + In Progress; conversion is Closed Won / (Closed Won + Not Moving Forward); withdrawn referrals count only toward Submitted.
12. **Dictation uses `NotesFieldWithMic` in manual mode.** `NotesFieldWithMic` always runs the app's `useVoiceDictation` (rep JWT through `supabase.functions.invoke`), so the portal drives it through its `onMicClick` and `micState` props with `usePortalDictation`, which reuses `useVoiceRecorder` and the now-exported `blobToBase64`. The only change to app code is that export.
13. **Rep contact is name and email only.** `profiles` has no phone column (spec 5.6 says "email/phone").
14. **No published-updates slot.** "Share update with partner" is Phase 1C; the detail page omits the section.
15. **A session-lookup database error on a data action answers 500, not 401,** so a transient database failure shows "Try again" instead of signing the partner out. (1A's `me` keeps its 401.)
16. **`transcribe` now passes `deno check`.** It failed before this plan (`Uint8Array<ArrayBufferLike>` is not a `BodyInit` under Deno 2.9); the extracted helper types audio as `Uint8Array<ArrayBuffer>`.
17. **Function signatures beyond brief D2:** `portal_dup_check`, `portal_get_referral`, `portal_withdraw_referral` and `portal_claim_transcribe` also take `p_portal_user` and `p_ip` (rate limits and audit rows need them); `portal_form_context(p_org, p_partner)` is new (the form needs the consent wording and version before submit); history is a second function, `portal_referral_history`.
18. **Small schema additions beyond spec 5.2:** audit actions `sign_in_failed`, `dup_check`, `transcribe`; index `portal_audit_log (portal_user_id, action, created_at)`; index `referrals (submitted_by_portal_user_id, submitted_at)`.

---

### Task 1: Audit actions, daily code cap, failed sign-in audit

Carries the two 1A tracker items for sign-in (brief scope 8a).

**Files:**
- Create: `supabase/migrations/20261012000001_portal_audit_actions_1b.sql`
- Create: `supabase/migrations/20261012000002_portal_sign_in_caps.sql`
- Test: `supabase/tests/041_portal_sign_in_caps.sql`

**Interfaces:**
- Consumes (SQL, from 1A): `public._portal_audit(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid) returns void`, `public._portal_hash(text)`, `public._portal_create_session(uuid, text, text)`.
- Produces (SQL):
  - `portal_audit_action` gains `'sign_in_failed'`, `'dup_check'`, `'transcribe'`.
  - Index `portal_audit_log_user_action_idx on portal_audit_log (portal_user_id, action, created_at)`.
  - `public.portal_issue_code(p_slug text, p_email text, p_ip text) returns table (code text, recipient text, org_name text, org_slug text)`: unchanged signature and privileges; additionally returns zero rows once the portal user has 20 sign-in codes issued in the last 24 hours.
  - `public.portal_verify_code(p_slug text, p_email text, p_code text, p_ip text, p_user_agent text) returns table (session_token text, session_expires_at timestamptz)`: unchanged signature and privileges; every failure after the tenant resolves writes one `sign_in_failed` audit row (portal user id null when the email is unknown).

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/041_portal_sign_in_caps.sql`:

```sql
-- Tests for 20261012000001 + 20261012000002 (Partner Portal Phase 1B sign-in caps).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/041_portal_sign_in_caps.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture (org portal-cap, portal enabled):
--   U1 daily@example.com  active  (19 codes already issued 2 to 3 hours ago)
--   U2 fail@example.com   active  (failed sign-in audit)

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001041', 'Portal Cap Org', 'portal-cap', 'portal-cap-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0410000-0000-0000-0000-000000000001', 'boss@cap.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0410000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'admin', 'administrator', 'Boss', 'boss@cap.example', 'capboss'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a041a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'a0410000-0000-0000-0000-000000000001', 'a0410000-0000-0000-0000-000000000001', 'Daily CPA', 'D & Co', 'cpa', 'daily@example.com'),
  ('a041a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001041', 'a0410000-0000-0000-0000-000000000001', 'a0410000-0000-0000-0000-000000000001', 'Fail CPA',  'F & Co', 'cpa', 'fail@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a041b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'a041a000-0000-0000-0000-000000000001', 'daily@example.com', 'active'),
  ('a041b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001041', 'a041a000-0000-0000-0000-000000000002', 'fail@example.com',  'active');

-- 19 codes in the last 24 hours, all older than one hour so the hourly cap is not in play.
insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, issued_at, expires_at)
select '00000000-0000-0000-0000-000000001041', 'a041b000-0000-0000-0000-000000000001', 'sign_in_code',
       'old-' || g, now() - interval '2 hours' - (g || ' minutes')::interval, now() - interval '1 hour'
  from generate_series(1, 19) g;

-- New enum values exist.
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'sign_in_failed') then
    raise exception 'portal_audit_action should have sign_in_failed';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'dup_check') then
    raise exception 'portal_audit_action should have dup_check';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'transcribe') then
    raise exception 'portal_audit_action should have transcribe';
  end if;
end $$;

-- Privileges survive the replacement.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_issue_code(text, text, text)',
    'public.portal_verify_code(text, text, text, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Daily cap: the 20th code in 24 hours is issued, the 21st is not.
do $$ declare r record; n int; begin
  select * into r from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if r.code is null then raise exception 'the 20th code within 24 hours should be issued'; end if;
  select count(*) into n from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if n <> 0 then raise exception 'a 21st code within 24 hours must be refused'; end if;
end $$;

-- A code older than 24 hours stops counting.
do $$ declare n int; begin
  update portal_tokens set issued_at = now() - interval '25 hours'
   where portal_user_id = 'a041b000-0000-0000-0000-000000000001' and token_hash = 'old-1';
  select count(*) into n from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if n <> 1 then raise exception 'a code older than 24 hours should free a slot'; end if;
end $$;

-- Failed verify writes sign_in_failed; success writes none.
do $$ declare n int; r record; begin
  perform public.portal_verify_code('portal-cap', 'fail@example.com', '000000', '10.41.0.2', 'ua');
  select count(*) into n from portal_audit_log
   where action = 'sign_in_failed' and portal_user_id = 'a041b000-0000-0000-0000-000000000002'
     and org_id = '00000000-0000-0000-0000-000000001041' and ip = '10.41.0.2';
  if n <> 1 then raise exception 'a wrong code should write one sign_in_failed row, got %', n; end if;

  perform public.portal_verify_code('portal-cap', 'ghost@example.com', '123456', '10.41.0.3', 'ua');
  select count(*) into n from portal_audit_log
   where action = 'sign_in_failed' and portal_user_id is null
     and org_id = '00000000-0000-0000-0000-000000001041' and ip = '10.41.0.3';
  if n <> 1 then raise exception 'an unknown email should write one sign_in_failed row with no portal user'; end if;

  select count(*) into n from portal_audit_log where action = 'sign_in_failed';
  perform public.portal_verify_code('no-such-portal', 'fail@example.com', '123456', '10.41.0.4', 'ua');
  if (select count(*) from portal_audit_log where action = 'sign_in_failed') <> n then
    raise exception 'an unknown portal has no tenant to audit against and must write nothing';
  end if;

  select * into r from public.portal_issue_code('portal-cap', 'fail@example.com', '10.41.0.5');
  perform public.portal_verify_code('portal-cap', 'fail@example.com', r.code, '10.41.0.5', 'ua');
  if exists (select 1 from portal_audit_log where action = 'sign_in_failed' and ip = '10.41.0.5') then
    raise exception 'a successful sign-in must not write sign_in_failed';
  end if;
  if not exists (select 1 from portal_audit_log where action = 'sign_in' and portal_user_id = 'a041b000-0000-0000-0000-000000000002') then
    raise exception 'a successful sign-in should still audit sign_in';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/041_portal_sign_in_caps.sql`
Expected: FAIL with `portal_audit_action should have sign_in_failed`.

- [ ] **Step 3: Write the enum migration**

Create `supabase/migrations/20261012000001_portal_audit_actions_1b.sql`:

```sql
-- 20261012000001_portal_audit_actions_1b.sql
--
-- Partner Portal Phase 1B. New audit actions, alone in this file: a value added
-- with ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it,
-- and 20261012000002..000004 use all three.
--   sign_in_failed  every failed code verification (1A tracker item)
--   dup_check       the soft duplicate check (rate limited per portal user)
--   transcribe      portal speech-to-text (rate limited per portal user)

alter type portal_audit_action add value if not exists 'sign_in_failed';
alter type portal_audit_action add value if not exists 'dup_check';
alter type portal_audit_action add value if not exists 'transcribe';
```

- [ ] **Step 4: Write the sign-in caps migration**

Create `supabase/migrations/20261012000002_portal_sign_in_caps.sql`:

```sql
-- 20261012000002_portal_sign_in_caps.sql
--
-- Partner Portal Phase 1B (1A tracker items): at most 20 sign-in codes per
-- portal user per 24 hours, and an audit row on every failed verification.
-- Both functions keep their 1A signatures, so CREATE OR REPLACE keeps their
-- service-role-only privileges.

create index if not exists portal_audit_log_user_action_idx
  on portal_audit_log (portal_user_id, action, created_at);

create or replace function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org   organizations;
  v_user  portal_users;
  v_ip    text := nullif(btrim(coalesce(p_ip, '')), '');
  v_bytes bytea;
  v_code  text;
begin
  select * into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org.id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org.id and lower(u.email) = lower(btrim(coalesce(p_email, '')))
     for update;
  -- Both limits are count-then-insert, so they must be serialized or parallel
  -- requests all pass the check. The row lock above serializes issuance per
  -- user; the advisory lock below serializes the per-IP bucket. A missing IP
  -- has no bucket, so only the per-user limits apply to it.
  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_code_ip:' || v_ip, 0));
  end if;

  -- Every request counts toward the per-IP limit, whether or not the email exists.
  perform public._portal_audit(v_org.id, v_user.id, 'code_request', v_ip, null);
  if v_ip is not null and (select count(*) from portal_audit_log a
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
  -- Phase 1B: a daily ceiling as well, so a slow drip cannot mail a partner all day.
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '24 hours') >= 20 then
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
   where u.org_id = v_org_id and lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.status = 'active'
     for update;
  -- The row lock serializes this sign-in against portal_set_access. If a
  -- suspend or revoke commits while we wait, plpgsql re-reads the row and the
  -- status = 'active' predicate is applied again, so no session is opened.
  if v_user.id is null then
    perform public._portal_audit(v_org_id, null, 'sign_in_failed', p_ip, null);
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
    perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in_failed', p_ip, null);
    return;
  end if;

  update portal_tokens set consumed_at = now()
   where id = v_hit and consumed_at is null and revoked_at is null;
  if not found then
    perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in_failed', p_ip, null);
    return;
  end if;
  update portal_tokens t
     set revoked_at = now()
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null;
  update portal_users set last_login_at = now(), updated_at = now() where id = v_user.id;
  perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in', p_ip, null);

  return query select * from public._portal_create_session(v_user.id, p_ip, p_user_agent);
end $$;

-- Restated so the file stands alone; CREATE OR REPLACE already kept them.
revoke execute on function public.portal_issue_code(text, text, text)              from public, anon, authenticated;
revoke execute on function public.portal_verify_code(text, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_issue_code(text, text, text)              to service_role;
grant  execute on function public.portal_verify_code(text, text, text, text, text) to service_role;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/041_portal_sign_in_caps.sql && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/039_portal_sign_in.sql`
Expected: both exit 0 with no output (039 still passes against the replaced functions).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261012000001_portal_audit_actions_1b.sql supabase/migrations/20261012000002_portal_sign_in_caps.sql supabase/tests/041_portal_sign_in_caps.sql
git commit -m "$(cat <<'EOF'
feat(portal): daily sign-in code cap and failed sign-in audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Submission, soft duplicate check, attribution (SQL)

**Files:**
- Create: `supabase/migrations/20261012000003_portal_referral_submit.sql`
- Test: `supabase/tests/042_portal_referral_submit.sql`

**Interfaces:**
- Consumes (SQL): `public.profile_can_see_owner(p_viewer uuid, p_owner uuid) returns boolean` (Phase 0, service only), `public.referral_route_assignee(p_partner uuid) returns uuid` (Phase 0), `public.deal_phone_key(text)`, `public.deal_dedupe_key(text, text)`, `public.deal_name_key(text)` (existing normalizers), `deals.dedupe_key` (generated column).
- Produces (SQL):
  - Column `referrals.urgency text` checked to `this_week | this_month | no_rush`.
  - `public.referrals_record_status()` trigger function: when `navigatr.referral_actor = 'partner'`, history rows get `actor_type 'partner'` and `actor_id = navigatr.referral_actor_id::uuid`.
  - Private (no grants): `public._portal_assert_scope(p_org uuid, p_partner uuid, p_portal_user uuid) returns void` (raises `not_authorized`), `public._portal_audit_referral(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_referral uuid, p_ip text) returns void`, `public._portal_referral_ref(p_id uuid) returns text` (`'REF-' || upper(left(id::text, 8))`), `public._portal_find_duplicates(p_org uuid, p_partner uuid, p_name text, p_phone text, p_address text, p_exclude uuid) returns table (dup_referral_id uuid, dup_deal_id uuid)` (always one row).
  - Service role only:
    - `public.portal_form_context(p_org uuid, p_partner uuid) returns table (consent_text text, consent_version integer)`; consent text defaults to `I have permission to share this business's contact details.`
    - `public.portal_dup_check(p_org uuid, p_partner uuid, p_portal_user uuid, p_name text, p_phone text, p_address text, p_ip text) returns boolean`; raises `rate_limited` after 120 checks per portal user per hour.
    - `public.portal_submit_referral(p_org uuid, p_partner uuid, p_portal_user uuid, p_company text, p_contact_name text, p_contact_email text, p_contact_phone text, p_address text, p_industry text, p_urgency text, p_notes text, p_consent boolean, p_consent_version integer, p_ip text) returns table (id uuid, ref text)`; raises `consent_required`, `consent_changed`, `invalid_input:<field>` (field one of `companyName, contactName, email, phone, emailOrPhone, address, industry, urgency, notes`), `rate_limited` (30 per portal user per hour, 200 per 24 hours), `not_authorized`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/042_portal_referral_submit.sql`:

```sql
-- Tests for 20261012000003_portal_referral_submit (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/042_portal_referral_submit.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-submit (portal on, consent v3):
--   boss administrator; rep1 boss.rep1; rep2 boss.rep2 (rep1 and rep2 cannot see each other)
--   P1, P2, P4, P5 owned by rep1; P3 owned by rep2
--   U1..U4 active portal users for P1..P4; U5 suspended for P5
--   DV  rep1  Corner Cafe, 10 Elm Street, (555) 010-0001, contacted
--   DH  rep2  Hidden Gym,  20 Oak Ave,    555-010-0002,   new
--   DW  rep1  Old Bakery,  30 Pine Rd,    555-010-0003,   won
--   RX  P1 declined referral Declined Diner, 555-010-0004
--   U4 already sent 30 referrals ten minutes ago (rate limit)
-- Org B portal-submit-b (portal on, no consent text): bossB, PB, UB, deal DB Corner Cafe 555-010-0009.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001042', 'Submit Org',   'portal-submit',   'portal-submit-a1', true, 'I may share these details.', 3),
  ('00000000-0000-0000-0000-000000001142', 'Submit Org B', 'portal-submit-b', 'portal-submit-b1', true, null, 0);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0420000-0000-0000-0000-000000000001', 'boss@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000002', 'rep1@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000003', 'rep2@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000004', 'bossb@sub.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0420000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'admin', 'administrator',      'Boss',  'boss@sub.example',  'subboss'::ltree,      null),
  ('a0420000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'rep',   'sales_professional', 'Rep1',  'rep1@sub.example',  'subboss.rep1'::ltree, 'a0420000-0000-0000-0000-000000000001'),
  ('a0420000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'rep',   'sales_professional', 'Rep2',  'rep2@sub.example',  'subboss.rep2'::ltree, 'a0420000-0000-0000-0000-000000000001'),
  ('a0420000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001142', 'admin', 'administrator',      'BossB', 'bossb@sub.example', 'subbossb'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a042a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@sub.example'),
  ('a042a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@sub.example'),
  ('a042a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000003', 'a0420000-0000-0000-0000-000000000003', 'Lee CPA',  'Lee & Co',  'cpa', 'lee@sub.example'),
  ('a042a000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Max CPA',  'Max & Co',  'cpa', 'max@sub.example'),
  ('a042a000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Sus CPA',  'Sus & Co',  'cpa', 'sus@sub.example'),
  ('a042a000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001142', 'a0420000-0000-0000-0000-000000000004', 'a0420000-0000-0000-0000-000000000004', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@sub.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a042b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'jane@sub.example', 'active'),
  ('a042b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'kim@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000003', 'lee@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'max@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000005', 'sus@sub.example',  'suspended'),
  ('a042b000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001142', 'a042a000-0000-0000-0000-000000000006', 'bea@sub.example',  'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a042d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'Corner Cafe', '10 Elm Street', 'C', 'c@sub.example', '(555) 010-0001', 100, 'contacted', 'path'),
  ('a042d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000003', 'Hidden Gym',  '20 Oak Ave',    'C', 'h@sub.example', '555-010-0002',   100, 'new',       'path'),
  ('a042d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'Old Bakery',  '30 Pine Rd',    'C', 'o@sub.example', '555-010-0003',   100, 'won',       'path'),
  ('a042d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001142', 'a0420000-0000-0000-0000-000000000004', 'Corner Cafe', '10 Elm Street', 'C', 'b@sub.example', '555-010-0009',   100, 'new',       'path');

insert into referrals (id, org_id, partner_id, status, company_name, contact_phone, assigned_user_id) values
  ('a042f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'declined', 'Declined Diner', '555-010-0004', 'a0420000-0000-0000-0000-000000000002');

-- U4 already sent 30 referrals in the last hour.
insert into referrals (org_id, partner_id, source, company_name, contact_name, contact_phone, submitted_by_portal_user_id, submitted_at)
select '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'portal_signed_in',
       'Bulk ' || g, 'C', '555-020-' || lpad(g::text, 4, '0'), 'a042b000-0000-0000-0000-000000000004',
       now() - interval '10 minutes'
  from generate_series(1, 30) g;

create temp table _ids (k text primary key, v uuid);

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

-- 1. Schema and privileges.
do $$ declare f text; begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'referrals' and column_name = 'urgency') then
    raise exception 'referrals.urgency should exist';
  end if;
  foreach f in array array[
    'public.portal_form_context(uuid, uuid)',
    'public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)',
    'public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
  foreach f in array array[
    'public._portal_assert_scope(uuid, uuid, uuid)',
    'public._portal_audit_referral(uuid, uuid, portal_audit_action, uuid, text)',
    'public._portal_referral_ref(uuid)',
    'public._portal_find_duplicates(uuid, uuid, text, text, text, uuid)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'private helper % must not be executable by any API role', f;
    end if;
  end loop;
end $$;

-- 2. Consent wording for the form.
do $$ declare r record; begin
  select * into r from public.portal_form_context('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001');
  if r.consent_text is distinct from 'I may share these details.' or r.consent_version is distinct from 3 then
    raise exception 'form context for org A is wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_form_context('00000000-0000-0000-0000-000000001142', 'a042a000-0000-0000-0000-000000000006');
  if r.consent_text is distinct from 'I have permission to share this business''s contact details.' or r.consent_version is distinct from 0 then
    raise exception 'an org with no consent text gets the default line: %', row_to_json(r);
  end if;
  if exists (select 1 from public.portal_form_context('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000006')) then
    raise exception 'a partner from another org must get nothing';
  end if;
end $$;

-- 3. Soft duplicate check, scoped by the partner owner's visibility.
do $$
declare
  o  uuid := '00000000-0000-0000-0000-000000001042';
  p1 uuid := 'a042a000-0000-0000-0000-000000000001';
  u1 uuid := 'a042b000-0000-0000-0000-000000000001';
  n  int;
begin
  if not public.portal_dup_check(o, p1, u1, 'Anything Co', '+1 555 010 0001', null, '10.42.0.1') then
    raise exception 'a phone match on a visible deal should warn';
  end if;
  if not public.portal_dup_check(o, p1, u1, 'Corner Cafe LLC', null, '10 Elm St', '10.42.0.1') then
    raise exception 'a name+address match should warn';
  end if;
  if not public.portal_dup_check(o, p1, u1, 'corner cafe', null, null, '10.42.0.1') then
    raise exception 'a name match with no address should warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Corner Cafe', null, '99 Other Rd', '10.42.0.1') then
    raise exception 'the same name at a different known address must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Hidden Gym', '555-010-0002', null, '10.42.0.1') then
    raise exception 'a deal the partner owner cannot see must not be reported';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Old Bakery', null, '30 Pine Rd', '10.42.0.1') then
    raise exception 'a closed deal must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Nobody Co', '555-010-0009', null, '10.42.0.1') then
    raise exception 'a deal in another org must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Declined Diner', '555-010-0004', null, '10.42.0.1') then
    raise exception 'a declined referral must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Brand New Co', null, null, '10.42.0.1') then
    raise exception 'an unrelated business must not warn';
  end if;
  if not public.portal_dup_check(o, 'a042a000-0000-0000-0000-000000000003', 'a042b000-0000-0000-0000-000000000003',
                                 'Hidden Gym', '555-010-0002', null, '10.42.0.3') then
    raise exception 'the owner of the hidden deal should be warned';
  end if;
  select count(*) into n from portal_audit_log where action = 'dup_check' and portal_user_id = u1;
  if n <> 9 then raise exception 'each dup check should audit once, got %', n; end if;
end $$;

-- 4. Submit: stored fields, routing, consent version, history, audit, attribution.
do $$
declare
  o uuid := '00000000-0000-0000-0000-000000001042';
  r record;
  v referrals;
  h record;
begin
  select * into r from public.portal_submit_referral(
    o, 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    ' Corner Cafe ', 'Ann', 'ANN@cafe.example', '555 010 0001', null, 'restaurant', 'this_week',
    ' Busy at lunch ', true, 3, '10.42.0.1');
  insert into _ids values ('s1', r.id);
  if r.ref is distinct from 'REF-' || upper(left(r.id::text, 8)) then raise exception 'bad reference %', r.ref; end if;

  select * into v from referrals where id = r.id;
  if v.source <> 'portal_signed_in' or v.status <> 'submitted' or v.direction <> 'inbound' then
    raise exception 'wrong source, status or direction: %', row_to_json(v);
  end if;
  if v.company_name <> 'Corner Cafe' or v.contact_name <> 'Ann' or v.contact_email <> 'ann@cafe.example'
     or v.contact_phone <> '555 010 0001' or v.address is not null or v.place_id is not null
     or v.industry <> 'restaurant' or v.urgency <> 'this_week' or v.notes <> 'Busy at lunch' then
    raise exception 'submitted fields stored wrong: %', row_to_json(v);
  end if;
  if v.assigned_user_id is distinct from 'a0420000-0000-0000-0000-000000000002' then
    raise exception 'should route to the partner owner, got %', v.assigned_user_id;
  end if;
  if v.submitted_by_portal_user_id is distinct from 'a042b000-0000-0000-0000-000000000001'
     or v.submitted_by_user_id is not null then
    raise exception 'submitter should be the portal user only';
  end if;
  if v.consent_text_version is distinct from '3' then raise exception 'consent version should be stored from the org'; end if;
  if v.partner_company_snapshot is distinct from 'Jane & Co' then raise exception 'partner company should be snapshotted'; end if;
  if v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000001' or v.duplicate_of_referral_id is not null then
    raise exception 'first submission should flag only the visible deal: % %', v.duplicate_of_referral_id, v.duplicate_of_deal_id;
  end if;

  select * into h from referral_status_history where referral_id = r.id;
  if h.to_status <> 'submitted' or h.actor_type <> 'partner' or h.actor_id is distinct from 'a042b000-0000-0000-0000-000000000001' then
    raise exception 'history should record the partner: %', row_to_json(h);
  end if;
  if not exists (select 1 from portal_audit_log where action = 'submit' and referral_id = r.id
                   and portal_user_id = 'a042b000-0000-0000-0000-000000000001' and ip = '10.42.0.1') then
    raise exception 'submit should be audited with the referral';
  end if;
  if coalesce(current_setting('navigatr.referral_actor', true), '') <> ''
     or coalesce(current_setting('navigatr.referral_actor_id', true), '') <> '' then
    raise exception 'actor settings must be cleared after submit';
  end if;
end $$;

-- Same owner, other partner: the earlier referral keeps credit.
do $$ declare r record; v referrals; begin
  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000002',
    'Corner Cafe', 'Bob', null, '555-010-0001', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is distinct from (select i.v from _ids i where i.k = 's1')
     or v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000001' then
    raise exception 'second submission should point at the first referral and the deal: %', row_to_json(v);
  end if;
  if v.urgency is not null or v.industry is not null or v.contact_email is not null then
    raise exception 'blank optional fields should be null';
  end if;
end $$;

-- The hidden deal's owner sees it; a partner of another owner does not.
do $$ declare r record; v referrals; begin
  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000003', 'a042b000-0000-0000-0000-000000000003',
    'Hidden Gym', 'Cy', null, '555-010-0002', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000002' or v.duplicate_of_referral_id is not null then
    raise exception 'P3 should be flagged against its own owner''s deal only';
  end if;
  if v.assigned_user_id is distinct from 'a0420000-0000-0000-0000-000000000003' then
    raise exception 'P3 should route to rep2';
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Hidden Gym', 'Di', null, '555-010-0002', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_deal_id is not null or v.duplicate_of_referral_id is not null then
    raise exception 'rep1''s partner must not be flagged against rep2''s deal or partner: %', row_to_json(v);
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Declined Diner', 'Ed', null, '555-010-0004', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is not null or v.duplicate_of_deal_id is not null then
    raise exception 'a declined referral must not take credit';
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Fresh Start', 'Flo', 'flo@fresh.example', null, null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is not null or v.duplicate_of_deal_id is not null or v.contact_phone is not null then
    raise exception 'an email-only, unrelated submission should not be flagged';
  end if;
end $$;

-- 5. Validation (server side as well as in portal_api).
do $$
declare
  head text := $q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001', $q$;
begin
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, '', false, 3, null)$q$, 'consent_required');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, '', true, 2, null)$q$, 'consent_changed');
  perform _t_raises(head || $q$'   ', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:companyName');
  perform _t_raises(head || format('%L', repeat('x', 161)) || $q$, 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:companyName');
  perform _t_raises(head || $q$'Co', '', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:contactName');
  perform _t_raises(head || $q$'Co', 'Ann', 'not-an-email', null, null, null, null, '', true, 3, null)$q$, 'invalid_input:email');
  perform _t_raises(head || $q$'Co', 'Ann', null, null, null, null, null, '', true, 3, null)$q$, 'invalid_input:emailOrPhone');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, 'casino', null, '', true, 3, null)$q$, 'invalid_input:industry');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, 'asap', '', true, 3, null)$q$, 'invalid_input:urgency');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, $q$ || format('%L', repeat('x', 4001)) || $q$, true, 3, null)$q$, 'invalid_input:notes');
end $$;

-- 6. Scope: the portal user must belong to this org and partner and be active.
do $$ begin
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000001', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000006', 'a042b000-0000-0000-0000-000000000006', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000005', 'a042b000-0000-0000-0000-000000000005', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_dup_check('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000001', 'Co', null, null, null)$q$, 'not_authorized');
end $$;

-- 7. Rate limits.
do $$
declare
  call text := $q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'a042b000-0000-0000-0000-000000000004', 'One More Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$;
  n int;
begin
  -- 30 in the last hour.
  perform _t_raises(call, 'rate_limited');

  -- Move them out of the hour, then fill the day to 200.
  update referrals set submitted_at = now() - interval '2 hours'
   where submitted_by_portal_user_id = 'a042b000-0000-0000-0000-000000000004';
  insert into referrals (org_id, partner_id, source, company_name, contact_name, contact_phone, submitted_by_portal_user_id, submitted_at)
  select '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'portal_signed_in',
         'Daily ' || g, 'C', '555-030-' || lpad(g::text, 4, '0'), 'a042b000-0000-0000-0000-000000000004',
         now() - interval '3 hours'
    from generate_series(1, 170) g;
  perform _t_raises(call, 'rate_limited');

  -- One drops out of the 24 hours: the next submission goes through.
  update referrals set submitted_at = now() - interval '25 hours'
   where id = (select id from referrals where company_name = 'Daily 1'
                 and submitted_by_portal_user_id = 'a042b000-0000-0000-0000-000000000004');
  execute call;
  select count(*) into n from referrals where company_name = 'One More Co';
  if n <> 1 then raise exception 'a submission under both limits should succeed'; end if;

  -- dup_check: 120 per portal user per hour.
  insert into portal_audit_log (org_id, portal_user_id, action, created_at)
  select '00000000-0000-0000-0000-000000001042', 'a042b000-0000-0000-0000-000000000002', 'dup_check', now() - interval '5 minutes'
    from generate_series(1, 120);
  perform _t_raises($q$select public.portal_dup_check('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000002', 'Co', null, null, null)$q$, 'rate_limited');
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/042_portal_referral_submit.sql`
Expected: FAIL with `referrals.urgency should exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261012000003_portal_referral_submit.sql`:

```sql
-- 20261012000003_portal_referral_submit.sql
--
-- Partner Portal Phase 1B (spec 5.5, FR-PORT-35..50): a signed-in partner
-- submits a referral. The soft duplicate check and the attribution flags run
-- with the PARTNER OWNER's visibility (profile_can_see_owner), never org-wide,
-- and reuse the deal normalizers (deal_phone_key, deal_dedupe_key,
-- deal_name_key). Email is not part of the match (spec R8).
--
-- Service role only (portal_api). Every function takes the org, partner and
-- portal user that portal_session_lookup returned; portal_api never takes them
-- from a request.

-- 1. Urgency (spec 4.1 has no column for it) ------------------------------------
alter table referrals add column if not exists urgency text
  check (urgency is null or urgency in ('this_week','this_month','no_rush'));

create index if not exists referrals_portal_user_submitted_idx
  on referrals (submitted_by_portal_user_id, submitted_at)
  where submitted_by_portal_user_id is not null;

-- 2. History records partner actors ----------------------------------------------
-- Writers set navigatr.referral_actor to 'partner' (with navigatr.referral_actor_id
-- = the portal user id) or 'system'; anything else is the signed-in user.
create or replace function public.referrals_record_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor    text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_actor_id text := nullif(current_setting('navigatr.referral_actor_id', true), '');
  v_note     text := nullif(current_setting('navigatr.referral_note', true), '');
  v_type     referral_actor_type;
  v_id       uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if v_actor = 'partner' then
    v_type := 'partner';
    v_id   := v_actor_id::uuid;
  elsif v_actor = 'system' or auth.uid() is null then
    v_type := 'system';
    v_id   := null;
  else
    v_type := 'user';
    v_id   := auth.uid();
  end if;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (
    new.org_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    v_type,
    v_id,
    v_note
  );
  return new;
end $$;

revoke execute on function public.referrals_record_status() from public, anon, authenticated;

-- 3. Private helpers --------------------------------------------------------------

-- The session's portal user must still be active, belong to this org and this
-- partner, and the portal must still be on. Raises instead of returning, so a
-- caller can never forget to check.
create or replace function public._portal_assert_scope(p_org uuid, p_partner uuid, p_portal_user uuid)
returns void language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1
      from portal_users u
      join organizations o on o.id = u.org_id
     where u.id = p_portal_user and u.org_id = p_org and u.partner_id = p_partner
       and u.status = 'active' and o.portal_enabled and not o.is_disabled
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

-- _portal_audit (1A) has no referral column; this one does.
create or replace function public._portal_audit_referral(
  p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_referral uuid, p_ip text
) returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_audit_log (org_id, portal_user_id, action, referral_id, ip)
  values (p_org, p_portal_user, p_action, p_referral, nullif(btrim(coalesce(p_ip, '')), ''))
$$;

-- Short human reference (brief D5): REF- plus the first 8 hex digits, uppercase.
create or replace function public._portal_referral_ref(p_id uuid)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select 'REF-' || upper(left(p_id::text, 8))
$$;

-- Earliest probable match among live referrals and active deals the partner's
-- OWNER can see (FR-PORT-45/50). A match is the same phone key, the same
-- name+address key, or the same name key when either side has no address.
-- Referrals: the same partner's, or any partner the owner can see. Declined
-- and withdrawn referrals never take credit (FR-PORT-46). Always one row.
create or replace function public._portal_find_duplicates(
  p_org uuid, p_partner uuid, p_name text, p_phone text, p_address text, p_exclude uuid
)
returns table (dup_referral_id uuid, dup_deal_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  with viewer as (
    select p.owner_id from partners p where p.id = p_partner and p.org_id = p_org
  ),
  k as (
    select public.deal_phone_key(p_phone)            as phone_key,
           public.deal_dedupe_key(p_name, p_address) as na_key,
           public.deal_name_key(p_name)              as name_key
  )
  select
    (select r.id
       from referrals r
       join partners rp on rp.id = r.partner_id
       cross join k
      where r.org_id = p_org
        and r.direction = 'inbound'
        and r.status not in ('declined','withdrawn')
        and r.id is distinct from p_exclude
        and (r.partner_id = p_partner
             or public.profile_can_see_owner((select v.owner_id from viewer v), rp.owner_id))
        and (
          (k.phone_key is not null and public.deal_phone_key(r.contact_phone) = k.phone_key)
          or (k.na_key is not null and public.deal_dedupe_key(r.company_name, r.address) = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or public.deal_dedupe_key(r.company_name, r.address) is null)
              and public.deal_name_key(r.company_name) = k.name_key)
        )
      order by r.submitted_at, r.id
      limit 1),
    (select d.id
       from deals d
       cross join k
      where d.org_id = p_org
        and d.stage not in ('won','lost')
        and public.profile_can_see_owner((select v.owner_id from viewer v), d.owner_id)
        and (
          (k.phone_key is not null and public.deal_phone_key(d.contact_phone) = k.phone_key)
          or (k.na_key is not null and d.dedupe_key = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or d.dedupe_key is null)
              and public.deal_name_key(d.company_name) = k.name_key)
        )
      order by d.created_at, d.id
      limit 1)
$$;

-- 4. Form context ----------------------------------------------------------------
create or replace function public.portal_form_context(p_org uuid, p_partner uuid)
returns table (consent_text text, consent_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(nullif(btrim(o.consent_text), ''),
                  'I have permission to share this business''s contact details.'),
         o.consent_version
    from organizations o
    join partners p on p.org_id = o.id and p.id = p_partner
   where o.id = p_org and o.portal_enabled and not o.is_disabled
$$;

-- 5. Soft duplicate check (FR-PORT-38) -------------------------------------------
-- Answers only yes or no. The partner never learns which rep, stage, value, or
-- that another partner sent it.
create or replace function public.portal_dup_check(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_name text, p_phone text, p_address text, p_ip text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ref  uuid;
  v_deal uuid;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_dup:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'dup_check'
         and a.created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform public._portal_audit_referral(p_org, p_portal_user, 'dup_check', null, p_ip);

  if btrim(coalesce(p_name, '')) = '' then
    return false;
  end if;
  select f.dup_referral_id, f.dup_deal_id into v_ref, v_deal
    from public._portal_find_duplicates(
      p_org, p_partner, btrim(p_name),
      nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''), null) f;
  return v_ref is not null or v_deal is not null;
end $$;

-- 6. Submit (FR-PORT-35..43, 46..49) ----------------------------------------------
create or replace function public.portal_submit_referral(
  p_org             uuid,
  p_partner         uuid,
  p_portal_user     uuid,
  p_company         text,
  p_contact_name    text,
  p_contact_email   text,
  p_contact_phone   text,
  p_address         text,
  p_industry        text,
  p_urgency         text,
  p_notes           text,
  p_consent         boolean,
  p_consent_version integer,
  p_ip              text
)
returns table (id uuid, ref text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org      organizations;
  v_partner  partners;
  v_company  text := btrim(coalesce(p_company, ''));
  v_contact  text := btrim(coalesce(p_contact_name, ''));
  v_email    text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_phone    text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_address  text := nullif(btrim(coalesce(p_address, '')), '');
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_urgency  text := nullif(btrim(coalesce(p_urgency, '')), '');
  v_notes    text := btrim(coalesce(p_notes, ''));
  v_dup_ref  uuid;
  v_dup_deal uuid;
  v_id       uuid;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into v_org from organizations o where o.id = p_org;
  select * into v_partner from partners p where p.id = p_partner;

  -- Consent (brief D4): required, and the version is the org's, never the client's.
  if not coalesce(p_consent, false) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if p_consent_version is distinct from v_org.consent_version then
    raise exception 'consent_changed' using errcode = 'P0001';
  end if;

  -- Field rules mirror _shared/portalSubmission.ts (brief D9).
  if v_company = '' or length(v_company) > 160 then
    raise exception 'invalid_input:companyName' using errcode = '22023';
  end if;
  if v_contact = '' or length(v_contact) > 120 then
    raise exception 'invalid_input:contactName' using errcode = '22023';
  end if;
  if v_email is not null and (length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'invalid_input:email' using errcode = '22023';
  end if;
  if v_phone is not null and length(v_phone) > 40 then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'invalid_input:emailOrPhone' using errcode = '22023';
  end if;
  if v_address is not null and length(v_address) > 300 then
    raise exception 'invalid_input:address' using errcode = '22023';
  end if;
  if v_industry is not null and v_industry not in
     ('restaurant','retail','healthcare','professional_services','personal_services','automotive','other') then
    raise exception 'invalid_input:industry' using errcode = '22023';
  end if;
  if v_urgency is not null and v_urgency not in ('this_week','this_month','no_rush') then
    raise exception 'invalid_input:urgency' using errcode = '22023';
  end if;
  if length(v_notes) > 4000 then
    raise exception 'invalid_input:notes' using errcode = '22023';
  end if;

  -- Rate limits (brief D8): 30 per hour and 200 per day per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_submit:' || p_portal_user::text, 0));
  if (select count(*) from referrals r
       where r.submitted_by_portal_user_id = p_portal_user and r.source = 'portal_signed_in'
         and r.submitted_at > now() - interval '1 hour') >= 30
     or (select count(*) from referrals r
       where r.submitted_by_portal_user_id = p_portal_user and r.source = 'portal_signed_in'
         and r.submitted_at > now() - interval '24 hours') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Attribution (FR-PORT-46..49): the earlier referral keeps credit; this one is flagged.
  select f.dup_referral_id, f.dup_deal_id into v_dup_ref, v_dup_deal
    from public._portal_find_duplicates(p_org, p_partner, v_company, v_phone, v_address, null) f;

  perform set_config('navigatr.referral_actor', 'partner', true);
  perform set_config('navigatr.referral_actor_id', p_portal_user::text, true);
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name,
    contact_email, contact_phone, address, industry, urgency, notes,
    partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id,
    duplicate_of_referral_id, duplicate_of_deal_id, consent_text_version
  ) values (
    p_org, p_partner, 'inbound', 'portal_signed_in', 'submitted', v_company, v_contact,
    v_email, v_phone, v_address, v_industry, v_urgency, v_notes,
    v_partner.company, public.referral_route_assignee(p_partner), p_portal_user,
    v_dup_ref, v_dup_deal, v_org.consent_version::text
  ) returning referrals.id into v_id;
  perform set_config('navigatr.referral_actor', '', true);
  perform set_config('navigatr.referral_actor_id', '', true);

  perform public._portal_audit_referral(p_org, p_portal_user, 'submit', v_id, p_ip);

  return query select v_id, public._portal_referral_ref(v_id);
end $$;

-- 7. Privileges ------------------------------------------------------------------
revoke execute on function public._portal_assert_scope(uuid, uuid, uuid)                           from public, anon, authenticated, service_role;
revoke execute on function public._portal_audit_referral(uuid, uuid, portal_audit_action, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_referral_ref(uuid)                                        from public, anon, authenticated, service_role;
revoke execute on function public._portal_find_duplicates(uuid, uuid, text, text, text, uuid)       from public, anon, authenticated, service_role;

revoke execute on function public.portal_form_context(uuid, uuid)                                   from public, anon, authenticated;
revoke execute on function public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)        from public, anon, authenticated;
revoke execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text) from public, anon, authenticated;
grant  execute on function public.portal_form_context(uuid, uuid)                                   to service_role;
grant  execute on function public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)        to service_role;
grant  execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text) to service_role;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `supabase db reset && for f in 034 035 036 042; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/${f}_*.sql || exit 1; done`
Expected: exits 0 with no output (the Phase 0 referral tests still pass with the replaced history trigger).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012000003_portal_referral_submit.sql supabase/tests/042_portal_referral_submit.sql
git commit -m "$(cat <<'EOF'
feat(portal): referral submission with owner-scoped duplicate check and attribution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: List, detail, history, stats, withdraw, transcribe claim (SQL)

**Files:**
- Create: `supabase/migrations/20261012000004_portal_referral_read.sql`
- Test: `supabase/tests/043_portal_referral_read.sql`

**Interfaces:**
- Consumes (SQL, Task 2): `_portal_assert_scope`, `_portal_audit_referral`, `_portal_referral_ref`, the partner actor in `referrals_record_status`.
- Produces (SQL, service role only). All filter `org_id = p_org and partner_id = p_partner and direction = 'inbound' and purged_at is null`, so another partner's or another org's referral looks missing:
  - `public.portal_list_referrals(p_org uuid, p_partner uuid, p_since timestamptz) returns table (id uuid, ref text, company_name text, status referral_status, submitted_at timestamptz, last_activity_at timestamptz)`; `p_since` null means all time; ordered by `last_activity_at desc, id`; at most 500 rows.
  - `public.portal_get_referral(p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text) returns table (id uuid, ref text, company_name text, contact_name text, contact_email text, contact_phone text, address text, industry text, urgency text, notes text, status referral_status, source referral_source, submitted_at timestamptz, rep_name text, rep_email text, can_withdraw boolean)`; zero rows when not visible; contact fields, industry, urgency and notes are null unless `source = 'portal_signed_in'`; writes `view_referral` at most once per portal user per referral per hour.
  - `public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid) returns table (status referral_status, created_at timestamptz)` ordered by `created_at, status, id`.
  - `public.portal_dashboard_stats(p_org uuid, p_partner uuid, p_since timestamptz) returns table (submitted bigint, active bigint, closed_won bigint, not_moving_forward bigint, won_value_cents bigint, value_visible boolean)`; always one row.
  - `public.portal_withdraw_referral(p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text) returns void`; raises `referral_not_found` or `not_withdrawable`; history actor is the partner.
  - `public.portal_claim_transcribe(p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text) returns boolean`; false after 30 per portal user per hour, otherwise records a `transcribe` audit row and returns true.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/043_portal_referral_read.sql`:

```sql
-- Tests for 20261012000004_portal_referral_read (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/043_portal_referral_read.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-read: boss; rep1 Rita Rep (rita@read.example) owns P1 and P2.
--   R1 P1 portal  submitted  Fresh Bakery   2 days ago
--   R2 P1 rep     won        Won Co         40 days ago, deal DW worth $5,000, extra history 1 hour ago
--   R3 P1 portal  declined   Nope Co        100 days ago (internal decline reason and note)
--   R4 P1 rep     accepted   Logged Co      1 day ago (rep-typed notes)
--   R5 P2 portal  submitted  Other Partner Co
--   RO P1 outbound referral
-- Org B portal-read-b: PB with RB.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001043', 'Read Org',   'portal-read',   'portal-read-a1', true),
  ('00000000-0000-0000-0000-000000001143', 'Read Org B', 'portal-read-b', 'portal-read-b1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0430000-0000-0000-0000-000000000001', 'boss@read.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0430000-0000-0000-0000-000000000002', 'rita@read.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0430000-0000-0000-0000-000000000003', 'bossb@read.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0430000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'admin', 'administrator',      'Boss',      'boss@read.example',  'readboss'::ltree,      null),
  ('a0430000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'rep',   'sales_professional', 'Rita Rep',  'rita@read.example',  'readboss.rita'::ltree, 'a0430000-0000-0000-0000-000000000001'),
  ('a0430000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'admin', 'administrator',      'Boss B',    'bossb@read.example', 'readbossb'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a043a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'a0430000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@read.example'),
  ('a043a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'a0430000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@read.example'),
  ('a043a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'a0430000-0000-0000-0000-000000000003', 'a0430000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@read.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a043b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'jane@read.example', 'active'),
  ('a043b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'kim@read.example',  'active'),
  ('a043b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', 'bea@read.example',  'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a043d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'Won Co', '9 Gold St', 'Wes', 'wes@won.example', '5550100200', 500000, 'won', 'partner_referral');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
  contact_phone, address, industry, urgency, notes, deal_id, assigned_user_id,
  submitted_by_portal_user_id, decline_reason, decline_note, submitted_at
) values
  ('a043f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'submitted', 'Fresh Bakery',     'Ann', 'ann@fresh.example',  '5550100100', '5 Oak St',  'restaurant', 'this_week', 'Wants a demo',          null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', null,          null,                    now() - interval '2 days'),
  ('a043f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered',      'won',       'Won Co',           'Wes', 'wes@won.example',    '5550100200', '9 Gold St', 'retail',     null,        'internal: big margins', 'a043d000-0000-0000-0000-000000000001', 'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '40 days'),
  ('a043f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'declined',  'Nope Co',          'Nia', null,                 '5550100300', null,        null,         null,        'please call',           null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', 'outside_icp', 'internal decline note', now() - interval '100 days'),
  ('a043f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered',      'accepted',  'Logged Co',        'Bob', 'bob@logged.example', '5550100400', '4 Log Rd',  null,         null,        'rep secret note',       null,                                   'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '1 day'),
  ('a043f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'inbound',  'portal_signed_in', 'submitted', 'Other Partner Co', 'Oz',  null,                 '5550100500', null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000002', null,          null,                    now() - interval '3 days'),
  ('a043f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered',      'accepted',  'Outbound Co',      null,  null,                 null,         null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '5 days'),
  ('a043f000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', 'inbound',  'portal_signed_in', 'submitted', 'Tenant B Co',      'Bo',  null,                 '5550100700', null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000003', 'a043b000-0000-0000-0000-000000000003', null,          null,                    now() - interval '1 day');

-- History rows were written at transaction time; date them like real life,
-- then give R2 a later change so it is the most recently active.
update referral_status_history h
   set created_at = r.submitted_at
  from referrals r
 where r.id = h.referral_id
   and r.org_id in ('00000000-0000-0000-0000-000000001043', '00000000-0000-0000-0000-000000001143');
insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, created_at) values
  ('00000000-0000-0000-0000-000000001043', 'a043f000-0000-0000-0000-000000000002', 'working', 'won', 'system', now() - interval '1 hour');

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

-- 1. Privileges.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_list_referrals(uuid, uuid, timestamptz)',
    'public.portal_get_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_referral_history(uuid, uuid, uuid)',
    'public.portal_dashboard_stats(uuid, uuid, timestamptz)',
    'public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_claim_transcribe(uuid, uuid, uuid, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- 2. List: own inbound referrals only, latest activity first, window on submitted_at.
do $$ declare ids uuid[]; r record; begin
  select array_agg(l.id order by l.n) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null)
         with ordinality as l(id, ref, company_name, status, submitted_at, last_activity_at, n);
  if ids is distinct from array['a043f000-0000-0000-0000-000000000002', 'a043f000-0000-0000-0000-000000000004',
                                'a043f000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'all-time list wrong or out of order: %', ids;
  end if;

  select * into r from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null) l
   where l.id = 'a043f000-0000-0000-0000-000000000001';
  if r.ref <> 'REF-A043F000' or r.status <> 'submitted' or r.company_name <> 'Fresh Bakery' then
    raise exception 'list row wrong: %', row_to_json(r);
  end if;

  select array_agg(l.id order by l.n) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', now() - interval '30 days')
         with ordinality as l(id, ref, company_name, status, submitted_at, last_activity_at, n);
  if ids is distinct from array['a043f000-0000-0000-0000-000000000004', 'a043f000-0000-0000-0000-000000000001']::uuid[] then
    raise exception '30-day list wrong: %', ids;
  end if;

  select array_agg(l.id) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', null) l;
  if ids is distinct from array['a043f000-0000-0000-0000-000000000007']::uuid[] then
    raise exception 'org B list wrong: %', ids;
  end if;
  if exists (select 1 from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000003', null)) then
    raise exception 'a partner paired with the wrong org must see nothing';
  end if;
end $$;

-- 3. Detail: allowlisted fields, rep-typed text hidden, other partners and orgs invisible.
do $$ declare r record; n int; begin
  select * into r from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.1');
  if r.company_name <> 'Fresh Bakery' or r.contact_name <> 'Ann' or r.contact_email <> 'ann@fresh.example'
     or r.contact_phone <> '5550100100' or r.address <> '5 Oak St' or r.industry <> 'restaurant'
     or r.urgency <> 'this_week' or r.notes <> 'Wants a demo' or r.status <> 'submitted'
     or r.source <> 'portal_signed_in' or r.ref <> 'REF-A043F000' then
    raise exception 'portal referral detail wrong: %', row_to_json(r);
  end if;
  if r.rep_name <> 'Rita Rep' or r.rep_email <> 'rita@read.example' or not r.can_withdraw then
    raise exception 'rep contact or withdraw flag wrong: %', row_to_json(r);
  end if;

  select * into r from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000004', null);
  if r.company_name <> 'Logged Co' or r.contact_name is not null or r.contact_email is not null or r.contact_phone is not null
     or r.address is not null or r.notes is not null or r.can_withdraw then
    raise exception 'a rep-logged referral must hide rep-typed detail: %', row_to_json(r);
  end if;

  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000005', null);
  if n <> 0 then raise exception 'another partner''s referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000007', null);
  if n <> 0 then raise exception 'another org''s referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000006', null);
  if n <> 0 then raise exception 'an outbound referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003',
    'a043b000-0000-0000-0000-000000000003', 'a043f000-0000-0000-0000-000000000007', null);
  if n <> 1 then raise exception 'org B should see its own referral'; end if;

  perform _t_raises($q$select * from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000005', null)$q$, 'not_authorized');

  -- A second look within the hour is not audited again.
  perform public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.1');
  select count(*) into n from portal_audit_log
   where action = 'view_referral' and portal_user_id = 'a043b000-0000-0000-0000-000000000001'
     and referral_id = 'a043f000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'detail views should be audited once per hour, got %', n; end if;
end $$;

-- 4. History: oldest first, scoped like the detail.
do $$ declare s text[]; n int; begin
  select array_agg(h.status::text order by h.n) into s
    from public.portal_referral_history('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                        'a043f000-0000-0000-0000-000000000002')
         with ordinality as h(status, created_at, n);
  if s is distinct from array['won', 'won'] then raise exception 'history for R2 wrong: %', s; end if;
  select count(*) into n from public.portal_referral_history('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                                             'a043f000-0000-0000-0000-000000000005');
  if n <> 0 then raise exception 'another partner''s history must look missing'; end if;
end $$;

-- 5. Stats with windows and the value flag.
do $$ declare r record; begin
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null);
  if r.submitted <> 4 or r.active <> 2 or r.closed_won <> 1 or r.not_moving_forward <> 1
     or r.won_value_cents <> 500000 or r.value_visible then
    raise exception 'all-time stats wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', now() - interval '30 days');
  if r.submitted <> 2 or r.active <> 2 or r.closed_won <> 0 or r.not_moving_forward <> 0 or r.won_value_cents <> 0 then
    raise exception '30-day stats wrong: %', row_to_json(r);
  end if;
  update organizations set partner_value_visibility = true where id = '00000000-0000-0000-0000-000000001043';
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null);
  if not r.value_visible then raise exception 'value flag should follow the org setting'; end if;
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000003', null);
  if r.submitted <> 0 or r.won_value_cents <> 0 then raise exception 'a mismatched partner must count nothing'; end if;
end $$;

-- 6. Withdraw: only the partner's own portal submissions, only while submitted.
do $$
declare
  head text := $q$select public.portal_withdraw_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'a043b000-0000-0000-0000-000000000001', $q$;
  h record;
begin
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000004', null)$q$, 'not_withdrawable');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000002', null)$q$, 'not_withdrawable');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000005', null)$q$, 'referral_not_found');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000007', null)$q$, 'referral_not_found');

  perform public.portal_withdraw_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.2');
  if (select status from referrals where id = 'a043f000-0000-0000-0000-000000000001') <> 'withdrawn' then
    raise exception 'R1 should be withdrawn';
  end if;
  select * into h from referral_status_history
   where referral_id = 'a043f000-0000-0000-0000-000000000001' and to_status = 'withdrawn';
  if h.from_status <> 'submitted' or h.actor_type <> 'partner' or h.actor_id is distinct from 'a043b000-0000-0000-0000-000000000001' then
    raise exception 'withdraw history should credit the partner: %', row_to_json(h);
  end if;
  if not exists (select 1 from portal_audit_log where action = 'withdraw' and referral_id = 'a043f000-0000-0000-0000-000000000001'
                   and portal_user_id = 'a043b000-0000-0000-0000-000000000001' and ip = '10.43.0.2') then
    raise exception 'withdraw should be audited';
  end if;
  if coalesce(current_setting('navigatr.referral_actor', true), '') <> '' then
    raise exception 'actor setting must be cleared after withdraw';
  end if;
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000001', null)$q$, 'not_withdrawable');
end $$;

-- 7. Transcribe claim: 30 per portal user per hour.
do $$ declare n int; begin
  if not public.portal_claim_transcribe('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                        'a043b000-0000-0000-0000-000000000001', '10.43.0.3') then
    raise exception 'the first transcription should be allowed';
  end if;
  insert into portal_audit_log (org_id, portal_user_id, action, created_at)
  select '00000000-0000-0000-0000-000000001043', 'a043b000-0000-0000-0000-000000000001', 'transcribe', now() - interval '5 minutes'
    from generate_series(1, 29);
  if public.portal_claim_transcribe('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                    'a043b000-0000-0000-0000-000000000001', '10.43.0.3') then
    raise exception 'the 31st transcription in an hour must be refused';
  end if;
  select count(*) into n from portal_audit_log where action = 'transcribe' and portal_user_id = 'a043b000-0000-0000-0000-000000000001';
  if n <> 30 then raise exception 'a refused claim must not be recorded, got %', n; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/043_portal_referral_read.sql`
Expected: FAIL with `function public.portal_list_referrals(uuid, uuid, timestamp with time zone) does not exist` (from `has_function_privilege`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261012000004_portal_referral_read.sql`:

```sql
-- 20261012000004_portal_referral_read.sql
--
-- Partner Portal Phase 1B (spec 5.5 withdraw, 5.6 views): what a signed-in
-- partner can read and the one change they can make. Service role only
-- (portal_api). Every query is pinned to (org, partner) from the session, and
-- to inbound, unpurged referrals, so another partner's or another org's id
-- looks exactly like a missing one.
--
-- These functions return the INTERNAL status; portal_api maps it to a partner
-- label through _shared/portalLabels.ts and never passes it through.

create or replace function public.portal_list_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  id uuid, ref text, company_name text, status referral_status,
  submitted_at timestamptz, last_activity_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select r.id,
         public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at)) as last_activity_at
    from referrals r
    left join lateral (
      select max(x.created_at) as last_at
        from referral_status_history x
       where x.referral_id = r.id
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

-- Detail. Business fields come back only for what the partner typed themselves
-- (source portal_signed_in); a rep-logged referral shows its company name and
-- status, never text a rep wrote (spec 6). The assigned rep's name and business
-- email (profiles has no phone). Detail views are audited once per hour per
-- referral, because the page polls.
create or replace function public.portal_get_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, address text, industry text, urgency text, notes text,
  status referral_status, source referral_source, submitted_at timestamptz,
  rep_name text, rep_email text, can_withdraw boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_found boolean;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select true into v_found
    from referrals r
   where r.id = p_referral and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null;
  if v_found is null then
    return;
  end if;

  if not exists (
    select 1 from portal_audit_log a
     where a.portal_user_id = p_portal_user and a.action = 'view_referral'
       and a.referral_id = p_referral and a.created_at > now() - interval '1 hour'
  ) then
    perform public._portal_audit_referral(p_org, p_portal_user, 'view_referral', p_referral, p_ip);
  end if;

  return query
    select r.id,
           public._portal_referral_ref(r.id),
           r.company_name,
           case when r.source = 'portal_signed_in' then r.contact_name end,
           case when r.source = 'portal_signed_in' then r.contact_email end,
           case when r.source = 'portal_signed_in' then r.contact_phone end,
           case when r.source = 'portal_signed_in' then r.address end,
           case when r.source = 'portal_signed_in' then r.industry end,
           case when r.source = 'portal_signed_in' then r.urgency end,
           case when r.source = 'portal_signed_in' then r.notes end,
           r.status,
           r.source,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.status = 'submitted' and r.source = 'portal_signed_in')
      from referrals r
      left join profiles pr on pr.id = r.assigned_user_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

-- Status changes, oldest first. Two changes in one transaction share a
-- timestamp (for example accepted then working on a merge), so the enum order
-- breaks the tie in the natural direction.
create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
   order by h.created_at, h.to_status, h.id
$$;

-- Dashboard tiles (FR-PORT-68..71). Active = submitted, accepted, working.
-- Not moving forward = lost or declined. Value is the closed-won deals' value;
-- portal_api drops it unless value_visible.
create or replace function public.portal_dashboard_stats(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  submitted bigint, active bigint, closed_won bigint, not_moving_forward bigint,
  won_value_cents bigint, value_visible boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select count(r.id),
         count(r.id) filter (where r.status in ('submitted','accepted','working')),
         count(r.id) filter (where r.status = 'won'),
         count(r.id) filter (where r.status in ('lost','declined')),
         coalesce(sum(d.value_cents) filter (where r.status = 'won'), 0)::bigint,
         coalesce((select o.partner_value_visibility from organizations o where o.id = p_org), false)
    from referrals r
    left join deals d on d.id = r.deal_id
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
     and (p_since is null or r.submitted_at >= p_since)
$$;

-- Withdraw (FR-PORT-42): only the partner's own portal submission, only while
-- it is still submitted. History records the partner as the actor.
create or replace function public.portal_withdraw_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  r referrals;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into r
    from referrals x
   where x.id = p_referral and x.org_id = p_org and x.partner_id = p_partner
     and x.direction = 'inbound' and x.purged_at is null
     for update;
  if r.id is null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'submitted' or r.source <> 'portal_signed_in' then
    raise exception 'not_withdrawable' using errcode = '55000';
  end if;

  perform set_config('navigatr.referral_actor', 'partner', true);
  perform set_config('navigatr.referral_actor_id', p_portal_user::text, true);
  update referrals set status = 'withdrawn' where id = r.id;
  perform set_config('navigatr.referral_actor', '', true);
  perform set_config('navigatr.referral_actor_id', '', true);

  perform public._portal_audit_referral(p_org, p_portal_user, 'withdraw', r.id, p_ip);
end $$;

-- Speech-to-text budget (brief D6): 30 per portal user per hour. Returns false
-- instead of raising so nothing is recorded for a refused request.
create or replace function public.portal_claim_transcribe(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  perform pg_advisory_xact_lock(hashtextextended('portal_transcribe:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'transcribe'
         and a.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  perform public._portal_audit_referral(p_org, p_portal_user, 'transcribe', null, p_ip);
  return true;
end $$;

-- Privileges ---------------------------------------------------------------------
revoke execute on function public.portal_list_referrals(uuid, uuid, timestamptz)          from public, anon, authenticated;
revoke execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)       from public, anon, authenticated;
revoke execute on function public.portal_referral_history(uuid, uuid, uuid)               from public, anon, authenticated;
revoke execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)         from public, anon, authenticated;
revoke execute on function public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)  from public, anon, authenticated;
revoke execute on function public.portal_claim_transcribe(uuid, uuid, uuid, text)         from public, anon, authenticated;
grant  execute on function public.portal_list_referrals(uuid, uuid, timestamptz)          to service_role;
grant  execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)       to service_role;
grant  execute on function public.portal_referral_history(uuid, uuid, uuid)               to service_role;
grant  execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)         to service_role;
grant  execute on function public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)  to service_role;
grant  execute on function public.portal_claim_transcribe(uuid, uuid, uuid, text)         to service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/043_portal_referral_read.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012000004_portal_referral_read.sql supabase/tests/043_portal_referral_read.sql
git commit -m "$(cat <<'EOF'
feat(portal): partner list, detail, history, stats and withdraw SQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Accepting a flagged referral needs a written reason (SQL)

FR-PORT-47 and spec 5.5 "Override requires a written reason, recorded in history".

**Files:**
- Create: `supabase/migrations/20261012000005_accept_referral_override.sql`
- Test: `supabase/tests/044_accept_referral_override.sql`

**Interfaces:**
- Consumes (SQL, Phase 0): `public._referral_for_update(uuid) returns referrals`, `public._referral_set_note(text)`, `public.can_triage_referral(uuid)`, `public.next_business_day(date, uuid)`, the `navigatr.referral_note` history convention.
- Produces (SQL, callable by `authenticated`):
  - `public.accept_referral(p_referral_id uuid) returns jsonb`: unchanged result shape (`{ "result": "accepted" | "duplicate", "deal_id": uuid | null }`); now raises `override_reason_required` when `duplicate_of_referral_id` or `duplicate_of_deal_id` is set and no reason note is in effect.
  - `public.accept_referral_override(p_referral_id uuid, p_override_reason text) returns jsonb`: same result shape; raises `override_reason_required` for a blank reason; stores `Accepted despite possible duplicate: <reason>` (reason trimmed, capped at 500 characters) as the history note of the accepted row.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/044_accept_referral_override.sql`:

```sql
-- Tests for 20261012000005_accept_referral_override (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/044_accept_referral_override.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org accept-override): boss administrator; rep1 boss.rep1 owns partner P1
-- and deal DX. Referrals assigned to rep1: F flagged against DX, N unflagged,
-- G flagged against N.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001044', 'Accept Override Org', 'accept-override', 'accept-override-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0440000-0000-0000-0000-000000000001', 'boss@ao.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0440000-0000-0000-0000-000000000002', 'rep1@ao.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0440000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'admin', 'administrator',      'Boss', 'boss@ao.example', 'aoboss'::ltree,      null),
  ('a0440000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'rep',   'sales_professional', 'Rep1', 'rep1@ao.example', 'aoboss.rep1'::ltree, 'a0440000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a044a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'a0440000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a044d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'Existing Spot', '1 First St', 'C', 'x@ao.example', '5550440001', 100, 'contacted', 'path');

insert into referrals (id, org_id, partner_id, source, company_name, address, contact_name, assigned_user_id, duplicate_of_deal_id, duplicate_of_referral_id) values
  ('a044f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Second Spot', '77 New Rd',   'Ann', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-000000000001', null),
  ('a044f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Plain Co',    '88 Plain Rd', 'Bob', 'a0440000-0000-0000-0000-000000000002', null, null),
  ('a044f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Third Spot',  '99 Third Rd', 'Cy',  'a0440000-0000-0000-0000-000000000002', null, 'a044f000-0000-0000-0000-000000000002');

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

-- Privileges.
do $$ begin
  if not has_function_privilege('authenticated', 'public.accept_referral_override(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated should execute accept_referral_override';
  end if;
  if has_function_privilege('anon', 'public.accept_referral_override(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute accept_referral_override';
  end if;
  if not has_function_privilege('authenticated', 'public.accept_referral(uuid)', 'EXECUTE') then
    raise exception 'authenticated should still execute accept_referral';
  end if;
  if has_function_privilege('anon', 'public.accept_referral(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute accept_referral';
  end if;
end $$;

-- 1. A flagged referral refuses a plain accept and a blank reason (role switches from here on).
do $$ begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.accept_referral('a044f000-0000-0000-0000-000000000001')$q$, 'override_reason_required');
  perform _t_raises($q$select public.accept_referral('a044f000-0000-0000-0000-000000000003')$q$, 'override_reason_required');
  perform _t_raises($q$select public.accept_referral_override('a044f000-0000-0000-0000-000000000001', '   ')$q$, 'override_reason_required');
  if (select status from referrals where id = 'a044f000-0000-0000-0000-000000000001') <> 'submitted' then
    raise exception 'a refused accept must leave the referral submitted';
  end if;
end $$;

-- 2. With a reason it is accepted and the reason is in the history note.
do $$ declare res jsonb; h record; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  res := public.accept_referral_override('a044f000-0000-0000-0000-000000000001', '  Different location  ');
  if res->>'result' is distinct from 'accepted' or res->>'deal_id' is null then
    raise exception 'override should accept, got %', res;
  end if;
  if (select status from referrals where id = 'a044f000-0000-0000-0000-000000000001') <> 'accepted' then
    raise exception 'F should be accepted';
  end if;
  select * into h from referral_status_history
   where referral_id = 'a044f000-0000-0000-0000-000000000001' and to_status = 'accepted';
  if h.note is distinct from 'Accepted despite possible duplicate: Different location'
     or h.actor_type <> 'user' or h.actor_id is distinct from 'a0440000-0000-0000-0000-000000000002' then
    raise exception 'history should carry the override reason: %', row_to_json(h);
  end if;
  if coalesce(current_setting('navigatr.referral_note', true), '') <> '' then
    raise exception 'the note setting must be cleared after the override';
  end if;
end $$;

-- 3. An unflagged referral accepts exactly as before.
do $$ declare res jsonb; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  res := public.accept_referral('a044f000-0000-0000-0000-000000000002');
  if res->>'result' is distinct from 'accepted' then raise exception 'plain accept should still work, got %', res; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/044_accept_referral_override.sql`
Expected: FAIL with `function public.accept_referral_override(uuid, text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261012000005_accept_referral_override.sql`:

```sql
-- 20261012000005_accept_referral_override.sql
--
-- Partner Portal Phase 1B (FR-PORT-47, spec 5.5): a portal referral flagged as a
-- probable duplicate (duplicate_of_referral_id or duplicate_of_deal_id) arrives
-- with Decline (duplicate) preselected. Accepting it anyway needs a written
-- reason, recorded in the referral's history note. accept_referral keeps its
-- signature and result; it refuses a flagged referral unless the reason was set
-- by accept_referral_override in the same transaction.

create or replace function public.accept_referral(p_referral_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         referrals := public._referral_for_update(p_referral_id);
  v_owner   uuid;
  v_deal    uuid;
  v_dup     uuid;
  v_partner text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  -- Phase 1B: a probable duplicate needs a written reason (accept_referral_override).
  if (r.duplicate_of_referral_id is not null or r.duplicate_of_deal_id is not null)
     and coalesce(current_setting('navigatr.referral_note', true), '') = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  -- A deactivated (or missing) assignee cannot own the new deal; the accepter does.
  v_owner := auth.uid();
  if r.assigned_user_id is not null and exists (
       select 1 from profiles where id = r.assigned_user_id and deactivated_at is null) then
    v_owner := r.assigned_user_id;
  end if;

  begin
    insert into deals (
      org_id, owner_id, company_name, address, industry, contact_name, contact_email,
      contact_phone, value_cents, stage, lead_source, place_id, source_referral_id,
      source_partner_id
    ) values (
      r.org_id, v_owner, r.company_name, r.address, r.industry,
      coalesce(r.contact_name, r.company_name), r.contact_email, coalesce(r.contact_phone, ''),
      null, 'new', 'partner_referral', r.place_id, r.id, r.partner_id
    ) returning id into v_deal;
  exception when unique_violation then
    -- Blocked by the active-deal dedupe (place_id index or name+address trigger).
    select d.id into v_dup
      from deals d
     where d.org_id = r.org_id
       and d.stage not in ('won','lost')
       and ((r.place_id is not null and d.place_id = r.place_id)
            or d.dedupe_key = public.deal_dedupe_key(r.company_name, r.address))
       and public.user_can_see_owner(d.owner_id)
     limit 1;
    return jsonb_build_object('result', 'duplicate', 'deal_id', v_dup);
  end;

  update referrals
     set status = 'accepted', deal_id = v_deal, assigned_user_id = v_owner,
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;

  select name into v_partner from partners where id = r.partner_id;
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    r.org_id, v_owner, 'call', 'Follow up on referral from ' || v_partner, v_deal,
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    'interval'
  );

  return jsonb_build_object('result', 'accepted', 'deal_id', v_deal);
end $$;

create or replace function public.accept_referral_override(p_referral_id uuid, p_override_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := left(btrim(coalesce(p_override_reason, '')), 500);
  v_result jsonb;
begin
  if v_reason = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  perform public._referral_set_note('Accepted despite possible duplicate: ' || v_reason);
  v_result := public.accept_referral(p_referral_id);
  perform public._referral_set_note('');
  return v_result;
end $$;

revoke execute on function public.accept_referral(uuid)                from public, anon;
revoke execute on function public.accept_referral_override(uuid, text) from public, anon;
grant  execute on function public.accept_referral(uuid)                to authenticated;
grant  execute on function public.accept_referral_override(uuid, text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `supabase db reset && for f in 035 044; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/${f}_*.sql || exit 1; done`
Expected: exits 0 with no output (035's accept cases are unflagged and unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012000005_accept_referral_override.sql supabase/tests/044_accept_referral_override.sql
git commit -m "$(cat <<'EOF'
feat(referrals): require a written reason to accept a flagged duplicate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Shared label and submission modules

**Files:**
- Create: `supabase/functions/_shared/portalLabels.ts`, `supabase/functions/_shared/portalLabels.test.ts`
- Create: `supabase/functions/_shared/portalSubmission.ts`, `supabase/functions/_shared/portalSubmission.test.ts`
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Produces (`portalLabels.ts`):
  - `type PortalLabel = "Received" | "Accepted" | "In Progress" | "Closed Won" | "Not Moving Forward" | "Withdrawn"`
  - `const PORTAL_LABELS: readonly PortalLabel[]`
  - `function portalLabel(status: unknown): PortalLabel | null` (null for anything that is not one of the seven internal statuses)
  - `interface PortalHistoryEntry { label: PortalLabel; at: string }`
  - `function collapseHistory(entries: ReadonlyArray<{ status: unknown; at: unknown }>): PortalHistoryEntry[]` (drops unknown statuses, keeps the first of consecutive identical labels)
- Produces (`portalSubmission.ts`):
  - `const PORTAL_FIELD_LIMITS = { companyName: 160, contactName: 120, email: 254, phone: 40, address: 300, notes: 4000 }`
  - `const PORTAL_INDUSTRIES` (seven `{ value, label }`), `type PortalIndustry`, `const PORTAL_URGENCIES` (three), `type PortalUrgency`, `function industryLabel(value: string | null): string | null`, `function urgencyLabel(value: string | null): string | null`
  - `type PortalWindow = "30d" | "90d" | "12m" | "all"`, `const PORTAL_WINDOWS: ReadonlyArray<{ value: PortalWindow; label: string }>`, `function isPortalWindow(value: unknown): value is PortalWindow`, `function windowSince(window: PortalWindow, now: Date): Date | null`
  - `type PortalSubmissionField = "companyName" | "contactName" | "email" | "phone" | "emailOrPhone" | "address" | "industry" | "urgency" | "notes" | "consent"`, `const PORTAL_SUBMISSION_FIELDS: readonly PortalSubmissionField[]`, `function isSubmissionField(value: unknown): value is PortalSubmissionField`
  - `interface PortalSubmission { companyName: string; contactName: string; email: string | null; phone: string | null; address: string | null; industry: PortalIndustry | null; urgency: PortalUrgency | null; notes: string; consent: true; consentVersion: number }`
  - `type SubmissionCheck = { ok: true; value: PortalSubmission } | { ok: false; field: PortalSubmissionField }`, `function validateSubmission(input: Readonly<Record<string, unknown>>): SubmissionCheck`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/portalLabels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PORTAL_LABELS, collapseHistory, portalLabel } from "./portalLabels";

describe("portalLabel", () => {
  it.each([
    ["submitted", "Received"],
    ["accepted", "Accepted"],
    ["working", "In Progress"],
    ["won", "Closed Won"],
    ["lost", "Not Moving Forward"],
    ["declined", "Not Moving Forward"],
    ["withdrawn", "Withdrawn"],
  ])("maps %s to %s", (status, label) => {
    expect(portalLabel(status)).toBe(label);
  });

  it("returns null for anything else, so a raw status can never leak", () => {
    expect(portalLabel("contacted")).toBeNull();
    expect(portalLabel("toString")).toBeNull();
    expect(portalLabel("")).toBeNull();
    expect(portalLabel(null)).toBeNull();
    expect(portalLabel(3)).toBeNull();
  });

  it("lists the six partner labels once each", () => {
    expect(PORTAL_LABELS).toEqual(["Received", "Accepted", "In Progress", "Closed Won", "Not Moving Forward", "Withdrawn"]);
  });
});

describe("collapseHistory", () => {
  it("maps to labels and keeps the first of consecutive identical labels", () => {
    expect(
      collapseHistory([
        { status: "submitted", at: "2026-10-01T10:00:00Z" },
        { status: "accepted", at: "2026-10-02T10:00:00Z" },
        { status: "working", at: "2026-10-03T10:00:00Z" },
        { status: "working", at: "2026-10-04T10:00:00Z" },
        { status: "lost", at: "2026-10-05T10:00:00Z" },
        { status: "declined", at: "2026-10-06T10:00:00Z" },
      ]),
    ).toEqual([
      { label: "Received", at: "2026-10-01T10:00:00Z" },
      { label: "Accepted", at: "2026-10-02T10:00:00Z" },
      { label: "In Progress", at: "2026-10-03T10:00:00Z" },
      { label: "Not Moving Forward", at: "2026-10-05T10:00:00Z" },
    ]);
  });

  it("does not collapse a label that returns after a different one", () => {
    expect(
      collapseHistory([
        { status: "working", at: "a" },
        { status: "lost", at: "b" },
        { status: "working", at: "c" },
      ]).map((h) => h.label),
    ).toEqual(["In Progress", "Not Moving Forward", "In Progress"]);
  });

  it("drops unknown statuses and missing timestamps", () => {
    expect(
      collapseHistory([
        { status: "mystery", at: "a" },
        { status: "submitted", at: null },
        { status: "won", at: "b" },
      ]),
    ).toEqual([{ label: "Closed Won", at: "b" }]);
  });
});
```

Create `supabase/functions/_shared/portalSubmission.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PORTAL_FIELD_LIMITS,
  PORTAL_INDUSTRIES,
  PORTAL_URGENCIES,
  PORTAL_WINDOWS,
  industryLabel,
  isPortalWindow,
  isSubmissionField,
  urgencyLabel,
  validateSubmission,
  windowSince,
} from "./portalSubmission";

const VALID = {
  companyName: "  Fresh Bakery ",
  contactName: " Ann ",
  email: " Ann@Fresh.example ",
  phone: "",
  address: " 5 Oak St ",
  industry: "restaurant",
  urgency: "this_week",
  notes: " Wants a demo ",
  consent: true,
  consentVersion: 3,
};

describe("validateSubmission", () => {
  it("trims, lowercases the email, and nulls blank optional fields", () => {
    expect(validateSubmission(VALID)).toEqual({
      ok: true,
      value: {
        companyName: "Fresh Bakery",
        contactName: "Ann",
        email: "ann@fresh.example",
        phone: null,
        address: "5 Oak St",
        industry: "restaurant",
        urgency: "this_week",
        notes: "Wants a demo",
        consent: true,
        consentVersion: 3,
      },
    });
  });

  it("accepts a phone without an email, and no industry, urgency or notes", () => {
    const res = validateSubmission({
      companyName: "Co",
      contactName: "Bo",
      phone: "(555) 010-0100",
      consent: true,
      consentVersion: 0,
    });
    expect(res).toEqual({
      ok: true,
      value: {
        companyName: "Co",
        contactName: "Bo",
        email: null,
        phone: "(555) 010-0100",
        address: null,
        industry: null,
        urgency: null,
        notes: "",
        consent: true,
        consentVersion: 0,
      },
    });
  });

  it.each([
    [{ companyName: "   " }, "companyName"],
    [{ companyName: "x".repeat(PORTAL_FIELD_LIMITS.companyName + 1) }, "companyName"],
    [{ contactName: "" }, "contactName"],
    [{ contactName: "x".repeat(PORTAL_FIELD_LIMITS.contactName + 1) }, "contactName"],
    [{ email: "not-an-email" }, "email"],
    [{ email: `${"x".repeat(250)}@a.co` }, "email"],
    [{ email: "", phone: "12" }, "phone"],
    [{ email: "", phone: "1".repeat(PORTAL_FIELD_LIMITS.phone + 1) }, "phone"],
    [{ email: "", phone: "" }, "emailOrPhone"],
    [{ address: "x".repeat(PORTAL_FIELD_LIMITS.address + 1) }, "address"],
    [{ industry: "casino" }, "industry"],
    [{ urgency: "asap" }, "urgency"],
    [{ notes: "x".repeat(PORTAL_FIELD_LIMITS.notes + 1) }, "notes"],
    [{ consent: false }, "consent"],
    [{ consent: "true" }, "consent"],
    [{ consentVersion: "3" }, "consent"],
    [{ consentVersion: 1.5 }, "consent"],
  ])("rejects %j as %s", (patch, field) => {
    expect(validateSubmission({ ...VALID, ...patch })).toEqual({ ok: false, field });
  });

  it("treats non-string values as blank", () => {
    expect(validateSubmission({ ...VALID, companyName: 42 })).toEqual({ ok: false, field: "companyName" });
  });
});

describe("lists and labels", () => {
  it("uses the Add Deal industry keys", () => {
    expect(PORTAL_INDUSTRIES.map((i) => i.value)).toEqual([
      "restaurant",
      "retail",
      "healthcare",
      "professional_services",
      "personal_services",
      "automotive",
      "other",
    ]);
    expect(industryLabel("professional_services")).toBe("Professional services");
    expect(industryLabel("nope")).toBeNull();
    expect(industryLabel(null)).toBeNull();
  });

  it("has three urgencies", () => {
    expect(PORTAL_URGENCIES.map((u) => u.label)).toEqual(["This week", "This month", "No rush"]);
    expect(urgencyLabel("no_rush")).toBe("No rush");
    expect(urgencyLabel(null)).toBeNull();
  });

  it("knows the submission field names", () => {
    expect(isSubmissionField("emailOrPhone")).toBe(true);
    expect(isSubmissionField("slug")).toBe(false);
    expect(isSubmissionField(undefined)).toBe(false);
  });
});

describe("windows", () => {
  const NOW = new Date("2026-10-12T15:00:00Z");

  it("offers 30 days, 90 days, 12 months, and all time", () => {
    expect(PORTAL_WINDOWS.map((w) => w.label)).toEqual(["30 days", "90 days", "12 months", "All time"]);
    expect(isPortalWindow("90d")).toBe(true);
    expect(isPortalWindow("7d")).toBe(false);
  });

  it("computes the start of each window", () => {
    expect(windowSince("30d", NOW)?.toISOString()).toBe("2026-09-12T15:00:00.000Z");
    expect(windowSince("90d", NOW)?.toISOString()).toBe("2026-07-14T15:00:00.000Z");
    expect(windowSince("12m", NOW)?.toISOString()).toBe("2025-10-12T15:00:00.000Z");
    expect(windowSince("all", NOW)).toBeNull();
  });

  it("does not mutate the clock it was given", () => {
    windowSince("30d", NOW);
    expect(NOW.toISOString()).toBe("2026-10-12T15:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- _shared/portalLabels.test.ts _shared/portalSubmission.test.ts`
Expected: FAIL, `Failed to resolve import "./portalLabels"` and `"./portalSubmission"`.

- [ ] **Step 3: Write `portalLabels.ts`**

Create `supabase/functions/_shared/portalLabels.ts`:

```ts
/**
 * Partner-facing status labels (Partner Portal, spec 5.6, FR-PORT-62).
 *
 * The ONLY place an internal referral status becomes something a partner reads.
 * portal_api responses (and, in Phase 1C, partner emails) go through here, so an
 * internal status name can never reach the portal: anything unknown maps to null
 * and the caller drops it. Rep-facing labels live in
 * apps/app/src/features/partners/lib/referrals.ts and never mix with these.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export type PortalLabel =
  | "Received"
  | "Accepted"
  | "In Progress"
  | "Closed Won"
  | "Not Moving Forward"
  | "Withdrawn";

export const PORTAL_LABELS: readonly PortalLabel[] = [
  "Received",
  "Accepted",
  "In Progress",
  "Closed Won",
  "Not Moving Forward",
  "Withdrawn",
];

const LABEL_BY_STATUS: Readonly<Record<string, PortalLabel>> = Object.freeze({
  submitted: "Received",
  accepted: "Accepted",
  working: "In Progress",
  won: "Closed Won",
  lost: "Not Moving Forward",
  declined: "Not Moving Forward",
  withdrawn: "Withdrawn",
});

export function portalLabel(status: unknown): PortalLabel | null {
  if (typeof status !== "string") return null;
  return Object.prototype.hasOwnProperty.call(LABEL_BY_STATUS, status) ? LABEL_BY_STATUS[status] : null;
}

export interface PortalHistoryEntry {
  label: PortalLabel;
  at: string;
}

/** Labels only, oldest first, with consecutive repeats collapsed (lost then declined is one step). */
export function collapseHistory(entries: ReadonlyArray<{ status: unknown; at: unknown }>): PortalHistoryEntry[] {
  const out: PortalHistoryEntry[] = [];
  for (const entry of entries) {
    const label = portalLabel(entry.status);
    if (!label || typeof entry.at !== "string") continue;
    if (out.length > 0 && out[out.length - 1].label === label) continue;
    out.push({ label, at: entry.at });
  }
  return out;
}
```

- [ ] **Step 4: Write `portalSubmission.ts`**

Create `supabase/functions/_shared/portalSubmission.ts`:

```ts
/**
 * Partner referral submission rules (Partner Portal Phase 1B, spec 5.5, brief D9).
 *
 * Shared by portal_api (server validation before any SQL) and the portal's
 * submit form (the same messages before a request is sent). The SQL function
 * portal_submit_referral enforces the same caps and lists again.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export const PORTAL_FIELD_LIMITS = {
  companyName: 160,
  contactName: 120,
  email: 254,
  phone: 40,
  address: 300,
  notes: 4000,
} as const;

/** The Add Deal form's industry keys, so an accepted referral's deal round-trips. */
export const PORTAL_INDUSTRIES = [
  { value: "restaurant", label: "Restaurant" },
  { value: "retail", label: "Retail" },
  { value: "healthcare", label: "Healthcare" },
  { value: "professional_services", label: "Professional services" },
  { value: "personal_services", label: "Personal services" },
  { value: "automotive", label: "Automotive" },
  { value: "other", label: "Other" },
] as const;
export type PortalIndustry = (typeof PORTAL_INDUSTRIES)[number]["value"];

export const PORTAL_URGENCIES = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "no_rush", label: "No rush" },
] as const;
export type PortalUrgency = (typeof PORTAL_URGENCIES)[number]["value"];

export function industryLabel(value: string | null): string | null {
  return PORTAL_INDUSTRIES.find((i) => i.value === value)?.label ?? null;
}

export function urgencyLabel(value: string | null): string | null {
  return PORTAL_URGENCIES.find((u) => u.value === value)?.label ?? null;
}

export type PortalWindow = "30d" | "90d" | "12m" | "all";

export const PORTAL_WINDOWS: ReadonlyArray<{ value: PortalWindow; label: string }> = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
];

export function isPortalWindow(value: unknown): value is PortalWindow {
  return PORTAL_WINDOWS.some((w) => w.value === value);
}

/** Start of the window, or null for all time. Never mutates `now`. */
export function windowSince(window: PortalWindow, now: Date): Date | null {
  if (window === "all") return null;
  const since = new Date(now.getTime());
  if (window === "12m") {
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    return since;
  }
  since.setUTCDate(since.getUTCDate() - (window === "30d" ? 30 : 90));
  return since;
}

export type PortalSubmissionField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "emailOrPhone"
  | "address"
  | "industry"
  | "urgency"
  | "notes"
  | "consent";

export const PORTAL_SUBMISSION_FIELDS: readonly PortalSubmissionField[] = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "emailOrPhone",
  "address",
  "industry",
  "urgency",
  "notes",
  "consent",
];

export function isSubmissionField(value: unknown): value is PortalSubmissionField {
  return typeof value === "string" && (PORTAL_SUBMISSION_FIELDS as readonly string[]).includes(value);
}

export interface PortalSubmission {
  companyName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  industry: PortalIndustry | null;
  urgency: PortalUrgency | null;
  notes: string;
  consent: true;
  consentVersion: number;
}

export type SubmissionCheck =
  | { ok: true; value: PortalSubmission }
  | { ok: false; field: PortalSubmissionField };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubmission(input: Readonly<Record<string, unknown>>): SubmissionCheck {
  const text = (key: string): string => {
    const v = input[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const fail = (field: PortalSubmissionField): SubmissionCheck => ({ ok: false, field });

  const companyName = text("companyName");
  if (!companyName || companyName.length > PORTAL_FIELD_LIMITS.companyName) return fail("companyName");
  const contactName = text("contactName");
  if (!contactName || contactName.length > PORTAL_FIELD_LIMITS.contactName) return fail("contactName");

  const email = text("email").toLowerCase();
  if (email && (email.length > PORTAL_FIELD_LIMITS.email || !EMAIL_RE.test(email))) return fail("email");
  const phone = text("phone");
  if (phone && (phone.length > PORTAL_FIELD_LIMITS.phone || phone.replace(/\D/g, "").length < 7)) return fail("phone");
  if (!email && !phone) return fail("emailOrPhone");

  const address = text("address");
  if (address.length > PORTAL_FIELD_LIMITS.address) return fail("address");

  const industry = text("industry");
  const industryHit = PORTAL_INDUSTRIES.find((i) => i.value === industry);
  if (industry && !industryHit) return fail("industry");
  const urgency = text("urgency");
  const urgencyHit = PORTAL_URGENCIES.find((u) => u.value === urgency);
  if (urgency && !urgencyHit) return fail("urgency");

  const notes = text("notes");
  if (notes.length > PORTAL_FIELD_LIMITS.notes) return fail("notes");

  if (input.consent !== true) return fail("consent");
  const consentVersion = input.consentVersion;
  if (typeof consentVersion !== "number" || !Number.isInteger(consentVersion)) return fail("consent");

  return {
    ok: true,
    value: {
      companyName,
      contactName,
      email: email || null,
      phone: phone || null,
      address: address || null,
      industry: industryHit ? industryHit.value : null,
      urgency: urgencyHit ? urgencyHit.value : null,
      notes,
      consent: true,
      consentVersion,
    },
  };
}
```

- [ ] **Step 5: Add both files to the app typecheck**

In `apps/app/tsconfig.app.json`, replace

```json
    "../../supabase/functions/_shared/portalInvite.ts"
  ]
```

with

```json
    "../../supabase/functions/_shared/portalInvite.ts",
    "../../supabase/functions/_shared/portalLabels.ts",
    "../../supabase/functions/_shared/portalSubmission.ts"
  ]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter app test -- _shared/portalLabels.test.ts _shared/portalSubmission.test.ts`
Expected: PASS, 2 files.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalLabels.ts supabase/functions/_shared/portalLabels.test.ts supabase/functions/_shared/portalSubmission.ts supabase/functions/_shared/portalSubmission.test.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): shared partner labels and referral submission rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extract the AssemblyAI call to `_shared/transcribe.ts`

Brief D6: one speech-to-text helper for the rep `transcribe` function and the portal.

**Files:**
- Create: `supabase/functions/_shared/transcribe.ts`, `supabase/functions/_shared/transcribe.test.ts`
- Modify: `supabase/functions/transcribe/index.ts`
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Produces (`_shared/transcribe.ts`):
  - `const MAX_AUDIO_BYTES = 10 * 1024 * 1024`, `const MAX_AUDIO_BASE64_CHARS` (base64 length of 10 MB), `const MOCK_TRANSCRIPT = "This is a mock transcription for local development."`
  - `function base64ToBytes(b64: string): Uint8Array<ArrayBuffer>` (throws on invalid base64)
  - `interface AssemblyAIDeps { fetch: (input: string, init?: RequestInit) => Promise<Response>; apiKey: string; sleep?: (ms: number) => Promise<void>; nowMs?: () => number; pollIntervalMs?: number; pollTimeoutMs?: number }`
  - `function transcribeWithAssemblyAI(audio: Uint8Array<ArrayBuffer>, deps: AssemblyAIDeps): Promise<string>` (upload, create, poll; throws on any vendor error or timeout)
- `transcribe/index.ts` keeps every response it has today (`missing_authorization`, `invalid_body` with detail, `audio_too_large`, `unauthorized`, mock text, `transcription_failed` with detail).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  MAX_AUDIO_BASE64_CHARS,
  MAX_AUDIO_BYTES,
  MOCK_TRANSCRIPT,
  base64ToBytes,
  transcribeWithAssemblyAI,
  type AssemblyAIDeps,
} from "./transcribe";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deps(responses: Response[], extra: Partial<AssemblyAIDeps> = {}) {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return { fetch, sleep, d: { fetch, sleep, apiKey: "key-123", ...extra } as AssemblyAIDeps };
}

const AUDIO = new Uint8Array([1, 2, 3]);

describe("base64ToBytes", () => {
  it("decodes base64", () => {
    expect(Array.from(base64ToBytes(btoa("abc")))).toEqual([97, 98, 99]);
  });
  it("throws on input that is not base64", () => {
    expect(() => base64ToBytes("***")).toThrow();
  });
  it("sizes the base64 cap to the byte cap", () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AUDIO_BASE64_CHARS).toBe(Math.ceil(MAX_AUDIO_BYTES / 3) * 4);
    expect(MOCK_TRANSCRIPT).toBe("This is a mock transcription for local development.");
  });
});

describe("transcribeWithAssemblyAI", () => {
  it("uploads, creates the job, polls, and returns the text", async () => {
    const { fetch, sleep, d } = deps([
      json({ upload_url: "https://cdn.aai/u1" }),
      json({ id: "t1" }),
      json({ status: "processing" }),
      json({ status: "completed", text: "Signed the deal" }),
    ]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).resolves.toBe("Signed the deal");

    expect(fetch.mock.calls[0][0]).toBe("https://api.assemblyai.com/v2/upload");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { authorization: "key-123" }, body: AUDIO });
    expect(fetch.mock.calls[1][0]).toBe("https://api.assemblyai.com/v2/transcript");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      audio_url: "https://cdn.aai/u1",
      punctuate: true,
      format_text: true,
    });
    expect(fetch.mock.calls[2][0]).toBe("https://api.assemblyai.com/v2/transcript/t1");
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("refuses to run without an API key", async () => {
    const { fetch, d } = deps([], { apiKey: "" });
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow(/ASSEMBLYAI_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["upload http", [json({}, 500)]],
    ["upload returned no url", [json({})]],
    ["create http", [json({ upload_url: "u" }), json({}, 400)]],
    ["create returned no id", [json({ upload_url: "u" }), json({})]],
    ["poll http", [json({ upload_url: "u" }), json({ id: "t" }), json({}, 502)]],
    ["bad audio", [json({ upload_url: "u" }), json({ id: "t" }), json({ status: "error", error: "bad audio" })]],
  ])("throws on %s", async (message, responses) => {
    const { d } = deps(responses as Response[]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow(message);
  });

  it("times out when the job never completes", async () => {
    let t = 0;
    const { d } = deps(
      [json({ upload_url: "u" }), json({ id: "t" }), json({ status: "processing" }), json({ status: "processing" })],
      { nowMs: () => (t += 30_000), pollTimeoutMs: 45_000 },
    );
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow("transcription timed out");
  });

  it("returns an empty string for a completed job with no text", async () => {
    const { d } = deps([json({ upload_url: "u" }), json({ id: "t" }), json({ status: "completed" })]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).resolves.toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- _shared/transcribe.test.ts`
Expected: FAIL, `Failed to resolve import "./transcribe"`.

- [ ] **Step 3: Write `_shared/transcribe.ts`**

Create `supabase/functions/_shared/transcribe.ts`:

```ts
/**
 * Batch speech-to-text through AssemblyAI (voice-note dictation).
 *
 * Shared by the rep-facing `transcribe` edge function and portal_api's
 * `transcribe` action (Partner Portal Phase 1B, spec 5.5). The vendor lives here
 * only: swapping to another provider later is a change in this file. Audio is
 * never persisted; it is uploaded, transcribed, and dropped.
 *
 * Pure TS with injected fetch and clock and no Deno globals, so vitest covers it.
 */
const AAI_BASE = "https://api.assemblyai.com/v2";

// About 2 minutes of webm/opus is well under a couple of MB; base64 inflates it
// by a third. Cap the decoded payload (10 MB) so a bad client can't spool us.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;

export const MOCK_TRANSCRIPT = "This is a mock transcription for local development.";

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_TIMEOUT_MS = 45_000;

/** Throws on input that is not valid base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export interface AssemblyAIDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** Upload bytes, create the transcript job, poll until it completes. Throws on vendor error or timeout. */
export async function transcribeWithAssemblyAI(audio: Uint8Array<ArrayBuffer>, deps: AssemblyAIDeps): Promise<string> {
  if (!deps.apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY not set (and TRANSCRIBE_MOCK != 1)");
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowMs = deps.nowMs ?? (() => Date.now());
  const pollInterval = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeout = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const auth = { authorization: deps.apiKey };

  // 1. Upload the raw audio bytes.
  const up = await deps.fetch(`${AAI_BASE}/upload`, { method: "POST", headers: auth, body: audio });
  if (!up.ok) throw new Error(`upload http ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url?: string };
  if (!upload_url) throw new Error("upload returned no url");

  // 2. Create the transcript job. English; punctuation and formatting on.
  const create = await deps.fetch(`${AAI_BASE}/transcript`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, punctuate: true, format_text: true }),
  });
  if (!create.ok) throw new Error(`create http ${create.status}`);
  const created = (await create.json()) as { id?: string };
  if (!created.id) throw new Error("create returned no id");

  // 3. Poll until the job completes (short clips finish in a few seconds).
  const deadline = nowMs() + pollTimeout;
  while (nowMs() < deadline) {
    const poll = await deps.fetch(`${AAI_BASE}/transcript/${created.id}`, { headers: auth });
    if (!poll.ok) throw new Error(`poll http ${poll.status}`);
    const t = (await poll.json()) as { status?: string; text?: string; error?: string };
    if (t.status === "completed") return t.text ?? "";
    if (t.status === "error") throw new Error(t.error ?? "transcription error");
    await sleep(pollInterval);
  }
  throw new Error("transcription timed out");
}
```

- [ ] **Step 4: Point `transcribe/index.ts` at the shared helper**

Replace the whole of `supabase/functions/transcribe/index.ts` with:

```ts
// transcribe: batch speech-to-text for the voice-note dictation feature.
//
// Receives a base64 audio clip from an authenticated user, sends it to the STT
// vendor, and returns the transcript text. The audio is never persisted: it
// lives in memory for the request only and is dropped after transcription. The
// vendor API key lives here as a Supabase secret and is never shipped to the
// browser. Mirrors geocode's CORS/auth/json shape.
//
// The vendor call lives in _shared/transcribe.ts (also used by portal_api's
// transcribe action for partners).
//
// TRANSCRIBE_MOCK=1 returns fixed text so dev/CI never hit the vendor (mirrors
// GEOCODE_MOCK). ASSEMBLYAI_API_KEY must be set for real transcription.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_AUDIO_BYTES,
  MOCK_TRANSCRIPT,
  base64ToBytes,
  transcribeWithAssemblyAI,
} from "../_shared/transcribe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const TRANSCRIBE_MOCK = Deno.env.get("TRANSCRIBE_MOCK") === "1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const body = (await req.json().catch(() => null)) as { audio?: unknown } | null;
  const audioB64 = typeof body?.audio === "string" ? body.audio : "";
  if (!audioB64) return json({ error: "invalid_body", detail: "audio is required" }, 400);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(audioB64);
  } catch {
    return json({ error: "invalid_body", detail: "audio is not valid base64" }, 400);
  }
  if (bytes.length === 0) return json({ error: "invalid_body", detail: "audio is empty" }, 400);
  if (bytes.length > MAX_AUDIO_BYTES) return json({ error: "audio_too_large" }, 413);

  // Authenticated users only: same gate as geocode/discover_prospects.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  if (TRANSCRIBE_MOCK) {
    return json({ text: MOCK_TRANSCRIPT });
  }

  try {
    const text = await transcribeWithAssemblyAI(bytes, { fetch, apiKey: ASSEMBLYAI_API_KEY });
    return json({ text });
  } catch (e) {
    return json({ error: "transcription_failed", detail: String((e as Error)?.message ?? e) }, 502);
  }
});
```

- [ ] **Step 5: Add the helper to the app typecheck**

In `apps/app/tsconfig.app.json`, replace

```json
    "../../supabase/functions/_shared/portalSubmission.ts"
  ]
```

with

```json
    "../../supabase/functions/_shared/portalSubmission.ts",
    "../../supabase/functions/_shared/transcribe.ts"
  ]
```

- [ ] **Step 6: Run the test and the Deno typecheck**

Run: `pnpm --filter app test -- _shared/transcribe.test.ts`
Expected: PASS.

Run: `deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/transcribe/index.ts`
Expected: exits 0 (before this task it failed with TS2769 on the upload `body`).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/transcribe.ts supabase/functions/_shared/transcribe.test.ts supabase/functions/transcribe/index.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
refactor(transcribe): move the AssemblyAI call to a shared, tested helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `portal_api` referral actions

**Files:**
- Create: `supabase/functions/_shared/portalReferralApi.ts`, `supabase/functions/_shared/portalReferralApi.test.ts`
- Modify: `supabase/functions/_shared/portalApi.ts`
- Modify: `supabase/functions/portal_api/index.ts`
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: Task 2 and 3 SQL (`portal_form_context`, `portal_dup_check`, `portal_submit_referral`, `portal_list_referrals`, `portal_dashboard_stats`, `portal_get_referral`, `portal_referral_history`, `portal_withdraw_referral`, `portal_claim_transcribe`), Task 5 (`portalLabel`, `collapseHistory`, `validateSubmission`, `isPortalWindow`, `windowSince`, `PORTAL_FIELD_LIMITS`), Task 6 (`base64ToBytes`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_BASE64_CHARS`, `transcribeWithAssemblyAI`, `MOCK_TRANSCRIPT`), 1A `portal_session_lookup` (returns `portal_user_id, org_id, partner_id, partner_name, user_email, org_name, org_slug`).
- Produces (`portalReferralApi.ts`):
  - `const REFERRAL_ACTIONS = ["form", "dup_check", "submit_referral", "list_referrals", "get_referral", "withdraw_referral", "dashboard", "transcribe"] as const`, `type ReferralAction`, `function isReferralAction(action: string): action is ReferralAction`
  - `interface ReferralScope { portalUserId: string; orgId: string; partnerId: string }`
  - `interface ReferralDeps { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>; transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>; now?(): Date }`
  - `interface ActionResult { status: number; body: unknown }`
  - `function handleReferralAction(action: ReferralAction, scope: ReferralScope, body: Record<string, unknown>, ip: string | null, deps: ReferralDeps): Promise<ActionResult>`
  - Response types: `PortalForm { consentText: string; consentVersion: number }`, `PortalReferralSummary { id: string; ref: string; companyName: string; label: PortalLabel; submittedAt: string; lastActivityAt: string }`, `PortalDashboard { submitted: number; active: number; closedWon: number; conversionRate: number | null; valueVisible: boolean; totalValueCents?: number }`, `PortalRepContact { name: string; email: string | null }`, `PortalReferralDetail { id: string; ref: string; companyName: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; address: string | null; industry: string | null; urgency: string | null; notes: string | null; label: PortalLabel; submittedAt: string; canWithdraw: boolean; rep: PortalRepContact | null; history: PortalHistoryEntry[] }`
- Wire format (POST `/functions/v1/portal_api/<action>`, header `x-portal-session`, JSON body always carries `slug`):

| Action | Body (besides `slug`) | 200 body |
|---|---|---|
| `form` | none | `{ form: PortalForm }` |
| `dup_check` | `companyName, phone?, address?` | `{ probableDuplicate: boolean }` |
| `submit_referral` | `companyName, contactName, email?, phone?, address?, industry?, urgency?, notes?, consent, consentVersion` | `{ referral: { id, ref } }` |
| `list_referrals` | `window?` (`30d`, `90d`, `12m`, `all`; default `all`) | `{ referrals: PortalReferralSummary[] }` |
| `dashboard` | `window?` | `{ dashboard: PortalDashboard }` |
| `get_referral` | `referralId` | `{ referral: PortalReferralDetail }` |
| `withdraw_referral` | `referralId` | `{ ok: true }` |
| `transcribe` | `audio` (base64), `mime?` | `{ text: string }` |

- `PortalApiDeps` gains `transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>`; `PortalAction` gains every `ReferralAction`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalReferralApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalEnv, type PortalRpcResult } from "./portalApi";
import { MAX_AUDIO_BASE64_CHARS } from "./transcribe";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-12T15:00:00Z");
const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";
const RID = "3f9a21c0-1111-4222-8333-444455556666";

const LOOKUP = [
  {
    portal_user_id: "u-1",
    org_id: "o-1",
    partner_id: "p-1",
    partner_name: "Jane",
    user_email: "jane@example.com",
    org_name: "Acme ISO",
    org_slug: "acme",
  },
];

const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });

type Handler = (args: Record<string, unknown>) => PortalRpcResult;

function setup(handlers: Record<string, Handler> = {}, extra: Partial<PortalApiDeps> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "portal_session_lookup") return (handlers.portal_session_lookup ?? (() => ok(LOOKUP)))(args);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected rpc ${name}`);
    return handler(args);
  });
  const deps: PortalApiDeps = { rpc, sendEmail: vi.fn(async () => {}), env: ENV, now: () => NOW, ...extra };
  return { deps, rpc };
}

function post(action: string, body: Record<string, unknown>, headers: Record<string, string> = { "x-portal-session": "tok" }) {
  return new Request(`${URL_BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify({ slug: "acme", ...body }),
  });
}

async function call(action: string, body: Record<string, unknown>, deps: PortalApiDeps) {
  const res = await handlePortalRequest(post(action, body), deps);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("session gate", () => {
  it("401s without a session header and never touches the database", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(post("list_referrals", {}, {}), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a Supabase JWT: identity only comes from x-portal-session", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(post("dashboard", {}, { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" }), deps);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s a dead session and runs no data query", async () => {
    const { deps, rpc } = setup({ portal_session_lookup: () => ok([]) });
    const { status } = await call("dashboard", {}, deps);
    expect(status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("portal_session_lookup", { p_slug: "acme", p_token: "tok" });
  });

  it("answers 500, not 401, when the session lookup itself fails", async () => {
    const { deps } = setup({ portal_session_lookup: () => fail("connection reset") });
    const { status, json } = await call("dashboard", {}, deps);
    expect(status).toBe(500);
    expect(json).toEqual({ error: "server_error" });
  });

  it("takes org, partner and portal user only from the session, never from the body", async () => {
    const { deps, rpc } = setup({
      portal_list_referrals: () => ok([]),
    });
    await call("list_referrals", { p_org: "evil-org", orgId: "evil-org", partnerId: "evil-partner", p_partner: "evil" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_referrals", { p_org: "o-1", p_partner: "p-1", p_since: null });
  });
});

describe("form", () => {
  it("returns only the consent wording and version", async () => {
    const { deps, rpc } = setup({
      portal_form_context: () => ok([{ consent_text: "I may share this.", consent_version: 4, org_id: "o-1" }]),
    });
    const { status, json } = await call("form", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_form_context", { p_org: "o-1", p_partner: "p-1" });
    expect(status).toBe(200);
    expect(json).toEqual({ form: { consentText: "I may share this.", consentVersion: 4 } });
  });
});

describe("dup_check", () => {
  it("passes trimmed fields and answers yes or no only", async () => {
    const { deps, rpc } = setup({ portal_dup_check: () => ok(true) });
    const { json } = await call("dup_check", { companyName: " Corner Cafe ", phone: " 555 010 0001 ", address: "", email: "x@y.co" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_dup_check", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_name: "Corner Cafe",
      p_phone: "555 010 0001",
      p_address: null,
      p_ip: "203.0.113.9",
    });
    expect(json).toEqual({ probableDuplicate: true });
  });

  it("answers no without a query when there is no company name", async () => {
    const { deps, rpc } = setup();
    const { json } = await call("dup_check", { companyName: "  ", phone: "5550100001" }, deps);
    expect(json).toEqual({ probableDuplicate: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("429s when the check is rate limited", async () => {
    const { deps } = setup({ portal_dup_check: () => fail("rate_limited") });
    const { status, json } = await call("dup_check", { companyName: "Co" }, deps);
    expect(status).toBe(429);
    expect(json).toEqual({ error: "rate_limited" });
  });

  it("400s an over-long field", async () => {
    const { deps } = setup();
    const { status } = await call("dup_check", { companyName: "x".repeat(161) }, deps);
    expect(status).toBe(400);
  });
});

describe("submit_referral", () => {
  const VALID = {
    companyName: " Fresh Bakery ",
    contactName: "Ann",
    email: "ANN@fresh.example",
    phone: "",
    address: "5 Oak St",
    industry: "restaurant",
    urgency: "this_week",
    notes: "Wants a demo",
    consent: true,
    consentVersion: 3,
  };

  it("sends validated fields with the session scope and returns only id and ref", async () => {
    const { deps, rpc } = setup({
      portal_submit_referral: () => ok([{ id: RID, ref: "REF-3F9A21C0", duplicate_of_deal_id: "d-9" }]),
    });
    const { status, json } = await call("submit_referral", VALID, deps);
    expect(rpc).toHaveBeenCalledWith("portal_submit_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_company: "Fresh Bakery",
      p_contact_name: "Ann",
      p_contact_email: "ann@fresh.example",
      p_contact_phone: null,
      p_address: "5 Oak St",
      p_industry: "restaurant",
      p_urgency: "this_week",
      p_notes: "Wants a demo",
      p_consent: true,
      p_consent_version: 3,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ referral: { id: RID, ref: "REF-3F9A21C0" } });
  });

  it("400s an invalid field before any data query", async () => {
    const { deps, rpc } = setup();
    const { status, json } = await call("submit_referral", { ...VALID, email: "", phone: "" }, deps);
    expect(status).toBe(400);
    expect(json).toEqual({ error: "invalid_body", field: "emailOrPhone" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid_input:notes", 400, { error: "invalid_body", field: "notes" }],
    ["consent_required", 400, { error: "invalid_body", field: "consent" }],
    ["consent_changed", 409, { error: "consent_changed" }],
    ["rate_limited", 429, { error: "rate_limited" }],
    ["not_authorized", 500, { error: "server_error" }],
  ])("maps the database error %s", async (message, status, body) => {
    const { deps } = setup({ portal_submit_referral: () => fail(message) });
    const res = await call("submit_referral", VALID, deps);
    expect(res.status).toBe(status);
    expect(res.json).toEqual(body);
  });
});

describe("list_referrals", () => {
  const ROW = {
    ref: "REF-AAAA0001",
    company_name: "Fresh Bakery",
    submitted_at: "2026-10-01T12:00:00Z",
    last_activity_at: "2026-10-02T12:00:00Z",
    decline_reason: "outside_icp",
    notes: "internal",
    stage: "proposal",
  };

  it("maps every internal status to its partner label and allowlists the fields", async () => {
    const statuses = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];
    const { deps } = setup({
      portal_list_referrals: () => ok(statuses.map((status, i) => ({ ...ROW, id: `r-${i}`, status }))),
    });
    const { json } = await call("list_referrals", {}, deps);
    const rows = json.referrals as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.label)).toEqual([
      "Received",
      "Accepted",
      "In Progress",
      "Closed Won",
      "Not Moving Forward",
      "Not Moving Forward",
      "Withdrawn",
    ]);
    expect(rows[0]).toEqual({
      id: "r-0",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      label: "Received",
      submittedAt: "2026-10-01T12:00:00Z",
      lastActivityAt: "2026-10-02T12:00:00Z",
    });
  });

  it("drops a row whose status has no partner label", async () => {
    const { deps } = setup({ portal_list_referrals: () => ok([{ ...ROW, id: "r-x", status: "mystery" }]) });
    const { json } = await call("list_referrals", {}, deps);
    expect(json).toEqual({ referrals: [] });
  });

  it("turns the window into a start time from the injected clock", async () => {
    const { deps, rpc } = setup({ portal_list_referrals: () => ok([]) });
    await call("list_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_referrals", { p_org: "o-1", p_partner: "p-1", p_since: "2026-09-12T15:00:00.000Z" });
  });

  it("400s an unknown window", async () => {
    const { deps } = setup();
    const { status, json } = await call("list_referrals", { window: "7d" }, deps);
    expect(status).toBe(400);
    expect(json).toEqual({ error: "invalid_body", field: "window" });
  });
});

describe("dashboard", () => {
  const STATS = { submitted: "5", active: "2", closed_won: "1", not_moving_forward: "1", won_value_cents: "500000" };

  it("computes conversion and hides the value when the ISO has not allowed it", async () => {
    const { deps } = setup({ portal_dashboard_stats: () => ok([{ ...STATS, value_visible: false }]) });
    const { json } = await call("dashboard", { window: "all" }, deps);
    expect(json).toEqual({
      dashboard: { submitted: 5, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: false },
    });
    expect(JSON.stringify(json)).not.toContain("500000");
  });

  it("shows the closed-won value when the ISO allows it", async () => {
    const { deps } = setup({ portal_dashboard_stats: () => ok([{ ...STATS, value_visible: true }]) });
    const { json } = await call("dashboard", {}, deps);
    expect(json).toEqual({
      dashboard: { submitted: 5, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: true, totalValueCents: 500000 },
    });
  });

  it("reports no conversion rate when nothing has closed", async () => {
    const { deps } = setup({
      portal_dashboard_stats: () =>
        ok([{ submitted: 2, active: 2, closed_won: 0, not_moving_forward: 0, won_value_cents: 0, value_visible: false }]),
    });
    const { json } = await call("dashboard", {}, deps);
    expect((json.dashboard as Record<string, unknown>).conversionRate).toBeNull();
  });
});

describe("get_referral", () => {
  const DETAIL = {
    id: RID,
    ref: "REF-3F9A21C0",
    company_name: "Fresh Bakery",
    contact_name: "Ann",
    contact_email: "ann@fresh.example",
    contact_phone: "5550100100",
    address: "5 Oak St",
    industry: "restaurant",
    urgency: "this_week",
    notes: "Wants a demo",
    status: "working",
    source: "portal_signed_in",
    submitted_at: "2026-10-01T12:00:00Z",
    rep_name: "Rita Rep",
    rep_email: "rita@acme.example",
    can_withdraw: false,
    decline_reason: "outside_icp",
    decline_note: "internal decline note",
    stage: "proposal",
  };
  const HISTORY = [
    { status: "submitted", created_at: "2026-10-01T12:00:00Z" },
    { status: "accepted", created_at: "2026-10-02T12:00:00Z" },
    { status: "working", created_at: "2026-10-03T12:00:00Z" },
    { status: "working", created_at: "2026-10-04T12:00:00Z" },
  ];

  it("returns the allowlisted detail with labelled, collapsed history", async () => {
    const { deps, rpc } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok(HISTORY),
    });
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_referral: RID,
      p_ip: "203.0.113.9",
    });
    expect(rpc).toHaveBeenCalledWith("portal_referral_history", { p_org: "o-1", p_partner: "p-1", p_referral: RID });
    expect(status).toBe(200);
    expect(json).toEqual({
      referral: {
        id: RID,
        ref: "REF-3F9A21C0",
        companyName: "Fresh Bakery",
        contactName: "Ann",
        contactEmail: "ann@fresh.example",
        contactPhone: "5550100100",
        address: "5 Oak St",
        industry: "restaurant",
        urgency: "this_week",
        notes: "Wants a demo",
        label: "In Progress",
        submittedAt: "2026-10-01T12:00:00Z",
        canWithdraw: false,
        rep: { name: "Rita Rep", email: "rita@acme.example" },
        history: [
          { label: "Received", at: "2026-10-01T12:00:00Z" },
          { label: "Accepted", at: "2026-10-02T12:00:00Z" },
          { label: "In Progress", at: "2026-10-03T12:00:00Z" },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ["working", "portal_signed_in", "outside_icp", "internal decline note", "proposal"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("returns no rep when nobody is assigned yet", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([{ ...DETAIL, rep_name: null, rep_email: null }]),
      portal_referral_history: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).rep).toBeNull();
  });

  it("404s a missing, foreign, or malformed id the same way", async () => {
    const { deps, rpc } = setup({ portal_get_referral: () => ok([]) });
    expect((await call("get_referral", { referralId: RID }, deps)).json).toEqual({ error: "not_found" });
    const bad = await call("get_referral", { referralId: "../../etc" }, deps);
    expect(bad.status).toBe(404);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("withdraw_referral", () => {
  it("withdraws through the session scope", async () => {
    const { deps, rpc } = setup({ portal_withdraw_referral: () => ok(null) });
    const { status, json } = await call("withdraw_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_withdraw_referral", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_referral: RID,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it.each([
    ["referral_not_found", 404, { error: "not_found" }],
    ["not_withdrawable", 409, { error: "not_withdrawable" }],
    ["boom", 500, { error: "server_error" }],
  ])("maps %s", async (message, status, body) => {
    const { deps } = setup({ portal_withdraw_referral: () => fail(message) });
    const res = await call("withdraw_referral", { referralId: RID }, deps);
    expect(res.status).toBe(status);
    expect(res.json).toEqual(body);
  });
});

describe("transcribe", () => {
  const AUDIO = btoa("audio-bytes");

  it("claims a slot, then returns the trimmed text", async () => {
    const transcribe = vi.fn(async () => "  Met the owner  ");
    const { deps, rpc } = setup({ portal_claim_transcribe: () => ok(true) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO, mime: "audio/webm" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_claim_transcribe", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_ip: "203.0.113.9",
    });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/webm");
    expect(status).toBe(200);
    expect(json).toEqual({ text: "Met the owner" });
  });

  it("429s when the hourly budget is used, without calling the vendor", async () => {
    const transcribe = vi.fn(async () => "x");
    const { deps } = setup({ portal_claim_transcribe: () => ok(false) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(429);
    expect(json).toEqual({ error: "rate_limited" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("413s oversized audio before decoding or claiming", async () => {
    const transcribe = vi.fn(async () => "x");
    const { deps, rpc } = setup({}, { transcribe });
    const { status, json } = await call("transcribe", { audio: "A".repeat(MAX_AUDIO_BASE64_CHARS + 4) }, deps);
    expect(status).toBe(413);
    expect(json).toEqual({ error: "audio_too_large" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("400s missing or invalid audio", async () => {
    const { deps } = setup({}, { transcribe: vi.fn(async () => "x") });
    expect((await call("transcribe", {}, deps)).status).toBe(400);
    expect((await call("transcribe", { audio: "***" }, deps)).status).toBe(400);
  });

  it("502s a vendor failure without passing the vendor's detail to the partner", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("upload http 500 key=secret");
    });
    const { deps } = setup({ portal_claim_transcribe: () => ok(true) }, { transcribe });
    const { status, json } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(502);
    expect(json).toEqual({ error: "transcription_failed" });
  });

  it("500s when no transcriber is wired", async () => {
    const { deps } = setup();
    const { status } = await call("transcribe", { audio: AUDIO }, deps);
    expect(status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- _shared/portalReferralApi.test.ts`
Expected: FAIL; the new actions answer `404 { error: "not_found" }`, so the first status assertion fails.

- [ ] **Step 3: Write `portalReferralApi.ts`**

Create `supabase/functions/_shared/portalReferralApi.ts`:

```ts
/**
 * Signed-in referral actions behind portal_api (Partner Portal Phase 1B, spec
 * 5.5 and 5.6).
 *
 * portalApi.ts resolves the session first and passes the scope that
 * portal_session_lookup returned. Nothing here reads an org, partner or portal
 * user id from the request (brief D2).
 *
 * Every response is built field by field from an allowlist (FR-PORT-16/61/62/73):
 * internal statuses become partner labels through portalLabels.ts, and decline
 * reasons, deal stage, internal notes and other partners' data are never copied
 * from a row, even when a row carries them.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import { collapseHistory, portalLabel, type PortalHistoryEntry, type PortalLabel } from "./portalLabels.ts";
import { PORTAL_FIELD_LIMITS, isPortalWindow, validateSubmission, windowSince } from "./portalSubmission.ts";
import { MAX_AUDIO_BASE64_CHARS, MAX_AUDIO_BYTES, base64ToBytes } from "./transcribe.ts";

export const REFERRAL_ACTIONS = [
  "form",
  "dup_check",
  "submit_referral",
  "list_referrals",
  "get_referral",
  "withdraw_referral",
  "dashboard",
  "transcribe",
] as const;
export type ReferralAction = (typeof REFERRAL_ACTIONS)[number];

export function isReferralAction(action: string): action is ReferralAction {
  return (REFERRAL_ACTIONS as readonly string[]).includes(action);
}

export interface ReferralScope {
  portalUserId: string;
  orgId: string;
  partnerId: string;
}

export interface ReferralDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>;
  now?(): Date;
}

export interface ActionResult {
  status: number;
  body: unknown;
}

export interface PortalForm {
  consentText: string;
  consentVersion: number;
}

export interface PortalReferralSummary {
  id: string;
  ref: string;
  companyName: string;
  label: PortalLabel;
  submittedAt: string;
  lastActivityAt: string;
}

export interface PortalDashboard {
  submitted: number;
  active: number;
  closedWon: number;
  conversionRate: number | null;
  valueVisible: boolean;
  totalValueCents?: number;
}

export interface PortalRepContact {
  name: string;
  email: string | null;
}

export interface PortalReferralDetail {
  id: string;
  ref: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  industry: string | null;
  urgency: string | null;
  notes: string | null;
  label: PortalLabel;
  submittedAt: string;
  canWithdraw: boolean;
  rep: PortalRepContact | null;
  history: PortalHistoryEntry[];
}

type Body = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(body: unknown): ActionResult {
  return { status: 200, body };
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): ActionResult {
  return { status, body: { error, ...extra } };
}

function serverError(where: string, message: string): ActionResult {
  console.error(`[portal_api] ${where} failed:`, message);
  return err(500, "server_error");
}

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return data !== null && typeof data === "object" ? [data as T] : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scopeArgs(scope: ReferralScope): Record<string, unknown> {
  return { p_org: scope.orgId, p_partner: scope.partnerId };
}

function windowArg(body: Body, deps: ReferralDeps): { ok: true; since: string | null } | { ok: false } {
  const chosen = body.window === undefined ? "all" : body.window;
  if (!isPortalWindow(chosen)) return { ok: false };
  const since = windowSince(chosen, deps.now ? deps.now() : new Date());
  return { ok: true, since: since ? since.toISOString() : null };
}

export async function handleReferralAction(
  action: ReferralAction,
  scope: ReferralScope,
  body: Body,
  ip: string | null,
  deps: ReferralDeps,
): Promise<ActionResult> {
  switch (action) {
    case "form":
      return form(scope, deps);
    case "dup_check":
      return dupCheck(scope, body, ip, deps);
    case "submit_referral":
      return submit(scope, body, ip, deps);
    case "list_referrals":
      return list(scope, body, deps);
    case "dashboard":
      return dashboard(scope, body, deps);
    case "get_referral":
      return getReferral(scope, body, ip, deps);
    case "withdraw_referral":
      return withdraw(scope, body, ip, deps);
    case "transcribe":
      return transcribe(scope, body, ip, deps);
    default:
      return err(404, "not_found");
  }
}

async function form(scope: ReferralScope, deps: ReferralDeps): Promise<ActionResult> {
  const { data, error } = await deps.rpc("portal_form_context", scopeArgs(scope));
  if (error) return serverError("form", error.message);
  const row = rows<{ consent_text: unknown; consent_version: unknown }>(data)[0];
  if (!row) return serverError("form", "no form context");
  const out: PortalForm = { consentText: str(row.consent_text), consentVersion: num(row.consent_version) };
  return ok({ form: out });
}

async function dupCheck(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const name = str(body.companyName).trim();
  const phone = str(body.phone).trim();
  const address = str(body.address).trim();
  if (
    name.length > PORTAL_FIELD_LIMITS.companyName ||
    phone.length > PORTAL_FIELD_LIMITS.phone ||
    address.length > PORTAL_FIELD_LIMITS.address
  ) {
    return err(400, "invalid_body");
  }
  if (!name) return ok({ probableDuplicate: false });
  const { data, error } = await deps.rpc("portal_dup_check", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_name: name,
    p_phone: phone || null,
    p_address: address || null,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("rate_limited")) return err(429, "rate_limited");
    return serverError("dup_check", error.message);
  }
  return ok({ probableDuplicate: data === true });
}

async function submit(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const check = validateSubmission(body);
  if (!check.ok) return err(400, "invalid_body", { field: check.field });
  const s = check.value;
  const { data, error } = await deps.rpc("portal_submit_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_company: s.companyName,
    p_contact_name: s.contactName,
    p_contact_email: s.email,
    p_contact_phone: s.phone,
    p_address: s.address,
    p_industry: s.industry,
    p_urgency: s.urgency,
    p_notes: s.notes,
    p_consent: s.consent,
    p_consent_version: s.consentVersion,
    p_ip: ip,
  });
  if (error) {
    const message = error.message;
    if (message.includes("rate_limited")) return err(429, "rate_limited");
    if (message.includes("consent_changed")) return err(409, "consent_changed");
    if (message.includes("consent_required")) return err(400, "invalid_body", { field: "consent" });
    const field = /invalid_input:([A-Za-z]+)/.exec(message)?.[1];
    if (field) return err(400, "invalid_body", { field });
    return serverError("submit_referral", message);
  }
  const row = rows<{ id: unknown; ref: unknown }>(data)[0];
  if (!row || !str(row.id)) return serverError("submit_referral", "no row returned");
  return ok({ referral: { id: str(row.id), ref: str(row.ref) } });
}

async function list(scope: ReferralScope, body: Body, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_list_referrals", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("list_referrals", error.message);
  const referrals: PortalReferralSummary[] = [];
  for (const r of rows<Record<string, unknown>>(data)) {
    const label = portalLabel(r.status);
    if (!label) continue;
    referrals.push({
      id: str(r.id),
      ref: str(r.ref),
      companyName: str(r.company_name),
      label,
      submittedAt: str(r.submitted_at),
      lastActivityAt: str(r.last_activity_at),
    });
  }
  return ok({ referrals });
}

async function dashboard(scope: ReferralScope, body: Body, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_dashboard_stats", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("dashboard", error.message);
  const row = rows<Record<string, unknown>>(data)[0];
  if (!row) return serverError("dashboard", "no stats row");
  const won = num(row.closed_won);
  const closed = won + num(row.not_moving_forward);
  const out: PortalDashboard = {
    submitted: num(row.submitted),
    active: num(row.active),
    closedWon: won,
    conversionRate: closed > 0 ? won / closed : null,
    valueVisible: row.value_visible === true,
  };
  // FR-PORT-70/71: the value leaves the server only when the ISO allows it.
  if (out.valueVisible) out.totalValueCents = num(row.won_value_cents);
  return ok({ dashboard: out });
}

async function getReferral(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const detail = await deps.rpc("portal_get_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (detail.error) return serverError("get_referral", detail.error.message);
  const row = rows<Record<string, unknown>>(detail.data)[0];
  const label = row ? portalLabel(row.status) : null;
  if (!row || !label) return err(404, "not_found");

  const hist = await deps.rpc("portal_referral_history", { ...scopeArgs(scope), p_referral: id });
  if (hist.error) return serverError("referral_history", hist.error.message);
  const history = collapseHistory(
    rows<Record<string, unknown>>(hist.data).map((h) => ({ status: h.status, at: h.created_at })),
  );

  const repName = strOrNull(row.rep_name);
  const repEmail = strOrNull(row.rep_email);
  const out: PortalReferralDetail = {
    id: str(row.id),
    ref: str(row.ref),
    companyName: str(row.company_name),
    contactName: strOrNull(row.contact_name),
    contactEmail: strOrNull(row.contact_email),
    contactPhone: strOrNull(row.contact_phone),
    address: strOrNull(row.address),
    industry: strOrNull(row.industry),
    urgency: strOrNull(row.urgency),
    notes: strOrNull(row.notes),
    label,
    submittedAt: str(row.submitted_at),
    canWithdraw: row.can_withdraw === true,
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    history,
  };
  return ok({ referral: out });
}

async function withdraw(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const { error } = await deps.rpc("portal_withdraw_referral", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("referral_not_found")) return err(404, "not_found");
    if (error.message.includes("not_withdrawable")) return err(409, "not_withdrawable");
    return serverError("withdraw_referral", error.message);
  }
  return ok({ ok: true });
}

async function transcribe(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  if (!deps.transcribe) return serverError("transcribe", "no transcriber configured");
  const audio = str(body.audio);
  const mime = str(body.mime).slice(0, 100);
  if (!audio) return err(400, "invalid_body");
  if (audio.length > MAX_AUDIO_BASE64_CHARS) return err(413, "audio_too_large");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(audio);
  } catch {
    return err(400, "invalid_body");
  }
  if (bytes.length === 0) return err(400, "invalid_body");
  if (bytes.length > MAX_AUDIO_BYTES) return err(413, "audio_too_large");

  const claim = await deps.rpc("portal_claim_transcribe", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_ip: ip,
  });
  if (claim.error) return serverError("transcribe claim", claim.error.message);
  if (claim.data !== true) return err(429, "rate_limited");

  try {
    const text = await deps.transcribe(bytes, mime);
    return ok({ text: text.trim() });
  } catch (e) {
    // The vendor's message can carry request detail; the partner gets none of it.
    console.error("[portal_api] transcribe failed:", e instanceof Error ? e.message : String(e));
    return err(502, "transcription_failed");
  }
}
```

- [ ] **Step 4: Route the new actions in `portalApi.ts`**

In `supabase/functions/_shared/portalApi.ts`:

(a) Replace

```ts
import { portalCodeEmail, portalFromAddress, portalUrl } from "./portalEmail.ts";
```

with

```ts
import { portalCodeEmail, portalFromAddress, portalUrl } from "./portalEmail.ts";
import { REFERRAL_ACTIONS, handleReferralAction, isReferralAction, type ReferralAction } from "./portalReferralApi.ts";
```

(b) Replace

```ts
  /** Reserved for later phases; Phase 1A keeps every clock in SQL. */
  now?(): Date;
```

with

```ts
  /** Clock for the referral time windows (Phase 1B); defaults to new Date(). */
  now?(): Date;
  /** Speech-to-text for the portal's dictated notes (Phase 1B). Absent means transcribe answers 500. */
  transcribe?(audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string>;
```

(c) Replace

```ts
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
```

with

```ts
export type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out"
  | ReferralAction;

const ACTIONS: ReadonlySet<string> = new Set<PortalAction>([
  "brand",
  "request_code",
  "verify_code",
  "peek_invite",
  "accept_invite",
  "me",
  "sign_out",
  ...REFERRAL_ACTIONS,
]);
```

(d) Replace

```ts
interface LookupRow {
  portal_user_id: string;
  partner_name: string;
  user_email: string;
  org_name: string;
}
```

with

```ts
interface LookupRow {
  portal_user_id: string;
  org_id: string;
  partner_id: string;
  partner_name: string;
  user_email: string;
  org_name: string;
}
```

(e) Replace the `default` branch at the end of the `switch` in `handlePortalRequest`:

```ts
      default:
        return jsonResponse({ error: "not_found" }, 404);
    }
```

with

```ts
      default: {
        if (isReferralAction(action)) {
          const token = sessionTokenFrom(req.headers);
          if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
          return await referral(action, slug, token, body, ip, deps);
        }
        return jsonResponse({ error: "not_found" }, 404);
      }
    }
```

(f) Append at the end of the file:

```ts
/**
 * Phase 1B signed-in actions. The session is looked up on every request, and the
 * org, partner and portal user it returns are the only scope the referral
 * functions ever see. A database error during the lookup is a 500 (retry), not a
 * 401, so a transient failure never signs the partner out.
 */
async function referral(
  action: ReferralAction,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PortalApiDeps,
): Promise<Response> {
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  const { data, error } = await deps.rpc("portal_session_lookup", { p_slug: slug, p_token: token });
  if (error) {
    console.error("[portal_api] session lookup failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const row = firstRow<LookupRow>(data);
  if (!row?.portal_user_id) return jsonResponse({ error: "unauthorized" }, 401);
  const result = await handleReferralAction(
    action,
    { portalUserId: row.portal_user_id, orgId: row.org_id, partnerId: row.partner_id },
    body,
    ip,
    deps,
  );
  return jsonResponse(result.body, result.status);
}
```

- [ ] **Step 5: Wire the transcriber in the edge function**

In `supabase/functions/portal_api/index.ts`:

(a) Replace

```ts
//   brand | request_code | verify_code | peek_invite | accept_invite | me | sign_out
```

with

```ts
//   brand | request_code | verify_code | peek_invite | accept_invite | me | sign_out
//   form | dup_check | submit_referral | list_referrals | dashboard | get_referral
//   withdraw_referral | transcribe   (Phase 1B, session required)
```

(b) Replace

```ts
import { handlePortalRequest, type PortalApiDeps } from "../_shared/portalApi.ts";
```

with

```ts
import { handlePortalRequest, type PortalApiDeps } from "../_shared/portalApi.ts";
import { MOCK_TRANSCRIPT, transcribeWithAssemblyAI } from "../_shared/transcribe.ts";
```

(c) Replace

```ts
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";
```

with

```ts
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";
// Same secret and mock flag as the rep-facing transcribe function.
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const TRANSCRIBE_MOCK = Deno.env.get("TRANSCRIBE_MOCK") === "1";
```

(d) Replace

```ts
  env: {
    appBaseUrl: APP_BASE_URL,
```

with

```ts
  transcribe: (audio) =>
    TRANSCRIBE_MOCK
      ? Promise.resolve(MOCK_TRANSCRIPT)
      : transcribeWithAssemblyAI(audio, { fetch, apiKey: ASSEMBLYAI_API_KEY }),
  env: {
    appBaseUrl: APP_BASE_URL,
```

- [ ] **Step 6: Add the module to the app typecheck**

In `apps/app/tsconfig.app.json`, replace

```json
    "../../supabase/functions/_shared/transcribe.ts"
  ]
```

with

```json
    "../../supabase/functions/_shared/transcribe.ts",
    "../../supabase/functions/_shared/portalReferralApi.ts"
  ]
```

- [ ] **Step 7: Run the tests and the Deno typecheck**

Run: `pnpm --filter app test -- _shared/portalReferralApi.test.ts _shared/portalApi.test.ts`
Expected: PASS, 2 files (the 1A handler tests are unchanged).

Run: `deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/portal_api/index.ts`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/portalReferralApi.ts supabase/functions/_shared/portalReferralApi.test.ts supabase/functions/_shared/portalApi.ts supabase/functions/portal_api/index.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): portal_api referral actions with allowlisted responses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Portal client additions, draft and invite storage, formatting, dictation hook

**Files:**
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`, `apps/app/src/features/portal/lib/portalApi.test.ts`
- Create: `apps/app/src/features/portal/lib/portalDraft.ts` (+ `portalDraft.test.ts`)
- Create: `apps/app/src/features/portal/lib/portalInviteToken.ts` (+ `portalInviteToken.test.ts`)
- Create: `apps/app/src/features/portal/lib/portalFormat.ts` (+ `portalFormat.test.ts`)
- Create: `apps/app/src/features/portal/lib/portalSignedIn.ts`
- Create: `apps/app/src/features/portal/hooks/usePortalDictation.ts` (+ `usePortalDictation.test.ts`)
- Modify: `apps/app/src/hooks/useVoiceDictation.ts` (export `blobToBase64`)

**Interfaces:**
- Consumes: Task 7 wire format and response types (type-only import from `supabase/functions/_shared/portalReferralApi`), `PortalWindow` from `_shared/portalSubmission`, `useVoiceRecorder()` (`{ state: "idle" | "recording" | "recorded" | "denied", blob, mimeType, start, stop, reset }`), `DictationState` from `@/hooks/useVoiceDictation`.
- Produces (`lib/portalApi.ts`, additions to the 1A exports, which keep their shapes):
  - Re-exported types `PortalForm`, `PortalReferralSummary`, `PortalDashboard`, `PortalReferralDetail`, `PortalWindow`.
  - `type PortalSubmitInput = { companyName: string; contactName: string; email: string; phone: string; address: string; industry: string; urgency: string; notes: string; consent: boolean; consentVersion: number }`
  - `interface PortalSubmitted { id: string; ref: string }`
  - `class PortalApiError` gains `readonly field: string | null` (constructor `(status: number, code: string, field?: string | null)`).
  - `const PORTAL_POLL_MS = 30_000`, `function portalDataKey(slug: string, token: string, ...rest: Array<string | number | boolean | null>): readonly unknown[]`, `function isPortalUnauthorized(err: unknown): boolean`
  - `portalApi.form(slug, token): Promise<PortalForm>`, `portalApi.dupCheck(slug, token, input: { companyName: string; phone: string; address: string }): Promise<boolean>`, `portalApi.submitReferral(slug, token, input: PortalSubmitInput): Promise<PortalSubmitted>`, `portalApi.listReferrals(slug, token, period: PortalWindow): Promise<PortalReferralSummary[]>`, `portalApi.dashboard(slug, token, period: PortalWindow): Promise<PortalDashboard>`, `portalApi.getReferral(slug, token, referralId): Promise<PortalReferralDetail | null>` (null on 404), `portalApi.withdrawReferral(slug, token, referralId): Promise<void>`, `portalApi.transcribe(slug, token, audio: string, mime: string): Promise<string>`
- Produces (`lib/portalDraft.ts`): `interface PortalDraft { companyName; contactName; email; phone; address; industry; urgency; notes: string }`, `const EMPTY_DRAFT`, `portalDraftKey(slug)`, `readPortalDraft(slug): PortalDraft`, `writePortalDraft(slug, draft): void` (an all-blank draft removes the key), `clearPortalDraft(slug): void`, `isEmptyDraft(draft): boolean`.
- Produces (`lib/portalInviteToken.ts`): `inviteTokenKey(slug)`, `readInviteToken(slug): string | null`, `writeInviteToken(slug, token): void`, `clearInviteToken(slug): void` (sessionStorage).
- Produces (`lib/portalFormat.ts`): `formatPortalDate(iso: string): string`, `formatPortalMoney(cents: number): string`, `formatConversion(rate: number | null): string`.
- Produces (`lib/portalSignedIn.ts`): `interface PortalSignedInContext { slug: string; token: string; brand: PortalBrand; me: PortalMe; expire: () => void }`, `usePortalSignedIn(): PortalSignedInContext`.
- Produces (`hooks/usePortalDictation.ts`): `usePortalDictation({ slug, token, onResult }: { slug: string; token: string; onResult: (text: string) => void }): { micState: DictationState; toggle: () => void }`.
- `@/hooks/useVoiceDictation` additionally exports `blobToBase64(blob: Blob): Promise<string>` (body unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/features/portal/lib/portalApi.test.ts`:

```ts
describe("Phase 1B actions", () => {
  it("sends the session header and the slug for every referral action", async () => {
    const { PORTAL_POLL_MS, portalDataKey } = await import("./portalApi");
    expect(PORTAL_POLL_MS).toBe(30_000);
    expect(portalDataKey("acme", "tok", "list", "all")).toEqual(["portal", "data", "acme", "tok", "list", "all"]);

    fetchMock.mockResolvedValueOnce(respond(200, { form: { consentText: "I may share.", consentVersion: 2 } }));
    await expect(portalApi.form("acme", "tok")).resolves.toEqual({ consentText: "I may share.", consentVersion: 2 });
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/form`);
    expect(lastCall().headers["x-portal-session"]).toBe("tok");
    expect(lastCall().body).toEqual({ slug: "acme" });

    fetchMock.mockResolvedValueOnce(respond(200, { probableDuplicate: true }));
    await expect(portalApi.dupCheck("acme", "tok", { companyName: "Co", phone: "555", address: "" })).resolves.toBe(true);
    expect(lastCall().body).toEqual({ slug: "acme", companyName: "Co", phone: "555", address: "" });

    fetchMock.mockResolvedValueOnce(respond(200, { referrals: [] }));
    await expect(portalApi.listReferrals("acme", "tok", "90d")).resolves.toEqual([]);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/list_referrals`);
    expect(lastCall().body).toEqual({ slug: "acme", window: "90d" });

    const dash = { submitted: 1, active: 1, closedWon: 0, conversionRate: null, valueVisible: false };
    fetchMock.mockResolvedValueOnce(respond(200, { dashboard: dash }));
    await expect(portalApi.dashboard("acme", "tok", "all")).resolves.toEqual(dash);

    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.withdrawReferral("acme", "tok", "r-1");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/withdraw_referral`);
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "r-1" });

    fetchMock.mockResolvedValueOnce(respond(200, { text: "Hello" }));
    await expect(portalApi.transcribe("acme", "tok", "YWJj", "audio/webm")).resolves.toBe("Hello");
    expect(lastCall().body).toEqual({ slug: "acme", audio: "YWJj", mime: "audio/webm" });
  });

  it("submits a referral and returns its id and reference", async () => {
    const input = {
      companyName: "Fresh Bakery",
      contactName: "Ann",
      email: "ann@fresh.example",
      phone: "",
      address: "",
      industry: "restaurant",
      urgency: "",
      notes: "",
      consent: true,
      consentVersion: 3,
    };
    fetchMock.mockResolvedValueOnce(respond(200, { referral: { id: "r-9", ref: "REF-AAAA0009" } }));
    await expect(portalApi.submitReferral("acme", "tok", input)).resolves.toEqual({ id: "r-9", ref: "REF-AAAA0009" });
    expect(lastCall().body).toEqual({ slug: "acme", ...input });
  });

  it("carries the field name of a 400 and recognizes a dead session", async () => {
    const { isPortalUnauthorized } = await import("./portalApi");
    fetchMock.mockResolvedValueOnce(respond(400, { error: "invalid_body", field: "emailOrPhone" }));
    const err = await portalApi
      .submitReferral("acme", "tok", {
        companyName: "Co",
        contactName: "A",
        email: "",
        phone: "",
        address: "",
        industry: "",
        urgency: "",
        notes: "",
        consent: true,
        consentVersion: 1,
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "invalid_body", field: "emailOrPhone" });

    fetchMock.mockResolvedValueOnce(respond(401, { error: "unauthorized" }));
    const dead = await portalApi.dashboard("acme", "old", "all").catch((e: unknown) => e);
    expect(isPortalUnauthorized(dead)).toBe(true);
    expect(isPortalUnauthorized(new PortalApiError(500, "server_error"))).toBe(false);
    expect(new PortalApiError(500, "server_error").field).toBeNull();
  });

  it("returns null for a referral that is missing or not the partner's", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_found" }));
    await expect(portalApi.getReferral("acme", "tok", "r-x")).resolves.toBeNull();
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "r-x" });
  });
});
```

Create `apps/app/src/features/portal/lib/portalDraft.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EMPTY_DRAFT, clearPortalDraft, isEmptyDraft, portalDraftKey, readPortalDraft, writePortalDraft } from "./portalDraft";

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error("blocked");
  };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
}

function install(shim: Storage) {
  Object.defineProperty(window, "localStorage", { value: shim, writable: true, configurable: true });
}

beforeEach(() => install(memoryStorage()));
afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("portal draft", () => {
  it("round-trips per slug", () => {
    writePortalDraft("acme", { ...EMPTY_DRAFT, companyName: "Fresh Bakery", notes: "Busy at lunch" });
    expect(readPortalDraft("acme")).toEqual({ ...EMPTY_DRAFT, companyName: "Fresh Bakery", notes: "Busy at lunch" });
    expect(readPortalDraft("other")).toEqual(EMPTY_DRAFT);
    expect(portalDraftKey("acme")).toBe("navigatr-portal-draft:acme");
  });

  it("removes the key for an all-blank draft and on clear", () => {
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "555" });
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "   " });
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "555" });
    clearPortalDraft("acme");
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();
  });

  it("ignores junk, unknown keys and non-string values", () => {
    window.localStorage.setItem("navigatr-portal-draft:acme", "{not json");
    expect(readPortalDraft("acme")).toEqual(EMPTY_DRAFT);
    window.localStorage.setItem("navigatr-portal-draft:acme", JSON.stringify({ companyName: 7, evil: "x", contactName: "Ann" }));
    expect(readPortalDraft("acme")).toEqual({ ...EMPTY_DRAFT, contactName: "Ann" });
  });

  it("never throws when storage is blocked", () => {
    install(throwingStorage());
    expect(() => writePortalDraft("acme", { ...EMPTY_DRAFT, companyName: "X" })).not.toThrow();
    expect(readPortalDraft("acme")).toEqual(EMPTY_DRAFT);
    expect(() => clearPortalDraft("acme")).not.toThrow();
  });

  it("knows an empty draft", () => {
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, urgency: "no_rush" })).toBe(false);
  });
});
```

Create `apps/app/src/features/portal/lib/portalInviteToken.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearInviteToken, inviteTokenKey, readInviteToken, writeInviteToken } from "./portalInviteToken";

// Node 25's global web storage is unreliable under vitest: install an in-memory sessionStorage per test.
const origSessionStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function install(shim: Storage) {
  Object.defineProperty(window, "sessionStorage", { value: shim, writable: true, configurable: true });
}

beforeEach(() => install(memoryStorage()));
afterEach(() => {
  Object.defineProperty(window, "sessionStorage", { value: origSessionStorage, writable: true, configurable: true });
});

describe("pending invite token", () => {
  it("keeps the token per slug for this tab and clears it", () => {
    expect(inviteTokenKey("acme")).toBe("navigatr-portal-invite:acme");
    writeInviteToken("acme", "tok-1");
    expect(readInviteToken("acme")).toBe("tok-1");
    expect(readInviteToken("other")).toBeNull();
    clearInviteToken("acme");
    expect(readInviteToken("acme")).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    install({ length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom });
    expect(() => writeInviteToken("acme", "t")).not.toThrow();
    expect(readInviteToken("acme")).toBeNull();
    expect(() => clearInviteToken("acme")).not.toThrow();
  });
});
```

Create `apps/app/src/features/portal/lib/portalFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatConversion, formatPortalDate, formatPortalMoney } from "./portalFormat";

describe("portal formatting", () => {
  it("formats dates for a phone screen", () => {
    expect(formatPortalDate("2026-10-05T12:00:00Z")).toBe("Oct 5, 2026");
    expect(formatPortalDate("not a date")).toBe("");
  });

  it("formats cents as whole dollars", () => {
    expect(formatPortalMoney(500000)).toBe("$5,000");
    expect(formatPortalMoney(0)).toBe("$0");
  });

  it("formats conversion, or says nothing has closed", () => {
    expect(formatConversion(0.5)).toBe("50%");
    expect(formatConversion(1 / 3)).toBe("33%");
    expect(formatConversion(null)).toBe("No closed referrals yet");
  });
});
```

Create `apps/app/src/features/portal/hooks/usePortalDictation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const recorder = {
  state: "idle" as "idle" | "recording" | "recorded" | "denied",
  blob: null as Blob | null,
  durationMs: 0,
  mimeType: "audio/webm",
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/hooks/useVoiceRecorder", () => ({ useVoiceRecorder: () => recorder }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const transcribeMock = vi.fn();
vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: { ...actual.portalApi, transcribe: (...a: unknown[]) => transcribeMock(...a) } };
});

import { usePortalDictation } from "./usePortalDictation";

function fakeBlob(): Blob {
  return { arrayBuffer: async () => new TextEncoder().encode("audio").buffer } as unknown as Blob;
}

beforeEach(() => {
  recorder.state = "idle";
  recorder.blob = null;
  recorder.mimeType = "audio/webm";
  recorder.start.mockReset();
  recorder.stop.mockReset();
  recorder.reset.mockReset();
  transcribeMock.mockReset();
});

describe("usePortalDictation", () => {
  it("starts from rest and stops while recording", () => {
    const { result, rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    expect(result.current.micState).toBe("rest");
    act(() => result.current.toggle());
    expect(recorder.start).toHaveBeenCalledTimes(1);
    recorder.state = "recording";
    rerender();
    expect(result.current.micState).toBe("recording");
    act(() => result.current.toggle());
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("sends the clip to the portal with the partner's session and delivers trimmed text", async () => {
    transcribeMock.mockResolvedValue("  Met the owner  ");
    const onResult = vi.fn();
    const { rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult }));
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("Met the owner"));
    expect(transcribeMock).toHaveBeenCalledWith("acme", "tok", btoa("audio"), "audio/webm");
    expect(recorder.reset).toHaveBeenCalled();
  });

  it("shows an error when transcription fails, and permission-denied when the mic is refused", async () => {
    transcribeMock.mockRejectedValue(new Error("rate_limited"));
    const { result, rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(result.current.micState).toBe("error"));

    recorder.state = "denied";
    recorder.blob = null;
    const denied = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    expect(denied.result.current.micState).toBe("permission-denied");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib src/features/portal/hooks`
Expected: FAIL; `portalApi.form is not a function` and missing modules `./portalDraft`, `./portalInviteToken`, `./portalFormat`, `./usePortalDictation`.

- [ ] **Step 3: Export `blobToBase64`**

In `apps/app/src/hooks/useVoiceDictation.ts`, replace

```ts
async function blobToBase64(blob: Blob): Promise<string> {
```

with

```ts
export async function blobToBase64(blob: Blob): Promise<string> {
```

- [ ] **Step 4: Replace the portal client**

Replace the whole of `apps/app/src/features/portal/lib/portalApi.ts` with:

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
 * dead invite is null, a dead session from me() is null, a referral that is not
 * the partner's is null), so React Query does not report them to Sentry as
 * failures.
 *
 * Phase 1B response types are imported from the edge module that builds them,
 * so the two sides cannot drift.
 */
import type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";

export type { PortalDashboard, PortalForm, PortalReferralDetail, PortalReferralSummary, PortalWindow };

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321";
const ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || "test-anon-key-placeholder";

export const PORTAL_API_URL = `${SUPABASE_URL}/functions/v1/portal_api`;

/** Dashboard, list and detail refresh every 30 seconds (spec R10: the 60 second bar). */
export const PORTAL_POLL_MS = 30_000;

/** Query keys for partner data; sign-out drops everything under ["portal", "data", slug]. */
export function portalDataKey(
  slug: string,
  token: string,
  ...rest: Array<string | number | boolean | null>
): readonly unknown[] {
  return ["portal", "data", slug, token, ...rest];
}

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

export type PortalSubmitInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  industry: string;
  urgency: string;
  notes: string;
  consent: boolean;
  consentVersion: number;
};

export interface PortalSubmitted {
  id: string;
  ref: string;
}

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** For a 400 on submit_referral: which form field to point at. */
  readonly field: string | null;

  constructor(status: number, code: string, field: string | null = null) {
    super(code);
    this.name = "PortalApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out"
  | "form"
  | "dup_check"
  | "submit_referral"
  | "list_referrals"
  | "dashboard"
  | "get_referral"
  | "withdraw_referral"
  | "transcribe";

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
    const obj = payload !== null && typeof payload === "object" ? (payload as { error?: unknown; field?: unknown }) : {};
    const code = typeof obj.error === "string" ? obj.error : "request_failed";
    const field = typeof obj.field === "string" ? obj.field : null;
    throw new PortalApiError(res.status, code, field);
  }
  return payload as T;
}

/**
 * True when the portal could not be reached or failed on its side (network,
 * 5xx, or anything that is not a PortalApiError). Such failures get a retry,
 * never a "this link is dead" or "wrong code" answer.
 */
export function isPortalTransientError(err: unknown): boolean {
  if (!(err instanceof PortalApiError)) return true;
  return err.status === 0 || err.status >= 500;
}

/** The session is gone (expired, signed out elsewhere, suspended, revoked). */
export function isPortalUnauthorized(err: unknown): boolean {
  return err instanceof PortalApiError && err.status === 401;
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

  form(slug: string, sessionToken: string): Promise<PortalForm> {
    return portalRequest<{ form: PortalForm }>("form", { slug }, sessionToken).then((r) => r.form);
  },

  dupCheck(
    slug: string,
    sessionToken: string,
    input: { companyName: string; phone: string; address: string },
  ): Promise<boolean> {
    return portalRequest<{ probableDuplicate: boolean }>("dup_check", { slug, ...input }, sessionToken).then(
      (r) => r.probableDuplicate === true,
    );
  },

  submitReferral(slug: string, sessionToken: string, input: PortalSubmitInput): Promise<PortalSubmitted> {
    return portalRequest<{ referral: PortalSubmitted }>("submit_referral", { slug, ...input }, sessionToken).then(
      (r) => r.referral,
    );
  },

  listReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalReferralSummary[]> {
    return portalRequest<{ referrals: PortalReferralSummary[] }>("list_referrals", { slug, window: period }, sessionToken).then(
      (r) => r.referrals,
    );
  },

  dashboard(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalDashboard> {
    return portalRequest<{ dashboard: PortalDashboard }>("dashboard", { slug, window: period }, sessionToken).then(
      (r) => r.dashboard,
    );
  },

  getReferral(slug: string, sessionToken: string, referralId: string): Promise<PortalReferralDetail | null> {
    return portalRequest<{ referral: PortalReferralDetail }>("get_referral", { slug, referralId }, sessionToken).then(
      (r) => r.referral,
      nullOn(404),
    );
  },

  async withdrawReferral(slug: string, sessionToken: string, referralId: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("withdraw_referral", { slug, referralId }, sessionToken);
  },

  transcribe(slug: string, sessionToken: string, audio: string, mime: string): Promise<string> {
    return portalRequest<{ text: string }>("transcribe", { slug, audio, mime }, sessionToken).then((r) => r.text);
  },
};
```

- [ ] **Step 5: Write the storage, formatting and context modules**

Create `apps/app/src/features/portal/lib/portalDraft.ts`:

```ts
/**
 * Submit-form draft (spec 5.5: "Draft autosaves to localStorage"). One draft
 * per tenant slug, cleared on a successful submit. Every storage access is
 * wrapped: private browsing must never break the form. Consent is never part of
 * the draft; the partner confirms it fresh each time.
 */
export interface PortalDraft {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  industry: string;
  urgency: string;
  notes: string;
}

export const EMPTY_DRAFT: PortalDraft = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  industry: "",
  urgency: "",
  notes: "",
};

const FIELDS = Object.keys(EMPTY_DRAFT) as Array<keyof PortalDraft>;

export function portalDraftKey(slug: string): string {
  return `navigatr-portal-draft:${slug}`;
}

export function isEmptyDraft(draft: PortalDraft): boolean {
  return FIELDS.every((f) => draft[f].trim() === "");
}

export function readPortalDraft(slug: string): PortalDraft {
  try {
    const raw = window.localStorage.getItem(portalDraftKey(slug));
    if (!raw) return { ...EMPTY_DRAFT };
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return { ...EMPTY_DRAFT };
    const out: PortalDraft = { ...EMPTY_DRAFT };
    for (const f of FIELDS) {
      const v = (parsed as Record<string, unknown>)[f];
      if (typeof v === "string") out[f] = v;
    }
    return out;
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function writePortalDraft(slug: string, draft: PortalDraft): void {
  try {
    if (isEmptyDraft(draft)) window.localStorage.removeItem(portalDraftKey(slug));
    else window.localStorage.setItem(portalDraftKey(slug), JSON.stringify(draft));
  } catch {
    // Storage refused (private mode); the form still works, just without autosave.
  }
}

export function clearPortalDraft(slug: string): void {
  try {
    window.localStorage.removeItem(portalDraftKey(slug));
  } catch {
    // Nothing stored that we can reach.
  }
}
```

Create `apps/app/src/features/portal/lib/portalInviteToken.ts`:

```ts
/**
 * The invite token, kept for this tab only (1A tracker item). PortalInvitePage
 * moves the token out of the address bar on first load; without this, reloading
 * the terms screen lost it and showed "expired". sessionStorage dies with the
 * tab, is keyed per tenant slug, and is cleared once the invite is accepted.
 */
export function inviteTokenKey(slug: string): string {
  return `navigatr-portal-invite:${slug}`;
}

export function readInviteToken(slug: string): string | null {
  try {
    return window.sessionStorage.getItem(inviteTokenKey(slug)) || null;
  } catch {
    return null;
  }
}

export function writeInviteToken(slug: string, token: string): void {
  try {
    window.sessionStorage.setItem(inviteTokenKey(slug), token);
  } catch {
    // Storage refused; a reload will need the link again.
  }
}

export function clearInviteToken(slug: string): void {
  try {
    window.sessionStorage.removeItem(inviteTokenKey(slug));
  } catch {
    // Nothing stored that we can reach.
  }
}
```

Create `apps/app/src/features/portal/lib/portalFormat.ts`:

```ts
/** Display helpers for the partner portal (short, phone-friendly). */
export function formatPortalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatPortalMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function formatConversion(rate: number | null): string {
  return rate === null ? "No closed referrals yet" : `${Math.round(rate * 100)}%`;
}
```

Create `apps/app/src/features/portal/lib/portalSignedIn.ts`:

```ts
/**
 * What the signed-in layout hands its pages: the tenant, the session token, the
 * partner, and `expire()`, which forgets the session on this device and returns
 * to sign-in (call it when any request answers 401).
 */
import { useOutletContext } from "react-router-dom";
import type { PortalBrand, PortalMe } from "./portalApi";

export interface PortalSignedInContext {
  slug: string;
  token: string;
  brand: PortalBrand;
  me: PortalMe;
  expire: () => void;
}

export function usePortalSignedIn(): PortalSignedInContext {
  return useOutletContext<PortalSignedInContext>();
}
```

- [ ] **Step 6: Write the dictation hook**

Create `apps/app/src/features/portal/hooks/usePortalDictation.ts`:

```ts
/**
 * usePortalDictation: voice notes on the partner's submit form (spec 5.5, brief D6).
 *
 * Same recorder and state machine as the app's useVoiceDictation, but the clip
 * goes to portal_api's transcribe action with the partner's portal session. It
 * never calls the rep-only transcribe function, which requires an internal
 * user's JWT. Drives NotesFieldWithMic in manual mode (onMicClick + micState).
 */
import * as React from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { blobToBase64, type DictationState } from "@/hooks/useVoiceDictation";
import { portalApi } from "../lib/portalApi";

export interface UsePortalDictationOptions {
  slug: string;
  token: string;
  onResult: (text: string) => void;
}

export function usePortalDictation({ slug, token, onResult }: UsePortalDictationOptions) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = React.useState<"idle" | "transcribing" | "error">("idle");

  // Keep the latest onResult without re-running the transcribe effect.
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;
  // Each finished recording is transcribed exactly once.
  const handledRef = React.useRef<Blob | null>(null);

  const { state: recState, blob, mimeType, reset } = recorder;

  React.useEffect(() => {
    if (recState !== "recorded" || !blob || handledRef.current === blob) return;
    handledRef.current = blob;
    let cancelled = false;
    (async () => {
      setPhase("transcribing");
      try {
        const audio = await blobToBase64(blob);
        const text = (await portalApi.transcribe(slug, token, audio, mimeType)).trim();
        if (cancelled) return;
        if (text) onResultRef.current(text);
        setPhase("idle");
        reset();
        handledRef.current = null;
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recState, blob, mimeType, reset, slug, token]);

  const micState: DictationState =
    phase === "transcribing"
      ? "transcribing"
      : phase === "error"
        ? "error"
        : recState === "recording"
          ? "recording"
          : recState === "denied"
            ? "permission-denied"
            : "rest";

  const toggle = React.useCallback(() => {
    if (phase === "transcribing") return;
    if (recState === "recording") {
      recorder.stop();
    } else {
      setPhase("idle");
      handledRef.current = null;
      reset();
      void recorder.start();
    }
  }, [phase, recState, recorder, reset]);

  return { micState, toggle };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal/lib src/features/portal/hooks src/hooks/useVoiceDictation.test.ts`
Expected: PASS (the existing 1A client tests and the app dictation tests included).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/features/portal/lib apps/app/src/features/portal/hooks apps/app/src/hooks/useVoiceDictation.ts
git commit -m "$(cat <<'EOF'
feat(portal): client for referral actions, draft and invite storage, portal dictation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Signed-in layout and the partner dashboard

**Files:**
- Create: `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`
- Create: `apps/app/src/features/portal/components/PortalLabelChip.tsx`
- Create: `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`, `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`, `apps/app/src/features/portal/pages/PortalRoot.test.tsx`, `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`
- Delete: `apps/app/src/features/portal/pages/PortalHomePage.tsx`

**Interfaces:**
- Consumes: Task 8 (`portalApi.dashboard`, `portalApi.listReferrals`, `portalDataKey`, `PORTAL_POLL_MS`, `isPortalUnauthorized`, `PortalSignedInContext`, `usePortalSignedIn`, `formatConversion`, `formatPortalDate`, `formatPortalMoney`), Task 5 (`PORTAL_WINDOWS`, `PortalLabel`), 1A (`portalApi.me`, `portalApi.signOut`, `readPortalSession`, `clearPortalSession`, `PortalRetry`).
- Produces:
  - `PortalSignedInLayout({ slug, brand }: { slug: string; brand: PortalBrand })`: React Router layout route. Redirects to `/p/:slug` without a session or when `me` returns null; shows `Signed in as {partnerName} at {orgName}` and a `Sign out` button; renders `<Outlet context={PortalSignedInContext} />`. Sign-out and `expire()` both clear the stored session and remove the `["portal", "me", slug]` and `["portal", "data", slug]` queries.
  - `PortalLabelChip({ label }: { label: PortalLabel })`.
  - `PortalDashboardPage()`: route `/p/:slug/home`.
  - `PortalRoot` routes: `index` sign-in, `invite`, layout route containing `home`; Tasks 10 and 11 add `new` and `r/:referralId` inside the same layout route.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const STATS = { submitted: 4, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: false };
const ROWS = [
  {
    id: "r-1",
    ref: "REF-AAAA0001",
    companyName: "Fresh Bakery",
    label: "In Progress",
    submittedAt: "2026-10-01T12:00:00Z",
    lastActivityAt: "2026-10-05T12:00:00Z",
  },
  {
    id: "r-2",
    ref: "REF-AAAA0002",
    companyName: "Corner Cafe",
    label: "Received",
    submittedAt: "2026-10-02T12:00:00Z",
    lastActivityAt: "2026-10-02T12:00:00Z",
  },
];

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function renderHome(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/p/acme/home"]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.dashboard.mockResolvedValue(STATS);
  api.listReferrals.mockResolvedValue(ROWS);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalDashboardPage", () => {
  it("shows the tiles and the partner's referrals with partner labels", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "Your referrals" })).toBeInTheDocument();
    expect(screen.getByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.dashboard).toHaveBeenCalledWith("acme", "live", "all");
    expect(api.listReferrals).toHaveBeenCalledWith("acme", "live", "all");

    const tiles = screen.getByRole("region", { name: "Summary" });
    expect(within(tiles).getByText("Submitted").nextSibling).toHaveTextContent("4");
    expect(within(tiles).getByText("Active").nextSibling).toHaveTextContent("2");
    expect(within(tiles).getByText("Closed Won").nextSibling).toHaveTextContent("1");
    expect(within(tiles).getByText("Conversion rate").nextSibling).toHaveTextContent("50%");
    expect(within(tiles).queryByText("Total value")).toBeNull();

    const row = await screen.findByRole("link", { name: /Fresh Bakery/ });
    expect(row).toHaveAttribute("href", "/p/acme/r/r-1");
    expect(within(row).getByText("In Progress")).toBeInTheDocument();
    expect(within(row).getByText("REF-AAAA0001 · Updated Oct 5, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Corner Cafe/ })).toHaveTextContent("Received");
  });

  it("shows closed-won value only when the ISO allows it", async () => {
    api.dashboard.mockResolvedValue({ ...STATS, valueVisible: true, totalValueCents: 500000 });
    renderHome();
    const tiles = await screen.findByRole("region", { name: "Summary" });
    expect(await within(tiles).findByText("Total value")).toBeInTheDocument();
    expect(within(tiles).getByText("$5,000")).toBeInTheDocument();
  });

  it("says when nothing has closed yet and when there are no referrals", async () => {
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("No closed referrals yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet. Send Acme ISO a business and follow it here.")).toBeInTheDocument();
  });

  it("switches the time period", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    expect(screen.getByRole("button", { name: "All time" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(api.dashboard).toHaveBeenLastCalledWith("acme", "live", "30d");
    expect(api.listReferrals).toHaveBeenLastCalledWith("acme", "live", "30d");
  });

  it("polls the tiles and the list every 30 seconds", async () => {
    const client = renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    for (const key of [
      ["portal", "data", "acme", "live", "dashboard", "all"],
      ["portal", "data", "acme", "live", "list", "all"],
    ]) {
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);
    }
  });

  it("returns to sign-in and forgets the session when the session is gone", async () => {
    api.dashboard.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderHome();
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("offers a retry when the referrals can't be loaded", async () => {
    const user = userEvent.setup();
    api.listReferrals.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(ROWS);
    renderHome();
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Fresh Bakery/ })).toBeInTheDocument();
  });

  it("signs out from the top bar and drops the cached partner data", async () => {
    const user = userEvent.setup();
    api.signOut.mockResolvedValue(undefined);
    const client = renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(client.getQueryCache().findAll({ queryKey: ["portal", "data", "acme"] })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalDashboardPage.test.tsx`
Expected: FAIL; the 1A landing page has no `Your referrals` heading.

- [ ] **Step 3: Write the label chip**

Create `apps/app/src/features/portal/components/PortalLabelChip.tsx`:

```tsx
/** A partner label as a chip. Only partner labels ever reach the portal (spec 5.6). */
import { Badge, type BadgeKind } from "@/components/navigatr";
import type { PortalLabel } from "../../../../../../supabase/functions/_shared/portalLabels";

const KIND: Record<PortalLabel, BadgeKind> = {
  Received: "status-upcoming",
  Accepted: "stage-new",
  "In Progress": "stage-contacted",
  "Closed Won": "stage-won",
  "Not Moving Forward": "priority-low",
  Withdrawn: "priority-low",
};

export function PortalLabelChip({ label }: { label: PortalLabel }) {
  return (
    <Badge kind={KIND[label]} size="sm" className="shrink-0">
      {label}
    </Badge>
  );
}
```

- [ ] **Step 4: Write the signed-in layout**

Create `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`:

```tsx
/**
 * PortalSignedInLayout: every signed-in portal page sits inside this layout
 * route. It checks the session once (me), shows who is signed in with a Sign out
 * button, and hands the pages their context. Any page that gets a 401 calls
 * expire(), which forgets the session on this device and returns to sign-in.
 */
import * as React from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/navigatr";
import { PortalRetry } from "./PortalRetry";
import { portalApi, type PortalBrand } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";
import type { PortalSignedInContext } from "../lib/portalSignedIn";

export function PortalSignedInLayout({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = React.useState(() => readPortalSession(slug));
  const [signingOut, setSigningOut] = React.useState(false);

  const me = useQuery({
    queryKey: ["portal", "me", slug, token],
    queryFn: () => portalApi.me(slug, token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  const forget = React.useCallback(() => {
    clearPortalSession(slug);
    // Nothing cached about this partner may outlive the session on this device.
    queryClient.removeQueries({ queryKey: ["portal", "me", slug] });
    queryClient.removeQueries({ queryKey: ["portal", "data", slug] });
    navigate(`/p/${slug}`, { replace: true });
  }, [slug, queryClient, navigate]);

  const expired = me.isSuccess && me.data === null;
  React.useEffect(() => {
    if (expired) forget();
  }, [expired, forget]);

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
    return <PortalRetry name={brand.orgName} onRetry={() => void me.refetch()} busy={me.isFetching} />;
  }

  const account = me.data;
  const context: PortalSignedInContext = { slug, token: sessionToken, brand, me: account, expire: forget };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await portalApi.signOut(sessionToken);
    } catch {
      // The session is forgotten on this device either way.
    }
    forget();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-body-sm text-text-muted">
          Signed in as {account.partnerName} at {account.orgName}
        </p>
        <Button
          variant="tertiary"
          size="md"
          leadingIcon={LogOut}
          loading={signingOut}
          onClick={() => void signOut()}
          className="shrink-0"
        >
          Sign out
        </Button>
      </div>
      <Outlet context={context} />
    </div>
  );
}
```

- [ ] **Step 5: Write the dashboard page**

Create `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`:

```tsx
/**
 * Partner dashboard (spec 5.6, FR-PORT-68..70): send a referral, see how the
 * partner's referrals are doing, open any one of them. Tiles and list share one
 * time period and refresh every 30 seconds. Value appears only when the ISO
 * allows it (the server omits it otherwise).
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { PortalRetry } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import { PORTAL_POLL_MS, isPortalUnauthorized, portalApi, portalDataKey, type PortalWindow } from "../lib/portalApi";
import { formatConversion, formatPortalDate, formatPortalMoney } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { PORTAL_WINDOWS } from "../../../../../../supabase/functions/_shared/portalSubmission";

function Tile({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex min-h-20 flex-col justify-between gap-1 rounded-radius-md border border-border-subtle bg-surface-default p-3">
      <span className="text-caption text-text-muted">{label}</span>
      <span className={cn("tabular-nums text-text-default", small ? "text-body-sm" : "text-heading-sm")}>{value}</span>
    </div>
  );
}

export function PortalDashboardPage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const navigate = useNavigate();
  const [period, setPeriod] = React.useState<PortalWindow>("all");

  const stats = useQuery({
    queryKey: portalDataKey(slug, token, "dashboard", period),
    queryFn: () => portalApi.dashboard(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const list = useQuery({
    queryKey: portalDataKey(slug, token, "list", period),
    queryFn: () => portalApi.listReferrals(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(stats.error) || isPortalUnauthorized(list.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  let content: React.ReactNode;
  if (stats.isPending || list.isPending || unauthorized) {
    content = (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  } else if (stats.isError || list.isError) {
    content = (
      <PortalRetry
        name={brand.orgName}
        busy={stats.isFetching || list.isFetching}
        onRetry={() => {
          void stats.refetch();
          void list.refetch();
        }}
      />
    );
  } else {
    const s = stats.data;
    const referrals = list.data;
    content = (
      <>
        <section aria-label="Summary" className="grid grid-cols-2 gap-2">
          <Tile label="Submitted" value={String(s.submitted)} />
          <Tile label="Active" value={String(s.active)} />
          <Tile label="Closed Won" value={String(s.closedWon)} />
          <Tile label="Conversion rate" value={formatConversion(s.conversionRate)} small={s.conversionRate === null} />
          {s.valueVisible && typeof s.totalValueCents === "number" && (
            <Tile label="Total value" value={formatPortalMoney(s.totalValueCents)} />
          )}
        </section>

        {referrals.length === 0 ? (
          <Card padding="lg">
            <p className="text-body-md text-text-muted">
              Nothing here yet. Send {brand.orgName} a business and follow it here.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-radius-md border border-border-subtle bg-surface-default">
            {referrals.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/p/${slug}/r/${r.id}`}
                  className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-body-strong text-text-default">{r.companyName}</span>
                    <span className="text-caption text-text-muted">
                      {r.ref} · Updated {formatPortalDate(r.lastActivityAt)}
                    </span>
                  </span>
                  <PortalLabelChip label={r.label} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h1 className="text-heading-lg text-text-default">Your referrals</h1>
        <Button variant="primary" size="lg" fullWidth leadingIcon={Plus} onClick={() => navigate(`/p/${slug}/new`)}>
          Send a referral
        </Button>
      </div>

      <div role="group" aria-label="Time period" className="grid grid-cols-4 gap-1 rounded-radius-md bg-surface-sunken p-1">
        {PORTAL_WINDOWS.map((w) => (
          <button
            key={w.value}
            type="button"
            aria-pressed={period === w.value}
            onClick={() => setPeriod(w.value)}
            className={cn(
              "min-h-11 rounded-radius-sm px-1 text-caption font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
              period === w.value ? "bg-surface-default text-text-default shadow-card" : "text-text-muted",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {content}
    </div>
  );
}
```

- [ ] **Step 6: Mount the layout and the dashboard in `PortalRoot`**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`:

(a) Replace

```tsx
import { PortalSignInPage } from "./PortalSignInPage";
import { PortalHomePage } from "./PortalHomePage";
import { PortalInvitePage } from "./PortalInvitePage";
```

with

```tsx
import { PortalSignInPage } from "./PortalSignInPage";
import { PortalInvitePage } from "./PortalInvitePage";
import { PortalSignedInLayout } from "../components/PortalSignedInLayout";
import { PortalDashboardPage } from "./PortalDashboardPage";
```

(b) Replace

```tsx
          <Route path="home" element={<PortalHomePage slug={slug} brand={data} />} />
```

with

```tsx
          <Route element={<PortalSignedInLayout slug={slug} brand={data} />}>
            <Route path="home" element={<PortalDashboardPage />} />
          </Route>
```

Then delete the 1A landing page: `git rm apps/app/src/features/portal/pages/PortalHomePage.tsx`.

- [ ] **Step 7: Teach the 1A portal tests about the new API methods**

In both `apps/app/src/features/portal/pages/PortalRoot.test.tsx` and `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`, replace

```tsx
const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
}));
```

with

```tsx
const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

const EMPTY_DASHBOARD = { submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false };
```

In `PortalRoot.test.tsx`, replace

```tsx
  Object.values(api).forEach((fn) => fn.mockReset());
  clearPortalSession("acme");
```

with

```tsx
  Object.values(api).forEach((fn) => fn.mockReset());
  api.dashboard.mockResolvedValue(EMPTY_DASHBOARD);
  api.listReferrals.mockResolvedValue([]);
  clearPortalSession("acme");
```

In `PortalInvitePage.test.tsx`, replace

```tsx
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
```

with

```tsx
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.dashboard.mockResolvedValue(EMPTY_DASHBOARD);
  api.listReferrals.mockResolvedValue([]);
```

- [ ] **Step 8: Run the portal tests**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS, including every 1A case in `PortalRoot.test.tsx` and `PortalInvitePage.test.tsx` (they look for `Signed in as Jane at Acme ISO` and `Sign out`, which the layout keeps).

- [ ] **Step 9: Commit**

```bash
git add -A apps/app/src/features/portal
git commit -m "$(cat <<'EOF'
feat(portal): signed-in layout and partner dashboard with tiles, periods and polling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Submit a referral page

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalSubmitPage.tsx`, `apps/app/src/features/portal/pages/PortalSubmitPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: Task 8 (`portalApi.form`, `portalApi.dupCheck`, `portalApi.submitReferral`, `PortalSubmitInput`, `PortalSubmitted`, `PortalApiError.field`, `isPortalUnauthorized`, `isPortalTransientError`, `portalDataKey`, `readPortalDraft`, `writePortalDraft`, `clearPortalDraft`, `EMPTY_DRAFT`, `usePortalSignedIn`, `usePortalDictation`), Task 5 (`validateSubmission`, `isSubmissionField`, `PORTAL_FIELD_LIMITS`, `PORTAL_INDUSTRIES`, `PORTAL_URGENCIES`, `PortalSubmissionField`), `appendDictated` from `@/hooks/useVoiceDictation`, `NotesFieldWithMic` manual mode (`onMicClick`, `micState`), 1A `portalReachMessage`.
- Produces: `PortalSubmitPage()` at `/p/:slug/new` (inside `PortalSignedInLayout`). Field labels: `Business name`, `Contact name`, `Email`, `Phone`, `Address (optional)`, `Industry (optional)`, `How soon? (optional)`, `Notes (optional)`; consent checkbox labelled with the ISO's consent text; submit button `Send referral`; confirmation heading `Referral sent` with buttons `View this referral`, `Send another`, `Back to your referrals`. Duplicate warning (role `status`): `This business may already be in progress with {orgName}. You can still send it.`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalSubmitPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

const dictation = vi.hoisted(() => ({ onResult: null as null | ((text: string) => void), toggle: vi.fn() }));
vi.mock("../hooks/usePortalDictation", () => ({
  usePortalDictation: (opts: { onResult: (text: string) => void }) => {
    dictation.onResult = opts.onResult;
    return { micState: "rest", toggle: dictation.toggle };
  },
}));

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const FORM = { consentText: "I may share these details.", consentVersion: 3 };
const DUP = "This business may already be in progress with Acme ISO. You can still send it.";

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

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

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Business name"), "Fresh Bakery");
  await user.type(screen.getByLabelText("Contact name"), "Ann");
  await user.type(screen.getByLabelText("Email"), "ann@fresh.example");
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  dictation.onResult = null;
  dictation.toggle.mockReset();
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.form.mockResolvedValue(FORM);
  api.dupCheck.mockResolvedValue(false);
  api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
  api.listReferrals.mockResolvedValue([]);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalSubmitPage", () => {
  it("opens from the dashboard's Send a referral button", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("button", { name: "Send a referral" }));
    expect(await screen.findByRole("heading", { name: "Send a referral" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "I may share these details." })).toBeInTheDocument();
    expect(api.form).toHaveBeenCalledWith("acme", "live");
  });

  it("sends a referral and confirms it with a reference", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.type(screen.getByLabelText("Address (optional)"), "5 Oak St");
    await user.selectOptions(screen.getByLabelText("Industry (optional)"), "restaurant");
    await user.selectOptions(screen.getByLabelText("How soon? (optional)"), "this_week");
    await user.type(screen.getByLabelText("Notes (optional)"), "Wants a demo");
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));

    expect(api.submitReferral).toHaveBeenCalledWith("acme", "live", {
      companyName: "Fresh Bakery",
      contactName: "Ann",
      email: "ann@fresh.example",
      phone: "",
      address: "5 Oak St",
      industry: "restaurant",
      urgency: "this_week",
      notes: "Wants a demo",
      consent: true,
      consentVersion: 3,
    });
    expect(await screen.findByRole("heading", { name: "Referral sent" })).toBeInTheDocument();
    expect(screen.getByText("Acme ISO has Fresh Bakery. Your reference is REF-AAAA0009.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View this referral" })).toBeInTheDocument();
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Send another" }));
    expect(await screen.findByLabelText("Business name")).toHaveValue("");
  });

  it("points at the first problem before sending anything", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/new");
    await screen.findByRole("checkbox", { name: "I may share these details." });
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add the business name.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Business name"), "Fresh Bakery");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add an email or a phone number.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Phone"), "555 010 0100");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Check the box to confirm you have permission.")).toBeInTheDocument();
    expect(api.submitReferral).not.toHaveBeenCalled();
  });

  it("restores and keeps a draft per portal", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "navigatr-portal-draft:acme",
      JSON.stringify({ companyName: "Saved Co", contactName: "Sam", notes: "From last time" }),
    );
    renderAt("/p/acme/new");
    expect(await screen.findByLabelText("Business name")).toHaveValue("Saved Co");
    expect(screen.getByLabelText("Contact name")).toHaveValue("Sam");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("From last time");
    await user.type(screen.getByLabelText("Phone"), "5550100100");
    expect(JSON.parse(window.localStorage.getItem("navigatr-portal-draft:acme") ?? "{}")).toMatchObject({
      companyName: "Saved Co",
      phone: "5550100100",
    });
  });

  it("warns softly about a probable duplicate and still lets the partner send", async () => {
    const user = userEvent.setup();
    api.dupCheck.mockResolvedValue(true);
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Corner Cafe");
    await new Promise((r) => setTimeout(r, 700));
    expect(api.dupCheck).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Phone"), "555 010 0001");
    expect(await screen.findByText(DUP, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(api.dupCheck).toHaveBeenLastCalledWith("acme", "live", {
      companyName: "Corner Cafe",
      phone: "555 010 0001",
      address: "",
    });
    expect(screen.getByRole("button", { name: "Send referral" })).toBeEnabled();
  });

  it("asks again when the consent wording changed", async () => {
    const user = userEvent.setup();
    api.form.mockResolvedValueOnce(FORM).mockResolvedValue({ consentText: "New wording.", consentVersion: 4 });
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The permission wording was just updated. Read it and check the box again.")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "New wording." })).not.toBeChecked();
  });

  it.each([
    [new PortalApiError(429, "rate_limited"), "Too many requests. Try again later."],
    [new PortalApiError(400, "invalid_body", "notes"), "Shorten the notes."],
    [new PortalApiError(0, "network_error"), "We couldn't reach Acme ISO. Check your connection and try again."],
  ])("explains a failed send (%s)", async (error, message) => {
    const user = userEvent.setup();
    api.submitReferral.mockRejectedValueOnce(error);
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toHaveValue("Fresh Bakery");
  });

  it("appends dictated text to the notes", async () => {
    window.localStorage.setItem("navigatr-portal-draft:acme", JSON.stringify({ notes: "Owner is Sam." }));
    renderAt("/p/acme/new");
    await screen.findByLabelText("Notes (optional)");
    act(() => dictation.onResult?.("Call after 3pm."));
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Owner is Sam. Call after 3pm.");
  });

  it("returns to sign-in when the session is gone", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockRejectedValueOnce(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/new");
    await fillRequired(user);
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalSubmitPage.test.tsx`
Expected: FAIL; `/p/acme/new` falls through to the catch-all route, so `Business name` is never found.

- [ ] **Step 3: Write the page**

Create `apps/app/src/features/portal/pages/PortalSubmitPage.tsx`:

```tsx
/**
 * Send a referral (spec 5.5, FR-PORT-35..43). Built for a phone: one column,
 * native pickers, big targets. The draft saves on every change and clears on a
 * successful send. Consent uses the ISO's wording and version from the server
 * (brief D4). While typing, a soft duplicate check may say the business could
 * already be in progress; it never says with whom, and it never blocks (brief
 * D3). Notes can be dictated through portal_api (brief D6). Address is plain
 * text in this phase (brief D7).
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, NotesFieldWithMic } from "@/components/navigatr";
import { appendDictated } from "@/hooks/useVoiceDictation";
import { portalReachMessage } from "../components/PortalRetry";
import { usePortalDictation } from "../hooks/usePortalDictation";
import {
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalSubmitInput,
  type PortalSubmitted,
} from "../lib/portalApi";
import { EMPTY_DRAFT, clearPortalDraft, readPortalDraft, writePortalDraft, type PortalDraft } from "../lib/portalDraft";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import {
  PORTAL_FIELD_LIMITS,
  PORTAL_INDUSTRIES,
  PORTAL_URGENCIES,
  isSubmissionField,
  validateSubmission,
  type PortalSubmissionField,
} from "../../../../../../supabase/functions/_shared/portalSubmission";

const FIELD_MESSAGES: Record<PortalSubmissionField, string> = {
  companyName: "Add the business name.",
  contactName: "Add a contact name.",
  email: "Check the email address.",
  phone: "Check the phone number.",
  emailOrPhone: "Add an email or a phone number.",
  address: "Shorten the address.",
  industry: "Pick an industry from the list.",
  urgency: "Pick a timing from the list.",
  notes: "Shorten the notes.",
  consent: "Check the box to confirm you have permission.",
};

const TOO_MANY = "Too many requests. Try again later.";
const CONSENT_CHANGED = "The permission wording was just updated. Read it and check the box again.";

const SELECT_CLASS =
  "h-11 w-full rounded-radius-md border border-border-default bg-surface-default px-3 text-body-md text-text-default " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function PortalSubmitPage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<PortalDraft>(() => readPortalDraft(slug));
  const [consent, setConsent] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<PortalSubmissionField | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<(PortalSubmitted & { companyName: string }) | null>(null);

  React.useEffect(() => {
    writePortalDraft(slug, draft);
  }, [slug, draft]);

  const update = (key: keyof PortalDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const form = useQuery({
    queryKey: portalDataKey(slug, token, "form"),
    queryFn: () => portalApi.form(slug, token),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // Soft duplicate check: after a company plus a phone or an email, debounced.
  const name = draft.companyName.trim();
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  const address = draft.address.trim();
  const ready = name !== "" && (phone !== "" || email !== "");
  const dupKey = useDebouncedValue(ready ? JSON.stringify([name, phone, address]) : "", 500);
  const dup = useQuery({
    queryKey: portalDataKey(slug, token, "dup", dupKey),
    queryFn: () => {
      const [n, p, a] = JSON.parse(dupKey) as [string, string, string];
      return portalApi.dupCheck(slug, token, { companyName: n, phone: p, address: a });
    },
    enabled: dupKey !== "" && sent === null,
    retry: false,
    staleTime: 60_000,
  });
  const showDup = ready && dup.data === true;

  const unauthorized = isPortalUnauthorized(form.error) || isPortalUnauthorized(dup.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  const dictation = usePortalDictation({
    slug,
    token,
    onResult: (text) => setDraft((d) => ({ ...d, notes: appendDictated(d.notes, text) })),
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.data || busy) return;
    const input: PortalSubmitInput = { ...draft, consent, consentVersion: form.data.consentVersion };
    const check = validateSubmission(input);
    if (!check.ok) {
      setFieldError(check.field);
      setNotice(null);
      return;
    }
    setBusy(true);
    setFieldError(null);
    setNotice(null);
    try {
      const res = await portalApi.submitReferral(slug, token, input);
      clearPortalDraft(slug);
      setDraft({ ...EMPTY_DRAFT });
      setConsent(false);
      setSent({ ...res, companyName: check.value.companyName });
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token, "dashboard") });
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token, "list") });
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "consent_changed") {
        setConsent(false);
        setNotice(CONSENT_CHANGED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.status === 400 && isSubmissionField(err.field)) {
        setFieldError(err.field);
      } else if (err instanceof PortalApiError && err.status === 429) {
        setNotice(TOO_MANY);
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't send that. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Referral sent</h1>
          <p className="text-body-md text-text-default">
            {brand.orgName} has {sent.companyName}. Your reference is {sent.ref}.
          </p>
        </div>
        <Button variant="primary" size="lg" fullWidth onClick={() => navigate(`/p/${slug}/r/${sent.id}`)}>
          View this referral
        </Button>
        <Button variant="secondary" size="lg" fullWidth onClick={() => setSent(null)}>
          Send another
        </Button>
        <Button variant="tertiary" size="md" onClick={() => navigate(`/p/${slug}/home`)}>
          Back to your referrals
        </Button>
      </Card>
    );
  }

  const errorFor = (...fields: PortalSubmissionField[]): string | undefined =>
    fieldError !== null && fields.includes(fieldError) ? FIELD_MESSAGES[fieldError] : undefined;

  let consentBlock: React.ReactNode;
  if (form.isPending) {
    consentBlock = <Loader2 className="h-5 w-5 animate-spin text-text-subtle" aria-label="Loading" />;
  } else if (form.isError || !form.data) {
    consentBlock = (
      <div className="flex flex-col gap-2">
        <p className="text-body-sm text-status-danger">{portalReachMessage(brand.orgName)}</p>
        <Button type="button" variant="secondary" size="md" onClick={() => void form.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    consentBlock = (
      <Checkbox id="portal-consent" checked={consent} onCheckedChange={setConsent} label={form.data.consentText} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={`/p/${slug}/home`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to your referrals
      </Link>
      <Card padding="lg">
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Send a referral</h1>
            <p className="text-body-md text-text-muted">Tell {brand.orgName} about a business they can help.</p>
          </div>

          <FormField label="Business name" htmlFor="portal-company" error={errorFor("companyName")}>
            <Input
              id="portal-company"
              autoComplete="organization"
              maxLength={PORTAL_FIELD_LIMITS.companyName}
              value={draft.companyName}
              onChange={(e) => update("companyName")(e.target.value)}
            />
          </FormField>

          <FormField label="Contact name" htmlFor="portal-contact" error={errorFor("contactName")}>
            <Input
              id="portal-contact"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.contactName}
              value={draft.contactName}
              onChange={(e) => update("contactName")(e.target.value)}
            />
          </FormField>

          <FormField label="Email" htmlFor="portal-email-field" error={errorFor("email")}>
            <Input
              id="portal-email-field"
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.email}
              value={draft.email}
              onChange={(e) => update("email")(e.target.value)}
            />
          </FormField>

          <FormField
            label="Phone"
            htmlFor="portal-phone"
            helper="Add an email, a phone number, or both."
            error={errorFor("phone", "emailOrPhone")}
          >
            <Input
              id="portal-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.phone}
              value={draft.phone}
              onChange={(e) => update("phone")(e.target.value)}
            />
          </FormField>

          {showDup && (
            <p role="status" className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              This business may already be in progress with {brand.orgName}. You can still send it.
            </p>
          )}

          <FormField label="Address (optional)" htmlFor="portal-address" error={errorFor("address")}>
            <Input
              id="portal-address"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.address}
              value={draft.address}
              onChange={(e) => update("address")(e.target.value)}
            />
          </FormField>

          <FormField label="Industry (optional)" htmlFor="portal-industry" error={errorFor("industry")}>
            <select
              id="portal-industry"
              className={SELECT_CLASS}
              value={draft.industry}
              onChange={(e) => update("industry")(e.target.value)}
            >
              <option value="">Choose one</option>
              {PORTAL_INDUSTRIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="How soon? (optional)" htmlFor="portal-urgency" error={errorFor("urgency")}>
            <select
              id="portal-urgency"
              className={SELECT_CLASS}
              value={draft.urgency}
              onChange={(e) => update("urgency")(e.target.value)}
            >
              <option value="">Choose one</option>
              {PORTAL_URGENCIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Notes (optional)" htmlFor="portal-notes" error={errorFor("notes")}>
            <NotesFieldWithMic
              id="portal-notes"
              value={draft.notes}
              onChange={update("notes")}
              placeholder="Anything that will help, like the best time to call."
              maxLength={PORTAL_FIELD_LIMITS.notes}
              rows={4}
              onMicClick={dictation.toggle}
              micState={dictation.micState}
            />
          </FormField>

          <div className="flex flex-col gap-1">
            {consentBlock}
            {fieldError === "consent" && (
              <p role="alert" className="text-caption text-status-danger">
                {FIELD_MESSAGES.consent}
              </p>
            )}
          </div>

          {notice && (
            <p role="alert" className="text-body-sm text-status-danger">
              {notice}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy || !form.data}>
            Send referral
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`:

(a) Replace

```tsx
import { PortalDashboardPage } from "./PortalDashboardPage";
```

with

```tsx
import { PortalDashboardPage } from "./PortalDashboardPage";
import { PortalSubmitPage } from "./PortalSubmitPage";
```

(b) Replace

```tsx
            <Route path="home" element={<PortalDashboardPage />} />
```

with

```tsx
            <Route path="home" element={<PortalDashboardPage />} />
            <Route path="new" element={<PortalSubmitPage />} />
```

- [ ] **Step 5: Run the portal tests**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalSubmitPage.tsx apps/app/src/features/portal/pages/PortalSubmitPage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx
git commit -m "$(cat <<'EOF'
feat(portal): partner referral form with consent, draft, duplicate warning and dictation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Referral detail page with withdraw

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalReferralPage.tsx`, `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: Task 8 (`portalApi.getReferral`, `portalApi.withdrawReferral`, `PortalReferralDetail`, `PORTAL_POLL_MS`, `portalDataKey`, `isPortalUnauthorized`, `isPortalTransientError`, `formatPortalDate`, `usePortalSignedIn`), Task 9 (`PortalLabelChip`), Task 5 (`industryLabel`, `urgencyLabel`), 1A (`PortalRetry`, `portalReachMessage`).
- Produces: `PortalReferralPage()` at `/p/:slug/r/:referralId` (inside `PortalSignedInLayout`). Sections: header (company, label chip, `{ref} · Sent {date}`), `Your contact at {orgName}`, `Progress` (labels with dates), `What you sent`; `Withdraw this referral` while `canWithdraw`, confirmed with `Yes, withdraw it` or `Keep it`. Not found: heading `We couldn't find that referral`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const DETAIL = {
  id: "r-1",
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  contactName: "Ann",
  contactEmail: "ann@fresh.example",
  contactPhone: "5550100100",
  address: "5 Oak St",
  industry: "restaurant",
  urgency: "this_week",
  notes: "Wants a demo",
  label: "Received",
  submittedAt: "2026-10-01T12:00:00Z",
  canWithdraw: true,
  rep: { name: "Rita Rep", email: "rita@acme.example" },
  history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
};
const ROW = {
  id: "r-1",
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  label: "Received",
  submittedAt: "2026-10-01T12:00:00Z",
  lastActivityAt: "2026-10-01T12:00:00Z",
};

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function renderAt(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.getReferral.mockResolvedValue(DETAIL);
  api.dashboard.mockResolvedValue({ submitted: 1, active: 1, closedWon: 0, conversionRate: null, valueVisible: false });
  api.listReferrals.mockResolvedValue([ROW]);
  api.form.mockResolvedValue({ consentText: "I may share these details.", consentVersion: 3 });
  api.dupCheck.mockResolvedValue(false);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalReferralPage", () => {
  it("shows the label, the rep, the history and what the partner sent", async () => {
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByRole("heading", { name: "Fresh Bakery" })).toBeInTheDocument();
    expect(api.getReferral).toHaveBeenCalledWith("acme", "live", "r-1");
    expect(screen.getByText("REF-AAAA0001 · Sent Oct 1, 2026")).toBeInTheDocument();

    const contact = screen.getByRole("heading", { name: "Your contact at Acme ISO" }).parentElement as HTMLElement;
    expect(within(contact).getByText("Rita Rep")).toBeInTheDocument();
    expect(within(contact).getByRole("link", { name: /rita@acme\.example/ })).toHaveAttribute("href", "mailto:rita@acme.example");

    const progress = screen.getByRole("heading", { name: "Progress" }).parentElement as HTMLElement;
    expect(within(progress).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["ReceivedOct 1, 2026"]);

    const sent = screen.getByRole("heading", { name: "What you sent" }).parentElement as HTMLElement;
    expect(within(sent).getByText("Ann")).toBeInTheDocument();
    expect(within(sent).getByText("Restaurant")).toBeInTheDocument();
    expect(within(sent).getByText("This week")).toBeInTheDocument();
    expect(within(sent).getByText("Wants a demo")).toBeInTheDocument();
  });

  it("opens from a row on the dashboard", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("link", { name: /Fresh Bakery/ }));
    expect(await screen.findByRole("heading", { name: "Fresh Bakery" })).toBeInTheDocument();
  });

  it("opens from the confirmation after sending", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    api.getReferral.mockResolvedValue({ ...DETAIL, id: "r-9", ref: "REF-AAAA0009" });
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Fresh Bakery");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.type(screen.getByLabelText("Phone"), "5550100100");
    await user.click(await screen.findByRole("checkbox", { name: "I may share these details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await user.click(await screen.findByRole("button", { name: "View this referral" }));
    expect(await screen.findByText("REF-AAAA0009 · Sent Oct 1, 2026")).toBeInTheDocument();
    expect(api.getReferral).toHaveBeenLastCalledWith("acme", "live", "r-9");
  });

  it("withdraws while Received, after a confirmation", async () => {
    const user = userEvent.setup();
    api.withdrawReferral.mockResolvedValue(undefined);
    api.getReferral.mockResolvedValueOnce(DETAIL).mockResolvedValue({
      ...DETAIL,
      label: "Withdrawn",
      canWithdraw: false,
      history: [...DETAIL.history, { label: "Withdrawn", at: "2026-10-02T12:00:00Z" }],
    });
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    expect(screen.getByText("Withdraw Fresh Bakery? Acme ISO will not follow up on it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.withdrawReferral).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Withdraw this referral" }));
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    expect(api.withdrawReferral).toHaveBeenCalledWith("acme", "live", "r-1");
    // The chip and the new history step.
    expect(await screen.findAllByText("Withdrawn")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Withdraw this referral" })).toBeNull();
  });

  it("explains when it is too late to withdraw", async () => {
    const user = userEvent.setup();
    api.withdrawReferral.mockRejectedValue(new PortalApiError(409, "not_withdrawable"));
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This referral is already being worked on, so it can no longer be pulled back.",
    );
  });

  it("hides withdraw once the ISO has picked it up, and says who will follow up when nobody is assigned", async () => {
    api.getReferral.mockResolvedValue({ ...DETAIL, label: "Accepted", canWithdraw: false, rep: null });
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByText("Someone at Acme ISO will pick this up soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw this referral" })).toBeNull();
  });

  it("shows a plain not-found for a referral that is not the partner's", async () => {
    api.getReferral.mockResolvedValue(null);
    renderAt("/p/acme/r/someone-elses");
    expect(await screen.findByRole("heading", { name: "We couldn't find that referral" })).toBeInTheDocument();
  });

  it("polls every 30 seconds", async () => {
    const client = renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    const query = client.getQueryCache().find({ queryKey: ["portal", "data", "acme", "live", "referral", "r-1"], exact: true });
    expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getReferral.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalReferralPage.test.tsx`
Expected: FAIL; `/p/acme/r/r-1` falls through to the catch-all route.

- [ ] **Step 3: Write the page**

Create `apps/app/src/features/portal/pages/PortalReferralPage.tsx`:

```tsx
/**
 * One referral as the partner sees it (spec 5.6, FR-PORT-72): what they sent,
 * the current label, the label history with dates, and who at the ISO has it
 * (name and business email). While it is still Received the partner can
 * withdraw it (FR-PORT-42). Published updates arrive in Phase 1C. Refreshes
 * every 30 seconds.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Mail } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import {
  PORTAL_POLL_MS,
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
} from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { industryLabel, urgencyLabel } from "../../../../../../supabase/functions/_shared/portalSubmission";

const NOT_WITHDRAWABLE = "This referral is already being worked on, so it can no longer be pulled back.";

export function PortalReferralPage() {
  const { referralId = "" } = useParams<{ referralId: string }>();
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: portalDataKey(slug, token, "referral", referralId),
    queryFn: () => portalApi.getReferral(slug, token, referralId),
    refetchInterval: PORTAL_POLL_MS,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(q.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  const back = (
    <Link
      to={`/p/${slug}/home`}
      className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Back to your referrals
    </Link>
  );

  if (q.isPending || unauthorized) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <PortalRetry name={brand.orgName} onRetry={() => void q.refetch()} busy={q.isFetching} />
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card padding="lg" className="flex flex-col gap-2">
          <h1 className="text-heading-lg text-text-default">We couldn&apos;t find that referral</h1>
          <p className="text-body-md text-text-muted">Check the link, or open it from your list.</p>
        </Card>
      </div>
    );
  }

  const r = q.data;

  const withdraw = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await portalApi.withdrawReferral(slug, token, r.id);
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "not_withdrawable") setNotice(NOT_WITHDRAWABLE);
      else if (isPortalTransientError(err)) setNotice(portalReachMessage(brand.orgName));
      else setNotice("We couldn't do that. Try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token) });
    }
  };

  const details: Array<[string, string | null]> = [
    ["Contact", r.contactName],
    ["Email", r.contactEmail],
    ["Phone", r.contactPhone],
    ["Address", r.address],
    ["Industry", industryLabel(r.industry)],
    ["How soon", urgencyLabel(r.urgency)],
  ];
  const shown = details.filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-4">
      {back}

      <Card padding="lg" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-heading-lg text-text-default">{r.companyName}</h1>
          <PortalLabelChip label={r.label} />
        </div>
        <p className="text-caption text-text-muted">
          {r.ref} · Sent {formatPortalDate(r.submittedAt)}
        </p>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Your contact at {brand.orgName}</h2>
          {r.rep ? (
            <div className="flex flex-col gap-1">
              {r.rep.name && <span className="text-body-md text-text-default">{r.rep.name}</span>}
              {r.rep.email && (
                <a
                  href={`mailto:${r.rep.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all text-body-md text-brand-primary"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  {r.rep.email}
                </a>
              )}
            </div>
          ) : (
            <p className="text-body-md text-text-muted">Someone at {brand.orgName} will pick this up soon.</p>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Progress</h2>
          <ol className="flex flex-col gap-2">
            {r.history.map((h, i) => (
              <li key={`${h.label}-${h.at}-${i}`} className="flex items-center justify-between gap-3">
                <span className="text-body-md text-text-default">{h.label}</span>
                <time dateTime={h.at} className="text-caption text-text-muted">
                  {formatPortalDate(h.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      </Card>

      {(shown.length > 0 || r.notes) && (
        <Card padding="lg">
          <section className="flex flex-col gap-2">
            <h2 className="text-body-strong text-text-default">What you sent</h2>
            {shown.length > 0 && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                {shown.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-caption text-text-subtle">{k}</dt>
                    <dd className="break-words text-body-md text-text-default">{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            {r.notes && <p className="whitespace-pre-wrap text-body-md text-text-muted">{r.notes}</p>}
          </section>
        </Card>
      )}

      {notice && (
        <p role="alert" className="text-body-sm text-status-danger">
          {notice}
        </p>
      )}

      {r.canWithdraw &&
        (confirming ? (
          <Card padding="lg" className="flex flex-col gap-3">
            <p className="text-body-md text-text-default">
              Withdraw {r.companyName}? {brand.orgName} will not follow up on it.
            </p>
            <Button
              variant="destructive"
              size="lg"
              fullWidth
              loading={busy}
              disabled={busy}
              onClick={() => void withdraw()}
            >
              Yes, withdraw it
            </Button>
            <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </Card>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => {
              setNotice(null);
              setConfirming(true);
            }}
          >
            Withdraw this referral
          </Button>
        ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`:

(a) Replace

```tsx
import { PortalSubmitPage } from "./PortalSubmitPage";
```

with

```tsx
import { PortalSubmitPage } from "./PortalSubmitPage";
import { PortalReferralPage } from "./PortalReferralPage";
```

(b) Replace

```tsx
            <Route path="new" element={<PortalSubmitPage />} />
```

with

```tsx
            <Route path="new" element={<PortalSubmitPage />} />
            <Route path="r/:referralId" element={<PortalReferralPage />} />
```

- [ ] **Step 5: Run the portal tests**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalReferralPage.tsx apps/app/src/features/portal/pages/PortalReferralPage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx
git commit -m "$(cat <<'EOF'
feat(portal): referral detail with history, rep contact and withdraw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Keep the invite token across a reload of the terms screen

1A tracker item (brief scope 8b).

**Files:**
- Modify: `apps/app/src/features/portal/pages/PortalInvitePage.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`

**Interfaces:**
- Consumes: Task 8 `readInviteToken`, `writeInviteToken`, `clearInviteToken` (sessionStorage key `navigatr-portal-invite:<slug>`).
- Produces: `PortalInvitePage` behavior: a token in the URL is copied to sessionStorage for this slug (and still removed from the address bar); with no token in the URL the stored one is used; a successful accept clears it.

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/features/portal/pages/PortalInvitePage.test.tsx`:

(a) Replace

```tsx
beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.dashboard.mockResolvedValue(EMPTY_DASHBOARD);
  api.listReferrals.mockResolvedValue([]);
  clearPortalSession("acme");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});
```

with

```tsx
// sessionStorage gets the same per-test in-memory shim as localStorage.
const origSessionStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.dashboard.mockResolvedValue(EMPTY_DASHBOARD);
  api.listReferrals.mockResolvedValue([]);
  clearPortalSession("acme");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: origSessionStorage, writable: true, configurable: true });
});
```

(b) Append inside the `describe("PortalInvitePage", ...)` block, before its closing `});`:

```tsx
  it("keeps the invite when the terms screen is reloaded", async () => {
    api.peekInvite.mockResolvedValue(INVITE);
    const first = renderAt("/p/acme/invite?token=tok-reload");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("navigatr-portal-invite:acme")).toBe("tok-reload");
    first.unmount();

    // A reload lands on the cleaned address, with no token in it.
    renderAt("/p/acme/invite");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenLastCalledWith("acme", "tok-reload");
  });

  it("forgets the pending invite once it is accepted", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });
    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: "I agree to these terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("navigatr-portal-invite:acme")).toBeNull();
  });

  it("never uses another portal's pending invite", async () => {
    window.sessionStorage.setItem("navigatr-portal-invite:other", "tok-other");
    renderAt("/p/acme/invite");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(api.peekInvite).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalInvitePage.test.tsx`
Expected: FAIL in `keeps the invite when the terms screen is reloaded` (the stored token is `null`).

- [ ] **Step 3: Persist the token in the page**

In `apps/app/src/features/portal/pages/PortalInvitePage.tsx`:

(a) Replace

```tsx
import { writePortalSession } from "../lib/portalSession";
```

with

```tsx
import { writePortalSession } from "../lib/portalSession";
import { clearInviteToken, readInviteToken, writeInviteToken } from "../lib/portalInviteToken";
```

(b) Replace

```tsx
  // Copy the token out of the URL once, then drop it from the address bar and
  // history so it cannot linger, be shared, or reach telemetry.
  const [token] = React.useState(() => (params.get("token") ?? "").trim());
```

with

```tsx
  // Copy the token out of the URL once, then drop it from the address bar and
  // history so it cannot linger, be shared, or reach telemetry. It is also kept
  // in this tab's sessionStorage for this portal only, so reloading the terms
  // screen does not lose it; accepting clears it.
  const [token] = React.useState(() => {
    const fromUrl = (params.get("token") ?? "").trim();
    if (fromUrl) {
      writeInviteToken(slug, fromUrl);
      return fromUrl;
    }
    return readInviteToken(slug) ?? "";
  });
```

(c) Replace

```tsx
      writePortalSession(slug, session.sessionToken);
      navigate(`/p/${slug}/home`, { replace: true });
```

with

```tsx
      writePortalSession(slug, session.sessionToken);
      clearInviteToken(slug);
      navigate(`/p/${slug}/home`, { replace: true });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalInvitePage.test.tsx`
Expected: PASS (all 1A cases plus the three new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalInvitePage.tsx apps/app/src/features/portal/pages/PortalInvitePage.test.tsx
git commit -m "$(cat <<'EOF'
fix(portal): keep the invite token across a reload of the terms screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Rep review sheet shows portal and duplicate cues; accept-anyway needs a reason

**Files:**
- Modify: `apps/app/src/features/partners/hooks/useReferralQueue.ts`, `apps/app/src/features/partners/hooks/useReferralQueue.test.tsx`
- Modify: `apps/app/src/features/partners/hooks/useReferralMutations.ts`, `apps/app/src/features/partners/hooks/useReferralMutations.test.tsx`
- Modify: `apps/app/src/features/partners/lib/referrals.ts`
- Modify: `apps/app/src/features/partners/components/ReviewReferralSheet.tsx`, `apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx`

**Interfaces:**
- Consumes: Task 4 `accept_referral_override(p_referral_id uuid, p_override_reason text) returns jsonb`; `referrals.source`, `duplicate_of_referral_id`, `duplicate_of_deal_id` (readable by `authenticated` through the Phase 0 table grant and RLS).
- Produces:
  - `QueueReferral` gains optional `source?: "rep_entered" | "portal_signed_in"`, `duplicateOfReferralId?: string | null`, `duplicateOfDealId?: string | null` (always set by `useReferralQueue`; optional so existing fixtures compile).
  - `type AcceptInput = string | { referralId: string; overrideReason: string }`; `useAcceptReferral().mutateAsync(input: AcceptInput): Promise<AcceptResult>` calls `accept_referral` for a string and `accept_referral_override` (reason trimmed) for the object.
  - `referralErrorMessage` maps `override_reason_required` to `Add a short reason to accept a possible duplicate.`
  - `ReviewReferralSheet`: `Sent through the partner portal` when `source === "portal_signed_in"`; when flagged, the warning `Possible duplicate of an earlier referral.`, Decline reason preselected to `duplicate`, and Accept opens an `Accept anyway` step that needs a reason.

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/features/partners/hooks/useReferralQueue.test.tsx`, replace

```tsx
      address: "5 Oak St", placeId: null, notes: "Wants a demo",
      submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
    }]);
  });
```

with

```tsx
      address: "5 Oak St", placeId: null, notes: "Wants a demo",
      submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
      source: "rep_entered", duplicateOfReferralId: null, duplicateOfDealId: null,
    }]);
  });

  it("carries the portal source and the duplicate flags", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-3", partner_id: "p-1", company_name: "Corner Cafe", contact_name: "Ann",
        contact_email: null, contact_phone: "5550100001", address: null, place_id: null,
        notes: "", submitted_at: "2026-10-12T12:00:00Z", assigned_user_id: "user-1",
        source: "portal_signed_in", duplicate_of_referral_id: "r-1", duplicate_of_deal_id: "d-1",
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(selectMock.mock.calls[0][0]).toContain("source, duplicate_of_referral_id, duplicate_of_deal_id");
    expect(result.current.data?.[0]).toMatchObject({
      source: "portal_signed_in", duplicateOfReferralId: "r-1", duplicateOfDealId: "d-1",
    });
  });
```

In `apps/app/src/features/partners/hooks/useReferralMutations.test.tsx`, replace

```tsx
  it("maps errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_submitted" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral was already handled.");
  });
});
```

with

```tsx
  it("maps errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_submitted" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral was already handled.");
  });

  it("accepts a flagged referral with a written reason through accept_referral_override", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "accepted", deal_id: "d-2" }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(
      result.current.mutateAsync({ referralId: "r-1", overrideReason: "  Different location " }),
    ).resolves.toEqual({ result: "accepted", dealId: "d-2" });
    expect(rpcMock).toHaveBeenCalledWith("accept_referral_override", {
      p_referral_id: "r-1",
      p_override_reason: "Different location",
    });
  });

  it("explains a missing override reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "override_reason_required" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("Add a short reason to accept a possible duplicate.");
  });
});
```

In `apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx`, replace

```tsx
  it("lists only open deals sorted by company name", async () => {
```

with

```tsx
  it("says when a referral came through the partner portal", () => {
    render(<ReviewReferralSheet referral={{ ...referral, source: "portal_signed_in" }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Sent through the partner portal")).toBeInTheDocument();
  });

  it("shows no portal or duplicate cue for a rep-logged referral", () => {
    render(<ReviewReferralSheet referral={{ ...referral, source: "rep_entered" }} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Sent through the partner portal")).toBeNull();
    expect(screen.queryByText(/Possible duplicate of an earlier referral/)).toBeNull();
  });

  it("flags a probable duplicate and preselects Decline (duplicate)", async () => {
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Possible duplicate of an earlier referral/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByLabelText("Pick a reason…")).toHaveValue("duplicate");
    expect(screen.getByRole("button", { name: "Decline referral" })).toBeEnabled();
  });

  it("needs a written reason to accept a flagged referral", async () => {
    accept.mockResolvedValueOnce({ result: "accepted", dealId: "d-9" });
    const onOpenChange = vi.fn();
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).not.toHaveBeenCalled();
    const go = screen.getByRole("button", { name: "Accept anyway" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Why accept it anyway?"), "Different location");
    await userEvent.click(go);
    expect(accept).toHaveBeenCalledWith({ referralId: "r-1", overrideReason: "Different location" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("still lets the rep merge a flagged referral", async () => {
    merge.mockResolvedValueOnce(undefined);
    render(<ReviewReferralSheet referral={flagged} open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a deal…"), "d-1");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(merge).toHaveBeenCalledWith({ referralId: "r-1", dealId: "d-1" });
  });

  it("lists only open deals sorted by company name", async () => {
```

and, in the same file, replace

```tsx
function renderSheet(onOpenChange = vi.fn()) {
```

with

```tsx
const flagged: QueueReferral = {
  ...referral,
  source: "portal_signed_in",
  duplicateOfReferralId: null,
  duplicateOfDealId: "d-1",
};

function renderSheet(onOpenChange = vi.fn()) {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralQueue.test.tsx src/features/partners/hooks/useReferralMutations.test.tsx src/features/partners/components/ReviewReferralSheet.test.tsx`
Expected: FAIL; the queue does not map `source`, `accept_referral_override` is never called, and the sheet shows no portal cue.

- [ ] **Step 3: Read the new columns in the queue**

In `apps/app/src/features/partners/hooks/useReferralQueue.ts`:

(a) Replace

```ts
  submittedAt: string;
  assignedUserId: string | null;
}

interface QueueRow {
```

with

```ts
  submittedAt: string;
  assignedUserId: string | null;
  /** How it arrived: "portal_signed_in" means the partner sent it through the portal. */
  source?: "rep_entered" | "portal_signed_in";
  /** Set when the portal flagged a probable duplicate (FR-PORT-46..49). */
  duplicateOfReferralId?: string | null;
  duplicateOfDealId?: string | null;
}

interface QueueRow {
```

(b) Replace

```ts
  partner_company_snapshot: string | null;
  partner: { name: string; company: string } | null;
}
```

with

```ts
  partner_company_snapshot: string | null;
  source?: "rep_entered" | "portal_signed_in";
  duplicate_of_referral_id?: string | null;
  duplicate_of_deal_id?: string | null;
  partner: { name: string; company: string } | null;
}
```

(c) Replace

```ts
            "address, place_id, notes, submitted_at, assigned_user_id, partner_company_snapshot, " +
            "partner:partners(name, company)",
```

with

```ts
            "address, place_id, notes, submitted_at, assigned_user_id, partner_company_snapshot, " +
            "source, duplicate_of_referral_id, duplicate_of_deal_id, " +
            "partner:partners(name, company)",
```

(d) Replace

```ts
        submittedAt: r.submitted_at,
        assignedUserId: r.assigned_user_id,
      }));
```

with

```ts
        submittedAt: r.submitted_at,
        assignedUserId: r.assigned_user_id,
        source: r.source ?? "rep_entered",
        duplicateOfReferralId: r.duplicate_of_referral_id ?? null,
        duplicateOfDealId: r.duplicate_of_deal_id ?? null,
      }));
```

- [ ] **Step 4: Accept with an override reason**

In `apps/app/src/features/partners/hooks/useReferralMutations.ts`:

(a) Replace

```ts
export type AcceptResult =
  | { result: "accepted"; dealId: string }
  | { result: "duplicate"; dealId: string | null };
```

with

```ts
export type AcceptResult =
  | { result: "accepted"; dealId: string }
  | { result: "duplicate"; dealId: string | null };

/** A referral id, or, for a flagged probable duplicate, the id plus the rep's written reason (FR-PORT-47). */
export type AcceptInput = string | { referralId: string; overrideReason: string };
```

(b) Replace

```ts
    mutationFn: async (referralId: string): Promise<AcceptResult> => {
      const { data, error } = await supabase.rpc("accept_referral", { p_referral_id: referralId });
```

with

```ts
    mutationFn: async (input: AcceptInput): Promise<AcceptResult> => {
      const { data, error } =
        typeof input === "string"
          ? await supabase.rpc("accept_referral", { p_referral_id: input })
          : await supabase.rpc("accept_referral_override", {
              p_referral_id: input.referralId,
              p_override_reason: input.overrideReason.trim(),
            });
```

In `apps/app/src/features/partners/lib/referrals.ts`, replace

```ts
  ["invalid_direction", "That link could not be removed."],
```

with

```ts
  ["invalid_direction", "That link could not be removed."],
  ["override_reason_required", "Add a short reason to accept a possible duplicate."],
```

- [ ] **Step 5: Update the review sheet**

Replace the whole of `apps/app/src/features/partners/components/ReviewReferralSheet.tsx` with:

```tsx
// apps/app/src/features/partners/components/ReviewReferralSheet.tsx
/**
 * ReviewReferralSheet: triage one submitted referral. Accept creates the deal
 * (lead source Partner referral, first follow-up task); Decline needs a reason;
 * Merge links it to a deal the rep can already see and leaves that deal's lead
 * source alone. Same Radix Dialog shell as SendReferralSheet.
 *
 * Phase 1B: a referral sent through the partner portal says so, and one the
 * portal flagged as a probable duplicate arrives with Decline (duplicate)
 * preselected. Accepting it anyway needs a short written reason, which lands in
 * the referral's history (FR-PORT-47). Merge stays available.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { usePlaceDuplicateCheck } from "@/features/pipeline/hooks/usePlaceDuplicateCheck";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import type { QueueReferral } from "../hooks/useReferralQueue";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { DECLINE_REASON_OPTIONS, type DeclineReason } from "../lib/referrals";

type Mode = "main" | "decline" | "merge" | "override";

export interface ReviewReferralSheetProps {
  referral: QueueReferral | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isFlagged(referral: QueueReferral | null): boolean {
  return Boolean(referral && (referral.duplicateOfReferralId || referral.duplicateOfDealId));
}

export function ReviewReferralSheet({ referral, open, onOpenChange }: ReviewReferralSheetProps) {
  const accept = useAcceptReferral();
  const decline = useDeclineReferral();
  const merge = useMergeReferral();
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const { data: deals = [] } = useDeals();

  const [mode, setMode] = React.useState<Mode>("main");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [dupName, setDupName] = React.useState<string | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");

  const referralId = referral?.id;
  const flagged = isFlagged(referral);

  React.useEffect(() => {
    setMode("main");
    setReason(isFlagged(referral) ? "duplicate" : "");
    setNote("");
    setMergeDealId("");
    setDupName(null);
    setOverrideReason("");
    // Keyed on the referral id so a refetch with a new object does not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, referralId]);

  React.useEffect(() => {
    if (!open || !referral) return;
    let live = true;
    void checkPlaceDuplicate({
      placeId: referral.placeId,
      name: referral.companyName,
      phone: referral.contactPhone,
      address: referral.address,
    }).then((m) => { if (live) setDupName(m?.companyName ?? null); });
    return () => { live = false; };
    // Keyed on the referral id so a refetch with a new object does not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, referralId, checkPlaceDuplicate]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  if (!referral) return null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const onAccept = (reasonText?: string) => run(async () => {
    const res = await accept.mutateAsync(
      reasonText ? { referralId: referral.id, overrideReason: reasonText } : referral.id,
    );
    if (res.result === "accepted") {
      toast.success("Accepted. Deal created.");
      onOpenChange(false);
      return;
    }
    toast.error("Already in your team's pipeline");
    setMergeDealId(res.dealId ?? "");
    setMode("merge");
  });

  const onDecline = () => run(async () => {
    if (!reason) return;
    await decline.mutateAsync({ referralId: referral.id, reason, note });
    toast.success("Referral declined");
    onOpenChange(false);
  });

  const onMerge = () => run(async () => {
    if (!mergeDealId) return;
    await merge.mutateAsync({ referralId: referral.id, dealId: mergeDealId });
    toast.success("Merged into the existing deal");
    onOpenChange(false);
  });

  const submitted = new Date(referral.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const details: Array<[string, string | null]> = [
    ["Contact", referral.contactName],
    ["Phone", referral.contactPhone],
    ["Email", referral.contactEmail],
    ["Address", referral.address],
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Review referral</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-strong text-text-default">{referral.companyName}</span>
            <span className="text-caption text-text-muted">
              From {referral.partnerName} · {referral.partnerCompany} · {submitted}
            </span>
            {referral.source === "portal_signed_in" && (
              <span className="text-caption text-text-muted">Sent through the partner portal</span>
            )}
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-caption text-text-subtle">{k}</dt>
                <dd className="text-body-md text-text-default">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {referral.notes && (
            <p className="whitespace-pre-wrap text-body-md text-text-muted">{referral.notes}</p>
          )}

          {flagged && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate of an earlier referral. Decline (duplicate) is preselected; you can still accept or merge.
            </p>
          )}

          {dupName && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {dupName} is already in your team's pipeline.
            </p>
          )}

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                loading={accept.isPending}
                disabled={accept.isPending}
                onClick={() => (flagged ? setMode("override") : onAccept())}
              >
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" disabled={accept.isPending} onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" className="flex-1" disabled={accept.isPending} onClick={() => setMode("decline")}>Decline</Button>
              </div>
            </div>
          )}

          {mode === "override" && (
            <div className="flex flex-col gap-3">
              <p className="text-body-sm text-text-muted">
                Say why you are accepting a possible duplicate. The reason is saved in the referral's history.
              </p>
              <NotesFieldWithMic value={overrideReason} onChange={setOverrideReason} placeholder="Why accept it anyway?" />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!overrideReason.trim() || accept.isPending}
                  loading={accept.isPending}
                  onClick={() => onAccept(overrideReason.trim())}
                >
                  Accept anyway
                </Button>
              </div>
            </div>
          )}

          {mode === "decline" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Reason</span>
                <Select
                  value={reason}
                  onValueChange={(v) => setReason(v as DeclineReason)}
                  placeholder="Pick a reason…"
                  options={DECLINE_REASON_OPTIONS}
                />
              </label>
              <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!reason || decline.isPending}
                  loading={decline.isPending}
                  onClick={onDecline}
                >
                  Decline referral
                </Button>
              </div>
            </div>
          )}

          {mode === "merge" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Existing deal</span>
                <Select
                  value={mergeDealId}
                  onValueChange={setMergeDealId}
                  placeholder="Pick a deal…"
                  options={openDeals}
                />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!mergeDealId || merge.isPending}
                  loading={merge.isPending}
                  onClick={onMerge}
                >
                  Merge into deal
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ReviewReferralSheet;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS (every existing partners test included; `ReferralQueueCard.test.tsx` fixtures still compile because the new fields are optional).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/partners
git commit -m "$(cat <<'EOF'
feat(referrals): portal and duplicate cues in review, written reason to accept a duplicate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: String audit, full verification, PR to main

Spec 7: "render portal pages ... for every status and assert no internal status name, stage name, or reason code appears".

**Files:**
- Create: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: `handlePortalRequest` (Task 7), `PortalRoot` and every Phase 1B page (Tasks 9 to 11), `PORTAL_LABELS` (Task 5).
- Produces: one vitest file; no production code.

- [ ] **Step 1: Write the string audit**

Create `apps/app/src/features/portal/portalStringAudit.test.tsx`:

```tsx
/**
 * String audit (spec 7, PRD section 19 acceptance): nothing a partner can see,
 * from the API or on screen, carries an internal status name, a deal stage, a
 * decline reason code, a referral source, or internal free text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  handlePortalRequest,
  type PortalApiDeps,
  type PortalRpcResult,
} from "../../../../../supabase/functions/_shared/portalApi";
import { PORTAL_LABELS } from "../../../../../supabase/functions/_shared/portalLabels";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("./lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./pages/PortalRoot";
import { PortalApiError } from "./lib/portalApi";
import { writePortalSession } from "./lib/portalSession";

const INTERNAL_STATUSES = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];
const FORBIDDEN_VALUES = new Set([
  ...INTERNAL_STATUSES,
  "new",
  "contacted",
  "qualified",
  "proposal",
  "duplicate",
  "outside_footprint",
  "outside_icp",
  "insufficient_contact",
  "existing_customer",
  "withdrawn_by_partner",
  "rep_entered",
  "portal_signed_in",
]);
const FORBIDDEN_KEYS = ["status", "stage", "source", "decline_reason", "declineReason", "decline_note", "declineNote"];
const FORBIDDEN_WORDS =
  /\b(submitted|accepted|working|won|lost|declined|withdrawn|contacted|qualified|proposal|duplicate|outside_footprint|outside_icp|insufficient_contact|existing_customer|withdrawn_by_partner|rep_entered|portal_signed_in)\b/;
const SECRET = "INTERNAL-SECRET";

function walk(value: unknown, strings: string[], keys: string[]): void {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, strings, keys));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k);
      walk(v, strings, keys);
    }
  }
}

function auditJson(body: unknown) {
  const strings: string[] = [];
  const keys: string[] = [];
  walk(body, strings, keys);
  expect(strings.filter((s) => FORBIDDEN_VALUES.has(s))).toEqual([]);
  expect(keys.filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(body)).not.toContain(SECRET);
}

describe("portal_api responses", () => {
  const hostile = {
    decline_reason: "outside_icp",
    decline_note: `${SECRET} decline note`,
    stage: "proposal",
    deal_notes: `${SECRET} deal note`,
    other_partner: "Someone Else CPA",
  };

  function deps(status: string): PortalApiDeps {
    const rpc = vi.fn(async (name: string): Promise<PortalRpcResult> => {
      switch (name) {
        case "portal_session_lookup":
          return {
            data: [{ portal_user_id: "u-1", org_id: "o-1", partner_id: "p-1", partner_name: "Jane", user_email: "j@x.co", org_name: "Acme ISO", org_slug: "acme" }],
            error: null,
          };
        case "portal_list_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              id: `r-${i}`,
              ref: `REF-0000000${i}`,
              company_name: "Fresh Bakery",
              status: s,
              source: "rep_entered",
              submitted_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              ...hostile,
            })),
            error: null,
          };
        case "portal_get_referral":
          return {
            data: [{
              id: "3f9a21c0-1111-4222-8333-444455556666",
              ref: "REF-3F9A21C0",
              company_name: "Fresh Bakery",
              contact_name: "Ann",
              contact_email: "ann@fresh.example",
              contact_phone: "5550100100",
              address: "5 Oak St",
              industry: "restaurant",
              urgency: "this_week",
              notes: "Wants a demo",
              status,
              source: "portal_signed_in",
              submitted_at: "2026-10-01T12:00:00Z",
              rep_name: "Rita Rep",
              rep_email: "rita@acme.example",
              can_withdraw: status === "submitted",
              ...hostile,
            }],
            error: null,
          };
        case "portal_referral_history":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({ status: s, created_at: `2026-10-0${i + 1}T12:00:00Z`, actor_type: "user", note: SECRET })),
            error: null,
          };
        case "portal_dashboard_stats":
          return {
            data: [{ submitted: 7, active: 3, closed_won: 1, not_moving_forward: 2, won_value_cents: 123456, value_visible: false, ...hostile }],
            error: null,
          };
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    });
    return {
      rpc,
      sendEmail: vi.fn(async () => {}),
      env: { appBaseUrl: "https://app.getnavigatr.io", fromAddress: "n <a@b.co>", appEnv: "production", emailAllowlist: "" },
    };
  }

  async function call(action: string, body: Record<string, unknown>, status: string) {
    const res = await handlePortalRequest(
      new Request(`https://proj.supabase.co/functions/v1/portal_api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-portal-session": "tok" },
        body: JSON.stringify({ slug: "acme", ...body }),
      }),
      deps(status),
    );
    expect(res.status).toBe(200);
    return res.json();
  }

  it.each(INTERNAL_STATUSES)("leaks nothing internal for a referral that is %s", async (status) => {
    auditJson(await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status));
  });

  it("leaks nothing internal in the list or the dashboard", async () => {
    auditJson(await call("list_referrals", {}, "submitted"));
    const dash = await call("dashboard", {}, "submitted");
    auditJson(dash);
    expect(JSON.stringify(dash)).not.toContain("123456");
  });
});

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

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

function expectCleanScreen() {
  const text = document.body.textContent ?? "";
  expect(text.match(FORBIDDEN_WORDS)).toBeNull();
  expect(text).not.toContain(SECRET);
  expect(text).not.toMatch(/navigatr/i);
}

describe("rendered portal pages", () => {
  const HISTORY = PORTAL_LABELS.map((label, i) => ({ label, at: `2026-10-0${i + 1}T12:00:00Z` }));

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
    Object.values(api).forEach((fn) => fn.mockReset());
    api.brand.mockResolvedValue({ orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });
    api.form.mockResolvedValue({ consentText: "I have permission to share this business's contact details.", consentVersion: 1 });
    api.dupCheck.mockResolvedValue(true);
    writePortalSession("acme", "live");
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
  });

  it("dashboard with every label, value on and off", async () => {
    api.listReferrals.mockResolvedValue(
      PORTAL_LABELS.map((label, i) => ({
        id: `r-${i}`,
        ref: `REF-0000000${i}`,
        companyName: `Business ${i}`,
        label,
        submittedAt: "2026-10-01T12:00:00Z",
        lastActivityAt: "2026-10-02T12:00:00Z",
      })),
    );
    api.dashboard.mockResolvedValue({ submitted: 6, active: 3, closedWon: 1, conversionRate: 0.5, valueVisible: true, totalValueCents: 500000 });
    renderAt("/p/acme/home");
    await screen.findByRole("link", { name: /Business 5/ });
    expectCleanScreen();
  });

  it("dashboard with nothing closed and no referrals", async () => {
    api.listReferrals.mockResolvedValue([]);
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    renderAt("/p/acme/home");
    await screen.findByText("No closed referrals yet");
    expectCleanScreen();
  });

  it.each(PORTAL_LABELS)("detail page labelled %s, with every history step", async (label) => {
    api.getReferral.mockResolvedValue({
      id: "r-1",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      contactName: "Ann",
      contactEmail: "ann@fresh.example",
      contactPhone: "5550100100",
      address: "5 Oak St",
      industry: "restaurant",
      urgency: "this_week",
      notes: "Wants a demo",
      label,
      submittedAt: "2026-10-01T12:00:00Z",
      canWithdraw: label === "Received",
      rep: label === "Received" ? null : { name: "Rita Rep", email: "rita@acme.example" },
      history: HISTORY,
    });
    renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    expectCleanScreen();
  });

  it("withdraw confirmation and the too-late message", async () => {
    const user = userEvent.setup();
    api.getReferral.mockResolvedValue({
      id: "r-1",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      industry: null,
      urgency: null,
      notes: null,
      label: "Received",
      submittedAt: "2026-10-01T12:00:00Z",
      canWithdraw: true,
      rep: null,
      history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
    });
    api.withdrawReferral.mockRejectedValue(new PortalApiError(409, "not_withdrawable"));
    renderAt("/p/acme/r/r-1");
    await user.click(await screen.findByRole("button", { name: "Withdraw this referral" }));
    expectCleanScreen();
    await user.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    await screen.findByRole("alert");
    expectCleanScreen();
  });

  it("submit form with the duplicate warning, then the confirmation", async () => {
    const user = userEvent.setup();
    api.submitReferral.mockResolvedValue({ id: "r-9", ref: "REF-AAAA0009" });
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderAt("/p/acme/new");
    await user.type(await screen.findByLabelText("Business name"), "Corner Cafe");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.type(screen.getByLabelText("Phone"), "5550100001");
    await screen.findByText(/may already be in progress with Acme ISO/, {}, { timeout: 3000 });
    expectCleanScreen();
    await user.click(await screen.findByRole("checkbox", { name: "I have permission to share this business's contact details." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await screen.findByRole("heading", { name: "Referral sent" });
    expectCleanScreen();
  });
});
```

- [ ] **Step 2: Run the audit**

Run: `pnpm --filter app test -- src/features/portal/portalStringAudit.test.tsx`
Expected: PASS. If it fails, the failure names the leaked word: fix the copy or the allowlist in the page or handler, never the audit list.

- [ ] **Step 3: Commit the audit**

```bash
git add apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "$(cat <<'EOF'
test(portal): string audit for partner-facing responses and pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`041` to `044` included, and `034` to `040` still passing), the two documented SKIPs unchanged.

- [ ] **Step 5: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds met, no `act()` warnings from the new files.

- [ ] **Step 6: Real production build**

Run: `pnpm --filter app build`
Expected: exits 0 (`tsc -b` typechecks the four new `_shared` files through the include list; `vite build` succeeds).

- [ ] **Step 7: Deno typecheck of both edge functions**

Run: `deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/portal_api/index.ts supabase/functions/transcribe/index.ts`
Expected: exits 0.

- [ ] **Step 8: No long dashes, no internal names in portal copy**

Run: `git diff --name-only main...HEAD | xargs perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof'`
Expected: no output.

Run: `grep -rn "supabase.functions.invoke\|supabase.auth" apps/app/src/features/portal --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: no output (the portal never uses the app's Supabase session).

- [ ] **Step 9: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal Phase 1B: partners send and track referrals" --body "$(cat <<'EOF'
## Summary
- Partners send a referral from their phone: business, contact, email or phone, optional address, industry, timing and notes (with voice dictation). The ISO's consent line is shown with a checkbox and its version is stored on the referral by the server.
- The form saves a draft on the device and clears it after sending. The confirmation shows a short reference (REF-XXXXXXXX) and a link to the referral.
- A soft "This business may already be in progress with {ISO}" warning appears while typing. It uses the partner owner's visibility only and never says which rep, stage, value or partner.
- On submit, a probable duplicate is flagged (earlier referral and/or active deal the owner can see); the earlier referral keeps credit. Routing follows the Phase 0 rule.
- Partner dashboard: Send a referral, tiles (Submitted, Active, Closed Won, Conversion rate, Total value only when the ISO allows it), a 30 days / 90 days / 12 months / All time selector, and the partner's own referrals with partner labels. Refreshes every 30 seconds.
- Referral detail: what they sent, the current label, label history with dates, the assigned rep's name and business email, and Withdraw while it is still Received.
- Rep side: the review sheet says "Sent through the partner portal", flags a possible duplicate with Decline (duplicate) preselected, and accepting it anyway needs a written reason saved in the referral's history.
- 1A follow-ups: at most 20 sign-in codes per partner per day, every failed sign-in is audited, and the invite link survives a reload of the terms screen.
- Speech-to-text now lives in one shared helper used by the rep and partner paths (rate limited to 30 per partner per hour on the portal).

All partner data goes through service-role-only SQL functions scoped by the session's org and partner; another partner's or another ISO's referral looks missing. portal_api responses are field-by-field allowlists and never contain internal status names, stages, decline reasons or internal notes (string audit test included).

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (sections 5.5, 5.6, 6, 7)
Plan: docs/superpowers/plans/2026-10-12-partner-portal-1b-submit-track.md

## Deviations (details in the plan)
- Address is plain text in 1B (no Google Places on the public surface).
- Email is not part of duplicate matching (spec R8).
- Rep-logged referrals appear in the partner's list without any rep-typed detail.

## Not in this PR (Phase 1C)
- Share update with partner, partner and rep emails, same-day nudge

## Test plan
- [ ] DB tests 041 to 044 pass in CI from an empty database, with 034 to 040 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging: a signed-in partner sends a referral by phone; the rep sees it in Referrals to review with "Sent through the partner portal"
- [ ] Staging: send the same business again from a second partner of the same owner; the warning shows while typing and the rep sees Decline (duplicate) preselected
- [ ] Staging: the rep accepts; within 30 seconds the partner sees Accepted, then In Progress after a stage change
- [ ] Staging: the partner withdraws a Received referral; Withdraw disappears and the rep queue no longer shows it
- [ ] Staging: dictate a note on the portal form (TRANSCRIBE_MOCK on staging returns the mock sentence)
- [ ] Staging: turn "show closed-won value" on and off in Settings and watch the Total value tile appear and disappear

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: Bind the PR**

Use the ccd_pr `get_status` tool; if it does not report this PR, call `bind_pr` with its URL. Do not merge or promote without the user's go.

---

## Summary

| Task | What ships |
|---|---|
| 1 | Audit enum values; 20 codes per day cap; `sign_in_failed` audit |
| 2 | `portal_submit_referral`, `portal_dup_check`, `portal_form_context`; owner-scoped duplicate finder; partner actor in history |
| 3 | List, detail, history, stats, withdraw, transcribe claim SQL |
| 4 | `accept_referral` refuses a flagged referral without a reason; `accept_referral_override` |
| 5 | `_shared/portalLabels.ts`, `_shared/portalSubmission.ts` |
| 6 | `_shared/transcribe.ts`; `transcribe` uses it |
| 7 | `portal_api` referral actions (`_shared/portalReferralApi.ts`) |
| 8 | Client API, draft and invite storage, formatting, portal dictation |
| 9 | Signed-in layout, dashboard |
| 10 | Submit page |
| 11 | Detail page with withdraw |
| 12 | Invite token survives a reload |
| 13 | Rep review sheet cues and accept-anyway reason |
| 14 | String audit, full verification, PR |
