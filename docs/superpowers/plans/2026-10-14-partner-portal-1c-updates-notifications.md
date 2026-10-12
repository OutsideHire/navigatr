# Partner Portal Phase 1C (Updates and notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rep can share a short written update with the partner from the deal's "Referred by" line, and the partner sees it on their referral page. Partners with portal access get plain, ISO-branded emails when their referral is received, accepted, closed won, not moving forward, withdrawn by the ISO, or gets an update. Reps get a "new partner referral" email when one is routed to them and one end-of-day digest when partner referrals from today are still waiting. Every email goes through one outbox, drained every 2 minutes by a cron-called edge function, through the existing non-production allowlist guard.

**Architecture:** Every email is decided in SQL and written to `portal_email_outbox` by AFTER triggers on `referrals` and `referral_updates`, and by `enqueue_portal_nudges(p_now)` for the digest. Rows carry an allowlisted JSON payload (brief E1) and never the recipient's address; `claim_portal_emails` resolves the address at send time and drops rows whose recipient lost access. The edge function `portal_notify` (CRON_SECRET, like `notify_no_deals`) queues nudges, claims up to 50 rows with `for update skip locked`, renders each with the pure builders in `_shared/portalNotifyEmail.ts` and the branded template, sends through Resend and marks each row sent, dropped or failed. The logic lives in the pure handler `_shared/portalNotify.ts`; `index.ts` only wires dependencies. `renderEmail` gains an optional brand (ISO logo or name, ISO color, locked "Powered by navigatr" line) that leaves every existing email byte-identical when absent.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pg_cron, pg_net, Vault), Deno edge functions, Resend 4.1.1, React 18 + TypeScript, TanStack Query 5, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` sections 5.6 (published updates on the detail page), 5.7, 5.8, 5.9, 6 and 7. Design brief decisions E1 to E7 and the brief's scope list are binding and are referenced by number below.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261014000001_...` to `20261014000006_...`, applied in filename order. The latest existing migration is `20261012000005`. Every migration is additive; the only replacement is `portal_issue_code`, dropped and recreated with two extra output columns (Task 5). Never hand-apply SQL to staging or production; CI and `promote-production` apply them.
- Partner-side, outbox and nudge functions are `security definer set search_path = public, extensions`, then `revoke execute ... from public, anon, authenticated;` and `grant execute ... to service_role;`. Private helpers (`_portal_*`) and trigger functions are also revoked from `service_role`. Supabase grants `authenticated` directly, so it is revoked by name.
- The internal RPC `publish_referral_update` keeps the Phase 0 posture: `security definer set search_path = public`, re-checks rights inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`.
- New tables (`referral_updates`, `portal_email_outbox`, `referral_nudges`) enable RLS and `revoke all ... from anon, authenticated` first (default privileges from 20260813000002 grant `authenticated` full DML on new tables). Only `referral_updates` then gets `grant select ... to authenticated` plus one SELECT policy.
- pgcrypto calls are always schema-qualified (`extensions.digest`, `extensions.gen_random_bytes`). This plan adds none; the replaced `portal_issue_code` keeps its qualified `extensions.gen_random_bytes`.
- DB tests: plain psql scripts `supabase/tests/NNN_name.sql` numbered `045` to `050`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Service-role-only functions are called as `postgres` (switch back with `perform set_config('role', 'postgres', true);`). Assert function privileges with `has_function_privilege` and table privileges with `has_table_privilege`, never by calling something the role cannot execute: local Postgres 17.6 segfaults on a live function-level permission-denied.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`.
- `_shared` modules are dependency-free TS with no Deno globals at module scope, import each other with the `.ts` extension, and their tests import without the extension. Every new `_shared` source file is added to the `include` list in `apps/app/tsconfig.app.json` so `tsc -b` typechecks it.
- Partner-visible text comes only from: partner labels (`_shared/portalLabels.ts`, mirrored once in SQL by `_portal_status_label`), the ISO name, the partner's own referral fields, the assigned rep's name and business email, and `referral_updates.body` (spec 6). Payloads are built in SQL from an allowlist (brief E1) and re-validated in TS before sending; anything unknown is dropped, never sent.
- Partner-facing copy (portal pages and partner emails) names the ISO, never "navigatr", except the locked "Powered by navigatr" footer line of a branded email. It never uses the lowercase words submitted, accepted, working, won, lost, declined or withdrawn, so "won't" is out. The string audit enforces both.
- Existing email callers (`send_invite_email`, `send_auth_email`, `notify_no_deals`) pass no brand and must render byte-identical: Task 6 commits file snapshots of the default template before changing it.
- Every send goes through `shouldSend(APP_ENV, EMAIL_ALLOWLIST, recipient)`. `portal_notify` logs outbox ids and kinds, never recipient addresses.
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. Tests live next to source. No `act()` warnings. Node 25 ships a broken global `localStorage` (and `sessionStorage`), so every test file that touches storage installs its own in-memory `Storage` shim in `beforeEach` and restores the original in `afterEach` (the 1A pattern). The shim is defined per file, never shared.
- Before any push: `pnpm --filter app build` must pass (`tsc -b && vite build`; `tsc --noEmit` alone is not enough).
- Deno: `deno check --no-lock --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts`. `send_invite_email` already fails `deno check` on main with one unrelated error (`TS2353 ... 'dropped' does not exist ...` at `index.ts:111:44`); this plan neither fixes nor adds to it.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

**Create**
- `supabase/migrations/20261014000001_referral_updates.sql`: `referral_updates`, `publish_referral_update`, `portal_referral_updates`.
- `supabase/migrations/20261014000002_portal_email_outbox.sql`: `portal_email_outbox`, `claim_portal_emails`, `mark_portal_email`.
- `supabase/migrations/20261014000003_portal_email_enqueue.sql`: `_portal_status_label`, `_portal_review_recipients`, `_portal_partner_payload`, `_portal_enqueue_partner`, `_portal_enqueue_new_referral`, three enqueue triggers.
- `supabase/migrations/20261014000004_portal_nudges.sql`: `referral_nudges`, `_portal_local_tz`, `enqueue_portal_nudges`.
- `supabase/migrations/20261014000005_portal_code_email_brand.sql`: `portal_issue_code` also returns `logo_url`, `primary_color`.
- `supabase/migrations/20261014000006_portal_notify_cron.sql`: `portal-notify` pg_cron job; `cron_health` gains `portal_email`.
- `supabase/tests/045_referral_updates.sql`, `046_portal_email_outbox.sql`, `047_portal_email_enqueue.sql`, `048_portal_nudges.sql`, `049_portal_code_email_brand.sql`, `050_portal_notify_cron.sql`.
- `supabase/functions/_shared/emailTemplate.snapshot.test.ts` and `supabase/functions/_shared/__snapshots__/emailTemplate.{auth,code,escaped}.{html,txt}` (six files written by the first run).
- `supabase/functions/_shared/portalNotifyEmail.ts` (+ `.test.ts`): payload parsers and email builders.
- `supabase/functions/_shared/portalNotify.ts` (+ `.test.ts`): the drain handler.
- `supabase/functions/portal_notify/index.ts`, `supabase/functions/portal_notify/deno.json`.
- `apps/app/src/features/partners/hooks/useReferralUpdates.ts` (+ `.test.tsx`).
- `apps/app/src/features/partners/components/ShareUpdateSheet.tsx` (+ `.test.tsx`), `ReferralUpdatesPanel.tsx` (+ `.test.tsx`).

**Modify**
- `supabase/functions/_shared/emailTemplate.ts` (+ test): optional `brand`.
- `supabase/functions/_shared/portalEmail.ts` (+ test): `portalEmailBrand`, `fetchPortalEmailBrand`.
- `supabase/functions/_shared/portalApi.ts` (+ test): the sign-in code email carries the brand.
- `supabase/functions/_shared/portalInvite.ts` (+ test): the invite email carries the brand.
- `supabase/functions/_shared/portalReferralApi.ts` (+ test): detail returns `updates`.
- `supabase/config.toml`: `[functions.portal_notify] verify_jwt = false`.
- `apps/app/tsconfig.app.json`: include `portalNotifyEmail.ts`, `portalNotify.ts`.
- `apps/app/src/features/admin/lib/cronHealth.ts` (+ test): "Partner emails (2 min)" row.
- `apps/app/src/features/portal/lib/portalApi.ts`: re-export `PortalReferralUpdate`.
- `apps/app/src/features/portal/pages/PortalReferralPage.tsx` (+ test): "Updates from {ISO}" section.
- `apps/app/src/features/portal/portalStringAudit.test.tsx`: updates fixtures, then a partner email block.
- `apps/app/src/features/partners/lib/referrals.ts` (+ test): two new error tokens.
- `apps/app/src/features/pipeline/pages/DealDetailPage.tsx` and `DealDetailPage.referral.test.tsx`: the updates panel under "Referred by".

**Deviations from spec and brief, recorded here:**

1. **Default end of day is 18:00 (1080 minutes), not 17:00.** The brief says 1020, but the app's own default when `path_preferences.end_of_day_minutes` is null is `DEFAULT_END_OF_DAY_MINUTES = 18 * 60` (`apps/app/src/features/path/lib/pathCapacityDefaults.ts`). Nudging at 17:00 a rep whose Path says the day ends at 18:00 contradicts "their end-of-day" (spec 5.9). Changing it is one literal in `enqueue_portal_nudges`.
2. **The nudge covers referrals received today before the recipient's end of day**, and sends at most one digest per recipient per local day (dedupe key). A referral that arrives after end of day is tomorrow's work and never triggers an evening email.
3. **Per-recipient nudge log.** New table `referral_nudges (referral_id, user_id)`. Admin-queue items nudge every active administrator in their own time zone (brief scope 6), so a single `nudged_at` stamp cannot gate them. `referrals.nudged_at` is still stamped with the first nudge, and an assigned referral is nudged only while it is null ("each is nudged once").
4. **Outbox columns beyond the brief:** `last_attempt_at` (retry backoff of 2 minutes times attempts) and `failed_at` (gave up after 5 attempts), kept apart from `dropped_at` (deliberately not sent: email guard, recipient lost access, invalid payload). The recipient address is never stored: `claim_portal_emails` resolves it at send time, so a suspended partner or a deactivated rep gets nothing.
5. **One function, every 2 minutes.** Spec 5.9 names an hourly `notify_untriaged_referrals`; brief scope 7 merges the nudge into `portal_notify`, which runs `enqueue_portal_nudges(now())` before each drain.
6. **Share update lives on Deal Detail only.** Spec 5.7 also names the review sheet; brief scope 1 keeps it off submitted referrals. Partner Detail referral rows are skipped: they have no per-referral surface to hang it on, so it is not trivial.
7. **Email brand is `{ name, logoUrl, primaryColor }`.** No `showPoweredBy`: "Powered by navigatr" is locked on (white-label v2 removed the toggle; `org_branding.show_powered_by` is vestigial and `AppLayout` renders the line unconditionally), so every branded email shows it. No `darkLogoUrl` (emails are light-only, `color-scheme: light only`). No `productName` (partner emails show the ISO name).
8. **The sign-in code email gets its brand from `portal_issue_code`** (two new output columns) instead of a second lookup: `request_code`'s response time must not depend on whether a code was issued (1A). The invite email looks the brand up with `portal_brand` after the invite is created.
9. **Who gets status emails.** Only inbound referrals. A portal submission sends "received"; a rep-logged referral sends nothing on creation (the partner did not send it through the portal) but does send status emails later, because it shows in the partner's list. Outbound referrals never email.
10. **"Withdrawn by an internal user" includes `remove_referral_link`.** Anything that withdraws without `navigatr.referral_actor = 'partner'` emails the partner.
11. **Internal emails keep the default navigatr template.** Reps are navigatr users; only partner emails carry the ISO brand.
12. **Scheduled-job health.** `cron_health` gains a `portal_email` fact and the admin card a "Partner emails (2 min)" row (brief scope 7: `cron_health` reports per-job output freshness, so the outbox fits).
13. **`publish_referral_update` rights:** `can_triage_referral(assignee)` or "can see the deal's owner". Each implies the `referrals_select` policy, so a caller who passes can always see the referral (brief E5). Missing, other-org, outbound or purged referrals raise `referral_not_found`; a visible referral without rights raises `not_authorized`.
14. **Merging into an already-won deal sends two emails** (Accepted, then Closed Won) from one transaction, matching the two history steps the partner sees.
15. **Update author on the portal** is the rep's full name, or the ISO name when the author has been deactivated.

---

### Task 1: Published updates (SQL)

**Files:**
- Create: `supabase/migrations/20261014000001_referral_updates.sql`
- Test: `supabase/tests/045_referral_updates.sql`

**Interfaces:**
- Consumes (SQL, Phase 0 and 1B): `public.user_org_id() returns uuid`, `public.can_triage_referral(p_assignee uuid) returns boolean`, `public.user_can_see_owner(p_owner uuid) returns boolean`, table `referrals` and its `referrals_select` policy.
- Produces (SQL):
  - Table `public.referral_updates (id uuid pk, org_id uuid not null, referral_id uuid not null, author_user_id uuid null, body text not null, published_at timestamptz not null default now())`, `body` trimmed and 1 to 1000 characters. RLS: `authenticated` has SELECT only, through policy `referral_updates_select` (org match and the referral is visible under `referrals_select`). No client writes.
  - `public.publish_referral_update(p_referral_id uuid, p_body text) returns uuid`: authenticated only. Errors (message tokens): `not_authorized`, `referral_not_found`, `update_required`, `update_too_long`.
  - `public.portal_referral_updates(p_org uuid, p_partner uuid, p_referral uuid) returns table (body text, published_at timestamptz, author_name text)`: service role only, newest first, at most 100 rows, pinned to `(org, partner)`, inbound and unpurged; `author_name` is null for a deactivated or missing author.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/045_referral_updates.sql`:

```sql
-- Tests for 20261014000001_referral_updates (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/045_referral_updates.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-upd): boss administrator; mgr (sales_manager) under boss;
-- rep1 under mgr; rep2 under boss in another branch. Partner P1 (owner rep1) has
-- referral X (accepted, deal D1 owned by rep1) and outbound Q. Partner P2 (owner
-- rep2) has W. Org portal-upd-b: admin bob, partner PB, referral Z.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001045', 'Update Org',   'portal-upd',   'portal-upd-a1',   true),
  ('00000000-0000-0000-0000-000000001145', 'Update Org B', 'portal-upd-b', 'portal-upd-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0450000-0000-0000-0000-000000000001', 'boss@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000002', 'mgr@upd.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000003', 'rep1@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000004', 'rep2@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000005', 'bob@updb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0450000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'admin',   'administrator',      'Boss',     'boss@upd.example', 'updboss'::ltree,          null),
  ('a0450000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'manager', 'sales_manager',      'Mia Mgr',  'mgr@upd.example',  'updboss.mgr'::ltree,      'a0450000-0000-0000-0000-000000000001'),
  ('a0450000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001045', 'rep',     'sales_professional', 'Rita Rep', 'rep1@upd.example', 'updboss.mgr.rep1'::ltree, 'a0450000-0000-0000-0000-000000000002'),
  ('a0450000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001045', 'rep',     'sales_professional', 'Rob Rep',  'rep2@upd.example', 'updboss.rep2'::ltree,     'a0450000-0000-0000-0000-000000000001'),
  ('a0450000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001145', 'admin',   'administrator',      'Bob',      'bob@updb.example', 'updbob'::ltree,           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a045a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000003', 'a0450000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@upd.example'),
  ('a045a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000004', 'a0450000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@upd.example'),
  ('a045a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001145', 'a0450000-0000-0000-0000-000000000005', 'a0450000-0000-0000-0000-000000000005', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@updb.example');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a045d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000003', 'Fresh Bakery', '5 Oak St', 'Ann', 'ann@fresh.example', '5550450001', 100000, 'contacted', 'partner_referral');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, assigned_user_id, deal_id) values
  ('a045f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'accepted',  'Fresh Bakery', 'a0450000-0000-0000-0000-000000000003', 'a045d000-0000-0000-0000-000000000001'),
  ('a045f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered',      'accepted',  'Out Co',       'a0450000-0000-0000-0000-000000000003', null),
  ('a045f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000002', 'inbound',  'portal_signed_in', 'submitted', 'Corner Cafe',  'a0450000-0000-0000-0000-000000000004', null),
  ('a045f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001145', 'a045a000-0000-0000-0000-000000000003', 'inbound',  'portal_signed_in', 'submitted', 'Other Org Co', 'a0450000-0000-0000-0000-000000000005', null);

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

create or replace function _t_update_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from referral_updates;
  return n;
end $$;

-- Privileges (before any role switch).
do $$ begin
  if has_table_privilege('authenticated', 'public.referral_updates', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_updates', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_updates', 'DELETE') then
    raise exception 'authenticated must not write referral_updates directly';
  end if;
  if not has_table_privilege('authenticated', 'public.referral_updates', 'SELECT') then
    raise exception 'authenticated should read referral_updates through RLS';
  end if;
  if has_table_privilege('anon', 'public.referral_updates', 'SELECT') then
    raise exception 'anon must not read referral_updates';
  end if;
  if not has_function_privilege('authenticated', 'public.publish_referral_update(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated should execute publish_referral_update';
  end if;
  if has_function_privilege('anon', 'public.publish_referral_update(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute publish_referral_update';
  end if;
  if has_function_privilege('authenticated', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'portal_referral_updates must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'service_role should execute portal_referral_updates';
  end if;
end $$;

-- 1. The assignee publishes; the body is trimmed and attributed (role switches from here on).
do $$ declare v_id uuid; u record; begin
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  v_id := public.publish_referral_update('a045f000-0000-0000-0000-000000000001', '  Called the owner, demo Tuesday  ');
  select * into u from referral_updates where id = v_id;
  if u.body is distinct from 'Called the owner, demo Tuesday'
     or u.author_user_id is distinct from 'a0450000-0000-0000-0000-000000000003'
     or u.org_id is distinct from '00000000-0000-0000-0000-000000001045'
     or u.referral_id is distinct from 'a045f000-0000-0000-0000-000000000001' then
    raise exception 'published update stored wrong: %', row_to_json(u);
  end if;
end $$;

-- 2. The manager above and an administrator may publish too.
do $$ begin
  perform _t_act('a0450000-0000-0000-0000-000000000002');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'Manager note for the partner');
  perform _t_act('a0450000-0000-0000-0000-000000000001');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'Admin note for the partner');
end $$;

-- 3. Length rules: blank refused, 1000 accepted, 1001 refused.
do $$ begin
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', '   ')$q$, 'update_required');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', null)$q$, 'update_required');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', repeat('a', 1001))$q$, 'update_too_long');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', repeat('b', 1000));
end $$;

-- 4. Rights and scope.
do $$ begin
  -- rep2 is in another branch: cannot triage X and cannot see its deal.
  perform _t_act('a0450000-0000-0000-0000-000000000004');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'hi')$q$, 'not_authorized');
  -- rep1 cannot publish on rep2's referral W.
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000003', 'hi')$q$, 'not_authorized');
  -- Another org, an outbound referral, and a missing id all look missing.
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000004', 'hi')$q$, 'referral_not_found');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000002', 'hi')$q$, 'referral_not_found');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-0000000000ff', 'hi')$q$, 'referral_not_found');
end $$;

-- 5. Reading follows referral visibility.
do $$ begin
  if _t_update_rows('a0450000-0000-0000-0000-000000000003') <> 4 then raise exception 'rep1 should see the 4 updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000002') <> 4 then raise exception 'mgr should see the 4 updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000004') <> 0 then raise exception 'rep2 must not see updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000005') <> 0 then raise exception 'another org must see nothing'; end if;
end $$;

-- 6. The portal read: scoped, newest first, author name, deactivated author hidden.
do $$ declare names text[]; bodies text[]; n int; begin
  perform set_config('role', 'postgres', true);
  update referral_updates set published_at = now() - interval '3 hours' where body = 'Called the owner, demo Tuesday';
  update referral_updates set published_at = now() - interval '2 hours' where body = 'Manager note for the partner';
  update referral_updates set published_at = now() - interval '1 hours' where body = 'Admin note for the partner';
  update referral_updates set published_at = now()                      where body = repeat('b', 1000);
  update profiles set deactivated_at = now() where id = 'a0450000-0000-0000-0000-000000000002';

  select array_agg(u.body order by ord), array_agg(coalesce(u.author_name, '(none)') order by ord)
    into bodies, names
    from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001')
         with ordinality as u(body, published_at, author_name, ord);
  if bodies <> array[repeat('b', 1000), 'Admin note for the partner', 'Manager note for the partner', 'Called the owner, demo Tuesday'] then
    raise exception 'portal updates should be newest first, got %', bodies;
  end if;
  if names <> array['Rita Rep', 'Boss', '(none)', 'Rita Rep'] then
    raise exception 'author names wrong (deactivated author must be null), got %', names;
  end if;

  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000002', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'another partner must get nothing for X'; end if;
  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001145', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'another org must get nothing for X'; end if;
  update referrals set purged_at = now() where id = 'a045f000-0000-0000-0000-000000000001';
  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'a purged referral must return nothing'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/045_referral_updates.sql`
Expected: FAIL with `relation "public.referral_updates" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000001_referral_updates.sql`:

```sql
-- 20261014000001_referral_updates.sql
--
-- Partner Portal Phase 1C (spec 5.7, FR-PORT-74): "Share update with partner".
-- A rep writes a short update on a referral; the partner sees it on their
-- referral page and gets it by email (20261014000003). This is the ONLY text
-- path from the app to the portal (spec 6): portal_api reads nothing else a rep
-- typed.
--
-- Writes: only publish_referral_update (SECURITY DEFINER, re-checks rights).
-- Internal reads: RLS, visible when the referral is visible.
-- Portal reads: portal_referral_updates, service role only, pinned to the
-- session's (org, partner).

create table referral_updates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  referral_id    uuid not null references referrals(id) on delete cascade,
  author_user_id uuid references profiles(id) on delete set null,
  body           text not null check (body = btrim(body) and char_length(body) between 1 and 1000),
  published_at   timestamptz not null default now()
);
create index referral_updates_referral_idx on referral_updates (referral_id, published_at desc);

alter table referral_updates enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_updates from anon;
revoke all on referral_updates from authenticated;
grant select on referral_updates to authenticated;

-- RLS on referrals applies inside the subquery, so this inherits referrals_select.
create policy referral_updates_select on referral_updates for select to authenticated using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_updates.referral_id)
);

-- Publish (authenticated). Allowed for anyone who can triage the referral or can
-- see its deal; both imply referrals_select, so the caller can always read what
-- they published. A referral the caller's org does not own, an outbound one, or
-- a purged one looks missing.
create or replace function public.publish_referral_update(p_referral_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.user_org_id();
  v_body text := btrim(coalesce(p_body, ''));
  r      referrals;
  v_id   uuid;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into r from referrals where id = p_referral_id;
  if r.id is null or r.org_id <> v_org or r.direction <> 'inbound' or r.purged_at is not null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  if not (
    public.can_triage_referral(r.assigned_user_id)
    or (r.deal_id is not null and exists (
          select 1 from deals d where d.id = r.deal_id and public.user_can_see_owner(d.owner_id)))
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'update_required' using errcode = '22023';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'update_too_long' using errcode = '22023';
  end if;

  insert into referral_updates (org_id, referral_id, author_user_id, body)
  values (r.org_id, r.id, auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end $$;

-- Portal read (service role). Newest first. The author's name only while they
-- are active in this org; otherwise the portal shows the ISO name.
create or replace function public.portal_referral_updates(p_org uuid, p_partner uuid, p_referral uuid)
returns table (body text, published_at timestamptz, author_name text)
language sql stable security definer set search_path = public, extensions as $$
  select u.body, u.published_at, pr.full_name
    from referral_updates u
    join referrals r on r.id = u.referral_id
    left join profiles pr on pr.id = u.author_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where u.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
   order by u.published_at desc, u.id
   limit 100
$$;

revoke execute on function public.publish_referral_update(uuid, text)          from public, anon;
grant  execute on function public.publish_referral_update(uuid, text)          to authenticated;
revoke execute on function public.portal_referral_updates(uuid, uuid, uuid)    from public, anon, authenticated;
grant  execute on function public.portal_referral_updates(uuid, uuid, uuid)    to service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/045_referral_updates.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000001_referral_updates.sql supabase/tests/045_referral_updates.sql
git commit -m "$(cat <<'EOF'
feat(referrals): reps publish updates the partner can read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Email outbox, claim and mark (SQL)

**Files:**
- Create: `supabase/migrations/20261014000002_portal_email_outbox.sql`
- Test: `supabase/tests/046_portal_email_outbox.sql`

**Interfaces:**
- Consumes (SQL, 1A): tables `portal_users` (`status portal_user_status`, `email`), `organizations` (`portal_enabled`, `is_disabled`), `profiles` (`email`, `deactivated_at`, `org_id`).
- Produces (SQL):
  - Table `public.portal_email_outbox (id uuid pk, org_id uuid not null, kind text not null, referral_id uuid null, portal_user_id uuid null, recipient_user_id uuid null, payload jsonb not null, dedupe_key text not null unique, created_at timestamptz, attempts integer not null default 0, last_attempt_at timestamptz, last_error text, sent_at timestamptz, dropped_at timestamptz, failed_at timestamptz)`. `kind` is one of `partner_received`, `partner_accepted`, `partner_not_moving_forward`, `partner_closed_won`, `partner_withdrawn`, `partner_update`, `internal_new_referral`, `internal_nudge`. Partner kinds have `portal_user_id` and no `recipient_user_id`; internal kinds the reverse. No access for `anon` or `authenticated`.
  - `public.claim_portal_emails(p_limit integer) returns table (id uuid, org_id uuid, kind text, referral_id uuid, payload jsonb, recipient text, attempts integer)`: service role only. Locks up to `p_limit` (clamped to 1..200) unsent rows with `for update skip locked`, oldest first, skipping rows with `attempts >= 5`, rows already failed, and rows inside their backoff (`last_attempt_at` within `2 minutes * attempts`). Rows whose recipient is no longer reachable (portal user not active, portal off, org disabled, rep deactivated or moved) get `dropped_at` and `last_error = 'recipient_inactive'` and are not returned. Returned rows have `attempts` incremented and `last_attempt_at = now()`; `recipient` is the current address.
  - `public.mark_portal_email(p_id uuid, p_outcome text, p_error text) returns void`: service role only. `p_outcome` is `sent` (stamps `sent_at`, clears `last_error`), `dropped` (stamps `dropped_at`, `last_error = p_error` or `dropped`), or `failed` (`last_error = p_error` or `send_failed`, and `failed_at` once `attempts >= 5`). Anything else raises `invalid_outcome`. Only unsettled rows change.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/046_portal_email_outbox.sql`:

```sql
-- Tests for 20261014000002_portal_email_outbox (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/046_portal_email_outbox.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture (org portal-outbox, portal on): boss administrator, rita (active rep),
-- gone (deactivated rep). Partner P1 has an active portal user, P2 a suspended one.
-- Outbox rows:
--   E1 partner_received        -> P1 portal user   (claimable)
--   E2 partner_accepted        -> P2 portal user   (suspended: dropped on claim)
--   E3 internal_new_referral   -> rita             (claimable)
--   E4 internal_nudge          -> gone             (deactivated: dropped on claim)
--   E5 partner_update          -> P1, attempts 5   (never claimed)
--   E6 partner_closed_won      -> P1, already sent (never claimed)

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001046', 'Outbox Org', 'portal-outbox', 'portal-outbox-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0460000-0000-0000-0000-000000000001', 'boss@outbox.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-000000000002', 'rita@outbox.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-000000000003', 'gone@outbox.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0460000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'admin', 'administrator',      'Boss',     'boss@outbox.example', 'obboss'::ltree,      null, null),
  ('a0460000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'rep',   'sales_professional', 'Rita Rep', 'rita@outbox.example', 'obboss.rita'::ltree, 'a0460000-0000-0000-0000-000000000001', null),
  ('a0460000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001046', 'rep',   'sales_professional', 'Gone Rep', 'gone@outbox.example', 'obboss.gone'::ltree, 'a0460000-0000-0000-0000-000000000001', now());

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a046a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@outbox.example'),
  ('a046a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'Sam CPA',  'Sam & Co',  'cpa', 'sam@outbox.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a046b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000001', 'jane@outbox.example', 'active'),
  ('a046b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000002', 'sam@outbox.example',  'suspended');

insert into portal_email_outbox (id, org_id, kind, portal_user_id, recipient_user_id, payload, dedupe_key, attempts, sent_at) values
  ('a046e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'partner_received',      'a046b000-0000-0000-0000-000000000001', null, '{"label":"Received"}', 't46:e1', 0, null),
  ('a046e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'partner_accepted',      'a046b000-0000-0000-0000-000000000002', null, '{"label":"Accepted"}', 't46:e2', 0, null),
  ('a046e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001046', 'internal_new_referral', null, 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:e3', 0, null),
  ('a046e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001046', 'internal_nudge',        null, 'a0460000-0000-0000-0000-000000000003', '{"count":1}', 't46:e4', 0, null),
  ('a046e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001046', 'partner_update',        'a046b000-0000-0000-0000-000000000001', null, '{"label":"Accepted"}', 't46:e5', 5, null),
  ('a046e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001046', 'partner_closed_won',    'a046b000-0000-0000-0000-000000000001', null, '{"label":"Closed Won"}', 't46:e6', 1, now());

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
do $$ declare f text; begin
  if has_table_privilege('authenticated', 'public.portal_email_outbox', 'SELECT')
     or has_table_privilege('anon', 'public.portal_email_outbox', 'SELECT')
     or has_table_privilege('authenticated', 'public.portal_email_outbox', 'INSERT') then
    raise exception 'portal_email_outbox must be invisible to anon and authenticated';
  end if;
  foreach f in array array[
    'public.claim_portal_emails(integer)',
    'public.mark_portal_email(uuid, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Shape rules.
do $$ begin
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'bogus', 'a046b000-0000-0000-0000-000000000001', 't46:bad1')$q$, 'portal_email_outbox_kind_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, recipient_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'partner_received', 'a0460000-0000-0000-0000-000000000002', 't46:bad2')$q$, 'portal_email_outbox_recipient_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'partner_received', 'a046b000-0000-0000-0000-000000000001', 't46:e1')$q$, 'portal_email_outbox_dedupe_key_key');
end $$;

-- Claim: E1 and E3 come back with their current address; E2 and E4 are dropped.
do $$ declare got text[]; n int; r record; begin
  select array_agg(c.id::text || '=' || c.recipient || '#' || c.attempts order by c.id) into got
    from public.claim_portal_emails(10) c;
  if got <> array[
    'a046e000-0000-0000-0000-000000000001=jane@outbox.example#1',
    'a046e000-0000-0000-0000-000000000003=rita@outbox.example#1'] then
    raise exception 'first claim should return E1 and E3 with attempts 1, got %', got;
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000002';
  if r.dropped_at is null or r.last_error is distinct from 'recipient_inactive' or r.attempts <> 0 then
    raise exception 'a suspended partner''s row should be dropped untouched: %', row_to_json(r);
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000004';
  if r.dropped_at is null or r.last_error is distinct from 'recipient_inactive' then
    raise exception 'a deactivated rep''s row should be dropped: %', row_to_json(r);
  end if;
  if (select last_attempt_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001') is null then
    raise exception 'a claimed row should record last_attempt_at';
  end if;

  -- Immediately again: everything claimable is inside its backoff.
  select count(*) into n from public.claim_portal_emails(10);
  if n <> 0 then raise exception 'an immediate second claim must return nothing, got %', n; end if;
end $$;

-- Backoff passes: E1 comes back with attempts 2. E5 (attempts 5) and E6 (sent) never do.
do $$ declare got text[]; begin
  update portal_email_outbox set last_attempt_at = now() - interval '10 minutes'
   where id in ('a046e000-0000-0000-0000-000000000001', 'a046e000-0000-0000-0000-000000000005');
  update portal_email_outbox set last_attempt_at = now() - interval '10 minutes'
   where id = 'a046e000-0000-0000-0000-000000000003';
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000003', 'sent', null);
  select array_agg(c.id::text || '#' || c.attempts order by c.id) into got from public.claim_portal_emails(10) c;
  if got <> array['a046e000-0000-0000-0000-000000000001#2'] then
    raise exception 'after the backoff only E1 should come back, got %', got;
  end if;
  if (select sent_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000003') is null then
    raise exception 'mark sent should stamp sent_at';
  end if;
end $$;

-- Failures: last_error always; failed_at only from the fifth attempt.
do $$ declare r record; begin
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'failed', 'boom');
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001';
  if r.last_error is distinct from 'boom' or r.failed_at is not null then
    raise exception 'a failure before attempt 5 keeps the row retryable: %', row_to_json(r);
  end if;
  update portal_email_outbox set attempts = 5 where id = 'a046e000-0000-0000-0000-000000000001';
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'failed', '   ');
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001';
  if r.failed_at is null or r.last_error is distinct from 'send_failed' then
    raise exception 'the fifth failure should give up with the default error: %', row_to_json(r);
  end if;
  -- A settled row does not change again.
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'sent', null);
  if (select sent_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001') is not null then
    raise exception 'a failed row must not flip to sent';
  end if;
  perform _t_raises($q$select public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'maybe', null)$q$, 'invalid_outcome');
end $$;

-- Dropped by the drain (email guard), and the batch limit.
do $$ declare n int; r record; begin
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  select '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:batch' || g
    from generate_series(1, 3) g;
  select count(*) into n from public.claim_portal_emails(2);
  if n <> 2 then raise exception 'p_limit should cap the batch, got %', n; end if;
  select count(*) into n from public.claim_portal_emails(0);
  if n <> 1 then raise exception 'a limit below 1 is clamped to 1, got %', n; end if;

  perform public.mark_portal_email((select id from portal_email_outbox where dedupe_key = 't46:batch1'), 'dropped', 'email_guard');
  select * into r from portal_email_outbox where dedupe_key = 't46:batch1';
  if r.dropped_at is null or r.last_error is distinct from 'email_guard' then
    raise exception 'mark dropped should stamp dropped_at with the reason: %', row_to_json(r);
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/046_portal_email_outbox.sql`
Expected: FAIL with `relation "portal_email_outbox" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000002_portal_email_outbox.sql`:

```sql
-- 20261014000002_portal_email_outbox.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief E1/E4/E5): one outbox for every
-- portal-related email. Rows are written only by SQL (the enqueue triggers in
-- 20261014000003 and enqueue_portal_nudges in 20261014000004) and drained by
-- the portal_notify edge function every 2 minutes.
--
-- A row never stores an email address. claim_portal_emails resolves the
-- recipient when the email is about to go out, so a partner suspended (or a rep
-- deactivated) after the row was queued gets nothing.
--
-- Service role only: anon and authenticated have no access to the table or the
-- functions.

create table portal_email_outbox (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  kind              text not null constraint portal_email_outbox_kind_check check (kind in (
                      'partner_received','partner_accepted','partner_not_moving_forward',
                      'partner_closed_won','partner_withdrawn','partner_update',
                      'internal_new_referral','internal_nudge')),
  referral_id       uuid references referrals(id) on delete cascade,
  portal_user_id    uuid references portal_users(id) on delete cascade,
  recipient_user_id uuid references profiles(id) on delete cascade,
  -- Allowlisted fields only (brief E1); built in SQL, re-validated in TS.
  payload           jsonb not null default '{}'::jsonb,
  dedupe_key        text not null constraint portal_email_outbox_dedupe_key_key unique,
  created_at        timestamptz not null default now(),
  attempts          integer not null default 0,
  last_attempt_at   timestamptz,
  last_error        text,
  sent_at           timestamptz,
  -- Deliberately not sent: email guard, recipient lost access, invalid payload.
  dropped_at        timestamptz,
  -- Gave up after 5 failed sends.
  failed_at         timestamptz,
  constraint portal_email_outbox_recipient_check check (
    case when kind like 'partner\_%'
         then portal_user_id is not null and recipient_user_id is null
         else recipient_user_id is not null and portal_user_id is null
    end)
);

create index portal_email_outbox_pending_idx on portal_email_outbox (created_at, id)
  where sent_at is null and dropped_at is null and failed_at is null;
create index portal_email_outbox_org_idx on portal_email_outbox (org_id, created_at);

alter table portal_email_outbox enable row level security;
revoke all on portal_email_outbox from anon;
revoke all on portal_email_outbox from authenticated;

-- Claim a batch. FOR UPDATE SKIP LOCKED lets two overlapping drains take
-- different rows; the attempts bump plus the backoff (2 minutes per attempt so
-- far) keeps a row from being picked again by the next run while its send is in
-- flight. Unreachable recipients are dropped in the same statement.
create or replace function public.claim_portal_emails(p_limit integer)
returns table (
  id uuid, org_id uuid, kind text, referral_id uuid, payload jsonb, recipient text, attempts integer
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return query
  with picked as (
    select o.id
      from portal_email_outbox o
     where o.sent_at is null and o.dropped_at is null and o.failed_at is null
       and o.attempts < 5
       and (o.last_attempt_at is null
            or o.last_attempt_at <= now() - make_interval(mins => 2 * o.attempts))
     order by o.created_at, o.id
     limit v_limit
       for update skip locked
  ),
  resolved as (
    select o.id,
           case when o.portal_user_id is not null then pu.email else pr.email end as email,
           case when o.portal_user_id is not null
                then coalesce(pu.status = 'active' and org.portal_enabled and not org.is_disabled, false)
                else coalesce(pr.deactivated_at is null and pr.org_id = o.org_id
                              and pr.email is not null and not org.is_disabled, false)
           end as live
      from portal_email_outbox o
      join picked k on k.id = o.id
      join organizations org on org.id = o.org_id
      left join portal_users pu on pu.id = o.portal_user_id and pu.org_id = o.org_id
      left join profiles pr on pr.id = o.recipient_user_id
  ),
  dropped as (
    update portal_email_outbox o
       set dropped_at = now(), last_error = 'recipient_inactive'
      from resolved r
     where r.id = o.id and not r.live
    returning o.id
  ),
  claimed as (
    update portal_email_outbox o
       set attempts = o.attempts + 1, last_attempt_at = now()
      from resolved r
     where r.id = o.id and r.live
    returning o.id, o.org_id, o.kind, o.referral_id, o.payload, r.email, o.attempts
  )
  select c.id, c.org_id, c.kind, c.referral_id, c.payload, c.email, c.attempts from claimed c;
end $$;

-- Settle a claimed row. Only an unsettled row changes, so a late or repeated
-- mark never flips a sent, dropped or failed row.
create or replace function public.mark_portal_email(p_id uuid, p_outcome text, p_error text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_outcome = 'sent' then
    update portal_email_outbox o
       set sent_at = now(), last_error = null
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  elsif p_outcome = 'dropped' then
    update portal_email_outbox o
       set dropped_at = now(), last_error = coalesce(v_error, 'dropped')
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  elsif p_outcome = 'failed' then
    update portal_email_outbox o
       set last_error = coalesce(v_error, 'send_failed'),
           failed_at  = case when o.attempts >= 5 then now() else null end
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  else
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
end $$;

revoke execute on function public.claim_portal_emails(integer)          from public, anon, authenticated;
revoke execute on function public.mark_portal_email(uuid, text, text)   from public, anon, authenticated;
grant  execute on function public.claim_portal_emails(integer)          to service_role;
grant  execute on function public.mark_portal_email(uuid, text, text)   to service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/046_portal_email_outbox.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000002_portal_email_outbox.sql supabase/tests/046_portal_email_outbox.sql
git commit -m "$(cat <<'EOF'
feat(portal): email outbox with skip-locked claim and settle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Enqueue triggers (SQL)

**Files:**
- Create: `supabase/migrations/20261014000003_portal_email_enqueue.sql`
- Test: `supabase/tests/047_portal_email_enqueue.sql`

**Interfaces:**
- Consumes (SQL): Task 1 `referral_updates`; Task 2 `portal_email_outbox`; 1B `public._portal_referral_ref(uuid) returns text`; the `navigatr.referral_actor` setting (`'partner'` while a partner writes, set by `portal_submit_referral` and `portal_withdraw_referral`).
- Produces (SQL, all private: revoked from `public, anon, authenticated, service_role`):
  - `public._portal_status_label(p_status referral_status) returns text`: `submitted` Received, `accepted` Accepted, `working` In Progress, `won` Closed Won, `lost` and `declined` Not Moving Forward, `withdrawn` Withdrawn (mirrors `_shared/portalLabels.ts`).
  - `public._portal_review_recipients(p_org uuid, p_assignee uuid) returns table (user_id uuid)`: the assignee when active in the org, otherwise every active administrator of the org.
  - `public._portal_partner_payload(p_referral uuid, p_status referral_status, p_update_body text) returns jsonb` with exactly the keys `slug, orgName, partnerName, companyName, ref, label, valueCents, repName, repEmail, updateBody` (brief E1). `valueCents` is the linked deal's `value_cents` only when `p_status = 'won'` and `organizations.partner_value_visibility`; otherwise null.
  - `public._portal_enqueue_partner(p_referral referrals, p_kind text, p_dedupe text, p_update_body text) returns void`: queues one partner row when the referral is inbound and unpurged and its partner has an `active` portal user while the portal is on; `on conflict (dedupe_key) do nothing`.
  - `public._portal_enqueue_new_referral(p_referral referrals) returns void`: one `internal_new_referral` row per review recipient with payload `{appUrlPath: "/partners", companyNames: [company], count: 1}`.
  - Trigger functions `referrals_enqueue_insert_email()`, `referrals_enqueue_status_email()`, `referral_updates_enqueue_email()` and their triggers (AFTER INSERT on `referrals`; AFTER UPDATE OF status on `referrals`; AFTER INSERT on `referral_updates`).
- Dedupe keys: `partner_received:<referral>`, `<kind>:<referral>:<to_status>` for status mail, `partner_update:<referral>:<update>`, `internal_new_referral:<referral>:<user>`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/047_portal_email_enqueue.sql`:

```sql
-- Tests for 20261014000003_portal_email_enqueue (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/047_portal_email_enqueue.sql
-- Self-cleans via ROLLBACK. Runs as postgres: every write below fires the
-- triggers exactly as the SECURITY DEFINER RPCs would.
--
-- Fixture (org portal-mail "Mail ISO", portal on, value hidden):
--   admins ad1, ad2 (active) and ad3 (deactivated); rep rita under ad1.
--   P1 (owner rita) has an ACTIVE portal user; P2 has no portal user; P3 has a
--   SUSPENDED one. Deals D1 (value 5000.00) and D2 (value 2500.00), owner rita.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001047', 'Mail ISO', 'portal-mail', 'portal-mail-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0470000-0000-0000-0000-000000000001', 'ad1@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000002', 'ad2@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000003', 'ad3@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000004', 'rita@mail.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0470000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada One',  'ad1@mail.example',  'mailad1'::ltree,      null, null),
  ('a0470000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada Two',  'ad2@mail.example',  'mailad2'::ltree,      null, null),
  ('a0470000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada Gone', 'ad3@mail.example',  'mailad3'::ltree,      null, now()),
  ('a0470000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001047', 'rep',   'sales_professional', 'Rita Rep', 'rita@mail.example', 'mailad1.rita'::ltree, 'a0470000-0000-0000-0000-000000000001', null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a047a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@mail.example'),
  ('a047a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@mail.example'),
  ('a047a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Sus CPA',  'Sus & Co',  'cpa', 'sus@mail.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a047b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a047a000-0000-0000-0000-000000000001', 'jane@mail.example', 'active'),
  ('a047b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'a047a000-0000-0000-0000-000000000003', 'sus@mail.example',  'suspended');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a047d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'Fresh Bakery', '5 Oak St', 'Ann', 'ann@fresh.example', '5550470001', 500000, 'contacted', 'partner_referral'),
  ('a047d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'Gold Gym',     '7 Elm St', 'Gil', 'gil@gold.example',  '5550470002', 250000, 'contacted', 'partner_referral');

create or replace function _t_rows(p_referral uuid, p_kind text) returns int language sql as $$
  select count(*)::int from portal_email_outbox where referral_id = p_referral and kind = p_kind
$$;

create or replace function _t_payload(p_referral uuid, p_kind text) returns jsonb language sql as $$
  select payload from portal_email_outbox where referral_id = p_referral and kind = p_kind
$$;

-- Privileges: every helper and trigger function is private.
do $$ declare f text; begin
  foreach f in array array[
    'public._portal_status_label(referral_status)',
    'public._portal_review_recipients(uuid, uuid)',
    'public._portal_partner_payload(uuid, referral_status, text)',
    'public._portal_enqueue_partner(referrals, text, text, text)',
    'public._portal_enqueue_new_referral(referrals)',
    'public.referrals_enqueue_insert_email()',
    'public.referrals_enqueue_status_email()',
    'public.referral_updates_enqueue_email()'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role must not execute private %', f; end if;
  end loop;
end $$;

-- Labels mirror portalLabels.ts.
do $$ begin
  if public._portal_status_label('submitted') <> 'Received'
     or public._portal_status_label('accepted') <> 'Accepted'
     or public._portal_status_label('working') <> 'In Progress'
     or public._portal_status_label('won') <> 'Closed Won'
     or public._portal_status_label('lost') <> 'Not Moving Forward'
     or public._portal_status_label('declined') <> 'Not Moving Forward'
     or public._portal_status_label('withdrawn') <> 'Withdrawn' then
    raise exception 'SQL labels drifted from portalLabels.ts';
  end if;
end $$;

-- 1. A portal submission: "received" to the partner, "new referral" to the assignee.
do $$ declare p jsonb; keys text[]; begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, notes, decline_note) values
    ('a047f000-0000-0000-0000-000000000001', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fresh Bakery',
     'a0470000-0000-0000-0000-000000000004', 'SECRET partner note', 'SECRET decline note');

  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_received') <> 1 then raise exception 'portal submission should queue one received email'; end if;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_received');
  select array_agg(k order by k) into keys from jsonb_object_keys(p) k;
  if keys <> array['companyName','label','orgName','partnerName','ref','repEmail','repName','slug','updateBody','valueCents'] then
    raise exception 'partner payload keys must be the allowlist, got %', keys;
  end if;
  if p->>'slug' <> 'portal-mail' or p->>'orgName' <> 'Mail ISO' or p->>'partnerName' <> 'Jane CPA'
     or p->>'companyName' <> 'Fresh Bakery' or p->>'label' <> 'Received'
     or p->>'ref' <> 'REF-A047F000' or p->>'repName' <> 'Rita Rep' or p->>'repEmail' <> 'rita@mail.example'
     or jsonb_typeof(p->'valueCents') <> 'null' or jsonb_typeof(p->'updateBody') <> 'null' then
    raise exception 'received payload wrong: %', p;
  end if;
  if p::text like '%SECRET%' then raise exception 'payload must never carry notes or reasons: %', p; end if;
  if (select portal_user_id from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'partner_received')
     is distinct from 'a047b000-0000-0000-0000-000000000001' then
    raise exception 'received email should go to the partner''s portal user';
  end if;

  if (select count(*) from portal_email_outbox
       where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'internal_new_referral'
         and recipient_user_id = 'a0470000-0000-0000-0000-000000000004') <> 1 then
    raise exception 'the assignee should get one new-referral email';
  end if;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'internal_new_referral');
  select array_agg(k order by k) into keys from jsonb_object_keys(p) k;
  if keys <> array['appUrlPath','companyNames','count'] or p <> '{"appUrlPath":"/partners","companyNames":["Fresh Bakery"],"count":1}'::jsonb then
    raise exception 'internal payload wrong: %', p;
  end if;
end $$;

-- 2. No portal access, or suspended access: no partner mail, internal mail still goes.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000002', 'a047a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'No Portal Co',  'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000003', 'a047a000-0000-0000-0000-000000000003', 'inbound', 'portal_signed_in', 'submitted', 'Suspended Co', 'a0470000-0000-0000-0000-000000000004');
  if exists (select 1 from portal_email_outbox
              where referral_id in ('a047f000-0000-0000-0000-000000000002', 'a047f000-0000-0000-0000-000000000003')
                and kind like 'partner\_%') then
    raise exception 'partners without active portal access must get no email';
  end if;
  if _t_rows('a047f000-0000-0000-0000-000000000002', 'internal_new_referral') <> 1 then
    raise exception 'the rep still hears about a referral whose partner has no portal access';
  end if;
end $$;

-- 3. Administrator queue: every active administrator, nobody deactivated.
do $$ declare got uuid[]; begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000004', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Queue Co', null);
  select array_agg(recipient_user_id order by recipient_user_id) into got
    from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000004' and kind = 'internal_new_referral';
  if got <> array['a0470000-0000-0000-0000-000000000001'::uuid, 'a0470000-0000-0000-0000-000000000002'::uuid] then
    raise exception 'admin-queue referral should mail ad1 and ad2 only, got %', got;
  end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000004', 'partner_received'))->'repName' <> 'null'::jsonb then
    raise exception 'an unassigned referral has no rep in the partner email';
  end if;
end $$;

-- 4. Rep-logged and outbound referrals send nothing on creation.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000005', 'a047a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'submitted', 'Logged Co', 'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000006', 'a047a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'submitted', 'Out Co',    'a0470000-0000-0000-0000-000000000004');
  if exists (select 1 from portal_email_outbox
              where referral_id in ('a047f000-0000-0000-0000-000000000005', 'a047f000-0000-0000-0000-000000000006')) then
    raise exception 'rep-logged or outbound referrals must not email on creation';
  end if;
end $$;

-- 5. Status changes: accepted, In Progress is silent, Closed Won without value, dedupe on a re-win.
do $$ declare p jsonb; begin
  update referrals set status = 'accepted', deal_id = 'a047d000-0000-0000-0000-000000000001'
   where id = 'a047f000-0000-0000-0000-000000000001';
  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_accepted') <> 1 then raise exception 'accept should queue one email'; end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000001', 'partner_accepted'))->>'label' <> 'Accepted' then
    raise exception 'accepted email should carry the Accepted label';
  end if;

  update referrals set status = 'working' where id = 'a047f000-0000-0000-0000-000000000001';
  if (select count(*) from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'In Progress must not email (expected received, new referral, accepted only)';
  end if;

  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000001';
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_closed_won');
  if p->>'label' <> 'Closed Won' or jsonb_typeof(p->'valueCents') <> 'null' then
    raise exception 'closed won with value hidden must carry no value: %', p;
  end if;

  update referrals set status = 'working' where id = 'a047f000-0000-0000-0000-000000000001';
  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000001';
  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_closed_won') <> 1 then
    raise exception 'a reopen and re-win must not send a second Closed Won';
  end if;
end $$;

-- 6. Value shown only when the ISO allows it.
do $$ declare p jsonb; begin
  update organizations set partner_value_visibility = true where id = '00000000-0000-0000-0000-000000001047';
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000007', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Gold Gym', 'a0470000-0000-0000-0000-000000000004');
  update referrals set status = 'accepted', deal_id = 'a047d000-0000-0000-0000-000000000002' where id = 'a047f000-0000-0000-0000-000000000007';
  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000007';
  p := _t_payload('a047f000-0000-0000-0000-000000000007', 'partner_closed_won');
  if (p->>'valueCents')::bigint is distinct from 250000 then raise exception 'closed won should carry the value when allowed: %', p; end if;
  if jsonb_typeof((_t_payload('a047f000-0000-0000-0000-000000000007', 'partner_accepted'))->'valueCents') <> 'null' then
    raise exception 'only Closed Won ever carries a value';
  end if;
end $$;

-- 7. Not moving forward (lost or declined), withdrawn by the ISO vs by the partner.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000008', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Lost Co',     'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000009', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Declined Co', 'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-00000000000a', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Pulled Co',   'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-00000000000b', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Self Co',     'a0470000-0000-0000-0000-000000000004');
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000008';
  update referrals set status = 'lost'     where id = 'a047f000-0000-0000-0000-000000000008';
  update referrals set status = 'declined', decline_reason = 'outside_icp', decline_note = 'SECRET reason'
   where id = 'a047f000-0000-0000-0000-000000000009';
  if (_t_payload('a047f000-0000-0000-0000-000000000008', 'partner_not_moving_forward'))->>'label' <> 'Not Moving Forward'
     or (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))->>'label' <> 'Not Moving Forward' then
    raise exception 'lost and declined should both send Not Moving Forward';
  end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))::text like '%outside_icp%'
     or (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))::text like '%SECRET%' then
    raise exception 'a decline reason must never reach the payload';
  end if;

  update referrals set status = 'withdrawn' where id = 'a047f000-0000-0000-0000-00000000000a';
  if _t_rows('a047f000-0000-0000-0000-00000000000a', 'partner_withdrawn') <> 1 then
    raise exception 'a withdrawal by the ISO should email the partner';
  end if;

  perform set_config('navigatr.referral_actor', 'partner', true);
  update referrals set status = 'withdrawn' where id = 'a047f000-0000-0000-0000-00000000000b';
  perform set_config('navigatr.referral_actor', '', true);
  if _t_rows('a047f000-0000-0000-0000-00000000000b', 'partner_withdrawn') <> 0 then
    raise exception 'a partner who withdrew their own referral gets no email';
  end if;
end $$;

-- 8. A rep-logged referral emails on status changes; an outbound one never does.
do $$ begin
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000005';
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000006';
  if _t_rows('a047f000-0000-0000-0000-000000000005', 'partner_accepted') <> 1 then
    raise exception 'a rep-logged inbound referral should email its partner when accepted';
  end if;
  if exists (select 1 from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000006') then
    raise exception 'an outbound referral must never email';
  end if;
end $$;

-- 9. A published update: one email with the body and the current label.
do $$ declare v_update uuid; p jsonb; begin
  insert into referral_updates (org_id, referral_id, author_user_id, body) values
    ('00000000-0000-0000-0000-000000001047', 'a047f000-0000-0000-0000-000000000001', 'a0470000-0000-0000-0000-000000000004', 'Demo booked for Tuesday')
  returning id into v_update;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_update');
  if p->>'updateBody' <> 'Demo booked for Tuesday' or p->>'label' <> 'Closed Won' then
    raise exception 'update email wrong: %', p;
  end if;
  if (select dedupe_key from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'partner_update')
     <> 'partner_update:a047f000-0000-0000-0000-000000000001:' || v_update::text then
    raise exception 'update dedupe key should name the update';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/047_portal_email_enqueue.sql`
Expected: FAIL with `function public._portal_status_label(referral_status) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000003_portal_email_enqueue.sql`:

```sql
-- 20261014000003_portal_email_enqueue.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief E1/E2): decide every referral email
-- in SQL, at the moment the change commits, and queue it in portal_email_outbox.
--
--   AFTER INSERT on referrals (portal submissions only):
--     partner_received        to the partner (when they have active portal access)
--     internal_new_referral   to the assignee, or every active administrator
--   AFTER UPDATE OF status on referrals (inbound only):
--     accepted                partner_accepted
--     won                     partner_closed_won (value only when the ISO allows it)
--     lost, declined          partner_not_moving_forward
--     withdrawn               partner_withdrawn, unless the partner withdrew it
--     submitted, working      nothing (In Progress would be noise)
--   AFTER INSERT on referral_updates:
--     partner_update          the published text and the current label
--
-- Payloads carry only the brief E1 allowlist: never a stage, a decline reason, a
-- note, or anything another partner sent. Dedupe keys make a retried or repeated
-- transition harmless (a reopen and re-win sends Closed Won once).

-- Labels: the SQL mirror of _shared/portalLabels.ts (tested in 047).
create or replace function public._portal_status_label(p_status referral_status)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select case p_status
    when 'submitted' then 'Received'
    when 'accepted'  then 'Accepted'
    when 'working'   then 'In Progress'
    when 'won'       then 'Closed Won'
    when 'lost'      then 'Not Moving Forward'
    when 'declined'  then 'Not Moving Forward'
    when 'withdrawn' then 'Withdrawn'
  end
$$;

-- Who reviews a referral: its assignee while active in the org; otherwise
-- (administrator queue, or a deactivated assignee) every active administrator.
create or replace function public._portal_review_recipients(p_org uuid, p_assignee uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public, extensions as $$
  select p.id
    from profiles p
   where p.id = p_assignee and p.org_id = p_org and p.deactivated_at is null
  union all
  select p.id
    from profiles p
   where p.org_id = p_org and p.role_level = 'administrator' and p.deactivated_at is null
     and not exists (select 1 from profiles a
                      where a.id = p_assignee and a.org_id = p_org and a.deactivated_at is null)
$$;

-- The partner email payload (brief E1). Exactly ten keys, always present.
create or replace function public._portal_partner_payload(p_referral uuid, p_status referral_status, p_update_body text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
           'slug',        o.slug,
           'orgName',     o.name,
           'partnerName', p.name,
           'companyName', r.company_name,
           'ref',         public._portal_referral_ref(r.id),
           'label',       public._portal_status_label(p_status),
           'valueCents',  case when p_status = 'won' and o.partner_value_visibility then d.value_cents end,
           'repName',     pr.full_name,
           'repEmail',    pr.email,
           'updateBody',  p_update_body)
    from referrals r
    join organizations o on o.id = r.org_id
    join partners p on p.id = r.partner_id
    left join deals d on d.id = r.deal_id
    left join profiles pr on pr.id = r.assigned_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where r.id = p_referral
$$;

-- Queue one partner email, only for an inbound, unpurged referral whose partner
-- has ACTIVE portal access while the portal is on. Partners without portal
-- access get nothing (brief scope 3).
create or replace function public._portal_enqueue_partner(
  p_referral referrals, p_kind text, p_dedupe text, p_update_body text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_portal_user uuid;
begin
  if p_referral.direction <> 'inbound' or p_referral.purged_at is not null then
    return;
  end if;
  select u.id into v_portal_user
    from portal_users u
    join organizations o on o.id = u.org_id
   where u.partner_id = p_referral.partner_id and u.org_id = p_referral.org_id
     and u.status = 'active' and o.portal_enabled and not o.is_disabled;
  if v_portal_user is null then
    return;
  end if;
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key)
  values (p_referral.org_id, p_kind, p_referral.id, v_portal_user,
          public._portal_partner_payload(p_referral.id, p_referral.status, p_update_body), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- "New partner referral for you" (FR-PORT-80) to each review recipient.
create or replace function public._portal_enqueue_new_referral(p_referral referrals)
returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_email_outbox (org_id, kind, referral_id, recipient_user_id, payload, dedupe_key)
  select p_referral.org_id, 'internal_new_referral', p_referral.id, rcp.user_id,
         jsonb_build_object('appUrlPath', '/partners',
                            'companyNames', jsonb_build_array(p_referral.company_name),
                            'count', 1),
         'internal_new_referral:' || p_referral.id::text || ':' || rcp.user_id::text
    from public._portal_review_recipients(p_referral.org_id, p_referral.assigned_user_id) rcp
  on conflict (dedupe_key) do nothing
$$;

-- Triggers --------------------------------------------------------------------
create or replace function public.referrals_enqueue_insert_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.source = 'portal_signed_in' and new.direction = 'inbound' then
    perform public._portal_enqueue_partner(new, 'partner_received', 'partner_received:' || new.id::text, null);
    perform public._portal_enqueue_new_referral(new);
  end if;
  return new;
end $$;

create or replace function public.referrals_enqueue_status_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_kind  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'accepted'  then 'partner_accepted'
    when 'won'       then 'partner_closed_won'
    when 'lost'      then 'partner_not_moving_forward'
    when 'declined'  then 'partner_not_moving_forward'
    -- The partner already knows when they withdrew it themselves.
    when 'withdrawn' then case when v_actor = 'partner' then null else 'partner_withdrawn' end
    else null
  end;
  if v_kind is not null then
    perform public._portal_enqueue_partner(
      new, v_kind, v_kind || ':' || new.id::text || ':' || new.status::text, null);
  end if;
  return new;
end $$;

create or replace function public.referral_updates_enqueue_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r referrals;
begin
  select * into r from referrals where id = new.referral_id;
  if r.id is not null then
    perform public._portal_enqueue_partner(
      r, 'partner_update', 'partner_update:' || r.id::text || ':' || new.id::text, new.body);
  end if;
  return new;
end $$;

create trigger referrals_enqueue_insert_email
  after insert on referrals
  for each row execute function public.referrals_enqueue_insert_email();

create trigger referrals_enqueue_status_email
  after update of status on referrals
  for each row execute function public.referrals_enqueue_status_email();

create trigger referral_updates_enqueue_email
  after insert on referral_updates
  for each row execute function public.referral_updates_enqueue_email();

-- Privileges: all private. Triggers fire without an EXECUTE check.
revoke execute on function public._portal_status_label(referral_status)               from public, anon, authenticated, service_role;
revoke execute on function public._portal_review_recipients(uuid, uuid)               from public, anon, authenticated, service_role;
revoke execute on function public._portal_partner_payload(uuid, referral_status, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_partner(referrals, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_new_referral(referrals)             from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_insert_email()                    from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_status_email()                    from public, anon, authenticated, service_role;
revoke execute on function public.referral_updates_enqueue_email()                    from public, anon, authenticated, service_role;
```

- [ ] **Step 4: Run the new test and the referral tests it touches**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `047_portal_email_enqueue.sql PASS`, and `034` to `046` still PASS (the triggers fire inside the Phase 0 and 1B RPCs those tests call; every `postgres` caller can still read the outbox).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000003_portal_email_enqueue.sql supabase/tests/047_portal_email_enqueue.sql
git commit -m "$(cat <<'EOF'
feat(portal): queue partner and rep emails from referral changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Same-day nudge selection (SQL)

**Files:**
- Create: `supabase/migrations/20261014000004_portal_nudges.sql`
- Test: `supabase/tests/048_portal_nudges.sql`

**Interfaces:**
- Consumes (SQL): Task 2 `portal_email_outbox`; Task 3 `public._portal_review_recipients(uuid, uuid)`; `path_preferences (user_id, timezone text, end_of_day_minutes integer)`.
- Produces (SQL):
  - Table `public.referral_nudges (referral_id uuid, user_id uuid, nudged_at timestamptz, primary key (referral_id, user_id))`. No access for `anon` or `authenticated`.
  - `public._portal_local_tz(p_tz text) returns text` (private): `p_tz` when it is a known time zone name, else `'America/New_York'`.
  - `public.enqueue_portal_nudges(p_now timestamptz) returns integer`: service role only. For each review recipient (Task 3 rule), takes the referrals that are `submitted`, `portal_signed_in`, inbound, unpurged, in an enabled org, received on the recipient's local calendar day of `p_now` before the recipient's end of day (`coalesce(end_of_day_minutes, 1080)`, clamped to 1..1439), once the recipient's local time of `p_now` has reached that end of day, and not yet nudged to that recipient (an assigned referral also needs `nudged_at is null`). Queues ONE `internal_nudge` row per recipient and local day (payload `{appUrlPath: "/partners", companyNames: [...oldest first], count}`, dedupe `internal_nudge:<user>:<local day>`), logs every included referral in `referral_nudges`, stamps `referrals.nudged_at` where null, and returns the number of digests queued. Serialized by an advisory lock.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/048_portal_nudges.sql`:

```sql
-- Tests for 20261014000004_portal_nudges (Partner Portal Phase 1C, spec 5.9).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/048_portal_nudges.sql
-- Self-cleans via ROLLBACK. Runs as postgres with fixed clocks.
--
-- 2026-10-14 is in daylight time: New York UTC-4, Chicago UTC-5, Los Angeles UTC-7.
--   T1 = 2026-10-14 22:30Z = 18:30 New York, 17:30 Chicago, 15:30 Los Angeles
--   T2 = 2026-10-15 01:30Z = 21:30 New York, 18:30 Los Angeles (still Oct 14 there)
--   T3 = 2026-10-15 22:30Z = the next evening
--
-- Fixture (org portal-nudge): admNY and admLA administrators; repNY (no
-- preferences: New York, 18:00), repCHI (Chicago, ends 15:00), repBad (stored
-- zone "Mars/Base": falls back to New York), repGone (deactivated).
-- A second, disabled org has one referral that must never nudge.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, is_disabled) values
  ('00000000-0000-0000-0000-000000001048', 'Nudge Org',    'portal-nudge',   'portal-nudge-a1',   true, false),
  ('00000000-0000-0000-0000-000000001148', 'Nudge Org Off', 'portal-nudge-x', 'portal-nudge-x-a1', true, true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0480000-0000-0000-0000-000000000001', 'admny@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000002', 'admla@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000003', 'repny@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000004', 'repch@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000005', 'repbd@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000006', 'repgn@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000007', 'offad@nudge.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0480000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001048', 'admin', 'administrator',      'Adm NY',   'admny@nudge.example', 'ndgny'::ltree,       null, null),
  ('a0480000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001048', 'admin', 'administrator',      'Adm LA',   'admla@nudge.example', 'ndgla'::ltree,       null, null),
  ('a0480000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep NY',   'repny@nudge.example', 'ndgny.repny'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep CHI',  'repch@nudge.example', 'ndgny.repch'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep Bad',  'repbd@nudge.example', 'ndgny.repbd'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep Gone', 'repgn@nudge.example', 'ndgny.repgn'::ltree, 'a0480000-0000-0000-0000-000000000001', now()),
  ('a0480000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001148', 'admin', 'administrator',      'Off Adm',  'offad@nudge.example', 'ndgoff'::ltree,      null, null);

insert into path_preferences (user_id, timezone, end_of_day_minutes) values
  ('a0480000-0000-0000-0000-000000000001', 'America/New_York',    null),
  ('a0480000-0000-0000-0000-000000000002', 'America/Los_Angeles', null),
  ('a0480000-0000-0000-0000-000000000004', 'America/Chicago',     900),
  ('a0480000-0000-0000-0000-000000000005', 'Mars/Base',           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a048a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001048', 'a0480000-0000-0000-0000-000000000003', 'a0480000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@nudge.example'),
  ('a048a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001148', 'a0480000-0000-0000-0000-000000000007', 'a0480000-0000-0000-0000-000000000007', 'Off CPA',  'Off & Co',  'cpa', 'off@nudge.example');

insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at, nudged_at) values
  -- repNY
  ('a048f000-0000-0000-0000-000000000001', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Morning Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 14:00+00', null),
  ('a048f000-0000-0000-0000-000000000002', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Midday Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000003', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Evening Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 22:15+00', null),
  ('a048f000-0000-0000-0000-000000000004', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Yesterday Co', 'a0480000-0000-0000-0000-000000000003', '2026-10-13 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000005', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'accepted',  'Handled Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000006', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'submitted', 'Logged Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-00000000000c', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Nudged Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 16:00+00', '2026-10-14 20:00+00'),
  -- repCHI and repBad
  ('a048f000-0000-0000-0000-000000000007', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Chicago Co',   'a0480000-0000-0000-0000-000000000004', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000008', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fallback Co',  'a0480000-0000-0000-0000-000000000005', '2026-10-14 15:00+00', null),
  -- administrator queue: unassigned, and assigned to a deactivated rep
  ('a048f000-0000-0000-0000-000000000009', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Queue Co',     null,                                   '2026-10-14 14:30+00', null),
  ('a048f000-0000-0000-0000-00000000000a', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Orphan Co',    'a0480000-0000-0000-0000-000000000006', '2026-10-14 16:00+00', null),
  -- disabled org
  ('a048f000-0000-0000-0000-00000000000b', 'a048a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Off Co',       'a0480000-0000-0000-0000-000000000007', '2026-10-14 14:00+00', null);

create or replace function _t_digest(p_user uuid) returns jsonb language sql as $$
  select payload from portal_email_outbox where kind = 'internal_nudge' and recipient_user_id = p_user
$$;

-- Privileges.
do $$ begin
  if has_function_privilege('authenticated', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'enqueue_portal_nudges must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute enqueue_portal_nudges';
  end if;
  if has_function_privilege('service_role', 'public._portal_local_tz(text)', 'EXECUTE') then
    raise exception '_portal_local_tz is private';
  end if;
  if has_table_privilege('authenticated', 'public.referral_nudges', 'SELECT')
     or has_table_privilege('anon', 'public.referral_nudges', 'SELECT') then
    raise exception 'referral_nudges must be invisible to anon and authenticated';
  end if;
  if public._portal_local_tz('Mars/Base') <> 'America/New_York'
     or public._portal_local_tz(null) <> 'America/New_York'
     or public._portal_local_tz('America/Chicago') <> 'America/Chicago' then
    raise exception '_portal_local_tz should keep a real zone and default the rest to New York';
  end if;
end $$;

-- T1: repNY (two), repCHI, repBad, admNY (the queue). Not admLA yet (15:30 there).
do $$ declare n int; begin
  -- The submission trigger already queued new-referral emails; only digests count here.
  n := public.enqueue_portal_nudges('2026-10-14 22:30+00');
  if n <> 4 then raise exception 'T1 should queue 4 digests, got %', n; end if;

  if _t_digest('a0480000-0000-0000-0000-000000000003') <> '{"appUrlPath":"/partners","companyNames":["Morning Co","Midday Co"],"count":2}'::jsonb then
    raise exception 'repNY digest wrong (Evening Co came after 18:00, Yesterday Co was yesterday): %', _t_digest('a0480000-0000-0000-0000-000000000003');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000004') <> '{"appUrlPath":"/partners","companyNames":["Chicago Co"],"count":1}'::jsonb then
    raise exception 'repCHI digest wrong: %', _t_digest('a0480000-0000-0000-0000-000000000004');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000005') <> '{"appUrlPath":"/partners","companyNames":["Fallback Co"],"count":1}'::jsonb then
    raise exception 'repBad should fall back to New York: %', _t_digest('a0480000-0000-0000-0000-000000000005');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000001') <> '{"appUrlPath":"/partners","companyNames":["Queue Co","Orphan Co"],"count":2}'::jsonb then
    raise exception 'admNY should get the administrator queue: %', _t_digest('a0480000-0000-0000-0000-000000000001');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000002') is not null then raise exception 'admLA is not at end of day yet'; end if;
  if _t_digest('a0480000-0000-0000-0000-000000000007') is not null then raise exception 'a disabled org must not nudge'; end if;

  if (select dedupe_key from portal_email_outbox where kind = 'internal_nudge' and recipient_user_id = 'a0480000-0000-0000-0000-000000000003')
     <> 'internal_nudge:a0480000-0000-0000-0000-000000000003:2026-10-14' then
    raise exception 'digest dedupe key should be per user per local day';
  end if;

  if (select count(*) from referrals where nudged_at = '2026-10-14 22:30+00') <> 6 then
    raise exception 'the six nudged referrals should be stamped with the run time';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-000000000003') is not null then
    raise exception 'Evening Co was not nudged';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-00000000000c') <> '2026-10-14 20:00+00' then
    raise exception 'an already nudged referral keeps its first stamp';
  end if;
end $$;

-- Same clock again: nothing new.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-14 22:30+00') <> 0 then raise exception 'a second run must queue nothing'; end if;
end $$;

-- T2: admLA reaches end of day on Oct 14 and gets the queue too; nobody else.
do $$ declare n int; begin
  n := public.enqueue_portal_nudges('2026-10-15 01:30+00');
  if n <> 1 then raise exception 'T2 should queue only admLA''s digest, got %', n; end if;
  if _t_digest('a0480000-0000-0000-0000-000000000002') <> '{"appUrlPath":"/partners","companyNames":["Queue Co","Orphan Co"],"count":2}'::jsonb then
    raise exception 'admLA digest wrong: %', _t_digest('a0480000-0000-0000-0000-000000000002');
  end if;
  if (select count(*) from referral_nudges where referral_id = 'a048f000-0000-0000-0000-000000000009') <> 2 then
    raise exception 'the queue item should be logged once per administrator';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-000000000009') <> '2026-10-14 22:30+00' then
    raise exception 'nudged_at keeps the first nudge';
  end if;
end $$;

-- T3: the next evening. Evening Co is yesterday's now; nothing is due.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 0 then raise exception 'T3 should queue nothing'; end if;
end $$;

-- A referral reassigned after its nudge is not nudged again to the new assignee.
do $$ begin
  update referrals set assigned_user_id = 'a0480000-0000-0000-0000-000000000004', submitted_at = '2026-10-15 15:00+00'
   where id = 'a048f000-0000-0000-0000-000000000001';
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 0 then
    raise exception 'a nudged referral is never nudged a second time';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/048_portal_nudges.sql`
Expected: FAIL with `relation "public.referral_nudges" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000004_portal_nudges.sql`:

```sql
-- 20261014000004_portal_nudges.sql
--
-- Partner Portal Phase 1C (spec 5.9, rulings R4 and R5): the same-day nudge.
-- Once a reviewer's local time passes their end of day, they get ONE digest of
-- the partner referrals received that day (before end of day) that are still
-- waiting. Assigned referrals nudge their assignee; administrator-queue items
-- (and items whose assignee was deactivated) nudge every active administrator,
-- each in their own time zone. No reassignment, no escalation.
--
-- Time zone: path_preferences.timezone, default America/New_York (also for a
-- stored value Postgres does not know). End of day: path_preferences.
-- end_of_day_minutes, default 1080 (18:00), the same default the app uses
-- (DEFAULT_END_OF_DAY_MINUTES in apps/app/src/features/path/lib/pathCapacityDefaults.ts).
--
-- referral_nudges remembers who was nudged about what, because an
-- administrator-queue item nudges several people at different times.
-- referrals.nudged_at keeps the first nudge, and an assigned referral is only
-- nudged while it is null, so each referral is nudged once per reviewer role.
--
-- portal_notify calls enqueue_portal_nudges(now()) every 2 minutes. p_now is a
-- parameter so 048 can test it with fixed clocks.

create table referral_nudges (
  referral_id uuid not null references referrals(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  nudged_at   timestamptz not null default now(),
  primary key (referral_id, user_id)
);
alter table referral_nudges enable row level security;
revoke all on referral_nudges from anon;
revoke all on referral_nudges from authenticated;

create index if not exists referrals_nudge_candidates_idx
  on referrals (submitted_at)
  where status = 'submitted' and source = 'portal_signed_in';

create or replace function public._portal_local_tz(p_tz text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select n.name from pg_timezone_names n where n.name = p_tz), 'America/New_York')
$$;

create or replace function public.enqueue_portal_nudges(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_count integer := 0;
  v_id    uuid;
  rec     record;
begin
  -- One selection at a time: two overlapping drains must not both build a digest.
  perform pg_advisory_xact_lock(hashtextextended('portal_nudges', 0));

  for rec in
    with cand as (
      select r.id, r.org_id, r.company_name, r.submitted_at, r.assigned_user_id, r.nudged_at
        from referrals r
        join organizations o on o.id = r.org_id
       where r.status = 'submitted' and r.source = 'portal_signed_in' and r.direction = 'inbound'
         and r.purged_at is null and not o.is_disabled
         -- "Today" in any time zone lies inside the last two days.
         and r.submitted_at > v_now - interval '2 days' and r.submitted_at <= v_now
    ),
    pairs as (
      select c.*, rcp.user_id
        from cand c
        cross join lateral public._portal_review_recipients(c.org_id, c.assigned_user_id) rcp
    ),
    zoned as (
      select pr.*,
             public._portal_local_tz(pp.timezone) as tz,
             least(greatest(coalesce(pp.end_of_day_minutes, 1080), 1), 1439) as eod
        from pairs pr
        left join path_preferences pp on pp.user_id = pr.user_id
    ),
    due as (
      select z.*
        from zoned z
       where (z.submitted_at at time zone z.tz)::date = (v_now at time zone z.tz)::date
         and (z.submitted_at at time zone z.tz)::time < make_time(z.eod / 60, z.eod % 60, 0)
         and (v_now at time zone z.tz)::time >= make_time(z.eod / 60, z.eod % 60, 0)
         -- An assigned referral nudges its assignee once; queue items are gated by the log.
         and (z.user_id is distinct from z.assigned_user_id or z.nudged_at is null)
         and not exists (select 1 from referral_nudges n where n.referral_id = z.id and n.user_id = z.user_id)
    )
    select d.org_id,
           d.user_id,
           (v_now at time zone d.tz)::date as local_day,
           array_agg(d.id order by d.submitted_at, d.id) as referral_ids,
           jsonb_agg(d.company_name order by d.submitted_at, d.id) as company_names
      from due d
     group by d.org_id, d.user_id, d.tz
  loop
    v_id := null;
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    values (rec.org_id, 'internal_nudge', rec.user_id,
            jsonb_build_object('appUrlPath', '/partners',
                               'companyNames', rec.company_names,
                               'count', jsonb_array_length(rec.company_names)),
            'internal_nudge:' || rec.user_id::text || ':' || rec.local_day::text)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_count := v_count + 1;
    end if;

    insert into referral_nudges (referral_id, user_id, nudged_at)
    select unnest(rec.referral_ids), rec.user_id, v_now
    on conflict (referral_id, user_id) do nothing;

    update referrals set nudged_at = v_now
     where id = any(rec.referral_ids) and nudged_at is null;
  end loop;

  return v_count;
end $$;

revoke execute on function public._portal_local_tz(text)                from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_nudges(timestamptz)    from public, anon, authenticated;
grant  execute on function public.enqueue_portal_nudges(timestamptz)    to service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/048_portal_nudges.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000004_portal_nudges.sql supabase/tests/048_portal_nudges.sql
git commit -m "$(cat <<'EOF'
feat(portal): same-day nudge for partner referrals still waiting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The sign-in code row carries the ISO's brand (SQL)

**Files:**
- Create: `supabase/migrations/20261014000005_portal_code_email_brand.sql`
- Test: `supabase/tests/049_portal_code_email_brand.sql`

**Interfaces:**
- Consumes (SQL, 1A/1B): `public._portal_audit(uuid, uuid, portal_audit_action, text, uuid)`, `public._portal_hash(text)`, table `org_branding (org_id, logo_url, primary_color)`.
- Produces (SQL): `public.portal_issue_code(p_slug text, p_email text, p_ip text) returns table (code text, recipient text, org_name text, org_slug text, logo_url text, primary_color text)`. Same body, limits, audit and privileges as 20261012000002; the two new columns are the org's `org_branding.logo_url` and `primary_color` (null without a branding row). The return type changes, so the function is dropped and recreated in one migration.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/049_portal_code_email_brand.sql`:

```sql
-- Tests for 20261014000005_portal_code_email_brand (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/049_portal_code_email_brand.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only function).
--
-- Fixture: org portal-brand (with a branding row) and org portal-plain (without),
-- each with one active portal user.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001049', 'Brand ISO', 'portal-brand', 'portal-brand-a1', true),
  ('00000000-0000-0000-0000-000000001149', 'Plain ISO', 'portal-plain', 'portal-plain-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0490000-0000-0000-0000-000000000001', 'boss@brand.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0490000-0000-0000-0000-000000000002', 'boss@plain.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0490000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'admin', 'administrator', 'Boss', 'boss@brand.example', 'brandboss'::ltree),
  ('a0490000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'admin', 'administrator', 'Boss', 'boss@plain.example', 'plainboss'::ltree);

insert into org_branding (org_id, logo_url, primary_color) values
  ('00000000-0000-0000-0000-000000001049', 'https://cdn.example/brand-iso.png', '#0A7C45');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a049a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'a0490000-0000-0000-0000-000000000001', 'a0490000-0000-0000-0000-000000000001', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@brand.example'),
  ('a049a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'a0490000-0000-0000-0000-000000000002', 'a0490000-0000-0000-0000-000000000002', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@plain.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a049b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'a049a000-0000-0000-0000-000000000001', 'jane@brand.example', 'active'),
  ('a049b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'a049a000-0000-0000-0000-000000000002', 'pat@plain.example',  'active');

-- Privileges survive the drop and recreate.
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'authenticated must not execute portal_issue_code'; end if;
  if has_function_privilege('anon', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'anon must not execute portal_issue_code'; end if;
  if not has_function_privilege('service_role', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'service_role should execute portal_issue_code'; end if;
end $$;

-- A branded org returns its logo and color with the code.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-brand', 'jane@brand.example', '10.49.0.1');
  if r.code is null or r.code !~ '^\d{6}$' then raise exception 'a code should still be issued, got %', r.code; end if;
  if r.recipient <> 'jane@brand.example' or r.org_name <> 'Brand ISO' or r.org_slug <> 'portal-brand' then
    raise exception 'the 1A columns must be unchanged: %', row_to_json(r);
  end if;
  if r.logo_url is distinct from 'https://cdn.example/brand-iso.png' or r.primary_color is distinct from '#0A7C45' then
    raise exception 'the brand columns are wrong: %', row_to_json(r);
  end if;
end $$;

-- An org without a branding row returns nulls.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-plain', 'pat@plain.example', '10.49.0.2');
  if r.code is null then raise exception 'plain org should still issue a code'; end if;
  if r.logo_url is not null or r.primary_color is not null then
    raise exception 'no branding row means null brand columns: %', row_to_json(r);
  end if;
end $$;

-- Unknown email: still zero rows, still audited (1A behavior kept).
do $$ declare n int; before int; begin
  select count(*) into before from portal_audit_log where action = 'code_request' and ip = '10.49.0.3';
  select count(*) into n from public.portal_issue_code('portal-brand', 'nobody@brand.example', '10.49.0.3');
  if n <> 0 then raise exception 'an unknown email gets no row'; end if;
  if (select count(*) from portal_audit_log where action = 'code_request' and ip = '10.49.0.3') <> before + 1 then
    raise exception 'every request still counts toward the per-IP limit';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/049_portal_code_email_brand.sql`
Expected: FAIL with `record "r" has no field "logo_url"`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000005_portal_code_email_brand.sql`:

```sql
-- 20261014000005_portal_code_email_brand.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief scope 5): the sign-in code email is
-- branded with the ISO's logo and color. portal_api must not look the brand up
-- separately: request_code answers before the email is sent so its response
-- time never reveals whether an account exists (1A), and a second lookup only
-- on the success path would. So the brand rides along in the row
-- portal_issue_code already returns.
--
-- Body, limits and audit are exactly 20261012000002's. Only the return type
-- grows, which needs a drop and recreate, so the privileges are restated.

drop function if exists public.portal_issue_code(text, text, text);

create function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text, logo_url text, primary_color text)
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

  -- Phase 1C: the brand for the email (null without a branding row).
  return query
    select v_code, v_user.email, v_org.name, v_org.slug, b.logo_url, b.primary_color
      from (select v_org.id as org_id) x
      left join org_branding b on b.org_id = x.org_id;
end $$;

revoke execute on function public.portal_issue_code(text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_issue_code(text, text, text) to service_role;
```

- [ ] **Step 4: Run the new test and the 1A and 1B sign-in tests**

Run: `supabase db reset && for t in 039_portal_sign_in 041_portal_sign_in_caps 049_portal_code_email_brand; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$t.sql || exit 1; done`
Expected: all three exit 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000005_portal_code_email_brand.sql supabase/tests/049_portal_code_email_brand.sql
git commit -m "$(cat <<'EOF'
feat(portal): sign-in code row carries the ISO logo and color

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Branded email template; brand the invite and sign-in code emails

**Files:**
- Create: `supabase/functions/_shared/emailTemplate.snapshot.test.ts` and the six files it writes under `supabase/functions/_shared/__snapshots__/`
- Modify: `supabase/functions/_shared/emailTemplate.ts`, `supabase/functions/_shared/emailTemplate.test.ts`
- Modify: `supabase/functions/_shared/portalEmail.ts`, `supabase/functions/_shared/portalEmail.test.ts`
- Modify: `supabase/functions/_shared/portalApi.ts`, `supabase/functions/_shared/portalApi.test.ts`
- Modify: `supabase/functions/_shared/portalInvite.ts`, `supabase/functions/_shared/portalInvite.test.ts`

**Interfaces:**
- Consumes: Task 5 `portal_issue_code` columns `logo_url`, `primary_color`; 1A `portal_brand(p_slug text) returns table (org_name, product_name, primary_color, logo_url, dark_logo_url)`.
- Produces (`emailTemplate.ts`):
  - `interface EmailBrand { name: string; logoUrl: string | null; primaryColor: string | null }`
  - `interface EmailOptions` gains `brand?: EmailBrand`
  - `const POWERED_BY = "Powered by navigatr"`
  - `function brandAccent(color: string | null | undefined): string` (the color when it is `#rrggbb`, else `#5856EB`)
  - `function readableTextOn(hex: string): "#FFFFFF" | "#0B1220"` (button text with the better contrast)
  - `renderEmail(opts: EmailOptions): { html: string; text: string }`: unchanged output without `brand`. With `brand`: header is the ISO logo (`http(s)` URL only, alt = ISO name) or the ISO name as text, never the navigatr mark; button and footer link use `brandAccent`; button text uses `readableTextOn`; a small "Powered by navigatr" line closes the footer in HTML and text.
- Produces (`portalEmail.ts`):
  - `function portalEmailBrand(orgName: string, row: { logo_url?: unknown; primary_color?: unknown } | null | undefined): EmailBrand`
  - `type PortalBrandRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>`
  - `function fetchPortalEmailBrand(rpc: PortalBrandRpc, slug: string, orgName: string): Promise<EmailBrand>` (never throws; falls back to the name-only brand)
- `portalApi.ts`: `IssuedCodeRow` gains `logo_url?: string | null; primary_color?: string | null`; the code email renders with `portalEmailBrand(row.org_name, row)`.
- `portalInvite.ts`: after the allowlist check, `fetchPortalEmailBrand(deps.rpc, row.org_slug, row.org_name)` and render with that brand.

- [ ] **Step 1: Pin the default template before touching it**

Create `supabase/functions/_shared/emailTemplate.snapshot.test.ts`:

```ts
/**
 * Byte-for-byte guard for the default (unbranded) email template. Every
 * existing caller (send_invite_email, send_auth_email, notify_no_deals) passes
 * no brand, so these files must never change. They were written by the first
 * run, before the brand option existed (Partner Portal Phase 1C).
 */
import { describe, it, expect } from "vitest";
import { renderEmail, type EmailOptions } from "./emailTemplate";

const CASES: Record<string, EmailOptions> = {
  auth: {
    preheader: "Sign in to navigatr",
    heading: "Sign in to navigatr",
    bodyLines: ["Tap the button below to sign in.", "This link expires in 60 minutes."],
    ctaLabel: "Sign in to navigatr",
    ctaUrl: "https://app.getnavigatr.io/auth/v1/verify?token=abc&type=magiclink",
    footnote: "If this wasn't you, you can ignore this email.",
  },
  code: {
    preheader: "Your code is 042917. It expires in 15 minutes.",
    heading: "Your sign-in code",
    bodyLines: ["Enter this code to sign in to the Acme ISO referral portal. It expires in 15 minutes."],
    code: "042917",
    ctaLabel: "Open the sign-in page",
    ctaUrl: "https://app.getnavigatr.io/p/acme",
    footnote: "If you didn't ask for this code, you can ignore this email.",
  },
  escaped: {
    preheader: `Quotes " and <tags> & more`,
    heading: `Hi <b>"Team"</b> & co`,
    bodyLines: ["Line with <script>alert(1)</script>", "- A list line", ""],
    ctaLabel: "Open & go",
    ctaUrl: `https://app.getnavigatr.io/x?a=1&b="2"<3>`,
    footnote: "Footnote with 'quotes' & <angles>",
  },
};

describe("renderEmail default template stays byte-identical", () => {
  for (const [name, opts] of Object.entries(CASES)) {
    it(`${name}: html and text`, async () => {
      const { html, text } = renderEmail(opts);
      await expect(html).toMatchFileSnapshot(`./__snapshots__/emailTemplate.${name}.html`);
      await expect(text).toMatchFileSnapshot(`./__snapshots__/emailTemplate.${name}.txt`);
    });
  }
});
```

- [ ] **Step 2: Write the snapshots from the current template**

Run: `pnpm --filter app test -- -u emailTemplate.snapshot`
Expected: PASS (3 tests). Then `git status --short supabase/functions/_shared/__snapshots__` lists exactly six new files: `emailTemplate.auth.html`, `emailTemplate.auth.txt`, `emailTemplate.code.html`, `emailTemplate.code.txt`, `emailTemplate.escaped.html`, `emailTemplate.escaped.txt`.

- [ ] **Step 3: Commit the pinned snapshots**

```bash
git add supabase/functions/_shared/emailTemplate.snapshot.test.ts supabase/functions/_shared/__snapshots__
git commit -m "$(cat <<'EOF'
test(email): pin the default template byte for byte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Write the failing brand tests**

Append to `supabase/functions/_shared/emailTemplate.test.ts` (and change its import line to `import { POWERED_BY, brandAccent, readableTextOn, renderEmail } from "./emailTemplate";`):

```ts
describe("renderEmail with a tenant brand", () => {
  const base = {
    preheader: "Acme ISO has your referral.",
    heading: "Acme ISO has your referral",
    bodyLines: ["Thanks for sending Fresh Bakery."],
    ctaLabel: "View referral",
    ctaUrl: "https://app.getnavigatr.io/p/acme/r/r-1",
    footnote: "You're getting this because you send referrals to Acme ISO.",
  };

  it("shows the ISO logo instead of the navigatr mark", () => {
    const { html } = renderEmail({
      ...base,
      brand: { name: "Acme ISO", logoUrl: "https://cdn.example/acme.png", primaryColor: null },
    });
    expect(html).toContain('src="https://cdn.example/acme.png"');
    expect(html).toContain('alt="Acme ISO"');
    expect(html).not.toContain("icons/icon-192x192.png");
    expect(html).not.toContain(">navigatr</td>");
  });

  it("shows the ISO name as text when there is no usable logo", () => {
    for (const logoUrl of [null, "", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const { html } = renderEmail({ ...base, brand: { name: "Acme <ISO>", logoUrl, primaryColor: null } });
      expect(html).toContain("Acme &lt;ISO&gt;</span>");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("data:image");
      expect(html).not.toContain("icons/icon-192x192.png");
    }
  });

  it("uses the ISO color for the button and the footer link, with readable button text", () => {
    const dark = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#0A7C45" } }).html;
    expect(dark).toContain("background:#0A7C45;");
    expect(dark).toContain("color:#0A7C45;word-break:break-all;");
    expect(dark).toContain("color:#FFFFFF;text-decoration:none;");
    expect(dark).not.toContain("#5856EB");

    const light = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#FFD500" } }).html;
    expect(light).toContain("background:#FFD500;");
    expect(light).toContain("color:#0B1220;text-decoration:none;");
  });

  it("falls back to the default color for a color that is not #rrggbb", () => {
    for (const primaryColor of [null, "", "red", "#FFF", "#12345G", "#0A7C45;background:url(x)"]) {
      const { html } = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor } });
      expect(html).toContain("background:#5856EB;");
      expect(html).not.toContain("url(x)");
    }
  });

  it("always adds the locked Powered by line, in html and text", () => {
    const out = renderEmail({ ...base, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    expect(out.html).toContain(`>${POWERED_BY}</p>`);
    expect(out.text.endsWith(`\n\n${POWERED_BY}`)).toBe(true);
    const plain = renderEmail(base);
    expect(plain.html).not.toContain(POWERED_BY);
    expect(plain.text).not.toContain(POWERED_BY);
  });
});

describe("brandAccent and readableTextOn", () => {
  it("accepts only #rrggbb", () => {
    expect(brandAccent("#0a7c45")).toBe("#0a7c45");
    expect(brandAccent("0A7C45")).toBe("#5856EB");
    expect(brandAccent(undefined)).toBe("#5856EB");
  });

  it("picks the text color with the better contrast", () => {
    expect(readableTextOn("#5856EB")).toBe("#FFFFFF");
    expect(readableTextOn("#000000")).toBe("#FFFFFF");
    expect(readableTextOn("#FFD500")).toBe("#0B1220");
    expect(readableTextOn("#FFFFFF")).toBe("#0B1220");
  });
});
```

- [ ] **Step 5: Run the tests to verify the new ones fail**

Run: `pnpm --filter app test -- _shared/emailTemplate`
Expected: FAIL on the import (`brandAccent`, `readableTextOn` and `POWERED_BY` are not exported); the snapshot test still passes.

- [ ] **Step 6: Implement the brand option**

Replace the whole of `supabase/functions/_shared/emailTemplate.ts` with:

```ts
/**
 * Branded navigatr transactional-email template (Option A / Minimal).
 * Pure, dependency-free TS so the app's vitest can verify it and the Deno
 * edge functions can import it. Returns email-safe HTML (table layout, inline
 * styles, light mode) plus a plain-text alternative. Single source of truth for
 * the look of every transactional email.
 *
 * Partner Portal Phase 1C (spec 5.8): an optional per-tenant brand. With a
 * brand, the header shows the ISO's logo (or its name), the button and links
 * use the ISO's color, and a small "Powered by navigatr" line closes the
 * footer (locked on, like the app footer since white-label v2). Without a
 * brand the output is byte-identical to before
 * (emailTemplate.snapshot.test.ts).
 */
export interface EmailBrand {
  /** The ISO's name: the header text when there is no logo, and the logo's alt text. */
  name: string;
  /** Public http(s) URL of the ISO's logo (org_branding.logo_url). */
  logoUrl: string | null;
  /** #rrggbb button and link color (org_branding.primary_color). */
  primaryColor: string | null;
}

export interface EmailOptions {
  /** Hidden inbox-preview line. */
  preheader: string;
  heading: string;
  /** One paragraph per line. */
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** Small footer note (expiry / "wasn't you"). */
  footnote: string;
  /** Optional prominent one-time code (magic-link / OTP), shown above the button. */
  code?: string;
  /** Per-tenant branding (partner emails). Absent = the navigatr look, unchanged. */
  brand?: EmailBrand;
}

const LOGO_URL = "https://app.getnavigatr.io/icons/icon-192x192.png";
const DEFAULT_ACCENT = "#5856EB";
const DEFAULT_ACCENT_TEXT = "#FFFFFF";
const DARK_TEXT = "#0B1220";

/** The locked credit line on every branded email. */
export const POWERED_BY = "Powered by navigatr";

const DEFAULT_HEADER = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${LOGO_URL}" width="30" height="30" alt="" style="display:block;border:0;border-radius:7px;"></td>
          <td style="vertical-align:middle;padding-left:9px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0B1220;letter-spacing:-0.01em;">navigatr</td>
        </tr></table>`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// URLs are interpolated without ampersand-escaping (query strings routinely
// carry raw "&") but still guard against attribute/tag breakout.
function escUrl(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The brand color when it is a #rrggbb hex, else the navigatr default. */
export function brandAccent(color: string | null | undefined): string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** White or near-black button text, whichever contrasts better with the color (WCAG luminance). */
export function readableTextOn(hex: string): "#FFFFFF" | "#0B1220" {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  // #0B1220 has a relative luminance of about 0.0061.
  const onWhiteText = 1.05 / (lum + 0.05);
  const onDarkText = (lum + 0.05) / 0.0561;
  return onDarkText > onWhiteText ? DARK_TEXT : "#FFFFFF";
}

function brandHeader(brand: EmailBrand): string {
  const logo = typeof brand.logoUrl === "string" ? brand.logoUrl.trim() : "";
  if (/^https?:\/\/\S+$/i.test(logo)) {
    return `<img src="${escUrl(logo)}" height="32" alt="${esc(brand.name)}" style="display:block;border:0;height:32px;width:auto;max-width:200px;">`;
  }
  return `<span style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#0B1220;letter-spacing:-0.01em;">${esc(brand.name)}</span>`;
}

export function renderEmail(opts: EmailOptions): { html: string; text: string } {
  const brand = opts.brand;
  const header = brand ? brandHeader(brand) : DEFAULT_HEADER;
  const accent = brand ? brandAccent(brand.primaryColor) : DEFAULT_ACCENT;
  const accentText = brand ? readableTextOn(accent) : DEFAULT_ACCENT_TEXT;
  const poweredBy = brand
    ? `\n        <p style="margin:12px 0 0;font-size:11px;line-height:1.4;color:#A0A7B8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${POWERED_BY}</p>`
    : "";

  const bodyHtml = opts.bodyLines
    .map((l) => `<p class="em-body" style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#56607A;">${esc(l)}</p>`)
    .join("");

  const codeHtml = opts.code
    ? `<tr><td style="padding:4px 28px 0;">
        <div style="background:#F0F2F7;border:1px solid #E8EBF2;border-radius:10px;padding:16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#0B1220;">${esc(opts.code)}</div>
      </td></tr>`
    : "";

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F7F8FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8FB;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E8EBF2;border-radius:14px;">
      <tr><td style="padding:24px 28px 8px;">
        ${header}
      </td></tr>
      <tr><td style="padding:12px 28px 4px;">
        <h1 style="margin:0 0 10px;font-size:20px;line-height:1.25;color:#0B1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(opts.heading)}</h1>
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${bodyHtml}</div>
      </td></tr>
      ${codeHtml}
      <tr><td style="padding:8px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:${accent};border-radius:9px;">
            <a href="${escUrl(opts.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${accentText};text-decoration:none;">${esc(opts.ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 24px;">
        <p style="margin:16px 0 0;border-top:1px solid #F0F2F7;padding-top:14px;font-size:11.5px;line-height:1.5;color:#8089A1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          ${esc(opts.footnote)}<br>
          Button not working? Paste this link into your browser:<br>
          <a href="${escUrl(opts.ctaUrl)}" style="color:${accent};word-break:break-all;">${escUrl(opts.ctaUrl)}</a>
        </p>${poweredBy}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    opts.heading,
    "",
    ...opts.bodyLines,
    ...(opts.code ? ["", `Code: ${opts.code}`] : []),
    "",
    `${opts.ctaLabel}: ${opts.ctaUrl}`,
    "",
    opts.footnote,
    ...(brand ? ["", POWERED_BY] : []),
  ].join("\n");

  return { html, text };
}
```

- [ ] **Step 7: Run the template tests**

Run: `pnpm --filter app test -- _shared/emailTemplate`
Expected: PASS, including `emailTemplate.snapshot.test.ts` with NO snapshot written or updated. Then `git status --short supabase/functions/_shared/__snapshots__` prints nothing (the default output is byte-identical).

- [ ] **Step 8: Write the failing brand tests for the 1A emails**

Append to `supabase/functions/_shared/portalEmail.test.ts` (and change its import line to `import { fetchPortalEmailBrand, portalCodeEmail, portalEmailBrand, portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail";`, and add `vi` to the vitest import):

```ts
describe("portalEmailBrand", () => {
  it("takes the logo and color from a branding row", () => {
    expect(portalEmailBrand("Acme ISO", { logo_url: "https://cdn.example/a.png", primary_color: "#0A7C45" })).toEqual({
      name: "Acme ISO",
      logoUrl: "https://cdn.example/a.png",
      primaryColor: "#0A7C45",
    });
  });

  it("is name-only for a missing row or empty fields", () => {
    const none = { name: "Acme ISO", logoUrl: null, primaryColor: null };
    expect(portalEmailBrand("Acme ISO", null)).toEqual(none);
    expect(portalEmailBrand("Acme ISO", { logo_url: "", primary_color: 7 })).toEqual(none);
  });
});

describe("fetchPortalEmailBrand", () => {
  it("reads portal_brand for the slug", async () => {
    const rpc = vi.fn(async () => ({ data: [{ logo_url: "https://cdn.example/a.png", primary_color: "#0A7C45" }], error: null }));
    await expect(fetchPortalEmailBrand(rpc, "acme", "Acme ISO")).resolves.toEqual({
      name: "Acme ISO",
      logoUrl: "https://cdn.example/a.png",
      primaryColor: "#0A7C45",
    });
    expect(rpc).toHaveBeenCalledWith("portal_brand", { p_slug: "acme" });
  });

  it("falls back to the name when the lookup errors, throws, or finds nothing", async () => {
    const none = { name: "Acme ISO", logoUrl: null, primaryColor: null };
    await expect(fetchPortalEmailBrand(async () => ({ data: null, error: { message: "boom" } }), "acme", "Acme ISO")).resolves.toEqual(none);
    await expect(fetchPortalEmailBrand(async () => { throw new Error("down"); }, "acme", "Acme ISO")).resolves.toEqual(none);
    await expect(fetchPortalEmailBrand(async () => ({ data: [], error: null }), "acme", "Acme ISO")).resolves.toEqual(none);
  });
});
```

Append to the `describe("request_code", ...)` block of `supabase/functions/_shared/portalApi.test.ts`:

```ts
  it("brands the code email with the ISO's logo and color from the issued row", async () => {
    const branded = ok([
      {
        code: "123456",
        recipient: "jane@example.com",
        org_name: "Acme ISO",
        org_slug: "acme",
        logo_url: "https://cdn.example/acme.png",
        primary_color: "#0A7C45",
      },
    ]);
    const { deps, rpc, sendEmail } = setup(() => branded);
    await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    expect(rpc).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.html).toContain('src="https://cdn.example/acme.png"');
    expect(msg.html).toContain("background:#0A7C45;");
    expect(msg.html).toContain("Powered by navigatr");
    expect(msg.html).not.toContain("icons/icon-192x192.png");
  });

  it("shows the ISO name in the header when the org has no branding", async () => {
    const { deps, sendEmail } = setup(() => ISSUED);
    await handlePortalRequest(post("request_code", { slug: "acme", email: "jane@example.com" }), deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.html).toContain("Acme ISO</span>");
    expect(msg.html).not.toContain("icons/icon-192x192.png");
  });
```

Append inside `describe("handlePortalInvite", ...)` of `supabase/functions/_shared/portalInvite.test.ts`:

```ts
  it("brands the invite with the ISO's logo and color", async () => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) =>
      name === "portal_brand"
        ? ok([{ org_name: "Acme ISO", product_name: "Acme", primary_color: "#0A7C45", logo_url: "https://cdn.example/acme.png", dark_logo_url: null }])
        : ok([ROW]),
    );
    const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), {
      getUserId: async () => "user-1",
      rpc,
      sendEmail,
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("portal_brand", { p_slug: "acme" });
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.html).toContain('src="https://cdn.example/acme.png"');
    expect(msg.html).toContain("Powered by navigatr");
    expect(msg.text).toContain("Powered by navigatr");
  });

  it("still sends the invite, name-only, when the brand lookup fails", async () => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) =>
      name === "portal_brand" ? fail("boom") : ok([ROW]),
    );
    const sendEmail = vi.fn(async (_msg: PortalEmailMessage) => {});
    const res = await handlePortalInvite(post({ partnerId: PARTNER }), { getUserId: async () => "user-1", rpc, sendEmail, env: ENV });
    expect(res.status).toBe(200);
    expect(sendEmail.mock.calls[0][0].html).toContain("Acme ISO</span>");
  });

  it("does not look up the brand when the allowlist drops the invite", async () => {
    const { deps, rpc } = setup({ env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    await handlePortalInvite(post({ partnerId: PARTNER }), deps);
    expect(rpc).not.toHaveBeenCalledWith("portal_brand", expect.anything());
  });
```

- [ ] **Step 9: Run them to verify they fail**

Run: `pnpm --filter app test -- _shared/portalEmail _shared/portalApi.test _shared/portalInvite`
Expected: FAIL (`portalEmailBrand` and `fetchPortalEmailBrand` are not exported; the branded request_code and invite tests find the navigatr icon).

- [ ] **Step 10: Implement the brand helpers and use them**

In `supabase/functions/_shared/portalEmail.ts`, replace

```ts
 * The ISO's name is the sender display name and appears in the copy. The
 * template header still shows the navigatr mark until per-tenant email
 * branding lands with the referral emails in Phase 1C.
```

with

```ts
 * The ISO's name is the sender display name and appears in the copy. Since
 * Phase 1C every portal email is rendered with the ISO's brand (logo or name,
 * color, and the locked "Powered by navigatr" line): see portalEmailBrand and
 * fetchPortalEmailBrand below.
```

replace

```ts
import type { EmailOptions } from "./emailTemplate.ts";
```

with

```ts
import type { EmailBrand, EmailOptions } from "./emailTemplate.ts";
```

and append to the end of the file:

```ts
/**
 * The email brand for an ISO from a portal_brand or portal_issue_code row.
 * renderEmail validates the logo URL and the color; this only drops values
 * that are not non-empty strings.
 */
export function portalEmailBrand(
  orgName: string,
  row: { logo_url?: unknown; primary_color?: unknown } | null | undefined,
): EmailBrand {
  const logo = row?.logo_url;
  const color = row?.primary_color;
  return {
    name: orgName,
    logoUrl: typeof logo === "string" && logo !== "" ? logo : null,
    primaryColor: typeof color === "string" && color !== "" ? color : null,
  };
}

export type PortalBrandRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Look the ISO's brand up by slug. Never throws: a failed lookup sends the email name-only. */
export async function fetchPortalEmailBrand(rpc: PortalBrandRpc, slug: string, orgName: string): Promise<EmailBrand> {
  try {
    const { data, error } = await rpc("portal_brand", { p_slug: slug });
    if (error) return portalEmailBrand(orgName, null);
    const row = Array.isArray(data) ? data[0] : data;
    return portalEmailBrand(orgName, row !== null && typeof row === "object" ? (row as Record<string, unknown>) : null);
  } catch {
    return portalEmailBrand(orgName, null);
  }
}
```

In `supabase/functions/_shared/portalApi.ts`, replace

```ts
import { portalCodeEmail, portalFromAddress, portalUrl } from "./portalEmail.ts";
```

with

```ts
import { portalCodeEmail, portalEmailBrand, portalFromAddress, portalUrl } from "./portalEmail.ts";
```

replace

```ts
interface IssuedCodeRow {
  code: string;
  recipient: string;
  org_name: string;
  org_slug: string;
}
```

with

```ts
interface IssuedCodeRow {
  code: string;
  recipient: string;
  org_name: string;
  org_slug: string;
  /** Phase 1C: the ISO's brand rides along so the send needs no second lookup. */
  logo_url?: string | null;
  primary_color?: string | null;
}
```

and in `requestCode` replace

```ts
    const { html, text } = renderEmail(built);
    // Not awaited: response time must not depend on whether an email was sent.
```

with

```ts
    const { html, text } = renderEmail({ ...built, brand: portalEmailBrand(row.org_name, row) });
    // Not awaited: response time must not depend on whether an email was sent.
```

In `supabase/functions/_shared/portalInvite.ts`, replace

```ts
import { portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail.ts";
```

with

```ts
import { fetchPortalEmailBrand, portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail.ts";
```

and replace

```ts
    const { html, text } = renderEmail(built);
    stage = "send";
```

with

```ts
    // Phase 1C: the ISO's logo and color. Never throws; a failed lookup sends it name-only.
    const brand = await fetchPortalEmailBrand(deps.rpc, row.org_slug, row.org_name);
    const { html, text } = renderEmail({ ...built, brand });
    stage = "send";
```

- [ ] **Step 11: Run every email and portal handler test**

Run: `pnpm --filter app test -- _shared/emailTemplate _shared/portalEmail _shared/portalApi.test _shared/portalInvite _shared/noDealsEmail _shared/authEmail`
Expected: PASS. `git status --short supabase/functions/_shared/__snapshots__` prints nothing.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/_shared/emailTemplate.ts supabase/functions/_shared/emailTemplate.test.ts supabase/functions/_shared/portalEmail.ts supabase/functions/_shared/portalEmail.test.ts supabase/functions/_shared/portalApi.ts supabase/functions/_shared/portalApi.test.ts supabase/functions/_shared/portalInvite.ts supabase/functions/_shared/portalInvite.test.ts
git commit -m "$(cat <<'EOF'
feat(email): ISO-branded template for partner emails, invite and code included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Email builders for every outbox kind

**Files:**
- Create: `supabase/functions/_shared/portalNotifyEmail.ts`, `supabase/functions/_shared/portalNotifyEmail.test.ts`
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: Task 6 `EmailOptions`; 1B `PORTAL_LABELS`, `PortalLabel` (`portalLabels.ts`); 1A `portalUrl(appBaseUrl, slug, suffix)` (`portalEmail.ts`); the payload shapes queued by Tasks 3 and 4.
- Produces (`portalNotifyEmail.ts`):
  - `const PARTNER_NOTIFY_KINDS = ["partner_received", "partner_accepted", "partner_not_moving_forward", "partner_closed_won", "partner_withdrawn", "partner_update"] as const`, `type PartnerNotifyKind`
  - `const INTERNAL_NOTIFY_KINDS = ["internal_new_referral", "internal_nudge"] as const`, `type InternalNotifyKind`, `type PortalNotifyKind = PartnerNotifyKind | InternalNotifyKind`
  - `const KIND_LABEL: Readonly<Record<Exclude<PartnerNotifyKind, "partner_update">, PortalLabel>>`
  - `interface PartnerNotifyPayload { slug: string; orgName: string; partnerName: string; companyName: string; ref: string; label: PortalLabel; valueCents: number | null; repName: string | null; repEmail: string | null; updateBody: string | null }`
  - `interface InternalNotifyPayload { appUrlPath: string; companyNames: string[]; count: number }`
  - `interface PortalNotifyEmail extends EmailOptions { subject: string; audience: "partner" | "internal"; orgName: string | null; replyTo: string | null }`
  - `interface NotifyContext { appBaseUrl: string; referralId: string | null }`
  - `function parsePartnerPayload(raw: unknown): PartnerNotifyPayload | null`
  - `function parseInternalPayload(raw: unknown): InternalNotifyPayload | null`
  - `function buildPortalNotifyEmail(kind: string, payload: unknown, ctx: NotifyContext): PortalNotifyEmail | null` (null = drop the row)

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalNotifyEmail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  INTERNAL_NOTIFY_KINDS,
  KIND_LABEL,
  PARTNER_NOTIFY_KINDS,
  buildPortalNotifyEmail,
  parseInternalPayload,
  parsePartnerPayload,
  type PortalNotifyEmail,
} from "./portalNotifyEmail";

const BASE = "https://app.getnavigatr.io";
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const CTX = { appBaseUrl: BASE, referralId: RID };
const P = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  label: "Received",
  valueCents: null,
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  updateBody: null,
};
const withLabel = (label: string, extra: Record<string, unknown> = {}) => ({ ...P, label, ...extra });

function copyOf(e: PortalNotifyEmail): string {
  return [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
}

describe("parsePartnerPayload", () => {
  it("accepts the SQL allowlist shape", () => {
    expect(parsePartnerPayload({ ...P, valueCents: 500000 })).toEqual({ ...P, valueCents: 500000 });
  });

  it("rejects a missing field, an internal status, or a non-object", () => {
    expect(parsePartnerPayload({ ...P, companyName: "  " })).toBeNull();
    expect(parsePartnerPayload({ ...P, slug: undefined })).toBeNull();
    expect(parsePartnerPayload({ ...P, label: "working" })).toBeNull();
    expect(parsePartnerPayload({ ...P, label: "lost" })).toBeNull();
    expect(parsePartnerPayload(null)).toBeNull();
    expect(parsePartnerPayload([P])).toBeNull();
  });

  it("drops a value or a rep email that is not well formed", () => {
    expect(parsePartnerPayload({ ...P, valueCents: 12.5 })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, valueCents: -1 })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, valueCents: "500000" })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, repEmail: "not an email" })?.repEmail).toBeNull();
    expect(parsePartnerPayload({ ...P, repEmail: "a@b.co>\r\nBcc: x@y.z" })?.repEmail).toBeNull();
  });
});

describe("parseInternalPayload", () => {
  it("accepts an app path and company names", () => {
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: ["A", " B "], count: 2 })).toEqual({
      appUrlPath: "/partners",
      companyNames: ["A", "B"],
      count: 2,
    });
  });

  it("refuses anything that could leave the app or has no names", () => {
    expect(parseInternalPayload({ appUrlPath: "//evil.example", companyNames: ["A"], count: 1 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "https://evil.example", companyNames: ["A"], count: 1 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: [], count: 0 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: "A", count: 1 })).toBeNull();
  });

  it("never reports fewer than the names it lists", () => {
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: ["A", "B"], count: 1 })?.count).toBe(2);
  });
});

describe("partner emails", () => {
  it("received: plain, names the ISO, links to the referral, replies to the rep", () => {
    const e = buildPortalNotifyEmail("partner_received", P, CTX)!;
    expect(e.subject).toBe("Fresh Bakery: Received by Acme ISO");
    expect(e.preheader).toBe("Acme ISO has your referral REF-3F9A21C0.");
    expect(e.heading).toBe("Acme ISO has your referral");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Thanks for sending Fresh Bakery. Acme ISO has it and will review it soon.",
      "Rita Rep at Acme ISO is your contact. Reply to this email to reach them.",
    ]);
    expect(e.ctaLabel).toBe("View referral");
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/r/${RID}`);
    expect(e.footnote).toBe("You're getting this because you send referrals to Acme ISO. Reference REF-3F9A21C0.");
    expect(e.audience).toBe("partner");
    expect(e.orgName).toBe("Acme ISO");
    expect(e.replyTo).toBe("rita@acme.example");
  });

  it.each([
    ["partner_accepted", "Accepted", "Fresh Bakery: Accepted by Acme ISO", "Good news: Acme ISO is moving forward with Fresh Bakery."],
    ["partner_not_moving_forward", "Not Moving Forward", "Fresh Bakery: Not Moving Forward", "Acme ISO is not moving forward with Fresh Bakery. Thank you for thinking of them."],
    ["partner_closed_won", "Closed Won", "Fresh Bakery: Closed Won", "Great news: Fresh Bakery signed with Acme ISO. Thank you for the referral."],
    ["partner_withdrawn", "Withdrawn", "Fresh Bakery: Withdrawn", "Acme ISO marked Fresh Bakery as Withdrawn and will not follow up on it."],
  ])("%s carries the %s label", (kind, label, subject, line) => {
    const e = buildPortalNotifyEmail(kind, withLabel(label), CTX)!;
    expect(e.subject).toBe(subject);
    expect(e.bodyLines[1]).toBe(line);
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/r/${RID}`);
  });

  it("refuses a status email whose label does not match its kind", () => {
    for (const kind of Object.keys(KIND_LABEL)) {
      expect(buildPortalNotifyEmail(kind, withLabel("In Progress"), CTX)).toBeNull();
    }
  });

  it("shows the closed value only when the payload carries one", () => {
    const hidden = buildPortalNotifyEmail("partner_closed_won", withLabel("Closed Won"), CTX)!;
    expect(hidden.bodyLines.join(" ")).not.toContain("$");
    const shown = buildPortalNotifyEmail("partner_closed_won", withLabel("Closed Won", { valueCents: 500000 }), CTX)!;
    expect(shown.bodyLines).toContain("Closed value: $5,000.");
  });

  it("update: the rep's words, line by line, then the current label", () => {
    const e = buildPortalNotifyEmail(
      "partner_update",
      withLabel("In Progress", { updateBody: "Spoke with the owner today.\n\n  Demo next Tuesday.  " }),
      CTX,
    )!;
    expect(e.subject).toBe("Fresh Bakery: an update from Acme ISO");
    expect(e.heading).toBe("An update on Fresh Bakery");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Rita Rep at Acme ISO shared an update:",
      "Spoke with the owner today.",
      "Demo next Tuesday.",
      "Status: In Progress.",
      "Rita Rep at Acme ISO is your contact. Reply to this email to reach them.",
    ]);
    expect(buildPortalNotifyEmail("partner_update", withLabel("In Progress"), CTX)).toBeNull();
  });

  it("without a rep: no Reply-To and a general contact line", () => {
    const e = buildPortalNotifyEmail("partner_received", { ...P, repName: null, repEmail: null }, CTX)!;
    expect(e.replyTo).toBeNull();
    expect(e.bodyLines).toContain("Someone at Acme ISO will be in touch.");
    const nameOnly = buildPortalNotifyEmail("partner_received", { ...P, repEmail: null }, CTX)!;
    expect(nameOnly.replyTo).toBeNull();
    expect(nameOnly.bodyLines).toContain("Rita Rep at Acme ISO is your contact.");
    const update = buildPortalNotifyEmail("partner_update", withLabel("Accepted", { repName: null, updateBody: "Hi" }), CTX)!;
    expect(update.bodyLines[1]).toBe("Acme ISO shared an update:");
  });

  it("links to the portal home when the row has no usable referral id", () => {
    expect(buildPortalNotifyEmail("partner_received", P, { appBaseUrl: BASE, referralId: null })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
    expect(buildPortalNotifyEmail("partner_received", P, { appBaseUrl: BASE, referralId: "../x" })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
  });

  it("never says navigatr in partner copy", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, withLabel(label, { updateBody: "Hello", valueCents: 100 }), CTX)!;
      expect(copyOf(e).toLowerCase()).not.toContain("navigatr");
    }
  });
});

describe("internal emails", () => {
  it("new referral: links to the review queue, no Reply-To", () => {
    const e = buildPortalNotifyEmail("internal_new_referral", { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX)!;
    expect(e.subject).toBe("New partner referral: Fresh Bakery");
    expect(e.heading).toBe("New partner referral for you");
    expect(e.bodyLines).toEqual([
      "A partner sent Fresh Bakery through your referral portal.",
      "Review it to accept, merge or decline.",
    ]);
    expect(e.ctaLabel).toBe("Review referral");
    expect(e.ctaUrl).toBe(`${BASE}/partners`);
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
  });

  it("nudge: one line per business, singular and plural", () => {
    const one = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX)!;
    expect(one.subject).toBe("1 partner referral still waiting for review");
    expect(one.bodyLines).toEqual([
      "These came in through your referral portal today and have not been reviewed yet:",
      "- Fresh Bakery",
    ]);
    const two = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["A Co", "B Co"], count: 2 }, CTX)!;
    expect(two.subject).toBe("2 partner referrals still waiting for review");
    expect(two.ctaUrl).toBe(`${BASE}/partners`);
  });

  it("nudge: lists ten and counts the rest", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Biz ${i + 1}`);
    const e = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: names, count: 12 }, CTX)!;
    expect(e.bodyLines).toHaveLength(12);
    expect(e.bodyLines[10]).toBe("- Biz 10");
    expect(e.bodyLines[11]).toBe("and 2 more");
  });

  it("drops an unknown kind or a bad payload", () => {
    expect(buildPortalNotifyEmail("partner_party", P, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners" }, CTX)).toBeNull();
    for (const kind of INTERNAL_NOTIFY_KINDS) expect(buildPortalNotifyEmail(kind, P, CTX)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- _shared/portalNotifyEmail`
Expected: FAIL with `Failed to resolve import "./portalNotifyEmail"`.

- [ ] **Step 3: Write the builders**

Create `supabase/functions/_shared/portalNotifyEmail.ts`:

```ts
/**
 * Builders for the emails portal_notify sends (Partner Portal Phase 1C, spec
 * 5.8, brief E1, E3 and E7). One builder per outbox kind. The input is the
 * outbox row's payload, built in SQL from an allowlist; it is checked again
 * here, and anything unexpected (an unknown kind, a label that is not a partner
 * label, a label that does not match the kind, a missing field) returns null so
 * the drain drops the row instead of sending it.
 *
 * Partner emails name the ISO and use partner labels only. They never say
 * "navigatr" (the locked "Powered by navigatr" line comes from the template)
 * and never carry an internal status, stage, reason or note. Internal emails go
 * to reps and link into the app.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import type { EmailOptions } from "./emailTemplate.ts";
import { PORTAL_LABELS, type PortalLabel } from "./portalLabels.ts";
import { portalUrl } from "./portalEmail.ts";

export const PARTNER_NOTIFY_KINDS = [
  "partner_received",
  "partner_accepted",
  "partner_not_moving_forward",
  "partner_closed_won",
  "partner_withdrawn",
  "partner_update",
] as const;
export type PartnerNotifyKind = (typeof PARTNER_NOTIFY_KINDS)[number];

export const INTERNAL_NOTIFY_KINDS = ["internal_new_referral", "internal_nudge"] as const;
export type InternalNotifyKind = (typeof INTERNAL_NOTIFY_KINDS)[number];

export type PortalNotifyKind = PartnerNotifyKind | InternalNotifyKind;

/** The label each status email must carry. An update carries whatever the referral shows now. */
export const KIND_LABEL: Readonly<Record<Exclude<PartnerNotifyKind, "partner_update">, PortalLabel>> = Object.freeze({
  partner_received: "Received",
  partner_accepted: "Accepted",
  partner_not_moving_forward: "Not Moving Forward",
  partner_closed_won: "Closed Won",
  partner_withdrawn: "Withdrawn",
});

export interface PartnerNotifyPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  companyName: string;
  ref: string;
  label: PortalLabel;
  valueCents: number | null;
  repName: string | null;
  repEmail: string | null;
  updateBody: string | null;
}

export interface InternalNotifyPayload {
  appUrlPath: string;
  companyNames: string[];
  count: number;
}

export interface PortalNotifyEmail extends EmailOptions {
  subject: string;
  audience: "partner" | "internal";
  /** The ISO's name for the sender display name and the brand; null on internal emails. */
  orgName: string | null;
  /** The assigned rep's business email on partner emails (spec 5.8); otherwise null. */
  replyTo: string | null;
}

export interface NotifyContext {
  appBaseUrl: string;
  /** The outbox row's referral id; the partner link falls back to the portal home without one. */
  referralId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/;
const APP_PATH_RE = /^\/[A-Za-z0-9/_-]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function isLabel(v: unknown): v is PortalLabel {
  return typeof v === "string" && (PORTAL_LABELS as readonly string[]).includes(v);
}

export function parsePartnerPayload(raw: unknown): PartnerNotifyPayload | null {
  if (!isRecord(raw)) return null;
  const slug = text(raw.slug);
  const orgName = text(raw.orgName);
  const partnerName = text(raw.partnerName);
  const companyName = text(raw.companyName);
  const ref = text(raw.ref);
  if (!slug || !orgName || !partnerName || !companyName || !ref || !isLabel(raw.label)) return null;
  const value = raw.valueCents;
  const repEmail = text(raw.repEmail);
  return {
    slug,
    orgName,
    partnerName,
    companyName,
    ref,
    label: raw.label,
    valueCents: typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null,
    repName: text(raw.repName),
    repEmail: repEmail && EMAIL_RE.test(repEmail) ? repEmail : null,
    updateBody: text(raw.updateBody),
  };
}

export function parseInternalPayload(raw: unknown): InternalNotifyPayload | null {
  if (!isRecord(raw)) return null;
  const path = typeof raw.appUrlPath === "string" ? raw.appUrlPath : "";
  if (!APP_PATH_RE.test(path) || path.startsWith("//")) return null;
  if (!Array.isArray(raw.companyNames)) return null;
  const names = raw.companyNames.map(text).filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  const count = typeof raw.count === "number" && Number.isSafeInteger(raw.count) ? raw.count : 0;
  return { appUrlPath: path, companyNames: names, count: Math.max(count, names.length) };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

function contactLine(p: PartnerNotifyPayload): string {
  if (p.repName && p.repEmail) return `${p.repName} at ${p.orgName} is your contact. Reply to this email to reach them.`;
  if (p.repName) return `${p.repName} at ${p.orgName} is your contact.`;
  return `Someone at ${p.orgName} will be in touch.`;
}

function partnerEmail(
  p: PartnerNotifyPayload,
  ctx: NotifyContext,
  parts: { subject: string; preheader: string; heading: string; lines: string[] },
): PortalNotifyEmail {
  const suffix = ctx.referralId && UUID_RE.test(ctx.referralId) ? `/r/${ctx.referralId}` : "/home";
  return {
    subject: parts.subject,
    preheader: parts.preheader,
    heading: parts.heading,
    bodyLines: [`Hi ${p.partnerName},`, ...parts.lines, contactLine(p)],
    ctaLabel: "View referral",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, suffix),
    footnote: `You're getting this because you send referrals to ${p.orgName}. Reference ${p.ref}.`,
    audience: "partner",
    orgName: p.orgName,
    replyTo: p.repEmail,
  };
}

function buildPartner(kind: PartnerNotifyKind, p: PartnerNotifyPayload, ctx: NotifyContext): PortalNotifyEmail | null {
  const iso = p.orgName;
  const co = p.companyName;
  if (kind !== "partner_update" && p.label !== KIND_LABEL[kind]) return null;
  switch (kind) {
    case "partner_received":
      return partnerEmail(p, ctx, {
        subject: `${co}: Received by ${iso}`,
        preheader: `${iso} has your referral ${p.ref}.`,
        heading: `${iso} has your referral`,
        lines: [`Thanks for sending ${co}. ${iso} has it and will review it soon.`],
      });
    case "partner_accepted":
      return partnerEmail(p, ctx, {
        subject: `${co}: Accepted by ${iso}`,
        preheader: `${iso} is moving forward with ${co}.`,
        heading: `${co}: Accepted`,
        lines: [`Good news: ${iso} is moving forward with ${co}.`],
      });
    case "partner_not_moving_forward":
      return partnerEmail(p, ctx, {
        subject: `${co}: Not Moving Forward`,
        preheader: `An update from ${iso} on ${co}.`,
        heading: `${co}: Not Moving Forward`,
        lines: [`${iso} is not moving forward with ${co}. Thank you for thinking of them.`],
      });
    case "partner_closed_won":
      return partnerEmail(p, ctx, {
        subject: `${co}: Closed Won`,
        preheader: `${co} signed with ${iso}.`,
        heading: `${co}: Closed Won`,
        lines: [
          `Great news: ${co} signed with ${iso}. Thank you for the referral.`,
          ...(p.valueCents !== null ? [`Closed value: ${money(p.valueCents)}.`] : []),
        ],
      });
    case "partner_withdrawn":
      return partnerEmail(p, ctx, {
        subject: `${co}: Withdrawn`,
        preheader: `An update from ${iso} on ${co}.`,
        heading: `${co}: Withdrawn`,
        lines: [`${iso} marked ${co} as Withdrawn and will not follow up on it.`],
      });
    case "partner_update": {
      if (!p.updateBody) return null;
      const lines = p.updateBody
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "");
      return partnerEmail(p, ctx, {
        subject: `${co}: an update from ${iso}`,
        preheader: `${p.repName ?? iso} shared an update on ${co}.`,
        heading: `An update on ${co}`,
        lines: [`${p.repName ? `${p.repName} at ${iso}` : iso} shared an update:`, ...lines, `Status: ${p.label}.`],
      });
    }
    default:
      return null;
  }
}

function buildInternal(kind: InternalNotifyKind, p: InternalNotifyPayload, ctx: NotifyContext): PortalNotifyEmail {
  const url = `${ctx.appBaseUrl.replace(/\/+$/, "")}${p.appUrlPath}`;
  if (kind === "internal_new_referral") {
    const name = p.companyNames[0];
    return {
      subject: `New partner referral: ${name}`,
      preheader: `${name} is waiting in Referrals to review.`,
      heading: "New partner referral for you",
      bodyLines: [`A partner sent ${name} through your referral portal.`, "Review it to accept, merge or decline."],
      ctaLabel: "Review referral",
      ctaUrl: url,
      footnote: "You're getting this because partner referrals are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
  const n = p.count;
  const noun = n === 1 ? "partner referral" : "partner referrals";
  const shown = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
  const more = p.companyNames.length > 10 ? [`and ${p.companyNames.length - 10} more`] : [];
  return {
    subject: `${n} ${noun} still waiting for review`,
    preheader: `Received today and still waiting: ${p.companyNames.slice(0, 3).join(", ")}`,
    heading: `${n} ${noun} still waiting`,
    bodyLines: ["These came in through your referral portal today and have not been reviewed yet:", ...shown, ...more],
    ctaLabel: "Review referrals",
    ctaUrl: url,
    footnote: "You get this once, at the end of your day, when partner referrals from today are still waiting.",
    audience: "internal",
    orgName: null,
    replyTo: null,
  };
}

/** The email for one outbox row, or null when the row must be dropped unsent. */
export function buildPortalNotifyEmail(kind: string, payload: unknown, ctx: NotifyContext): PortalNotifyEmail | null {
  if ((PARTNER_NOTIFY_KINDS as readonly string[]).includes(kind)) {
    const p = parsePartnerPayload(payload);
    return p ? buildPartner(kind as PartnerNotifyKind, p, ctx) : null;
  }
  if ((INTERNAL_NOTIFY_KINDS as readonly string[]).includes(kind)) {
    const p = parseInternalPayload(payload);
    return p ? buildInternal(kind as InternalNotifyKind, p, ctx) : null;
  }
  return null;
}
```

- [ ] **Step 4: Typecheck it through the app build**

In `apps/app/tsconfig.app.json`, replace

```json
    "../../supabase/functions/_shared/portalReferralApi.ts"
  ]
```

with

```json
    "../../supabase/functions/_shared/portalReferralApi.ts",
    "../../supabase/functions/_shared/portalNotifyEmail.ts"
  ]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter app test -- _shared/portalNotifyEmail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/portalNotifyEmail.ts supabase/functions/_shared/portalNotifyEmail.test.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): partner and rep email builders for the outbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The `portal_notify` drain

**Files:**
- Create: `supabase/functions/_shared/portalNotify.ts`, `supabase/functions/_shared/portalNotify.test.ts`
- Create: `supabase/functions/portal_notify/index.ts`, `supabase/functions/portal_notify/deno.json`
- Modify: `supabase/config.toml`, `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: Task 2 `claim_portal_emails(p_limit)`, `mark_portal_email(p_id, p_outcome, p_error)`; Task 4 `enqueue_portal_nudges(p_now)`; Task 6 `renderEmail`, `EmailBrand`; Task 7 `buildPortalNotifyEmail`; 1A `portalFromAddress`; `shouldSend` (`emailGuard.ts`); `requireCronCaller` (`cronAuth.ts`).
- Produces (`portalNotify.ts`):
  - `const PORTAL_NOTIFY_BATCH = 50`
  - `interface PortalNotifyMessage { from: string; to: string; subject: string; html: string; text: string; replyTo?: string }`
  - `interface PortalNotifyBrand { logoUrl: string | null; primaryColor: string | null }`
  - `interface PortalNotifyEnv { appBaseUrl: string; fromAddress: string; appEnv: string | null | undefined; emailAllowlist: string }`
  - `interface PortalNotifyDeps { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>; loadBrand(orgId: string): Promise<PortalNotifyBrand | null>; sendEmail(msg: PortalNotifyMessage): Promise<void>; now?(): Date; env: PortalNotifyEnv }`
  - `interface PortalNotifySummary { nudgesQueued: number; claimed: number; sent: number; dropped: number; failed: number }`
  - `function drainPortalEmails(deps: PortalNotifyDeps): Promise<PortalNotifySummary>`: queues nudges for `now`, claims one batch, and settles every claimed row (`sent`, `dropped` with `invalid_payload` or `email_guard`, or `failed` with the provider message cut to 500 characters). Throws only when the claim itself fails. Logs ids and kinds, never addresses.
- Edge function `portal_notify` (POST, `verify_jwt = false`, `Authorization: Bearer <CRON_SECRET>`): `200 PortalNotifySummary`, `401 { error: "unauthorized" }`, `503 { error: "cron credential not configured" }`, `500 { error: "server_error" }`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalNotify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PORTAL_NOTIFY_BATCH,
  drainPortalEmails,
  type PortalNotifyDeps,
  type PortalNotifyEnv,
  type PortalNotifyMessage,
} from "./portalNotify";

const ENV: PortalNotifyEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-14T22:30:00Z");
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const PARTNER_PAYLOAD = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  label: "Accepted",
  valueCents: null,
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  updateBody: null,
};
const partnerRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: "o-1",
  kind: "partner_accepted",
  referral_id: RID,
  payload: PARTNER_PAYLOAD,
  recipient: "jane@example.com",
  attempts: 1,
  ...over,
});
const INTERNAL_ROW = {
  id: "e-9",
  org_id: "o-1",
  kind: "internal_new_referral",
  referral_id: RID,
  payload: { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 },
  recipient: "rita@acme.example",
  attempts: 1,
};

type Rpc = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function setup(rows: unknown[], over: Partial<PortalNotifyDeps> = {}, handlers: Record<string, Rpc> = {}) {
  const marks: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (handlers[name]) return handlers[name](args);
    if (name === "enqueue_portal_nudges") return { data: 2, error: null };
    if (name === "claim_portal_emails") return { data: rows, error: null };
    if (name === "mark_portal_email") {
      marks.push(args);
      return { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const sendEmail = vi.fn(async (_msg: PortalNotifyMessage) => {});
  const loadBrand = vi.fn(async (_orgId: string) => ({ logoUrl: "https://cdn.example/acme.png", primaryColor: "#0A7C45" }));
  const deps: PortalNotifyDeps = { rpc, sendEmail, loadBrand, now: () => NOW, env: ENV, ...over };
  return { deps, rpc, sendEmail, loadBrand, marks };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("drainPortalEmails", () => {
  it("queues the nudges for now, then claims one batch", async () => {
    const { deps, rpc } = setup([]);
    const summary = await drainPortalEmails(deps);
    expect(rpc.mock.calls[0]).toEqual(["enqueue_portal_nudges", { p_now: "2026-10-14T22:30:00.000Z" }]);
    expect(rpc.mock.calls[1]).toEqual(["claim_portal_emails", { p_limit: PORTAL_NOTIFY_BATCH }]);
    expect(PORTAL_NOTIFY_BATCH).toBe(50);
    expect(summary).toEqual({ nudgesQueued: 2, claimed: 0, sent: 0, dropped: 0, failed: 0 });
  });

  it("sends a partner email in the ISO's name and brand, replying to the rep", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")]);
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.to).toBe("jane@example.com");
    expect(msg.replyTo).toBe("rita@acme.example");
    expect(msg.subject).toBe("Fresh Bakery: Accepted by Acme ISO");
    expect(msg.html).toContain('src="https://cdn.example/acme.png"');
    expect(msg.html).toContain("background:#0A7C45;");
    expect(msg.html).toContain("Powered by navigatr");
    expect(msg.text).toContain(`View referral: https://app.getnavigatr.io/p/acme/r/${RID}`);
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "sent", p_error: null }]);
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
  });

  it("sends an internal email from the shared sender with the default look and no Reply-To", async () => {
    const { deps, sendEmail, loadBrand } = setup([INTERNAL_ROW]);
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.from).toBe(ENV.fromAddress);
    expect(msg.to).toBe("rita@acme.example");
    expect("replyTo" in msg).toBe(false);
    expect(msg.html).toContain("background:#5856EB;");
    expect(msg.html).not.toContain("Powered by navigatr");
    expect(loadBrand).not.toHaveBeenCalled();
  });

  it("loads each org's brand once per run", async () => {
    const { deps, loadBrand, sendEmail } = setup([partnerRow("e-1"), partnerRow("e-2")]);
    await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(loadBrand).toHaveBeenCalledTimes(1);
    expect(loadBrand).toHaveBeenCalledWith("o-1");
  });

  it("still sends, name-only, when the brand lookup fails", async () => {
    const { deps, sendEmail } = setup([partnerRow("e-1")], {
      loadBrand: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.html).toContain("Acme ISO</span>");
    expect(msg.html).toContain("Powered by navigatr");
  });

  it("drops a row whose payload does not build", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1", { payload: { ...PARTNER_PAYLOAD, label: "lost" } })]);
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "dropped", p_error: "invalid_payload" }]);
    expect(summary).toMatchObject({ claimed: 1, dropped: 1 });
  });

  it("drops what the non-production allowlist blocks", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")], { env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "dropped", p_error: "email_guard" }]);
  });

  it("records a failed send and keeps going", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1"), INTERNAL_ROW]);
    sendEmail.mockRejectedValueOnce(new Error("resend 500"));
    const summary = await drainPortalEmails(deps);
    expect(marks).toEqual([
      { p_id: "e-1", p_outcome: "failed", p_error: "resend 500" },
      { p_id: "e-9", p_outcome: "sent", p_error: null },
    ]);
    expect(summary).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
  });

  it("cuts a long provider error to 500 characters", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")]);
    sendEmail.mockRejectedValueOnce(new Error("x".repeat(800)));
    await drainPortalEmails(deps);
    expect((marks[0].p_error as string).length).toBe(500);
  });

  it("keeps draining when the nudge step fails", async () => {
    const { deps, sendEmail } = setup([INTERNAL_ROW], {}, {
      enqueue_portal_nudges: () => ({ data: null, error: { message: "lock timeout" } }),
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(summary.nudgesQueued).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("throws when the claim fails", async () => {
    const { deps } = setup([], {}, { claim_portal_emails: () => ({ data: null, error: { message: "boom" } }) });
    await expect(drainPortalEmails(deps)).rejects.toThrow("claim failed: boom");
  });

  it("never writes a recipient address to the logs", async () => {
    const guarded = setup([partnerRow("e-1")], { env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    await drainPortalEmails(guarded.deps);
    const failing = setup([INTERNAL_ROW]);
    failing.sendEmail.mockRejectedValueOnce(new Error("rejected"));
    await drainPortalEmails(failing.deps);
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("e-1");
    expect(logged).not.toContain("jane@example.com");
    expect(logged).not.toContain("rita@acme.example");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- _shared/portalNotify.test`
Expected: FAIL with `Failed to resolve import "./portalNotify"`.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/_shared/portalNotify.ts`:

```ts
/**
 * The portal_notify drain (Partner Portal Phase 1C, spec 5.8 and 5.9, brief E4).
 *
 * Every run: queue the same-day nudges for "now" (enqueue_portal_nudges), claim
 * one batch from portal_email_outbox (claim_portal_emails, FOR UPDATE SKIP
 * LOCKED), build each email (portalNotifyEmail.ts), and settle each row with
 * mark_portal_email:
 *   sent      the provider accepted it
 *   dropped   invalid_payload (nothing safe to send) or email_guard (the
 *             non-production allowlist blocked the recipient)
 *   failed    the provider refused it; SQL retries with backoff and gives up
 *             after the fifth attempt
 *
 * Partner emails go out in the ISO's name (portalFromAddress), with the ISO's
 * brand and Reply-To the assigned rep. Internal emails use the shared sender
 * and the default template. Logs carry outbox ids and kinds, never addresses.
 *
 * Pure TS with injected dependencies and no Deno globals at module scope, so
 * the app's vitest covers it. portal_notify/index.ts wires the real clients.
 */
import { shouldSend } from "./emailGuard.ts";
import { renderEmail, type EmailBrand } from "./emailTemplate.ts";
import { portalFromAddress } from "./portalEmail.ts";
import { buildPortalNotifyEmail } from "./portalNotifyEmail.ts";

export const PORTAL_NOTIFY_BATCH = 50;

export interface PortalNotifyMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface PortalNotifyBrand {
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface PortalNotifyEnv {
  appBaseUrl: string;
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
}

export interface PortalNotifyDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  /** The org's logo and color (org_branding), or null. */
  loadBrand(orgId: string): Promise<PortalNotifyBrand | null>;
  sendEmail(msg: PortalNotifyMessage): Promise<void>;
  now?(): Date;
  env: PortalNotifyEnv;
}

export interface PortalNotifySummary {
  nudgesQueued: number;
  claimed: number;
  sent: number;
  dropped: number;
  failed: number;
}

interface ClaimedRow {
  id: string;
  org_id: string;
  kind: string;
  referral_id: string | null;
  payload: unknown;
  recipient: string | null;
  attempts: number;
}

type Outcome = "sent" | "dropped" | "failed";

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

async function mark(deps: PortalNotifyDeps, id: string, outcome: Outcome, error: string | null): Promise<void> {
  const { error: markError } = await deps.rpc("mark_portal_email", { p_id: id, p_outcome: outcome, p_error: error });
  if (markError) console.error(`[portal_notify] mark ${outcome} failed for ${id}:`, markError.message);
}

async function deliver(
  row: ClaimedRow,
  deps: PortalNotifyDeps,
  brandFor: (orgId: string) => Promise<PortalNotifyBrand | null>,
): Promise<Outcome> {
  const built = buildPortalNotifyEmail(row.kind, row.payload, {
    appBaseUrl: deps.env.appBaseUrl,
    referralId: row.referral_id,
  });
  if (!built) {
    console.error(`[portal_notify] dropped ${row.kind} ${row.id}: payload did not build`);
    await mark(deps, row.id, "dropped", "invalid_payload");
    return "dropped";
  }
  if (!row.recipient || !shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.recipient)) {
    console.log(`[portal_notify][emailGuard] dropped ${row.kind} ${row.id} in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
    await mark(deps, row.id, "dropped", "email_guard");
    return "dropped";
  }

  let from = deps.env.fromAddress;
  let brand: EmailBrand | undefined;
  if (built.audience === "partner" && built.orgName) {
    const found = await brandFor(row.org_id);
    brand = { name: built.orgName, logoUrl: found?.logoUrl ?? null, primaryColor: found?.primaryColor ?? null };
    from = portalFromAddress(deps.env.fromAddress, built.orgName);
  }
  const { html, text } = renderEmail({ ...built, brand });

  try {
    await deps.sendEmail({
      from,
      to: row.recipient,
      subject: built.subject,
      html,
      text,
      ...(built.replyTo ? { replyTo: built.replyTo } : {}),
    });
  } catch (e) {
    const message = errorText(e);
    console.error(`[portal_notify] send failed for ${row.kind} ${row.id} (attempt ${row.attempts}):`, message);
    await mark(deps, row.id, "failed", message);
    return "failed";
  }
  await mark(deps, row.id, "sent", null);
  return "sent";
}

export async function drainPortalEmails(deps: PortalNotifyDeps): Promise<PortalNotifySummary> {
  const summary: PortalNotifySummary = { nudgesQueued: 0, claimed: 0, sent: 0, dropped: 0, failed: 0 };
  const now = deps.now ? deps.now() : new Date();

  // A failed nudge selection must not hold up emails already queued.
  const nudges = await deps.rpc("enqueue_portal_nudges", { p_now: now.toISOString() });
  if (nudges.error) console.error("[portal_notify] nudge enqueue failed:", nudges.error.message);
  else summary.nudgesQueued = typeof nudges.data === "number" ? nudges.data : 0;

  const claim = await deps.rpc("claim_portal_emails", { p_limit: PORTAL_NOTIFY_BATCH });
  if (claim.error) throw new Error(`claim failed: ${claim.error.message}`);
  const rows = Array.isArray(claim.data) ? (claim.data as ClaimedRow[]) : [];
  summary.claimed = rows.length;

  const brands = new Map<string, Promise<PortalNotifyBrand | null>>();
  const brandFor = (orgId: string) => {
    let pending = brands.get(orgId);
    if (!pending) {
      pending = deps.loadBrand(orgId).catch(() => null);
      brands.set(orgId, pending);
    }
    return pending;
  };

  for (const row of rows) {
    summary[await deliver(row, deps, brandFor)] += 1;
  }
  return summary;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter app test -- _shared/portalNotify.test`
Expected: PASS.

- [ ] **Step 5: Wire the edge function**

Create `supabase/functions/portal_notify/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2",
    "resend": "npm:resend@4.1.1"
  }
}
```

Create `supabase/functions/portal_notify/index.ts`:

```ts
// Supabase Edge Function: portal_notify (Partner Portal Phase 1C, spec 5.8 and 5.9).
//
// Invoked by pg_cron via pg_net every 2 minutes (20261014000006_portal_notify_cron.sql).
// Authenticates with CRON_SECRET (a raw string, NOT a JWT) via requireCronCaller,
// so this function MUST be verify_jwt=false in config.toml or the gateway 401s
// the scheduler before it runs.
//
// Each run queues the same-day nudges, then drains up to 50 rows of
// portal_email_outbox. All logic lives in _shared/portalNotify.ts (unit-tested);
// this file only wires the service-role client, Resend and the brand lookup.
//
// Setup an operator must do per environment before this delivers anything:
//   1. Create the Vault secret `portal_notify_fn_url` = this function's URL
//      (prod https://api.getnavigatr.io/functions/v1/portal_notify).
//   2. CRON_SECRET, RESEND_API_KEY, APP_ENV, EMAIL_ALLOWLIST, FROM_ADDRESS and
//      APP_BASE_URL are the same Edge Function secrets notify_no_deals uses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { requireCronCaller } from "../_shared/cronAuth.ts";
import { drainPortalEmails, type PortalNotifyDeps } from "../_shared/portalNotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Auth for the cron caller is a dedicated secret, NOT the service-role key.
// See _shared/cronAuth.ts for why.
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable; unset APP_ENV
// fails closed (nothing sends). See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

const deps: PortalNotifyDeps = {
  rpc: async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  },
  loadBrand: async (orgId) => {
    const { data, error } = await db
      .from("org_branding")
      .select("logo_url, primary_color")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      logoUrl: typeof data.logo_url === "string" ? data.logo_url : null,
      primaryColor: typeof data.primary_color === "string" ? data.primary_color : null,
    };
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

Deno.serve(async (req) => {
  const denied = requireCronCaller(req, CRON_SECRET);
  if (denied) return denied;
  try {
    const summary = await drainPortalEmails(deps);
    return new Response(JSON.stringify(summary), { headers: JSON_HEADERS });
  } catch (e) {
    console.error("[portal_notify] run failed:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: JSON_HEADERS });
  }
});
```

In `supabase/config.toml`, replace

```toml
[functions.notify_no_deals]
verify_jwt = false
```

with

```toml
[functions.notify_no_deals]
verify_jwt = false

# Same reasoning as the cron functions above. portal_notify drains the partner
# portal email outbox and queues the same-day nudge: pg_cron invokes it every 2
# minutes with CRON_SECRET (a raw string, not a JWT), so verify_jwt=true would
# 401 the scheduler at the gateway. requireCronCaller in the function is the
# real gate.
[functions.portal_notify]
verify_jwt = false
```

In `apps/app/tsconfig.app.json`, replace

```json
    "../../supabase/functions/_shared/portalNotifyEmail.ts"
  ]
```

with

```json
    "../../supabase/functions/_shared/portalNotifyEmail.ts",
    "../../supabase/functions/_shared/portalNotify.ts"
  ]
```

- [ ] **Step 6: Typecheck the function with Deno**

Run: `deno check --no-lock --config supabase/functions/portal_notify/deno.json supabase/functions/portal_notify/index.ts`
Expected: exits 0 (Resend 4.1.1 names the option `replyTo`).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalNotify.ts supabase/functions/_shared/portalNotify.test.ts supabase/functions/portal_notify supabase/config.toml apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): portal_notify drains the email outbox on a cron secret

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Schedule `portal_notify` and report its health

**Files:**
- Create: `supabase/migrations/20261014000006_portal_notify_cron.sql`
- Test: `supabase/tests/050_portal_notify_cron.sql`
- Modify: `apps/app/src/features/admin/lib/cronHealth.ts`, `apps/app/src/features/admin/lib/cronHealth.test.ts`

**Interfaces:**
- Consumes: the shared Vault secret `cron_secret` (20260812000004); a per-environment Vault secret `portal_notify_fn_url` that an operator creates at apply time, exactly like `notify_no_deals_fn_url` and `capture_email_fn_url`; Task 2 `portal_email_outbox`.
- Produces:
  - pg_cron job `portal-notify`, schedule `*/2 * * * *`, POSTing `{}` to `portal_notify_fn_url` with `Authorization: Bearer <cron_secret>`.
  - `public.cron_health() returns jsonb` (same signature, privileges and admin-only rule) gains key `portal_email: { pending: number, oldest_pending_at: string | null, failed_7d: number, sent_7d: number }` for the caller's org.
  - `cronHealth.ts`: `CronHealthFacts.portal_email?: { pending: number; oldest_pending_at: string | null; failed_7d: number; sent_7d: number } | null`, `const PARTNER_EMAIL_STALE_MINUTES = 15`, and a fourth row from `summarizeCronHealth` named `Partner emails (2 min)`: idle with nothing yet, attention when any email failed in the last 7 days, stale when the oldest pending email is older than 15 minutes, otherwise ok.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/050_portal_notify_cron.sql`:

```sql
-- Tests for 20261014000006_portal_notify_cron (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/050_portal_notify_cron.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-health): boss administrator, rita rep, one active portal
-- user. Outbox: one pending (30 minutes old), one failed yesterday, one sent two
-- days ago, one sent ten days ago. A second org has a pending row that must not
-- be counted.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001050', 'Health Org',   'portal-health',   'portal-health-a1',   true),
  ('00000000-0000-0000-0000-000000001150', 'Health Org B', 'portal-health-b', 'portal-health-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0500000-0000-0000-0000-000000000001', 'boss@health.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0500000-0000-0000-0000-000000000002', 'rita@health.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0500000-0000-0000-0000-000000000003', 'boss@healthb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001050', 'admin', 'administrator',      'Boss',     'boss@health.example',  'hlthboss'::ltree,      null),
  ('a0500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001050', 'rep',   'sales_professional', 'Rita Rep', 'rita@health.example',  'hlthboss.rita'::ltree, 'a0500000-0000-0000-0000-000000000001'),
  ('a0500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001150', 'admin', 'administrator',      'Boss B',   'boss@healthb.example', 'hlthbossb'::ltree,     null);

insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key, created_at, sent_at, failed_at, attempts) values
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:pending', now() - interval '30 minutes', null, null, 0),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:failed',  now() - interval '2 days',   null, now() - interval '1 day', 5),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:sent',    now() - interval '2 days',   now() - interval '2 days', null, 1),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:old',     now() - interval '10 days',  now() - interval '10 days', null, 1),
  ('00000000-0000-0000-0000-000000001150', 'internal_nudge', 'a0500000-0000-0000-0000-000000000003', '{}', 't50:other',   now() - interval '1 hour',   null, null, 0);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- The job is registered every 2 minutes with the per-environment URL and the shared secret.
do $$ declare j record; begin
  select schedule, command into j from cron.job where jobname = 'portal-notify';
  if j.schedule is distinct from '*/2 * * * *' then raise exception 'portal-notify should run every 2 minutes, got %', j.schedule; end if;
  if position('portal_notify_fn_url' in j.command) = 0 or position('cron_secret' in j.command) = 0 then
    raise exception 'portal-notify must read its URL and the cron secret from Vault: %', j.command;
  end if;
  if position('http' in replace(j.command, 'net.http_post', '')) > 0 then
    raise exception 'portal-notify must not hardcode a URL: %', j.command;
  end if;
end $$;

-- Privileges unchanged.
do $$ begin
  if not has_function_privilege('authenticated', 'public.cron_health()', 'EXECUTE') then
    raise exception 'authenticated should still execute cron_health';
  end if;
end $$;

-- An administrator sees their org's partner email health (role switches from here on).
do $$ declare h jsonb; begin
  perform _t_act('a0500000-0000-0000-0000-000000000001');
  h := public.cron_health() -> 'portal_email';
  if (h->>'pending')::int <> 1 or (h->>'failed_7d')::int <> 1 or (h->>'sent_7d')::int <> 1 then
    raise exception 'portal_email counts wrong: %', h;
  end if;
  if (h->>'oldest_pending_at') is null then raise exception 'oldest_pending_at should be set: %', h; end if;
  if (public.cron_health() ? 'email_capture') is not true then raise exception 'existing keys must stay'; end if;
end $$;

-- A rep gets nothing.
do $$ begin
  perform _t_act('a0500000-0000-0000-0000-000000000002');
  if public.cron_health() <> '{}'::jsonb then raise exception 'a non-admin must get {}'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/050_portal_notify_cron.sql`
Expected: FAIL with `portal-notify should run every 2 minutes, got <NULL>`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000006_portal_notify_cron.sql`:

```sql
-- 20261014000006_portal_notify_cron.sql
--
-- Partner Portal Phase 1C: run portal_notify every 2 minutes. Same wiring as
-- 20260820000013 (email capture poll) and 20260825000006 (notify_no_deals):
-- pg_cron triggers the Edge function via pg_net; auth is the shared
-- CRON_SECRET (Vault `cron_secret`, bootstrapped by 20260812000004); the URL
-- comes from a per-environment Vault secret `portal_notify_fn_url` that an
-- operator creates at apply time, so staging never posts to production and no
-- URL or secret is stored here. Until that secret exists the job posts to a
-- null URL and nothing is sent (dark until set up).
--
-- Also: cron_health (20260825000002) reports outcome freshness per job for the
-- admin card. It gains portal_email for the caller's org: emails still waiting,
-- the oldest of them, and sends and failures over the last 7 days.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('portal-notify')
where exists (select 1 from cron.job where jobname = 'portal-notify');

select cron.schedule(
  'portal-notify',
  '*/2 * * * *',  -- every 2 minutes: partner emails go out promptly, nudges land within 2 minutes of end of day
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'portal_notify_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

create or replace function public.cron_health()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when not public.caller_is_admin() then '{}'::jsonb
    else jsonb_build_object(
      'persistence', (
        select jsonb_build_object('latest_date', max(snapshot_date), 'rows', count(*))
        from persistence_company_snapshot where org_id = public.user_org_id()
      ),
      'coverage', (
        select jsonb_build_object('latest_date', max(snapshot_date), 'rows', count(*))
        from coverage_snapshot where org_id = public.user_org_id()
      ),
      'email_capture', (
        select jsonb_build_object(
          'connections', count(*),
          'freshest_poll_at', max(last_poll_at),
          'unhealthy', count(*) filter (where health <> 'ok')
        )
        from email_connection where org_id = public.user_org_id()
      ),
      'portal_email', (
        select jsonb_build_object(
          'pending', count(*) filter (where sent_at is null and dropped_at is null and failed_at is null),
          'oldest_pending_at', min(created_at) filter (where sent_at is null and dropped_at is null and failed_at is null),
          'failed_7d', count(*) filter (where failed_at > now() - interval '7 days'),
          'sent_7d', count(*) filter (where sent_at > now() - interval '7 days')
        )
        from portal_email_outbox where org_id = public.user_org_id()
      )
    )
  end
$$;

grant execute on function public.cron_health() to authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/050_portal_notify_cron.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Write the failing client test**

Append to `apps/app/src/features/admin/lib/cronHealth.test.ts` (and change its import line to `import { summarizeCronHealth, cronHealthNeedsAttention, POLL_STALE_MINUTES, PARTNER_EMAIL_STALE_MINUTES } from "./cronHealth";`):

```ts
describe("summarizeCronHealth: partner emails", () => {
  const row = (facts: Parameters<typeof summarizeCronHealth>[0]) =>
    summarizeCronHealth(facts, NOW).find((r) => r.job === "Partner emails (2 min)")!;

  it("idle when nothing has been sent or queued", () => {
    expect(row({}).status).toBe("idle");
    expect(row({ portal_email: { pending: 0, oldest_pending_at: null, failed_7d: 0, sent_7d: 0 } })).toEqual({
      job: "Partner emails (2 min)",
      status: "idle",
      detail: "No partner emails yet",
    });
  });

  it("ok while emails go out", () => {
    expect(row({ portal_email: { pending: 1, oldest_pending_at: minsAgo(3), failed_7d: 0, sent_7d: 4 } })).toEqual({
      job: "Partner emails (2 min)",
      status: "ok",
      detail: "4 sent this week",
    });
  });

  it("stale when an email has waited longer than the window", () => {
    const r = row({ portal_email: { pending: 2, oldest_pending_at: minsAgo(PARTNER_EMAIL_STALE_MINUTES + 5), failed_7d: 0, sent_7d: 0 } });
    expect(r.status).toBe("stale");
    expect(r.detail).toBe("Emails waiting to send");
  });

  it("attention when an email could not be delivered this week", () => {
    const r = row({ portal_email: { pending: 0, oldest_pending_at: null, failed_7d: 2, sent_7d: 9 } });
    expect(r.status).toBe("attention");
    expect(r.detail).toBe("2 not delivered this week");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/admin/lib/cronHealth.test.ts`
Expected: FAIL (`PARTNER_EMAIL_STALE_MINUTES` is undefined and no "Partner emails (2 min)" row exists).

- [ ] **Step 7: Add the row**

In `apps/app/src/features/admin/lib/cronHealth.ts`, replace

```ts
  email_capture?: { connections: number; freshest_poll_at: string | null; unhealthy: number } | null;
}
```

with

```ts
  email_capture?: { connections: number; freshest_poll_at: string | null; unhealthy: number } | null;
  /** Partner portal email outbox (Phase 1C): drained every 2 minutes by portal_notify. */
  portal_email?: { pending: number; oldest_pending_at: string | null; failed_7d: number; sent_7d: number } | null;
}
```

replace

```ts
export const POLL_STALE_MINUTES = 15;
```

with

```ts
export const POLL_STALE_MINUTES = 15;

/** portal_notify runs every 2 min; an email still waiting after this many minutes means it is not running. */
export const PARTNER_EMAIL_STALE_MINUTES = 15;
```

and replace

```ts
        : { job: "Email capture poll (2 min)", status: "ok", detail: `Polling; ${ec.connections} connected` },
    );
  }
  return rows;
}
```

with

```ts
        : { job: "Email capture poll (2 min)", status: "ok", detail: `Polling; ${ec.connections} connected` },
    );
  }

  const pe = facts.portal_email;
  const partnerJob = "Partner emails (2 min)";
  if (!pe || (pe.pending === 0 && pe.failed_7d === 0 && pe.sent_7d === 0)) {
    rows.push({ job: partnerJob, status: "idle", detail: "No partner emails yet" });
  } else if (pe.failed_7d > 0) {
    rows.push({ job: partnerJob, status: "attention", detail: `${pe.failed_7d} not delivered this week` });
  } else {
    const oldest = pe.oldest_pending_at ? new Date(pe.oldest_pending_at).getTime() : NaN;
    const stuck =
      pe.pending > 0 && (Number.isNaN(oldest) || now.getTime() - oldest > PARTNER_EMAIL_STALE_MINUTES * 60 * 1000);
    rows.push(
      stuck
        ? { job: partnerJob, status: "stale", detail: "Emails waiting to send" }
        : { job: partnerJob, status: "ok", detail: `${pe.sent_7d} sent this week` },
    );
  }
  return rows;
}
```

- [ ] **Step 8: Run the admin tests**

Run: `pnpm --filter app test -- src/features/admin`
Expected: PASS (`CronHealthCard.test.tsx` unchanged: its fixtures have no `portal_email`, so the new row is idle).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261014000006_portal_notify_cron.sql supabase/tests/050_portal_notify_cron.sql apps/app/src/features/admin/lib/cronHealth.ts apps/app/src/features/admin/lib/cronHealth.test.ts
git commit -m "$(cat <<'EOF'
feat(portal): run portal_notify every 2 minutes and show its health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Partners see published updates on the referral page

**Files:**
- Modify: `supabase/functions/_shared/portalReferralApi.ts`, `supabase/functions/_shared/portalReferralApi.test.ts`
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`
- Modify: `apps/app/src/features/portal/pages/PortalReferralPage.tsx`, `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`
- Modify: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: Task 1 `portal_referral_updates(p_org, p_partner, p_referral)` returning `(body, published_at, author_name)`.
- Produces:
  - `interface PortalReferralUpdate { body: string; publishedAt: string; authorName: string | null }` (exported from `portalReferralApi.ts`, re-exported by `features/portal/lib/portalApi.ts`).
  - `PortalReferralDetail` gains `updates: PortalReferralUpdate[]` (newest first; blank bodies skipped; only `body`, `published_at` and `author_name` are read from a row).
  - `get_referral` makes a third rpc, `portal_referral_updates { p_org, p_partner, p_referral }`; its error is a 500 like the other two.
  - `PortalReferralPage` shows a card "Updates from {ISO}" above "Your contact at {ISO}" when there is at least one update: each update's text (line breaks kept), then "{author or ISO} · {date}".

- [ ] **Step 1: Write the failing handler tests**

In `supabase/functions/_shared/portalReferralApi.test.ts`, inside `describe("get_referral", ...)`, replace

```ts
  it("returns the allowlisted detail with labelled, collapsed history", async () => {
    const { deps, rpc } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok(HISTORY),
    });
```

with

```ts
  const UPDATES = [
    {
      body: "Demo booked for Tuesday",
      published_at: "2026-10-05T12:00:00Z",
      author_name: "Rita Rep",
      author_user_id: "author-uuid-secret",
      author_email: "author-secret@internal.example",
    },
    { body: "  Called the owner  ", published_at: "2026-10-04T12:00:00Z", author_name: null },
    { body: "   ", published_at: "2026-10-03T12:00:00Z", author_name: "Rita Rep" },
  ];

  it("returns the allowlisted detail with labelled, collapsed history", async () => {
    const { deps, rpc } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok(HISTORY),
      portal_referral_updates: () => ok(UPDATES),
    });
```

then replace

```ts
        history: [
          { label: "Received", at: "2026-10-01T12:00:00Z" },
          { label: "Accepted", at: "2026-10-02T12:00:00Z" },
          { label: "In Progress", at: "2026-10-03T12:00:00Z" },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ["working", "portal_signed_in", "outside_icp", "internal decline note", "proposal"]) {
```

with

```ts
        history: [
          { label: "Received", at: "2026-10-01T12:00:00Z" },
          { label: "Accepted", at: "2026-10-02T12:00:00Z" },
          { label: "In Progress", at: "2026-10-03T12:00:00Z" },
        ],
        updates: [
          { body: "Demo booked for Tuesday", publishedAt: "2026-10-05T12:00:00Z", authorName: "Rita Rep" },
          { body: "Called the owner", publishedAt: "2026-10-04T12:00:00Z", authorName: null },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledWith("portal_referral_updates", { p_org: "o-1", p_partner: "p-1", p_referral: RID });
    const text = JSON.stringify(json);
    for (const leak of [
      "working",
      "portal_signed_in",
      "outside_icp",
      "internal decline note",
      "proposal",
      "author-uuid-secret",
      "author-secret@internal.example",
    ]) {
```

In the same `describe`, the two remaining `setup({...})` calls that contain `portal_referral_history: () => ok([]),` each gain the line `portal_referral_updates: () => ok([]),` right after it.

Then add these tests at the end of `describe("get_referral", ...)`:

```ts
  it("returns an empty list when nothing was published", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => ok([]),
    });
    const { json } = await call("get_referral", { referralId: RID }, deps);
    expect((json.referral as Record<string, unknown>).updates).toEqual([]);
  });

  it("500s when the updates cannot be read", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([DETAIL]),
      portal_referral_history: () => ok([]),
      portal_referral_updates: () => fail("boom"),
    });
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(status).toBe(500);
    expect(json).toEqual({ error: "server_error" });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- _shared/portalReferralApi.test.ts`
Expected: FAIL (the detail has no `updates` key and `portal_referral_updates` is never called).

- [ ] **Step 3: Return the updates**

In `supabase/functions/_shared/portalReferralApi.ts`, replace

```ts
export interface PortalRepContact {
  name: string;
  email: string | null;
}
```

with

```ts
export interface PortalRepContact {
  name: string;
  email: string | null;
}

/** An update a rep published on the referral (spec 5.7): the only rep-written text a partner sees. */
export interface PortalReferralUpdate {
  body: string;
  publishedAt: string;
  /** The rep who wrote it, or null (the page then shows the ISO's name). */
  authorName: string | null;
}
```

replace

```ts
  rep: PortalRepContact | null;
  history: PortalHistoryEntry[];
}
```

with

```ts
  rep: PortalRepContact | null;
  history: PortalHistoryEntry[];
  /** Newest first. */
  updates: PortalReferralUpdate[];
}
```

replace

```ts
  const history = collapseHistory(
    rows<Record<string, unknown>>(hist.data).map((h) => ({ status: h.status, at: h.created_at })),
  );
```

with

```ts
  const history = collapseHistory(
    rows<Record<string, unknown>>(hist.data).map((h) => ({ status: h.status, at: h.created_at })),
  );

  // Spec 5.7: referral_updates.body is the only rep-written text a partner ever
  // sees. Three fields are read; nothing else in the row is passed on.
  const upd = await deps.rpc("portal_referral_updates", { ...scopeArgs(scope), p_referral: id });
  if (upd.error) return serverError("referral_updates", upd.error.message);
  const updates: PortalReferralUpdate[] = [];
  for (const u of rows<Record<string, unknown>>(upd.data)) {
    const body = str(u.body).trim();
    const publishedAt = str(u.published_at);
    if (!body || !publishedAt) continue;
    updates.push({ body, publishedAt, authorName: strOrNull(u.author_name) });
  }
```

and replace

```ts
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    history,
  };
```

with

```ts
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    history,
    updates,
  };
```

In `apps/app/src/features/portal/lib/portalApi.ts`, replace

```ts
import type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";

export type { PortalDashboard, PortalForm, PortalReferralDetail, PortalReferralSummary, PortalWindow };
```

with

```ts
import type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";

export type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
  PortalWindow,
};
```

- [ ] **Step 4: Run the handler tests**

Run: `pnpm --filter app test -- _shared/portalReferralApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing page tests**

In `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`, replace (the end of the `DETAIL` fixture)

```ts
  history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
};
```

with

```ts
  history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
  updates: [] as Array<{ body: string; publishedAt: string; authorName: string | null }>,
};
```

and add these tests at the end of `describe("PortalReferralPage", ...)`:

```tsx
  it("shows the ISO's published updates, newest first", async () => {
    api.getReferral.mockResolvedValue({
      ...DETAIL,
      label: "In Progress",
      canWithdraw: false,
      updates: [
        { body: "Demo booked for Tuesday.\nBring the statements.", publishedAt: "2026-10-05T12:00:00Z", authorName: "Rita Rep" },
        { body: "Called the owner.", publishedAt: "2026-10-03T12:00:00Z", authorName: null },
      ],
    });
    renderAt("/p/acme/r/r-1");
    const section = (await screen.findByRole("heading", { name: "Updates from Acme ISO" })).parentElement as HTMLElement;
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Demo booked for Tuesday.\nBring the statements.Rita Rep · Oct 5, 2026",
      "Called the owner.Acme ISO · Oct 3, 2026",
    ]);
  });

  it("has no updates section when nothing was published", async () => {
    renderAt("/p/acme/r/r-1");
    await screen.findByRole("heading", { name: "Fresh Bakery" });
    expect(screen.queryByRole("heading", { name: /Updates from/ })).toBeNull();
  });
```

- [ ] **Step 6: Run them to verify the first fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalReferralPage.test.tsx`
Expected: FAIL on "shows the ISO's published updates, newest first" (no "Updates from Acme ISO" heading).

- [ ] **Step 7: Render the updates**

In `apps/app/src/features/portal/pages/PortalReferralPage.tsx`, replace

```tsx
 * (name and business email). While it is still Received the partner can
 * withdraw it (FR-PORT-42). Published updates arrive in Phase 1C. Refreshes
 * every 30 seconds.
```

with

```tsx
 * (name and business email). While it is still Received the partner can
 * withdraw it (FR-PORT-42). Updates the ISO published on it (spec 5.7) show
 * newest first. Refreshes every 30 seconds.
```

replace

```tsx
  const r = q.data;
```

with

```tsx
  const r = q.data;
  // Defensive: a response from before Phase 1C has no updates key.
  const updates = r.updates ?? [];
```

and replace

```tsx
      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Your contact at {brand.orgName}</h2>
```

with

```tsx
      {updates.length > 0 && (
        <Card padding="lg">
          <section className="flex flex-col gap-2">
            <h2 className="text-body-strong text-text-default">Updates from {brand.orgName}</h2>
            <ol className="flex flex-col gap-3">
              {updates.map((u, i) => (
                <li key={`${u.publishedAt}-${i}`} className="flex flex-col gap-1">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{u.body}</p>
                  <p className="text-caption text-text-muted">
                    {u.authorName ?? brand.orgName} · <time dateTime={u.publishedAt}>{formatPortalDate(u.publishedAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </Card>
      )}

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Your contact at {brand.orgName}</h2>
```

- [ ] **Step 8: Keep the string audit's fixtures current**

In `apps/app/src/features/portal/portalStringAudit.test.tsx`:

(a) In the hostile `deps()` switch, replace

```ts
        case "portal_dashboard_stats":
```

with

```ts
        case "portal_referral_updates":
          return {
            data: [
              {
                body: "Demo booked for Tuesday",
                published_at: "2026-10-05T12:00:00Z",
                author_name: "Rita Rep",
                author_user_id: SECRET,
                author_email: `${SECRET}@internal.example`,
                status,
              },
            ],
            error: null,
          };
        case "portal_dashboard_stats":
```

(b) In the rendered detail fixture, replace

```ts
      history: HISTORY,
    });
```

with

```ts
      history: HISTORY,
      updates: [
        { body: "Demo booked for Tuesday", publishedAt: "2026-10-05T12:00:00Z", authorName: label === "Received" ? null : "Rita Rep" },
      ],
    });
```

(c) In the withdraw fixture, replace

```ts
      history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
    });
```

with

```ts
      history: [{ label: "Received", at: "2026-10-01T12:00:00Z" }],
      updates: [],
    });
```

- [ ] **Step 9: Run the portal tests**

Run: `pnpm --filter app test -- _shared/portalReferralApi.test.ts src/features/portal`
Expected: PASS, including every case of `portalStringAudit.test.tsx`.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/portalReferralApi.ts supabase/functions/_shared/portalReferralApi.test.ts apps/app/src/features/portal/lib/portalApi.ts apps/app/src/features/portal/pages/PortalReferralPage.tsx apps/app/src/features/portal/pages/PortalReferralPage.test.tsx apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "$(cat <<'EOF'
feat(portal): partners see the ISO's published updates on a referral

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: "Share update with partner" on Deal Detail

**Files:**
- Create: `apps/app/src/features/partners/hooks/useReferralUpdates.ts`, `apps/app/src/features/partners/hooks/useReferralUpdates.test.tsx`
- Create: `apps/app/src/features/partners/components/ShareUpdateSheet.tsx`, `apps/app/src/features/partners/components/ShareUpdateSheet.test.tsx`
- Create: `apps/app/src/features/partners/components/ReferralUpdatesPanel.tsx`, `apps/app/src/features/partners/components/ReferralUpdatesPanel.test.tsx`
- Modify: `apps/app/src/features/partners/lib/referrals.ts`, `apps/app/src/features/partners/lib/referrals.test.ts`
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`, `apps/app/src/features/pipeline/pages/DealDetailPage.referral.test.tsx`

**Interfaces:**
- Consumes: Task 1 `publish_referral_update(p_referral_id uuid, p_body text) returns uuid` and the `referral_updates` SELECT policy; `useDealReferral(dealId)` (`referralId`, `partnerVisible`, `partnerName`); `referralErrorMessage(err, fallback)`.
- Produces:
  - `useReferralUpdates.ts`: `const REFERRAL_UPDATE_MAX = 1000`; `interface ReferralUpdate { id: string; body: string; publishedAt: string; authorName: string | null }`; `function referralUpdatesKey(referralId: string): readonly ["referrals", "updates", string]`; `function useReferralUpdates(referralId: string | undefined)` (TanStack query of `ReferralUpdate[]`, newest first, at most 50, disabled without an id); `function usePublishReferralUpdate(referralId: string)` (mutation `(body: string) => Promise<string>` sending the trimmed text, then invalidating `referralUpdatesKey(referralId)`).
  - `ShareUpdateSheet({ open, onOpenChange, referralId, partnerLabel }: ShareUpdateSheetProps)`.
  - `ReferralUpdatesPanel({ referralId, partnerLabel }: { referralId: string; partnerLabel: string })`.
  - `referralErrorMessage` maps `update_required` to "Write the update first." and `update_too_long` to "Keep the update under 1,000 characters."

- [ ] **Step 1: Write the failing hook and copy tests**

Create `apps/app/src/features/partners/hooks/useReferralUpdates.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { REFERRAL_UPDATE_MAX, referralUpdatesKey, usePublishReferralUpdate, useReferralUpdates } from "./useReferralUpdates";

const limitMock = vi.fn();
const rpcMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return limitMock(); },
      };
      return chain;
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  limitMock.mockReset();
  rpcMock.mockReset();
  calls.length = 0;
});

describe("useReferralUpdates", () => {
  it("reads the referral's updates newest first, with the author's name", async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        { id: "u-2", body: "Demo booked", published_at: "2026-10-13T15:00:00Z", author: { full_name: "Rita Rep" } },
        { id: "u-1", body: "Called", published_at: "2026-10-12T15:00:00Z", author: null },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralUpdates("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "u-2", body: "Demo booked", publishedAt: "2026-10-13T15:00:00Z", authorName: "Rita Rep" },
      { id: "u-1", body: "Called", publishedAt: "2026-10-12T15:00:00Z", authorName: null },
    ]);
    expect(calls).toEqual([
      ["from", "referral_updates"],
      ["select", "id, body, published_at, author:profiles(full_name)"],
      ["eq", "referral_id", "r-1"],
      ["order", "published_at", { ascending: false }],
      ["limit", 50],
    ]);
  });

  it("does not query without a referral", () => {
    const { wrapper } = setup();
    renderHook(() => useReferralUpdates(undefined), { wrapper });
    expect(calls).toEqual([]);
  });

  it("reports a read error", async () => {
    limitMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralUpdates("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePublishReferralUpdate", () => {
  it("publishes the trimmed text and refreshes the list", async () => {
    rpcMock.mockResolvedValueOnce({ data: "u-9", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => usePublishReferralUpdate("r-1"), { wrapper });
    await expect(result.current.mutateAsync("  Demo booked  ")).resolves.toBe("u-9");
    expect(rpcMock).toHaveBeenCalledWith("publish_referral_update", { p_referral_id: "r-1", p_body: "Demo booked" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: referralUpdatesKey("r-1") }));
  });

  it("maps server errors to plain copy", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => usePublishReferralUpdate("r-1"), { wrapper });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "update_too_long" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("Keep the update under 1,000 characters.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("You don't have access to do that.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("Couldn't share the update");
  });

  it("caps an update at 1000 characters, like the database", () => {
    expect(REFERRAL_UPDATE_MAX).toBe(1000);
    expect(referralUpdatesKey("r-1")).toEqual(["referrals", "updates", "r-1"]);
  });
});
```

In `apps/app/src/features/partners/lib/referrals.test.ts`, replace

```ts
    expect(referralErrorMessage({ message: "company_required" }, "x")).toBe("Add the business name.");
```

with

```ts
    expect(referralErrorMessage({ message: "company_required" }, "x")).toBe("Add the business name.");
    expect(referralErrorMessage({ message: "update_required" }, "x")).toBe("Write the update first.");
    expect(referralErrorMessage({ message: "update_too_long" }, "x")).toBe("Keep the update under 1,000 characters.");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralUpdates.test.tsx src/features/partners/lib/referrals.test.ts`
Expected: FAIL (`./useReferralUpdates` does not exist; the two new tokens fall back to "x").

- [ ] **Step 3: Write the hooks and the copy**

Create `apps/app/src/features/partners/hooks/useReferralUpdates.ts`:

```ts
/**
 * Updates a rep shares with the referring partner (Partner Portal Phase 1C,
 * spec 5.7, FR-PORT-74). Reads go through the referral_updates RLS policy
 * (visible when the referral is); writes go only through
 * publish_referral_update, which re-checks rights and queues the partner email.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { referralErrorMessage } from "../lib/referrals";

/** Same limit as the referral_updates.body check in the database. */
export const REFERRAL_UPDATE_MAX = 1000;

export interface ReferralUpdate {
  id: string;
  body: string;
  publishedAt: string;
  authorName: string | null;
}

interface Row {
  id: string;
  body: string;
  published_at: string;
  author: { full_name: string | null } | null;
}

export function referralUpdatesKey(referralId: string) {
  return ["referrals", "updates", referralId] as const;
}

export function useReferralUpdates(referralId: string | undefined) {
  return useQuery({
    queryKey: referralUpdatesKey(referralId ?? "none"),
    enabled: Boolean(referralId),
    queryFn: async (): Promise<ReferralUpdate[]> => {
      const { data, error } = await supabase
        .from("referral_updates")
        .select("id, body, published_at, author:profiles(full_name)")
        .eq("referral_id", referralId as string)
        .order("published_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        body: r.body,
        publishedAt: r.published_at,
        authorName: r.author?.full_name ?? null,
      }));
    },
    staleTime: 30_000,
  });
}

export function usePublishReferralUpdate(referralId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string): Promise<string> => {
      const { data, error } = await supabase.rpc("publish_referral_update", {
        p_referral_id: referralId,
        p_body: body.trim(),
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't share the update"));
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralUpdatesKey(referralId) });
    },
  });
}
```

In `apps/app/src/features/partners/lib/referrals.ts`, replace

```ts
  ["override_reason_required", "Add a short reason to accept a possible duplicate."],
```

with

```ts
  ["override_reason_required", "Add a short reason to accept a possible duplicate."],
  ["update_required", "Write the update first."],
  ["update_too_long", "Keep the update under 1,000 characters."],
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralUpdates.test.tsx src/features/partners/lib/referrals.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing sheet and panel tests**

Create `apps/app/src/features/partners/components/ShareUpdateSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ShareUpdateSheet } from "./ShareUpdateSheet";

const publishMock = vi.fn();
vi.mock("../hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  usePublishReferralUpdate: () => ({ mutateAsync: publishMock, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
      <textarea aria-label="Update" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => {
  publishMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function setup() {
  const onOpenChange = vi.fn();
  render(<ShareUpdateSheet open onOpenChange={onOpenChange} referralId="r-1" partnerLabel="Jane" />);
  return onOpenChange;
}

describe("ShareUpdateSheet", () => {
  it("names the partner and says only this text is shared", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Share an update with Jane" })).toBeInTheDocument();
    expect(screen.getByText("They see this on their referral, word for word. Nothing else you write is shared.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What should the partner know?")).toBeInTheDocument();
  });

  it("needs some text", () => {
    setup();
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
  });

  it("shares the text, confirms, and closes", async () => {
    publishMock.mockResolvedValueOnce("u-1");
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "Demo booked" } });
    expect(screen.getByText("11/1000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share update" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(publishMock).toHaveBeenCalledWith("Demo booked");
    expect(toastSuccess).toHaveBeenCalledWith("Update shared with Jane.");
  });

  it("blocks more than 1000 characters", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "a".repeat(1001) } });
    expect(screen.getByText("1001/1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share update" })).toBeDisabled();
  });

  it("shows the server's message and stays open when sharing fails", async () => {
    publishMock.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Update"), { target: { value: "Demo booked" } });
    fireEvent.click(screen.getByRole("button", { name: "Share update" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
```

Create `apps/app/src/features/partners/components/ReferralUpdatesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { ReferralUpdatesPanel } from "./ReferralUpdatesPanel";

let updates: Array<{ id: string; body: string; publishedAt: string; authorName: string | null }> | undefined = [];
vi.mock("../hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  useReferralUpdates: () => ({ data: updates }),
  usePublishReferralUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <textarea aria-label="Update" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => {
  updates = [];
});

describe("ReferralUpdatesPanel", () => {
  it("lists what was shared, newest first, with the author or Your team", () => {
    updates = [
      { id: "u-2", body: "Demo booked", publishedAt: "2026-10-13T15:00:00Z", authorName: "Rita Rep" },
      { id: "u-1", body: "Called", publishedAt: "2026-10-12T15:00:00Z", authorName: null },
    ];
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    const list = screen.getByText("SHARED WITH PARTNER").parentElement as HTMLElement;
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Demo bookedRita Rep · Oct 13",
      "CalledYour team · Oct 12",
    ]);
  });

  it("shows only the button when nothing was shared yet", () => {
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    expect(screen.queryByText("SHARED WITH PARTNER")).toBeNull();
    expect(screen.getByRole("button", { name: "Share update with partner" })).toBeInTheDocument();
  });

  it("opens the share sheet for this partner", () => {
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    fireEvent.click(screen.getByRole("button", { name: "Share update with partner" }));
    expect(screen.getByRole("heading", { name: "Share an update with Jane" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/components/ShareUpdateSheet.test.tsx src/features/partners/components/ReferralUpdatesPanel.test.tsx`
Expected: FAIL (`./ShareUpdateSheet` and `./ReferralUpdatesPanel` do not exist).

- [ ] **Step 7: Write the sheet and the panel**

Create `apps/app/src/features/partners/components/ShareUpdateSheet.tsx`:

```tsx
/**
 * ShareUpdateSheet: write an update the referring partner sees on their
 * referral (spec 5.7, FR-PORT-74). This is the only text that ever leaves the
 * app for the portal, so the sheet says so. Partners with portal access also
 * get it by email.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, NotesFieldWithMic } from "@/components/navigatr";
import { REFERRAL_UPDATE_MAX, usePublishReferralUpdate } from "../hooks/useReferralUpdates";

export interface ShareUpdateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referralId: string;
  /** The partner's name, or "the partner" when it is hidden from this viewer. */
  partnerLabel: string;
}

export function ShareUpdateSheet({ open, onOpenChange, referralId, partnerLabel }: ShareUpdateSheetProps) {
  const publish = usePublishReferralUpdate(referralId);
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (open) setBody("");
  }, [open]);

  const length = body.trim().length;
  const tooLong = length > REFERRAL_UPDATE_MAX;
  const canShare = length > 0 && !tooLong && !publish.isPending;

  const onShare = async () => {
    if (!canShare) return;
    try {
      await publish.mutateAsync(body);
      toast.success(`Update shared with ${partnerLabel}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't share the update");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 text-text-default shadow-card-hover sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg sm:max-h-[80vh]"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Share an update with {partnerLabel}</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <p className="text-body-sm text-text-muted">
            They see this on their referral, word for word. Nothing else you write is shared.
          </p>

          <NotesFieldWithMic
            value={body}
            onChange={setBody}
            placeholder="What should the partner know?"
            maxLength={REFERRAL_UPDATE_MAX}
          />
          <p className={tooLong ? "text-caption text-status-danger" : "text-caption text-text-subtle"}>
            {length}/{REFERRAL_UPDATE_MAX}
          </p>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" disabled={!canShare} loading={publish.isPending} onClick={onShare}>
              Share update
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ShareUpdateSheet;
```

Create `apps/app/src/features/partners/components/ReferralUpdatesPanel.tsx`:

```tsx
/**
 * ReferralUpdatesPanel: under "Referred by" on Deal Detail (spec 5.7). Lists
 * what was shared with the partner, newest first, and opens ShareUpdateSheet.
 * Short and scannable: reps read it in the field.
 */
import * as React from "react";
import { Button } from "@/components/navigatr";
import { useReferralUpdates } from "../hooks/useReferralUpdates";
import { ShareUpdateSheet } from "./ShareUpdateSheet";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ReferralUpdatesPanel({ referralId, partnerLabel }: { referralId: string; partnerLabel: string }) {
  const { data: updates } = useReferralUpdates(referralId);
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {updates && updates.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-eyebrow text-text-subtle">SHARED WITH PARTNER</span>
          <ul className="flex flex-col gap-2">
            {updates.map((u) => (
              <li key={u.id} className="flex flex-col gap-0.5">
                <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{u.body}</p>
                <span className="text-caption text-text-subtle">
                  {u.authorName ?? "Your team"} · {shortDate(u.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Share update with partner
      </Button>
      <ShareUpdateSheet open={open} onOpenChange={setOpen} referralId={referralId} partnerLabel={partnerLabel} />
    </div>
  );
}

export default ReferralUpdatesPanel;
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/components/ShareUpdateSheet.test.tsx src/features/partners/components/ReferralUpdatesPanel.test.tsx`
Expected: PASS.

- [ ] **Step 9: Put the panel under "Referred by"**

In `apps/app/src/features/pipeline/pages/DealDetailPage.referral.test.tsx`, replace

```ts
vi.mock("@/features/partners/hooks/useDealReferral", () => ({
  useDealReferral: () => ({ data: dealReferral }),
}));
```

with

```ts
vi.mock("@/features/partners/hooks/useDealReferral", () => ({
  useDealReferral: () => ({ data: dealReferral }),
}));

vi.mock("@/features/partners/hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  useReferralUpdates: () => ({ data: [] }),
  usePublishReferralUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
```

replace

```ts
    expect(screen.getByText(/Referred by/)).toBeInTheDocument();
```

with

```ts
    expect(screen.getByText(/Referred by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share update with partner" })).toBeInTheDocument();
```

and replace

```ts
    expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
```

with

```ts
    expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share update with partner" })).not.toBeInTheDocument();
```

Run: `pnpm --filter app test -- src/features/pipeline/pages/DealDetailPage.referral.test.tsx`
Expected: FAIL on "shows who referred the deal" (no Share button yet).

In `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`, replace

```tsx
import { useDealReferral } from "@/features/partners/hooks/useDealReferral";
```

with

```tsx
import { useDealReferral } from "@/features/partners/hooks/useDealReferral";
import { ReferralUpdatesPanel } from "@/features/partners/components/ReferralUpdatesPanel";
```

and replace

```tsx
          ) : (
            "Referred by a partner"
          )}
        </p>
      )}
```

with

```tsx
          ) : (
            "Referred by a partner"
          )}
        </p>
      )}
      {referral && (
        <ReferralUpdatesPanel
          referralId={referral.referralId}
          partnerLabel={referral.partnerVisible && referral.partnerName ? referral.partnerName : "the partner"}
        />
      )}
```

- [ ] **Step 10: Run the partners and pipeline tests**

Run: `pnpm --filter app test -- src/features/partners src/features/pipeline`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReferralUpdates.ts apps/app/src/features/partners/hooks/useReferralUpdates.test.tsx apps/app/src/features/partners/components/ShareUpdateSheet.tsx apps/app/src/features/partners/components/ShareUpdateSheet.test.tsx apps/app/src/features/partners/components/ReferralUpdatesPanel.tsx apps/app/src/features/partners/components/ReferralUpdatesPanel.test.tsx apps/app/src/features/partners/lib/referrals.ts apps/app/src/features/partners/lib/referrals.test.ts apps/app/src/features/pipeline/pages/DealDetailPage.tsx apps/app/src/features/pipeline/pages/DealDetailPage.referral.test.tsx
git commit -m "$(cat <<'EOF'
feat(referrals): share an update with the partner from Deal Detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: String audit covers partner emails

**Files:**
- Modify: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: Task 6 `renderEmail`, `POWERED_BY`; Task 7 `buildPortalNotifyEmail`, `PARTNER_NOTIFY_KINDS`, `KIND_LABEL`; the audit file's existing `INTERNAL_STATUSES`, `FORBIDDEN_WORDS`, `SECRET`, `OTHER_PARTNER`.
- Produces: a `describe("partner emails: copy audit")` block (brief E5, spec 7): every partner email kind, and the update email under every partner label, is built from a payload that also carries hostile internal fields; its copy and its rendered text carry no internal status word, no stage, no reason code, no secret, no other partner, and no "navigatr" except the locked "Powered by navigatr" line (links excluded: the portal address is on the app's domain).

- [ ] **Step 1: Write the audit**

In `apps/app/src/features/portal/portalStringAudit.test.tsx`, replace

```ts
import { PORTAL_LABELS } from "../../../../../supabase/functions/_shared/portalLabels";
```

with

```ts
import { PORTAL_LABELS } from "../../../../../supabase/functions/_shared/portalLabels";
import {
  KIND_LABEL,
  PARTNER_NOTIFY_KINDS,
  buildPortalNotifyEmail,
} from "../../../../../supabase/functions/_shared/portalNotifyEmail";
import { POWERED_BY, renderEmail } from "../../../../../supabase/functions/_shared/emailTemplate";
```

and append to the end of the file:

```tsx
describe("partner emails: copy audit", () => {
  const RID = "3f9a21c0-1111-4222-8333-444455556666";
  const CTX = { appBaseUrl: "https://app.getnavigatr.io", referralId: RID };
  const payload = (label: string) => ({
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: "Jane",
    companyName: "Fresh Bakery",
    ref: "REF-3F9A21C0",
    label,
    valueCents: 500000,
    repName: "Rita Rep",
    repEmail: "rita@acme.example",
    updateBody: "Spoke with the owner today. Demo next Tuesday.",
    // Hostile extras: nothing here may ever reach an email.
    status: "lost",
    stage: "proposal",
    decline_reason: "outside_icp",
    notes: `${SECRET} deal note`,
    other_partner: OTHER_PARTNER,
  });

  const CASES: Array<[string, string]> = PARTNER_NOTIFY_KINDS.flatMap((kind): Array<[string, string]> =>
    kind === "partner_update" ? PORTAL_LABELS.map((label): [string, string] => [kind, label]) : [[kind, KIND_LABEL[kind]]],
  );

  it.each(CASES)("%s labelled %s: partner words only, the ISO's name, the locked credit", (kind, label) => {
    const built = buildPortalNotifyEmail(kind, payload(label), CTX);
    expect(built).not.toBeNull();
    const e = built!;
    const copy = [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
    expect(copy.match(FORBIDDEN_WORDS)).toBeNull();
    expect(copy).not.toMatch(/navigatr/i);
    expect(copy).toContain("Acme ISO");

    const { html, text } = renderEmail({ ...e, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    const visible = text.replace(/https?:\/\/\S+/g, "");
    expect(visible.match(FORBIDDEN_WORDS)).toBeNull();
    expect(visible).toContain(POWERED_BY);
    expect(visible.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    for (const leak of [SECRET, OTHER_PARTNER, "outside_icp", "proposal"]) {
      expect(html).not.toContain(leak);
      expect(text).not.toContain(leak);
    }
  });

  it("drops every partner email whose label is an internal status", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      for (const status of INTERNAL_STATUSES) {
        expect(buildPortalNotifyEmail(kind, payload(status), CTX)).toBeNull();
      }
    }
  });

  it("shows no amount when the ISO hides closed-won value", () => {
    const won = buildPortalNotifyEmail("partner_closed_won", { ...payload("Closed Won"), valueCents: null }, CTX)!;
    expect(renderEmail(won).text).not.toContain("$");
  });
});
```

- [ ] **Step 2: Run the audit**

Run: `pnpm --filter app test -- src/features/portal/portalStringAudit.test.tsx`
Expected: PASS (11 email cases: five status kinds plus the update under six labels). If a case fails, the failure names the leaked word: fix the builder copy in `portalNotifyEmail.ts`, never the audit list.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "$(cat <<'EOF'
test(portal): string audit covers every partner email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification, push, PR to main (the controller runs this task)

**Files:** none changed.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`045` to `050` included, and `001` to `044` still passing), the two documented SKIPs unchanged.

- [ ] **Step 2: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds met, no `act()` warnings from the new files.

- [ ] **Step 3: The default email template never changed**

Run: `git log --format=%s main..HEAD -- supabase/functions/_shared/__snapshots__`
Expected: exactly one line, `test(email): pin the default template byte for byte`.

- [ ] **Step 4: Real production build**

Run: `pnpm --filter app build`
Expected: exits 0 (`tsc -b` typechecks `portalNotifyEmail.ts` and `portalNotify.ts` through the include list; `vite build` succeeds).

- [ ] **Step 5: Deno typecheck of every function that renders email**

Run:

```bash
for f in portal_notify portal_api portal_invite notify_no_deals send_auth_email; do
  NO_COLOR=1 deno check --no-lock --config supabase/functions/$f/deno.json supabase/functions/$f/index.ts || echo "FAILED $f"
done
NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/transcribe/index.ts || echo "FAILED transcribe"
NO_COLOR=1 deno check --no-lock --config supabase/functions/send_invite_email/deno.json supabase/functions/send_invite_email/index.ts 2>&1 | grep -E "^TS[0-9]+ \[ERROR\]"
```

Expected: no `FAILED` line, and the last command prints exactly one line, the error that already exists on main: `TS2353 [ERROR]: Object literal may only specify known properties, and 'dropped' does not exist in type '{ id: string; ok: boolean; error?: string | undefined; }'.`

- [ ] **Step 6: No long dashes; the portal still never uses the app session**

Run: `git diff --name-only main...HEAD | xargs perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof'`
Expected: no output.

Run: `grep -rn "supabase.functions.invoke\|supabase.auth" apps/app/src/features/portal --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: no output.

- [ ] **Step 7: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal Phase 1C: updates and notifications" --body "$(cat <<'EOF'
## Summary
- Reps can share a short written update with the referring partner from the deal's "Referred by" line (with dictation). It is the only text that ever goes from the app to the portal; the sheet says so.
- Partners see those updates, newest first, on their referral page ("Updates from {ISO}").
- Partners with active portal access now get emails when their referral is received, accepted, closed won (with the value only when the ISO allows it), not moving forward, withdrawn by the ISO, or gets an update. Partners without portal access get nothing. Every email names the ISO and uses partner labels only; Reply-To is the assigned rep.
- Reps get "New partner referral for you" when one is routed to them (or every active admin for the admin queue), and one end-of-day digest when partner referrals from today are still waiting, in their own time zone.
- Partner emails, including the invite and the sign-in code, now carry the ISO's logo (or name) and color with the locked "Powered by navigatr" line. Every other email (invites, password resets, the no-deals nudge) is byte-for-byte unchanged (snapshot test).
- All of it runs through one outbox: database triggers decide each email, and a new `portal_notify` function sends them every 2 minutes through the existing non-production allowlist. Failed sends retry with backoff and stop after 5 tries. Admins see a "Partner emails (2 min)" row in Scheduled jobs.

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (sections 5.6 to 5.9, 6, 7)
Plan: docs/superpowers/plans/2026-10-14-partner-portal-1c-updates-notifications.md

## Setup per environment (staging, then production at promote time)
- Create the Vault secret `portal_notify_fn_url` = the function's URL (production: https://api.getnavigatr.io/functions/v1/portal_notify). Until it exists the cron job posts nowhere and nothing is sent.
- No new Edge Function secrets: `portal_notify` uses the same CRON_SECRET, RESEND_API_KEY, APP_ENV, EMAIL_ALLOWLIST, FROM_ADDRESS and APP_BASE_URL as notify_no_deals.

## Deviations (details in the plan)
- The digest's default end of day is 18:00, the app's own default, not 17:00.
- The digest covers referrals received before the reviewer's end of day, once per reviewer per day.
- Share update is on Deal Detail only (not the review sheet or Partner Detail).
- Rep-logged inbound referrals email their partner on status changes; outbound referrals never email.

## Not in this PR
- Weekly digest, CSV export, public form, "Referrals sent to you", partner notification preferences, Firms, 90-day purge.

## Test plan
- [ ] DB tests 045 to 050 pass in CI from an empty database, with 001 to 044 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging (after creating `portal_notify_fn_url`, with your address on EMAIL_ALLOWLIST): submit a referral as a partner; the partner gets "Received by {ISO}" and the assignee gets "New partner referral" within 2 minutes
- [ ] Staging: accept it; the partner gets "Accepted by {ISO}" with the ISO's logo and Reply-To the rep
- [ ] Staging: on the deal, Share update with partner; the partner sees it on the referral page and gets the email
- [ ] Staging: move the deal to Won with value visibility on, then off on another referral; the amount appears only when on
- [ ] Staging: a partner withdraws their own referral; no Withdrawn email. The rep withdraws another; the partner gets it
- [ ] Staging: leave a referral untriaged past your end of day; one digest arrives, and only one
- [ ] Settings, Scheduled jobs: "Partner emails (2 min)" shows OK

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Bind the PR**

Use the ccd_pr `get_status` tool; if it does not report this PR, call `bind_pr` with its URL. Do not merge or promote without the user's go.

---

## Summary

| Task | What ships |
|---|---|
| 1 | `referral_updates`, `publish_referral_update`, `portal_referral_updates` |
| 2 | `portal_email_outbox`, `claim_portal_emails` (skip locked, backoff, recipient check), `mark_portal_email` |
| 3 | SQL labels and allowlisted payloads; triggers queue partner and rep emails on referral changes and updates |
| 4 | `referral_nudges`, `enqueue_portal_nudges(p_now)`: one end-of-day digest per reviewer per day |
| 5 | `portal_issue_code` returns the ISO's logo and color |
| 6 | Branded `renderEmail` (default pinned by snapshots); invite and sign-in code emails branded |
| 7 | `_shared/portalNotifyEmail.ts` builders for every outbox kind |
| 8 | `_shared/portalNotify.ts` drain and the `portal_notify` edge function |
| 9 | `portal-notify` pg_cron job every 2 minutes; `cron_health` and the admin card row |
| 10 | Portal referral page shows published updates |
| 11 | Deal Detail: Share update with partner and the shared list |
| 12 | String audit over every partner email |
| 13 | Verification, push, PR |
