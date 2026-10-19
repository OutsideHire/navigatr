# Partner Portal Phase 2B-2 (public form switch and submission triage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator can turn the public referral form on, and every form submission lands in the existing "Referrals to review" queue, where the reviewer says who sent it (an existing partner, a new partner, or no partner) and then accepts, declines or merges it; the reviewer is emailed when one arrives, it rides the end-of-day digest, and its personal details are cleared on conversion, after a decline, or after 90 days untriaged.

**Architecture:** Every rule lives in SQL. A new admin RPC flips `organizations.public_form_enabled`. Five triage RPCs (`attribute_form_submission`, `accept_form_submission`, `decline_form_submission`, `merge_form_submission`, `reassign_form_submission`) plus one read RPC (`form_submission_advice`) lock the submission row, re-check org, triage rights and state, and write. With a partner, attribution turns the submission into an ordinary `referrals` row (source `portal_public`, assigned to the reviewer) and the client finishes with the EXISTING `accept_referral` / `decline_referral` / `merge_referral`. The 1C outbox gains `internal_new_submission`; `enqueue_portal_nudges` folds submissions into the same one-per-day digest; a sibling purge job clears expired submissions. The rep app gets a `ReviewFormSubmissionSheet` and the queue card lists submissions next to referrals, oldest first.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pg_cron), Deno edge functions (portal_notify, unchanged code), React 18 + TypeScript, TanStack Query 5, Radix Dialog, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (patterns) and the Phase 2B-2 design brief (binding, "brief scope N" below), which implements PRD Addendum v1.0 FR-PORT-28, 31, 32, 49, 51, 80, 93, 94. Format template: `docs/superpowers/plans/2026-10-18-partner-portal-2b1-public-intake.md`.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261020000001_...` to `20261020000004_...`, applied in filename order. The latest existing migration is `20261018000003`. No new enum values are needed (`referral_source` `portal_public` and `portal_audit_action` `purge` already exist). Never hand-apply SQL to staging or production. Never run a `supabase` command against a remote project while building this plan.
- Internal RPCs are `security definer set search_path = public, extensions`, re-check org, triage rights and state inside, take a `FOR UPDATE` lock on the submission row, then `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`. Private helpers (`_form_submission_*`) are revoked from `public, anon, authenticated, service_role`. Cron-only functions (`purge_form_submissions`) are revoked from `public, anon, authenticated` and granted to `service_role`. Triggers fire without an EXECUTE check.
- The triage rule is `can_triage_referral(assigned_user_id)` (assignee and everyone above them; the administrator queue, a null assignee, is administrators only). The reassign rule is the one in `reassign_referral` (`user_role() in ('manager','admin') or caller_is_admin()`, plus the target is active, in the org and visible to the caller).
- `referral_form_submissions.submitter_ip` is never granted to `authenticated`. Nothing here adds a column grant.
- Error tokens raised by the new RPCs: `not_authorized`, `submission_not_found`, `submission_handled`, `partner_not_visible`, `deal_not_visible`, `assignee_invalid`, `invalid_reason`, `portal_disabled`. Each one the rep app can hit maps to copy in `apps/app/src/features/partners/lib/referrals.ts`.
- New copy (exact): admin switch label `Public referral form`, helper `Anyone with a rep's link or the company link can send you a referral without signing in. Submissions land in Referrals to review.`; queue labels `From your referral form`, `From a rep's referral form`, `From the company form`; sheet step `Who sent this?` with `A partner`, `New partner`, `No partner`; internal email subject `New referral from your form: <Company>`; follow-up task title `Follow up on referral from your form`.
- Lead source for a no-partner accept: `inbound` (the LS-1 taxonomy has no referral-form value; see Deviations).
- DB tests: plain psql scripts `supabase/tests/059_public_form_switch.sql`, `060_form_submission_triage.sql`, `061_form_submission_notify.sql`, `062_form_submission_purge.sql`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Assert privileges with `has_function_privilege` / `has_table_privilege` / `has_column_privilege`, never by calling something the role cannot execute (local Postgres 17.6 segfaults on a live function-level permission denied). Switch back with `perform set_config('role', 'postgres', true);`.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. One file: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/NNN_name.sql`.
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. `_shared` tests: `pnpm --filter app test -- ../../supabase/functions/_shared/<file>.test.ts`. Tests live next to source. No `act()` warnings. Touch actions in the sheet use `size="lg"` (44px).
- Before any push: `pnpm --filter app build` (`tsc -b && vite build`) and `node tools/check-client-bundle.mjs` must pass.
- Existing behavior is preserved: DB tests `001` to `058` and every existing vitest file pass, except the nudge copy test in `portalNotifyEmail.test.ts`, which Task 5 updates on purpose (Deviation 12).
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two reviewers (or one double tap) triaging the same submission.** Expected: exactly one wins; the other sees "This referral was already handled." and nothing is created twice. Pinned in Task 2 (every RPC goes through `_form_submission_for_update`, which locks the row and refuses a triaged or purged one; 060 asserts a second `attribute_form_submission` raises `submission_handled`) and Task 9 (every action is disabled while one is running).
2. **The partner path half-finishing** (attribution works, then accept fails or finds the business already in the pipeline). Expected: the sheet keeps the new referral id, never attributes twice, never creates the new partner twice, and the next tap (Merge, or Accept again) acts on that referral. Pinned in Task 9 (the duplicate-to-merge test and the retry test assert `attribute` ran once per success and `createPartner` once).
3. **A manager or administrator opening a teammate's submission.** Expected: they can triage it, the label does not say "your referral form", and a rep never sees the administrator queue or a teammate's submissions. Pinned in Task 2 (060 section 2: RLS visibility per user equals the triage rule) and Tasks 7, 9 and 10 (the label helper, sheet and queue label tests).
4. **The portal switched off after the form was switched on.** Expected: links and the public form close, the stored switch keeps its value, and the form cannot be turned on while the portal is off. Pinned in Task 1 (059) and Task 6 (disabled switch and the `portal_disabled` toast).
5. **Data loss at conversion.** The submission's personal fields are cleared once it becomes a referral or a deal. Expected: everything the person typed survives on the referral (contact, notes, consent; who referred in the history note) or on the deal (contact on the deal, notes and who referred in a deal note; merge adds the contact to the note). Pinned in Task 2 (060 sections 5, 6 and 8 read the referral, the deal note and the cleared submission).

---

## File map

**Create**
- `supabase/migrations/20261020000001_public_form_switch.sql`: `get_portal_settings` and `update_portal_settings` re-created with `public_form_enabled`; new `set_public_form_enabled`.
- `supabase/migrations/20261020000002_form_submission_triage.sql`: submission columns `decline_reason`, `decline_note`, `nudged_at`; outcome check gains `attributed`; `_form_submission_for_update`, `_form_submission_close`, `_form_submission_note`, `form_submission_advice`, `attribute_form_submission`, `accept_form_submission`, `decline_form_submission`, `merge_form_submission`, `reassign_form_submission`.
- `supabase/migrations/20261020000003_form_submission_notify.sql`: outbox kind `internal_new_submission` and its insert trigger; `form_submission_nudges`; `enqueue_portal_nudges` covering submissions.
- `supabase/migrations/20261020000004_form_submission_purge.sql`: `portal_audit_log.submission_id`, `purge_form_submissions`, cron job `purge-form-submissions`.
- `supabase/tests/059_public_form_switch.sql`, `060_form_submission_triage.sql`, `061_form_submission_notify.sql`, `062_form_submission_purge.sql`.
- `apps/app/src/features/partners/hooks/useFormSubmissionQueue.ts` (+ `.test.tsx`): queue and advice reads.
- `apps/app/src/features/partners/hooks/useFormSubmissionMutations.ts` (+ `.test.tsx`): the five triage mutations.
- `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx` (+ `.test.tsx`).

**Modify**
- `supabase/functions/_shared/portalNotifyEmail.ts` (+ test): `internal_new_submission`; neutral digest wording.
- `apps/app/src/features/settings-hub/usePortalSettings.ts`: `publicFormEnabled`, `useSetPublicFormEnabled`.
- `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx` (+ test): the Public referral form card.
- `apps/app/src/features/partners/lib/referrals.ts` (+ test): error copy, `SUBMISSION_DECLINE_REASON_OPTIONS`, `formSubmissionSourceLabel`.
- `apps/app/src/features/partners/components/ReferralQueueCard.tsx` (+ test): submissions next to referrals.

**Deviations from the brief, recorded here:**

1. **The switch saves through its own RPC, `set_public_form_enabled(p_enabled boolean)`, the moment it is flipped.** `update_portal_settings` keeps its four-argument signature, so DB test 037 and the existing Save flow are untouched. `get_portal_settings` and `update_portal_settings` are dropped and re-created only because their return table gains `public_form_enabled` (a return type cannot change in place); their bodies are unchanged.
2. **No audit row for the switch.** Portal settings changes are not audited today (no `portal_audit_action` value exists for them), so this follows suit.
3. **No `can_triage_submission(referral_form_submissions)` computed field.** A whole-row reference needs SELECT on every column, and `submitter_ip` is deliberately not granted, so PostgREST would fail with permission denied. The SELECT policy from 2B-1 already is the triage rule (`can_triage_referral` inlined), so the queue reads untriaged, unpurged rows under RLS. 060 section 2 pins that the visible set equals the triage rule for a rep, a manager, an administrator and another rep.
4. **No-partner accept uses lead source `inbound`.** FR-PORT-32 says "the tenant's referral form source", and the LS-1 taxonomy (`deals_lead_source_check`) has no such value. See the open question.
5. **`accept_form_submission` returns the new deal id (`uuid`), with no duplicate result.** A deal without an address or place id cannot hit the pipeline dedupe (place id index, name plus address key), so the insert never collides; the duplicate advisory line is the guard.
6. **No-partner accept and merge write a deal note** (`deal_notes`, author the reviewer) holding the submission's notes and "who referred" text, plus the contact for a merge, before the submission is cleared, so nothing typed is lost.
7. **At conversion the personal fields are cleared but `consent_version` and `consent_text_snapshot` stay** as the record of consent for the converted item (the snapshot is the ISO's wording, not personal data). The decline and 90-day purge clear the snapshot too, as the brief says.
8. **On attribution the "who referred" text goes into the referral's status history note** (internal only: `portal_referral_history` returns status and time, never the note), not into `notes`, which a partner sees in the portal. The referrer's own email is not copied anywhere.
9. **`decline_form_submission(p_submission_id uuid, p_reason referral_decline_reason, p_note text default null)`** types the reason with the existing enum instead of `text`, and refuses `withdrawn_by_partner` (`invalid_reason`). The submission gains `decline_reason` and `decline_note` to hold them.
10. **The outcome check gains `attributed`** (brief scope 3); a converted submission keeps `referral_id` (attributed) or `deal_id` (accepted, merged).
11. **Queue label has three forms:** `From your referral form` when the submission came through a personal link and is assigned to the viewer, `From a rep's referral form` for a personal link assigned to someone else (a manager or administrator looking at a teammate's), `From the company form` for the tenant link. The brief's two forms would tell a manager "your" form for a rep's link.
12. **The end-of-day digest wording becomes neutral** ("1 referral still waiting for review"), because one digest now lists partner referrals and form submissions together. Three assertions in `portalNotifyEmail.test.ts` change with it.
13. **Untriaged submissions expire after `declined_retention_days`** (default 90, the brief's "same retention value"), measured from `submitted_at`.
14. **The purge is a sibling function, `purge_form_submissions(p_now)`, with its own cron job `purge-form-submissions` at 06:20 UTC**, so `purge_declined_referrals` and DB test 051 stay as they are. `portal_audit_log` gains `submission_id` (nullable, `on delete set null`) so each purge row names its submission.
15. **Reassigning a submission sends no email**, like `reassign_referral`; the new assignee sees it in the queue and in the end-of-day digest.
16. **Partner status emails after attribution follow the existing rule for rep-logged referrals**: no "Received" email (the insert trigger only emails for `portal_signed_in`), but Accepted and Not Moving Forward do go to a partner with active portal access, and the referral appears in that partner's portal list like any inbound referral. 060 pins the email. See the open question.
17. **Duplicate advice is a new read RPC, `form_submission_advice(p_submission_id)`,** scoped to the REVIEWER (`user_can_see_owner`, `can_see_partner`), because `_portal_find_duplicates` scopes to a partner owner. It matches on the phone key and the name key only (submissions have no address) and also returns the chain brand from `_referral_chain_brand`.
18. **A new partner created at triage** goes through the existing `useCreatePartner` path (client insert under RLS, owner = the reviewer), type `other`, company blank when not given (`partners.company` is `not null`).
19. **`ReferralQueueCard` stays mounted while a review sheet is open**, even if the queue empties under it (an attribution refetch), so a sheet never vanishes mid-flow.

## Operator steps (Ryan, before merging to main)

None beyond the usual pipeline. After the merge reaches staging: as a staging administrator, open Settings, Partner portal, flip "Public referral form" on, then run the PR test plan. Never production until the promote workflow and your go.

---

### Task 1: The public form switch (SQL)

**Files:**
- Create: `supabase/migrations/20261020000001_public_form_switch.sql`
- Test: `supabase/tests/059_public_form_switch.sql`

**Interfaces:**
- Consumes (SQL): `organizations.portal_enabled`, `organizations.public_form_enabled` (2B-1), `public.caller_is_admin()`, `public.user_org_id()`, `public.get_my_referral_link()`.
- Produces (SQL):
  - `public.get_portal_settings() returns table (enabled boolean, terms_text text, terms_version integer, consent_text text, consent_version integer, value_visibility boolean, slug text, org_name text, public_form_enabled boolean)`: unchanged rules, one more column.
  - `public.update_portal_settings(p_enabled boolean, p_terms_text text, p_consent_text text, p_value_visibility boolean)`: same signature and body, returns the 9-column table. Never touches `public_form_enabled`.
  - `public.set_public_form_enabled(p_enabled boolean)` returns the same 9-column table. Administrators only (`not_authorized`). Turning it on while `portal_enabled` is false raises `portal_disabled`; turning it off always works. Null means off.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/059_public_form_switch.sql`:

```sql
-- Tests for 20261020000001_public_form_switch (Partner Portal Phase 2B-2, FR-PORT-28).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/059_public_form_switch.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-switch (portal on): boss administrator, rita rep under boss.
-- Org B pf-switch-b (portal off): bob administrator.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001059', 'Switch Org',   'pf-switch',   'pf-switch-a1',   true),
  ('00000000-0000-0000-0000-000000001159', 'Switch Org B', 'pf-switch-b', 'pf-switch-b-a1', false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0590000-0000-0000-0000-000000000001', 'boss@switch.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0590000-0000-0000-0000-000000000002', 'rita@switch.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0590000-0000-0000-0000-000000000003', 'bob@switchb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0590000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001059', 'admin', 'administrator',      'Boss',     'boss@switch.example', 'swboss'::ltree,      null),
  ('a0590000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001059', 'rep',   'sales_professional', 'Rita Rep', 'rita@switch.example', 'swboss.rita'::ltree, 'a0590000-0000-0000-0000-000000000001'),
  ('a0590000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001159', 'admin', 'administrator',      'Bob',      'bob@switchb.example', 'swbob'::ltree,       null);

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
  if not has_function_privilege('authenticated', 'public.set_public_form_enabled(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_public_form_enabled(boolean)', 'EXECUTE') then
    raise exception 'set_public_form_enabled is for signed-in users only';
  end if;
  if not has_function_privilege('authenticated', 'public.get_portal_settings()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_portal_settings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then
    raise exception 're-created settings RPCs keep their grants';
  end if;
end $$;

-- 2. An administrator turns the form on; saving the portal settings keeps it;
--    turning the portal off keeps the value but closes the form.
do $$ declare r record; begin
  perform _t_act('a0590000-0000-0000-0000-000000000001');
  select * into r from public.get_portal_settings();
  if r.public_form_enabled is distinct from false then raise exception 'the public form defaults to off'; end if;

  select * into r from public.set_public_form_enabled(true);
  if r.public_form_enabled is distinct from true or r.enabled is distinct from true then
    raise exception 'switch on should read back on, got %', row_to_json(r);
  end if;
  select * into r from public.get_my_referral_link();
  if r.link_token is null or r.public_form_enabled is distinct from true then
    raise exception 'links open once the form is on';
  end if;

  select * into r from public.update_portal_settings(true, null, null, false);
  if r.public_form_enabled is distinct from true then
    raise exception 'saving the portal settings keeps the public form switch';
  end if;

  select * into r from public.update_portal_settings(false, null, null, false);
  if r.public_form_enabled is distinct from true or r.enabled is distinct from false then
    raise exception 'turning the portal off keeps the stored switch, got %', row_to_json(r);
  end if;
  select * into r from public.get_my_referral_link();
  if r.link_token is not null or r.public_form_enabled then
    raise exception 'the form is closed while the portal is off';
  end if;

  perform _t_raises('select * from public.set_public_form_enabled(true)', 'portal_disabled');
  select * into r from public.set_public_form_enabled(false);
  if r.public_form_enabled is distinct from false then raise exception 'off always works'; end if;
  select * into r from public.update_portal_settings(true, null, null, false);
  select * into r from public.set_public_form_enabled(null);
  if r.public_form_enabled is distinct from false then raise exception 'null means off'; end if;
  perform set_config('role', 'postgres', true);
end $$;

-- 3. Administrators only, and only their own org.
do $$ begin
  perform _t_act('a0590000-0000-0000-0000-000000000002');
  perform _t_raises('select * from public.set_public_form_enabled(true)', 'not_authorized');
  perform _t_act('a0590000-0000-0000-0000-000000000003');
  perform _t_raises('select * from public.set_public_form_enabled(true)', 'portal_disabled');
  perform set_config('role', 'postgres', true);
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001159') then
    raise exception 'org B must stay off';
  end if;
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001059') then
    raise exception 'org A ended off';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/059_public_form_switch.sql`
Expected: FAIL with `function public.set_public_form_enabled(boolean) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261020000001_public_form_switch.sql`:

```sql
-- 20261020000001_public_form_switch.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-28): administrators turn the public
-- referral form on and off. The switch saves on its own RPC the moment it is
-- flipped, so update_portal_settings keeps its signature. The settings read
-- and save RPCs return the switch too; a return table cannot change in place,
-- so both are dropped and re-created with unchanged bodies.
--
-- Turning the portal off keeps public_form_enabled as stored; the form stays
-- closed because _referral_form_open checks both. The form can only be turned
-- ON while the portal is on. Not audited: portal settings changes never were.

drop function if exists public.update_portal_settings(boolean, text, text, boolean);
drop function if exists public.get_portal_settings();

create function public.get_portal_settings()
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select o.portal_enabled, o.partner_terms_text, o.partner_terms_version, o.consent_text,
           o.consent_version, o.partner_value_visibility, o.slug, o.name, o.public_form_enabled
      from organizations o
     where o.id = public.user_org_id();
end $$;

create function public.update_portal_settings(
  p_enabled          boolean,
  p_terms_text       text,
  p_consent_text     text,
  p_value_visibility boolean
)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
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

create or replace function public.set_public_form_enabled(p_enabled boolean)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
  v_on  boolean := coalesce(p_enabled, false);
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_org from organizations o where o.id = public.user_org_id() for update;
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_on and not v_org.portal_enabled then
    raise exception 'portal_disabled' using errcode = '22023';
  end if;
  update organizations o set public_form_enabled = v_on where o.id = v_org.id;
  return query select * from public.get_portal_settings();
end $$;

revoke execute on function public.get_portal_settings()                                from public, anon;
revoke execute on function public.update_portal_settings(boolean, text, text, boolean) from public, anon;
revoke execute on function public.set_public_form_enabled(boolean)                     from public, anon;
grant  execute on function public.get_portal_settings()                                to authenticated;
grant  execute on function public.update_portal_settings(boolean, text, text, boolean) to authenticated;
grant  execute on function public.set_public_form_enabled(boolean)                     to authenticated;
```

- [ ] **Step 4: Apply and run the new test and the settings test it must not break**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/059_public_form_switch.sql && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/037_portal_schema_settings.sql && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/057_referral_form_links.sql`
Expected: all three exit 0 with no `ERROR`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261020000001_public_form_switch.sql supabase/tests/059_public_form_switch.sql
git commit -m "$(cat <<'EOF'
feat(portal): administrators can switch the public referral form on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Submission triage RPCs (SQL)

**Files:**
- Create: `supabase/migrations/20261020000002_form_submission_triage.sql`
- Test: `supabase/tests/060_form_submission_triage.sql`

**Interfaces:**
- Consumes (SQL): `referral_form_submissions` (2B-1); `referrals`, `deals`, `deal_notes`, `task`, `partners`, `profiles`; `public.can_triage_referral(uuid)`, `public.can_see_partner(uuid)`, `public.user_can_see_owner(uuid)`, `public.user_org_id()`, `public.user_role()`, `public.caller_is_admin()`, `public._referral_set_note(text)`, `public._referral_chain_brand(text)`, `public.deal_phone_key(text)`, `public.deal_name_key(text)`, `public.next_business_day(date, uuid)`; the existing `accept_referral(uuid)`, `decline_referral(uuid, referral_decline_reason, text)`, `merge_referral(uuid, uuid)`.
- Produces (SQL):
  - Columns on `referral_form_submissions`: `decline_reason referral_decline_reason`, `decline_note text`, `nudged_at timestamptz` (used by Task 3). Outcome check `referral_form_submissions_outcome_check`: `null` or `attributed`, `accepted`, `declined`, `merged`. No new column grants.
  - Private: `public._form_submission_for_update(p_submission_id uuid) returns referral_form_submissions` (locks; raises `submission_not_found`, `not_authorized`, `submission_handled`); `public._form_submission_close(p_id uuid, p_outcome text, p_referral uuid, p_deal uuid) returns void` (stamps triage, clears personal fields except consent); `public._form_submission_note(p_s referral_form_submissions, p_with_contact boolean) returns text`.
  - `public.form_submission_advice(p_submission_id uuid) returns table (dup_referral_id uuid, dup_referral_company text, dup_deal_id uuid, dup_deal_company text, chain_brand text)`: one row; raises `submission_not_found` unless the caller can triage it.
  - `public.attribute_form_submission(p_submission_id uuid, p_partner_id uuid) returns uuid` (the new referral id). Errors: loader errors, `partner_not_visible`.
  - `public.accept_form_submission(p_submission_id uuid) returns uuid` (the new deal id).
  - `public.decline_form_submission(p_submission_id uuid, p_reason referral_decline_reason, p_note text default null) returns void`. Error `invalid_reason` for null or `withdrawn_by_partner`.
  - `public.merge_form_submission(p_submission_id uuid, p_deal_id uuid) returns void`. Error `deal_not_visible`.
  - `public.reassign_form_submission(p_submission_id uuid, p_user_id uuid) returns void`. Errors `not_authorized`, `assignee_invalid`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/060_form_submission_triage.sql`:

```sql
-- Tests for 20261020000002_form_submission_triage (Partner Portal Phase 2B-2,
-- FR-PORT-31, 32, 49, 51).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/060_form_submission_triage.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-tri (portal and public form on, consent v1 "I may share this."):
--   boss administrator; mia manager under boss; rita and rob reps under mia.
--   Partner P1 Jane CPA (owner rita, active portal user). Deal D1 Fresh Bakery
--   (owner rita, phone 5550600001). Referral R1 Corner Cafe (P1, rita, phone 5550600002).
-- Org B pf-tri-b: bob administrator, partner P2, deal D2.
-- Submissions (org A): S1 Attr Co, S2 Accept Co, S3 Decline Co, S4 Fresh Bakery LLC,
--   S6 Subway #42 (all rita, personal link); S5 Corner Cafe (company link, administrator
--   queue); S7 Rob Co (rob).

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001060', 'Triage Org',   'pf-tri',   'pf-tri-a1',   true, 'I may share this.', 1),
  ('00000000-0000-0000-0000-000000001160', 'Triage Org B', 'pf-tri-b', 'pf-tri-b-a1', true, null,                0);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001060';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0600000-0000-0000-0000-000000000001', 'boss@tri.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000002', 'mia@tri.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000003', 'rita@tri.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000004', 'rob@tri.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000005', 'bob@trib.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'admin',   'administrator',      'Boss',     'boss@tri.example', 'triboss'::ltree,          null),
  ('a0600000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001060', 'manager', 'sales_manager',      'Mia Mgr',  'mia@tri.example',  'triboss.mia'::ltree,      'a0600000-0000-0000-0000-000000000001'),
  ('a0600000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'rep',     'sales_professional', 'Rita Rep', 'rita@tri.example', 'triboss.mia.rita'::ltree, 'a0600000-0000-0000-0000-000000000002'),
  ('a0600000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001060', 'rep',     'sales_professional', 'Rob Rep',  'rob@tri.example',  'triboss.mia.rob'::ltree,  'a0600000-0000-0000-0000-000000000002'),
  ('a0600000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001160', 'admin',   'administrator',      'Bob',      'bob@trib.example', 'tribob'::ltree,           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a060a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000003', 'a0600000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@tri.example'),
  ('a060a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001160', 'a0600000-0000-0000-0000-000000000005', 'a0600000-0000-0000-0000-000000000005', 'Bob CPA',  'Bob & Co',  'cpa', 'bobcpa@trib.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a060b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a060a000-0000-0000-0000-000000000001', 'jane@tri.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a060d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000003', 'Fresh Bakery', '1 Main St', 'Fay', 'fay@fresh.example', '+15550600001', 100000, 'contacted', 'path'),
  ('a060d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001160', 'a0600000-0000-0000-0000-000000000005', 'Other Co',     '2 Main St', 'Oz',  'oz@other.example',  '+15550600099', 100000, 'new',       'path');

insert into referrals (id, partner_id, direction, source, status, company_name, contact_phone, assigned_user_id) values
  ('a060f000-0000-0000-0000-000000000001', 'a060a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Corner Cafe', '5550600002', 'a0600000-0000-0000-0000-000000000003');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip, submitted_at
) values
  ('a060e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Attr Co',          'Ann', 'ann@attr.example',    '5550600011',     'Wants a demo',    'Jane at Jane & Co', 'jane@janeco.example', 1, 'I may share this.', '198.51.100.60', '2026-10-01 15:00+00'),
  ('a060e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Accept Co',        'Bea', 'bea@accept.example',  '5550600012',     'Call after 3',    'A neighbor',        null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Decline Co',       'Cal', 'cal@decline.example', '5550600013',     'Too small maybe', null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Fresh Bakery LLC', 'Dan', 'dan@fresh.example',   '(555) 060-0001', 'Second location', null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001060', 'tenant', null,                                   'Corner Cafe',      'Eve', 'eve@corner.example',  '555-060-0002',   'Saw your sign',   null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Subway #42',       'Gus', 'gus@sub.example',     '5550600016',     'Franchise',       null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000004', 'Rob Co',           'Hal', 'hal@rob.example',     '5550600017',     'Busy mornings',   null,                null,                  1, 'I may share this.', '198.51.100.60', now());

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

-- The fixture submissions this user can see, by company, comma-joined.
create or replace function _t_seen(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform _t_act(p_user);
  select string_agg(s.company_name, ',' order by s.company_name) into v
    from referral_form_submissions s
   where s.id::text like 'a060e000-%' and s.triaged_at is null and s.purged_at is null;
  perform set_config('role', 'postgres', true);
  return coalesce(v, '');
end $$;

-- 1. Privileges (before any role switch).
do $$ declare f text; begin
  foreach f in array array[
    'public.form_submission_advice(uuid)',
    'public.attribute_form_submission(uuid, uuid)',
    'public.accept_form_submission(uuid)',
    'public.decline_form_submission(uuid, referral_decline_reason, text)',
    'public.merge_form_submission(uuid, uuid)',
    'public.reassign_form_submission(uuid, uuid)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '% is for signed-in users only', f;
    end if;
  end loop;
  foreach f in array array[
    'public._form_submission_for_update(uuid)',
    'public._form_submission_close(uuid, text, uuid, uuid)',
    'public._form_submission_note(referral_form_submissions, boolean)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE')
       or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '% is private', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.referral_form_submissions', 'submitter_ip', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'UPDATE') then
    raise exception 'authenticated still never reads the IP and never writes submissions';
  end if;
end $$;

-- 2. What each person sees is exactly what they may triage (Deviation 3).
do $$ begin
  if _t_seen('a0600000-0000-0000-0000-000000000003') <> 'Accept Co,Attr Co,Decline Co,Fresh Bakery LLC,Subway #42' then
    raise exception 'rita sees her own, got %', _t_seen('a0600000-0000-0000-0000-000000000003');
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000004') <> 'Rob Co' then
    raise exception 'rob sees only his own';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000002') <> 'Accept Co,Attr Co,Decline Co,Fresh Bakery LLC,Rob Co,Subway #42' then
    raise exception 'mia sees her team but not the administrator queue';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000001') <> 'Accept Co,Attr Co,Corner Cafe,Decline Co,Fresh Bakery LLC,Rob Co,Subway #42' then
    raise exception 'boss sees everything including the queue';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000005') <> '' then
    raise exception 'another org sees nothing';
  end if;
end $$;

-- 3. Advice at triage time, inside the reviewer's visibility (FR-PORT-46 style, advisory).
do $$ declare a record; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000004');
  if a.dup_deal_id is distinct from 'a060d000-0000-0000-0000-000000000001'::uuid
     or a.dup_deal_company is distinct from 'Fresh Bakery'
     or a.dup_referral_id is not null or a.chain_brand is not null then
    raise exception 'S4 matches D1 by phone and name, got %', row_to_json(a);
  end if;
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000006');
  if a.chain_brand is distinct from 'Subway' or a.dup_deal_id is not null or a.dup_referral_id is not null then
    raise exception 'S6 is a chain only, got %', row_to_json(a);
  end if;
  perform _t_act('a0600000-0000-0000-0000-000000000001');
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000005');
  if a.dup_referral_id is distinct from 'a060f000-0000-0000-0000-000000000001'::uuid
     or a.dup_referral_company is distinct from 'Corner Cafe' or a.dup_deal_id is not null then
    raise exception 'S5 matches the open referral R1, got %', row_to_json(a);
  end if;
  perform _t_act('a0600000-0000-0000-0000-000000000004');
  perform _t_raises('select * from public.form_submission_advice(''a060e000-0000-0000-0000-000000000004'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000005');
  perform _t_raises('select * from public.form_submission_advice(''a060e000-0000-0000-0000-000000000004'')', 'submission_not_found');
  perform set_config('role', 'postgres', true);
end $$;

-- 4. Who may attribute, and to whom.
do $$ begin
  perform _t_act('a0600000-0000-0000-0000-000000000004');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'not_authorized');
  perform _t_act('a0600000-0000-0000-0000-000000000005');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000002'')', 'partner_not_visible');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-0000000000ff'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_not_found');
  perform set_config('role', 'postgres', true);
end $$;

-- 5. Attribution makes a referral that keeps the original time (FR-PORT-49), the
--    reviewer keeps it, the partner gets no "Received" email; then the EXISTING
--    accept_referral finishes it.
do $$ declare v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  v := public.attribute_form_submission('a060e000-0000-0000-0000-000000000001', 'a060a000-0000-0000-0000-000000000001');
  perform set_config('t.ref', v::text, true);
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_handled');
  perform set_config('role', 'postgres', true);
end $$;

do $$ declare r referrals; s referral_form_submissions; h referral_status_history; v uuid := current_setting('t.ref')::uuid; begin
  select * into r from referrals where id = v;
  if r.source <> 'portal_public' or r.status <> 'submitted' or r.direction <> 'inbound'
     or r.partner_id <> 'a060a000-0000-0000-0000-000000000001'
     or r.assigned_user_id <> 'a0600000-0000-0000-0000-000000000003'
     or r.submitted_at <> '2026-10-01 15:00+00'::timestamptz
     or r.company_name <> 'Attr Co' or r.contact_name <> 'Ann' or r.contact_email <> 'ann@attr.example'
     or r.contact_phone <> '5550600011' or r.notes <> 'Wants a demo'
     or r.partner_company_snapshot <> 'Jane & Co'
     or r.consent_text_version <> '1' or r.consent_text_snapshot <> 'I may share this.' then
    raise exception 'attributed referral is wrong: %', row_to_json(r);
  end if;
  select * into h from referral_status_history where referral_id = v;
  if h.to_status <> 'submitted' or h.actor_type <> 'user' or h.actor_id <> 'a0600000-0000-0000-0000-000000000003'
     or h.note is distinct from 'From the referral form. Who referred this business: Jane at Jane & Co' then
    raise exception 'history row is wrong: %', row_to_json(h);
  end if;
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000001';
  if s.outcome <> 'attributed' or s.referral_id <> v or s.triaged_by <> 'a0600000-0000-0000-0000-000000000003'
     or s.triaged_at is null or s.deal_id is not null
     or s.contact_name is not null or s.contact_email is not null or s.contact_phone is not null or s.notes is not null
     or s.referred_by_text is not null or s.referrer_email is not null or s.submitter_ip is not null
     or s.company_name <> 'Attr Co' or s.consent_text_snapshot <> 'I may share this.' or s.purged_at is not null then
    raise exception 'attributed submission is wrong: %', row_to_json(s);
  end if;
  if exists (select 1 from portal_email_outbox where referral_id = v and kind in ('partner_received', 'internal_new_referral')) then
    raise exception 'an attributed referral sends no Received or new-referral email';
  end if;
end $$;

do $$ declare res jsonb; v uuid := current_setting('t.ref')::uuid; d deals; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  res := public.accept_referral(v);
  perform set_config('role', 'postgres', true);
  if res->>'result' <> 'accepted' then raise exception 'accept_referral should accept, got %', res; end if;
  select * into d from deals where id = (res->>'deal_id')::uuid;
  if d.lead_source <> 'partner_referral' or d.owner_id <> 'a0600000-0000-0000-0000-000000000003'
     or d.source_partner_id <> 'a060a000-0000-0000-0000-000000000001' then
    raise exception 'deal from the attributed referral is wrong: %', row_to_json(d);
  end if;
  -- Deviation 16: same as a rep-logged referral, the partner hears Accepted.
  if not exists (select 1 from portal_email_outbox where referral_id = v and kind = 'partner_accepted') then
    raise exception 'the partner with portal access hears Accepted';
  end if;
end $$;

-- 6. No partner: accept creates the reviewer's deal, the first follow-up and a deal note.
do $$ declare v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  v := public.accept_form_submission('a060e000-0000-0000-0000-000000000002');
  perform set_config('t.deal', v::text, true);
  perform set_config('role', 'postgres', true);
end $$;

do $$ declare d deals; s referral_form_submissions; n integer; v uuid := current_setting('t.deal')::uuid; begin
  select * into d from deals where id = v;
  if d.owner_id <> 'a0600000-0000-0000-0000-000000000003' or d.lead_source <> 'inbound' or d.stage <> 'new'
     or d.company_name <> 'Accept Co' or d.contact_name <> 'Bea' or d.contact_email <> 'bea@accept.example'
     or d.contact_phone <> '5550600012' or d.source_referral_id is not null or d.source_partner_id is not null then
    raise exception 'no-partner deal is wrong: %', row_to_json(d);
  end if;
  select count(*) into n from task
   where deal_id = v and type = 'call' and owner_id = 'a0600000-0000-0000-0000-000000000003'
     and title = 'Follow up on referral from your form';
  if n <> 1 then raise exception 'one first follow-up task, got %', n; end if;
  if (select body from deal_notes where deal_id = v and created_by = 'a0600000-0000-0000-0000-000000000003')
     is distinct from E'From your referral form.\nCall after 3\nWho referred this business: A neighbor' then
    raise exception 'the deal note keeps the notes and who referred';
  end if;
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000002';
  if s.outcome <> 'accepted' or s.deal_id <> v or s.referral_id is not null or s.contact_name is not null
     or s.notes is not null or s.referred_by_text is not null or s.submitter_ip is not null
     or s.consent_text_snapshot <> 'I may share this.' then
    raise exception 'accepted submission is wrong: %', row_to_json(s);
  end if;
end $$;

-- 7. Decline: a reason is required and kept; personal details wait for the purge.
do $$ declare s referral_form_submissions; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.decline_form_submission(''a060e000-0000-0000-0000-000000000003'', ''withdrawn_by_partner'')', 'invalid_reason');
  perform _t_raises('select public.decline_form_submission(''a060e000-0000-0000-0000-000000000003'', null)', 'invalid_reason');
  perform public.decline_form_submission('a060e000-0000-0000-0000-000000000003', 'outside_icp', '  Too small  ');
  perform set_config('role', 'postgres', true);
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000003';
  if s.outcome <> 'declined' or s.decline_reason <> 'outside_icp' or s.decline_note <> 'Too small'
     or s.triaged_by <> 'a0600000-0000-0000-0000-000000000003' or s.contact_name <> 'Cal' or s.purged_at is not null then
    raise exception 'declined submission is wrong: %', row_to_json(s);
  end if;
end $$;

-- 8. Merge into a deal the reviewer can see; the contact and notes land in a deal note.
do $$ declare s referral_form_submissions; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.merge_form_submission(''a060e000-0000-0000-0000-000000000004'', ''a060d000-0000-0000-0000-000000000002'')', 'deal_not_visible');
  perform public.merge_form_submission('a060e000-0000-0000-0000-000000000004', 'a060d000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000004';
  if s.outcome <> 'merged' or s.deal_id <> 'a060d000-0000-0000-0000-000000000001' or s.contact_name is not null then
    raise exception 'merged submission is wrong: %', row_to_json(s);
  end if;
  if (select body from deal_notes where deal_id = 'a060d000-0000-0000-0000-000000000001')
     is distinct from E'From your referral form.\nContact: Dan, dan@fresh.example, (555) 060-0001\nSecond location' then
    raise exception 'the merge note keeps the contact and notes';
  end if;
  if (select lead_source from deals where id = 'a060d000-0000-0000-0000-000000000001') <> 'path' then
    raise exception 'merge never touches the lead source';
  end if;
end $$;

-- 9. The administrator queue: administrators only.
do $$ declare v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000002');
  perform _t_raises('select public.accept_form_submission(''a060e000-0000-0000-0000-000000000005'')', 'not_authorized');
  perform _t_act('a0600000-0000-0000-0000-000000000001');
  v := public.accept_form_submission('a060e000-0000-0000-0000-000000000005');
  perform set_config('role', 'postgres', true);
  if (select owner_id from deals where id = v) <> 'a0600000-0000-0000-0000-000000000001' then
    raise exception 'the administrator who accepts owns the deal';
  end if;
end $$;

-- 10. Reassign: managers and administrators, to someone active they can see.
do $$ begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000007'', ''a0600000-0000-0000-0000-000000000003'')', 'not_authorized');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000006'', ''a0600000-0000-0000-0000-000000000004'')', 'not_authorized');
  perform _t_act('a0600000-0000-0000-0000-000000000002');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000007'', ''a0600000-0000-0000-0000-000000000005'')', 'assignee_invalid');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000002'', ''a0600000-0000-0000-0000-000000000004'')', 'submission_handled');
  perform public.reassign_form_submission('a060e000-0000-0000-0000-000000000007', 'a0600000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  if (select assigned_user_id from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000007')
     <> 'a0600000-0000-0000-0000-000000000003' then
    raise exception 'S7 now belongs to rita';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000003') <> 'Rob Co,Subway #42' then
    raise exception 'rita now sees Rob Co, got %', _t_seen('a0600000-0000-0000-0000-000000000003');
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/060_form_submission_triage.sql`
Expected: FAIL in section 1 with `function public.form_submission_advice(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261020000002_form_submission_triage.sql`:

```sql
-- 20261020000002_form_submission_triage.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-31, 32, 49, 51). Triage of public form
-- submissions. Every RPC goes through _form_submission_for_update: the row is
-- locked FOR UPDATE, then org, triage rights (can_triage_referral, the same
-- rule the 2B-1 SELECT policy inlines) and state (untriaged, unpurged) are
-- re-checked, so two reviewers can never both act on one submission.
--
--   attribute  -> a referrals row (source portal_public, submitted_at kept,
--                 assigned to the reviewer, who keeps it). The app then calls
--                 the EXISTING accept_referral / decline_referral / merge_referral.
--   accept     -> no partner: a deal owned by the reviewer (lead source inbound),
--                 the first follow-up task and a deal note.
--   decline    -> reason and note stored; personal details wait for the purge.
--   merge      -> no partner: linked to a deal the reviewer can see, deal note.
--   reassign   -> managers and administrators, like reassign_referral.
--
-- On attribute, accept and merge the submission's personal fields are cleared
-- (the data now lives on the referral or the deal); consent is kept as the
-- record. No column grants change: authenticated still never reads the IP.

-- 1. Columns and outcome ---------------------------------------------------------
alter table referral_form_submissions
  add column if not exists decline_reason referral_decline_reason,
  add column if not exists decline_note   text,
  add column if not exists nudged_at      timestamptz;

alter table referral_form_submissions drop constraint referral_form_submissions_outcome_check;
alter table referral_form_submissions add constraint referral_form_submissions_outcome_check
  check (outcome is null or outcome in ('attributed','accepted','declined','merged'));

-- 2. Private helpers -----------------------------------------------------------------
create or replace function public._form_submission_for_update(p_submission_id uuid)
returns referral_form_submissions language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions;
begin
  select * into s from referral_form_submissions x where x.id = p_submission_id for update;
  if not found or s.org_id is distinct from public.user_org_id() then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if not public.can_triage_referral(s.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if s.triaged_at is not null or s.purged_at is not null then
    raise exception 'submission_handled' using errcode = '22023';
  end if;
  return s;
end $$;

-- Converted: stamp the triage and clear what the referral or deal now holds.
create or replace function public._form_submission_close(p_id uuid, p_outcome text, p_referral uuid, p_deal uuid)
returns void language sql security definer set search_path = public, extensions as $$
  update referral_form_submissions s
     set outcome          = p_outcome,
         referral_id      = p_referral,
         deal_id          = p_deal,
         triaged_at       = now(),
         triaged_by       = auth.uid(),
         contact_name     = null,
         contact_email    = null,
         contact_phone    = null,
         notes            = null,
         referred_by_text = null,
         referrer_email   = null,
         submitter_ip     = null
   where s.id = p_id
$$;

-- The deal note for a no-partner accept or merge (Deviation 6).
create or replace function public._form_submission_note(p_s referral_form_submissions, p_with_contact boolean)
returns text language sql stable security definer set search_path = public, extensions as $$
  select concat_ws(E'\n',
    'From your referral form.',
    case when p_with_contact
         then nullif('Contact: ' || concat_ws(', ', p_s.contact_name, p_s.contact_email, p_s.contact_phone), 'Contact: ')
    end,
    nullif(btrim(coalesce(p_s.notes, '')), ''),
    'Who referred this business: ' || nullif(btrim(coalesce(p_s.referred_by_text, '')), ''))
$$;

-- 3. Advice for the review sheet (advisory, never blocks) ------------------------------
-- Probable match to an active deal or an open referral the REVIEWER can see,
-- by phone key or name key (a submission has no address), plus the chain brand.
create or replace function public.form_submission_advice(p_submission_id uuid)
returns table (
  dup_referral_id uuid, dup_referral_company text, dup_deal_id uuid, dup_deal_company text, chain_brand text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  s       referral_form_submissions;
  v_phone text;
  v_name  text;
begin
  select * into s from referral_form_submissions x where x.id = p_submission_id;
  if s.id is null or s.org_id is distinct from public.user_org_id()
     or not public.can_triage_referral(s.assigned_user_id) then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  v_phone := public.deal_phone_key(s.contact_phone);
  v_name  := public.deal_name_key(s.company_name);
  return query
  with rr as (
    select r.id, r.company_name
      from referrals r
     where r.org_id = s.org_id
       and r.direction = 'inbound'
       and r.status not in ('declined','withdrawn')
       and r.purged_at is null
       and (public.can_see_partner(r.partner_id)
            or (r.assigned_user_id is not null and public.user_can_see_owner(r.assigned_user_id)))
       and ((v_phone is not null and public.deal_phone_key(r.contact_phone) = v_phone)
            or (v_name is not null and public.deal_name_key(r.company_name) = v_name))
     order by r.submitted_at, r.id
     limit 1
  ),
  dd as (
    select d.id, d.company_name
      from deals d
     where d.org_id = s.org_id
       and d.stage not in ('won','lost')
       and public.user_can_see_owner(d.owner_id)
       and ((v_phone is not null and public.deal_phone_key(d.contact_phone) = v_phone)
            or (v_name is not null and public.deal_name_key(d.company_name) = v_name))
     order by d.created_at, d.id
     limit 1
  )
  select (select rr.id from rr), (select rr.company_name from rr),
         (select dd.id from dd), (select dd.company_name from dd),
         public._referral_chain_brand(s.company_name);
end $$;

-- 4. Attribute to a partner (FR-PORT-32, 49, 51 as ruled: the reviewer keeps it) --------
create or replace function public.attribute_form_submission(p_submission_id uuid, p_partner_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  s         referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_company text;
  v_id      uuid;
begin
  select p.company into v_company from partners p where p.id = p_partner_id and p.org_id = s.org_id;
  if not found or not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  -- Internal history note only: portal reads never return it (Deviation 8).
  perform public._referral_set_note(
    'From the referral form' || coalesce('. Who referred this business: ' || nullif(btrim(coalesce(s.referred_by_text, '')), ''), ''));
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
    contact_phone, notes, partner_company_snapshot, assigned_user_id, submitted_at,
    consent_text_version, consent_text_snapshot
  ) values (
    s.org_id, p_partner_id, 'inbound', 'portal_public', 'submitted', s.company_name, s.contact_name,
    s.contact_email, s.contact_phone, coalesce(s.notes, ''), v_company, auth.uid(), s.submitted_at,
    s.consent_version::text, s.consent_text_snapshot
  ) returning referrals.id into v_id;
  perform public._referral_set_note('');
  perform public._form_submission_close(s.id, 'attributed', v_id, null);
  return v_id;
end $$;

-- 5. Accept with no partner: the reviewer's deal --------------------------------------
create or replace function public.accept_form_submission(p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  s      referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_deal uuid;
  v_day  date;
begin
  insert into deals (
    org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage, lead_source
  ) values (
    s.org_id, auth.uid(), s.company_name, coalesce(s.contact_name, s.company_name), s.contact_email,
    coalesce(s.contact_phone, ''), null, 'new', 'inbound'
  ) returning id into v_deal;

  insert into deal_notes (deal_id, body, created_by)
  values (v_deal, public._form_submission_note(s, false), auth.uid());

  v_day := public.next_business_day(current_date, s.org_id);
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    s.org_id, auth.uid(), 'call', 'Follow up on referral from your form', v_deal,
    v_day, v_day, v_day, v_day, 'interval'
  );

  perform public._form_submission_close(s.id, 'accepted', null, v_deal);
  return v_deal;
end $$;

-- 6. Decline: personal details stay until the retention purge (FR-PORT-93) -----------
create or replace function public.decline_form_submission(
  p_submission_id uuid, p_reason referral_decline_reason, p_note text default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions := public._form_submission_for_update(p_submission_id);
begin
  if p_reason is null or p_reason = 'withdrawn_by_partner' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  update referral_form_submissions x
     set outcome        = 'declined',
         decline_reason = p_reason,
         decline_note   = nullif(btrim(coalesce(p_note, '')), ''),
         triaged_at     = now(),
         triaged_by     = auth.uid()
   where x.id = s.id;
end $$;

-- 7. Merge with no partner into a deal the reviewer can see ---------------------------
create or replace function public.merge_form_submission(p_submission_id uuid, p_deal_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s      referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_deal deals;
begin
  select * into v_deal from deals d where d.id = p_deal_id;
  if not found or v_deal.org_id <> s.org_id or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  insert into deal_notes (deal_id, body, created_by)
  values (p_deal_id, public._form_submission_note(s, true), auth.uid());
  perform public._form_submission_close(s.id, 'merged', null, p_deal_id);
end $$;

-- 8. Reassign (same gate as reassign_referral) ------------------------------------------
create or replace function public.reassign_form_submission(p_submission_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions := public._form_submission_for_update(p_submission_id);
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles p
                  where p.id = p_user_id and p.org_id = s.org_id and p.deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referral_form_submissions x set assigned_user_id = p_user_id where x.id = s.id;
end $$;

-- 9. Privileges ----------------------------------------------------------------------------
revoke execute on function public._form_submission_for_update(uuid)                            from public, anon, authenticated, service_role;
revoke execute on function public._form_submission_close(uuid, text, uuid, uuid)                from public, anon, authenticated, service_role;
revoke execute on function public._form_submission_note(referral_form_submissions, boolean)     from public, anon, authenticated, service_role;

revoke execute on function public.form_submission_advice(uuid)                                  from public, anon;
revoke execute on function public.attribute_form_submission(uuid, uuid)                         from public, anon;
revoke execute on function public.accept_form_submission(uuid)                                  from public, anon;
revoke execute on function public.decline_form_submission(uuid, referral_decline_reason, text)  from public, anon;
revoke execute on function public.merge_form_submission(uuid, uuid)                             from public, anon;
revoke execute on function public.reassign_form_submission(uuid, uuid)                          from public, anon;
grant  execute on function public.form_submission_advice(uuid)                                  to authenticated;
grant  execute on function public.attribute_form_submission(uuid, uuid)                         to authenticated;
grant  execute on function public.accept_form_submission(uuid)                                  to authenticated;
grant  execute on function public.decline_form_submission(uuid, referral_decline_reason, text)  to authenticated;
grant  execute on function public.merge_form_submission(uuid, uuid)                             to authenticated;
grant  execute on function public.reassign_form_submission(uuid, uuid)                          to authenticated;
```

- [ ] **Step 4: Apply and run the new test plus the referral and public form tests**

Run: `supabase db reset && for f in 035_referral_rpcs 053_referral_icp_flags 058_public_form_submissions 060_form_submission_triage; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$f.sql || echo "FAILED $f"; done`
Expected: no `FAILED` line and no `ERROR`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261020000002_form_submission_triage.sql supabase/tests/060_form_submission_triage.sql
git commit -m "$(cat <<'EOF'
feat(portal): triage public form submissions (attribute, accept, decline, merge, reassign)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: New-submission email and the end-of-day digest (SQL)

**Files:**
- Create: `supabase/migrations/20261020000003_form_submission_notify.sql`
- Test: `supabase/tests/061_form_submission_notify.sql`

**Interfaces:**
- Consumes (SQL): `portal_email_outbox` and its `portal_email_outbox_kind_check` (latest list in 20261016000005), `public._portal_review_recipients(p_org uuid, p_assignee uuid)`, `public._portal_local_tz(text)`, `referral_nudges`, `path_preferences`; `referral_form_submissions.nudged_at` (Task 2).
- Produces (SQL):
  - Outbox kind `internal_new_submission`: one row per review recipient (the assignee while active, else every active administrator), `referral_id` null, payload exactly `{appUrlPath: "/partners", companyNames: [<company>], count: 1}`, dedupe key `internal_new_submission:<submission id>:<user id>`. Built by trigger `referral_form_submissions_enqueue_email` (AFTER INSERT), which never blocks the insert.
  - Table `form_submission_nudges (submission_id uuid, user_id uuid, nudged_at timestamptz, primary key (submission_id, user_id))`, no client access.
  - `public.enqueue_portal_nudges(p_now timestamptz) returns integer`: same signature, same rules for partner referrals; untriaged, unpurged submissions join the same digest (one `internal_nudge` per person per local day, payload unchanged in shape), each submission nudged once per reviewer.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/061_form_submission_notify.sql`:

```sql
-- Tests for 20261020000003_form_submission_notify (Partner Portal Phase 2B-2, FR-PORT-80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/061_form_submission_notify.sql
-- Self-cleans via ROLLBACK. Runs as postgres throughout (no role switch).
--
-- Org pf-ntf: boss and ann administrators, rita rep under boss (all New York,
-- end of day 18:00 local = 22:00 UTC in October). Partner P1 owned by rita.
-- R1 Ref Co: portal referral for rita at 14:00 UTC on 2026-10-20.
-- Submissions on 2026-10-20 (UTC): S1 Form Co (rita) 15:00, S2 Queue Co (company
-- link, administrator queue) 16:00, S3 Done Co (rita, declined), S4 Gone Co
-- (rita, purged), S5 Late Co (rita) 23:00, after her end of day.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001061', 'Notify Org', 'pf-ntf', 'pf-ntf-a1', true);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001061';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0610000-0000-0000-0000-000000000001', 'boss@ntf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000002', 'ann@ntf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000003', 'rita@ntf.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0610000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'admin', 'administrator',      'Boss',     'boss@ntf.example', 'ntfboss'::ltree,      null),
  ('a0610000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001061', 'admin', 'administrator',      'Ann',      'ann@ntf.example',  'ntfann'::ltree,       null),
  ('a0610000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001061', 'rep',   'sales_professional', 'Rita Rep', 'rita@ntf.example', 'ntfboss.rita'::ltree, 'a0610000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a061a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'a0610000-0000-0000-0000-000000000003', 'a0610000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@ntf.example');

insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at) values
  ('a061f000-0000-0000-0000-000000000001', 'a061a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Ref Co', 'a0610000-0000-0000-0000-000000000003', '2026-10-20 14:00+00');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at, triaged_at, outcome, purged_at
) values
  ('a061e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Form Co',  'Ann', 'a@x.example', '5550610001', 'n', 0, '2026-10-20 15:00+00', null,                  null,       null),
  ('a061e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001061', 'tenant', null,                                   'Queue Co', 'Bo',  'b@x.example', '5550610002', 'n', 0, '2026-10-20 16:00+00', null,                  null,       null),
  ('a061e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Done Co',  'Cy',  'c@x.example', '5550610003', 'n', 0, '2026-10-20 15:30+00', '2026-10-20 17:00+00', 'declined', null),
  ('a061e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Gone Co',  'Di',  'd@x.example', '5550610004', 'n', 0, '2026-10-20 15:45+00', null,                  null,       '2026-10-20 18:00+00'),
  ('a061e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Late Co',  'Ed',  'e@x.example', '5550610005', 'n', 0, '2026-10-20 23:00+00', null,                  null,       null);

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
do $$ begin
  if has_table_privilege('authenticated', 'public.form_submission_nudges', 'SELECT')
     or has_table_privilege('anon', 'public.form_submission_nudges', 'SELECT') then
    raise exception 'form_submission_nudges is invisible to clients';
  end if;
  if has_function_privilege('authenticated', 'public.referral_form_submissions_enqueue_email()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.referral_form_submissions_enqueue_email()', 'EXECUTE') then
    raise exception 'the enqueue trigger function is private';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'enqueue_portal_nudges stays service role only';
  end if;
end $$;

-- 2. A new submission emails its reviewer; the administrator queue emails every administrator.
do $$ declare o portal_email_outbox; begin
  select * into o from portal_email_outbox
   where kind = 'internal_new_submission' and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000001:%';
  if o.recipient_user_id is distinct from 'a0610000-0000-0000-0000-000000000003'::uuid
     or o.referral_id is not null or o.portal_user_id is not null
     or o.payload <> '{"appUrlPath":"/partners","companyNames":["Form Co"],"count":1}'::jsonb
     or o.dedupe_key <> 'internal_new_submission:a061e000-0000-0000-0000-000000000001:a0610000-0000-0000-0000-000000000003' then
    raise exception 'S1 emails rita, got %', row_to_json(o);
  end if;
  if (select count(*) from portal_email_outbox where kind = 'internal_new_submission'
       and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000001:%') <> 1 then
    raise exception 'one email per reviewer per submission';
  end if;
  if (select string_agg(recipient_user_id::text, ',' order by recipient_user_id) from portal_email_outbox
       where kind = 'internal_new_submission' and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000002:%')
     <> 'a0610000-0000-0000-0000-000000000001,a0610000-0000-0000-0000-000000000002' then
    raise exception 'the queue submission emails both administrators';
  end if;
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, recipient_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001061', 'bogus', 'a0610000-0000-0000-0000-000000000001', 't61:bad')$q$, 'portal_email_outbox_kind_check');
end $$;

-- 3. One digest per person: rita's lists her referral and her submission together.
do $$ declare n integer; begin
  n := public.enqueue_portal_nudges('2026-10-20 22:30+00');
  if n <> 3 then raise exception 'rita, boss and ann each get one digest, got %', n; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000003:2026-10-20')
     <> '{"appUrlPath":"/partners","companyNames":["Ref Co","Form Co"],"count":2}'::jsonb then
    raise exception 'rita''s digest combines both, oldest first';
  end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000001:2026-10-20')
     <> '{"appUrlPath":"/partners","companyNames":["Queue Co"],"count":1}'::jsonb then
    raise exception 'boss''s digest has the queue submission';
  end if;
  if (select count(*) from form_submission_nudges) <> 3
     or not exists (select 1 from form_submission_nudges
                     where submission_id = 'a061e000-0000-0000-0000-000000000001' and user_id = 'a0610000-0000-0000-0000-000000000003')
     or (select count(*) from form_submission_nudges where submission_id = 'a061e000-0000-0000-0000-000000000002') <> 2 then
    raise exception 'nudge log: S1 for rita, S2 for both administrators';
  end if;
  if (select nudged_at from referral_form_submissions where id = 'a061e000-0000-0000-0000-000000000001') <> '2026-10-20 22:30+00'::timestamptz
     or (select nudged_at from referral_form_submissions where id = 'a061e000-0000-0000-0000-000000000005') is not null then
    raise exception 'nudged_at marks S1 only';
  end if;
  if not exists (select 1 from referral_nudges where referral_id = 'a061f000-0000-0000-0000-000000000001') then
    raise exception 'the partner referral is still logged in referral_nudges';
  end if;
  if public.enqueue_portal_nudges('2026-10-20 22:30+00') <> 0 then raise exception 'a second run queues nothing'; end if;
end $$;

-- 4. After end of day, a late arrival rides the next day's digest; nothing repeats.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-21 22:30+00') <> 1 then raise exception 'only rita is due on the 21st'; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000003:2026-10-21')
     <> '{"appUrlPath":"/partners","companyNames":["Late Co"],"count":1}'::jsonb then
    raise exception 'Late Co rides the next digest alone';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/061_form_submission_notify.sql`
Expected: FAIL with `relation "public.form_submission_nudges" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261020000003_form_submission_notify.sql`:

```sql
-- 20261020000003_form_submission_notify.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-80, spec 5.9 rulings R4 and R5).
--   1. A new form submission emails its reviewer (the assignee while active,
--      else every active administrator) through the 1C outbox, kind
--      internal_new_submission. Same payload allowlist as internal_new_referral.
--   2. The end-of-day digest covers untriaged, unpurged form submissions too.
--      Still ONE internal_nudge per person per local day: partner referrals and
--      submissions are listed together, oldest first. form_submission_nudges
--      mirrors referral_nudges so each submission nudges each reviewer once.

-- 1. Outbox kind ------------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission'));

create or replace function public.referral_form_submissions_enqueue_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Never blocks the public insert; the warning names the trigger and error only.
  begin
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    select new.org_id, 'internal_new_submission', rcp.user_id,
           jsonb_build_object('appUrlPath', '/partners',
                              'companyNames', jsonb_build_array(new.company_name),
                              'count', 1),
           'internal_new_submission:' || new.id::text || ':' || rcp.user_id::text
      from public._portal_review_recipients(new.org_id, new.assigned_user_id) rcp
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referral_form_submissions_enqueue_email
  after insert on referral_form_submissions
  for each row execute function public.referral_form_submissions_enqueue_email();

-- 2. Nudge log ----------------------------------------------------------------------
create table form_submission_nudges (
  submission_id uuid not null references referral_form_submissions(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  nudged_at     timestamptz not null default now(),
  primary key (submission_id, user_id)
);
alter table form_submission_nudges enable row level security;
revoke all on form_submission_nudges from anon;
revoke all on form_submission_nudges from authenticated;

create index if not exists referral_form_submissions_nudge_candidates_idx
  on referral_form_submissions (submitted_at)
  where triaged_at is null and purged_at is null;

-- 3. The digest, now over both sources --------------------------------------------------
-- Identical to 20261014000004 except: cand unions in submissions (item tells
-- them apart), the per-item log check reads the matching table, and the
-- queued digest marks both logs.
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
      select 'referral'::text as item, r.id, r.org_id, r.company_name, r.submitted_at, r.assigned_user_id, r.nudged_at
        from referrals r
        join organizations o on o.id = r.org_id
       where r.status = 'submitted' and r.source = 'portal_signed_in' and r.direction = 'inbound'
         and r.purged_at is null and not o.is_disabled
         -- Seven local days in any time zone lie inside the last eight days.
         and r.submitted_at > v_now - interval '8 days' and r.submitted_at <= v_now
      union all
      select 'submission'::text, s.id, s.org_id, s.company_name, s.submitted_at, s.assigned_user_id, s.nudged_at
        from referral_form_submissions s
        join organizations o on o.id = s.org_id
       where s.triaged_at is null and s.purged_at is null and not o.is_disabled
         and s.submitted_at > v_now - interval '8 days' and s.submitted_at <= v_now
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
       where (z.submitted_at at time zone z.tz)::date >= (v_now at time zone z.tz)::date - 6
         -- Received before today's end of day: anything that arrived after
         -- yesterday's end of day rides in today's digest.
         and z.submitted_at < ((v_now at time zone z.tz)::date + make_time(z.eod / 60, z.eod % 60, 0)) at time zone z.tz
         and (v_now at time zone z.tz)::time >= make_time(z.eod / 60, z.eod % 60, 0)
         -- An assigned item nudges its assignee once; queue items are gated by the logs.
         and (z.user_id is distinct from z.assigned_user_id or z.nudged_at is null)
         and not exists (select 1 from referral_nudges n
                          where z.item = 'referral' and n.referral_id = z.id and n.user_id = z.user_id)
         and not exists (select 1 from form_submission_nudges n
                          where z.item = 'submission' and n.submission_id = z.id and n.user_id = z.user_id)
    )
    select d.org_id,
           d.user_id,
           (v_now at time zone d.tz)::date as local_day,
           coalesce(array_agg(d.id order by d.submitted_at, d.id) filter (where d.item = 'referral'), '{}'::uuid[]) as referral_ids,
           coalesce(array_agg(d.id order by d.submitted_at, d.id) filter (where d.item = 'submission'), '{}'::uuid[]) as submission_ids,
           -- The email lists at most 20 names (oldest first); count stays the true total.
           to_jsonb((array_agg(d.company_name order by d.submitted_at, d.id))[1:20]) as company_names,
           count(*)::integer as total_count
      from due d
     group by d.org_id, d.user_id, d.tz
  loop
    v_id := null;
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    values (rec.org_id, 'internal_nudge', rec.user_id,
            jsonb_build_object('appUrlPath', '/partners',
                               'companyNames', rec.company_names,
                               'count', rec.total_count),
            'internal_nudge:' || rec.user_id::text || ':' || rec.local_day::text)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    -- Only a digest that was really queued consumes its items. If today's
    -- digest already exists they stay un-nudged and ride the next day's digest.
    if v_id is not null then
      v_count := v_count + 1;

      insert into referral_nudges (referral_id, user_id, nudged_at)
      select unnest(rec.referral_ids), rec.user_id, v_now
      on conflict (referral_id, user_id) do nothing;
      update referrals set nudged_at = v_now
       where id = any(rec.referral_ids) and nudged_at is null;

      insert into form_submission_nudges (submission_id, user_id, nudged_at)
      select unnest(rec.submission_ids), rec.user_id, v_now
      on conflict (submission_id, user_id) do nothing;
      update referral_form_submissions set nudged_at = v_now
       where id = any(rec.submission_ids) and nudged_at is null;
    end if;
  end loop;

  return v_count;
end $$;

revoke execute on function public.referral_form_submissions_enqueue_email() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_nudges(timestamptz)        from public, anon, authenticated;
grant  execute on function public.enqueue_portal_nudges(timestamptz)        to service_role;
```

- [ ] **Step 4: Apply and run the new test plus every outbox and nudge test**

Run: `supabase db reset && for f in 046_portal_email_outbox 047_portal_email_enqueue 048_portal_nudges 054_referral_reinstate 058_public_form_submissions 060_form_submission_triage 061_form_submission_notify; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$f.sql || echo "FAILED $f"; done`
Expected: no `FAILED` line and no `ERROR` (048 proves partner referral nudges are unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261020000003_form_submission_notify.sql supabase/tests/061_form_submission_notify.sql
git commit -m "$(cat <<'EOF'
feat(portal): email the reviewer about form submissions and add them to the daily digest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Purge of declined and expired submissions (SQL)

**Files:**
- Create: `supabase/migrations/20261020000004_form_submission_purge.sql`
- Test: `supabase/tests/062_form_submission_purge.sql`

**Interfaces:**
- Consumes (SQL): `organizations.declined_retention_days` (2A, default 90), `portal_audit_log`, `portal_audit_action` value `purge`, `referral_form_submissions.decline_note` (Task 2).
- Produces (SQL):
  - Column `portal_audit_log.submission_id uuid references referral_form_submissions(id) on delete set null`.
  - `public.purge_form_submissions(p_now timestamptz) returns integer`: service role only. Erases `contact_name`, `contact_email`, `contact_phone`, `notes`, `referred_by_text`, `referrer_email`, `consent_text_snapshot`, `submitter_ip`, `decline_note` and sets `purged_at` on submissions declined at least `declined_retention_days` ago (by `triaged_at`) and on submissions still untriaged that long after `submitted_at`. `company_name`, `decline_reason`, dates and link ids stay. One `purge` audit row per erased submission, no IP. Returns the count.
  - pg_cron job `purge-form-submissions`, `20 6 * * *`, `select public.purge_form_submissions(now())`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/062_form_submission_purge.sql`:

```sql
-- Tests for 20261020000004_form_submission_purge (Partner Portal Phase 2B-2, FR-PORT-93, 94).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/062_form_submission_purge.sql
-- Self-cleans via ROLLBACK. Runs as postgres (the cron job's role).
--
-- Org pf-prg keeps 90 days, org pf-prg-b keeps 30. Submissions (org A unless noted):
--   P1 declined 100 days ago        -> erased
--   P2 declined 40 days ago         -> kept
--   P3 untriaged, sent 91 days ago  -> erased
--   P4 untriaged, sent 80 days ago  -> kept
--   P5 attributed 200 days ago      -> untouched (already thin)
--   P6 org B, declined 31 days ago  -> erased
--   P7 already purged 5 days ago    -> untouched

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001062', 'Purge Org',   'pf-prg',   'pf-prg-a1',   true),
  ('00000000-0000-0000-0000-000000001162', 'Purge Org B', 'pf-prg-b', 'pf-prg-b-a1', true);
update organizations set declined_retention_days = 30 where id = '00000000-0000-0000-0000-000000001162';

insert into referral_form_submissions (
  id, org_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
  referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip,
  submitted_at, triaged_at, outcome, decline_reason, decline_note, purged_at
) values
  ('a062e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001062', 'tenant', 'Old Decline', 'Ann', 'a@x.example', '5550620001', 'n1', 'Jane', 'j@x.example', 1, 'I may share this.', '198.51.100.62', now() - interval '101 days', now() - interval '100 days', 'declined',   'outside_icp', 'Owner was rude', null),
  ('a062e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001062', 'tenant', 'New Decline', 'Bo',  'b@x.example', '5550620002', 'n2', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '41 days',  now() - interval '40 days',  'declined',   'duplicate',   null,             null),
  ('a062e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001062', 'tenant', 'Stale Co',    'Cy',  'c@x.example', '5550620003', 'n3', 'Jo',   'jo@x.example', 1, 'I may share this.', '198.51.100.62', now() - interval '91 days',  null,                        null,         null,          null,             null),
  ('a062e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001062', 'tenant', 'Fresh Co',    'Di',  'd@x.example', '5550620004', 'n4', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '80 days',  null,                        null,         null,          null,             null),
  ('a062e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001062', 'tenant', 'Thin Co',     null,  null,          null,         null, null,   null,          1, 'I may share this.', null,            now() - interval '201 days', now() - interval '200 days', 'attributed', null,          null,             null),
  ('a062e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001162', 'tenant', 'B Decline',   'Ed',  'e@x.example', '5550620006', 'n6', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '32 days',  now() - interval '31 days',  'declined',   'outside_footprint', null,       null),
  ('a062e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001062', 'tenant', 'Done Co',     null,  null,          null,         null, null,   null,          1, null,                null,            now() - interval '120 days', null,                        null,         null,          null,             now() - interval '5 days');

-- 1. Privileges, column and schedule.
do $$ declare j record; begin
  if not has_function_privilege('service_role', 'public.purge_form_submissions(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_form_submissions(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_form_submissions(timestamptz)', 'EXECUTE') then
    raise exception 'purge_form_submissions is service role only';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'portal_audit_log' and column_name = 'submission_id') then
    raise exception 'portal_audit_log.submission_id exists';
  end if;
  select schedule, command into j from cron.job where jobname = 'purge-form-submissions';
  if j.schedule is distinct from '20 6 * * *' or position('public.purge_form_submissions(now())' in j.command) = 0 then
    raise exception 'daily job at 06:20 UTC, got %', row_to_json(j);
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-declined-referrals') then
    raise exception 'the referral purge job is untouched';
  end if;
end $$;

-- 2. One run erases exactly the expired ones.
do $$ declare n integer; s referral_form_submissions; begin
  n := public.purge_form_submissions(now());
  if n <> 3 then raise exception 'three erased (P1, P3, P6), got %', n; end if;

  select * into s from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000001';
  if s.contact_name is not null or s.contact_email is not null or s.contact_phone is not null or s.notes is not null
     or s.referred_by_text is not null or s.referrer_email is not null or s.consent_text_snapshot is not null
     or s.submitter_ip is not null or s.decline_note is not null or s.purged_at is distinct from now()
     or s.company_name <> 'Old Decline' or s.decline_reason <> 'outside_icp' or s.outcome <> 'declined' then
    raise exception 'P1 erased but company and reason kept, got %', row_to_json(s);
  end if;
  select * into s from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000003';
  if s.contact_name is not null or s.referrer_email is not null or s.purged_at is null
     or s.triaged_at is not null or s.outcome is not null or s.company_name <> 'Stale Co' then
    raise exception 'P3 expired untriaged and erased, got %', row_to_json(s);
  end if;
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000006') is null then
    raise exception 'P6 uses its own org''s 30 days';
  end if;
  if (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000002') <> 'Bo'
     or (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000004') <> 'Di'
     or (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000005') is not null
     or (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000007') > now() - interval '4 days' then
    raise exception 'P2, P4, P5 and P7 are untouched';
  end if;

  if (select string_agg(submission_id::text, ',' order by submission_id) from portal_audit_log
       where action = 'purge' and submission_id is not null and ip is null)
     <> 'a062e000-0000-0000-0000-000000000001,a062e000-0000-0000-0000-000000000003,a062e000-0000-0000-0000-000000000006' then
    raise exception 'one purge audit row per erased submission, no IP';
  end if;
  if (select org_id from portal_audit_log where submission_id = 'a062e000-0000-0000-0000-000000000006')
     <> '00000000-0000-0000-0000-000000001162' then
    raise exception 'the audit row carries the submission''s org';
  end if;

  if public.purge_form_submissions(now()) <> 0 then raise exception 'a second run erases nothing'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/062_form_submission_purge.sql`
Expected: FAIL with `function public.purge_form_submissions(timestamp with time zone) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261020000004_form_submission_purge.sql`:

```sql
-- 20261020000004_form_submission_purge.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-93, 94). A daily job erases the personal
-- details on public form submissions that were declined at triage at least the
-- org's retention period ago (declined_retention_days, default 90), and on
-- submissions still untriaged that long after they arrived. The company name,
-- the decline reason, dates and link ids stay. Each erased submission gets a
-- 'purge' audit row (no IP). Converted submissions (attributed, accepted,
-- merged) were already cleared at triage (20261020000002).
--
-- A sibling of purge_declined_referrals with its own job, so that function and
-- its test stay as they are. Pure SQL, called by pg_cron directly.

alter table portal_audit_log
  add column if not exists submission_id uuid references referral_form_submissions(id) on delete set null;

create index if not exists referral_form_submissions_purge_candidates_idx
  on referral_form_submissions (org_id)
  where purged_at is null and (outcome = 'declined' or triaged_at is null);

create or replace function public.purge_form_submissions(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n   integer;
begin
  -- One run at a time. The UPDATE row locks also serialize against a triage
  -- RPC, which re-checks purged_at after its own FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended('purge_form_submissions', 0));

  with erased as (
    update referral_form_submissions s
       set contact_name          = null,
           contact_email         = null,
           contact_phone         = null,
           notes                 = null,
           referred_by_text      = null,
           referrer_email        = null,
           consent_text_snapshot = null,
           submitter_ip          = null,
           decline_note          = null,
           purged_at             = v_now
      from organizations o
     where o.id = s.org_id
       and s.purged_at is null
       and (
         (s.outcome = 'declined'
          and s.triaged_at <= v_now - make_interval(days => o.declined_retention_days))
         or (s.triaged_at is null
             and s.submitted_at <= v_now - make_interval(days => o.declined_retention_days))
       )
    returning s.id, s.org_id
  ),
  audited as (
    insert into portal_audit_log (org_id, action, submission_id)
    select e.org_id, 'purge'::portal_audit_action, e.id from erased e
    returning 1
  )
  select count(*)::integer into v_n from audited;

  return v_n;
end $$;

revoke execute on function public.purge_form_submissions(timestamptz) from public, anon, authenticated;
grant  execute on function public.purge_form_submissions(timestamptz) to service_role;

-- Daily at 06:20 UTC, five minutes after purge-declined-referrals. Idempotent.
create extension if not exists pg_cron;

select cron.unschedule('purge-form-submissions')
where exists (select 1 from cron.job where jobname = 'purge-form-submissions');

select cron.schedule(
  'purge-form-submissions',
  '20 6 * * *',
  $$ select public.purge_form_submissions(now()) $$
);
```

- [ ] **Step 4: Apply, run the new test, the referral purge test and the destructive-migration check**

Run: `supabase db reset && for f in 051_referral_purge 062_form_submission_purge; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$f.sql || echo "FAILED $f"; done && node tools/check-destructive-migrations.mjs`
Expected: no `FAILED` line, no `ERROR`, and the destructive check exits 0 (the new migrations drop only functions and a check constraint).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261020000004_form_submission_purge.sql supabase/tests/062_form_submission_purge.sql
git commit -m "$(cat <<'EOF'
feat(portal): purge declined and expired form submissions daily

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: Email copy for a new submission and the combined digest (pure TS)

**Files:**
- Modify: `supabase/functions/_shared/portalNotifyEmail.ts`
- Test: `supabase/functions/_shared/portalNotifyEmail.test.ts`

**Interfaces:**
- Consumes: outbox kind `internal_new_submission` with the internal payload shape (Task 3).
- Produces: `INTERNAL_NOTIFY_KINDS` includes `"internal_new_submission"`; `buildPortalNotifyEmail("internal_new_submission", payload, ctx)` returns an internal email. `portal_notify` needs no code change: it builds every kind through `buildPortalNotifyEmail`.

- [ ] **Step 1: Write the failing tests (and update the digest wording)**

In `supabase/functions/_shared/portalNotifyEmail.test.ts`, replace the body of `it("nudge: one line per business, singular and plural", ...)` with:

```ts
    const one = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX)!;
    expect(one.subject).toBe("1 referral still waiting for review");
    expect(one.heading).toBe("1 referral still waiting");
    expect(one.preheader).toBe("Still waiting for review: Fresh Bakery");
    expect(one.bodyLines).toEqual(["These are still waiting for review:", "- Fresh Bakery"]);
    expect(one.footnote).toBe("You get this at the end of your day when referrals are still waiting for review.");
    // The digest can cover up to 7 days, so it never says "today".
    expect([one.preheader, ...one.bodyLines, one.footnote].join(" ")).not.toMatch(/today/i);
    const two = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["A Co", "B Co"], count: 2 }, CTX)!;
    expect(two.subject).toBe("2 referrals still waiting for review");
    expect(two.ctaUrl).toBe(`${BASE}/partners`);
```

and add inside `describe("internal emails", ...)`:

```ts
  it("new form submission: names the business, links to the review queue", () => {
    const e = buildPortalNotifyEmail(
      "internal_new_submission",
      { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 },
      { appBaseUrl: BASE, referralId: null },
    )!;
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_new_submission");
    expect(e.subject).toBe("New referral from your form: Fresh Bakery");
    expect(e.preheader).toBe("Fresh Bakery is waiting in Referrals to review.");
    expect(e.heading).toBe("New referral from your referral form");
    expect(e.bodyLines).toEqual([
      "Someone sent Fresh Bakery through your referral form.",
      "Review it to say who sent it, then accept, merge or decline.",
    ]);
    expect(e.ctaLabel).toBe("Review referral");
    expect(e.ctaUrl).toBe(`${BASE}/partners`);
    expect(e.footnote).toBe("You're getting this because referral form submissions are routed to you.");
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
  });

  it("new form submission: a bad payload is dropped", () => {
    expect(buildPortalNotifyEmail("internal_new_submission", { appUrlPath: "https://evil.example/x", companyNames: ["A"], count: 1 }, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_new_submission", { appUrlPath: "/partners", companyNames: [], count: 1 }, CTX)).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalNotifyEmail.test.ts`
Expected: FAIL: the nudge subject is still `1 partner referral still waiting for review`, and `internal_new_submission` builds `null`.

- [ ] **Step 3: Implement in `supabase/functions/_shared/portalNotifyEmail.ts`**

Change the kinds list to:

```ts
export const INTERNAL_NOTIFY_KINDS = [
  "internal_new_referral",
  "internal_nudge",
  "internal_reinstate_available",
  "internal_new_submission",
] as const;
```

In `buildInternal`, add this branch right after the `internal_new_referral` branch:

```ts
  if (kind === "internal_new_submission") {
    const name = p.companyNames[0];
    return {
      subject: `New referral from your form: ${name}`,
      preheader: `${name} is waiting in Referrals to review.`,
      heading: "New referral from your referral form",
      bodyLines: [
        `Someone sent ${name} through your referral form.`,
        "Review it to say who sent it, then accept, merge or decline.",
      ],
      ctaLabel: "Review referral",
      ctaUrl: url,
      footnote: "You're getting this because referral form submissions are routed to you.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
```

Replace the digest (the final block of `buildInternal`) with:

```ts
  // One digest lists partner referrals and form submissions together (2B-2).
  const n = p.count;
  const noun = n === 1 ? "referral" : "referrals";
  const shown = p.companyNames.slice(0, 10).map((c) => `- ${c}`);
  const more = p.count > shown.length ? [`and ${p.count - shown.length} more`] : [];
  return {
    subject: `${n} ${noun} still waiting for review`,
    preheader: `Still waiting for review: ${p.companyNames.slice(0, 3).join(", ")}`,
    heading: `${n} ${noun} still waiting`,
    bodyLines: ["These are still waiting for review:", ...shown, ...more],
    ctaLabel: "Review referrals",
    ctaUrl: url,
    footnote: "You get this at the end of your day when referrals are still waiting for review.",
    audience: "internal",
    orgName: null,
    replyTo: null,
  };
```

- [ ] **Step 4: Run them to verify they pass, plus the drain**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalNotifyEmail.test.ts ../../supabase/functions/_shared/portalNotify.test.ts ../../supabase/functions/_shared/emailTemplate.snapshot.test.ts`
Expected: PASS; no snapshot file is written or changed.

Run: `NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_notify/deno.json supabase/functions/portal_notify/index.ts`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalNotifyEmail.ts supabase/functions/_shared/portalNotifyEmail.test.ts
git commit -m "$(cat <<'EOF'
feat(portal): new form submission email and a combined end-of-day digest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The Public referral form switch in admin settings

**Files:**
- Modify: `apps/app/src/features/settings-hub/usePortalSettings.ts`
- Modify: `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx`
- Test: `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.test.tsx`

**Interfaces:**
- Consumes (SQL, Task 1): `get_portal_settings` / `update_portal_settings` rows now carry `public_form_enabled`; `set_public_form_enabled(p_enabled boolean)` returns the same row; error token `portal_disabled`.
- Produces (TS): `PortalSettings.publicFormEnabled: boolean`; `useSetPublicFormEnabled(): UseMutationResult<PortalSettings, Error, boolean>` (writes the cache under `PORTAL_SETTINGS_QUERY_KEY`, invalidates `["referral-links"]`, throws `Error` with display copy).

- [ ] **Step 1: Write the failing tests**

Append inside `describe("PartnerPortalTab", ...)` in `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.test.tsx`:

```tsx
  it("keeps the public form switch disabled while the portal is off", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ ...OFF, public_form_enabled: false }], error: null });
    renderTab();
    const sw = await screen.findByRole("switch", { name: "Public referral form" });
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
    expect(
      screen.getByText(
        "Anyone with a rep's link or the company link can send you a referral without signing in. Submissions land in Referrals to review.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Turn on the partner portal and save to use the public form.")).toBeInTheDocument();
  });

  it("turns the public form on the moment it is flipped", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: true }], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(rpcMock).toHaveBeenLastCalledWith("set_public_form_enabled", { p_enabled: true });
    expect(await screen.findByRole("switch", { name: "Public referral form" })).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith("Public referral form is on");
    expect(screen.queryByText("Turn on the partner portal and save to use the public form.")).not.toBeInTheDocument();
  });

  it("explains when the portal has to be on first", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "portal_disabled" } });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(toast.error).toHaveBeenCalledWith("Turn on the partner portal and save first.");
    expect(screen.getByRole("switch", { name: "Public referral form" })).not.toBeChecked();
  });

  it("turns the public form off", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: true }], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(rpcMock).toHaveBeenLastCalledWith("set_public_form_enabled", { p_enabled: false });
    expect(toast.success).toHaveBeenCalledWith("Public referral form is off");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/settings-hub/tabs/PartnerPortalTab.test.tsx`
Expected: the four new tests FAIL (no switch named `Public referral form`); the existing ones PASS.

- [ ] **Step 3: Implement the hook in `apps/app/src/features/settings-hub/usePortalSettings.ts`**

Add `publicFormEnabled: boolean;` to `PortalSettings`, `public_form_enabled?: boolean;` to `PortalSettingsRow`, and `publicFormEnabled: row.public_form_enabled ?? false,` to the object `toSettings` returns. Then add:

```ts
/**
 * The public referral form switch (FR-PORT-28). Saves the moment it is flipped,
 * separately from the Save button. The server refuses to turn it on while the
 * portal is off (portal_disabled). Links depend on it, so they are refetched.
 */
export function useSetPublicFormEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<PortalSettings> => {
      const { data, error } = await supabase.rpc("set_public_form_enabled", { p_enabled: enabled });
      if (error) {
        throw new Error(
          error.message?.includes("portal_disabled")
            ? "Turn on the partner portal and save first."
            : "Couldn't change the public referral form. Try again.",
        );
      }
      return toSettings(data);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(PORTAL_SETTINGS_QUERY_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: ["referral-links"] });
    },
  });
}
```

- [ ] **Step 4: Implement the card in `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx`**

Import `useSetPublicFormEnabled` alongside the other two hooks. In `PartnerPortalTab`, render the card after the form (the form's `key` is unchanged, so flipping the switch never resets unsaved edits):

```tsx
      ) : (
        <>
          <PartnerPortalForm key={formKey(settings.data)} initial={settings.data} />
          <PublicFormCard settings={settings.data} />
        </>
      )}
```

Add the component at the end of the file:

```tsx
/**
 * The public referral form switch (FR-PORT-28). Saves on flip. Only usable
 * while the saved portal setting is on; turning the portal off keeps the stored
 * value but closes the form (the server checks both).
 */
function PublicFormCard({ settings }: { settings: PortalSettings }) {
  const setPublicForm = useSetPublicFormEnabled();
  const toggle = async (next: boolean) => {
    try {
      await setPublicForm.mutateAsync(next);
      toast.success(next ? "Public referral form is on" : "Public referral form is off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the public referral form. Try again.");
    }
  };
  return (
    <Card padding="lg" className="mt-6 flex flex-col gap-3">
      <Checkbox
        variant="toggle"
        id="public-form-enabled"
        checked={settings.publicFormEnabled}
        disabled={!settings.enabled || setPublicForm.isPending}
        onCheckedChange={(next) => void toggle(next)}
        label="Public referral form"
        helper="Anyone with a rep's link or the company link can send you a referral without signing in. Submissions land in Referrals to review."
      />
      {!settings.enabled && (
        <p className="text-caption text-text-subtle">Turn on the partner portal and save to use the public form.</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/settings-hub/tabs/PartnerPortalTab.test.tsx src/features/partners/components/ShareReferralForm.test.tsx`
Expected: all PASS, no `act()` warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/settings-hub/usePortalSettings.ts apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx apps/app/src/features/settings-hub/tabs/PartnerPortalTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(settings): Public referral form switch on the Partner portal tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: Rep app reads: copy helpers, the submission queue and triage advice

**Files:**
- Modify: `apps/app/src/features/partners/lib/referrals.ts`
- Test: `apps/app/src/features/partners/lib/referrals.test.ts`
- Create: `apps/app/src/features/partners/hooks/useFormSubmissionQueue.ts`
- Test: `apps/app/src/features/partners/hooks/useFormSubmissionQueue.test.tsx`

**Interfaces:**
- Consumes (SQL): `referral_form_submissions` under RLS (Task 2 Deviation 3), `form_submission_advice(p_submission_id uuid)` (Task 2).
- Produces (TS):
  - `lib/referrals.ts`: `SUBMISSION_DECLINE_REASON_OPTIONS: Array<{ value: DeclineReason; label: string }>` (every referral reason except `withdrawn_by_partner`); `formSubmissionSourceLabel(linkType: "user" | "tenant", assignedToViewer: boolean): string`; `referralErrorMessage` also maps `submission_not_found`, `submission_handled`, `invalid_reason`, `portal_disabled`.
  - `hooks/useFormSubmissionQueue.ts`: `interface QueueSubmission { id: string; linkType: "user" | "tenant"; assignedUserId: string | null; companyName: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; notes: string | null; referredByText: string | null; referrerEmail: string | null; submittedAt: string }`; `FORM_SUBMISSION_QUEUE_QUERY_KEY(userId: string | undefined)` = `["referrals", "form-submissions", userId ?? "anon"]`; `useFormSubmissionQueue(): UseQueryResult<QueueSubmission[]>`; `interface SubmissionAdvice { duplicateReferral: { id: string; companyName: string } | null; duplicateDeal: { id: string; companyName: string } | null; chainBrand: string | null }`; `useFormSubmissionAdvice(submissionId: string | null): UseQueryResult<SubmissionAdvice>`. Both keys start with `"referrals"`, so every existing `invalidateQueries({ queryKey: ["referrals"] })` refreshes them.

- [ ] **Step 1: Write the failing tests**

Add `SUBMISSION_DECLINE_REASON_OPTIONS` and `formSubmissionSourceLabel` to the import list at the top of `apps/app/src/features/partners/lib/referrals.test.ts`, then append:

```ts
describe("public form submissions", () => {
  it("labels where a submission came from", () => {
    expect(formSubmissionSourceLabel("user", true)).toBe("From your referral form");
    expect(formSubmissionSourceLabel("user", false)).toBe("From a rep's referral form");
    expect(formSubmissionSourceLabel("tenant", true)).toBe("From the company form");
    expect(formSubmissionSourceLabel("tenant", false)).toBe("From the company form");
  });

  it("never offers 'Partner withdrew it' for a form submission", () => {
    expect(SUBMISSION_DECLINE_REASON_OPTIONS.map((o) => o.value)).toEqual([
      "duplicate", "outside_footprint", "outside_icp", "insufficient_contact", "existing_customer",
    ]);
    expect(SUBMISSION_DECLINE_REASON_OPTIONS[0]).toBe(DECLINE_REASON_OPTIONS[0]);
  });

  it("maps the submission error tokens to copy", () => {
    expect(referralErrorMessage({ message: "submission_handled" }, "x")).toBe("This referral was already handled.");
    expect(referralErrorMessage({ message: "submission_not_found" }, "x")).toBe("That referral no longer exists.");
    expect(referralErrorMessage({ message: "invalid_reason" }, "x")).toBe("Pick a reason.");
    expect(referralErrorMessage({ message: "portal_disabled" }, "x")).toBe("Turn on the partner portal first.");
  });
});
```

Create `apps/app/src/features/partners/hooks/useFormSubmissionQueue.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const orderMock = vi.fn();
const isMock = vi.fn();
const selectMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "referral_form_submissions") throw new Error(`unexpected table ${table}`);
      return {
        select: (...a: unknown[]) => {
          selectMock(...a);
          return {
            is: (...i: unknown[]) => {
              isMock(...i);
              return { is: (...i2: unknown[]) => { isMock(...i2); return { order: orderMock }; } };
            },
          };
        },
      };
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import { useFormSubmissionAdvice, useFormSubmissionQueue } from "./useFormSubmissionQueue";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  orderMock.mockReset(); isMock.mockReset(); selectMock.mockReset(); rpcMock.mockReset();
});

describe("useFormSubmissionQueue", () => {
  it("loads untriaged, unpurged submissions oldest first, never the IP", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "s-1", link_type: "user", assigned_user_id: "user-1", company_name: "Fresh Bakery",
        contact_name: "Ann", contact_email: "ann@fresh.example", contact_phone: "5550001111",
        notes: "Wants a demo", referred_by_text: "Jane", referrer_email: null,
        submitted_at: "2026-10-20T15:00:00+00:00",
      }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(isMock.mock.calls).toEqual([["triaged_at", null], ["purged_at", null]]);
    expect(orderMock).toHaveBeenCalledWith("submitted_at", { ascending: true });
    expect(selectMock.mock.calls[0][0]).not.toContain("submitter_ip");
    expect(result.current.data).toEqual([{
      id: "s-1", linkType: "user", assignedUserId: "user-1", companyName: "Fresh Bakery",
      contactName: "Ann", contactEmail: "ann@fresh.example", contactPhone: "5550001111",
      notes: "Wants a demo", referredByText: "Jane", referrerEmail: null,
      submittedAt: "2026-10-20T15:00:00+00:00",
    }]);
  });

  it("surfaces a load error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useFormSubmissionQueue(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useFormSubmissionAdvice", () => {
  it("maps duplicates and the chain brand", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ dup_referral_id: "r-1", dup_referral_company: "Corner Cafe", dup_deal_id: "d-1", dup_deal_company: "Fresh Bakery", chain_brand: "Subway" }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionAdvice("s-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("form_submission_advice", { p_submission_id: "s-1" });
    expect(result.current.data).toEqual({
      duplicateReferral: { id: "r-1", companyName: "Corner Cafe" },
      duplicateDeal: { id: "d-1", companyName: "Fresh Bakery" },
      chainBrand: "Subway",
    });
  });

  it("returns no advice when nothing matches, and does not run without an id", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ dup_referral_id: null, dup_referral_company: null, dup_deal_id: null, dup_deal_company: null, chain_brand: null }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionAdvice("s-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ duplicateReferral: null, duplicateDeal: null, chainBrand: null });
    renderHook(() => useFormSubmissionAdvice(null), { wrapper });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/lib/referrals.test.ts src/features/partners/hooks/useFormSubmissionQueue.test.tsx`
Expected: FAIL: `formSubmissionSourceLabel` is not exported and `./useFormSubmissionQueue` does not exist.

- [ ] **Step 3: Implement the helpers in `apps/app/src/features/partners/lib/referrals.ts`**

Insert these four entries into `ERROR_COPY` directly before `["not_authorized", ...]`:

```ts
  ["submission_not_found", "That referral no longer exists."],
  ["submission_handled", "This referral was already handled."],
  ["invalid_reason", "Pick a reason."],
  ["portal_disabled", "Turn on the partner portal first."],
```

Add after `DECLINE_REASON_OPTIONS`:

```ts
/** Decline reasons for a public form submission: no partner can have withdrawn it. */
export const SUBMISSION_DECLINE_REASON_OPTIONS = DECLINE_REASON_OPTIONS.filter(
  (o) => o.value !== "withdrawn_by_partner",
);

/**
 * Where a public form submission came from (queue and review sheet). A personal
 * link says "your" only when the viewer holds it, so a manager looking at a
 * rep's submission is not told it came through their own form.
 */
export function formSubmissionSourceLabel(linkType: "user" | "tenant", assignedToViewer: boolean): string {
  if (linkType === "tenant") return "From the company form";
  return assignedToViewer ? "From your referral form" : "From a rep's referral form";
}
```

- [ ] **Step 4: Implement `apps/app/src/features/partners/hooks/useFormSubmissionQueue.ts`**

```ts
/**
 * Public form submissions waiting for triage (FR-PORT-31) and the advice shown
 * while reviewing one. RLS on referral_form_submissions IS the triage rule (the
 * assignee and everyone above them; the administrator queue for administrators),
 * so every row returned is one the viewer may triage. Oldest first, like the
 * referral queue. submitter_ip is never selected (it is not granted).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface QueueSubmission {
  id: string;
  linkType: "user" | "tenant";
  assignedUserId: string | null;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  referredByText: string | null;
  referrerEmail: string | null;
  submittedAt: string;
}

interface SubmissionRow {
  id: string;
  link_type: "user" | "tenant";
  assigned_user_id: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  referred_by_text: string | null;
  referrer_email: string | null;
  submitted_at: string;
}

const COLUMNS =
  "id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone, " +
  "notes, referred_by_text, referrer_email, submitted_at";

export const FORM_SUBMISSION_QUEUE_QUERY_KEY = (userId: string | undefined) =>
  ["referrals", "form-submissions", userId ?? "anon"] as const;

export function useFormSubmissionQueue() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: FORM_SUBMISSION_QUEUE_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<QueueSubmission[]> => {
      const { data, error } = await supabase
        .from("referral_form_submissions")
        .select(COLUMNS)
        .is("triaged_at", null)
        .is("purged_at", null)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as SubmissionRow[]).map((r) => ({
        id: r.id,
        linkType: r.link_type,
        assignedUserId: r.assigned_user_id,
        companyName: r.company_name,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        notes: r.notes,
        referredByText: r.referred_by_text,
        referrerEmail: r.referrer_email,
        submittedAt: r.submitted_at,
      }));
    },
    staleTime: 30_000,
  });
}

export interface SubmissionAdvice {
  duplicateReferral: { id: string; companyName: string } | null;
  duplicateDeal: { id: string; companyName: string } | null;
  chainBrand: string | null;
}

interface AdviceRow {
  dup_referral_id: string | null;
  dup_referral_company: string | null;
  dup_deal_id: string | null;
  dup_deal_company: string | null;
  chain_brand: string | null;
}

/** Advisory only: an error simply shows no advice lines. */
export function useFormSubmissionAdvice(submissionId: string | null) {
  return useQuery({
    queryKey: ["referrals", "form-submission-advice", submissionId ?? "none"] as const,
    enabled: Boolean(submissionId),
    queryFn: async (): Promise<SubmissionAdvice> => {
      const { data, error } = await supabase.rpc("form_submission_advice", { p_submission_id: submissionId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as AdviceRow | null | undefined;
      return {
        duplicateReferral: row?.dup_referral_id
          ? { id: row.dup_referral_id, companyName: row.dup_referral_company ?? "" }
          : null,
        duplicateDeal: row?.dup_deal_id ? { id: row.dup_deal_id, companyName: row.dup_deal_company ?? "" } : null,
        chainBrand: row?.chain_brand ?? null,
      };
    },
    retry: false,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/lib/referrals.test.ts src/features/partners/hooks/useFormSubmissionQueue.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/partners/lib/referrals.ts apps/app/src/features/partners/lib/referrals.test.ts apps/app/src/features/partners/hooks/useFormSubmissionQueue.ts apps/app/src/features/partners/hooks/useFormSubmissionQueue.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): read the form submission queue and triage advice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rep app triage mutations for submissions

**Files:**
- Create: `apps/app/src/features/partners/hooks/useFormSubmissionMutations.ts`
- Test: `apps/app/src/features/partners/hooks/useFormSubmissionMutations.test.tsx`

**Interfaces:**
- Consumes (SQL, Task 2): `attribute_form_submission`, `accept_form_submission`, `decline_form_submission`, `merge_form_submission`, `reassign_form_submission`; (TS) `referralErrorMessage`, `DeclineReason` (Task 7), `DEALS_QUERY_KEY` from `@/features/pipeline/hooks/useDeals`.
- Produces (TS), each a TanStack `useMutation` whose error is an `Error` carrying display copy:
  - `useAttributeFormSubmission()`: input `{ submissionId: string; partnerId: string }`, resolves the new referral id (`string`).
  - `useAcceptFormSubmission()`: input `string` (submission id), resolves the new deal id (`string`); refreshes referrals, deals and tasks.
  - `useDeclineFormSubmission()`: input `{ submissionId: string; reason: DeclineReason; note?: string }`, resolves `void`.
  - `useMergeFormSubmission()`: input `{ submissionId: string; dealId: string }`, resolves `void`; refreshes referrals and deals.
  - `useReassignFormSubmission()`: input `{ submissionId: string; userId: string }`, resolves `void`.
  - Every one invalidates `["referrals"]` on success.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/hooks/useFormSubmissionMutations.test.tsx`:

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

import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import {
  useAcceptFormSubmission,
  useAttributeFormSubmission,
  useDeclineFormSubmission,
  useMergeFormSubmission,
  useReassignFormSubmission,
} from "./useFormSubmissionMutations";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("form submission mutations", () => {
  it("attributes to a partner and returns the new referral id", async () => {
    rpcMock.mockResolvedValueOnce({ data: "r-new", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAttributeFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync({ submissionId: "s-1", partnerId: "p-1" })).resolves.toBe("r-new");
    expect(rpcMock).toHaveBeenCalledWith("attribute_form_submission", { p_submission_id: "s-1", p_partner_id: "p-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("accepts with no partner, returns the deal id and refreshes deals and tasks", async () => {
    rpcMock.mockResolvedValueOnce({ data: "d-new", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAcceptFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync("s-1")).resolves.toBe("d-new");
    expect(rpcMock).toHaveBeenCalledWith("accept_form_submission", { p_submission_id: "s-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: DEALS_QUERY_KEY("user-1") }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "user-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] });
  });

  it("declines with a trimmed note, or none", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", reason: "outside_icp", note: "  Too small " });
    expect(rpcMock).toHaveBeenLastCalledWith("decline_form_submission", { p_submission_id: "s-1", p_reason: "outside_icp", p_note: "Too small" });
    await result.current.mutateAsync({ submissionId: "s-1", reason: "duplicate", note: "  " });
    expect(rpcMock).toHaveBeenLastCalledWith("decline_form_submission", { p_submission_id: "s-1", p_reason: "duplicate", p_note: null });
  });

  it("merges into a deal and refreshes deals", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useMergeFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("merge_form_submission", { p_submission_id: "s-1", p_deal_id: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: DEALS_QUERY_KEY("user-1") }));
  });

  it("reassigns to a teammate", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReassignFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", userId: "u-2" });
    expect(rpcMock).toHaveBeenCalledWith("reassign_form_submission", { p_submission_id: "s-1", p_user_id: "u-2" });
  });

  it("turns a server token into copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "submission_handled" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync("s-1")).rejects.toThrow("This referral was already handled.");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useFormSubmissionMutations.test.tsx`
Expected: FAIL: `./useFormSubmissionMutations` does not exist.

- [ ] **Step 3: Implement `apps/app/src/features/partners/hooks/useFormSubmissionMutations.ts`**

```ts
/**
 * Triage mutations for public form submissions (migration 20261020000002).
 * With a partner, useAttributeFormSubmission turns the submission into a
 * referral and the review sheet finishes with the referral mutations in
 * useReferralMutations. With no partner, accept, decline and merge act on the
 * submission itself. Each refreshes every referrals query (both queues).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { referralErrorMessage, type DeclineReason } from "../lib/referrals";

function useRefresh(opts: { deals?: boolean; tasks?: boolean } = {}) {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    if (opts.deals) void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    if (opts.tasks) void queryClient.invalidateQueries({ queryKey: ["tasks", userId ?? "anon"] });
  };
}

export function useAttributeFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; partnerId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("attribute_form_submission", {
        p_submission_id: input.submissionId,
        p_partner_id: input.partnerId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't save who sent it"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useAcceptFormSubmission() {
  // Accepting creates a deal and its first follow-up task.
  const refresh = useRefresh({ deals: true, tasks: true });
  return useMutation({
    mutationFn: async (submissionId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_form_submission", { p_submission_id: submissionId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't accept the referral"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useDeclineFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; reason: DeclineReason; note?: string }): Promise<void> => {
      const { error } = await supabase.rpc("decline_form_submission", {
        p_submission_id: input.submissionId,
        p_reason: input.reason,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't decline the referral"));
    },
    onSuccess: refresh,
  });
}

export function useMergeFormSubmission() {
  const refresh = useRefresh({ deals: true });
  return useMutation({
    mutationFn: async (input: { submissionId: string; dealId: string }): Promise<void> => {
      const { error } = await supabase.rpc("merge_form_submission", {
        p_submission_id: input.submissionId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't merge the referral"));
    },
    onSuccess: refresh,
  });
}

export function useReassignFormSubmission() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { submissionId: string; userId: string }): Promise<void> => {
      const { error } = await supabase.rpc("reassign_form_submission", {
        p_submission_id: input.submissionId,
        p_user_id: input.userId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't reassign the referral"));
    },
    onSuccess: refresh,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/hooks/useFormSubmissionMutations.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/hooks/useFormSubmissionMutations.ts apps/app/src/features/partners/hooks/useFormSubmissionMutations.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): triage mutations for form submissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: The review sheet for a form submission

**Files:**
- Create: `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx`
- Test: `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.test.tsx`

**Interfaces:**
- Consumes (TS): `QueueSubmission`, `useFormSubmissionAdvice` (Task 7); `useAttributeFormSubmission`, `useAcceptFormSubmission`, `useDeclineFormSubmission`, `useMergeFormSubmission`, `useReassignFormSubmission` (Task 8); existing `useAcceptReferral` (resolves `{ result: "accepted" | "duplicate"; dealId }`), `useDeclineReferral` (`{ referralId, reason, note }`), `useMergeReferral` (`{ referralId, dealId }`) from `../hooks/useReferralMutations`; `useReferralAssignees(enabled)` from `../hooks/useReassignReferral`; `usePartners()`, `useCreatePartner()` (input `CreatePartnerInput`, resolves `{ id }`); `useDeals()`; `useProfile()`; `useAuth`; `phoneToE164`, `normalizeEmail` from `@/lib/contactValidation`; `SUBMISSION_DECLINE_REASON_OPTIONS`, `canReassignReferrals`, `formSubmissionSourceLabel`, `icpFlagLabels` from `../lib/referrals`.
- Produces (TS): `ReviewFormSubmissionSheet({ submission, open, onOpenChange }: { submission: QueueSubmission | null; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element | null` (Task 10 renders it).

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewFormSubmissionSheet } from "./ReviewFormSubmissionSheet";
import type { QueueSubmission } from "../hooks/useFormSubmissionQueue";

const attribute = vi.fn();
const acceptSubmission = vi.fn();
const declineSubmission = vi.fn();
const mergeSubmission = vi.fn();
const reassignSubmission = vi.fn();
vi.mock("../hooks/useFormSubmissionMutations", () => ({
  useAttributeFormSubmission: () => ({ mutateAsync: attribute, isPending: false }),
  useAcceptFormSubmission: () => ({ mutateAsync: acceptSubmission, isPending: false }),
  useDeclineFormSubmission: () => ({ mutateAsync: declineSubmission, isPending: false }),
  useMergeFormSubmission: () => ({ mutateAsync: mergeSubmission, isPending: false }),
  useReassignFormSubmission: () => ({ mutateAsync: reassignSubmission, isPending: false }),
}));
const acceptReferral = vi.fn();
const declineReferral = vi.fn();
const mergeReferral = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useAcceptReferral: () => ({ mutateAsync: acceptReferral, isPending: false }),
  useDeclineReferral: () => ({ mutateAsync: declineReferral, isPending: false }),
  useMergeReferral: () => ({ mutateAsync: mergeReferral, isPending: false }),
}));
const adviceState: { data: unknown } = { data: undefined };
vi.mock("../hooks/useFormSubmissionQueue", () => ({ useFormSubmissionAdvice: () => adviceState }));
vi.mock("../hooks/usePartners", () => ({
  usePartners: () => ({ data: [
    { id: "p-1", name: "Jane CPA", company: "Jane & Co" },
    { id: "p-2", name: "Bob CPA", company: "Bob & Co" },
  ] }),
}));
const createPartner = vi.fn();
vi.mock("../hooks/useCreatePartner", () => ({ useCreatePartner: () => ({ mutateAsync: createPartner, isPending: false }) }));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [
    { id: "d-1", companyName: "Zed Cafe", stage: "contacted" },
    { id: "d-2", companyName: "Alpha Gym", stage: "new" },
    { id: "d-3", companyName: "Closed Co", stage: "won" },
  ] }),
}));
const profileState: { data: { role: string; role_level: string } | null } = {
  data: { role: "rep", role_level: "sales_professional" },
};
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => profileState }));
const assigneesState: { data: Array<{ id: string; name: string }> | undefined } = { data: undefined };
vi.mock("../hooks/useReassignReferral", () => ({ useReferralAssignees: () => assigneesState }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    Select: ({ value, onValueChange, options, placeholder }: {
      value?: string; onValueChange?: (v: string) => void;
      options: Array<{ value: string; label: string }>; placeholder?: string;
    }) => (
      <select aria-label={placeholder} value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="">--</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});

const submission: QueueSubmission = {
  id: "s-1", linkType: "user", assignedUserId: "user-1", companyName: "Fresh Bakery",
  contactName: "Ann", contactEmail: "ann@fresh.example", contactPhone: "512-555-0100",
  notes: "Wants a demo", referredByText: "Jane at Jane & Co", referrerEmail: "jane@janeco.example",
  submittedAt: "2026-10-20T15:00:00Z",
};

function renderSheet(s: QueueSubmission = submission) {
  const onOpenChange = vi.fn();
  render(<ReviewFormSubmissionSheet submission={s} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

async function pickExistingPartner(id = "p-1") {
  await userEvent.click(screen.getByRole("button", { name: "A partner" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a partner…" }), id);
}

beforeEach(() => {
  for (const f of [attribute, acceptSubmission, declineSubmission, mergeSubmission, reassignSubmission,
    acceptReferral, declineReferral, mergeReferral, createPartner, toastSuccess, toastError]) f.mockReset();
  adviceState.data = undefined;
  profileState.data = { role: "rep", role_level: "sales_professional" };
  assigneesState.data = [{ id: "user-1", name: "Rita Rep" }, { id: "u-2", name: "Rob Rep" }];
  attribute.mockResolvedValue("r-new");
  acceptReferral.mockResolvedValue({ result: "accepted", dealId: "d-9" });
  createPartner.mockResolvedValue({ id: "p-new" });
});

describe("ReviewFormSubmissionSheet", () => {
  it("shows what the sender typed, where it came from and the advice", () => {
    adviceState.data = {
      duplicateReferral: { id: "r-9", companyName: "Corner Cafe" },
      duplicateDeal: { id: "d-1", companyName: "Zed Cafe" },
      chainBrand: "Subway",
    };
    renderSheet();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText("From your referral form")).toBeInTheDocument();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ann@fresh.example" })).toHaveAttribute("href", "mailto:ann@fresh.example");
    expect(screen.getByRole("button", { name: /call \(512\) 555-0100/i })).toBeInTheDocument();
    expect(screen.getByText("Jane at Jane & Co")).toBeInTheDocument();
    expect(screen.getByText("jane@janeco.example")).toBeInTheDocument();
    expect(screen.getByText("Wants a demo")).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate: Zed Cafe is already in your team's pipeline.")).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate of an open referral: Corner Cafe.")).toBeInTheDocument();
    expect(screen.getByText("Looks like a chain: Subway. Check before accepting.")).toBeInTheDocument();
  });

  it("does not call a teammate's form 'your' form", () => {
    renderSheet({ ...submission, assignedUserId: "user-2" });
    expect(screen.getByText("From a rep's referral form")).toBeInTheDocument();
  });

  it("keeps the actions off until you say who sent it", async () => {
    renderSheet();
    expect(screen.getByText("Say who sent this to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "A partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    expect(screen.getByRole("button", { name: "No partner" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("no partner: accept creates the deal from the submission", async () => {
    acceptSubmission.mockResolvedValueOnce("d-new");
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(acceptSubmission).toHaveBeenCalledWith("s-1");
    expect(attribute).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Accepted. Deal created.");
  });

  it("a partner: search narrows the list, then it becomes a referral and is accepted", async () => {
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "A partner" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search partners" }), "jane");
    const picker = screen.getByRole("combobox", { name: "Pick a partner…" });
    expect(within(picker).queryByText("Bob CPA · Bob & Co")).toBeNull();
    await userEvent.selectOptions(picker, "p-1");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(attribute).toHaveBeenCalledWith({ submissionId: "s-1", partnerId: "p-1" });
    expect(acceptReferral).toHaveBeenCalledWith("r-new");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("a new partner: created once, then the referral is declined with a reason", async () => {
    declineReferral.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "New partner" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Partner name" }), "Pat");
    await userEvent.type(screen.getByRole("textbox", { name: "Partner phone" }), "5550001234");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const reasons = screen.getByRole("combobox", { name: "Pick a reason…" });
    expect(within(reasons).queryByText("Partner withdrew it")).toBeNull();
    await userEvent.selectOptions(reasons, "outside_icp");
    await userEvent.click(screen.getByRole("button", { name: "Decline referral" }));
    expect(createPartner).toHaveBeenCalledWith({
      name: "Pat", company: "", type: "other", email: undefined, phone: "+15550001234",
    });
    expect(attribute).toHaveBeenCalledWith({ submissionId: "s-1", partnerId: "p-new" });
    expect(declineReferral).toHaveBeenCalledWith({ referralId: "r-new", reason: "outside_icp", note: "" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Referral declined"));
  });

  it("a duplicate on accept moves to merge on the same referral, without attributing again", async () => {
    acceptReferral.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    mergeReferral.mockResolvedValueOnce(undefined);
    renderSheet();
    await pickExistingPartner();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Already in your team's pipeline");
    expect(screen.getByRole("combobox", { name: "Pick a deal…" })).toHaveValue("d-1");
    expect(screen.getByRole("button", { name: "No partner" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeReferral).toHaveBeenCalledWith({ referralId: "r-new", dealId: "d-1" });
    expect(attribute).toHaveBeenCalledTimes(1);
  });

  it("a failed step keeps the new partner, so a retry never creates it twice", async () => {
    attribute.mockReset();
    attribute.mockRejectedValueOnce(new Error("Couldn't save who sent it")).mockResolvedValueOnce("r-new");
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "New partner" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Partner name" }), "Pat");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save who sent it"));
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptReferral).toHaveBeenCalledWith("r-new"));
    expect(createPartner).toHaveBeenCalledTimes(1);
    expect(attribute).toHaveBeenCalledTimes(2);
    expect(attribute).toHaveBeenLastCalledWith({ submissionId: "s-1", partnerId: "p-new" });
  });

  it("no partner: decline acts on the submission", async () => {
    declineSubmission.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const submit = screen.getByRole("button", { name: "Decline referral" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pick a reason…" }), "duplicate");
    await userEvent.click(submit);
    expect(declineSubmission).toHaveBeenCalledWith({ submissionId: "s-1", reason: "duplicate", note: "" });
    expect(declineReferral).not.toHaveBeenCalled();
  });

  it("no partner: merge offers open deals only and acts on the submission", async () => {
    mergeSubmission.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "No partner" }));
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    const deals = screen.getByRole("combobox", { name: "Pick a deal…" });
    expect(within(deals).queryByText("Closed Co")).toBeNull();
    await userEvent.selectOptions(deals, "d-2");
    await userEvent.click(screen.getByRole("button", { name: "Merge into deal" }));
    expect(mergeSubmission).toHaveBeenCalledWith({ submissionId: "s-1", dealId: "d-2" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Merged into the existing deal"));
  });

  it("reps do not get Reassign", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  });

  it("a manager reassigns before anyone says who sent it", async () => {
    profileState.data = { role: "manager", role_level: "sales_manager" };
    reassignSubmission.mockResolvedValueOnce(undefined);
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const picker = screen.getByRole("combobox", { name: "Pick a teammate…" });
    expect(within(picker).queryByText("Rita Rep")).toBeNull();
    await userEvent.selectOptions(picker, "u-2");
    await userEvent.click(screen.getByRole("button", { name: "Reassign referral" }));
    expect(reassignSubmission).toHaveBeenCalledWith({ submissionId: "s-1", userId: "u-2" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Reassigned to Rob Rep");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/components/ReviewFormSubmissionSheet.test.tsx`
Expected: FAIL: `./ReviewFormSubmissionSheet` does not exist.

- [ ] **Step 3: Implement `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx`**

```tsx
// apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx
/**
 * ReviewFormSubmissionSheet: triage one public referral form submission
 * (FR-PORT-32). Step 1 says who sent it: a partner the reviewer can see, a new
 * partner (created now, owned by the reviewer), or no partner. Step 2 is the
 * same Accept / Merge / Decline as a referral:
 *   - with a partner, the submission first becomes a referral
 *     (attribute_form_submission) and the existing referral RPCs finish it.
 *     The referral id (and a newly created partner's id) is kept, so a failed
 *     or duplicate accept never attributes twice or creates the partner twice;
 *   - with no partner, the submission RPCs act on it directly (accept makes a
 *     deal with lead source Inbound and the first follow-up task).
 * Advisory lines (possible duplicate, looks like a chain) never block.
 * Managers and administrators can reassign it before anyone says who sent it.
 * Same Radix Dialog shell and copy style as ReviewReferralSheet.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, NotesFieldWithMic, PhoneWithClickToCall, Select } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { normalizeEmail, phoneToE164 } from "@/lib/contactValidation";
import { useAuth } from "@/stores/auth";
import { useCreatePartner } from "../hooks/useCreatePartner";
import { usePartners } from "../hooks/usePartners";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { useReferralAssignees } from "../hooks/useReassignReferral";
import { useFormSubmissionAdvice, type QueueSubmission } from "../hooks/useFormSubmissionQueue";
import {
  useAcceptFormSubmission,
  useAttributeFormSubmission,
  useDeclineFormSubmission,
  useMergeFormSubmission,
  useReassignFormSubmission,
} from "../hooks/useFormSubmissionMutations";
import {
  SUBMISSION_DECLINE_REASON_OPTIONS,
  canReassignReferrals,
  formSubmissionSourceLabel,
  icpFlagLabels,
  type DeclineReason,
} from "../lib/referrals";

type Mode = "main" | "decline" | "merge" | "reassign";
type Who = "existing" | "new" | "none";

const WHO_OPTIONS: Array<{ value: Who; label: string }> = [
  { value: "existing", label: "A partner" },
  { value: "new", label: "New partner" },
  { value: "none", label: "No partner" },
];

const EMPTY_PARTNER = { name: "", company: "", email: "", phone: "" };
type NewPartnerField = keyof typeof EMPTY_PARTNER;

export interface ReviewFormSubmissionSheetProps {
  submission: QueueSubmission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReviewFormSubmissionSheet({ submission, open, onOpenChange }: ReviewFormSubmissionSheetProps) {
  const viewerId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const canReassign = canReassignReferrals(profile.data);
  const assignees = useReferralAssignees(open && canReassign);
  const { data: partners = [] } = usePartners();
  const { data: deals = [] } = useDeals();
  const advice = useFormSubmissionAdvice(open ? submission?.id ?? null : null);
  const createPartner = useCreatePartner();
  const attribute = useAttributeFormSubmission();
  const acceptSubmission = useAcceptFormSubmission();
  const declineSubmission = useDeclineFormSubmission();
  const mergeSubmission = useMergeFormSubmission();
  const reassign = useReassignFormSubmission();
  const acceptReferral = useAcceptReferral();
  const declineReferral = useDeclineReferral();
  const mergeReferral = useMergeReferral();

  const [mode, setMode] = React.useState<Mode>("main");
  const [who, setWho] = React.useState<Who | null>(null);
  const [search, setSearch] = React.useState("");
  const [partnerId, setPartnerId] = React.useState("");
  const [newPartner, setNewPartner] = React.useState(EMPTY_PARTNER);
  const [createdPartnerId, setCreatedPartnerId] = React.useState<string | null>(null);
  const [referralId, setReferralId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submissionId = submission?.id;
  React.useEffect(() => {
    setMode("main");
    setWho(null);
    setSearch("");
    setPartnerId("");
    setNewPartner(EMPTY_PARTNER);
    setCreatedPartnerId(null);
    setReferralId(null);
    setReason("");
    setNote("");
    setMergeDealId("");
    setAssigneeId("");
    // Keyed on the submission id so a refetch with a new object does not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submissionId]);

  const partnerOptions = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.company ? `${p.name} · ${p.company}` : p.name }));
  }, [partners, search]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  const currentAssigneeId = submission?.assignedUserId ?? null;
  const assigneeOptions = React.useMemo(
    () => (assignees.data ?? [])
      .filter((a) => a.id !== currentAssigneeId)
      .map((a) => ({ value: a.id, label: a.name })),
    [assignees.data, currentAssigneeId],
  );

  if (!submission) return null;

  const attributed = referralId !== null;
  const viaPartner = attributed || who === "existing" || who === "new";
  const whoReady =
    attributed ||
    who === "none" ||
    (who === "existing" && partnerId !== "") ||
    (who === "new" && newPartner.name.trim() !== "");
  const pickedName = (assignees.data ?? []).find((a) => a.id === assigneeId)?.name?.trim() || null;
  const chainLines = icpFlagLabels(advice.data?.chainBrand ? [`chain:${advice.data.chainBrand}`] : []);
  const received = new Date(submission.submittedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const setField = (k: NewPartnerField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setNewPartner((p) => ({ ...p, [k]: e.target.value }));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const done = (message: string) => {
    toast.success(message);
    onOpenChange(false);
  };

  // The referral this submission becomes. Made once; every later step reuses it.
  const ensureReferral = async (): Promise<string> => {
    if (referralId) return referralId;
    let pid = who === "new" ? createdPartnerId : partnerId;
    if (who === "new" && !pid) {
      const created = await createPartner.mutateAsync({
        name: newPartner.name.trim(),
        company: newPartner.company.trim(),
        type: "other",
        email: normalizeEmail(newPartner.email) ?? undefined,
        phone: phoneToE164(newPartner.phone) ?? undefined,
      });
      pid = created.id;
      setCreatedPartnerId(created.id);
    }
    const rid = await attribute.mutateAsync({ submissionId: submission.id, partnerId: pid as string });
    setReferralId(rid);
    return rid;
  };

  const onAccept = () => run(async () => {
    if (!viaPartner) {
      await acceptSubmission.mutateAsync(submission.id);
      done("Accepted. Deal created.");
      return;
    }
    const rid = await ensureReferral();
    const res = await acceptReferral.mutateAsync(rid);
    if (res.result === "accepted") {
      done("Accepted. Deal created.");
      return;
    }
    toast.error("Already in your team's pipeline");
    setMergeDealId(res.dealId ?? "");
    setMode("merge");
  });

  const onDecline = () => run(async () => {
    if (!reason) return;
    if (viaPartner) {
      const rid = await ensureReferral();
      await declineReferral.mutateAsync({ referralId: rid, reason, note });
    } else {
      await declineSubmission.mutateAsync({ submissionId: submission.id, reason, note });
    }
    done("Referral declined");
  });

  const onMerge = () => run(async () => {
    if (!mergeDealId) return;
    if (viaPartner) {
      const rid = await ensureReferral();
      await mergeReferral.mutateAsync({ referralId: rid, dealId: mergeDealId });
    } else {
      await mergeSubmission.mutateAsync({ submissionId: submission.id, dealId: mergeDealId });
    }
    done("Merged into the existing deal");
  });

  const onReassign = () => run(async () => {
    if (!assigneeId) return;
    await reassign.mutateAsync({ submissionId: submission.id, userId: assigneeId });
    done(`Reassigned to ${pickedName ?? "that teammate"}`);
  });

  const details: Array<[string, React.ReactNode]> = [
    ["Contact", submission.contactName],
    ["Phone", submission.contactPhone ? <PhoneWithClickToCall phoneNumber={submission.contactPhone} /> : null],
    ["Email", submission.contactEmail ? (
      <a href={`mailto:${submission.contactEmail}`} className="text-accent-blue hover:underline">
        {submission.contactEmail}
      </a>
    ) : null],
    ["Who referred", submission.referredByText],
    ["Sender's email", submission.referrerEmail],
    ["Received", received],
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
            <span className="text-body-strong text-text-default">{submission.companyName}</span>
            <span className="text-caption text-text-muted">
              {formSubmissionSourceLabel(submission.linkType, submission.assignedUserId === viewerId)}
            </span>
          </div>

          <dl className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-caption text-text-subtle">{k}</dt>
                <dd className="text-body-md text-text-default">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {submission.notes && (
            <p className="whitespace-pre-wrap text-body-md text-text-muted">{submission.notes}</p>
          )}

          {chainLines.map((f) => (
            <p key={f} className="rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-muted">
              {f}. Check before accepting.
            </p>
          ))}
          {advice.data?.duplicateDeal && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {advice.data.duplicateDeal.companyName} is already in your team's pipeline.
            </p>
          )}
          {advice.data?.duplicateReferral && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate of an open referral: {advice.data.duplicateReferral.companyName}.
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-text-muted">Who sent this?</legend>
            <div className="grid grid-cols-3 gap-2">
              {WHO_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="lg"
                  variant={who === o.value ? "primary" : "secondary"}
                  aria-pressed={who === o.value}
                  disabled={attributed || busy}
                  onClick={() => setWho(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            {who === "existing" && (
              <div className="flex flex-col gap-2">
                <Input
                  aria-label="Search partners"
                  placeholder="Search partners"
                  value={search}
                  disabled={attributed || busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  value={partnerId}
                  onValueChange={setPartnerId}
                  placeholder="Pick a partner…"
                  options={partnerOptions}
                />
                {partners.length === 0 && (
                  <p className="text-caption text-text-subtle">No partners yet. Pick New partner to add one.</p>
                )}
              </div>
            )}
            {who === "new" && (
              <div className="flex flex-col gap-2">
                <Input aria-label="Partner name" placeholder="Name (required)" value={newPartner.name} disabled={attributed || busy} onChange={setField("name")} />
                <Input aria-label="Partner company" placeholder="Company" value={newPartner.company} disabled={attributed || busy} onChange={setField("company")} />
                <Input aria-label="Partner email" type="email" placeholder="Email" value={newPartner.email} disabled={attributed || busy} onChange={setField("email")} />
                <Input aria-label="Partner phone" type="tel" placeholder="Phone" value={newPartner.phone} disabled={attributed || busy} onChange={setField("phone")} />
              </div>
            )}
          </fieldset>

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              {!whoReady && <p className="text-caption text-text-subtle">Say who sent this to continue.</p>}
              <Button variant="primary" size="lg" loading={busy} disabled={!whoReady || busy} onClick={onAccept}>
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={!whoReady || busy} onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" size="lg" className="flex-1" disabled={!whoReady || busy} onClick={() => setMode("decline")}>Decline</Button>
              </div>
              {canReassign && !attributed && (
                <Button variant="tertiary" size="lg" disabled={busy} onClick={() => setMode("reassign")}>
                  Reassign
                </Button>
              )}
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
                  options={SUBMISSION_DECLINE_REASON_OPTIONS}
                />
              </label>
              <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button variant="primary" size="lg" className="flex-1" disabled={!reason || !whoReady || busy} loading={busy} onClick={onDecline}>
                  Decline referral
                </Button>
              </div>
            </div>
          )}

          {mode === "merge" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Existing deal</span>
                <Select value={mergeDealId} onValueChange={setMergeDealId} placeholder="Pick a deal…" options={openDeals} />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button variant="primary" size="lg" className="flex-1" disabled={!mergeDealId || !whoReady || busy} loading={busy} onClick={onMerge}>
                  Merge into deal
                </Button>
              </div>
            </div>
          )}

          {mode === "reassign" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">New owner</span>
                <Select value={assigneeId} onValueChange={setAssigneeId} placeholder="Pick a teammate…" options={assigneeOptions} />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button variant="primary" size="lg" className="flex-1" disabled={!assigneeId || busy} loading={busy} onClick={onReassign}>
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

export default ReviewFormSubmissionSheet;
```

- [ ] **Step 4: Run the tests to verify they pass, and that ReviewReferralSheet is untouched**

Run: `pnpm --filter app test -- src/features/partners/components/ReviewFormSubmissionSheet.test.tsx src/features/partners/components/ReviewReferralSheet.test.tsx`
Expected: PASS, no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx apps/app/src/features/partners/components/ReviewFormSubmissionSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): review sheet for public form submissions (who sent it, then accept, merge or decline)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 10: Submissions in the "Referrals to review" queue

**Files:**
- Modify: `apps/app/src/features/partners/components/ReferralQueueCard.tsx`
- Test: `apps/app/src/features/partners/components/ReferralQueueCard.test.tsx`

**Interfaces:**
- Consumes (TS): `useReferralQueue`, `QueueReferral`, `ReviewReferralSheet` (existing); `useFormSubmissionQueue`, `QueueSubmission` (Task 7); `formSubmissionSourceLabel` (Task 7); `ReviewFormSubmissionSheet` (Task 9); `useAuth`.
- Produces (TS): `ReferralQueueCard({ partnerId }: { partnerId?: string })`, same props. PartnersPage and PartnerDetailPage need no change (PartnerDetailPage passes `partnerId`, so it never lists submissions).

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/features/partners/components/ReferralQueueCard.test.tsx`, add these imports and mocks below the existing `vi.mock("./ReviewReferralSheet", ...)`:

```tsx
import type { QueueSubmission } from "../hooks/useFormSubmissionQueue";

let submissions: QueueSubmission[] | undefined;
vi.mock("../hooks/useFormSubmissionQueue", () => ({ useFormSubmissionQueue: () => ({ data: submissions }) }));
vi.mock("./ReviewFormSubmissionSheet", () => ({
  ReviewFormSubmissionSheet: ({ submission, open }: { submission: QueueSubmission | null; open: boolean }) =>
    open ? <div data-testid="submission-sheet">{submission?.companyName}</div> : null,
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

function sub(id: string, companyName: string, submittedAt: string, linkType: "user" | "tenant", assignedUserId: string | null): QueueSubmission {
  return {
    id, linkType, assignedUserId, companyName, contactName: null, contactEmail: null, contactPhone: null,
    notes: null, referredByText: null, referrerEmail: null, submittedAt,
  };
}
```

Change the existing `beforeEach` to `beforeEach(() => { queue = undefined; submissions = undefined; });`, then append inside `describe("ReferralQueueCard", ...)`:

```tsx
  it("lists form submissions with referrals, oldest first, labelled by where they came from", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery")]; // 2026-10-07
    submissions = [
      sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1"),
      sub("s-2", "Bolt Gym", "2026-10-08T12:00:00Z", "tenant", null),
      sub("s-3", "Desk Co", "2026-10-09T12:00:00Z", "user", "user-2"),
    ];
    render(<ReferralQueueCard />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Review / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Review Corner Cafe", "Review Fresh Bakery", "Review Bolt Gym", "Review Desk Co",
    ]);
    expect(screen.getByText("From your referral form")).toBeInTheDocument();
    expect(screen.getByText("From the company form")).toBeInTheDocument();
    expect(screen.getByText("From a rep's referral form")).toBeInTheDocument();
    expect(screen.getByText("From Jane")).toBeInTheDocument();
  });

  it("a partner's page never lists form submissions", () => {
    queue = [];
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    const { container } = render(<ReferralQueueCard partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the submission sheet for the clicked submission", () => {
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Corner Cafe" }));
    expect(screen.getByTestId("submission-sheet")).toHaveTextContent("Corner Cafe");
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("keeps an open sheet when the queue empties under it", () => {
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    const { rerender } = render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Corner Cafe" }));
    submissions = [];
    rerender(<ReferralQueueCard />);
    expect(screen.getByTestId("submission-sheet")).toHaveTextContent("Corner Cafe");
    expect(screen.queryByText("Referrals to review")).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/components/ReferralQueueCard.test.tsx`
Expected: the four new tests FAIL (no submissions listed); the four existing ones PASS.

- [ ] **Step 3: Replace `apps/app/src/features/partners/components/ReferralQueueCard.tsx`**

```tsx
/**
 * ReferralQueueCard: partner referrals and public form submissions waiting for
 * triage, oldest first. Hidden when there are none, so it costs no space on a
 * normal day. On Partner Detail it is filtered to that partner, and form
 * submissions (no partner yet) are left out. An open review sheet stays mounted
 * even if the queue empties under it (an attribution refetch), so it never
 * vanishes mid-flow.
 */
import * as React from "react";
import { Card, Button } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { useReferralQueue, type QueueReferral } from "../hooks/useReferralQueue";
import { useFormSubmissionQueue, type QueueSubmission } from "../hooks/useFormSubmissionQueue";
import { formSubmissionSourceLabel } from "../lib/referrals";
import { ReviewReferralSheet } from "./ReviewReferralSheet";
import { ReviewFormSubmissionSheet } from "./ReviewFormSubmissionSheet";

type QueueItem =
  | { kind: "referral"; key: string; at: number; item: QueueReferral }
  | { kind: "submission"; key: string; at: number; item: QueueSubmission };

export function ReferralQueueCard({ partnerId }: { partnerId?: string }) {
  const { data } = useReferralQueue();
  const { data: submissions } = useFormSubmissionQueue();
  const viewerId = useAuth((s) => s.user?.id);
  const [active, setActive] = React.useState<QueueReferral | null>(null);
  const [activeSubmission, setActiveSubmission] = React.useState<QueueSubmission | null>(null);

  const items = React.useMemo<QueueItem[]>(() => {
    const referrals: QueueItem[] = (data ?? [])
      .filter((r) => !partnerId || r.partnerId === partnerId)
      .map((r) => ({ kind: "referral" as const, key: `r:${r.id}`, at: Date.parse(r.submittedAt), item: r }));
    const forms: QueueItem[] = partnerId
      ? []
      : (submissions ?? []).map((s) => ({ kind: "submission" as const, key: `s:${s.id}`, at: Date.parse(s.submittedAt), item: s }));
    // Stable sort: on a tie a referral stays ahead of a submission.
    return [...referrals, ...forms].sort((a, b) => a.at - b.at);
  }, [data, submissions, partnerId]);

  const sheets = (
    <>
      <ReviewReferralSheet
        referral={active}
        open={active !== null}
        onOpenChange={(o) => { if (!o) setActive(null); }}
      />
      <ReviewFormSubmissionSheet
        submission={activeSubmission}
        open={activeSubmission !== null}
        onOpenChange={(o) => { if (!o) setActiveSubmission(null); }}
      />
    </>
  );

  if (items.length === 0) return active || activeSubmission ? sheets : null;

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Referrals to review</h3>
        <span className="rounded-full bg-status-warning-bg px-2 text-caption font-medium tabular-nums text-status-warning">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((q) => (
          <li key={q.key} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-md text-text-default">{q.item.companyName}</span>
              <span className="truncate text-caption text-text-muted">
                {q.kind === "referral"
                  ? `From ${q.item.partnerName}`
                  : formSubmissionSourceLabel(q.item.linkType, q.item.assignedUserId === viewerId)}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Review ${q.item.companyName}`}
              onClick={() => {
                if (q.kind === "referral") setActive(q.item);
                else setActiveSubmission(q.item);
              }}
            >
              Review
            </Button>
          </li>
        ))}
      </ul>
      {sheets}
    </Card>
  );
}

export default ReferralQueueCard;
```

- [ ] **Step 4: Run the tests to verify they pass, plus the pages that render the card**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS (including `PartnersPage.regression-001.test.tsx` and `PartnerDetailPage.test.tsx`), no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/components/ReferralQueueCard.tsx apps/app/src/features/partners/components/ReferralQueueCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): form submissions in Referrals to review, oldest first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Full verification, push, PR to main (the controller runs this task)

**Files:** none changed.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`059` to `062` included, `001` to `058` still passing), the documented SKIPs unchanged.

- [ ] **Step 2: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds met, no `act()` warnings from the new files, no snapshot written.

- [ ] **Step 3: Real production build and the client bundle check**

Run: `pnpm --filter app build && node tools/check-client-bundle.mjs`
Expected: both exit 0.

- [ ] **Step 4: Deno typecheck, the secrets audit, the destructive-migration check**

Run:

```bash
for f in portal_api portal_notify portal_invite; do
  NO_COLOR=1 deno check --no-lock --config supabase/functions/$f/deno.json supabase/functions/$f/index.ts || echo "FAILED $f"
done
node tools/check-secrets.mjs --audit
node tools/check-destructive-migrations.mjs
```

Expected: no `FAILED` line; `Manifest covers every secret the function code reads.`; the destructive check exits 0.

- [ ] **Step 5: No long dashes on added lines; partners never read submissions**

Run: `git diff origin/main...HEAD | perl -CSD -ne 'print if /^\+/ && /[\x{2013}\x{2014}]/'`
Expected: no output.

Run: `grep -rln "referral_form_submissions" supabase/functions apps/app/src/features/portal`
Expected: no output (only the rep app and SQL touch submissions).

- [ ] **Step 6: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal 2B-2: public form switch and submission triage" --body "$(cat <<'EOF'
## Summary
- Administrators get a "Public referral form" switch on Settings, Partner portal. It saves the moment it is flipped and only works while the portal is on. Turning the portal off keeps the setting but closes the form.
- Public form submissions now show up in "Referrals to review" next to partner referrals, oldest first, labelled "From your referral form", "From a rep's referral form" or "From the company form". Each person sees exactly what they can triage: their own, their team's for managers, and the company form queue for administrators.
- The review sheet shows what the sender typed (contact, tap to call, email, notes, who referred, the sender's own email, when it arrived) plus advice: possible duplicate of a deal or an open referral the reviewer can see, and "looks like a chain".
- Step 1 "Who sent this?": an existing partner (searchable), a new partner (created on the spot, owned by the reviewer), or no partner. With a partner it becomes a normal referral that keeps the original send time, the reviewer keeps it, and Accept, Merge and Decline work exactly like any referral. With no partner, Accept creates the reviewer's deal (lead source Inbound) with the usual first follow-up task and a deal note holding the notes and who referred; Merge adds the contact and notes to the chosen deal as a note; Decline needs a reason.
- Managers and administrators can reassign a submission before anyone says who sent it.
- The reviewer gets an email when a submission arrives ("New referral from your form: <Company>"), and waiting submissions join the same end-of-day digest as partner referrals (still one email per day).
- Privacy: once a submission becomes a referral or a deal its personal details are cleared from the submission; a declined one is cleared after the retention period (90 days by default), and one nobody triaged is cleared 90 days after it arrived. A daily job does this and logs each one.

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md
Plan: docs/superpowers/plans/2026-10-20-partner-portal-2b2-submission-triage.md

## Deviations (details in the plan)
- The switch has its own save action, so the existing portal settings save is unchanged.
- No-partner deals use lead source Inbound (there is no "referral form" lead source yet).
- "Who referred" goes into the referral's internal history note, never into notes a partner can see.
- The end-of-day digest now says "referrals" instead of "partner referrals", because it lists both.
- A partner with portal access hears Accepted or Not Moving Forward on a referral attributed to them, the same as a referral a rep logged for them. They never get a "Received" email for it.

## Not in this PR
- Referrals sent to you, partner note-back, weekly digest (2B-3).

## Test plan
- [ ] DB tests 059 to 062 pass in CI from an empty database, with 001 to 058 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging: as an administrator, Settings, Partner portal, flip "Public referral form" on; it stays off and greyed while the portal is off
- [ ] Staging: send a referral through a rep's form link; the rep gets the email and sees it in Referrals to review labelled "From your referral form"
- [ ] Staging: pick an existing partner and Accept; the deal has lead source Partner Referral and the referral shows the original send time
- [ ] Staging: send another, pick No partner and Accept; the deal has lead source Inbound, a follow-up task and a note with the notes
- [ ] Staging: send one through the company link; only administrators see it; a manager can reassign a rep's submission

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Bind the PR**

Use the ccd_pr `get_status` tool; if it does not report this PR, call `bind_pr` with its URL. Do not merge or promote without the user's go.

---

## Summary

| Task | What ships |
|---|---|
| 1 | `set_public_form_enabled`; settings reads return `public_form_enabled` |
| 2 | Triage RPCs: advice, attribute, accept, decline, merge, reassign; outcome `attributed` |
| 3 | `internal_new_submission` email trigger; submissions in the one-per-day digest |
| 4 | `purge_form_submissions` + daily job; `portal_audit_log.submission_id` |
| 5 | Email copy for a new submission; neutral digest wording |
| 6 | Admin "Public referral form" switch |
| 7 | Copy helpers, submission queue and advice hooks |
| 8 | Submission triage mutation hooks |
| 9 | `ReviewFormSubmissionSheet` |
| 10 | Submissions in "Referrals to review" |
| 11 | Verification, push, PR |

## Open questions for Ryan (product, not engineering)

1. **Partner emails after attribution.** When a reviewer says a form submission came from a partner who has portal access, that partner will get "Accepted" or "Not Moving Forward" emails and see the referral in their portal, exactly like a referral a rep logs for them (they never get "Received"). The plan keeps that consistency. Say if partners should instead never hear about referrals they did not send through the portal themselves.
2. **Lead source for "no partner" deals.** The PRD says these deals get "the tenant's referral form source", but the lead source list has no such value, so the plan uses Inbound. A dedicated "Referral form" lead source would show up separately in the Lead Source report; adding one is a taxonomy change for Robert to decide.
