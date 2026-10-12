# Partner Portal Phase 2A (PRD completion, part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six PRD gaps left after Phase 1C. (1) Personal details on referrals that were Declined or Withdrawn 90 or more days ago are erased by a daily job, and an administrator can erase a departed partner's portal identity. (2) Partners edit their own name, phone and weekly-email preference on a portal Profile page. (3) Managers and administrators reassign a referral from the review sheet, warned first when the new owner cannot see the partner. (4) Partners download their referrals as a CSV. (5) A referral declined as a duplicate can be reinstated once the referral that held credit is declined or withdrawn, and its owner is emailed when that happens. (6) Reps see an advisory "Looks like a chain" line at triage for partner referrals whose name matches the chain list Path discovery uses.

**Architecture:** Every rule lives in SQL. The purge is one SECURITY DEFINER function run daily by a pure-SQL pg_cron job (the 20260820000007 pattern). Partner reads change only to include purged rows (whose personal columns are already null); duplicate matching and the email claim exclude them. New portal actions (`get_profile`, `update_profile`, `export_referrals`) follow the 1B shape: `portal_api` resolves the session, calls a service-role SQL function pinned to `(org, partner, portal user)`, and builds the response from an allowlist. Internal features (reassign helpers, reinstate, the ICP flag, partner profile change log, portal data erase) are authenticated RPCs or RLS-read columns with visibility re-checked inside. A new outbox kind `internal_reinstate_available` rides the 1C outbox and drain unchanged.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pg_cron), Deno edge functions, React 18 + TypeScript, TanStack Query 5, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` section 9 (deferred list) plus the PRD requirements named in the Phase 2A design brief: FR-PORT-19, 48, 55, 58, 75, 80, 91 to 95, NFR-PORT-09, decision D13. The brief's scope list and locked rules are binding and referenced as "brief scope N" below.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261016000001_...` to `20261016000007_...`, applied in filename order. The latest existing migration is `20261014000006`. Never hand-apply SQL to staging or production; CI and `promote-production` apply them.
- New enum values (`portal_audit_action` `purge` and `profile_update`) are added alone in the first migration file: a value added with `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.
- Partner-side functions (`portal_*`) are `security definer set search_path = public, extensions`, then `revoke execute ... from public, anon, authenticated;` and `grant execute ... to service_role;`. Private helpers (`_portal_*`, `_referral_*`) and trigger functions are also revoked from `service_role`. Supabase grants `authenticated` directly, so it is revoked by name.
- Internal RPCs (`portal_purge_user`, `reinstate_referral`, `can_reinstate`, `list_referral_assignees`, `can_user_see_partner`) keep the Phase 0 posture: `security definer set search_path = public` (`public, extensions` where pgcrypto or portal helpers are involved), re-check rights inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`.
- New tables (`partner_profile_changes`) enable RLS and `revoke all ... from anon, authenticated` first (default privileges from 20260813000002 grant `authenticated` full DML on new tables), then `grant select ... to authenticated` plus one SELECT policy.
- pgcrypto calls are always schema-qualified (`extensions.digest`, `extensions.gen_random_bytes`). This plan adds none.
- DB tests: plain psql scripts `supabase/tests/NNN_name.sql` numbered `051` to `056`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Service-role-only functions are called as `postgres` (switch back with `perform set_config('role', 'postgres', true);`). Assert function privileges with `has_function_privilege` and table privileges with `has_table_privilege`, never by calling something the role cannot execute: local Postgres 17.6 segfaults on a live function-level permission denied.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. One file: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/NNN_name.sql`.
- `_shared` modules are dependency-free TS with no Deno globals at module scope, import each other with the `.ts` extension, and their tests import without the extension. Every new `_shared` source file is added to the `include` list in `apps/app/tsconfig.app.json` so `tsc -b` typechecks it.
- Partner-visible text comes only from partner labels (`_shared/portalLabels.ts`), the ISO name, the partner's own referral fields, the partner's own profile, the assigned rep's name and business email, and `referral_updates.body` (spec 6). `icp_flags`, decline reasons, internal statuses and stages never reach a partner response, a partner email, or the CSV. The string audit enforces it.
- Partner-facing copy names the ISO, never "navigatr", and never uses the lowercase words submitted, accepted, working, won, lost, declined or withdrawn. Rep-facing copy is short. Partner pages keep 44px tap targets (`min-h-11` or `size="lg"`). A partner page shows a retry state only when it has no data (1B Q4).
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. Tests live next to source. No `act()` warnings. Node 25 ships a broken global `localStorage`, so every portal test file that renders `PortalRoot` installs its own in-memory `Storage` shim in `beforeEach` and restores the original in `afterEach` (the 1A pattern). The shim is defined per file, never shared.
- Before any push: `pnpm --filter app build` must pass (`tsc -b && vite build`; `tsc --noEmit` alone is not enough).
- Deno: `deno check --no-lock --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts`.
- Existing behavior is preserved: Phase 0, 1A, 1B and 1C tests (DB `001` to `050`, all vitest files) must still pass. The only intended behavior change to 1B reads is that purged referrals are now INCLUDED.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

**Create**
- `supabase/migrations/20261016000001_portal_audit_actions_2a.sql`: `portal_audit_action` gains `purge`, `profile_update`.
- `supabase/migrations/20261016000002_referral_purge.sql`: `organizations.declined_retention_days`, `_referral_status_since`, `purge_declined_referrals`, `portal_purge_user`, the `purge-declined-referrals` cron job.
- `supabase/migrations/20261016000003_portal_reads_include_purged.sql`: 1B reads include purged rows, `portal_get_referral` gains `details_removed`, duplicate matching and the email claim exclude purged rows, `portal_export_referrals`.
- `supabase/migrations/20261016000004_referral_icp_flags.sql`: `referrals.icp_flags`, `_referral_chain_brand`, the `referrals_set_icp_flags` trigger, backfill of the open queue.
- `supabase/migrations/20261016000005_referral_reinstate.sql`: outbox kind `internal_reinstate_available`, `_referral_reinstatable`, `can_reinstate`, `reinstate_referral`, the `referrals_enqueue_reinstate_email` trigger.
- `supabase/migrations/20261016000006_referral_reassign_helpers.sql`: `list_referral_assignees`, `can_user_see_partner`.
- `supabase/migrations/20261016000007_portal_profile.sql`: `partner_profile_changes`, `portal_get_profile`, `portal_update_profile`.
- `supabase/tests/051_referral_purge.sql`, `052_portal_reads_include_purged.sql`, `053_referral_icp_flags.sql`, `054_referral_reinstate.sql`, `055_referral_reassign_helpers.sql`, `056_portal_profile.sql`.
- `supabase/functions/_shared/portalProfile.ts` (+ `.test.ts`): profile caps, types, `validateProfile`.
- `apps/app/src/features/portal/lib/portalCsv.ts` (+ `.test.ts`): CSV cells, builder, file name, download.
- `apps/app/src/features/portal/pages/PortalProfilePage.tsx` (+ `.test.tsx`).
- `apps/app/src/features/partners/hooks/useReassignReferral.ts` (+ `.test.tsx`): `useReferralAssignees`, `useAssigneeSeesPartner`, `useReassignReferral`.
- `apps/app/src/features/partners/hooks/useReinstateReferral.ts` (+ `.test.tsx`): `useReinstatableReferrals`, `useReinstateReferral`.
- `apps/app/src/features/partners/hooks/usePartnerProfileChanges.ts` (+ `.test.tsx`).
- `apps/app/src/features/partners/components/ReinstatableReferralsCard.tsx` (+ `.test.tsx`).
- `apps/app/src/features/partners/components/PartnerProfileChanges.tsx` (+ `.test.tsx`).
- `apps/app/src/features/partners/components/PortalEraseData.tsx` (+ `.test.tsx`).

**Modify**
- `supabase/functions/_shared/portalReferralApi.ts` (+ test): actions `export_referrals`, `get_profile`, `update_profile`; detail `detailsRemoved`.
- `supabase/functions/_shared/portalNotifyEmail.ts` (+ test): kind `internal_reinstate_available`.
- `supabase/functions/portal_api/index.ts`: route comment only.
- `apps/app/tsconfig.app.json`: include `portalProfile.ts`.
- `apps/app/src/features/portal/lib/portalApi.ts` (+ test): `exportReferrals`, `getProfile`, `updateProfile`.
- `apps/app/src/features/portal/pages/PortalDashboardPage.tsx` (+ test): Download CSV.
- `apps/app/src/features/portal/pages/PortalReferralPage.tsx` (+ test): removed-details notice.
- `apps/app/src/features/portal/pages/PortalRoot.tsx`: `profile` route.
- `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`: Profile link in the top bar.
- `apps/app/src/features/portal/portalStringAudit.test.tsx`: ICP flags, purged rows, export and CSV, profile.
- `apps/app/src/features/partners/lib/referrals.ts` (+ test): `canReassignReferrals`, `icpFlagLabels`, two error tokens.
- `apps/app/src/features/partners/hooks/useReferralQueue.ts` (+ test): `icpFlags`.
- `apps/app/src/features/partners/components/ReviewReferralSheet.tsx` (+ test): ICP advisory line, Reassign.
- `apps/app/src/features/partners/hooks/usePortalAccess.ts` (+ test): `usePurgePortalUser`.
- `apps/app/src/features/partners/pages/PartnerDetailPage.tsx` (+ test): mount the reinstate card, the profile change lines and the erase control.

**Deviations from spec and brief, recorded here:**

1. **Purged referrals' published updates are deleted, not blanked.** `referral_updates.body` has `check (body = btrim(body) and char_length(body) between 1 and 1000)` (20261014000001), so `''` is rejected, and a kept empty row would render as a blank card on Deal Detail and the portal. The row holds nothing else worth keeping. Unsent outbox rows for the referral are dropped (`last_error = 'purged'`), and `updateBody` is nulled in every outbox payload for the referral, sent or not, so no copy of the text survives.
2. **`decline_note` is cleared too.** It is free text a rep typed and can carry contact details. The decline reason, status history (including notes), dates, partner, partner company snapshot, company name, industry and urgency are kept (brief scope 1).
3. **The purge clock** is when the referral entered its current status: the latest `referral_status_history` row with `to_status = status` (falling back to `updated_at`). `updated_at` alone moves on any write.
4. **`declined_retention_days` is bounded 30 to 3650** so a typo cannot purge everything tomorrow. Not exposed in the UI (brief scope 1).
5. **A purged referral's linked deal is untouched.** Deals are the ISO's own CRM records; the PRD purge covers referral data.
6. **Profile edits are logged in a new `partner_profile_changes` table, not `partner_activities`.** `partner_activities.logged_by` is `not null references profiles(id)` and its sync trigger moves `partners.last_touch_at` on every insert; `partner_notes.created_by` is also a required profile. A partner is never a profile, and a self-edit is not a rep touch. Partner Detail shows the latest three changes on the Contact card.
7. **The reassign picker uses a new RPC `list_referral_assignees`.** No existing hook lists the users the caller can see: `profiles` RLS is org-wide (20260529000001), so `useOrgMemberNames` returns everyone and `reassign_referral` would refuse most picks.
8. **ICP flags are set by a BEFORE INSERT trigger** on inbound referrals with no deal, which covers `log_referral` and `portal_submit_referral` without re-creating either. Deal-linked rows (attribute, refer) are not triaged and get none. A flag is `chain:<Brand>`, one brand, longest matching active pattern. There is no SQL chain matcher to reuse (Path inlines the `exclusion_seed` substring match in `prospects_nearby`), so `_referral_chain_brand` repeats that exact match. The open queue is backfilled.
9. **Reinstate clears `duplicate_of_referral_id`** (the history note keeps the earlier reference) so accepting no longer demands an override reason; `duplicate_of_deal_id` stays. It sends no "new referral" email: the 1C dedupe key from the original submission would swallow it, and the person reinstating is the one triaging.
10. **"Reinstate available" emails go one per (recipient, partner)** and link to that partner's page, where the Reinstate card lives. Partner Detail lists deals only, so declined referrals had no row to hang a button on (brief scope 5).
11. **CSV export uses a dedicated `export_referrals` action** (the list has no per-referral value), capped at 5000 rows, built in the browser. The value column is "Closed Won value" (dollars, two decimals), present only when the ISO shows values. The button shows only when the list has rows.
12. **`portal_get_referral` gains `details_removed`** (drop and recreate, return type changes). The partner sees "Contact details for this referral were removed for privacy." Industry and urgency still show.
13. **The weekly email preference is stored now** in `portal_users.notification_prefs.digest`, default on. The digest itself ships in Phase 2B.
14. **Profile phone rule:** blank clears it; otherwise at most 40 characters with at least 7 digits. Profile saves are limited to 20 per hour per partner.
15. **Erase portal data** (`portal_purge_user`) also nulls IP addresses and user agents on that partner's sessions, tokens and audit rows and drops their unsent emails. Administrators get an "Erase portal data" control on the partner's Contact card.
16. **`portal_referral_updates` keeps its purged filter** (045 asserts it); its rows are deleted on purge anyway.

---

### Task 1: New audit actions

**Files:**
- Create: `supabase/migrations/20261016000001_portal_audit_actions_2a.sql`

**Interfaces:**
- Produces (SQL): `portal_audit_action` values `purge` (a referral's personal details or a portal user's identity were erased) and `profile_update` (a partner saved their profile). Used by Tasks 2 and 7.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261016000001_portal_audit_actions_2a.sql`:

```sql
-- 20261016000001_portal_audit_actions_2a.sql
--
-- Partner Portal Phase 2A. New audit actions, alone in this file: a value added
-- with ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it,
-- and 20261016000002 and 20261016000007 use both.
--   purge           personal details erased (90-day referral purge, FR-PORT-91..95)
--                   or a portal identity erased on offboarding (NFR-PORT-09)
--   profile_update  a partner saved their profile (FR-PORT-19, rate limited)

alter type portal_audit_action add value if not exists 'purge';
alter type portal_audit_action add value if not exists 'profile_update';
```

- [ ] **Step 2: Apply it**

Run: `supabase db reset`
Expected: finishes with `Finished supabase db reset`, no errors.

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "select string_agg(e, ',') from unnest(enum_range(null::portal_audit_action)::text[]) e where e in ('purge','profile_update')"`
Expected: `purge,profile_update`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261016000001_portal_audit_actions_2a.sql
git commit -m "$(cat <<'EOF'
feat(portal): audit actions for purge and profile updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Daily personal-data purge and erasing a portal identity (SQL)

**Files:**
- Create: `supabase/migrations/20261016000002_referral_purge.sql`
- Test: `supabase/tests/051_referral_purge.sql`

**Interfaces:**
- Consumes (SQL): tables `referrals`, `referral_status_history`, `referral_updates`, `portal_email_outbox`, `portal_users`, `portal_sessions`, `portal_tokens`, `portal_audit_log`; `public.user_org_id()`, `public.caller_is_admin()`, `public._portal_audit(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid) returns void`.
- Produces (SQL):
  - Column `organizations.declined_retention_days integer not null default 90`, check 30 to 3650.
  - `public._referral_status_since(p_referral uuid, p_status referral_status) returns timestamptz`: private.
  - `public.purge_declined_referrals(p_now timestamptz) returns integer`: service role only (and the cron job, which runs as `postgres`). Purges every unpurged referral that has been `declined` or `withdrawn` for at least its org's `declined_retention_days` as of `p_now`; returns how many. Sets `contact_name, contact_email, contact_phone, address, consent_text_snapshot, decline_note` to null, `notes` to `''`, `purged_at = p_now`; deletes the referral's `referral_updates`; drops its unsettled outbox rows (`dropped_at = p_now`, `last_error = 'purged'`); nulls `updateBody` in all its outbox payloads; writes one `portal_audit_log` row (`action 'purge'`, `referral_id`) per referral.
  - `public.portal_purge_user(p_partner_id uuid) returns void`: authenticated, administrators only. Errors: `not_authorized`, `portal_user_not_found`. Sets the portal user to `revoked`, `email = 'purged+<portal user id>@invalid'`, `terms_ip = null`, `notification_prefs = '{}'`; revokes every session and token and nulls their `ip` (and session `user_agent`); nulls `ip` on that user's audit rows; drops their unsettled outbox rows; audits `purge` with the acting user. Referral rows are kept.
  - pg_cron job `purge-declined-referrals`, schedule `15 6 * * *`, command `select public.purge_declined_referrals(now())`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/051_referral_purge.sql`:

```sql
-- Tests for 20261016000002_referral_purge (Partner Portal Phase 2A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/051_referral_purge.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture, org A portal-purge (retention 90 days): boss administrator, rita rep.
-- Partner P1 (owner rita) with active portal user PU1 (terms IP, one session,
-- weekly email off). Referrals, dated by when they reached their status:
--   R1 P1 portal declined   100 days ago  purged (has an update, emails, a sent email)
--   R2 P1 portal declined    10 days ago  kept (inside the window)
--   R3 P1 rep    withdrawn   95 days ago  purged
--   R4 P1 portal submitted  200 days ago  kept (not closed)
--   R5 P1 portal declined   130 days ago, already purged yesterday: untouched
-- Org B portal-purge-b (retention 30 days): bob administrator, partner PB with
-- portal user PUB, RB declined 40 days ago: purged.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001051', 'Purge Org',   'portal-purge',   'portal-purge-a1',   true),
  ('00000000-0000-0000-0000-000000001151', 'Purge Org B', 'portal-purge-b', 'portal-purge-b-a1', true);
update organizations set declined_retention_days = 30 where id = '00000000-0000-0000-0000-000000001151';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0510000-0000-0000-0000-000000000001', 'boss@purge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0510000-0000-0000-0000-000000000002', 'rita@purge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0510000-0000-0000-0000-000000000003', 'bob@purgeb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0510000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'admin', 'administrator',      'Boss',     'boss@purge.example', 'prgboss'::ltree,      null),
  ('a0510000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001051', 'rep',   'sales_professional', 'Rita Rep', 'rita@purge.example', 'prgboss.rita'::ltree, 'a0510000-0000-0000-0000-000000000001'),
  ('a0510000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001151', 'admin', 'administrator',      'Bob',      'bob@purgeb.example', 'prgbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a051a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a0510000-0000-0000-0000-000000000002', 'a0510000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@purge.example'),
  ('a051a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001151', 'a0510000-0000-0000-0000-000000000003', 'a0510000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@purgeb.example');

insert into portal_users (id, org_id, partner_id, email, status, terms_ip, notification_prefs) values
  ('a051b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'jane@purge.example', 'active', '198.51.100.7', '{"digest": false}'),
  ('a051b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001151', 'a051a000-0000-0000-0000-000000000002', 'bea@purgeb.example', 'active', '198.51.100.8', '{}');

insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at, ip, user_agent) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 't051-session', now() + interval '1 day', '198.51.100.7', 'Phone browser');
insert into portal_audit_log (org_id, portal_user_id, action, ip) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 'sign_in', '198.51.100.7');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
  contact_phone, address, industry, urgency, notes, consent_text_snapshot, decline_reason,
  decline_note, partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id,
  submitted_at, purged_at
) values
  ('a051f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Old Bakery',  'Ann', 'ann@old.example',    '5550510001', '1 Old St', 'restaurant', 'this_week', 'Call after 5', 'I have permission to share this business''s contact details.', 'outside_icp',       'Owner is Ann, mobile only', 'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '110 days', null),
  ('a051f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Recent Cafe', 'Rae', 'rae@recent.example', '5550510002', '2 New St', 'restaurant', null,        '',             'I have permission to share this business''s contact details.', 'outside_footprint', null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '12 days',  null),
  ('a051f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'withdrawn', 'Gone Co',     'Gus', null,                 '5550510003', null,       null,         null,        'rep note',     null,                                                          null,                null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', null,                                   now() - interval '100 days', null),
  ('a051f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Waiting Co',  'Wes', null,                 '5550510004', null,       null,         null,        '',             null,                                                          null,                null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '200 days', null),
  ('a051f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Done Co',     null,  null,                 null,         null,       null,         null,        '',             null,                                                          'existing_customer', null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '130 days', now() - interval '1 day'),
  ('a051f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001151', 'a051a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'declined',  'B Co',        'Bo',  null,                 '5550510006', null,       null,         null,        '',             null,                                                          'outside_icp',       null,                        'Bea & Co',  'a0510000-0000-0000-0000-000000000003', 'a051b000-0000-0000-0000-000000000002', now() - interval '50 days',  null);

-- Each referral was inserted straight into its status, so it has one history
-- row stamped now. Date it to when it reached that status.
update referral_status_history h
   set created_at = v.closed_at
  from (values
    ('a051f000-0000-0000-0000-000000000001'::uuid, now() - interval '100 days'),
    ('a051f000-0000-0000-0000-000000000002'::uuid, now() - interval '10 days'),
    ('a051f000-0000-0000-0000-000000000003'::uuid, now() - interval '95 days'),
    ('a051f000-0000-0000-0000-000000000004'::uuid, now() - interval '200 days'),
    ('a051f000-0000-0000-0000-000000000005'::uuid, now() - interval '120 days'),
    ('a051f000-0000-0000-0000-000000000006'::uuid, now() - interval '40 days')
  ) as v(id, closed_at)
 where h.referral_id = v.id;

-- Published updates (each queues a partner_update email) and one email already sent.
insert into referral_updates (org_id, referral_id, author_user_id, body) values
  ('00000000-0000-0000-0000-000000001051', 'a051f000-0000-0000-0000-000000000001', 'a0510000-0000-0000-0000-000000000002', 'Spoke to Ann, her cell is 5550519999'),
  ('00000000-0000-0000-0000-000000001051', 'a051f000-0000-0000-0000-000000000002', 'a0510000-0000-0000-0000-000000000002', 'Will revisit in spring');
insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key, created_at, sent_at, attempts) values
  ('00000000-0000-0000-0000-000000001051', 'partner_update', 'a051f000-0000-0000-0000-000000000001', 'a051b000-0000-0000-0000-000000000001',
   jsonb_build_object('companyName', 'Old Bakery', 'updateBody', 'Earlier update with Ann''s cell 5550518888'),
   't051:sent', now() - interval '60 days', now() - interval '60 days', 1);

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

-- 1. Privileges (before any role switch).
do $$ begin
  if has_function_privilege('authenticated', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE') then
    raise exception 'purge_declined_referrals must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute purge_declined_referrals';
  end if;
  if not has_function_privilege('authenticated', 'public.portal_purge_user(uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute portal_purge_user';
  end if;
  if has_function_privilege('anon', 'public.portal_purge_user(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute portal_purge_user';
  end if;
  if has_function_privilege('authenticated', 'public._referral_status_since(uuid, referral_status)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_status_since(uuid, referral_status)', 'EXECUTE') then
    raise exception '_referral_status_since must be private';
  end if;
end $$;

-- 2. The daily job is scheduled and calls the function directly.
do $$ declare j record; begin
  select schedule, command into j from cron.job where jobname = 'purge-declined-referrals';
  if j.schedule is distinct from '15 6 * * *' then
    raise exception 'purge-declined-referrals should run daily at 06:15, got %', j.schedule;
  end if;
  if position('public.purge_declined_referrals(now())' in j.command) = 0 then
    raise exception 'purge-declined-referrals runs the wrong command: %', j.command;
  end if;
end $$;

-- 3. Run the purge: R1, R3 and RB go; everything else stays.
do $$ declare n int; r record; begin
  n := public.purge_declined_referrals(now());
  if n <> 3 then raise exception 'expected 3 purged (R1, R3, RB), got %', n; end if;

  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000001';
  if r.purged_at is null or r.contact_name is not null or r.contact_email is not null
     or r.contact_phone is not null or r.address is not null or r.notes <> ''
     or r.consent_text_snapshot is not null or r.decline_note is not null then
    raise exception 'R1 personal details should be cleared: %', row_to_json(r);
  end if;
  if r.company_name <> 'Old Bakery' or r.industry <> 'restaurant' or r.urgency <> 'this_week'
     or r.decline_reason <> 'outside_icp' or r.partner_company_snapshot <> 'Jane & Co'
     or r.status <> 'declined' or r.partner_id <> 'a051a000-0000-0000-0000-000000000001' then
    raise exception 'R1 kept fields changed: %', row_to_json(r);
  end if;

  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000003';
  if r.purged_at is null or r.contact_name is not null or r.notes <> '' then
    raise exception 'R3 (withdrawn 95 days ago) should be purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000006';
  if r.purged_at is null or r.contact_name is not null then
    raise exception 'RB (org retention 30 days) should be purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000002';
  if r.purged_at is not null or r.contact_name is distinct from 'Rae' then
    raise exception 'R2 is inside the window and must be kept: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000004';
  if r.purged_at is not null or r.contact_name is distinct from 'Wes' then
    raise exception 'a submitted referral is never purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000005';
  if r.purged_at > now() - interval '12 hours' then
    raise exception 'an already purged referral keeps its purge date: %', r.purged_at;
  end if;

  select count(*) into n from referral_status_history where referral_id = 'a051f000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'status history must be kept as is, got % rows', n; end if;
end $$;

-- 4. Updates, emails and the audit trail.
do $$ declare n int; begin
  select count(*) into n from referral_updates where referral_id = 'a051f000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'R1 published updates should be deleted, % left', n; end if;
  select count(*) into n from referral_updates where referral_id = 'a051f000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'R2 update must stay'; end if;

  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 0 then raise exception 'no R1 email may stay pending, % left', n; end if;
  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001' and last_error = 'purged';
  if n <> 3 then raise exception 'R1 received, new-referral and update emails should be dropped as purged, got %', n; end if;
  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001' and payload->>'updateBody' is not null;
  if n <> 0 then raise exception 'no R1 email payload may keep update text, % do', n; end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't051:sent' and sent_at is not null and dropped_at is null) then
    raise exception 'a sent email stays sent';
  end if;

  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000002'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 3 then raise exception 'R2 emails must stay pending, got %', n; end if;

  select count(*) into n from portal_audit_log
   where action = 'purge' and referral_id in ('a051f000-0000-0000-0000-000000000001',
                                             'a051f000-0000-0000-0000-000000000003',
                                             'a051f000-0000-0000-0000-000000000006');
  if n <> 3 then raise exception 'one purge audit row per purged referral, got %', n; end if;
end $$;

-- 5. A second run finds nothing.
do $$ begin
  if public.purge_declined_referrals(now()) <> 0 then raise exception 'second run must purge nothing'; end if;
end $$;

-- 6. Erase a partner's portal identity (role switches from here on).
do $$ begin
  perform _t_act('a0510000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_act('a0510000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-000000000001')$q$, 'portal_user_not_found');
  perform _t_act('a0510000-0000-0000-0000-000000000001');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-0000000000ff')$q$, 'portal_user_not_found');
  perform public.portal_purge_user('a051a000-0000-0000-0000-000000000001');
end $$;

do $$ declare u record; n int; begin
  perform set_config('role', 'postgres', true);
  select * into u from portal_users where id = 'a051b000-0000-0000-0000-000000000001';
  if u.status <> 'revoked'
     or u.email <> ('purged+' || u.id::text || '@invalid')
     or u.terms_ip is not null
     or u.notification_prefs <> '{}'::jsonb then
    raise exception 'portal user should be erased: %', row_to_json(u);
  end if;
  select count(*) into n from portal_sessions
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001'
     and (revoked_at is null or ip is not null or user_agent is not null);
  if n <> 0 then raise exception 'sessions must be revoked with no IP or user agent'; end if;
  select count(*) into n from portal_audit_log
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001' and ip is not null;
  if n <> 0 then raise exception 'audit rows must not keep the partner IP'; end if;
  select count(*) into n from portal_audit_log
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001' and action = 'purge'
     and actor_user_id = 'a0510000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'the erase is audited with the acting admin'; end if;
  select count(*) into n from portal_email_outbox
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 0 then raise exception 'an erased partner gets no more email, % pending', n; end if;
  select count(*) into n from referrals where submitted_by_portal_user_id = 'a051b000-0000-0000-0000-000000000001';
  if n <> 4 then raise exception 'referrals are kept, got %', n; end if;
  if not exists (select 1 from portal_users where id = 'a051b000-0000-0000-0000-000000000002'
                  and status = 'active' and email = 'bea@purgeb.example') then
    raise exception 'another org''s portal user must be untouched';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/051_referral_purge.sql`
Expected: FAIL with `column "declined_retention_days" of relation "organizations" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000002_referral_purge.sql`:

```sql
-- 20261016000002_referral_purge.sql
--
-- Partner Portal Phase 2A (FR-PORT-91..95, D13, NFR-PORT-09).
--
-- 1. A daily job erases the personal details on referrals that have been
--    Declined or Withdrawn for the org's retention period (default 90 days).
--    The referral itself stays, with its status history, partner, partner
--    company snapshot, decline reason, dates, company name, industry and
--    urgency, so partner lists, counts and conversion rates stay correct.
--    Published updates are deleted (their body cannot be blank, and the text is
--    the personal part); unsent emails are dropped and no stored payload keeps
--    update text.
-- 2. portal_purge_user erases a departed partner's portal identity: access is
--    revoked, the email is replaced, IPs and user agents are nulled. Their
--    referrals stay.
--
-- Pure-SQL cron job (same pattern as purge-activity-location-coords in
-- 20260820000007): pg_cron calls the function directly, no edge function.

alter table organizations
  add column if not exists declined_retention_days integer not null default 90
    constraint organizations_declined_retention_days_check
    check (declined_retention_days between 30 and 3650);

create index if not exists referrals_purge_candidates_idx
  on referrals (org_id)
  where purged_at is null and status in ('declined','withdrawn');

-- When did the referral reach this status? The latest history row for it.
create or replace function public._referral_status_since(p_referral uuid, p_status referral_status)
returns timestamptz language sql stable security definer set search_path = public, extensions as $$
  select max(h.created_at)
    from referral_status_history h
   where h.referral_id = p_referral and h.to_status = p_status
$$;

create or replace function public.purge_declined_referrals(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_ids uuid[];
begin
  -- One run at a time.
  perform pg_advisory_xact_lock(hashtextextended('purge_declined_referrals', 0));

  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_ids
    from referrals r
    join organizations o on o.id = r.org_id
   where r.purged_at is null
     and r.status in ('declined','withdrawn')
     and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
         <= v_now - make_interval(days => o.declined_retention_days);

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Status is not in the SET list, so no history row and no status email.
  update referrals r
     set contact_name          = null,
         contact_email         = null,
         contact_phone         = null,
         address               = null,
         notes                 = '',
         consent_text_snapshot = null,
         decline_note          = null,
         purged_at             = v_now
   where r.id = any(v_ids);

  delete from referral_updates u where u.referral_id = any(v_ids);

  update portal_email_outbox o
     set dropped_at = v_now, last_error = 'purged'
   where o.referral_id = any(v_ids)
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{updateBody}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'updateBody'
     and o.payload->>'updateBody' is not null;

  insert into portal_audit_log (org_id, action, referral_id)
  select r.org_id, 'purge'::portal_audit_action, r.id
    from referrals r
   where r.id = any(v_ids);

  return cardinality(v_ids);
end $$;

-- Offboarding (NFR-PORT-09): administrators erase a partner's portal identity.
-- email is NOT NULL and unique per org, so it becomes a per-user placeholder.
-- A later invite (portal_create_invite) sets it back from the partner record.
create or replace function public.portal_purge_user(p_partner_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.user_org_id();
  v_user portal_users;
begin
  if v_org is null or not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_user from portal_users u
   where u.partner_id = p_partner_id and u.org_id = v_org
     for update;
  if v_user.id is null then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;

  update portal_users
     set status             = 'revoked',
         email              = 'purged+' || v_user.id::text || '@invalid',
         terms_ip           = null,
         notification_prefs = '{}'::jsonb,
         updated_at         = now()
   where id = v_user.id;

  update portal_sessions s
     set revoked_at = coalesce(s.revoked_at, now()), ip = null, user_agent = null
   where s.portal_user_id = v_user.id;
  update portal_tokens t
     set revoked_at = coalesce(t.revoked_at, now()), ip = null
   where t.portal_user_id = v_user.id;
  update portal_audit_log a
     set ip = null
   where a.portal_user_id = v_user.id and a.ip is not null;
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'purged'
   where o.portal_user_id = v_user.id
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  perform public._portal_audit(v_org, v_user.id, 'purge', null, auth.uid());
end $$;

revoke execute on function public._referral_status_since(uuid, referral_status) from public, anon, authenticated, service_role;
revoke execute on function public.purge_declined_referrals(timestamptz)         from public, anon, authenticated;
grant  execute on function public.purge_declined_referrals(timestamptz)         to service_role;
revoke execute on function public.portal_purge_user(uuid)                       from public, anon;
grant  execute on function public.portal_purge_user(uuid)                       to authenticated;

-- Daily at 06:15 UTC. Idempotent: re-applying replaces the job.
create extension if not exists pg_cron;

select cron.unschedule('purge-declined-referrals')
where exists (select 1 from cron.job where jobname = 'purge-declined-referrals');

select cron.schedule(
  'purge-declined-referrals',
  '15 6 * * *',
  $$ select public.purge_declined_referrals(now()) $$
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/051_referral_purge.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000002_referral_purge.sql supabase/tests/051_referral_purge.sql
git commit -m "$(cat <<'EOF'
feat(referrals): erase personal details 90 days after a referral closes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Partner reads include purged referrals; CSV export rows (SQL)

**Files:**
- Create: `supabase/migrations/20261016000003_portal_reads_include_purged.sql`
- Test: `supabase/tests/052_portal_reads_include_purged.sql`

**Interfaces:**
- Consumes (SQL, 1B and 1C): `public._portal_assert_scope(p_org uuid, p_partner uuid, p_portal_user uuid) returns void`, `public._portal_audit_referral(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_referral uuid, p_ip text) returns void`, `public._portal_referral_ref(p_id uuid) returns text`, `public.deal_phone_key(text)`, `public.deal_dedupe_key(text, text)`, `public.deal_name_key(text)`, `public.profile_can_see_owner(uuid, uuid)`.
- Produces (SQL), all service role only:
  - `public.portal_list_referrals(p_org uuid, p_partner uuid, p_since timestamptz)`: same signature and columns as 1B; purged rows now included.
  - `public.portal_get_referral(p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text) returns table (id uuid, ref text, company_name text, contact_name text, contact_email text, contact_phone text, address text, industry text, urgency text, notes text, status referral_status, source referral_source, submitted_at timestamptz, rep_name text, rep_email text, can_withdraw boolean, details_removed boolean)`: purged rows included; for them contact fields, address and notes are null and `details_removed` is true.
  - `public.portal_referral_history(...)` and `public.portal_dashboard_stats(...)`: same signatures; purged rows included.
  - `public._portal_find_duplicates(...)`: same signature; purged referrals never match.
  - `public.claim_portal_emails(p_limit integer)`: same signature; a partner email whose referral is purged is dropped as `recipient_inactive`.
  - `public.portal_export_referrals(p_org uuid, p_partner uuid, p_since timestamptz) returns table (ref text, company_name text, status referral_status, submitted_at timestamptz, last_activity_at timestamptz, won_value_cents bigint, value_visible boolean)`: the partner's inbound referrals (purged included), newest submission first, at most 5000; `won_value_cents` only for `won` rows while `organizations.partner_value_visibility` is on; nothing when the portal is off or the org is disabled.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/052_portal_reads_include_purged.sql`:

```sql
-- Tests for 20261016000003_portal_reads_include_purged (Partner Portal Phase 2A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/052_portal_reads_include_purged.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-keep (closed-won value shown): rita rep owns P1 and P2.
--   K1 P1 portal declined  Purged Co     120 days ago, purged 5 days ago
--   K2 P1 rep    won       Won Co         40 days ago, deal DW worth $5,000
--   K3 P1 portal submitted Fresh Bakery    2 days ago
--   K4 P1 portal accepted  Ghost Co        3 days ago, purged (artificially, to
--                                          prove duplicate matching skips it)
--   K5 P2 portal submitted Other Partner Co
-- Org B portal-keep-b: PB with KB.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001052', 'Keep Org',   'portal-keep',   'portal-keep-a1',   true, true),
  ('00000000-0000-0000-0000-000000001152', 'Keep Org B', 'portal-keep-b', 'portal-keep-b-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0520000-0000-0000-0000-000000000001', 'boss@keep.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0520000-0000-0000-0000-000000000002', 'rita@keep.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0520000-0000-0000-0000-000000000003', 'bob@keepb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0520000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'admin', 'administrator',      'Boss',     'boss@keep.example', 'kpboss'::ltree,      null),
  ('a0520000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'rep',   'sales_professional', 'Rita Rep', 'rita@keep.example', 'kpboss.rita'::ltree, 'a0520000-0000-0000-0000-000000000001'),
  ('a0520000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'admin', 'administrator',      'Bob',      'bob@keepb.example', 'kpbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a052a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'a0520000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@keep.example'),
  ('a052a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'a0520000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@keep.example'),
  ('a052a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'a0520000-0000-0000-0000-000000000003', 'a0520000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@keepb.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a052b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'jane@keep.example', 'active'),
  ('a052b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'kim@keep.example',  'active'),
  ('a052b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000003', 'bea@keepb.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a052d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'Won Co', '9 Gold St', 'Wes', 'wes@won.example', '5550520002', 500000, 'won', 'partner_referral');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
  address, industry, urgency, notes, decline_reason, deal_id, assigned_user_id,
  submitted_by_portal_user_id, submitted_at, purged_at
) values
  ('a052f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Purged Co',        null,  null,         null,       'retail', 'no_rush', '', 'outside_icp', null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '120 days', now() - interval '5 days'),
  ('a052f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'won',       'Won Co',           'Wes', '5550520002', '9 Gold St', null,     null,      '', null,          'a052d000-0000-0000-0000-000000000001', 'a0520000-0000-0000-0000-000000000002', null,                                   now() - interval '40 days',  null),
  ('a052f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fresh Bakery',     'Ann', '5550520003', '5 Oak St',  null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '2 days',   null),
  ('a052f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'accepted',  'Ghost Co',         'Gil', '5550520004', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '3 days',   now()),
  ('a052f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Other Partner Co', 'Oz',  '5550520005', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000002', now() - interval '1 day',    null),
  ('a052f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000003', 'inbound', 'portal_signed_in', 'submitted', 'Tenant B Co',      'Bo',  '5550520006', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000003', 'a052b000-0000-0000-0000-000000000003', now() - interval '1 day',    null);

update referral_status_history h
   set created_at = r.submitted_at
  from referrals r
 where r.id = h.referral_id
   and r.org_id in ('00000000-0000-0000-0000-000000001052', '00000000-0000-0000-0000-000000001152');

-- 1. Privileges.
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE') then
    raise exception 'portal_export_referrals must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute portal_export_referrals';
  end if;
  if has_function_privilege('authenticated', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'the recreated portal_get_referral must stay service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'service_role should execute portal_get_referral';
  end if;
end $$;

-- 2. The list, history and tiles include the purged referral.
do $$ declare n int; s record; begin
  select count(*) into n from public.portal_list_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 4 then raise exception 'P1 list should have 4 rows (purged included), got %', n; end if;
  if not exists (select 1 from public.portal_list_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null) l
                  where l.id = 'a052f000-0000-0000-0000-000000000001') then
    raise exception 'the purged referral must stay in the list';
  end if;
  select count(*) into n from public.portal_referral_history('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'the purged referral keeps its history, got % rows', n; end if;

  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if s.submitted <> 4 or s.active <> 2 or s.closed_won <> 1 or s.not_moving_forward <> 1
     or s.won_value_cents <> 500000 or not s.value_visible then
    raise exception 'tiles should count the purged referral: %', row_to_json(s);
  end if;
end $$;

-- 3. Detail of a purged referral: no personal details, and it says so.
do $$ declare d record; begin
  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000001', null);
  if d.id is null then raise exception 'the purged referral detail must be returned'; end if;
  if not d.details_removed or d.contact_name is not null or d.contact_phone is not null
     or d.address is not null or d.notes is not null or d.can_withdraw then
    raise exception 'purged detail wrong: %', row_to_json(d);
  end if;
  if d.company_name <> 'Purged Co' or d.industry <> 'retail' or d.urgency <> 'no_rush' then
    raise exception 'purged detail keeps company, industry and urgency: %', row_to_json(d);
  end if;

  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000003', null);
  if d.details_removed or d.contact_name is distinct from 'Ann' or not d.can_withdraw then
    raise exception 'a live referral detail is unchanged: %', row_to_json(d);
  end if;

  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000002', 'a052f000-0000-0000-0000-000000000001', null);
  if d.id is not null then raise exception 'another partner must not get the purged referral'; end if;
end $$;

-- 4. Duplicate matching skips purged referrals.
do $$ declare v uuid; begin
  select f.dup_referral_id into v
    from public._portal_find_duplicates('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'Ghost Co', '5550520004', null, null) f;
  if v is not null then raise exception 'a purged referral must never take credit, got %', v; end if;
  select f.dup_referral_id into v
    from public._portal_find_duplicates('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'Fresh Bakery', '5550520003', null, null) f;
  if v is distinct from 'a052f000-0000-0000-0000-000000000003' then raise exception 'live matching must still work, got %', v; end if;
end $$;

-- 5. Export rows: newest first, value only on won rows while the ISO shows values.
do $$ declare names text[]; vals bigint[]; vis boolean[]; anyvis boolean; n int; begin
  select array_agg(e.company_name order by e.ord), array_agg(coalesce(e.won_value_cents, -1) order by e.ord), array_agg(e.value_visible order by e.ord)
    into names, vals, vis
    from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null)
         with ordinality as e(ref, company_name, status, submitted_at, last_activity_at, won_value_cents, value_visible, ord);
  if names <> array['Fresh Bakery', 'Ghost Co', 'Won Co', 'Purged Co'] then raise exception 'export order wrong: %', names; end if;
  if vals <> array[-1, -1, 500000, -1]::bigint[] then raise exception 'export value wrong: %', vals; end if;
  if vis <> array[true, true, true, true] then raise exception 'value_visible should be on: %', vis; end if;

  update organizations set partner_value_visibility = false where id = '00000000-0000-0000-0000-000000001052';
  select array_agg(coalesce(e.won_value_cents, -1)), bool_or(e.value_visible) into vals, anyvis
    from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null) e;
  if vals <> array[-1, -1, -1, -1]::bigint[] or anyvis then raise exception 'no value when the ISO hides it: %', vals; end if;

  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', now() - interval '30 days');
  if n <> 2 then raise exception 'the window applies to the export, got %', n; end if;
  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 0 then raise exception 'another org scope must export nothing'; end if;
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001052';
  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 0 then raise exception 'a disabled portal exports nothing'; end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001052';
end $$;

-- 6. The email claim drops a partner email about a purged referral.
do $$ declare o record; begin
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
    ('00000000-0000-0000-0000-000000001052', 'partner_accepted', 'a052f000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', '{}', 't52:purged'),
    ('00000000-0000-0000-0000-000000001052', 'partner_accepted', 'a052f000-0000-0000-0000-000000000003', 'a052b000-0000-0000-0000-000000000001', '{}', 't52:live');
  perform * from public.claim_portal_emails(50);
  select * into o from portal_email_outbox where dedupe_key = 't52:purged';
  if o.dropped_at is null or o.last_error is distinct from 'recipient_inactive' then
    raise exception 'a purged referral email must be dropped: %', row_to_json(o);
  end if;
  select * into o from portal_email_outbox where dedupe_key = 't52:live';
  if o.dropped_at is not null or o.attempts <> 1 then
    raise exception 'a live referral email must be claimed: %', row_to_json(o);
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/052_portal_reads_include_purged.sql`
Expected: FAIL with `function public.portal_export_referrals(uuid, uuid, timestamp with time zone) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000003_portal_reads_include_purged.sql`:

```sql
-- 20261016000003_portal_reads_include_purged.sql
--
-- Partner Portal Phase 2A (FR-PORT-92): a purged referral still counts in the
-- partner's list, tiles and conversion rate, so partner reads now INCLUDE
-- purged rows. Their personal columns are already null; the detail also says
-- the details were removed. Only duplicate matching and the email claim
-- exclude purged rows. Withdraw keeps its filter (a purged referral is closed),
-- and so does portal_referral_updates (its rows are deleted on purge).
--
-- Also the CSV export rows (FR-PORT-75). Service role only, pinned to the
-- session's (org, partner), like every 1B read.

-- 1. List: purged rows included -------------------------------------------------
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
     and r.direction = 'inbound'
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

-- 2. Detail: purged rows included, personal fields never returned for them ------
drop function if exists public.portal_get_referral(uuid, uuid, uuid, uuid, text);

create function public.portal_get_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, address text, industry text, urgency text, notes text,
  status referral_status, source referral_source, submitted_at timestamptz,
  rep_name text, rep_email text, can_withdraw boolean, details_removed boolean
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
     and r.direction = 'inbound';
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
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_name end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_email end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_phone end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.address end,
           case when r.source = 'portal_signed_in' then r.industry end,
           case when r.source = 'portal_signed_in' then r.urgency end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.notes end,
           r.status,
           r.source,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.status = 'submitted' and r.source = 'portal_signed_in' and r.purged_at is null),
           (r.purged_at is not null)
      from referrals r
      left join profiles pr on pr.id = r.assigned_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

-- 3. History and tiles: purged rows included -------------------------------------
create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
   order by h.created_at, h.to_status, h.id
$$;

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
     and r.direction = 'inbound'
     and (p_since is null or r.submitted_at >= p_since)
$$;

-- 4. Duplicate matching: a purged referral never takes credit -------------------
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
        and r.purged_at is null
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

-- 5. Email claim: a partner email about a purged referral is never sent --------
-- Identical to 20261014000002 except the one added predicate rf.purged_at is null.
create or replace function public.claim_portal_emails(p_limit integer)
returns table (
  id uuid, org_id uuid, kind text, referral_id uuid, payload jsonb, recipient text, attempts integer
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
begin
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'stale'
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.created_at < now() - interval '48 hours'
        for update skip locked);

  update portal_email_outbox o
     set failed_at = now()
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.attempts >= 5
        and (s.last_attempt_at is null or s.last_attempt_at < now() - interval '10 minutes')
        for update skip locked);

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
                then coalesce(pu.status = 'active' and org.portal_enabled and not org.is_disabled
                              and rf.id is not null and rf.org_id = o.org_id
                              and rf.partner_id = pu.partner_id
                              and rf.purged_at is null, false)
                else coalesce(pr.deactivated_at is null and pr.org_id = o.org_id
                              and nullif(btrim(pr.email), '') is not null and not org.is_disabled, false)
           end as live
      from portal_email_outbox o
      join picked k on k.id = o.id
      join organizations org on org.id = o.org_id
      left join portal_users pu on pu.id = o.portal_user_id and pu.org_id = o.org_id
      left join profiles pr on pr.id = o.recipient_user_id
      left join referrals rf on rf.id = o.referral_id
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

-- 6. CSV export rows (FR-PORT-75) ----------------------------------------------
-- The INTERNAL status comes back; portal_api maps it to a partner label and
-- never passes it through. Value only on won rows while the ISO shows values.
create or replace function public.portal_export_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  ref text, company_name text, status referral_status, submitted_at timestamptz,
  last_activity_at timestamptz, won_value_cents bigint, value_visible boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at)),
         case when r.status = 'won' and o.partner_value_visibility then d.value_cents::bigint end,
         o.partner_value_visibility
    from referrals r
    join organizations o on o.id = r.org_id
    left join deals d on d.id = r.deal_id
    left join lateral (
      select max(x.created_at) as last_at
        from referral_status_history x
       where x.referral_id = r.id
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.submitted_at >= p_since)
   order by r.submitted_at desc, r.id
   limit 5000
$$;

-- Privileges (create or replace keeps grants; the dropped function needs them again).
revoke execute on function public.portal_list_referrals(uuid, uuid, timestamptz)              from public, anon, authenticated;
revoke execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)           from public, anon, authenticated;
revoke execute on function public.portal_referral_history(uuid, uuid, uuid)                   from public, anon, authenticated;
revoke execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)             from public, anon, authenticated;
revoke execute on function public.claim_portal_emails(integer)                                from public, anon, authenticated;
revoke execute on function public.portal_export_referrals(uuid, uuid, timestamptz)            from public, anon, authenticated;
revoke execute on function public._portal_find_duplicates(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant  execute on function public.portal_list_referrals(uuid, uuid, timestamptz)              to service_role;
grant  execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)           to service_role;
grant  execute on function public.portal_referral_history(uuid, uuid, uuid)                   to service_role;
grant  execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)             to service_role;
grant  execute on function public.claim_portal_emails(integer)                                to service_role;
grant  execute on function public.portal_export_referrals(uuid, uuid, timestamptz)            to service_role;
```

- [ ] **Step 4: Run the new test and the 1B and 1C tests it touches**

Run: `supabase db reset && for f in 042_portal_referral_submit 043_portal_referral_read 045_referral_updates 046_portal_email_outbox 052_portal_reads_include_purged; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$f.sql || echo "FAILED $f"; done`
Expected: no output (no `FAILED` line).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000003_portal_reads_include_purged.sql supabase/tests/052_portal_reads_include_purged.sql
git commit -m "$(cat <<'EOF'
feat(portal): purged referrals stay in partner lists; export rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ICP advisory flags on new referrals (SQL)

**Files:**
- Create: `supabase/migrations/20261016000004_referral_icp_flags.sql`
- Test: `supabase/tests/053_referral_icp_flags.sql`

**Interfaces:**
- Consumes (SQL): table `exclusion_seed (name_pattern text, brand text, active boolean)` (20260531000001, extended by 20260601000003, 20260925000002, 20260928000001), the same case-insensitive substring match Path uses in `prospects_nearby`.
- Produces (SQL):
  - Column `referrals.icp_flags text[] not null default '{}'`. Readable by the app through the existing `referrals` table SELECT grant and `referrals_select` policy. Never selected by any `portal_*` function.
  - `public._referral_chain_brand(p_company text) returns text`: private. The brand of the longest active `exclusion_seed` pattern found in the name, or null.
  - Trigger `referrals_set_icp_flags` (BEFORE INSERT on `referrals`, function `public.referrals_set_icp_flags()`): for an inbound referral with no deal, `icp_flags = array['chain:' || brand]` when a brand matches, else `'{}'`.
  - Flag format: `chain:<Brand>` (the only flag kind in 2A).

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/053_referral_icp_flags.sql`:

```sql
-- Tests for 20261016000004_referral_icp_flags (Partner Portal Phase 2A, FR-PORT-58).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/053_referral_icp_flags.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-icp): boss administrator, rita rep owns partner P1, which
-- has an active portal user. Deal D1 'Subway Plaza' owned by rita.
-- exclusion_seed (from migrations): 'subway' is active; 'true value' is inactive.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001053', 'ICP Org', 'portal-icp', 'portal-icp-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0530000-0000-0000-0000-000000000001', 'boss@icp.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0530000-0000-0000-0000-000000000002', 'rita@icp.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0530000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'admin', 'administrator',      'Boss',     'boss@icp.example', 'icpboss'::ltree,      null),
  ('a0530000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001053', 'rep',   'sales_professional', 'Rita Rep', 'rita@icp.example', 'icpboss.rita'::ltree, 'a0530000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a053a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a0530000-0000-0000-0000-000000000002', 'a0530000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@icp.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a053b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a053a000-0000-0000-0000-000000000001', 'jane@icp.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a053d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a0530000-0000-0000-0000-000000000002', 'Subway Plaza', '7 Main St', 'Sam', 'sam@plaza.example', '5550530009', 100000, 'new', 'partner_referral');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. Privileges, and no partner function can return the flags (before any role switch).
do $$ declare f record; begin
  if has_function_privilege('authenticated', 'public._referral_chain_brand(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_chain_brand(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public._referral_chain_brand(text)', 'EXECUTE') then
    raise exception '_referral_chain_brand must be private';
  end if;
  for f in
    select p.oid::regprocedure::text as sig, pg_get_function_result(p.oid) as res
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%'
  loop
    if f.res ilike '%icp%' or f.res in ('referrals', 'SETOF referrals') then
      raise exception 'portal function % could return ICP flags: %', f.sig, f.res;
    end if;
  end loop;
end $$;

-- 2. A rep-logged referral is flagged at insert (role switches from here on).
do $$ declare v uuid; f text[]; begin
  perform _t_act('a0530000-0000-0000-0000-000000000002');

  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Subway #1234');
  select icp_flags into f from referrals where id = v;
  if f is distinct from array['chain:Subway'] then raise exception 'Subway should be flagged, got %', f; end if;

  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Corner Cafe');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'an independent business gets no flag, got %', f; end if;

  -- An inactive pattern never flags (True Value is a co-op of independents).
  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Adam True Value Hardware');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'inactive patterns must not flag, got %', f; end if;

  -- A deal-linked referral is never triaged, so it gets no flag.
  v := public.attribute_deal_to_partner('a053a000-0000-0000-0000-000000000001', 'a053d000-0000-0000-0000-000000000001');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'a deal-linked referral gets no flag, got %', f; end if;
end $$;

-- 3. A portal submission is flagged too, whatever the case.
do $$ declare v uuid; f text[]; begin
  perform set_config('role', 'postgres', true);
  select s.id into v
    from public.portal_submit_referral(
      '00000000-0000-0000-0000-000000001053', 'a053a000-0000-0000-0000-000000000001', 'a053b000-0000-0000-0000-000000000001',
      'SUBWAY Downtown', 'Ann', null, '5550530001', null, null, null, '', true, 0, null) s;
  select icp_flags into f from referrals where id = v;
  if f is distinct from array['chain:Subway'] then raise exception 'portal submissions are flagged too, got %', f; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/053_referral_icp_flags.sql`
Expected: FAIL with `function public._referral_chain_brand(text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000004_referral_icp_flags.sql`:

```sql
-- 20261016000004_referral_icp_flags.sql
--
-- Partner Portal Phase 2A (FR-PORT-58): partner referrals skip ICP filtering,
-- but the checks still run as ADVICE for the rep at triage. Without Google
-- place types the realistic check is the chain list Path discovery already
-- uses: exclusion_seed, matched the same way prospects_nearby matches it
-- (active rows, case-insensitive substring of the business name).
--
-- Stored on the referral at insert time by a trigger, so log_referral and
-- portal_submit_referral both get it without being re-created. Only inbound
-- referrals with no deal (the ones that are triaged) are checked.
--
-- Never shown to partners: no portal_* function selects icp_flags, and the
-- string audit (apps/app/src/features/portal/portalStringAudit.test.tsx)
-- asserts no portal response or CSV carries it.

alter table referrals add column if not exists icp_flags text[] not null default '{}';

-- The brand of the longest active pattern found in the name, or null.
create or replace function public._referral_chain_brand(p_company text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select s.brand
    from exclusion_seed s
   where s.active
     and btrim(coalesce(p_company, '')) <> ''
     and position(lower(s.name_pattern) in lower(p_company)) > 0
   order by length(s.name_pattern) desc, s.brand
   limit 1
$$;

create or replace function public.referrals_set_icp_flags()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_brand text;
begin
  if new.direction = 'inbound' and new.deal_id is null then
    v_brand := public._referral_chain_brand(new.company_name);
    new.icp_flags := case when v_brand is null then '{}'::text[] else array['chain:' || v_brand] end;
  end if;
  return new;
end $$;

create trigger referrals_set_icp_flags
  before insert on referrals
  for each row execute function public.referrals_set_icp_flags();

-- The open queue gets its flags now; closed referrals are never triaged again.
update referrals r
   set icp_flags = array['chain:' || public._referral_chain_brand(r.company_name)]
 where r.status = 'submitted' and r.direction = 'inbound' and r.deal_id is null
   and public._referral_chain_brand(r.company_name) is not null;

revoke execute on function public._referral_chain_brand(text)    from public, anon, authenticated, service_role;
revoke execute on function public.referrals_set_icp_flags()      from public, anon, authenticated, service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/053_referral_icp_flags.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000004_referral_icp_flags.sql supabase/tests/053_referral_icp_flags.sql
git commit -m "$(cat <<'EOF'
feat(referrals): advisory chain flag on new partner referrals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Reinstating a declined duplicate (SQL)

**Files:**
- Create: `supabase/migrations/20261016000005_referral_reinstate.sql`
- Test: `supabase/tests/054_referral_reinstate.sql`

**Interfaces:**
- Consumes (SQL, Phase 0, 1B, 1C): `public._referral_for_update(p_referral_id uuid) returns referrals`, `public._referral_set_note(p_note text) returns void`, `public.can_triage_referral(p_assignee uuid) returns boolean`, `public.user_org_id()`, `public._portal_referral_ref(p_id uuid) returns text`, `public._portal_review_recipients(p_org uuid, p_assignee uuid) returns table (user_id uuid)`, table `portal_email_outbox` and its constraint `portal_email_outbox_kind_check`.
- Produces (SQL):
  - Outbox kind `internal_reinstate_available` (internal: `recipient_user_id` set, `portal_user_id` null, `referral_id` null). Payload exactly `{ appUrlPath: '/partners/<partner id>', companyNames: string[] (at most 20, oldest first), count: integer }`. Dedupe key `internal_reinstate_available:<holder id>:<recipient id>:<partner id>`.
  - `public._referral_reinstatable(p_referral uuid) returns boolean`: private. True when the referral is inbound, `declined` with reason `duplicate`, unpurged, has no deal, and the referral named by its `duplicate_of_referral_id` is now `declined` or `withdrawn`.
  - `public.can_reinstate(r referrals) returns boolean`: authenticated. PostgREST computed field (like `can_triage`): same org, `can_triage_referral(r.assigned_user_id)`, and reinstatable.
  - `public.reinstate_referral(p_referral_id uuid) returns void`: authenticated. Errors: `referral_not_found`, `not_authorized`, `referral_not_reinstatable`. Sets `status = 'submitted'`; clears `decline_reason`, `decline_note`, `triaged_by`, `triaged_at`, `nudged_at`, `duplicate_of_referral_id`; history note `Reinstated: earlier referral <REF> is closed`.
  - Trigger `referrals_enqueue_reinstate_email` (AFTER UPDATE OF status on `referrals`, function `public.referrals_enqueue_reinstate_email()`): when a referral moves into `declined` or `withdrawn` from any other status, queue one `internal_reinstate_available` email per (review recipient, partner) of its now-reinstatable duplicates. Never blocks the status change.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/054_referral_reinstate.sql`:

```sql
-- Tests for 20261016000005_referral_reinstate (Partner Portal Phase 2A, FR-PORT-48/80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/054_referral_reinstate.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-reinstate): boss administrator; rita rep and rob rep in
-- separate branches. Partners P1 (Jane) and P2 (Kim), both owned by rita.
--   H1 P1 submitted Holder Co          (holds credit)
--   H2 P1 submitted Second Holder Co   (holds credit)
--   D1 P1 declined duplicate of H1     Dup One       reinstatable once H1 closes
--   D2 P2 declined duplicate of H1     Dup Two       reinstatable once H1 closes
--   D3 P1 declined outside_icp, points at H1        never reinstatable
--   D4 P1 declined duplicate of H1, purged          never reinstatable
--   D5 P1 declined duplicate of H2     Late Dup Co   reinstatable once H2 closes

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001054', 'Reinstate Org', 'portal-reinstate', 'portal-reinstate-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0540000-0000-0000-0000-000000000001', 'boss@rin.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0540000-0000-0000-0000-000000000002', 'rita@rin.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0540000-0000-0000-0000-000000000003', 'rob@rin.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0540000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'admin', 'administrator',      'Boss',     'boss@rin.example', 'rinboss'::ltree,      null),
  ('a0540000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'rep',   'sales_professional', 'Rita Rep', 'rita@rin.example', 'rinboss.rita'::ltree, 'a0540000-0000-0000-0000-000000000001'),
  ('a0540000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001054', 'rep',   'sales_professional', 'Rob Rep',  'rob@rin.example',  'rinboss.rob'::ltree,  'a0540000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a054a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'a0540000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@rin.example'),
  ('a054a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'a0540000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@rin.example');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone, assigned_user_id, submitted_at) values
  ('a054f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Holder Co',        'Hal', '5550540001', 'a0540000-0000-0000-0000-000000000002', now() - interval '5 days'),
  ('a054f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Second Holder Co', 'Hil', '5550540002', 'a0540000-0000-0000-0000-000000000002', now() - interval '5 days');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
  decline_reason, decline_note, duplicate_of_referral_id, triaged_by, triaged_at, assigned_user_id,
  submitted_at, purged_at
) values
  ('a054f000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Dup One',       'Ann', '5550540011', 'duplicate',   'same as Holder Co', 'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'declined', 'Dup Two',       'Bea', '5550540012', 'duplicate',   null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Not Dup Co',    'Cy',  '5550540013', 'outside_icp', null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Purged Dup Co', null,  null,         'duplicate',   null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', now()),
  ('a054f000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Late Dup Co',   'Lu',  '5550540015', 'duplicate',   null,                'a054f000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null);

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

-- can_reinstate as the given user, through RLS (an invisible row reads as false).
create or replace function _t_can(p_user uuid, p_referral uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform _t_act(p_user);
  select public.can_reinstate(r) into v from referrals r where r.id = p_referral;
  return coalesce(v, false);
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('authenticated', 'public.reinstate_referral(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_reinstate(referrals)', 'EXECUTE') then
    raise exception 'authenticated should execute reinstate_referral and can_reinstate';
  end if;
  if has_function_privilege('anon', 'public.reinstate_referral(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.can_reinstate(referrals)', 'EXECUTE') then
    raise exception 'anon must not execute the reinstate functions';
  end if;
  if has_function_privilege('authenticated', 'public._referral_reinstatable(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_reinstatable(uuid)', 'EXECUTE') then
    raise exception '_referral_reinstatable must be private';
  end if;
end $$;

-- 2. Nothing is reinstatable while the holder is still live (role switches from here on).
do $$ begin
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000011') then
    raise exception 'D1 is not reinstatable while H1 holds credit';
  end if;
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'referral_not_reinstatable');
end $$;

-- 3. Declining the holder emails the duplicates' owner, once per partner.
do $$ declare n int; p jsonb; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.decline_referral('a054f000-0000-0000-0000-000000000001', 'outside_footprint', null);

  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox where kind = 'internal_reinstate_available';
  if n <> 2 then raise exception 'expected 2 reinstate emails (one per partner), got %', n; end if;
  select payload into p from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and recipient_user_id = 'a0540000-0000-0000-0000-000000000002'
     and portal_user_id is null and referral_id is null
     and payload->>'appUrlPath' = '/partners/a054a000-0000-0000-0000-000000000001';
  if p is distinct from jsonb_build_object(
       'appUrlPath', '/partners/a054a000-0000-0000-0000-000000000001',
       'companyNames', jsonb_build_array('Dup One'),
       'count', 1) then
    raise exception 'P1 reinstate payload wrong: %', p;
  end if;
  select payload into p from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and payload->>'appUrlPath' = '/partners/a054a000-0000-0000-0000-000000000002';
  if p->'companyNames' is distinct from jsonb_build_array('Dup Two') then
    raise exception 'P2 reinstate payload wrong: %', p;
  end if;
end $$;

-- 4. Who can reinstate what.
do $$ begin
  if not _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000011') then raise exception 'rita can reinstate D1'; end if;
  if not _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000012') then raise exception 'rita can reinstate D2'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000013') then raise exception 'D3 was not declined as a duplicate'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000014') then raise exception 'D4 is purged'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000003', 'a054f000-0000-0000-0000-000000000011') then raise exception 'rob cannot triage D1'; end if;
  if not _t_can('a0540000-0000-0000-0000-000000000001', 'a054f000-0000-0000-0000-000000000011') then raise exception 'an admin can reinstate D1'; end if;
  perform _t_act('a0540000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'not_authorized');
end $$;

-- 5. Reinstate D1: back in the queue, triage reset, attribution flag cleared.
do $$ declare r record; h record; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.reinstate_referral('a054f000-0000-0000-0000-000000000011');
  select * into r from referrals where id = 'a054f000-0000-0000-0000-000000000011';
  if r.status <> 'submitted' or r.decline_reason is not null or r.decline_note is not null
     or r.triaged_by is not null or r.triaged_at is not null or r.nudged_at is not null
     or r.duplicate_of_referral_id is not null then
    raise exception 'reinstated referral wrong: %', row_to_json(r);
  end if;
  select * into h from referral_status_history
   where referral_id = 'a054f000-0000-0000-0000-000000000011' and to_status = 'submitted';
  if h.from_status is distinct from 'declined' or h.actor_type <> 'user'
     or h.actor_id is distinct from 'a0540000-0000-0000-0000-000000000002'
     or h.note not like 'Reinstated: earlier referral REF-% is closed' then
    raise exception 'reinstate history wrong: %', row_to_json(h);
  end if;

  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'referral_not_reinstatable');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000013')$q$, 'referral_not_reinstatable');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000014')$q$, 'referral_not_reinstatable');

  -- Accepting it no longer needs an override reason.
  if (public.accept_referral('a054f000-0000-0000-0000-000000000011') ->> 'result') <> 'accepted' then
    raise exception 'a reinstated referral accepts like a fresh one';
  end if;
end $$;

-- 6. Withdrawing a holder also offers its duplicates.
do $$ declare n int; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.withdraw_referral('a054f000-0000-0000-0000-000000000002', null);
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and dedupe_key = 'internal_reinstate_available:a054f000-0000-0000-0000-000000000002:a0540000-0000-0000-0000-000000000002:a054a000-0000-0000-0000-000000000001'
     and payload->'companyNames' = jsonb_build_array('Late Dup Co');
  if n <> 1 then raise exception 'withdrawing H2 should offer D5, got % rows', n; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/054_referral_reinstate.sql`
Expected: FAIL with `function public.reinstate_referral(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000005_referral_reinstate.sql`:

```sql
-- 20261016000005_referral_reinstate.sql
--
-- Partner Portal Phase 2A (FR-PORT-48, FR-PORT-80): a referral declined as a
-- duplicate can come back once the referral that held credit is itself
-- declined or withdrawn. The rep reinstates it (status back to submitted,
-- triage reset, history note), and the duplicate's reviewer is emailed when it
-- becomes possible, through the 1C outbox (new internal kind).

-- 1. New outbox kind -------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available'));

-- 2. Eligibility -------------------------------------------------------------------
create or replace function public._referral_reinstatable(p_referral uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1
      from referrals r
      join referrals h on h.id = r.duplicate_of_referral_id
     where r.id = p_referral
       and r.direction = 'inbound'
       and r.status = 'declined'
       and r.decline_reason = 'duplicate'
       and r.purged_at is null
       and r.deal_id is null
       and h.status in ('declined','withdrawn')
  )
$$;

-- PostgREST computed field: .eq("can_reinstate", true) on referrals.
create or replace function public.can_reinstate(r referrals)
returns boolean language sql stable security definer set search_path = public as $$
  select r.org_id = public.user_org_id()
     and public.can_triage_referral(r.assigned_user_id)
     and public._referral_reinstatable(r.id)
$$;

-- 3. Reinstate -------------------------------------------------------------------
create or replace function public.reinstate_referral(p_referral_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r     referrals := public._referral_for_update(p_referral_id);
  v_ref text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_reinstatable(r.id) then
    raise exception 'referral_not_reinstatable' using errcode = '22023';
  end if;
  v_ref := public._portal_referral_ref(r.duplicate_of_referral_id);
  perform public._referral_set_note('Reinstated: earlier referral ' || v_ref || ' is closed');
  -- The earlier referral no longer holds credit, so this one is no longer a
  -- probable duplicate of it; accepting it needs no override reason.
  update referrals
     set status                   = 'submitted',
         decline_reason           = null,
         decline_note             = null,
         triaged_by               = null,
         triaged_at               = null,
         nudged_at                = null,
         duplicate_of_referral_id = null
   where id = r.id;
  perform public._referral_set_note('');
end $$;

-- 4. "You can reinstate" email ---------------------------------------------------
create or replace function public.referrals_enqueue_reinstate_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    if new.status in ('declined','withdrawn') and old.status not in ('declined','withdrawn') then
      insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
      select d.org_id,
             'internal_reinstate_available',
             rcp.user_id,
             jsonb_build_object(
               'appUrlPath', '/partners/' || d.partner_id::text,
               'companyNames', to_jsonb((array_agg(d.company_name order by d.submitted_at, d.id))[1:20]),
               'count', count(*)::integer),
             'internal_reinstate_available:' || new.id::text || ':' || rcp.user_id::text || ':' || d.partner_id::text
        from referrals d
        cross join lateral public._portal_review_recipients(d.org_id, d.assigned_user_id) rcp
       where d.duplicate_of_referral_id = new.id
         and public._referral_reinstatable(d.id)
       group by d.org_id, d.partner_id, rcp.user_id
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    -- Never block the status change; the warning names the trigger only.
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referrals_enqueue_reinstate_email
  after update of status on referrals
  for each row execute function public.referrals_enqueue_reinstate_email();

-- Privileges -----------------------------------------------------------------------
revoke execute on function public._referral_reinstatable(uuid)            from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_reinstate_email()     from public, anon, authenticated, service_role;
revoke execute on function public.can_reinstate(referrals)                from public, anon;
revoke execute on function public.reinstate_referral(uuid)                from public, anon;
grant  execute on function public.can_reinstate(referrals)                to authenticated;
grant  execute on function public.reinstate_referral(uuid)                to authenticated;
```

- [ ] **Step 4: Run the new test and the 1C email tests**

Run: `supabase db reset && for f in 046_portal_email_outbox 047_portal_email_enqueue 054_referral_reinstate; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$f.sql || echo "FAILED $f"; done`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000005_referral_reinstate.sql supabase/tests/054_referral_reinstate.sql
git commit -m "$(cat <<'EOF'
feat(referrals): reinstate a declined duplicate once the earlier referral closes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Reassign helpers: who can take it, and can they see the partner (SQL)

**Files:**
- Create: `supabase/migrations/20261016000006_referral_reassign_helpers.sql`
- Test: `supabase/tests/055_referral_reassign_helpers.sql`

**Interfaces:**
- Consumes (SQL): `public.user_org_id()`, `public.user_role() returns user_role`, `public.caller_is_admin()`, `public.user_can_see_owner(uuid)`, `public.can_see_partner(uuid)`, `public.profile_can_see_owner(p_viewer uuid, p_owner uuid)`. Unchanged: `public.reassign_referral(p_referral_id uuid, p_user_id uuid) returns boolean` (Phase 0) is what the UI calls to reassign; it already updates `assigned_user_id` only, which is what routes later emails.
- Produces (SQL), both authenticated:
  - `public.list_referral_assignees() returns table (user_id uuid, full_name text, email text)`: for a manager or administrator (the same gate as `reassign_referral`), the active profiles in their org they can see in the hierarchy, themselves included, ordered by name. Empty for anyone else.
  - `public.can_user_see_partner(p_user_id uuid, p_partner_id uuid) returns boolean`: whether that user can see that partner. Only for a caller who can see both. Errors: `not_authorized` (no org, or the user is in another org or outside the caller's view), `partner_not_visible`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/055_referral_reassign_helpers.sql`:

```sql
-- Tests for 20261016000006_referral_reassign_helpers (Partner Portal Phase 2A, FR-PORT-55).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/055_referral_reassign_helpers.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org ref-assign): boss administrator; Mia Mgr (manager) under boss;
-- Rita Rep under Mia; Rob Rep under boss in another branch; Dee Rep under Mia,
-- deactivated. Partner P1 owned by Rita, P2 owned by Rob. Org ref-assign-b: Bob.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001055', 'Assign Org',   'ref-assign',   'ref-assign-a1'),
  ('00000000-0000-0000-0000-000000001155', 'Assign Org B', 'ref-assign-b', 'ref-assign-b-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0550000-0000-0000-0000-000000000001', 'boss@asg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000002', 'mia@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000003', 'rita@asg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000004', 'rob@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000005', 'dee@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000006', 'bob@asgb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0550000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001055', 'admin',   'administrator',      'Boss',     'boss@asg.example', 'asgboss'::ltree,          null,                                   null),
  ('a0550000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001055', 'manager', 'sales_manager',      'Mia Mgr',  'mia@asg.example',  'asgboss.mia'::ltree,      'a0550000-0000-0000-0000-000000000001', null),
  ('a0550000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Rita Rep', 'rita@asg.example', 'asgboss.mia.rita'::ltree, 'a0550000-0000-0000-0000-000000000002', null),
  ('a0550000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Rob Rep',  'rob@asg.example',  'asgboss.rob'::ltree,      'a0550000-0000-0000-0000-000000000001', null),
  ('a0550000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Dee Rep',  'dee@asg.example',  'asgboss.mia.dee'::ltree,  'a0550000-0000-0000-0000-000000000002', now()),
  ('a0550000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001155', 'admin',   'administrator',      'Bob',      'bob@asgb.example', 'asgbob'::ltree,           null,                                   null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a055a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001055', 'a0550000-0000-0000-0000-000000000003', 'a0550000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa'),
  ('a055a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001055', 'a0550000-0000-0000-0000-000000000004', 'a0550000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa');

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

create or replace function _t_assignees(p_user uuid) returns text[] language plpgsql as $$
declare v text[];
begin
  perform _t_act(p_user);
  select coalesce(array_agg(a.full_name order by a.ord), '{}') into v
    from public.list_referral_assignees() with ordinality as a(user_id, full_name, email, ord);
  return v;
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('authenticated', 'public.list_referral_assignees()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_user_see_partner(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute the reassign helpers';
  end if;
  if has_function_privilege('anon', 'public.list_referral_assignees()', 'EXECUTE')
     or has_function_privilege('anon', 'public.can_user_see_partner(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the reassign helpers';
  end if;
end $$;

-- 2. Who can take a referral (role switches from here on).
do $$ declare v text[]; begin
  v := _t_assignees('a0550000-0000-0000-0000-000000000002');
  if v <> array['Mia Mgr', 'Rita Rep'] then raise exception 'a manager sees self and team, active only, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000001');
  if v <> array['Boss', 'Mia Mgr', 'Rita Rep', 'Rob Rep'] then raise exception 'an admin sees every active member, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000003');
  if v <> '{}'::text[] then raise exception 'a rep gets nobody, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000006');
  if v <> array['Bob'] then raise exception 'another org sees only its own, got %', v; end if;
end $$;

-- 3. Can the new owner see the partner?
do $$ begin
  perform _t_act('a0550000-0000-0000-0000-000000000001');
  if public.can_user_see_partner('a0550000-0000-0000-0000-000000000004', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Rob cannot see Rita''s partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000002', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Mia can see her rep''s partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Rita can see her own partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000001', 'a055a000-0000-0000-0000-000000000002') then
    raise exception 'an admin can see every partner';
  end if;

  perform _t_act('a0550000-0000-0000-0000-000000000002');
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Mia asks about Rita and P1';
  end if;
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000002')$q$, 'partner_not_visible');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000004', 'a055a000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000006', 'a055a000-0000-0000-0000-000000000001')$q$, 'not_authorized');

  perform _t_act('a0550000-0000-0000-0000-000000000006');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001')$q$, 'partner_not_visible');
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/055_referral_reassign_helpers.sql`
Expected: FAIL with `function public.list_referral_assignees() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000006_referral_reassign_helpers.sql`:

```sql
-- 20261016000006_referral_reassign_helpers.sql
--
-- Partner Portal Phase 2A (FR-PORT-55): managers and administrators reassign a
-- referral from the review sheet. reassign_referral (Phase 0) does the change
-- and already only touches assigned_user_id, which is what routes every later
-- email. These two read-only helpers feed the picker and the warning shown
-- BEFORE the rep confirms.
--
-- profiles RLS is org-wide (20260529000001), so the app cannot list "people I
-- can see in the hierarchy" without help. user_can_see_owner does not check
-- the org (an administrator passes for anyone), so both helpers pin the org.

create or replace function public.list_referral_assignees()
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from profiles p
   where p.org_id = public.user_org_id()
     and p.deactivated_at is null
     and (public.user_role() in ('manager','admin') or public.caller_is_admin())
     and public.user_can_see_owner(p.id)
   order by lower(coalesce(p.full_name, p.email)), p.id
$$;

create or replace function public.can_user_see_partner(p_user_id uuid, p_partner_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := public.user_org_id();
  v_owner uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and org_id = v_org)
     or not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select owner_id into v_owner from partners where id = p_partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

revoke execute on function public.list_referral_assignees()              from public, anon;
revoke execute on function public.can_user_see_partner(uuid, uuid)       from public, anon;
grant  execute on function public.list_referral_assignees()              to authenticated;
grant  execute on function public.can_user_see_partner(uuid, uuid)       to authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/055_referral_reassign_helpers.sql`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000006_referral_reassign_helpers.sql supabase/tests/055_referral_reassign_helpers.sql
git commit -m "$(cat <<'EOF'
feat(referrals): reassign picker and partner-visibility check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Partner profile (SQL)

**Files:**
- Create: `supabase/migrations/20261016000007_portal_profile.sql`
- Test: `supabase/tests/056_portal_profile.sql`

**Interfaces:**
- Consumes (SQL, 1B): `public._portal_assert_scope(p_org uuid, p_partner uuid, p_portal_user uuid) returns void` (raises `not_authorized`), `public._portal_audit_referral(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_referral uuid, p_ip text) returns void`, `public.can_see_partner(uuid)`, `public.user_org_id()`.
- Produces (SQL):
  - Table `public.partner_profile_changes (id uuid pk, org_id uuid not null, partner_id uuid not null, portal_user_id uuid null, field text not null check (field in ('name','phone')), old_value text, new_value text, changed_at timestamptz not null default now())`. RLS: `authenticated` SELECT only, policy `partner_profile_changes_select` (org match and `can_see_partner(partner_id)`). No client writes.
  - `public.portal_get_profile(p_org uuid, p_partner uuid, p_portal_user uuid) returns table (name text, phone text, email text, weekly_digest boolean)`: service role only. `weekly_digest` is `notification_prefs.digest` when it is a JSON boolean, otherwise true.
  - `public.portal_update_profile(p_org uuid, p_partner uuid, p_portal_user uuid, p_name text, p_phone text, p_weekly_digest boolean, p_ip text) returns table (name text, phone text, email text, weekly_digest boolean)`: service role only. Name trimmed, 1 to 120 characters (`invalid_input:name`); phone trimmed, blank becomes null, otherwise at most 40 characters with at least 7 digits (`invalid_input:phone`); at most 20 saves per portal user per hour (`rate_limited`). Writes `partners.name` and `partners.phone` only when they change, one `partner_profile_changes` row per changed field, merges `{"digest": <bool>}` into `notification_prefs` (null means true), audits `profile_update`. Email is never changed.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/056_portal_profile.sql`:

```sql
-- Tests for 20261016000007_portal_profile (Partner Portal Phase 2A, FR-PORT-19).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/056_portal_profile.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-profile): boss administrator; rita rep and rob rep in
-- separate branches. Partner P1 (Jane CPA, owner rita) with active portal user
-- PU1; partner P2 (Kim CPA, owner rita) with suspended portal user PU2. Org B
-- portal-profile-b: bob.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001056', 'Profile Org',   'portal-profile',   'portal-profile-a1',   true),
  ('00000000-0000-0000-0000-000000001156', 'Profile Org B', 'portal-profile-b', 'portal-profile-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0560000-0000-0000-0000-000000000001', 'boss@pf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000002', 'rita@pf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000003', 'rob@pf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000004', 'bob@pfb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0560000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'admin', 'administrator',      'Boss',     'boss@pf.example', 'pfboss'::ltree,      null),
  ('a0560000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'rep',   'sales_professional', 'Rita Rep', 'rita@pf.example', 'pfboss.rita'::ltree, 'a0560000-0000-0000-0000-000000000001'),
  ('a0560000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001056', 'rep',   'sales_professional', 'Rob Rep',  'rob@pf.example',  'pfboss.rob'::ltree,  'a0560000-0000-0000-0000-000000000001'),
  ('a0560000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001156', 'admin', 'administrator',      'Bob',      'bob@pfb.example', 'pfbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a056a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'a0560000-0000-0000-0000-000000000002', 'a0560000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@pf.example', '5550561111'),
  ('a056a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'a0560000-0000-0000-0000-000000000002', 'a0560000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@pf.example',  null);

insert into portal_users (id, org_id, partner_id, email, status, notification_prefs) values
  ('a056b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'jane@pf.example', 'active',    '{}'),
  ('a056b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'kim@pf.example',  'suspended', '{}');

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

create or replace function _t_change_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from partner_profile_changes;
  return n;
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_get_profile(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_get_profile(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE') then
    raise exception 'profile functions must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE') then
    raise exception 'service_role should execute portal_update_profile';
  end if;
  if has_table_privilege('authenticated', 'public.partner_profile_changes', 'INSERT')
     or has_table_privilege('authenticated', 'public.partner_profile_changes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.partner_profile_changes', 'DELETE')
     or not has_table_privilege('authenticated', 'public.partner_profile_changes', 'SELECT')
     or has_table_privilege('anon', 'public.partner_profile_changes', 'SELECT') then
    raise exception 'partner_profile_changes: authenticated reads only, anon nothing';
  end if;
end $$;

-- 2. Read, save, and the change log (as postgres, like portal_api).
do $$ declare p record; n int; begin
  select * into p from public.portal_get_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001');
  if p.name <> 'Jane CPA' or p.phone <> '5550561111' or p.email <> 'jane@pf.example' or not p.weekly_digest then
    raise exception 'profile read wrong: %', row_to_json(p);
  end if;

  select * into p from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', '  Jane Smith ', '  ', false, '203.0.113.5');
  if p.name <> 'Jane Smith' or p.phone is not null or p.weekly_digest then
    raise exception 'profile save result wrong: %', row_to_json(p);
  end if;
  if not exists (select 1 from partners where id = 'a056a000-0000-0000-0000-000000000001' and name = 'Jane Smith' and phone is null) then
    raise exception 'the partner record should carry the new name and no phone';
  end if;
  if (select notification_prefs from portal_users where id = 'a056b000-0000-0000-0000-000000000001') <> '{"digest": false}'::jsonb then
    raise exception 'weekly email preference not stored';
  end if;
  if (select email from portal_users where id = 'a056b000-0000-0000-0000-000000000001') <> 'jane@pf.example' then
    raise exception 'the sign-in email never changes here';
  end if;
  if not exists (select 1 from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001'
                  and field = 'name' and old_value = 'Jane CPA' and new_value = 'Jane Smith'
                  and portal_user_id = 'a056b000-0000-0000-0000-000000000001') then
    raise exception 'name change not logged';
  end if;
  if not exists (select 1 from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001'
                  and field = 'phone' and old_value = '5550561111' and new_value is null) then
    raise exception 'phone change not logged';
  end if;
  select count(*) into n from portal_audit_log where portal_user_id = 'a056b000-0000-0000-0000-000000000001' and action = 'profile_update' and ip = '203.0.113.5';
  if n <> 1 then raise exception 'profile saves are audited, got %', n; end if;

  -- Saving the same values logs nothing new.
  perform * from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane Smith', null, false, null);
  select count(*) into n from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'an unchanged save logs nothing, got % rows', n; end if;

  -- A phone in any format with enough digits; the weekly email back on (null means on).
  select * into p from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane Smith', '(555) 056-2222', null, null);
  if p.phone <> '(555) 056-2222' or not p.weekly_digest then raise exception 'phone or preference not saved: %', row_to_json(p); end if;
  select count(*) into n from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'phone change logged once, got % rows', n; end if;

  -- A preference that is not a JSON boolean reads as on.
  update portal_users set notification_prefs = '{"digest": "yes"}' where id = 'a056b000-0000-0000-0000-000000000001';
  select * into p from public.portal_get_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001');
  if not p.weekly_digest then raise exception 'a malformed preference reads as on'; end if;
end $$;

-- 3. Field rules and scope.
do $$ begin
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', '   ', null, true, null)$q$, 'invalid_input:name');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', repeat('a', 121), null, true, null)$q$, 'invalid_input:name');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', repeat('5', 41), true, null)$q$, 'invalid_input:phone');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', 'call me', true, null)$q$, 'invalid_input:phone');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'a056b000-0000-0000-0000-000000000001', 'Kim', null, true, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'a056b000-0000-0000-0000-000000000002', 'Kim', null, true, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_get_profile('00000000-0000-0000-0000-000000001156', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001')$q$, 'not_authorized');
end $$;

-- 4. Reps read the change log through partner visibility (role switches here).
do $$ begin
  if _t_change_rows('a0560000-0000-0000-0000-000000000002') <> 3 then raise exception 'rita sees the 3 changes on her partner'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000001') <> 3 then raise exception 'an admin sees them'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000003') <> 0 then raise exception 'rob in another branch sees nothing'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000004') <> 0 then raise exception 'another org sees nothing'; end if;
end $$;

-- 5. Twenty saves an hour, then rate_limited.
do $$ begin
  perform set_config('role', 'postgres', true);
  insert into portal_audit_log (org_id, portal_user_id, action)
  select '00000000-0000-0000-0000-000000001056', 'a056b000-0000-0000-0000-000000000001', 'profile_update'
    from generate_series(1, 20);
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', null, true, null)$q$, 'rate_limited');
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/056_portal_profile.sql`
Expected: FAIL with `function public.portal_get_profile(uuid, uuid, uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000007_portal_profile.sql`:

```sql
-- 20261016000007_portal_profile.sql
--
-- Partner Portal Phase 2A (FR-PORT-19): a signed-in partner keeps their own
-- name and phone current and chooses whether to get the weekly email (the
-- digest itself ships in Phase 2B). The email is the sign-in identity and is
-- never changed here.
--
-- Name and phone edits update the Partner record and are written to
-- partner_profile_changes, which the partner page shows. partner_activities
-- cannot hold them: logged_by must be an internal profile, and every insert
-- moves partners.last_touch_at, but a partner's own edit is not a rep touch.
--
-- Service role only (portal_api), pinned to the session's (org, partner,
-- portal user) like every 1B function.

create table partner_profile_changes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  partner_id     uuid not null references partners(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  field          text not null check (field in ('name','phone')),
  old_value      text,
  new_value      text,
  changed_at     timestamptz not null default now()
);
create index partner_profile_changes_partner_idx on partner_profile_changes (partner_id, changed_at desc);

alter table partner_profile_changes enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on partner_profile_changes from anon;
revoke all on partner_profile_changes from authenticated;
grant select on partner_profile_changes to authenticated;

create policy partner_profile_changes_select on partner_profile_changes for select to authenticated using (
  org_id = public.user_org_id() and public.can_see_partner(partner_id)
);

create or replace function public.portal_get_profile(p_org uuid, p_partner uuid, p_portal_user uuid)
returns table (name text, phone text, email text, weekly_digest boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  return query
    select p.name,
           p.phone,
           u.email,
           case when jsonb_typeof(u.notification_prefs -> 'digest') = 'boolean'
                then (u.notification_prefs ->> 'digest')::boolean
                else true end
      from partners p
      join portal_users u on u.partner_id = p.id and u.id = p_portal_user
     where p.id = p_partner and p.org_id = p_org;
end $$;

create or replace function public.portal_update_profile(
  p_org           uuid,
  p_partner       uuid,
  p_portal_user   uuid,
  p_name          text,
  p_phone         text,
  p_weekly_digest boolean,
  p_ip            text
)
returns table (name text, phone text, email text, weekly_digest boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_partner partners;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);

  -- Field rules mirror _shared/portalProfile.ts.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'invalid_input:name' using errcode = '22023';
  end if;
  if v_phone is not null
     and (char_length(v_phone) > 40 or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7) then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;

  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_profile:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'profile_update'
         and a.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select * into v_partner from partners x where x.id = p_partner and x.org_id = p_org for update;

  if v_partner.name is distinct from v_name then
    insert into partner_profile_changes (org_id, partner_id, portal_user_id, field, old_value, new_value)
    values (p_org, p_partner, p_portal_user, 'name', v_partner.name, v_name);
  end if;
  if v_partner.phone is distinct from v_phone then
    insert into partner_profile_changes (org_id, partner_id, portal_user_id, field, old_value, new_value)
    values (p_org, p_partner, p_portal_user, 'phone', v_partner.phone, v_phone);
  end if;
  if v_partner.name is distinct from v_name or v_partner.phone is distinct from v_phone then
    update partners x set name = v_name, phone = v_phone where x.id = p_partner;
  end if;

  update portal_users u
     set notification_prefs = u.notification_prefs || jsonb_build_object('digest', coalesce(p_weekly_digest, true)),
         updated_at         = now()
   where u.id = p_portal_user;

  perform public._portal_audit_referral(p_org, p_portal_user, 'profile_update', null, p_ip);

  return query select * from public.portal_get_profile(p_org, p_partner, p_portal_user);
end $$;

revoke execute on function public.portal_get_profile(uuid, uuid, uuid)                                from public, anon, authenticated;
revoke execute on function public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)  from public, anon, authenticated;
grant  execute on function public.portal_get_profile(uuid, uuid, uuid)                                to service_role;
grant  execute on function public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)  to service_role;
```

- [ ] **Step 4: Run every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS, including `051` to `056`; the two documented SKIPs unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016000007_portal_profile.sql supabase/tests/056_portal_profile.sql
git commit -m "$(cat <<'EOF'
feat(portal): partners keep their own name, phone and email preference

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `portal_api` profile, export and purged-detail actions

**Files:**
- Create: `supabase/functions/_shared/portalProfile.ts`
- Test: `supabase/functions/_shared/portalProfile.test.ts`
- Modify: `supabase/functions/_shared/portalReferralApi.ts`
- Test: `supabase/functions/_shared/portalReferralApi.test.ts`
- Modify: `supabase/functions/portal_api/index.ts` (route comment only)
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: SQL from Tasks 3 and 7 (`portal_export_referrals`, `portal_get_referral` with `details_removed`, `portal_get_profile`, `portal_update_profile`); `portalLabel`, `PortalLabel` from `_shared/portalLabels.ts`; `windowArg`, `scopeArgs`, `rows`, `str`, `strOrNull`, `ok`, `err`, `serverError` inside `portalReferralApi.ts`.
- Produces (TS):
  - `_shared/portalProfile.ts`:
    - `export const PORTAL_PROFILE_LIMITS: { readonly name: 120; readonly phone: 40 }`
    - `export const PORTAL_PROFILE_MIN_PHONE_DIGITS = 7`
    - `export interface PortalProfile { name: string; phone: string | null; email: string; weeklyDigest: boolean }`
    - `export interface PortalProfileInput { name: string; phone: string | null; weeklyDigest: boolean }`
    - `export type PortalProfileField = "name" | "phone" | "weeklyDigest"`
    - `export const PORTAL_PROFILE_MESSAGES: Record<PortalProfileField, string>`
    - `export type ProfileCheck = { ok: true; value: PortalProfileInput } | { ok: false; field: PortalProfileField }`
    - `export function validateProfile(raw: unknown): ProfileCheck`
  - `_shared/portalReferralApi.ts`:
    - `REFERRAL_ACTIONS` gains `"export_referrals"`, `"get_profile"`, `"update_profile"`.
    - `export interface PortalExportRow { ref: string; companyName: string; label: PortalLabel; submittedAt: string; lastActivityAt: string; closedWonValueCents: number | null }`
    - `export interface PortalExport { valueVisible: boolean; rows: PortalExportRow[] }`
    - `PortalReferralDetail` gains `detailsRemoved: boolean`.
    - Responses: `export_referrals` (body `{ window? }`) answers `{ export: PortalExport }`; `get_profile` answers `{ profile: PortalProfile }`; `update_profile` (body `{ name, phone, weeklyDigest }`) answers `{ profile: PortalProfile }`, `400 { error: "invalid_body", field }`, or `429 { error: "rate_limited" }`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/portalProfile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PORTAL_PROFILE_LIMITS, PORTAL_PROFILE_MESSAGES, validateProfile } from "./portalProfile";

describe("validateProfile", () => {
  it("trims the name and phone, and turns a blank phone into null", () => {
    expect(validateProfile({ name: "  Jane Smith ", phone: "  ", weeklyDigest: false })).toEqual({
      ok: true,
      value: { name: "Jane Smith", phone: null, weeklyDigest: false },
    });
    expect(validateProfile({ name: "Jane", phone: " (555) 010-0100 ", weeklyDigest: true })).toEqual({
      ok: true,
      value: { name: "Jane", phone: "(555) 010-0100", weeklyDigest: true },
    });
    expect(validateProfile({ name: "Jane", phone: null, weeklyDigest: true })).toEqual({
      ok: true,
      value: { name: "Jane", phone: null, weeklyDigest: true },
    });
  });

  it("needs a name of at most 120 characters", () => {
    for (const name of ["", "   ", undefined, 42]) {
      expect(validateProfile({ name, phone: null, weeklyDigest: true })).toEqual({ ok: false, field: "name" });
    }
    expect(validateProfile({ name: "a".repeat(PORTAL_PROFILE_LIMITS.name + 1), phone: null, weeklyDigest: true })).toEqual({
      ok: false,
      field: "name",
    });
    expect(validateProfile({ name: "a".repeat(PORTAL_PROFILE_LIMITS.name), phone: null, weeklyDigest: true }).ok).toBe(true);
  });

  it("rejects a phone that is too long, has fewer than 7 digits, or is not text", () => {
    for (const phone of ["5".repeat(PORTAL_PROFILE_LIMITS.phone + 1), "call me", "12345 6", 5550100]) {
      expect(validateProfile({ name: "Jane", phone, weeklyDigest: true })).toEqual({ ok: false, field: "phone" });
    }
    expect(validateProfile({ name: "Jane", phone: "1234567", weeklyDigest: true }).ok).toBe(true);
  });

  it("needs the weekly email choice as a boolean", () => {
    expect(validateProfile({ name: "Jane", phone: null })).toEqual({ ok: false, field: "weeklyDigest" });
    expect(validateProfile({ name: "Jane", phone: null, weeklyDigest: "yes" })).toEqual({ ok: false, field: "weeklyDigest" });
  });

  it("treats a missing body as a missing name", () => {
    expect(validateProfile(null)).toEqual({ ok: false, field: "name" });
  });

  it("has partner-facing copy for every field that never names the platform", () => {
    for (const key of ["name", "phone", "weeklyDigest"] as const) {
      expect(PORTAL_PROFILE_MESSAGES[key]).toBeTruthy();
      expect(PORTAL_PROFILE_MESSAGES[key]).not.toMatch(/navigatr/i);
    }
  });
});
```

Append to `supabase/functions/_shared/portalReferralApi.test.ts` (it already defines `setup`, `call`, `ok`, `fail`, `RID`, `NOW`):

```ts
describe("export_referrals", () => {
  const ROWS = [
    {
      ref: "REF-AAAA0001",
      company_name: "Fresh Bakery",
      status: "won",
      submitted_at: "2026-10-01T12:00:00Z",
      last_activity_at: "2026-10-05T12:00:00Z",
      won_value_cents: 500000,
      value_visible: true,
      icp_flags: ["chain:Subway"],
      decline_reason: "outside_icp",
    },
    {
      ref: "REF-AAAA0002",
      company_name: "Corner Cafe",
      status: "declined",
      submitted_at: "2026-09-20T12:00:00Z",
      last_activity_at: "2026-09-21T12:00:00Z",
      won_value_cents: null,
      value_visible: true,
    },
  ];

  it("returns labelled rows for the session scope and the chosen window", async () => {
    const { deps, rpc } = setup({ portal_export_referrals: () => ok(ROWS) });
    const { status, json } = await call("export_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_export_referrals", {
      p_org: "o-1",
      p_partner: "p-1",
      p_since: "2026-09-12T15:00:00.000Z",
    });
    expect(status).toBe(200);
    expect(json).toEqual({
      export: {
        valueVisible: true,
        rows: [
          {
            ref: "REF-AAAA0001",
            companyName: "Fresh Bakery",
            label: "Closed Won",
            submittedAt: "2026-10-01T12:00:00Z",
            lastActivityAt: "2026-10-05T12:00:00Z",
            closedWonValueCents: 500000,
          },
          {
            ref: "REF-AAAA0002",
            companyName: "Corner Cafe",
            label: "Not Moving Forward",
            submittedAt: "2026-09-20T12:00:00Z",
            lastActivityAt: "2026-09-21T12:00:00Z",
            closedWonValueCents: null,
          },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ['"won"', '"declined"', "outside_icp", "chain:", "icp"]) expect(text).not.toContain(leak);
  });

  it("never sends a value when the ISO hides it, even if a row carries one", async () => {
    const hidden = ROWS.map((r) => ({ ...r, value_visible: false }));
    const { deps } = setup({ portal_export_referrals: () => ok(hidden) });
    const { json } = await call("export_referrals", {}, deps);
    const out = json.export as { valueVisible: boolean; rows: Array<{ closedWonValueCents: number | null }> };
    expect(out.valueVisible).toBe(false);
    expect(out.rows.map((r) => r.closedWonValueCents)).toEqual([null, null]);
    expect(JSON.stringify(json)).not.toContain("500000");
  });

  it("drops a row whose status has no partner label, and rejects an unknown window", async () => {
    const { deps } = setup({ portal_export_referrals: () => ok([{ ...ROWS[0], status: "bogus" }]) });
    expect((await call("export_referrals", {}, deps)).json).toEqual({ export: { valueVisible: false, rows: [] } });
    const bad = await call("export_referrals", { window: "5y" }, deps);
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: "invalid_body", field: "window" });
  });

  it("answers a generic 500 when the export fails", async () => {
    const { deps } = setup({ portal_export_referrals: () => fail("boom") });
    const res = await call("export_referrals", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
});

describe("get_profile and update_profile", () => {
  const ROW = {
    name: "Jane",
    phone: "5550100100",
    email: "jane@example.com",
    weekly_digest: true,
    org_id: "secret-org",
    notification_prefs: { digest: true, other: "x" },
  };

  it("reads the session partner's profile from an allowlist", async () => {
    const { deps, rpc } = setup({ portal_get_profile: () => ok([ROW]) });
    const { status, json } = await call("get_profile", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_profile", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1" });
    expect(status).toBe(200);
    expect(json).toEqual({ profile: { name: "Jane", phone: "5550100100", email: "jane@example.com", weeklyDigest: true } });
  });

  it("saves trimmed values through the session scope, ignoring ids in the body", async () => {
    const { deps, rpc } = setup({
      portal_update_profile: () => ok([{ ...ROW, name: "Jane Smith", phone: null, weekly_digest: false }]),
    });
    const { status, json } = await call(
      "update_profile",
      { name: " Jane Smith ", phone: "", weeklyDigest: false, orgId: "x", partnerId: "y", portalUserId: "z" },
      deps,
    );
    expect(rpc).toHaveBeenCalledWith("portal_update_profile", {
      p_org: "o-1",
      p_partner: "p-1",
      p_portal_user: "u-1",
      p_name: "Jane Smith",
      p_phone: null,
      p_weekly_digest: false,
      p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ profile: { name: "Jane Smith", phone: null, email: "jane@example.com", weeklyDigest: false } });
  });

  it("rejects bad input before any profile call", async () => {
    const { deps, rpc } = setup();
    const res = await call("update_profile", { name: "", phone: null, weeklyDigest: true }, deps);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "invalid_body", field: "name" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps the server's field error and the rate limit", async () => {
    const field = setup({ portal_update_profile: () => fail("invalid_input:phone") });
    expect((await call("update_profile", { name: "Jane", phone: "5550100100", weeklyDigest: true }, field.deps)).json).toEqual({
      error: "invalid_body",
      field: "phone",
    });
    const limited = setup({ portal_update_profile: () => fail("rate_limited") });
    const res = await call("update_profile", { name: "Jane", phone: null, weeklyDigest: true }, limited.deps);
    expect(res.status).toBe(429);
    expect(res.json).toEqual({ error: "rate_limited" });
  });

  it("answers 500 when no profile row comes back", async () => {
    const { deps } = setup({ portal_get_profile: () => ok([]) });
    const res = await call("get_profile", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
});

describe("get_referral after a purge", () => {
  const PURGED = {
    id: RID,
    ref: "REF-3F9A21C0",
    company_name: "Fresh Bakery",
    contact_name: "PURGED-SECRET name",
    contact_email: "purged-secret@example.com",
    contact_phone: "5550100100",
    address: "PURGED-SECRET address",
    industry: "restaurant",
    urgency: "this_week",
    notes: "PURGED-SECRET notes",
    status: "declined",
    source: "portal_signed_in",
    submitted_at: "2026-06-01T12:00:00Z",
    rep_name: "Rita Rep",
    rep_email: "rita@acme.example",
    can_withdraw: false,
    details_removed: true,
  };

  it("returns no personal details for a purged referral and says so", async () => {
    const { deps } = setup({
      portal_get_referral: () => ok([PURGED]),
      portal_referral_history: () => ok([{ status: "declined", created_at: "2026-06-02T12:00:00Z" }]),
      portal_referral_updates: () => ok([]),
    });
    const { status, json } = await call("get_referral", { referralId: RID }, deps);
    expect(status).toBe(200);
    const detail = json.referral as Record<string, unknown>;
    expect(detail.detailsRemoved).toBe(true);
    for (const key of ["contactName", "contactEmail", "contactPhone", "address", "notes"]) expect(detail[key]).toBeNull();
    expect(detail).toMatchObject({ companyName: "Fresh Bakery", industry: "restaurant", urgency: "this_week", label: "Not Moving Forward" });
    const text = JSON.stringify(json);
    expect(text).not.toContain("PURGED-SECRET");
    expect(text).not.toContain("purged-secret@example.com");
    expect(text).not.toContain("5550100100");
  });
});
```

In the existing `returns the allowlisted detail with labelled, collapsed history` test of `portalReferralApi.test.ts`, add the line `detailsRemoved: false,` directly after `canWithdraw: false,` in the expected `referral` object.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- _shared/portalProfile _shared/portalReferralApi`
Expected: FAIL: `Failed to resolve import "./portalProfile"`, and the new `export_referrals` and `get_profile` tests answer 404 `not_found`.

- [ ] **Step 3: Write `_shared/portalProfile.ts`**

Create `supabase/functions/_shared/portalProfile.ts`:

```ts
/**
 * Partner profile rules (Partner Portal Phase 2A, FR-PORT-19).
 *
 * Shared by portal_api (server validation before any SQL) and the portal's
 * profile page (the same messages before a request is sent). The SQL function
 * portal_update_profile enforces the same caps again. The sign-in email is the
 * partner's identity and is never editable here.
 *
 * Pure TS, no Deno globals: vitest covers it and the edge imports it with .ts.
 */
export const PORTAL_PROFILE_LIMITS = { name: 120, phone: 40 } as const;
export const PORTAL_PROFILE_MIN_PHONE_DIGITS = 7;

export interface PortalProfile {
  name: string;
  phone: string | null;
  email: string;
  /** Whether the partner wants the weekly email (sent from Phase 2B). */
  weeklyDigest: boolean;
}

export interface PortalProfileInput {
  name: string;
  phone: string | null;
  weeklyDigest: boolean;
}

export type PortalProfileField = "name" | "phone" | "weeklyDigest";

export const PORTAL_PROFILE_MESSAGES: Record<PortalProfileField, string> = {
  name: "Add your name (up to 120 characters).",
  phone: "Enter a phone number with at least 7 digits, or leave it blank.",
  weeklyDigest: "Choose whether to get the weekly email.",
};

export type ProfileCheck = { ok: true; value: PortalProfileInput } | { ok: false; field: PortalProfileField };

export function validateProfile(raw: unknown): ProfileCheck {
  const body = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  if (typeof body.name !== "string") return { ok: false, field: "name" };
  const name = body.name.trim();
  if (!name || name.length > PORTAL_PROFILE_LIMITS.name) return { ok: false, field: "name" };

  if (body.phone !== null && body.phone !== undefined && typeof body.phone !== "string") {
    return { ok: false, field: "phone" };
  }
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (
    phone &&
    (phone.length > PORTAL_PROFILE_LIMITS.phone || phone.replace(/\D/g, "").length < PORTAL_PROFILE_MIN_PHONE_DIGITS)
  ) {
    return { ok: false, field: "phone" };
  }

  if (typeof body.weeklyDigest !== "boolean") return { ok: false, field: "weeklyDigest" };

  return { ok: true, value: { name, phone: phone || null, weeklyDigest: body.weeklyDigest } };
}
```

- [ ] **Step 4: Extend `_shared/portalReferralApi.ts`**

Make these edits:

1. After the existing `import { PORTAL_MAX_AUDIO_BASE64_CHARS, ... } from "./transcribe.ts";` line, add:

```ts
import { validateProfile, type PortalProfile } from "./portalProfile.ts";
```

2. Replace the `REFERRAL_ACTIONS` array with:

```ts
export const REFERRAL_ACTIONS = [
  "form",
  "dup_check",
  "submit_referral",
  "list_referrals",
  "get_referral",
  "withdraw_referral",
  "dashboard",
  "transcribe",
  "export_referrals",
  "get_profile",
  "update_profile",
] as const;
```

3. Directly after the `PortalReferralSummary` interface, add:

```ts
/** One CSV row (FR-PORT-75). Partner labels only; value only when the ISO shows it. */
export interface PortalExportRow {
  ref: string;
  companyName: string;
  label: PortalLabel;
  submittedAt: string;
  lastActivityAt: string;
  closedWonValueCents: number | null;
}

export interface PortalExport {
  valueVisible: boolean;
  rows: PortalExportRow[];
}
```

4. In `PortalReferralDetail`, directly after `canWithdraw: boolean;`, add:

```ts
  /** The ISO's retention period passed and the contact details were erased (FR-PORT-92). */
  detailsRemoved: boolean;
```

5. In `handleReferralAction`, directly before `default:`, add:

```ts
    case "export_referrals":
      return exportReferrals(scope, body, deps);
    case "get_profile":
      return getProfile(scope, deps);
    case "update_profile":
      return updateProfile(scope, body, ip, deps);
```

6. In `getReferral`, replace the block from `// Defense in depth: SQL already blanks these` through the closing `};` of `const out: PortalReferralDetail = { ... };` with:

```ts
  // Defense in depth: SQL already blanks these for a rep-logged referral and
  // for a purged one; never pass rep-written text or erased details through
  // even if a row carried them (spec 6, FR-PORT-92).
  const typed = row.source === "portal_signed_in";
  const removed = row.details_removed === true;
  const personal = typed && !removed;
  const repName = strOrNull(row.rep_name);
  const repEmail = strOrNull(row.rep_email);
  const out: PortalReferralDetail = {
    id: str(row.id),
    ref: str(row.ref),
    companyName: str(row.company_name),
    contactName: personal ? strOrNull(row.contact_name) : null,
    contactEmail: personal ? strOrNull(row.contact_email) : null,
    contactPhone: personal ? strOrNull(row.contact_phone) : null,
    address: personal ? strOrNull(row.address) : null,
    industry: typed ? strOrNull(row.industry) : null,
    urgency: typed ? strOrNull(row.urgency) : null,
    notes: personal ? strOrNull(row.notes) : null,
    label,
    submittedAt: str(row.submitted_at),
    canWithdraw: personal && row.can_withdraw === true,
    detailsRemoved: removed,
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    history,
    updates,
  };
```

7. Append at the end of the file:

```ts
async function exportReferrals(scope: ReferralScope, body: Body, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_export_referrals", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("export_referrals", error.message);
  const raw = rows<Record<string, unknown>>(data);
  // FR-PORT-70/71: the value leaves the server only when the ISO allows it.
  const valueVisible = raw.length > 0 && raw.every((r) => r.value_visible === true);
  const out: PortalExportRow[] = [];
  for (const r of raw) {
    const label = portalLabel(r.status);
    if (!label) continue;
    const cents = r.won_value_cents === null || r.won_value_cents === undefined ? null : Number(r.won_value_cents);
    out.push({
      ref: str(r.ref),
      companyName: str(r.company_name),
      label,
      submittedAt: str(r.submitted_at),
      lastActivityAt: str(r.last_activity_at),
      closedWonValueCents:
        valueVisible && label === "Closed Won" && cents !== null && Number.isSafeInteger(cents) && cents >= 0
          ? cents
          : null,
    });
  }
  const result: PortalExport = { valueVisible: valueVisible && out.length > 0, rows: out };
  return ok({ export: result });
}

/** The four profile fields, nothing else from the row. */
function profileFrom(row: Record<string, unknown> | undefined): PortalProfile | null {
  if (!row || !str(row.name)) return null;
  return {
    name: str(row.name),
    phone: strOrNull(row.phone),
    email: str(row.email),
    weeklyDigest: row.weekly_digest !== false,
  };
}

async function getProfile(scope: ReferralScope, deps: ReferralDeps): Promise<ActionResult> {
  const { data, error } = await deps.rpc("portal_get_profile", { ...scopeArgs(scope), p_portal_user: scope.portalUserId });
  if (error) return serverError("get_profile", error.message);
  const profile = profileFrom(rows<Record<string, unknown>>(data)[0]);
  if (!profile) return serverError("get_profile", "no profile row");
  return ok({ profile });
}

async function updateProfile(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const check = validateProfile(body);
  if (!check.ok) return err(400, "invalid_body", { field: check.field });
  const { data, error } = await deps.rpc("portal_update_profile", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_name: check.value.name,
    p_phone: check.value.phone,
    p_weekly_digest: check.value.weeklyDigest,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("rate_limited")) return err(429, "rate_limited");
    const field = /invalid_input:([A-Za-z]+)/.exec(error.message)?.[1];
    if (field) return err(400, "invalid_body", { field });
    return serverError("update_profile", error.message);
  }
  const profile = profileFrom(rows<Record<string, unknown>>(data)[0]);
  if (!profile) return serverError("update_profile", "no profile row");
  return ok({ profile });
}
```

- [ ] **Step 5: Route comment and typecheck include**

In `supabase/functions/portal_api/index.ts`, replace the comment line

```ts
//   withdraw_referral | transcribe   (Phase 1B, session required)
```

with

```ts
//   withdraw_referral | transcribe   (Phase 1B, session required)
//   export_referrals | get_profile | update_profile   (Phase 2A, session required)
```

In `apps/app/tsconfig.app.json`, add `"../../supabase/functions/_shared/portalProfile.ts",` to the `include` array directly after `"../../supabase/functions/_shared/portalSubmission.ts",`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter app test -- _shared/portalProfile _shared/portalReferralApi _shared/portalApi`
Expected: PASS.

Run: `NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/portal_api/index.ts`
Expected: `Check file:///.../portal_api/index.ts` and exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalProfile.ts supabase/functions/_shared/portalProfile.test.ts supabase/functions/_shared/portalReferralApi.ts supabase/functions/_shared/portalReferralApi.test.ts supabase/functions/portal_api/index.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): profile and CSV export actions; purged details never leave the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: "You can reinstate" email

**Files:**
- Modify: `supabase/functions/_shared/portalNotifyEmail.ts`
- Test: `supabase/functions/_shared/portalNotifyEmail.test.ts`

**Interfaces:**
- Consumes: outbox kind `internal_reinstate_available` and its payload `{ appUrlPath, companyNames, count }` (Task 5); `parseInternalPayload` (1C, unchanged: exact keys, path must match `^/[A-Za-z0-9/_-]*$`).
- Produces (TS): `INTERNAL_NOTIFY_KINDS` is `["internal_new_referral", "internal_nudge", "internal_reinstate_available"]`. `buildPortalNotifyEmail("internal_reinstate_available", payload, ctx)` returns an internal email: subject `You can reinstate <name>` for one, `<n> declined duplicates can be reinstated` for several; CTA "Open partner" to `appBaseUrl + appUrlPath`; at most 10 names listed plus "and N more". `portal_notify` needs no change: it builds every claimed kind through this function.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/portalNotifyEmail.test.ts` (it already defines `BASE`, `CTX`):

```ts
describe("internal_reinstate_available", () => {
  const PATH = "/partners/3f9a21c0-1111-4222-8333-444455556666";

  it("tells the reviewer one declined duplicate can come back, and links to the partner", () => {
    const e = buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: ["Dup One"], count: 1 }, CTX)!;
    expect(e).not.toBeNull();
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
    expect(e.subject).toBe("You can reinstate Dup One");
    expect(e.heading).toBe("A declined duplicate can come back");
    expect(e.bodyLines[0]).toBe(
      "Dup One was declined as a duplicate of an earlier referral. That earlier referral is now closed, so Dup One can be reinstated.",
    );
    expect(e.ctaLabel).toBe("Open partner");
    expect(e.ctaUrl).toBe(`${BASE}${PATH}`);
  });

  it("lists several, at most 10, with a remainder line", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Co ${i + 1}`);
    const e = buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: names, count: 12 }, CTX)!;
    expect(e.subject).toBe("12 declined duplicates can be reinstated");
    expect(e.heading).toBe("Declined duplicates can come back");
    expect(e.bodyLines).toContain("- Co 10");
    expect(e.bodyLines).not.toContain("- Co 11");
    expect(e.bodyLines).toContain("and 2 more");
  });

  it("is an internal kind, and a malformed payload is dropped", () => {
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_reinstate_available");
    expect(
      buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: "https://evil.example/x", companyNames: ["A"], count: 1 }, CTX),
    ).toBeNull();
    expect(buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: [], count: 1 }, CTX)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test -- _shared/portalNotifyEmail`
Expected: FAIL: the first new test gets `null` (`expected null not to be null`).

- [ ] **Step 3: Add the kind and its builder**

In `supabase/functions/_shared/portalNotifyEmail.ts`:

1. Replace

```ts
export const INTERNAL_NOTIFY_KINDS = ["internal_new_referral", "internal_nudge"] as const;
```

with

```ts
export const INTERNAL_NOTIFY_KINDS = ["internal_new_referral", "internal_nudge", "internal_reinstate_available"] as const;
```

2. In `buildInternal`, directly before the line `const n = p.count;` (the nudge branch), add:

```ts
  if (kind === "internal_reinstate_available") {
    const count = p.count;
    const first = p.companyNames[0];
    const listed = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
    const rest = count > listed.length ? [`and ${count - listed.length} more`] : [];
    return {
      subject: count === 1 ? `You can reinstate ${first}` : `${count} declined duplicates can be reinstated`,
      preheader:
        count === 1
          ? `The earlier referral for ${first} is closed.`
          : "The earlier referrals for these businesses are closed.",
      heading: count === 1 ? "A declined duplicate can come back" : "Declined duplicates can come back",
      bodyLines:
        count === 1
          ? [
              `${first} was declined as a duplicate of an earlier referral. That earlier referral is now closed, so ${first} can be reinstated.`,
              "Open the partner to reinstate it, or leave it declined.",
            ]
          : [
              "These were declined as duplicates of an earlier referral that is now closed, so they can be reinstated:",
              ...listed,
              ...rest,
              "Open the partner to reinstate them, or leave them declined.",
            ],
      ctaLabel: "Open partner",
      ctaUrl: url,
      footnote: "You're getting this because partner referrals are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- _shared/portalNotifyEmail _shared/portalNotify`
Expected: PASS.

Run: `NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_notify/deno.json supabase/functions/portal_notify/index.ts`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalNotifyEmail.ts supabase/functions/_shared/portalNotifyEmail.test.ts
git commit -m "$(cat <<'EOF'
feat(portal): email the reviewer when a declined duplicate can be reinstated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Partners download a CSV; purged details say so

**Files:**
- Create: `apps/app/src/features/portal/lib/portalCsv.ts`
- Test: `apps/app/src/features/portal/lib/portalCsv.test.ts`
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`
- Test: `apps/app/src/features/portal/lib/portalApi.test.ts`
- Modify: `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`
- Test: `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalReferralPage.tsx`
- Test: `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`

**Interfaces:**
- Consumes: `PortalExport`, `PortalExportRow` (Task 8); `portalApi`, `portalDataKey`, `isPortalUnauthorized`, `isPortalTransientError` (1B); `portalReachMessage` from `../components/PortalRetry`.
- Produces (TS):
  - `portalApi.exportReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalExport>`; `portalApi.ts` re-exports `type PortalExport` and `type PortalExportRow`.
  - `portalCsv.ts`: `csvCell(value: string): string`, `buildReferralsCsv(data: PortalExport): string` (CRLF lines, header `Reference,Business,Status,Sent,Last update` plus `,Closed Won value` when `valueVisible`; dates `yyyy-mm-dd` in UTC; value in dollars with two decimals), `referralsCsvFilename(slug: string, now: Date): string` (`<slug>-referrals-<yyyy-mm-dd>.csv`, local date), `downloadCsv(filename: string, csv: string): void`.
  - Dashboard: a "Download CSV" button under the list (only when the list has rows) that exports the selected period.
  - Referral page: when `detailsRemoved`, the "What you sent" card says "Contact details for this referral were removed for privacy."

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/portal/lib/portalCsv.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildReferralsCsv, csvCell, downloadCsv, referralsCsvFilename } from "./portalCsv";
import type { PortalExportRow } from "./portalApi";

const ROW: PortalExportRow = {
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  label: "Closed Won",
  submittedAt: "2026-10-01T12:00:00Z",
  lastActivityAt: "2026-10-05T12:00:00Z",
  closedWonValueCents: 500000,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Fresh Bakery")).toBe("Fresh Bakery");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
    expect(csvCell('The "Best" Deli')).toBe('"The ""Best"" Deli"');
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
  });

  it("defuses anything a spreadsheet would run as a formula", () => {
    for (const bad of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });
});

describe("buildReferralsCsv", () => {
  it("writes the partner's rows without a value column when the ISO hides values", () => {
    expect(buildReferralsCsv({ valueVisible: false, rows: [{ ...ROW, closedWonValueCents: null }] })).toBe(
      "Reference,Business,Status,Sent,Last update\r\nREF-AAAA0001,Fresh Bakery,Closed Won,2026-10-01,2026-10-05\r\n",
    );
  });

  it("adds the closed won value in dollars when the ISO shows values", () => {
    const csv = buildReferralsCsv({
      valueVisible: true,
      rows: [ROW, { ...ROW, ref: "REF-AAAA0002", companyName: "Corner Cafe", label: "In Progress", closedWonValueCents: null }],
    });
    expect(csv).toBe(
      "Reference,Business,Status,Sent,Last update,Closed Won value\r\n" +
        "REF-AAAA0001,Fresh Bakery,Closed Won,2026-10-01,2026-10-05,5000.00\r\n" +
        "REF-AAAA0002,Corner Cafe,In Progress,2026-10-01,2026-10-05,\r\n",
    );
  });

  it("writes only the header when there is nothing to export, and defuses hostile names", () => {
    expect(buildReferralsCsv({ valueVisible: false, rows: [] })).toBe("Reference,Business,Status,Sent,Last update\r\n");
    const csv = buildReferralsCsv({ valueVisible: false, rows: [{ ...ROW, companyName: "=cmd|' /C calc'!A0", closedWonValueCents: null }] });
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
  });
});

describe("referralsCsvFilename", () => {
  it("names the file after the ISO's portal and today's date", () => {
    expect(referralsCsvFilename("acme", new Date(2026, 9, 16, 9, 30))).toBe("acme-referrals-2026-10-16.csv");
    expect(referralsCsvFilename("Bad Slug/../x", new Date(2026, 0, 5))).toBe("badslugx-referrals-2026-01-05.csv");
    expect(referralsCsvFilename("", new Date(2026, 0, 5))).toBe("portal-referrals-2026-01-05.csv");
  });
});

describe("downloadCsv", () => {
  it("hands the browser a UTF-8 CSV with the given name and frees it afterwards", () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => "blob:csv-1");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true, writable: true });
    const click = vi.spyOn(HTMLElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("acme-referrals-2026-10-16.csv", "a,b\r\n");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].type).toBe("text/csv;charset=utf-8");
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("acme-referrals-2026-10-16.csv");
    expect(anchor.href).toBe("blob:csv-1");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:csv-1");
  });
});
```

Append to `apps/app/src/features/portal/lib/portalApi.test.ts`:

```ts
describe("Phase 2A actions", () => {
  it("exports the chosen period with the session", async () => {
    const EXPORT = { valueVisible: false, rows: [] };
    fetchMock.mockResolvedValueOnce(respond(200, { export: EXPORT }));
    await expect(portalApi.exportReferrals("acme", "tok", "90d")).resolves.toEqual(EXPORT);
    const call = lastCall();
    expect(call.url).toBe(`${PORTAL_API_URL}/export_referrals`);
    expect(call.headers["x-portal-session"]).toBe("tok");
    expect(call.body).toEqual({ slug: "acme", window: "90d" });
  });
});
```

In `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`:

1. Add `exportReferrals: vi.fn(),` to the `vi.hoisted` `api` object (after `transcribe: vi.fn(),`).
2. Directly after the `vi.mock("../lib/portalApi", ...)` block, add:

```ts
const csv = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../lib/portalCsv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalCsv")>();
  return { ...actual, downloadCsv: csv.download };
});
```

3. In `beforeEach`, add `csv.download.mockReset();`.
4. Append inside `describe("PortalDashboardPage", ...)`:

```ts
  it("downloads the partner's referrals for the chosen period as a CSV", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockResolvedValue({
      valueVisible: false,
      rows: [
        {
          ref: "REF-AAAA0001",
          companyName: "Fresh Bakery",
          label: "In Progress",
          submittedAt: "2026-10-01T12:00:00Z",
          lastActivityAt: "2026-10-05T12:00:00Z",
          closedWonValueCents: null,
        },
      ],
    });
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(api.exportReferrals).toHaveBeenCalledWith("acme", "live", "30d");
    expect(csv.download).toHaveBeenCalledTimes(1);
    const [filename, content] = csv.download.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^acme-referrals-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toBe(
      "Reference,Business,Status,Sent,Last update\r\nREF-AAAA0001,Fresh Bakery,In Progress,2026-10-01,2026-10-05\r\n",
    );
  });

  it("offers no download when there are no referrals", async () => {
    api.listReferrals.mockResolvedValue([]);
    renderHome();
    await screen.findByText("Nothing here yet. Send Acme ISO a business and follow it here.");
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("says when the file could not be built, and keeps the list", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderHome();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach Acme ISO. Check your connection and try again.");
    expect(csv.download).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Fresh Bakery/ })).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone during the export", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderHome();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
  });
```

Append inside `describe("PortalReferralPage", ...)` in `apps/app/src/features/portal/pages/PortalReferralPage.test.tsx`:

```ts
  it("says when the contact details were removed", async () => {
    api.getReferral.mockResolvedValue({
      ...DETAIL,
      label: "Not Moving Forward",
      canWithdraw: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      notes: null,
      detailsRemoved: true,
    });
    renderAt("/p/acme/r/r-1");
    expect(await screen.findByText("Contact details for this referral were removed for privacy.")).toBeInTheDocument();
    expect(screen.getByText("Restaurant")).toBeInTheDocument();
    expect(screen.queryByText("Ann")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/portalCsv.test.ts src/features/portal/lib/portalApi.test.ts src/features/portal/pages/PortalDashboardPage.test.tsx src/features/portal/pages/PortalReferralPage.test.tsx`
Expected: FAIL: `Failed to resolve import "./portalCsv"`, `portalApi.exportReferrals is not a function`, and no "Download CSV" button or removed-details text.

- [ ] **Step 3: Add the client call**

In `apps/app/src/features/portal/lib/portalApi.ts`:

1. Replace the type import and re-export at the top with:

```ts
import type {
  PortalDashboard,
  PortalExport,
  PortalExportRow,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";

export type {
  PortalDashboard,
  PortalExport,
  PortalExportRow,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
  PortalWindow,
};
```

2. In the `PortalAction` union, add `| "export_referrals"` after `| "transcribe"`.
3. Add to the `portalApi` object, after `transcribe(...)`:

```ts
  exportReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalExport> {
    return portalRequest<{ export: PortalExport }>("export_referrals", { slug, window: period }, sessionToken).then(
      (r) => r.export,
    );
  },
```

- [ ] **Step 4: Write `portalCsv.ts`**

Create `apps/app/src/features/portal/lib/portalCsv.ts`:

```ts
/**
 * CSV export of the partner's own referrals (FR-PORT-75). Built in the browser
 * from the export_referrals response, which is already an allowlist: partner
 * labels only, and a closed-won value only when the ISO shows values.
 *
 * Cells follow RFC 4180 quoting, and any cell a spreadsheet could read as a
 * formula (starting with =, +, -, @, tab or carriage return) gets a leading
 * single quote, so opening the file never runs anything.
 */
import type { PortalExport } from "./portalApi";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function isoDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildReferralsCsv(data: PortalExport): string {
  const header = ["Reference", "Business", "Status", "Sent", "Last update"];
  if (data.valueVisible) header.push("Closed Won value");
  const lines = [header.map(csvCell).join(",")];
  for (const r of data.rows) {
    const cells = [r.ref, r.companyName, r.label, isoDay(r.submittedAt), isoDay(r.lastActivityAt)];
    if (data.valueVisible) cells.push(r.closedWonValueCents === null ? "" : dollars(r.closedWonValueCents));
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function referralsCsvFilename(slug: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "") || "portal";
  return `${safeSlug}-referrals-${date}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  // The byte order mark makes Excel read the file as UTF-8 (accented names).
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free it after the click is handled; some mobile browsers lose the file otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 5: Add the button to the dashboard**

In `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`:

1. Replace the imports block from `import { ChevronRight, Loader2, Plus } from "lucide-react";` through `import { PORTAL_WINDOWS } ...` with:

```tsx
import { ChevronRight, Download, Loader2, Plus } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import {
  PORTAL_POLL_MS,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalWindow,
} from "../lib/portalApi";
import { buildReferralsCsv, downloadCsv, referralsCsvFilename } from "../lib/portalCsv";
import { formatConversion, formatPortalDate, formatPortalMoney } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { PORTAL_WINDOWS } from "../../../../../../supabase/functions/_shared/portalSubmission";
```

2. Directly after the `React.useEffect(() => { if (unauthorized) expire(); }, [unauthorized, expire]);` block, add:

```tsx
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const data = await portalApi.exportReferrals(slug, token, period);
      downloadCsv(referralsCsvFilename(slug, new Date()), buildReferralsCsv(data));
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      setExportError(
        isPortalTransientError(err) ? portalReachMessage(brand.orgName) : "We couldn't build the file. Try again.",
      );
    } finally {
      setExporting(false);
    }
  };
```

3. Replace

```tsx
            ))}
          </ul>
        )}
      </>
    );
```

with

```tsx
            ))}
          </ul>
        )}

        {referrals.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={Download}
              loading={exporting}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              Download CSV
            </Button>
            {exportError && (
              <p role="alert" className="text-body-sm text-status-danger">
                {exportError}
              </p>
            )}
          </div>
        )}
      </>
    );
```

- [ ] **Step 6: Say when details were removed**

In `apps/app/src/features/portal/pages/PortalReferralPage.tsx`:

1. Replace `{(shown.length > 0 || r.notes) && (` with `{(shown.length > 0 || r.notes || r.detailsRemoved) && (`.
2. Directly after `<h2 className="text-body-strong text-text-default">What you sent</h2>`, add:

```tsx
            {r.detailsRemoved && (
              <p className="text-body-md text-text-muted">Contact details for this referral were removed for privacy.</p>
            )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS (the string audit included).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/features/portal/lib/portalCsv.ts apps/app/src/features/portal/lib/portalCsv.test.ts apps/app/src/features/portal/lib/portalApi.ts apps/app/src/features/portal/lib/portalApi.test.ts apps/app/src/features/portal/pages/PortalDashboardPage.tsx apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx apps/app/src/features/portal/pages/PortalReferralPage.tsx apps/app/src/features/portal/pages/PortalReferralPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(portal): partners download their referrals as a CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Portal Profile page

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalProfilePage.tsx`
- Test: `apps/app/src/features/portal/pages/PortalProfilePage.test.tsx`
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`
- Test: `apps/app/src/features/portal/lib/portalApi.test.ts`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`
- Modify: `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`

**Interfaces:**
- Consumes: `PortalProfile`, `PortalProfileInput`, `PORTAL_PROFILE_LIMITS`, `PORTAL_PROFILE_MESSAGES`, `validateProfile`, `PortalProfileField` from `_shared/portalProfile.ts` (Task 8); `usePortalSignedIn()` (1B); `portalDataKey`, `PortalApiError`, `isPortalUnauthorized`, `isPortalTransientError`; `portalReachMessage`, `PortalRetry`.
- Produces (TS):
  - `portalApi.getProfile(slug: string, sessionToken: string): Promise<PortalProfile>` and `portalApi.updateProfile(slug: string, sessionToken: string, input: PortalProfileInput): Promise<PortalProfile>`; `portalApi.ts` re-exports `type PortalProfile` and `type PortalProfileInput`.
  - Route `/p/:slug/profile` (signed in) rendering `PortalProfilePage`; a "Profile" link (44px tall) in the signed-in top bar.
  - Query key `portalDataKey(slug, token, "profile")`. A save refreshes `["portal", "me", slug]` so the top bar shows the new name.

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/features/portal/lib/portalApi.test.ts`, inside `describe("Phase 2A actions", ...)`:

```ts
  it("reads and saves the profile with the session", async () => {
    const PROFILE = { name: "Jane", phone: null, email: "jane@example.com", weeklyDigest: true };
    fetchMock.mockResolvedValueOnce(respond(200, { profile: PROFILE }));
    await expect(portalApi.getProfile("acme", "tok")).resolves.toEqual(PROFILE);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/get_profile`);
    expect(lastCall().headers["x-portal-session"]).toBe("tok");
    expect(lastCall().body).toEqual({ slug: "acme" });

    fetchMock.mockResolvedValueOnce(respond(200, { profile: { ...PROFILE, name: "Jane Smith" } }));
    await expect(
      portalApi.updateProfile("acme", "tok", { name: "Jane Smith", phone: null, weeklyDigest: false }),
    ).resolves.toEqual({ ...PROFILE, name: "Jane Smith" });
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/update_profile`);
    expect(lastCall().body).toEqual({ slug: "acme", name: "Jane Smith", phone: null, weeklyDigest: false });

    fetchMock.mockResolvedValueOnce(respond(400, { error: "invalid_body", field: "phone" }));
    await expect(
      portalApi.updateProfile("acme", "tok", { name: "Jane", phone: "1", weeklyDigest: true }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_body", field: "phone" });
  });
```

Create `apps/app/src/features/portal/pages/PortalProfilePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  exportReferrals: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { writePortalSession } from "../lib/portalSession";
import { PORTAL_PROFILE_MESSAGES } from "../../../../../../supabase/functions/_shared/portalProfile";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const PROFILE = { name: "Jane", phone: "5550100100", email: "jane@example.com", weeklyDigest: true };

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
  api.getProfile.mockResolvedValue(PROFILE);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalProfilePage", () => {
  it("shows the partner's details; the sign-in email is shown but cannot be edited", async () => {
    renderAt("/p/acme/profile");
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
    expect(api.getProfile).toHaveBeenCalledWith("acme", "live");
    expect(screen.getByLabelText("Your name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("5550100100");
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("To change it, ask your contact at Acme ISO.")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Weekly email about my referrals" })).toBeChecked();
  });

  it("saves the trimmed name, a cleared phone and the email choice, then refreshes the top bar", async () => {
    const user = userEvent.setup();
    api.updateProfile.mockResolvedValue({ name: "Jane Smith", phone: null, email: "jane@example.com", weeklyDigest: false });
    renderAt("/p/acme/profile");
    const name = await screen.findByLabelText("Your name");
    await user.clear(name);
    await user.type(name, "  Jane Smith ");
    await user.clear(screen.getByLabelText("Phone (optional)"));
    await user.click(screen.getByRole("checkbox", { name: "Weekly email about my referrals" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.updateProfile).toHaveBeenCalledWith("acme", "live", { name: "Jane Smith", phone: null, weeklyDigest: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(screen.getByLabelText("Your name")).toHaveValue("Jane Smith");
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2));
  });

  it("checks the fields before sending anything", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/profile");
    await user.clear(await screen.findByLabelText("Your name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(PORTAL_PROFILE_MESSAGES.name)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your name"), "Jane");
    await user.clear(screen.getByLabelText("Phone (optional)"));
    await user.type(screen.getByLabelText("Phone (optional)"), "call me");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(PORTAL_PROFILE_MESSAGES.phone)).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("points at the field the server refused, and explains the hourly limit", async () => {
    const user = userEvent.setup();
    api.updateProfile
      .mockRejectedValueOnce(new PortalApiError(400, "invalid_body", "phone"))
      .mockRejectedValueOnce(new PortalApiError(429, "rate_limited"));
    renderAt("/p/acme/profile");
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(PORTAL_PROFILE_MESSAGES.phone)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Too many changes in a short time. Try again in an hour.")).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getProfile.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/profile");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
  });

  it("offers a retry when the profile can't be loaded", async () => {
    const user = userEvent.setup();
    api.getProfile.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(PROFILE);
    renderAt("/p/acme/profile");
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
  });

  it("is one tap from the top bar", async () => {
    const user = userEvent.setup();
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("link", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/portalApi.test.ts src/features/portal/pages/PortalProfilePage.test.tsx`
Expected: FAIL: `portalApi.getProfile is not a function`, and the profile route redirects to sign-in so `Your profile` is never found.

- [ ] **Step 3: Client calls**

In `apps/app/src/features/portal/lib/portalApi.ts`:

1. Directly after the `import type { PortalWindow } ...` line, add:

```ts
import type { PortalProfile, PortalProfileInput } from "../../../../../../supabase/functions/_shared/portalProfile";
```

and add `PortalProfile,` and `PortalProfileInput,` to the `export type { ... }` list.

2. In the `PortalAction` union, add `| "get_profile"` and `| "update_profile"` after `| "export_referrals"`.
3. Add to the `portalApi` object, after `exportReferrals(...)`:

```ts
  getProfile(slug: string, sessionToken: string): Promise<PortalProfile> {
    return portalRequest<{ profile: PortalProfile }>("get_profile", { slug }, sessionToken).then((r) => r.profile);
  },

  updateProfile(slug: string, sessionToken: string, input: PortalProfileInput): Promise<PortalProfile> {
    return portalRequest<{ profile: PortalProfile }>("update_profile", { slug, ...input }, sessionToken).then(
      (r) => r.profile,
    );
  },
```

- [ ] **Step 4: The page**

Create `apps/app/src/features/portal/pages/PortalProfilePage.tsx`:

```tsx
/**
 * PortalProfilePage (FR-PORT-19): the partner keeps their name and phone current
 * and chooses whether to get the weekly email. The sign-in email is their
 * identity, so it shows here but cannot be changed: their contact at the ISO
 * changes it on the partner record. Name and phone changes update the ISO's
 * partner record and show on its partner page.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import {
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalProfile,
} from "../lib/portalApi";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import {
  PORTAL_PROFILE_LIMITS,
  PORTAL_PROFILE_MESSAGES,
  validateProfile,
  type PortalProfileField,
} from "../../../../../../supabase/functions/_shared/portalProfile";

export function PortalProfilePage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const profile = useQuery({
    queryKey: portalDataKey(slug, token, "profile"),
    queryFn: () => portalApi.getProfile(slug, token),
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(profile.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  if (unauthorized || profile.isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (!profile.data) {
    return <PortalRetry name={brand.orgName} busy={profile.isFetching} onRetry={() => void profile.refetch()} />;
  }
  return <ProfileForm initial={profile.data} />;
}

function ProfileForm({ initial }: { initial: PortalProfile }) {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initial.name);
  const [phone, setPhone] = React.useState(initial.phone ?? "");
  const [digest, setDigest] = React.useState(initial.weeklyDigest);
  const [field, setField] = React.useState<PortalProfileField | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setNotice(null);
    const check = validateProfile({ name, phone, weeklyDigest: digest });
    if (!check.ok) {
      setField(check.field);
      return;
    }
    setField(null);
    setBusy(true);
    try {
      const next = await portalApi.updateProfile(slug, token, check.value);
      queryClient.setQueryData(portalDataKey(slug, token, "profile"), next);
      // The top bar shows the partner's name.
      void queryClient.invalidateQueries({ queryKey: ["portal", "me", slug] });
      setName(next.name);
      setPhone(next.phone ?? "");
      setDigest(next.weeklyDigest);
      setSaved(true);
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "invalid_body" && (err.field === "name" || err.field === "phone")) {
        setField(err.field);
      } else if (err instanceof PortalApiError && err.code === "rate_limited") {
        setNotice("Too many changes in a short time. Try again in an hour.");
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't save your changes. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

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
        <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Your profile</h1>
            <p className="text-body-md text-text-muted">{brand.orgName} uses these details to reach you about your referrals.</p>
          </div>

          <FormField
            label="Your name"
            htmlFor="portal-profile-name"
            error={field === "name" ? PORTAL_PROFILE_MESSAGES.name : undefined}
          >
            <Input
              id="portal-profile-name"
              autoComplete="name"
              maxLength={PORTAL_PROFILE_LIMITS.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="Phone (optional)"
            htmlFor="portal-profile-phone"
            error={field === "phone" ? PORTAL_PROFILE_MESSAGES.phone : undefined}
          >
            <Input
              id="portal-profile-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={PORTAL_PROFILE_LIMITS.phone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>

          <div className="flex flex-col gap-1">
            <span className="text-label text-text-default">Sign-in email</span>
            <span className="break-all text-body-md text-text-default">{initial.email}</span>
            <span className="text-caption text-text-muted">To change it, ask your contact at {brand.orgName}.</span>
          </div>

          <Checkbox
            id="portal-profile-digest"
            checked={digest}
            onCheckedChange={setDigest}
            label="Weekly email about my referrals"
            helper="A short summary once a week. You can turn it off any time."
          />

          {notice && (
            <p role="alert" className="text-body-sm text-status-danger">
              {notice}
            </p>
          )}
          {saved && (
            <p role="status" className="text-body-sm text-text-muted">
              Saved.
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
            Save changes
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Route and top-bar link**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`:

1. Add `import { PortalProfilePage } from "./PortalProfilePage";` after `import { PortalReferralPage } from "./PortalReferralPage";`.
2. Add `<Route path="profile" element={<PortalProfilePage />} />` directly after `<Route path="r/:referralId" element={<PortalReferralPage />} />`.

In `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`:

1. Replace `import { Navigate, Outlet, useNavigate } from "react-router-dom";` with `import { Link, Navigate, Outlet, useNavigate } from "react-router-dom";`.
2. Replace `import { Loader2, LogOut } from "lucide-react";` with `import { Loader2, LogOut, User } from "lucide-react";`.
3. Replace the Sign out `<Button ...>Sign out</Button>` element (the whole element, from `<Button` to `</Button>`) with:

```tsx
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to={`/p/${slug}/profile`}
            className="inline-flex min-h-11 items-center gap-1 rounded-radius-sm px-2 text-body-sm font-medium text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <User className="h-4 w-4" aria-hidden />
            Profile
          </Link>
          <Button
            variant="tertiary"
            size="lg"
            leadingIcon={LogOut}
            loading={signingOut}
            onClick={() => void signOut()}
            className="shrink-0"
          >
            Sign out
          </Button>
        </div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal`
Expected: PASS (every portal page test, the profile page and the string audit).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/portal/lib/portalApi.ts apps/app/src/features/portal/lib/portalApi.test.ts apps/app/src/features/portal/pages/PortalProfilePage.tsx apps/app/src/features/portal/pages/PortalProfilePage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx apps/app/src/features/portal/components/PortalSignedInLayout.tsx
git commit -m "$(cat <<'EOF'
feat(portal): Profile page for name, phone and the weekly email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: String audit covers ICP flags, purged rows, the CSV and the profile

**Files:**
- Modify: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: `handlePortalRequest` (Task 8 actions), `buildReferralsCsv` (Task 10), `PortalRoot` with the profile route (Task 11).
- Produces: assertions only. No partner response, rendered portal page, or CSV carries `icp_flags`, a `chain:` flag, erased personal details, an internal status, a decline reason, or the word navigatr on screen.

- [ ] **Step 1: Extend the audit**

In `apps/app/src/features/portal/portalStringAudit.test.tsx`:

1. Add to the `vi.hoisted` `api` object, after `transcribe: vi.fn(),`:

```ts
  exportReferrals: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
```

2. After the `import { POWERED_BY, renderEmail } ...` line, add:

```ts
import { buildReferralsCsv } from "./lib/portalCsv";
```

3. Replace the `FORBIDDEN_KEYS` line with:

```ts
const FORBIDDEN_KEYS = [
  "status", "stage", "source", "decline_reason", "declineReason", "decline_note", "declineNote", "icp_flags", "icpFlags",
];
// Erased personal details a purged row might still carry: never passed through.
const PURGED_SECRET = "PURGED-PERSONAL";
```

4. In `auditJson`, add as its last line:

```ts
  expect(JSON.stringify(body)).not.toContain("chain:");
```

5. In the `hostile` object, add `icp_flags: ["chain:Subway"],`.

6. Replace

```ts
  function deps(status: string, source = "portal_signed_in"): PortalApiDeps {
    const repTyped = source === "rep_entered";
```

with

```ts
  function deps(status: string, source = "portal_signed_in", purged = false): PortalApiDeps {
    const repTyped = source === "rep_entered";
    const personal = (value: string) => (purged ? `${PURGED_SECRET} ${value}` : value);
```

7. In the `case "portal_get_referral":` row, replace the four lines

```ts
              contact_name: repTyped ? `${REP_SECRET} contact` : "Ann",
              contact_email: repTyped ? "rep-secret@internal.example" : "ann@fresh.example",
              contact_phone: "5550100100",
              address: repTyped ? `${REP_SECRET} address` : "5 Oak St",
```

with

```ts
              contact_name: repTyped ? `${REP_SECRET} contact` : personal("Ann"),
              contact_email: repTyped ? "rep-secret@internal.example" : personal("ann@fresh.example"),
              contact_phone: personal("5550100100"),
              address: repTyped ? `${REP_SECRET} address` : personal("5 Oak St"),
```

replace `notes: repTyped ? REP_SECRET : "Wants a demo",` with `notes: repTyped ? REP_SECRET : personal("Wants a demo"),`, and add `details_removed: purged,` directly after `can_withdraw: status === "submitted",`.

8. Directly before `default:` in that `switch (name)`, add:

```ts
        case "portal_export_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              ref: `REF-0000000${i}`,
              company_name: "Fresh Bakery",
              status: s,
              submitted_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              won_value_cents: 123456,
              value_visible: false,
              ...hostile,
            })),
            error: null,
          };
        case "portal_get_profile":
          return {
            data: [{ name: "Jane", phone: "5550100100", email: "j@x.co", weekly_digest: true, ...hostile }],
            error: null,
          };
```

9. Replace the `call` helper's signature and its `deps(...)` argument:

```ts
  async function call(action: string, body: Record<string, unknown>, status: string, source?: string, purged = false) {
```

and, inside it, `deps(status, source),` becomes `deps(status, source, purged),`.

10. Inside `describe("portal_api responses", ...)`, after the `leaks nothing internal in the list or the dashboard` test, add:

```ts
  it.each(INTERNAL_STATUSES)("never passes erased details through for a purged referral that is %s", async (status) => {
    const body = await call("get_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status, "portal_signed_in", true);
    auditJson(body);
    expect(JSON.stringify(body)).not.toContain(PURGED_SECRET);
    expect(body.referral).toMatchObject({ detailsRemoved: true, contactName: null, contactEmail: null, contactPhone: null, address: null, notes: null });
  });

  it("export leaks nothing internal, and the CSV built from it carries no internal token", async () => {
    const body = await call("export_referrals", {}, "submitted");
    auditJson(body);
    expect(body.export.rows).toHaveLength(INTERNAL_STATUSES.length);
    expect(body.export.valueVisible).toBe(false);
    expect(JSON.stringify(body)).not.toContain("123456");
    const csv = buildReferralsCsv(body.export);
    expect(csv.match(FORBIDDEN_WORDS)).toBeNull();
    expect(csv).not.toContain(SECRET);
    expect(csv).not.toContain(OTHER_PARTNER);
    expect(csv).not.toContain("chain:");
    expect(csv).not.toMatch(/navigatr/i);
  });

  it("profile leaks nothing beyond the four profile fields", async () => {
    const body = await call("get_profile", {}, "submitted");
    auditJson(body);
    expect(Object.keys(body.profile).sort()).toEqual(["email", "name", "phone", "weeklyDigest"]);
  });
```

11. Inside `describe("rendered portal pages: UI copy audit", ...)`, after the last test, add:

```ts
  it("profile page", async () => {
    api.getProfile.mockResolvedValue({ name: "Jane", phone: null, email: "jane@example.com", weeklyDigest: true });
    renderAt("/p/acme/profile");
    await screen.findByRole("heading", { name: "Your profile" });
    expectCleanScreen();
  });

  it("detail page after the contact details were removed", async () => {
    api.getReferral.mockResolvedValue({
      id: "r-1",
      ref: "REF-AAAA0001",
      companyName: "Fresh Bakery",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
      industry: "restaurant",
      urgency: null,
      notes: null,
      label: "Not Moving Forward",
      submittedAt: "2026-06-01T12:00:00Z",
      canWithdraw: false,
      detailsRemoved: true,
      rep: null,
      history: [{ label: "Received", at: "2026-06-01T12:00:00Z" }, { label: "Not Moving Forward", at: "2026-06-02T12:00:00Z" }],
      updates: [],
    });
    renderAt("/p/acme/r/r-1");
    await screen.findByText("Contact details for this referral were removed for privacy.");
    expectCleanScreen();
  });
```

- [ ] **Step 2: Run the audit**

Run: `pnpm --filter app test -- src/features/portal/portalStringAudit.test.tsx`
Expected: PASS. (Tasks 8, 10 and 11 already made it pass; if any new case fails, fix the production code it names, never the audit.)

- [ ] **Step 3: Prove the audit bites**

Temporarily change `contactName: personal ? strOrNull(row.contact_name) : null,` in `supabase/functions/_shared/portalReferralApi.ts` to `contactName: typed ? strOrNull(row.contact_name) : null,` and run the same command.
Expected: FAIL in `never passes erased details through for a purged referral`. Revert the change (`git checkout supabase/functions/_shared/portalReferralApi.ts`) and run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "$(cat <<'EOF'
test(portal): string audit covers ICP flags, purged rows, the CSV and the profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Review sheet: chain advisory and Reassign (rep app)

**Files:**
- Create: `apps/app/src/features/partners/hooks/useReassignReferral.ts`
- Test: `apps/app/src/features/partners/hooks/useReassignReferral.test.tsx`
- Modify: `apps/app/src/features/partners/lib/referrals.ts`
- Test: `apps/app/src/features/partners/lib/referrals.test.ts`
- Modify: `apps/app/src/features/partners/hooks/useReferralQueue.ts`
- Test: `apps/app/src/features/partners/hooks/useReferralQueue.test.tsx`
- Modify: `apps/app/src/features/partners/components/ReviewReferralSheet.tsx`
- Test: `apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx`

**Interfaces:**
- Consumes (SQL): `list_referral_assignees()`, `can_user_see_partner(p_user_id, p_partner_id)` (Task 6), `reassign_referral(p_referral_id, p_user_id) returns boolean` (Phase 0), `referrals.icp_flags` (Task 4). `useProfile()` returns `{ data: Profile | null }` with `role` and `role_level`.
- Produces (TS):
  - `hooks/useReassignReferral.ts`: `export interface ReferralAssignee { id: string; name: string }`; `export const REFERRAL_ASSIGNEES_QUERY_KEY: (userId?: string) => readonly ["referrals", "assignees", string]`; `export function useReferralAssignees(enabled: boolean)` (query of `ReferralAssignee[]`); `export function useAssigneeSeesPartner(userId: string | null, partnerId: string | null)` (query of `boolean`, disabled until both are set); `export function useReassignReferral()` (mutation `{ referralId: string; userId: string } => Promise<boolean>`, invalidates `["referrals"]`, errors through `referralErrorMessage`).
  - `lib/referrals.ts`: `export function canReassignReferrals(profile: { role?: string | null; role_level?: string | null } | null | undefined): boolean` (manager or admin role, or administrator level: the `reassign_referral` gate); `export function icpFlagLabels(flags: readonly string[] | null | undefined): string[]` (`chain:<Brand>` becomes `Looks like a chain: <Brand>`, anything else is dropped); error token `referral_not_reinstatable` ("This referral can't be reinstated now.").
  - `QueueReferral.icpFlags?: string[]` (from `icp_flags`, `[]` when absent).
  - `ReviewReferralSheet`: one advisory line per flag (never blocks); a "Reassign" action for managers and administrators with a teammate picker, a warning before confirming when the pick cannot see the partner, and "Reassign referral".

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/hooks/useReassignReferral.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import { useAssigneeSeesPartner, useReassignReferral, useReferralAssignees } from "./useReassignReferral";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("useReferralAssignees", () => {
  it("lists who can take a referral, by name or email", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { user_id: "u-2", full_name: "Rob Rep", email: "rob@acme.example" },
        { user_id: "u-3", full_name: null, email: "dee@acme.example" },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralAssignees(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("list_referral_assignees");
    expect(result.current.data).toEqual([
      { id: "u-2", name: "Rob Rep" },
      { id: "u-3", name: "dee@acme.example" },
    ]);
  });

  it("does not ask when disabled (reps never reassign)", () => {
    const { wrapper } = setup();
    renderHook(() => useReferralAssignees(false), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useAssigneeSeesPartner", () => {
  it("checks whether the new owner can see the partner", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAssigneeSeesPartner("u-2", "p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("can_user_see_partner", { p_user_id: "u-2", p_partner_id: "p-1" });
    expect(result.current.data).toBe(false);
  });

  it("waits until both ids are known", () => {
    const { wrapper } = setup();
    renderHook(() => useAssigneeSeesPartner(null, "p-1"), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useReassignReferral", () => {
  it("reassigns and refreshes every referrals query", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReassignReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", userId: "u-2" })).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("reassign_referral", { p_referral_id: "r-1", p_user_id: "u-2" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("turns a refusal into plain words", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "assignee_invalid" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReassignReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", userId: "u-9" })).rejects.toThrow(
      "That teammate can't take this referral.",
    );
  });
});
```

Append to `apps/app/src/features/partners/lib/referrals.test.ts` (and add `canReassignReferrals, icpFlagLabels,` to its import list from `./referrals`):

```ts
describe("canReassignReferrals", () => {
  it("matches the reassign_referral gate: manager or admin role, or administrator level", () => {
    expect(canReassignReferrals({ role: "manager", role_level: "sales_manager" })).toBe(true);
    expect(canReassignReferrals({ role: "admin", role_level: "administrator" })).toBe(true);
    expect(canReassignReferrals({ role: "rep", role_level: "administrator" })).toBe(true);
    expect(canReassignReferrals({ role: "rep", role_level: "sales_professional" })).toBe(false);
    expect(canReassignReferrals(null)).toBe(false);
    expect(canReassignReferrals(undefined)).toBe(false);
  });
});

describe("icpFlagLabels", () => {
  it("turns chain flags into advisory lines and drops anything else", () => {
    expect(icpFlagLabels(["chain:Subway", "chain:  ", "mystery:x", "chain:Starbucks"])).toEqual([
      "Looks like a chain: Subway",
      "Looks like a chain: Starbucks",
    ]);
    expect(icpFlagLabels(null)).toEqual([]);
    expect(icpFlagLabels(undefined)).toEqual([]);
  });
});

describe("referralErrorMessage (Phase 2A)", () => {
  it("explains a refused reinstate", () => {
    expect(referralErrorMessage({ message: "referral_not_reinstatable" }, "fallback")).toBe(
      "This referral can't be reinstated now.",
    );
  });
});
```

In `apps/app/src/features/partners/hooks/useReferralQueue.test.tsx`:

1. In the first test's expected object (`loads submitted inbound referrals oldest first and maps them`), add `icpFlags: [],` after `urgency: null,`.
2. Append inside `describe("useReferralQueue", ...)`:

```tsx
  it("carries the advisory ICP flags", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-4", partner_id: "p-1", company_name: "Subway #12", contact_name: "Ann",
        contact_email: null, contact_phone: "5550100001", address: null, place_id: null,
        notes: "", submitted_at: "2026-10-12T12:00:00Z", assigned_user_id: "user-1",
        icp_flags: ["chain:Subway"],
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(selectMock.mock.calls[0][0]).toContain("icp_flags");
    expect(result.current.data?.[0].icpFlags).toEqual(["chain:Subway"]);
  });
```

In `apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx`:

1. Directly after the `vi.mock("@/features/pipeline/hooks/useDeals", ...)` block, add:

```tsx
const profileState: { data: { role: string; role_level: string } | null } = {
  data: { role: "rep", role_level: "sales_professional" },
};
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => profileState }));
const reassignMutate = vi.fn();
const assigneesState: { data: Array<{ id: string; name: string }> | undefined } = { data: undefined };
const seesState: { data: boolean | undefined; isError: boolean; isFetching: boolean } = {
  data: true,
  isError: false,
  isFetching: false,
};
const seesArgs: unknown[][] = [];
vi.mock("../hooks/useReassignReferral", () => ({
  useReferralAssignees: () => assigneesState,
  useAssigneeSeesPartner: (...a: unknown[]) => {
    seesArgs.push(a);
    return seesState;
  },
  useReassignReferral: () => ({ mutateAsync: reassignMutate, isPending: false }),
}));
```

2. In `beforeEach`, add:

```tsx
  profileState.data = { role: "rep", role_level: "sales_professional" };
  assigneesState.data = [
    { id: "user-1", name: "Rita Rep" },
    { id: "user-2", name: "Rob Rep" },
    { id: "user-3", name: "Mia Mgr" },
  ];
  seesState.data = true;
  seesState.isError = false;
  seesState.isFetching = false;
  seesArgs.length = 0;
  reassignMutate.mockReset();
```

3. Append at the end of the file:

```tsx
describe("ReviewReferralSheet: chain advisory and reassign", () => {
  it("shows an advisory chain line, ignores unknown flags, and still allows accept", () => {
    render(<ReviewReferralSheet referral={{ ...referral, icpFlags: ["chain:Subway", "mystery:x"] }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Looks like a chain: Subway. Check before accepting.")).toBeInTheDocument();
    expect(screen.queryByText(/mystery/)).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("offers no Reassign to a rep", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  });

  it("lets a manager reassign to a teammate who can see the partner", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignMutate.mockResolvedValueOnce(true);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByText("Now with Rita Rep.")).toBeInTheDocument();
    const labels = screen.getAllByRole("option").map((o) => o.textContent).filter((l) => l !== "--");
    expect(labels).toEqual(["Rob Rep", "Mia Mgr"]);
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    expect(seesArgs.at(-1)).toEqual(["user-2", "p-1"]);
    expect(screen.queryByText(/can't see/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    expect(reassignMutate).toHaveBeenCalledWith({ referralId: "r-1", userId: "user-2" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Reassigned to Rob Rep");
  });

  it("warns before confirming when the new owner cannot see the partner", async () => {
    profileState.data = { role: "admin", role_level: "administrator" };
    seesState.data = false;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    expect(screen.getByText("Rob Rep can't see Jane's partner record. They will still see this referral.")).toBeInTheDocument();
    expect(reassignMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeEnabled();
  });

  it("waits for the check before allowing the reassign", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    seesState.data = undefined;
    seesState.isFetching = true;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-3");
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeDisabled();
  });

  it("still allows the reassign when partner access could not be checked", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    seesState.data = undefined;
    seesState.isError = true;
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-3");
    expect(screen.getByText("Couldn't check partner access. You can still reassign.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reassign referral" })).toBeEnabled();
  });

  it("toasts and stays open when the reassign is refused", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignMutate.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.selectOptions(screen.getByLabelText("Pick a teammate…"), "user-2");
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReassignReferral.test.tsx src/features/partners/lib/referrals.test.ts src/features/partners/hooks/useReferralQueue.test.tsx src/features/partners/components/ReviewReferralSheet.test.tsx`
Expected: FAIL: `Failed to resolve import "./useReassignReferral"`, `canReassignReferrals is not a function`, `icpFlags` missing, no "Reassign" button.

- [ ] **Step 3: Vocabulary helpers**

In `apps/app/src/features/partners/lib/referrals.ts`:

1. In `ERROR_COPY`, directly before `["not_authorized", "You don't have access to do that."],`, add:

```ts
  ["referral_not_reinstatable", "This referral can't be reinstated now."],
```

2. Append at the end of the file:

```ts
/**
 * Who may reassign a referral: the same gate as reassign_referral (a manager or
 * admin role, or the administrator level). The server re-checks; this only
 * decides whether to show the action.
 */
export function canReassignReferrals(
  profile: { role?: string | null; role_level?: string | null } | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role === "manager" || profile.role === "admin" || profile.role_level === "administrator";
}

/** Advisory ICP lines for triage (FR-PORT-58). Unknown flags are dropped. */
export function icpFlagLabels(flags: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const flag of flags ?? []) {
    if (!flag.startsWith("chain:")) continue;
    const brand = flag.slice("chain:".length).trim();
    if (brand) out.push(`Looks like a chain: ${brand}`);
  }
  return out;
}
```

- [ ] **Step 4: The queue carries the flags**

In `apps/app/src/features/partners/hooks/useReferralQueue.ts`:

1. In `QueueReferral`, after `urgency?: string | null;`, add:

```ts
  /** Advisory ICP flags set at submission, e.g. "chain:Subway" (FR-PORT-58). Never block triage. */
  icpFlags?: string[];
```

2. In `QueueRow`, after `urgency?: string | null;`, add `icp_flags?: string[] | null;`.
3. Replace `"source, duplicate_of_referral_id, duplicate_of_deal_id, urgency, " +` with `"source, duplicate_of_referral_id, duplicate_of_deal_id, urgency, icp_flags, " +`.
4. In the mapping, after `urgency: r.urgency ?? null,`, add `icpFlags: r.icp_flags ?? [],`.

- [ ] **Step 5: The reassign hooks**

Create `apps/app/src/features/partners/hooks/useReassignReferral.ts`:

```ts
/**
 * Reassigning a referral (FR-PORT-55). Managers and administrators pick a
 * teammate they can see (list_referral_assignees), are warned before confirming
 * when that teammate cannot see the partner (can_user_see_partner), then
 * reassign_referral moves it. Only assigned_user_id changes, which is what
 * routes every later email.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { referralErrorMessage } from "../lib/referrals";

export interface ReferralAssignee {
  id: string;
  name: string;
}

interface AssigneeRow {
  user_id: string;
  full_name: string | null;
  email: string;
}

export const REFERRAL_ASSIGNEES_QUERY_KEY = (userId?: string) => ["referrals", "assignees", userId ?? "anon"] as const;

export function useReferralAssignees(enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_ASSIGNEES_QUERY_KEY(userId),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReferralAssignee[]> => {
      const { data, error } = await supabase.rpc("list_referral_assignees");
      if (error) throw error;
      return ((data ?? []) as AssigneeRow[]).map((r) => ({ id: r.user_id, name: r.full_name?.trim() || r.email }));
    },
    staleTime: 5 * 60_000,
  });
}

export function useAssigneeSeesPartner(userId: string | null, partnerId: string | null) {
  return useQuery({
    queryKey: ["referrals", "assignee-sees-partner", userId ?? "none", partnerId ?? "none"] as const,
    enabled: Boolean(userId && partnerId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("can_user_see_partner", {
        p_user_id: userId,
        p_partner_id: partnerId,
      });
      if (error) throw error;
      return data === true;
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useReassignReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { referralId: string; userId: string }): Promise<boolean> => {
      const { data, error } = await supabase.rpc("reassign_referral", {
        p_referral_id: input.referralId,
        p_user_id: input.userId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reassign the referral"));
      return data === true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
```

- [ ] **Step 6: The sheet**

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
 * the referral's history (FR-PORT-47). Merge stays available. The urgency the
 * partner picked shows with the details.
 *
 * Phase 2A: a business that looks like a chain gets an advisory line
 * (FR-PORT-58); it never blocks anything. Managers and administrators can
 * reassign the referral to a teammate they can see, and are warned BEFORE
 * confirming when that teammate cannot see the partner (FR-PORT-55).
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePlaceDuplicateCheck } from "@/features/pipeline/hooks/usePlaceDuplicateCheck";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import type { QueueReferral } from "../hooks/useReferralQueue";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { useAssigneeSeesPartner, useReassignReferral, useReferralAssignees } from "../hooks/useReassignReferral";
import { DECLINE_REASON_OPTIONS, canReassignReferrals, icpFlagLabels, type DeclineReason } from "../lib/referrals";
import { urgencyLabel } from "../../../../../../supabase/functions/_shared/portalSubmission";

type Mode = "main" | "decline" | "merge" | "override" | "reassign";

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
  const reassign = useReassignReferral();
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const { data: deals = [] } = useDeals();
  const profile = useProfile();
  const canReassign = canReassignReferrals(profile.data);
  const assignees = useReferralAssignees(open && canReassign);

  const [mode, setMode] = React.useState<Mode>("main");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [dupName, setDupName] = React.useState<string | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");

  const referralId = referral?.id;
  const flagged = isFlagged(referral);
  const seesPartner = useAssigneeSeesPartner(
    mode === "reassign" && assigneeId ? assigneeId : null,
    referral?.partnerId ?? null,
  );

  React.useEffect(() => {
    setMode("main");
    setReason(isFlagged(referral) ? "duplicate" : "");
    setNote("");
    setMergeDealId("");
    setDupName(null);
    setOverrideReason("");
    setAssigneeId("");
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

  const currentAssigneeId = referral?.assignedUserId ?? null;
  const assigneeOptions = React.useMemo(
    () => (assignees.data ?? [])
      .filter((a) => a.id !== currentAssigneeId)
      .map((a) => ({ value: a.id, label: a.name })),
    [assignees.data, currentAssigneeId],
  );

  if (!referral) return null;

  const currentOwner = (assignees.data ?? []).find((a) => a.id === referral.assignedUserId)?.name ?? null;
  const pickedName = (assignees.data ?? []).find((a) => a.id === assigneeId)?.name ?? "";
  const flags = icpFlagLabels(referral.icpFlags);

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

  const onReassign = () => run(async () => {
    if (!assigneeId) return;
    await reassign.mutateAsync({ referralId: referral.id, userId: assigneeId });
    toast.success(`Reassigned to ${pickedName}`);
    onOpenChange(false);
  });

  const submitted = new Date(referral.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const details: Array<[string, string | null]> = [
    ["Contact", referral.contactName],
    ["Phone", referral.contactPhone],
    ["Email", referral.contactEmail],
    ["Address", referral.address],
    ["Urgency", urgencyLabel(referral.urgency ?? null)],
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

          {flags.map((f) => (
            <p key={f} className="rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-muted">
              {f}. Check before accepting.
            </p>
          ))}

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
              {canReassign && (
                <Button variant="tertiary" disabled={accept.isPending} onClick={() => setMode("reassign")}>
                  Reassign
                </Button>
              )}
            </div>
          )}

          {mode === "override" && (
            <div className="flex flex-col gap-3">
              <p className="text-body-sm text-text-muted">
                Say why you are accepting a possible duplicate. The reason is saved in the referral's history.
              </p>
              <NotesFieldWithMic
                value={overrideReason}
                onChange={setOverrideReason}
                placeholder="Why accept it anyway?"
                maxLength={500}
              />
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

          {mode === "reassign" && (
            <div className="flex flex-col gap-3">
              {currentOwner && <p className="text-body-sm text-text-muted">Now with {currentOwner}.</p>}
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">New owner</span>
                <Select
                  value={assigneeId}
                  onValueChange={setAssigneeId}
                  placeholder="Pick a teammate…"
                  options={assigneeOptions}
                />
              </label>
              {assigneeId && seesPartner.data === false && (
                <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
                  {pickedName} can't see {referral.partnerName}'s partner record. They will still see this referral.
                </p>
              )}
              {assigneeId && seesPartner.isError && (
                <p className="text-body-sm text-text-muted">Couldn't check partner access. You can still reassign.</p>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!assigneeId || seesPartner.isFetching || reassign.isPending}
                  loading={reassign.isPending}
                  onClick={onReassign}
                >
                  Reassign referral
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

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS (the existing sheet, queue card and mutation tests included).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReassignReferral.ts apps/app/src/features/partners/hooks/useReassignReferral.test.tsx apps/app/src/features/partners/lib/referrals.ts apps/app/src/features/partners/lib/referrals.test.ts apps/app/src/features/partners/hooks/useReferralQueue.ts apps/app/src/features/partners/hooks/useReferralQueue.test.tsx apps/app/src/features/partners/components/ReviewReferralSheet.tsx apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(referrals): reassign from the review sheet; advisory chain line at triage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Partner Detail: reinstate card, partner's own edits, erase portal data (rep app)

**Files:**
- Create: `apps/app/src/features/partners/hooks/useReinstateReferral.ts`
- Test: `apps/app/src/features/partners/hooks/useReinstateReferral.test.tsx`
- Create: `apps/app/src/features/partners/hooks/usePartnerProfileChanges.ts`
- Test: `apps/app/src/features/partners/hooks/usePartnerProfileChanges.test.tsx`
- Create: `apps/app/src/features/partners/components/ReinstatableReferralsCard.tsx`
- Test: `apps/app/src/features/partners/components/ReinstatableReferralsCard.test.tsx`
- Create: `apps/app/src/features/partners/components/PartnerProfileChanges.tsx`
- Test: `apps/app/src/features/partners/components/PartnerProfileChanges.test.tsx`
- Create: `apps/app/src/features/partners/components/PortalEraseData.tsx`
- Test: `apps/app/src/features/partners/components/PortalEraseData.test.tsx`
- Modify: `apps/app/src/features/partners/hooks/usePortalAccess.ts`
- Test: `apps/app/src/features/partners/hooks/usePortalAccess.test.tsx`
- Modify: `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`
- Test: `apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx`

**Interfaces:**
- Consumes (SQL): `referrals.can_reinstate` computed field and `reinstate_referral(p_referral_id)` (Task 5); table `partner_profile_changes` (Task 7); `portal_purge_user(p_partner_id)` (Task 2). TS: `referralErrorMessage`, `portalAccessErrorMessage`, `usePartnerPortalUser`, `PARTNER_PORTAL_USER_QUERY_KEY`, `useProfile`.
- Produces (TS):
  - `hooks/useReinstateReferral.ts`: `export interface ReinstatableReferral { id: string; companyName: string; submittedAt: string }`; `export const REINSTATABLE_REFERRALS_QUERY_KEY: (partnerId?: string) => readonly ["referrals", "reinstatable", string]`; `export function useReinstatableReferrals(partnerId: string | undefined)`; `export function useReinstateReferral()` (mutation `(referralId: string) => Promise<void>`, invalidates `["referrals"]`).
  - `hooks/usePartnerProfileChanges.ts`: `export interface PartnerProfileChange { id: string; field: "name" | "phone"; oldValue: string | null; newValue: string | null; changedAt: string }`; `export function usePartnerProfileChanges(partnerId: string | undefined)` (latest 3, newest first).
  - `hooks/usePortalAccess.ts`: `export function usePurgePortalUser()` (mutation `(partnerId: string) => Promise<void>`, refreshes `PARTNER_PORTAL_USER_QUERY_KEY(partnerId)`).
  - Components: `ReinstatableReferralsCard({ partnerId })` (hidden when none), `PartnerProfileChanges({ partnerId })` plus `describeProfileChange(change: PartnerProfileChange): string` (hidden when none), `PortalEraseData({ partnerId, partnerName })` (administrators only, only when the partner has a portal user).
  - Partner Detail mounts the two contact-card pieces under the portal line and the reinstate card under "Referrals to review".

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/hooks/useReinstateReferral.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const orderMock = vi.fn();
const rpcMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return orderMock(); },
      };
      return chain;
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

import { useReinstatableReferrals, useReinstateReferral } from "./useReinstateReferral";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  orderMock.mockReset();
  rpcMock.mockReset();
  calls.length = 0;
});

describe("useReinstatableReferrals", () => {
  it("reads this partner's declined duplicates that can come back, oldest first", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{ id: "r-1", company_name: "Dup One", submitted_at: "2026-10-10T12:00:00Z" }],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReinstatableReferrals("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "r-1", companyName: "Dup One", submittedAt: "2026-10-10T12:00:00Z" }]);
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "id, company_name, submitted_at"],
      ["eq", "partner_id", "p-1"],
      ["eq", "status", "declined"],
      ["eq", "can_reinstate", true],
      ["order", "submitted_at", { ascending: true }],
    ]);
  });

  it("does not query without a partner", () => {
    const { wrapper } = setup();
    renderHook(() => useReinstatableReferrals(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});

describe("useReinstateReferral", () => {
  it("reinstates and refreshes every referrals query", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReinstateReferral(), { wrapper });
    await result.current.mutateAsync("r-1");
    expect(rpcMock).toHaveBeenCalledWith("reinstate_referral", { p_referral_id: "r-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("turns a refusal into plain words", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_reinstatable" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReinstateReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral can't be reinstated now.");
  });
});
```

Create `apps/app/src/features/partners/hooks/usePartnerProfileChanges.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const limitMock = vi.fn();
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
  },
}));

import { usePartnerProfileChanges } from "./usePartnerProfileChanges";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  limitMock.mockReset();
  calls.length = 0;
});

describe("usePartnerProfileChanges", () => {
  it("reads the latest three changes the partner made, newest first", async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        { id: "c-2", field: "phone", old_value: "5550100100", new_value: null, changed_at: "2026-10-16T12:00:00Z" },
        { id: "c-1", field: "name", old_value: "Jane CPA", new_value: "Jane Smith", changed_at: "2026-10-15T12:00:00Z" },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerProfileChanges("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "c-2", field: "phone", oldValue: "5550100100", newValue: null, changedAt: "2026-10-16T12:00:00Z" },
      { id: "c-1", field: "name", oldValue: "Jane CPA", newValue: "Jane Smith", changedAt: "2026-10-15T12:00:00Z" },
    ]);
    expect(calls).toEqual([
      ["from", "partner_profile_changes"],
      ["select", "id, field, old_value, new_value, changed_at"],
      ["eq", "partner_id", "p-1"],
      ["order", "changed_at", { ascending: false }],
      ["limit", 3],
    ]);
  });

  it("does not query without a partner", () => {
    renderHook(() => usePartnerProfileChanges(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});
```

Create `apps/app/src/features/partners/components/ReinstatableReferralsCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state: { data: Array<{ id: string; companyName: string; submittedAt: string }> | undefined } = { data: undefined };
const reinstate = vi.fn();
vi.mock("../hooks/useReinstateReferral", () => ({
  useReinstatableReferrals: () => state,
  useReinstateReferral: () => ({ mutateAsync: reinstate, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ReinstatableReferralsCard } from "./ReinstatableReferralsCard";

beforeEach(() => {
  state.data = [
    { id: "r-1", companyName: "Dup One", submittedAt: "2026-10-10T12:00:00Z" },
    { id: "r-2", companyName: "Dup Two", submittedAt: "2026-10-11T12:00:00Z" },
  ];
  reinstate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ReinstatableReferralsCard", () => {
  it("is hidden when nothing can be reinstated", () => {
    state.data = [];
    const { container } = render(<ReinstatableReferralsCard partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the declined duplicates and reinstates one", async () => {
    reinstate.mockResolvedValueOnce(undefined);
    render(<ReinstatableReferralsCard partnerId="p-1" />);
    expect(screen.getByRole("heading", { name: "Declined duplicates you can reinstate" })).toBeInTheDocument();
    expect(screen.getByText("The earlier referral for each of these is now closed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reinstate Dup One" }));
    expect(reinstate).toHaveBeenCalledWith("r-1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reinstated. It's back in Referrals to review."));
  });

  it("says why when the reinstate is refused", async () => {
    reinstate.mockRejectedValueOnce(new Error("This referral can't be reinstated now."));
    render(<ReinstatableReferralsCard partnerId="p-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reinstate Dup Two" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This referral can't be reinstated now."));
  });
});
```

Create `apps/app/src/features/partners/components/PartnerProfileChanges.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PartnerProfileChange } from "../hooks/usePartnerProfileChanges";

const state: { data: PartnerProfileChange[] | undefined } = { data: undefined };
vi.mock("../hooks/usePartnerProfileChanges", () => ({ usePartnerProfileChanges: () => state }));

import { PartnerProfileChanges, describeProfileChange } from "./PartnerProfileChanges";

beforeEach(() => {
  state.data = undefined;
});

describe("describeProfileChange", () => {
  it("says what the partner changed in the portal", () => {
    const base = { id: "c", oldValue: null, changedAt: "2026-10-16T12:00:00Z" };
    expect(describeProfileChange({ ...base, field: "name", newValue: "Jane Smith" })).toBe(
      "Partner changed their name to Jane Smith in the portal",
    );
    expect(describeProfileChange({ ...base, field: "phone", newValue: "(555) 010-0100" })).toBe(
      "Partner changed their phone to (555) 010-0100 in the portal",
    );
    expect(describeProfileChange({ ...base, field: "phone", newValue: null })).toBe("Partner removed their phone in the portal");
  });
});

describe("PartnerProfileChanges", () => {
  it("is hidden when the partner changed nothing", () => {
    state.data = [];
    const { container } = render(<PartnerProfileChanges partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the latest changes with their dates", () => {
    state.data = [
      { id: "c-1", field: "name", oldValue: "Jane CPA", newValue: "Jane Smith", changedAt: "2026-10-16T12:00:00Z" },
    ];
    render(<PartnerProfileChanges partnerId="p-1" />);
    expect(screen.getByText("Partner changed their name to Jane Smith in the portal · Oct 16")).toBeInTheDocument();
  });
});
```

Create `apps/app/src/features/partners/components/PortalEraseData.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state: {
  profile: { data: { role_level: string } | null };
  user: { data: { status: string } | null };
} = { profile: { data: { role_level: "administrator" } }, user: { data: { status: "revoked" } } };
const purge = vi.fn();
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => state.profile }));
vi.mock("../hooks/usePortalAccess", () => ({
  usePartnerPortalUser: () => state.user,
  usePurgePortalUser: () => ({ mutateAsync: purge, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { PortalEraseData } from "./PortalEraseData";

beforeEach(() => {
  state.profile = { data: { role_level: "administrator" } };
  state.user = { data: { status: "revoked" } };
  purge.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("PortalEraseData", () => {
  it("is for administrators only", () => {
    state.profile = { data: { role_level: "sales_manager" } };
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    expect(screen.queryByRole("button", { name: "Erase portal data" })).toBeNull();
  });

  it("is hidden when the partner never had portal access", () => {
    state.user = { data: null };
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    expect(screen.queryByRole("button", { name: "Erase portal data" })).toBeNull();
  });

  it("erases only after Confirm, and says what happens", async () => {
    purge.mockResolvedValueOnce(undefined);
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    expect(
      screen.getByText(
        "Erase Jane's portal sign-in details? Access is revoked right away and their portal email and sign-in history are erased. Their referrals stay.",
      ),
    ).toBeInTheDocument();
    expect(purge).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    expect(purge).toHaveBeenCalledWith("p-1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Portal data erased. Access is revoked."));
  });

  it("Cancel leaves everything as it was, and a refusal is explained", async () => {
    render(<PortalEraseData partnerId="p-1" partnerName="Jane" />);
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Erase portal data" })).toBeInTheDocument();
    purge.mockRejectedValueOnce({ message: "not_authorized" });
    await userEvent.click(screen.getByRole("button", { name: "Erase portal data" }));
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
  });
});
```

Append to `apps/app/src/features/partners/hooks/usePortalAccess.test.tsx` (and add `usePurgePortalUser,` to its import list from `./usePortalAccess`):

```tsx
describe("usePurgePortalUser", () => {
  it("calls portal_purge_user and refreshes the partner's portal status", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => usePurgePortalUser(), { wrapper });
    await result.current.mutateAsync("p-1");
    expect(rpcMock).toHaveBeenCalledWith("portal_purge_user", { p_partner_id: "p-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });

  it("surfaces the server's refusal", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePurgePortalUser(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).rejects.toMatchObject({ message: "not_authorized" });
  });
});
```

In `apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx`:

1. Directly after the `vi.mock("../components/PortalAccess", ...)` block, add:

```tsx
vi.mock("../components/ReinstatableReferralsCard", () => ({
  ReinstatableReferralsCard: ({ partnerId }: { partnerId: string }) => <div data-testid="reinstatable" data-partner={partnerId} />,
}));
vi.mock("../components/PartnerProfileChanges", () => ({
  PartnerProfileChanges: ({ partnerId }: { partnerId: string }) => <div data-testid="profile-changes" data-partner={partnerId} />,
}));
vi.mock("../components/PortalEraseData", () => ({
  PortalEraseData: ({ partnerId }: { partnerId: string }) => <div data-testid="portal-erase" data-partner={partnerId} />,
}));
```

2. Inside `describe("PartnerDetailPage / partner portal controls", ...)`, add:

```tsx
  it("mounts the reinstate card, the partner's own edits and the erase control for this partner", () => {
    renderPage({ partners: [partner({ id: "p1" })], deals: [], partnerId: "p1" });
    expect(screen.getByTestId("reinstatable")).toHaveAttribute("data-partner", "p1");
    expect(screen.getByTestId("profile-changes")).toHaveAttribute("data-partner", "p1");
    expect(screen.getByTestId("portal-erase")).toHaveAttribute("data-partner", "p1");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/partners`
Expected: FAIL: unresolved imports `./useReinstateReferral`, `./usePartnerProfileChanges`, `./ReinstatableReferralsCard`, `./PartnerProfileChanges`, `./PortalEraseData`; `usePurgePortalUser is not a function`; the Partner Detail test finds no `reinstatable` test id.

- [ ] **Step 3: Hooks**

Create `apps/app/src/features/partners/hooks/useReinstateReferral.ts`:

```ts
/**
 * Declined duplicates that can come back (FR-PORT-48): the referral that held
 * credit is now declined or withdrawn. RLS scopes the read; the can_reinstate
 * computed field keeps only rows the caller can triage and that qualify.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { referralErrorMessage } from "../lib/referrals";

export interface ReinstatableReferral {
  id: string;
  companyName: string;
  submittedAt: string;
}

interface Row {
  id: string;
  company_name: string;
  submitted_at: string;
}

export const REINSTATABLE_REFERRALS_QUERY_KEY = (partnerId?: string) =>
  ["referrals", "reinstatable", partnerId ?? "none"] as const;

export function useReinstatableReferrals(partnerId: string | undefined) {
  return useQuery({
    queryKey: REINSTATABLE_REFERRALS_QUERY_KEY(partnerId),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<ReinstatableReferral[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, company_name, submitted_at")
        .eq("partner_id", partnerId as string)
        .eq("status", "declined")
        .eq("can_reinstate", true)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id, companyName: r.company_name, submittedAt: r.submitted_at }));
    },
    staleTime: 30_000,
  });
}

export function useReinstateReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (referralId: string): Promise<void> => {
      const { error } = await supabase.rpc("reinstate_referral", { p_referral_id: referralId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reinstate the referral"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
```

Create `apps/app/src/features/partners/hooks/usePartnerProfileChanges.ts`:

```ts
/**
 * Name and phone changes the partner made themselves in the portal
 * (FR-PORT-19). Read through RLS (visible when the partner is visible).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PartnerProfileChange {
  id: string;
  field: "name" | "phone";
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

interface Row {
  id: string;
  field: "name" | "phone";
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export function usePartnerProfileChanges(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["partners", "profile-changes", partnerId ?? "none"] as const,
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<PartnerProfileChange[]> => {
      const { data, error } = await supabase
        .from("partner_profile_changes")
        .select("id, field, old_value, new_value, changed_at")
        .eq("partner_id", partnerId as string)
        .order("changed_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        changedAt: r.changed_at,
      }));
    },
    staleTime: 60_000,
  });
}
```

In `apps/app/src/features/partners/hooks/usePortalAccess.ts`, append:

```ts
/** Offboarding (NFR-PORT-09): administrators erase the partner's portal identity. */
export function usePurgePortalUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partnerId: string): Promise<void> => {
      const { error } = await supabase.rpc("portal_purge_user", { p_partner_id: partnerId });
      if (error) throw error;
    },
    onSuccess: (_result, partnerId) => {
      void queryClient.invalidateQueries({ queryKey: PARTNER_PORTAL_USER_QUERY_KEY(partnerId) });
    },
  });
}
```

- [ ] **Step 4: Components**

Create `apps/app/src/features/partners/components/ReinstatableReferralsCard.tsx`:

```tsx
/**
 * ReinstatableReferralsCard: referrals from this partner that were declined as
 * duplicates of an earlier referral that has since closed (FR-PORT-48). One
 * tap puts each back in Referrals to review. Hidden when there are none.
 */
import * as React from "react";
import { toast } from "sonner";
import { Button, Card } from "@/components/navigatr";
import { useReinstatableReferrals, useReinstateReferral } from "../hooks/useReinstateReferral";

export function ReinstatableReferralsCard({ partnerId }: { partnerId: string }) {
  const { data } = useReinstatableReferrals(partnerId);
  const reinstate = useReinstateReferral();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const items = data ?? [];
  if (items.length === 0) return null;

  const onReinstate = async (id: string) => {
    setBusyId(id);
    try {
      await reinstate.mutateAsync(id);
      toast.success("Reinstated. It's back in Referrals to review.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reinstate the referral");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card padding="md">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Declined duplicates you can reinstate</h3>
        <span className="rounded-full bg-surface-sunken px-2 text-caption font-medium tabular-nums text-text-muted">
          {items.length}
        </span>
      </div>
      <p className="mb-3 text-caption text-text-muted">The earlier referral for each of these is now closed.</p>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-body-md text-text-default">{r.companyName}</span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Reinstate ${r.companyName}`}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => void onReinstate(r.id)}
            >
              Reinstate
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default ReinstatableReferralsCard;
```

Create `apps/app/src/features/partners/components/PartnerProfileChanges.tsx`:

```tsx
/**
 * PartnerProfileChanges: the latest name and phone changes the partner made in
 * the portal (FR-PORT-19), on the partner's Contact card. Hidden when none.
 */
import { History } from "lucide-react";
import { usePartnerProfileChanges, type PartnerProfileChange } from "../hooks/usePartnerProfileChanges";

export function describeProfileChange(change: PartnerProfileChange): string {
  if (change.field === "name") return `Partner changed their name to ${change.newValue ?? ""} in the portal`;
  if (change.newValue === null) return "Partner removed their phone in the portal";
  return `Partner changed their phone to ${change.newValue} in the portal`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PartnerProfileChanges({ partnerId }: { partnerId: string }) {
  const { data } = usePartnerProfileChanges(partnerId);
  if (!data || data.length === 0) return null;
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <History className="h-4 w-4" aria-hidden />
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
        {data.map((c) => (
          <li key={c.id} className="text-body-sm text-text-muted">
            {`${describeProfileChange(c)} · ${shortDate(c.changedAt)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PartnerProfileChanges;
```

Create `apps/app/src/features/partners/components/PortalEraseData.tsx`:

```tsx
/**
 * PortalEraseData (NFR-PORT-09): when a partner relationship ends, an
 * administrator erases the partner's portal identity. Access is revoked, the
 * portal email and sign-in history (IP addresses) are erased, and the
 * partner's referrals stay. The server re-checks that the caller is an
 * administrator.
 */
import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePartnerPortalUser, usePurgePortalUser } from "../hooks/usePortalAccess";
import { portalAccessErrorMessage } from "../lib/portalAccess";

export function PortalEraseData({ partnerId, partnerName }: { partnerId: string; partnerName?: string }) {
  const profile = useProfile();
  const portalUser = usePartnerPortalUser(partnerId);
  const purge = usePurgePortalUser();
  const [confirming, setConfirming] = React.useState(false);

  if (profile.data?.role_level !== "administrator" || !portalUser.data) return null;
  const who = partnerName?.trim() || "this partner";

  const erase = async () => {
    try {
      await purge.mutateAsync(partnerId);
      toast.success("Portal data erased. Access is revoked.");
      setConfirming(false);
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  if (!confirming) {
    return (
      <div className="pl-12">
        <Button variant="tertiary" size="sm" leadingIcon={Trash2} onClick={() => setConfirming(true)}>
          Erase portal data
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pl-12">
      <p className="text-body-sm text-text-default">
        {`Erase ${who}'s portal sign-in details? Access is revoked right away and their portal email and sign-in history are erased. Their referrals stay.`}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" loading={purge.isPending} onClick={() => void erase()}>
          Erase
        </Button>
        <Button variant="tertiary" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default PortalEraseData;
```

- [ ] **Step 5: Mount them on Partner Detail**

In `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`:

1. After `import { PortalAccessLine, PortalInviteButton } from "../components/PortalAccess";`, add:

```tsx
import { PortalEraseData } from "../components/PortalEraseData";
import { PartnerProfileChanges } from "../components/PartnerProfileChanges";
import { ReinstatableReferralsCard } from "../components/ReinstatableReferralsCard";
```

2. In `ContactCard`, replace `<PortalAccessLine partnerId={partner.id} partnerName={partner.name} />` with:

```tsx
        <PortalAccessLine partnerId={partner.id} partnerName={partner.name} />
        <PortalEraseData partnerId={partner.id} partnerName={partner.name} />
        <PartnerProfileChanges partnerId={partner.id} />
```

3. In `PartnerDetailPage`, replace `<ReferralQueueCard partnerId={partner.id} />` with:

```tsx
        <ReferralQueueCard partnerId={partner.id} />
        <ReinstatableReferralsCard partnerId={partner.id} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReinstateReferral.ts apps/app/src/features/partners/hooks/useReinstateReferral.test.tsx apps/app/src/features/partners/hooks/usePartnerProfileChanges.ts apps/app/src/features/partners/hooks/usePartnerProfileChanges.test.tsx apps/app/src/features/partners/components/ReinstatableReferralsCard.tsx apps/app/src/features/partners/components/ReinstatableReferralsCard.test.tsx apps/app/src/features/partners/components/PartnerProfileChanges.tsx apps/app/src/features/partners/components/PartnerProfileChanges.test.tsx apps/app/src/features/partners/components/PortalEraseData.tsx apps/app/src/features/partners/components/PortalEraseData.test.tsx apps/app/src/features/partners/hooks/usePortalAccess.ts apps/app/src/features/partners/hooks/usePortalAccess.test.tsx apps/app/src/features/partners/pages/PartnerDetailPage.tsx apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): reinstate declined duplicates, show partner edits, erase portal data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Full verification, push, PR to main (the controller runs this task)

**Files:** none changed.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`051` to `056` included, and `001` to `050` still passing), the two documented SKIPs unchanged.

- [ ] **Step 2: The purge job is registered after a clean reset**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "select schedule || ' ' || command from cron.job where jobname = 'purge-declined-referrals'"`
Expected: exactly one line, starting with `15 6 * * *` and containing `select public.purge_declined_referrals(now())`.

- [ ] **Step 3: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds met, no `act()` warnings from the new files.

- [ ] **Step 4: Real production build**

Run: `pnpm --filter app build`
Expected: exits 0 (`tsc -b` typechecks `portalProfile.ts` through the include list; `vite build` succeeds).

- [ ] **Step 5: Deno typecheck of the touched functions**

Run:

```bash
for f in portal_api portal_notify portal_invite; do
  NO_COLOR=1 deno check --no-lock --config supabase/functions/$f/deno.json supabase/functions/$f/index.ts || echo "FAILED $f"
done
```

Expected: no `FAILED` line.

- [ ] **Step 6: No long dashes; the portal still never uses the app session; no ICP flag in portal code**

Run: `git diff --name-only main...HEAD | xargs perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof'`
Expected: no output.

Run: `grep -rn "supabase.functions.invoke\|supabase.auth" apps/app/src/features/portal --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: no output.

Run: `grep -rn "icp" apps/app/src/features/portal supabase/functions/_shared/portalReferralApi.ts supabase/functions/_shared/portalProfile.ts | grep -v "\.test\."`
Expected: no output.

- [ ] **Step 7: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal Phase 2A: purge, profile, reassign, CSV, reinstate, chain flag" --body "$(cat <<'EOF'
## Summary
- Privacy: every day at 06:15 UTC, referrals that were Declined or Withdrawn 90 or more days ago lose their personal details (contact name, email, phone, address, notes, consent text, internal decline note, published updates). The referral, its history, partner, company name, industry, urgency and dates stay, so partner lists, tiles and conversion rates do not change. Partners see "Contact details for this referral were removed for privacy."
- Offboarding: administrators get "Erase portal data" on a partner's Contact card. It revokes access and erases the portal email and sign-in history (IP addresses); referrals stay.
- Partners get a Profile page (link in the top bar) to update their name and phone and choose the weekly email. Name and phone changes update the partner record and show on its Contact card.
- Managers and administrators can reassign a referral from the review sheet, picking from teammates they can see, with a warning before confirming when that teammate cannot see the partner.
- Partners can download their referrals as a CSV for the selected period (closed won value only when the ISO shows values; spreadsheet formulas are defused).
- A referral declined as a duplicate can be reinstated once the earlier referral is declined or withdrawn. Its reviewer gets an email, and Partner Detail shows a "Declined duplicates you can reinstate" card.
- Triage shows an advisory "Looks like a chain: <Brand>" line for partner referrals whose name matches the chain list Path uses. It never blocks, and partners never see it.

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (section 9 deferred list)
Plan: docs/superpowers/plans/2026-10-16-partner-portal-2a-prd-completion.md

## Setup per environment
- None. The purge cron job is pure SQL and is created by the migration. Retention is 90 days per org (`organizations.declined_retention_days`, not in the UI).

## Deviations (details in the plan)
- Published updates on a purged referral are deleted rather than blanked (the column cannot be blank), and the internal decline note is cleared too.
- Partner profile edits are logged in a new table, not the partner activity timeline (that timeline needs a rep as author and counts as a touch).
- The reassign picker uses a new server list of teammates the caller can see; profiles are readable org-wide.
- The chain flag is set by a database trigger on new inbound referrals, and the open queue was backfilled.
- Reinstating clears the "probable duplicate" link so accepting needs no override reason.
- The weekly email preference is stored now; the weekly email itself ships in Phase 2B.

## Not in this PR
- Public referral form and per-rep QR links, "Referrals sent to you", the weekly digest email, Firms, purge of public-form submissions (Phase 2B).

## Test plan
- [ ] DB tests 051 to 056 pass in CI from an empty database, with 001 to 050 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging: as a partner, open Profile, change the phone, turn the weekly email off; the partner's Contact card in the app shows the change
- [ ] Staging: as a partner, Download CSV on the dashboard for 30 days and All time; the file opens in a spreadsheet with partner labels only
- [ ] Staging: as a manager, open a submitted referral, Reassign to a rep in another branch; the warning shows before confirming; the rep sees it in Referrals to review
- [ ] Staging: submit two portal referrals for the same business, decline the second as a duplicate, then decline the first; the reviewer gets "You can reinstate", Partner Detail shows the card, Reinstate puts it back in the queue
- [ ] Staging: log a referral named "Subway Downtown"; the review sheet shows "Looks like a chain: Subway"
- [ ] Staging: an admin uses Erase portal data on a test partner; that partner is signed out on their next request and the Contact card shows Portal: Revoked

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
| 1 | Audit actions `purge`, `profile_update` |
| 2 | `declined_retention_days`, `purge_declined_referrals` and its daily cron job, `portal_purge_user` |
| 3 | Partner reads include purged rows; `details_removed`; dedupe and email claim skip purged; `portal_export_referrals` |
| 4 | `referrals.icp_flags` set at insert from the chain list; open queue backfilled |
| 5 | `reinstate_referral`, `can_reinstate`, "you can reinstate" outbox kind and trigger |
| 6 | `list_referral_assignees`, `can_user_see_partner` |
| 7 | `partner_profile_changes`, `portal_get_profile`, `portal_update_profile` |
| 8 | `portal_api` actions `export_referrals`, `get_profile`, `update_profile`; purged detail allowlist |
| 9 | Reinstate email builder |
| 10 | Dashboard Download CSV; removed-details notice |
| 11 | Portal Profile page and top-bar link |
| 12 | String audit over flags, purged rows, CSV, profile |
| 13 | Review sheet: chain advisory, Reassign with pre-confirm warning |
| 14 | Partner Detail: reinstate card, partner's own edits, Erase portal data |
| 15 | Verification, push, PR |
