# Partner Portal Phase 2B-3 (referrals sent to you, partner note-back, weekly digest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A partner sees, in their portal, every deal an ISO rep referred to them ("Sent to you"), with the contact details, the rep's note when the rep wrote it for the partner, and the current label; the partner can post a note back, which the sending rep sees on the deal and gets by email; the partner gets an email when a referral is sent to them and, unless they opt out, a weekly summary email with a one-click unsubscribe; and CSV exports are audited.

**Architecture:** Every rule lives in SQL, as in every earlier phase. `referrals` gains `partner_note_visible`; a new authenticated RPC `send_referral_to_partner` sets it and queues the partner email `partner_referral_sent`. Partners read outbound referrals through new service-role functions (`portal_list_sent_referrals`, `portal_get_sent_referral`, `portal_partner_notes`) and write notes through `portal_post_partner_note` into a new table `referral_partner_notes`, which reps read under RLS and which queues `internal_partner_note`. A new `enqueue_portal_digests(p_now)` runs next to `enqueue_portal_nudges` in the existing 2-minute `portal_notify` drain and queues one `partner_digest` per partner per ISO week; `claim_portal_emails` re-checks the digest preference at send time. `portal_api` gains three session actions (`list_sent_referrals`, `get_sent_referral`, `post_note`) and one public action (`unsubscribe_digest`, which also answers the RFC 8058 one-click POST). The portal gets a "Sent to you" section, a sent-referral page with a note composer, and an unsubscribe page; the rep app gets the partner-facing note label, the partner's notes on Deal Detail and a note count on Partner Detail.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, pg_cron through the existing portal_notify cron), Deno edge functions (portal_api, portal_notify), Resend (custom headers), React 18 + TypeScript, TanStack Query 5, React Router 6, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (patterns) and the Phase 2B-3 design brief (binding, "brief scope N" below), which implements PRD Addendum v1.0 FR-PORT-76, 77, 78, 79 (referral sent to you), 80 (partner note-back received), 83, 84, 85 and NFR-PORT-06 (exports). Format template: `docs/superpowers/plans/2026-10-20-partner-portal-2b2-submission-triage.md`. This is the last PR of the PRD.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261022000001_...` to `20261022000005_...`, applied in filename order. The latest existing migration is `20261020000004`. New enum values (`portal_audit_action` `note`, `export`, `unsubscribe`) are added ALONE in `20261022000001` (a value added by `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it). Never hand-apply SQL to staging or production. Never run a `supabase` command against a remote project while building this plan.
- Partner and public SQL is service role only: `revoke execute ... from public, anon, authenticated;` then `grant execute ... to service_role;`. Internal RPCs are `security definer`, re-check org and rights inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`. Private helpers (`_portal_*`) are revoked from `public, anon, authenticated, service_role`. Triggers and helpers called from definer functions need no grant. `search_path` is pinned on every function; pgcrypto is called as `extensions.gen_random_bytes`.
- Partners never see internal notes: the only rep-typed text a partner reads is `referral_updates.body` (1C) and, from this PR, `referrals.notes` on an OUTBOUND referral whose `partner_note_visible` is true. Backfilled and existing rows keep `partner_note_visible = false`.
- Partner note-back is its own record (`referral_partner_notes`, shown as "Note from partner"), never an `activities` row (Ryan ruling: `activities.logged_by` is NOT NULL and feeds Activity-To-Win and Persistence).
- Error tokens raised by the new SQL: `note_too_long` (rep app), `referral_not_found`, `invalid_input:body`, `rate_limited`, `not_authorized` (portal). portal_api maps them to `404 not_found`, `400 invalid_body {field:"body"}`, `429 rate_limited`, `500 server_error`.
- New copy (exact). Rep app: SendReferralSheet note label `Note for <partner name> (they will see this)` (`Note for the partner (they will see this)` before a partner is picked), placeholder `Optional. Only write what the partner should read.`; Deal Detail eyebrow `Notes from <partner name>`; Partner Detail row line `1 note from partner` / `<n> notes from partner`; error `Keep the note under 1,000 characters.`. Portal: section `Sent to you`; page headings `Sent by <rep or ISO>`, `Business contact`, `Your notes`; composer label `Add a note for <ISO>`, button `Send note`; unsubscribe page `Stop the weekly summary?`, button `Unsubscribe`, done `You won't get the weekly summary. You can turn it back on in your profile.`. Emails: `<ISO> sent you a referral: <Company>`; `Your weekly referral summary from <ISO>`; footer link `Unsubscribe from the weekly summary`; internal `New partner note: <Company>`.
- Partner copy names the ISO and never says "navigatr" (except the locked "Powered by navigatr" email footer line from the template) and never shows an internal status, stage, reason, source or value outside the rules. Touch targets in the portal are at least 44px (`size="lg"` buttons, `min-h-11` or `min-h-14` links).
- The weekly summary is the ONLY email with an unsubscribe link or `List-Unsubscribe` headers. Sign-in codes, invites and every transactional email never carry them (FR-PORT-84); Task 12 asserts it.
- DB tests: plain psql scripts `supabase/tests/063_referral_sent_to_partner.sql`, `064_portal_sent_referrals.sql`, `065_portal_digest.sql`, `066_partner_notes_purge.sql`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Assert privileges with `has_function_privilege` / `has_table_privilege`, never by calling something the role cannot execute (local Postgres 17.6 segfaults on a live function-level permission denied). Switch back with `perform set_config('role', 'postgres', true);`.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. One file: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/NNN_name.sql`.
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. `_shared` tests: `pnpm --filter app test -- ../../supabase/functions/_shared/<file>.test.ts`. Tests live next to source. No `act()` warnings. Node 25 needs the in-memory `localStorage` shim already used by the portal page tests.
- Before any push: `pnpm --filter app build` (`tsc -b && vite build`) and `node tools/check-client-bundle.mjs` must pass.
- Existing behavior is preserved: DB tests `001` to `062` and every existing vitest file pass, except the assertions this plan updates on purpose (Deviations 13 and 14): the four export tests in `portalReferralApi.test.ts`, three summary/call-order assertions in `portalNotify.test.ts`, the `useReferDeal` RPC-name assertions, and the portal API mocks that gain new functions.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A rep's internal note reaching a partner.** Old outbound rows (backfilled from `partner_deals`, written before partners could read anything), "Refer a deal" on Partner Detail, and stale PWA clients calling `refer_deal_to_partner` all carry `partner_note_visible = false`, so the portal and the email show no note. Pinned in Task 1 (063 sections 3 and 4), Task 2 (064 section 3, `rep_note` null for a row whose notes are internal) and Task 12 (the audit feeds a hostile row).
2. **A partner who unsubscribed (or whose identity was erased) after the digest was queued.** Expected: nothing is sent. Pinned in Task 3 (065 section 6: `claim_portal_emails` drops a digest whose user now has the preference off) and Task 4 (066: `portal_purge_user` drops queued rows and nulls the token in payloads).
3. **A mail scanner or link previewer opening the unsubscribe link.** Expected: no side effect from a GET; the page needs a button press, and the edge refuses anything but POST. Pinned in Task 8 (GET answers 405 and calls nothing) and Task 11 (no API call until the button is pressed).
4. **The digest firing at the wrong time or twice.** Expected: once per partner per ISO week, at or after Monday 08:00 in the partner owner's time zone, never before, never twice, and nothing for a quiet week. Pinned in Task 3 (065 sections 2 to 4: 07:00 local queues nothing, 08:30 queues one, a re-run queues nothing, a quiet partner gets nothing).
5. **Note-back abuse or misdirection**: a flood of notes, a note on another partner's referral, on an inbound referral, or on a purged one. Expected: 20 per portal user per hour, and every other case looks like a missing referral. Pinned in Task 2 (064 section 4) and Task 7 (the 404 and 429 mappings).

---

## File map

**Create**
- `supabase/migrations/20261022000001_portal_audit_actions_2b3.sql`: `portal_audit_action` gains `note`, `export`, `unsubscribe`.
- `supabase/migrations/20261022000002_referral_sent_to_partner.sql`: `referrals.partner_note_visible`; outbox kinds `partner_referral_sent`, `partner_digest`, `internal_partner_note` and the relaxed recipient check; `_portal_referral_sent_payload`, `_portal_enqueue_referral_sent`, `send_referral_to_partner`; `refer_deal_to_partner` re-created to queue the email.
- `supabase/migrations/20261022000003_portal_sent_referrals.sql`: `referral_partner_notes` (+ RLS); `portal_list_sent_referrals`, `portal_get_sent_referral`, `portal_partner_notes`, `portal_post_partner_note`, `_portal_enqueue_partner_note`.
- `supabase/migrations/20261022000004_portal_digest.sql`: `portal_users.digest_unsubscribe_token`, `portal_users.digest_week`; `_portal_digest_token`, `_portal_digest_wants`, `_portal_digest_events`, `enqueue_portal_digests`, `portal_unsubscribe_digest`, `portal_record_export`; `claim_portal_emails` re-created.
- `supabase/migrations/20261022000005_partner_notes_purge.sql`: `purge_declined_referrals` and `portal_purge_user` re-created to erase notes, the note in queued payloads, and the unsubscribe token.
- `supabase/tests/063_referral_sent_to_partner.sql`, `064_portal_sent_referrals.sql`, `065_portal_digest.sql`, `066_partner_notes_purge.sql`.
- `supabase/functions/_shared/portalSentApi.ts` (+ `.test.ts`): the three session actions for sent referrals and notes.
- `supabase/functions/_shared/portalUnsubscribe.test.ts`: the public `unsubscribe_digest` action.
- `apps/app/src/features/portal/components/PortalSentSection.tsx`: "Sent to you" on the dashboard.
- `apps/app/src/features/portal/pages/PortalSentReferralPage.tsx` (+ `.test.tsx`): `/p/:slug/s/:referralId`.
- `apps/app/src/features/portal/pages/PortalUnsubscribePage.tsx` (+ `.test.tsx`): `/p/:slug/unsubscribe?t=`.
- `apps/app/src/features/partners/hooks/useReferralPartnerNotes.ts` (+ `.test.tsx`): `useDealPartnerNotes`, `usePartnerNoteCounts`.
- `apps/app/src/features/partners/components/PartnerNoteBacksPanel.tsx` (+ `.test.tsx`).

**Modify**
- `supabase/functions/_shared/emailTemplate.ts` (+ `emailTemplate.test.ts`): optional `footerLink`.
- `supabase/functions/_shared/portalNotifyEmail.ts` (+ test): `partner_referral_sent`, `partner_digest`, `internal_partner_note`; `headers` on the built email; `portalApiUrl` in the context.
- `supabase/functions/_shared/portalNotify.ts` (+ test), `supabase/functions/portal_notify/index.ts`: digest enqueue step, headers pass-through, `portalApiUrl`.
- `supabase/functions/_shared/portalReferralApi.ts` (+ test): route the three new actions; export audit.
- `supabase/functions/_shared/portalApi.ts`, `supabase/functions/portal_api/index.ts` (comment only): `unsubscribe_digest`.
- `apps/app/src/features/portal/lib/portalApi.ts` (+ test): four client calls.
- `apps/app/src/features/portal/pages/PortalDashboardPage.tsx` (+ test), `PortalRoot.tsx`: the section and two routes.
- `apps/app/src/features/portal/portalStringAudit.test.tsx`: every new response, page and email.
- `apps/app/src/features/partners/hooks/useReferDeal.ts` (+ test), `apps/app/src/features/partners/lib/referrals.ts` (+ test), `apps/app/src/features/pipeline/components/SendReferralSheet.tsx` (+ test).
- `apps/app/src/features/partners/components/ReferralSection.tsx` (+ test), `apps/app/src/features/partners/pages/PartnerDetailPage.tsx` (+ test), `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`, `DealDetailPage.referral.test.tsx`.

## Deviations from the brief (recorded here; the real code wins)

1. **The flag rides a NEW RPC, `send_referral_to_partner(p_partner_id uuid, p_deal_id uuid, p_partner_note text default '')`.** Changing `refer_deal_to_partner`'s or `_link_deal_to_partner`'s signature would break DB test 035, which asserts both signatures by name. The new RPC calls the existing `_link_deal_to_partner(..., 'outbound', note)` and sets `partner_note_visible = true` only when the trimmed note is not empty (1,000 characters at most, `note_too_long`). `useReferDeal` switches to it, so SendReferralSheet (with a note) shares it and Partner Detail "Refer a deal" (no note) stays not visible. `refer_deal_to_partner` keeps its signature and never sets the flag, so a stale PWA client never exposes a note written under the old copy.
2. **The "referral sent to you" email is queued by the two RPCs, not by an insert trigger.** A trigger would fire before the flag is set (so the note could never ride the email) and would also fire for the `partner_deals` mirror used by the demo reseed. Both `send_referral_to_partner` and the re-created `refer_deal_to_partner` (same signature and grants, now plpgsql) call `_portal_enqueue_referral_sent`.
3. **"Sent to you" shows the partner label of the referral's status** (outbound status follows the deal stage: Accepted, In Progress, Closed Won, Not Moving Forward; a link a rep removed shows Withdrawn and stays listed). Never the stage itself, never a value: `value_cents` is not read by any outbound partner function.
4. **Contact details are the snapshot's name, email and phone only** (brief allowlist); the address is not shared. Purged rows (a withdrawn outbound referral past retention) are listed with null contact fields and `detailsRemoved = true`, like 2A.
5. **The sent date is `referrals.submitted_at`** (set to `now()` at insert by `_link_deal_to_partner`; there is no separate `created_at` meaning).
6. **Notes are allowed on any unpurged outbound referral of the session's partner, Withdrawn included.** Inbound referrals keep their 1C path (published updates); a note there is `referral_not_found` (PRD section 13).
7. **`internal_partner_note` goes to the sender while active in the org, else the deal owner while active, else every active administrator** (`_portal_review_recipients`). Payload `{appUrlPath, companyNames, count}` links to `/pipeline/<deal id>`, or `/partners/<partner id>` when the deal is gone. One email per note per recipient (dedupe `internal_partner_note:<note id>:<user id>`).
8. **The digest summarizes the previous ISO week** (Monday 00:00 to Monday 00:00 in the partner owner's time zone, `path_preferences.timezone` through `_portal_local_tz`, default America/New_York) and is queued at or after Monday 08:00 local. `portal_users.digest_week` records the week already evaluated, so a quiet partner is checked once per week instead of every 2 minutes. Counts are `{submitted, accepted, inProgress, closedWon, notMovingForward, sentToYou}` (distinct referrals per bucket); the payload has exactly the brief's 8 keys; an item's label is a partner label or `Sent to you`.
9. **`claim_portal_emails` is re-created** so a `partner_digest` row (no referral) is live only while the user is active, the portal is on and the digest preference is still on. Every other branch is identical to 20261016000003.
10. **The unsubscribe token is stored as issued, not hashed.** It must be written into every digest, and it can only turn one email off. 16 random bytes, base64url, 22 characters, unique; created at the first digest; cleared by `portal_purge_user`.
11. **The one-click URL is the portal_api function itself**: `<SUPABASE_URL>/functions/v1/portal_api/unsubscribe_digest?slug=<slug>&t=<token>`. portal_api reads `slug` and `t` from the query string before any JSON parsing (a mail provider posts `List-Unsubscribe=One-Click` form-encoded), and from a JSON body for the portal page. `PortalNotifyEnv.portalApiUrl` is optional; without it a digest does not build and is dropped as `invalid_payload`. No new secret.
12. **`renderEmail` gains an optional `footerLink`** for the unsubscribe link; with it absent the output is byte-identical (the snapshot test is untouched).
13. **The export audit is a separate call, `portal_record_export(p_org, p_partner, p_portal_user, p_ip)`, made after the rows are read**, so `portal_export_referrals` and DB test 052 stay as they are. A failed audit write answers 500 and the file is not delivered. The four export tests in `portalReferralApi.test.ts` gain a `portal_record_export` handler.
14. **`portalNotify` summary gains `digestsQueued`** and the call order becomes nudges, digests, claim; three assertions in `portalNotify.test.ts` change with it.
15. **Unsubscribe is limited to 30 requests per IP per hour** (audit action `unsubscribe`, the 1A count-then-insert pattern under an advisory lock) and works for an org whose portal is off (only a disabled org refuses). The response is always `{ ok: true }` except a database failure (500), which says nothing about the token.
16. **Purge deletes note rows** (the 2A precedent deleted `referral_updates`): the referral purge deletes notes on purged referrals and nulls `note` in queued payloads; `portal_purge_user` deletes that portal user's notes, clears the token and `digest_week`, and nulls `unsubscribeToken` in its payloads.
17. **Rep app surfaces**: Deal Detail lists "Notes from <partner>" under Source for each outbound referral that has notes; Partner Detail's "Referred to them" rows show "<n> notes from partner". No new page.

## Operator steps (Ryan, before merging to main)

None. No new secret: the digest's one-click URL is built from `SUPABASE_URL`, which `portal_notify` already reads, and Resend accepts custom `headers` with the existing key. After the merge reaches staging: send a deal to a partner who has portal access from Deal Detail with a note, open their portal, post a note back, and run the PR test plan. Never production until the promote workflow and your go.

---

### Task 1: The partner-visible note flag and the "referral sent to you" email (SQL)

**Files:**
- Create: `supabase/migrations/20261022000001_portal_audit_actions_2b3.sql`
- Create: `supabase/migrations/20261022000002_referral_sent_to_partner.sql`
- Test: `supabase/tests/063_referral_sent_to_partner.sql`

**Interfaces:**
- Consumes (SQL): `_link_deal_to_partner(uuid, uuid, text, text) returns uuid` (raises `not_authorized`, `partner_not_visible`, `deal_not_visible`, `already_linked`), `_portal_referral_ref(uuid)`, `portal_users`, `organizations.portal_enabled/is_disabled`.
- Produces (SQL):
  - `referrals.partner_note_visible boolean not null default false`.
  - Outbox kinds `partner_referral_sent` (portal user + referral), `partner_digest` (portal user, NO referral), `internal_partner_note` (internal recipient).
  - `public.send_referral_to_partner(p_partner_id uuid, p_deal_id uuid, p_partner_note text default '') returns uuid` (authenticated). Raises `note_too_long` over 1,000 characters.
  - `public.refer_deal_to_partner(uuid, uuid, text) returns uuid`: unchanged signature, now also queues the email.
  - `public._portal_enqueue_referral_sent(p_referral uuid) returns void` and `public._portal_referral_sent_payload(p_referral uuid) returns jsonb` (private). Payload keys exactly: `slug, orgName, partnerName, companyName, ref, repName, repEmail, note` (`note` null unless `partner_note_visible`). Dedupe key `partner_referral_sent:<referral id>`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/063_referral_sent_to_partner.sql`:

```sql
-- Tests for 20261022000001_portal_audit_actions_2b3 and
-- 20261022000002_referral_sent_to_partner (Partner Portal Phase 2B-3,
-- FR-PORT-76, FR-PORT-79).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/063_referral_sent_to_partner.sql
-- Self-cleans via ROLLBACK.
--
-- Org sent-a (portal on): boss administrator; rita rep under boss.
-- P1 Jane CPA (owner rita) with ACTIVE portal user PU1; P2 Kim CPA (owner rita)
-- without portal access. Deals D1..D5 owned by rita.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001063', 'Sent Org', 'sent-a', 'sent-a-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0630000-0000-0000-0000-000000000001', 'boss@st.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0630000-0000-0000-0000-000000000002', 'rita@st.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0630000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'admin', 'administrator',      'Boss',     'boss@st.example', 'stboss'::ltree,      null),
  ('a0630000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'rep',   'sales_professional', 'Rita Rep', 'rita@st.example', 'stboss.rita'::ltree, 'a0630000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a063a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@st.example', null),
  ('a063a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@st.example',  null);

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a063b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a063a000-0000-0000-0000-000000000001', 'jane@st.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a063d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Fresh Bakery', '5 Oak St',  'Ann', 'ann@fresh.example', '5550630001', 500000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Gold Gym',     '7 Elm St',  'Gil', 'gil@gold.example',  '5550630002', 250000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Blue Cafe',    '9 Pine St', 'Bea', 'bea@blue.example',  '5550630003', 100000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Red Shop',     '11 Ash St', 'Rod', 'rod@red.example',   '5550630004', 100000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Green Spa',    '13 Fir St', 'Gus', 'gus@green.example', '5550630005', 100000, 'contacted', 'inbound');

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

-- 1. Privileges and enum values (before any role switch).
do $$ begin
  if has_function_privilege('anon', 'public.send_referral_to_partner(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.send_referral_to_partner(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'send_referral_to_partner: authenticated only';
  end if;
  if not has_function_privilege('authenticated', 'public.refer_deal_to_partner(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.refer_deal_to_partner(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'refer_deal_to_partner keeps its grants';
  end if;
  if has_function_privilege('authenticated', 'public._portal_enqueue_referral_sent(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_enqueue_referral_sent(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._portal_referral_sent_payload(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_referral_sent_payload(uuid)', 'EXECUTE') then
    raise exception 'referral-sent helpers must be private';
  end if;
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'portal_audit_action' and e.enumlabel in ('note', 'export', 'unsubscribe')) <> 3 then
    raise exception 'portal_audit_action must have note, export and unsubscribe';
  end if;
end $$;

-- 2. A note written for the partner: visible, and it rides the partner email.
do $$ declare v_id uuid; r referrals; o portal_email_outbox; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000001', E'  Ask for Ann after 3pm.\n ');
  perform set_config('role', 'postgres', true);

  select * into r from referrals where id = v_id;
  if r.direction <> 'outbound' or r.notes <> 'Ask for Ann after 3pm.' or not r.partner_note_visible
     or r.submitted_by_user_id <> 'a0630000-0000-0000-0000-000000000002' or r.contact_name <> 'Ann' then
    raise exception 'sent referral wrong: %', row_to_json(r);
  end if;

  select * into o from portal_email_outbox where referral_id = v_id;
  if o.id is null or o.kind <> 'partner_referral_sent' or o.portal_user_id <> 'a063b000-0000-0000-0000-000000000001'
     or o.recipient_user_id is not null or o.dedupe_key <> 'partner_referral_sent:' || v_id::text then
    raise exception 'partner email not queued as expected: %', row_to_json(o);
  end if;
  if (select count(*) from jsonb_object_keys(o.payload)) <> 8 then
    raise exception 'payload must carry exactly 8 keys: %', o.payload;
  end if;
  if o.payload->>'note' <> 'Ask for Ann after 3pm.' or o.payload->>'repName' <> 'Rita Rep'
     or o.payload->>'repEmail' <> 'rita@st.example' or o.payload->>'companyName' <> 'Fresh Bakery'
     or o.payload->>'slug' <> 'sent-a' or o.payload->>'orgName' <> 'Sent Org' or o.payload->>'partnerName' <> 'Jane CPA'
     or o.payload->>'ref' <> 'REF-' || upper(left(v_id::text, 8)) then
    raise exception 'payload wrong: %', o.payload;
  end if;
end $$;

-- 3. A blank note is not a note: nothing visible, and the email says nothing.
do $$ declare v_id uuid; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000002', '   ');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible or notes <> '' from referrals where id = v_id) then
    raise exception 'a blank note must not be visible';
  end if;
  if (select payload->'note' from portal_email_outbox where referral_id = v_id) <> 'null'::jsonb then
    raise exception 'a blank note must not ride the email';
  end if;
end $$;

-- 4. The old RPC (Partner Detail before this PR, stale clients): the note stays internal.
do $$ declare v_id uuid; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.refer_deal_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000003', 'Internal: the owner is difficult');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible from referrals where id = v_id) then
    raise exception 'refer_deal_to_partner must never make a note visible';
  end if;
  if (select payload->'note' from portal_email_outbox where referral_id = v_id and kind = 'partner_referral_sent') <> 'null'::jsonb then
    raise exception 'refer_deal_to_partner queues the email without the note';
  end if;
end $$;

-- 5. No portal access, too long, already linked, portal off.
do $$ declare v_id uuid; n int; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000002', 'a063d000-0000-0000-0000-000000000001', 'Hello Kim');
  perform _t_raises($q$select public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000004', repeat('x', 1001))$q$, 'note_too_long');
  perform _t_raises($q$select public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000001', '')$q$, 'already_linked');
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox where referral_id = v_id;
  if n <> 0 then raise exception 'a partner without portal access gets no email, got %', n; end if;
  if exists (select 1 from referrals where deal_id = 'a063d000-0000-0000-0000-000000000004') then
    raise exception 'a refused send must create nothing';
  end if;

  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001063';
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000005', 'Portal is off');
  perform set_config('role', 'postgres', true);
  if exists (select 1 from portal_email_outbox where referral_id = v_id) then
    raise exception 'no partner email while the portal is off';
  end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001063';
end $$;

-- 6. Existing paths keep the flag off.
do $$ declare v_id uuid; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.log_referral('a063a000-0000-0000-0000-000000000001', 'Logged Co');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible from referrals where id = v_id) then
    raise exception 'an inbound referral is never partner-note-visible';
  end if;
end $$;

-- 7. The recipient rule: a digest has no referral; every other partner email has one.
do $$ begin
  insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001063', 'partner_digest', 'a063b000-0000-0000-0000-000000000001', '{}', 't063-digest');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, referral_id, payload, dedupe_key)
    select '00000000-0000-0000-0000-000000001063', 'partner_digest', 'a063b000-0000-0000-0000-000000000001', r.id, '{}', 't063-digest-ref'
      from referrals r limit 1$q$, 'portal_email_outbox_recipient_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
    values ('00000000-0000-0000-0000-000000001063', 'partner_update', 'a063b000-0000-0000-0000-000000000001', '{}', 't063-update')$q$,
    'portal_email_outbox_recipient_check');
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001063', 'internal_partner_note', 'a0630000-0000-0000-0000-000000000002', '{}', 't063-note');
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/063_referral_sent_to_partner.sql`
Expected: FAIL with `function public.send_referral_to_partner(uuid, uuid, text) does not exist`.

- [ ] **Step 3: Write the enum migration**

Create `supabase/migrations/20261022000001_portal_audit_actions_2b3.sql`:

```sql
-- 20261022000001_portal_audit_actions_2b3.sql
--
-- Partner Portal Phase 2B-3. New audit actions, alone in this file: a value
-- added with ALTER TYPE ... ADD VALUE cannot be used in the transaction that
-- adds it, and 20261022000003 and 20261022000004 use all three.
--   note         a partner posted a note on a referral sent to them (FR-PORT-78, rate limited)
--   export       a partner downloaded their referrals as CSV (NFR-PORT-06)
--   unsubscribe  a weekly summary unsubscribe request (FR-PORT-84, rate limited per IP)

alter type portal_audit_action add value if not exists 'note';
alter type portal_audit_action add value if not exists 'export';
alter type portal_audit_action add value if not exists 'unsubscribe';
```

- [ ] **Step 4: Write the flag, outbox and send migration**

Create `supabase/migrations/20261022000002_referral_sent_to_partner.sql`:

```sql
-- 20261022000002_referral_sent_to_partner.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-76, FR-PORT-79).
--
-- 1. referrals.partner_note_visible: true only when a rep wrote the note FOR
--    the partner (send_referral_to_partner with a note). Every existing row,
--    the backfill from partner_deals, refer_deal_to_partner and inbound
--    referrals keep false: their notes were never meant for a partner.
-- 2. Outbox kinds for this phase. partner_digest is the one partner email with
--    no referral (a weekly summary), so the recipient rule gains a branch.
-- 3. "<ISO> sent you a referral": queued by the two outbound RPCs (not by a
--    trigger, so the flag is set before the payload is built and the demo
--    partner_deals mirror never emails anyone). Only for a partner with ACTIVE
--    portal access while the portal is on. Status changes on outbound
--    referrals send nothing (_portal_enqueue_partner skips them, unchanged).

-- 1. Flag -------------------------------------------------------------------------
alter table referrals add column if not exists partner_note_visible boolean not null default false;

-- 2. Outbox kinds and the recipient rule --------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission',
  'partner_referral_sent','partner_digest','internal_partner_note'));

alter table portal_email_outbox drop constraint portal_email_outbox_recipient_check;
alter table portal_email_outbox add constraint portal_email_outbox_recipient_check check (
  case when kind = 'partner_digest'
       then portal_user_id is not null and recipient_user_id is null and referral_id is null
       when kind like 'partner\_%'
       then portal_user_id is not null and recipient_user_id is null and referral_id is not null
       else recipient_user_id is not null and portal_user_id is null
  end);

-- 3. The partner email ----------------------------------------------------------------
-- Exactly eight keys, always present. The rep is the SENDER (submitted_by_user_id),
-- while active in this org. The note only when the rep wrote it for the partner.
create or replace function public._portal_referral_sent_payload(p_referral uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
           'slug',        o.slug,
           'orgName',     o.name,
           'partnerName', p.name,
           'companyName', r.company_name,
           'ref',         public._portal_referral_ref(r.id),
           'repName',     pr.full_name,
           'repEmail',    pr.email,
           'note',        case when r.partner_note_visible then nullif(btrim(r.notes), '') end)
    from referrals r
    join organizations o on o.id = r.org_id
    join partners p on p.id = r.partner_id
    left join profiles pr on pr.id = r.submitted_by_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where r.id = p_referral
$$;

-- Never blocks the RPC: the warning names the function and the error only.
create or replace function public._portal_enqueue_referral_sent(p_referral uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  r             referrals;
  v_portal_user uuid;
begin
  select * into r from referrals where id = p_referral;
  if r.id is null or r.direction <> 'outbound' or r.purged_at is not null then
    return;
  end if;
  select u.id into v_portal_user
    from portal_users u
    join organizations o on o.id = u.org_id
   where u.partner_id = r.partner_id and u.org_id = r.org_id
     and u.status = 'active' and o.portal_enabled and not o.is_disabled;
  if v_portal_user is null then
    return;
  end if;
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key)
  values (r.org_id, 'partner_referral_sent', r.id, v_portal_user,
          public._portal_referral_sent_payload(r.id), 'partner_referral_sent:' || r.id::text)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning '_portal_enqueue_referral_sent skipped: % %', SQLSTATE, SQLERRM;
end $$;

-- 4. The send RPCs ----------------------------------------------------------------------
-- SendReferralSheet (and, through useReferDeal, Partner Detail "Refer a deal"
-- with no note). The note is shown to the partner only when it is not blank.
create or replace function public.send_referral_to_partner(
  p_partner_id uuid, p_deal_id uuid, p_partner_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_partner_note, ''), E' \t\r\n');
  v_id   uuid;
begin
  if char_length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  v_id := public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', v_note);
  if v_note <> '' then
    update referrals set partner_note_visible = true where id = v_id;
  end if;
  perform public._portal_enqueue_referral_sent(v_id);
  return v_id;
end $$;

-- Same signature and grants as 20261007000003 (DB test 035 asserts them). Kept
-- for stale clients; it never makes a note visible, and now also emails.
create or replace function public.refer_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', p_note);
  perform public._portal_enqueue_referral_sent(v_id);
  return v_id;
end $$;

-- Privileges ----------------------------------------------------------------------------
revoke execute on function public._portal_referral_sent_payload(uuid)        from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_referral_sent(uuid)        from public, anon, authenticated, service_role;
revoke execute on function public.send_referral_to_partner(uuid, uuid, text) from public, anon;
grant  execute on function public.send_referral_to_partner(uuid, uuid, text) to authenticated;
revoke execute on function public.refer_deal_to_partner(uuid, uuid, text)    from public, anon;
grant  execute on function public.refer_deal_to_partner(uuid, uuid, text)    to authenticated;
```

- [ ] **Step 5: Apply and run the test**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/063_referral_sent_to_partner.sql`
Expected: PASS (no output, exit 0).

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/035_referral_rpcs.sql && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/047_portal_email_enqueue.sql`
Expected: both PASS (signatures, grants and the 1C email rules are unchanged).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261022000001_portal_audit_actions_2b3.sql supabase/migrations/20261022000002_referral_sent_to_partner.sql supabase/tests/063_referral_sent_to_partner.sql
git commit -m "feat(portal): partner-visible referral notes and the referral sent to you email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "Sent to you" reads and partner note-back (SQL)

**Files:**
- Create: `supabase/migrations/20261022000003_portal_sent_referrals.sql`
- Test: `supabase/tests/064_portal_sent_referrals.sql`

**Interfaces:**
- Consumes (SQL): Task 1 (`partner_note_visible`, outbox kind `internal_partner_note`, audit action `note`); `_portal_assert_scope(uuid, uuid, uuid)` (raises `not_authorized`), `_portal_audit_referral(uuid, uuid, portal_audit_action, uuid, text)`, `_portal_referral_ref(uuid)`, `_portal_review_recipients(uuid, uuid)`.
- Produces (SQL, service role only unless noted):
  - Table `referral_partner_notes (id uuid, org_id uuid, referral_id uuid, portal_user_id uuid null, body text 1..1000 trimmed, created_at timestamptz)`; `authenticated` may SELECT under RLS (visible when the referral is visible); nobody writes directly.
  - `public.portal_list_sent_referrals(p_org uuid, p_partner uuid, p_since timestamptz) returns table (id uuid, ref text, company_name text, status referral_status, sent_at timestamptz, last_activity_at timestamptz)`: outbound referrals of that partner, newest activity first, at most 500, empty while the portal is off.
  - `public.portal_get_sent_referral(p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text) returns table (id uuid, ref text, company_name text, contact_name text, contact_email text, contact_phone text, rep_note text, status referral_status, sent_at timestamptz, rep_name text, rep_email text, details_removed boolean, can_post_note boolean)`: zero rows when not that partner's outbound referral; audits `view_referral` at most once per hour per referral.
  - `public.portal_partner_notes(p_org uuid, p_partner uuid, p_referral uuid) returns table (id uuid, body text, created_at timestamptz)`: newest first, at most 100.
  - `public.portal_post_partner_note(p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_body text, p_ip text) returns table (id uuid, body text, created_at timestamptz)`: raises `referral_not_found`, `invalid_input:body`, `rate_limited` (20 per portal user per hour), `not_authorized`. Audits `note`, queues `internal_partner_note`.
  - `public._portal_enqueue_partner_note(p_referral referrals, p_note uuid) returns void` (private).

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/064_portal_sent_referrals.sql`:

```sql
-- Tests for 20261022000003_portal_sent_referrals (Partner Portal Phase 2B-3,
-- FR-PORT-76, 77, 78, 80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/064_portal_sent_referrals.sql
-- Self-cleans via ROLLBACK.
--
-- Org sent-read (portal on): boss administrator; rita rep and rob rep in
-- separate branches. P1 Jane CPA (owner rita, ACTIVE PU1), P2 Kim CPA (owner
-- rita, ACTIVE PU2), P3 Lee CPA (owner rita, SUSPENDED PU3). Deals D1..D3 (rita).
-- Referrals (inserted as postgres):
--   R1 outbound P1 D1, sent by boss, note for the partner, accepted
--   R2 outbound P1 D2, sent by rita, internal note (not visible), working
--   R3 outbound P1 D3, withdrawn and purged
--   R4 inbound  P1, rep-entered
--   R5 outbound P2 D1 (another partner)
-- Org sent-read-b: bob administrator.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001064', 'Read Org',   'sent-read',   'sent-read-a1',   true),
  ('00000000-0000-0000-0000-000000001164', 'Read Org B', 'sent-read-b', 'sent-read-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0640000-0000-0000-0000-000000000001', 'boss@sr.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000002', 'rita@sr.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000003', 'rob@sr.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000004', 'bob@srb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0640000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'admin', 'administrator',      'Boss',     'boss@sr.example', 'srboss'::ltree,      null),
  ('a0640000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'rep',   'sales_professional', 'Rita Rep', 'rita@sr.example', 'srboss.rita'::ltree, 'a0640000-0000-0000-0000-000000000001'),
  ('a0640000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'rep',   'sales_professional', 'Rob Rep',  'rob@sr.example',  'srboss.rob'::ltree,  'a0640000-0000-0000-0000-000000000001'),
  ('a0640000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001164', 'admin', 'administrator',      'Bob',      'bob@srb.example', 'srbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a064a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@sr.example', null),
  ('a064a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@sr.example',  null),
  ('a064a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Lee CPA',  'Lee & Co',  'cpa', 'lee@sr.example',  null);

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a064b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'jane@sr.example', 'active'),
  ('a064b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'kim@sr.example',  'active'),
  ('a064b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003', 'lee@sr.example',  'suspended');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a064d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Fresh Bakery', '5 Oak St',  'Ann', 'ann@fresh.example', '5550640001', 500000, 'contacted', 'inbound'),
  ('a064d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Gold Gym',     '7 Elm St',  'Gil', 'gil@gold.example',  '5550640002', 250000, 'contacted', 'inbound'),
  ('a064d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Blue Cafe',    '9 Pine St', 'Bea', 'bea@blue.example',  '5550640003', 100000, 'contacted', 'inbound');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email, contact_phone,
                       notes, partner_note_visible, deal_id, assigned_user_id, submitted_by_user_id, submitted_at, purged_at) values
  ('a064e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',
   'Fresh Bakery', 'Ann', 'ann@fresh.example', '5550640001', 'Ask for Ann after 3pm.', true,
   'a064d000-0000-0000-0000-000000000001', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000001', now() - interval '2 days', null),
  ('a064e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'working',
   'Gold Gym', 'Gil', 'gil@gold.example', '5550640002', 'INTERNAL: owner is difficult', false,
   'a064d000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', null),
  ('a064e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn',
   'Blue Cafe', null, null, null, '', true,
   'a064d000-0000-0000-0000-000000000003', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '3 hours', now()),
  ('a064e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted',
   'Inbound Co', null, null, null, 'rep wrote this', false,
   null, 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', null),
  ('a064e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'outbound', 'rep_entered', 'accepted',
   'Fresh Bakery', 'Ann', 'ann@fresh.example', '5550640001', 'For Kim', true,
   'a064d000-0000-0000-0000-000000000001', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', null);

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

create or replace function _t_visible_notes(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from referral_partner_notes;
  perform set_config('role', 'postgres', true);
  return n;
end $$;

-- 1. Privileges (before any role switch).
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_list_sent_referrals(uuid, uuid, timestamptz)',
    'public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_partner_notes(uuid, uuid, uuid)',
    'public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '% must be service role only', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'service_role should execute %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._portal_enqueue_partner_note(referrals, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_enqueue_partner_note(referrals, uuid)', 'EXECUTE') then
    raise exception '_portal_enqueue_partner_note must be private';
  end if;
  if not has_table_privilege('authenticated', 'public.referral_partner_notes', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'DELETE')
     or has_table_privilege('anon', 'public.referral_partner_notes', 'SELECT') then
    raise exception 'referral_partner_notes: authenticated reads only, anon nothing';
  end if;
end $$;

-- 2. List: this partner's outbound referrals only, purged ones included, window applied.
do $$ declare ids uuid[]; begin
  select array_agg(id order by id) into ids
    from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', null);
  if ids is distinct from array['a064e000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000002', 'a064e000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'sent list wrong: %', ids;
  end if;
  select array_agg(id order by id) into ids
    from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', now() - interval '1 day');
  if ids is distinct from array['a064e000-0000-0000-0000-000000000002', 'a064e000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'the window must apply to the sent date: %', ids;
  end if;
  if exists (select 1 from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001164', 'a064a000-0000-0000-0000-000000000001', null)) then
    raise exception 'another org scope must see nothing';
  end if;
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001064';
  if exists (select 1 from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', null)) then
    raise exception 'nothing while the portal is off';
  end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001064';
end $$;

-- 3. Detail: allowlisted fields, the rep note only when visible, purged details removed.
do $$ declare g record; n int; begin
  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', '203.0.113.5');
  if g.company_name <> 'Fresh Bakery' or g.contact_name <> 'Ann' or g.contact_email <> 'ann@fresh.example'
     or g.contact_phone <> '5550640001' or g.rep_note <> 'Ask for Ann after 3pm.' or g.status <> 'accepted'
     or g.rep_name <> 'Boss' or g.rep_email <> 'boss@sr.example' or g.details_removed or not g.can_post_note
     or g.ref <> 'REF-A064E000' then
    raise exception 'detail wrong: %', row_to_json(g);
  end if;
  perform * from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', '203.0.113.5');
  select count(*) into n from portal_audit_log where referral_id = 'a064e000-0000-0000-0000-000000000001' and action = 'view_referral';
  if n <> 1 then raise exception 'views are audited once per hour, got %', n; end if;

  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000002', null);
  if g.rep_note is not null then raise exception 'an internal note must never reach the partner: %', g.rep_note; end if;

  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000003', null);
  if not g.details_removed or g.can_post_note or g.contact_name is not null or g.rep_note is not null or g.status <> 'withdrawn' then
    raise exception 'purged detail wrong: %', row_to_json(g);
  end if;

  if exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000004', null))
     or exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000005', null)) then
    raise exception 'an inbound referral and another partner''s referral must look missing';
  end if;
  perform _t_raises($q$select * from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003',
    'a064b000-0000-0000-0000-000000000003', 'a064e000-0000-0000-0000-000000000001', null)$q$, 'not_authorized');
end $$;

-- 4. Note-back: stored, audited, emailed to the sender (then the deal owner), scoped, limited.
do $$ declare p record; o portal_email_outbox; n int; begin
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', E'  Called Ann, she is interested.\n', '203.0.113.5');
  if p.body <> 'Called Ann, she is interested.' or p.id is null or p.created_at is null then
    raise exception 'post result wrong: %', row_to_json(p);
  end if;
  if not exists (select 1 from referral_partner_notes where id = p.id and portal_user_id = 'a064b000-0000-0000-0000-000000000001'
                  and referral_id = 'a064e000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000001064') then
    raise exception 'note not stored';
  end if;
  select count(*) into n from portal_audit_log where action = 'note' and portal_user_id = 'a064b000-0000-0000-0000-000000000001' and ip = '203.0.113.5';
  if n <> 1 then raise exception 'notes are audited, got %', n; end if;

  select * into o from portal_email_outbox where kind = 'internal_partner_note' and dedupe_key like 'internal_partner_note:' || p.id::text || ':%';
  if o.recipient_user_id <> 'a0640000-0000-0000-0000-000000000001'
     or o.payload <> jsonb_build_object('appUrlPath', '/pipeline/a064d000-0000-0000-0000-000000000001',
                                        'companyNames', jsonb_build_array('Fresh Bakery'), 'count', 1) then
    raise exception 'note email wrong: %', row_to_json(o);
  end if;

  -- The sender left: the deal owner hears about the next note.
  update profiles set deactivated_at = now() where id = 'a0640000-0000-0000-0000-000000000001';
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'Demo booked.', null);
  if (select recipient_user_id from portal_email_outbox where dedupe_key like 'internal_partner_note:' || p.id::text || ':%')
     <> 'a0640000-0000-0000-0000-000000000002' then
    raise exception 'with the sender gone the deal owner is told';
  end if;

  if (select array_agg(body order by created_at desc, id) from public.portal_partner_notes('00000000-0000-0000-0000-000000001064',
        'a064a000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001'))
     is distinct from (select array_agg(body order by created_at desc, id) from referral_partner_notes
                        where referral_id = 'a064e000-0000-0000-0000-000000000001') then
    raise exception 'portal_partner_notes must list the notes newest first';
  end if;
  if exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'a064e000-0000-0000-0000-000000000001')) then
    raise exception 'another partner must not read these notes';
  end if;

  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000004', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000005', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000003', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', E' \n ', null)$q$, 'invalid_input:body');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', repeat('y', 1001), null)$q$, 'invalid_input:body');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003',
    'a064b000-0000-0000-0000-000000000003', 'a064e000-0000-0000-0000-000000000001', 'x', null)$q$, 'not_authorized');

  -- Two posted so far; 18 more audit rows reach the limit of 20 per hour.
  insert into portal_audit_log (org_id, portal_user_id, action)
  select '00000000-0000-0000-0000-000000001064', 'a064b000-0000-0000-0000-000000000001', 'note' from generate_series(1, 18);
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'one too many', null)$q$, 'rate_limited');
  select count(*) into n from referral_partner_notes;
  if n <> 2 then raise exception 'refused notes must not be stored, got %', n; end if;
end $$;

-- 5. Internal reads under RLS: the deal owner sees the notes; another branch and another org do not.
do $$ begin
  if _t_visible_notes('a0640000-0000-0000-0000-000000000002') <> 2 then raise exception 'rita should see the notes on her deal'; end if;
  if _t_visible_notes('a0640000-0000-0000-0000-000000000003') <> 0 then raise exception 'rob must not see them'; end if;
  if _t_visible_notes('a0640000-0000-0000-0000-000000000004') <> 0 then raise exception 'another org must not see them'; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/064_portal_sent_referrals.sql`
Expected: FAIL with `function public.portal_list_sent_referrals(uuid, uuid, timestamptz) does not exist` (section 1).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261022000003_portal_sent_referrals.sql`:

```sql
-- 20261022000003_portal_sent_referrals.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-76, 77, 78, 80).
--
-- 1. referral_partner_notes: what a partner writes back on a referral sent to
--    them. Its own record, never an activity (Ryan ruling: activities.logged_by
--    is an internal user and feeds the activity reports). Internal users read
--    it under RLS when they can see the referral; only portal_post_partner_note
--    writes it. portal_user_id becomes null if the identity row is ever deleted;
--    the 2A erase deletes the notes outright (20261022000005).
-- 2. "Sent to you" reads for portal_api, service role only, pinned to the
--    session's (org, partner) like every 1B read, OUTBOUND rows only. A partner
--    sees: company, the contact snapshot (name, email, phone), the partner
--    label (portal_api maps status), the sent date, the sender's name and
--    business email, the rep's note ONLY when partner_note_visible, and their
--    own notes. Never the stage, a value, an internal note or another partner.
--    Purged rows stay listed with personal fields null (FR-PORT-92).
-- 3. portal_post_partner_note: only on that partner's unpurged outbound
--    referrals, 1..1000 characters, 20 per portal user per hour, audited, and
--    the sender (else the deal owner, else administrators) is emailed.

-- 1. Notes -------------------------------------------------------------------------------
create table referral_partner_notes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  referral_id    uuid not null references referrals(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  body           text not null check (body = btrim(body, E' \t\r\n') and char_length(body) between 1 and 1000),
  created_at     timestamptz not null default now()
);
create index referral_partner_notes_referral_idx on referral_partner_notes (referral_id, created_at desc);
create index referral_partner_notes_portal_user_idx on referral_partner_notes (portal_user_id) where portal_user_id is not null;

alter table referral_partner_notes enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_partner_notes from anon;
revoke all on referral_partner_notes from authenticated;
grant select on referral_partner_notes to authenticated;

-- RLS on referrals applies inside the subquery, so this inherits referrals_select.
create policy referral_partner_notes_select on referral_partner_notes for select to authenticated using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_partner_notes.referral_id)
);

-- 2. Reads ------------------------------------------------------------------------------------
create or replace function public.portal_list_sent_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  id uuid, ref text, company_name text, status referral_status,
  sent_at timestamptz, last_activity_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select r.id,
         public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at), coalesce(n.last_at, r.submitted_at)) as last_activity_at
    from referrals r
    join organizations o on o.id = r.org_id
    left join lateral (
      select max(x.created_at) as last_at from referral_status_history x where x.referral_id = r.id
    ) h on true
    left join lateral (
      select max(x.created_at) as last_at from referral_partner_notes x where x.referral_id = r.id
    ) n on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'outbound'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

create or replace function public.portal_get_sent_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, rep_note text, status referral_status, sent_at timestamptz,
  rep_name text, rep_email text, details_removed boolean, can_post_note boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  if not exists (
    select 1 from referrals r
     where r.id = p_referral and r.org_id = p_org and r.partner_id = p_partner
       and r.direction = 'outbound'
  ) then
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
           case when r.purged_at is null then r.contact_name end,
           case when r.purged_at is null then r.contact_email end,
           case when r.purged_at is null then r.contact_phone end,
           case when r.partner_note_visible and r.purged_at is null then nullif(btrim(r.notes), '') end,
           r.status,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.purged_at is not null),
           (r.purged_at is null)
      from referrals r
      left join profiles pr on pr.id = r.submitted_by_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

create or replace function public.portal_partner_notes(p_org uuid, p_partner uuid, p_referral uuid)
returns table (id uuid, body text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select n.id, n.body, n.created_at
    from referral_partner_notes n
    join referrals r on r.id = n.referral_id
   where n.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'outbound'
   order by n.created_at desc, n.id
   limit 100
$$;

-- 3. Note-back ------------------------------------------------------------------------------
-- The sender while active in the org; else the deal owner while active; else
-- (null target) every active administrator.
create or replace function public._portal_enqueue_partner_note(p_referral referrals, p_note uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner  uuid;
  v_target uuid;
  v_path   text;
begin
  select d.owner_id into v_owner from deals d where d.id = p_referral.deal_id;
  v_target := case
    when exists (select 1 from profiles x where x.id = p_referral.submitted_by_user_id
                  and x.org_id = p_referral.org_id and x.deactivated_at is null)
      then p_referral.submitted_by_user_id
    when exists (select 1 from profiles x where x.id = v_owner
                  and x.org_id = p_referral.org_id and x.deactivated_at is null)
      then v_owner
    else null
  end;
  v_path := case when p_referral.deal_id is not null
                 then '/pipeline/' || p_referral.deal_id::text
                 else '/partners/' || p_referral.partner_id::text end;
  insert into portal_email_outbox (org_id, kind, referral_id, recipient_user_id, payload, dedupe_key)
  select p_referral.org_id, 'internal_partner_note', p_referral.id, rcp.user_id,
         jsonb_build_object('appUrlPath', v_path,
                            'companyNames', jsonb_build_array(p_referral.company_name),
                            'count', 1),
         'internal_partner_note:' || p_note::text || ':' || rcp.user_id::text
    from public._portal_review_recipients(p_referral.org_id, v_target) rcp
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning '_portal_enqueue_partner_note skipped: % %', SQLSTATE, SQLERRM;
end $$;

create or replace function public.portal_post_partner_note(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_body text, p_ip text
)
returns table (id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  r      referrals;
  v_id   uuid;
  v_at   timestamptz;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into r
    from referrals x
   where x.id = p_referral and x.org_id = p_org and x.partner_id = p_partner
     and x.direction = 'outbound' and x.purged_at is null
     for update;
  if r.id is null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  -- Field rule mirrors validateNoteBody in _shared/portalSentApi.ts.
  if v_body = '' or char_length(v_body) > 1000 then
    raise exception 'invalid_input:body' using errcode = '22023';
  end if;

  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_note:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'note'
         and a.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into referral_partner_notes (org_id, referral_id, portal_user_id, body)
  values (r.org_id, r.id, p_portal_user, v_body)
  returning referral_partner_notes.id, referral_partner_notes.created_at into v_id, v_at;

  perform public._portal_audit_referral(p_org, p_portal_user, 'note', r.id, p_ip);
  perform public._portal_enqueue_partner_note(r, v_id);

  return query select v_id, v_body, v_at;
end $$;

-- Privileges -----------------------------------------------------------------------------------
revoke execute on function public.portal_list_sent_referrals(uuid, uuid, timestamptz)              from public, anon, authenticated;
revoke execute on function public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)           from public, anon, authenticated;
revoke execute on function public.portal_partner_notes(uuid, uuid, uuid)                            from public, anon, authenticated;
revoke execute on function public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)     from public, anon, authenticated;
revoke execute on function public._portal_enqueue_partner_note(referrals, uuid)                     from public, anon, authenticated, service_role;
grant  execute on function public.portal_list_sent_referrals(uuid, uuid, timestamptz)              to service_role;
grant  execute on function public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)           to service_role;
grant  execute on function public.portal_partner_notes(uuid, uuid, uuid)                            to service_role;
grant  execute on function public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)     to service_role;
```

- [ ] **Step 4: Apply and run the test**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/064_portal_sent_referrals.sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022000003_portal_sent_referrals.sql supabase/tests/064_portal_sent_referrals.sql
git commit -m "feat(portal): referrals sent to you and partner note-back in SQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Weekly digest, unsubscribe and the export audit (SQL)

**Files:**
- Create: `supabase/migrations/20261022000004_portal_digest.sql`
- Test: `supabase/tests/065_portal_digest.sql`

**Interfaces:**
- Consumes (SQL): Task 1 (outbox kind `partner_digest`, audit actions `export` and `unsubscribe`); `_portal_local_tz(text)`, `_portal_status_label(referral_status)`, `_portal_assert_scope`, `_portal_audit(uuid, uuid, portal_audit_action, text, uuid)`, `_portal_audit_referral`.
- Produces (SQL):
  - `portal_users.digest_unsubscribe_token text` (unique when set), `portal_users.digest_week text` (`IYYY-IW` of the last week evaluated). Neither is granted to `authenticated`.
  - `public.enqueue_portal_digests(p_now timestamptz) returns integer` (service role): queues one `partner_digest` per active portal user whose digest preference is on, per ISO week, at or after Monday 08:00 in the partner owner's time zone, summarizing the previous Monday-to-Monday; skips quiet weeks. Payload keys exactly `slug, orgName, partnerName, weekLabel, counts, valueCents, items, unsubscribeToken`; `counts` keys exactly `submitted, accepted, inProgress, closedWon, notMovingForward, sentToYou`; `items` at most 10 of `{companyName, label}`; dedupe `digest:<portal user id>:<IYYY-IW>`.
  - `public.portal_unsubscribe_digest(p_slug text, p_token text, p_ip text) returns void` (service role): turns the digest off for the token's user in that org; silent on any mismatch; 30 per IP per hour.
  - `public.portal_record_export(p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text) returns void` (service role): scope-checked `export` audit row.
  - `public.claim_portal_emails(integer)`: same signature and result; digest rows live only while the user is active, the portal on, and the preference on.
  - Private: `_portal_digest_token() returns text` (22 base64url characters), `_portal_digest_wants(jsonb) returns boolean` (missing or non-boolean means on), `_portal_digest_events(uuid, uuid, timestamptz, timestamptz) returns table (referral_id uuid, company_name text, at timestamptz, kind text, rank integer, label text)`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/065_portal_digest.sql`:

```sql
-- Tests for 20261022000004_portal_digest (Partner Portal Phase 2B-3,
-- FR-PORT-83, 84, 85, NFR-PORT-06).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/065_portal_digest.sql
-- Self-cleans via ROLLBACK.
--
-- Clocks are fixed in January 2030 so history rows written at the real now()
-- by the status trigger never fall inside a digest week.
-- Org dg-a (portal on, values shown): boss administrator; rita rep, time zone
-- America/Los_Angeles, owns P1..P4. PU1 (P1) active; PU2 (P2) active with the
-- digest off; PU3 (P3) active, nothing happens; PU4 (P4) suspended.
-- Week 1 = 2029-12-31 to 2030-01-07 (Los Angeles), sent 2030-01-07 08:00 local.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001065', 'Digest Org',   'dg-a', 'dg-a-a1', true, true),
  ('00000000-0000-0000-0000-000000001165', 'Digest Org B', 'dg-b', 'dg-b-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0650000-0000-0000-0000-000000000001', 'boss@dg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0650000-0000-0000-0000-000000000002', 'rita@dg.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0650000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'admin', 'administrator',      'Boss',     'boss@dg.example', 'dgboss'::ltree,      null),
  ('a0650000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'rep',   'sales_professional', 'Rita Rep', 'rita@dg.example', 'dgboss.rita'::ltree, 'a0650000-0000-0000-0000-000000000001');

insert into path_preferences (user_id, timezone, end_of_day_minutes) values
  ('a0650000-0000-0000-0000-000000000002', 'America/Los_Angeles', null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone)
select ('a065a000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-000000001065',
       'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002',
       (array['Jane CPA', 'Kim CPA', 'Lee CPA', 'Max CPA'])[i], 'Co ' || i, 'cpa', 'p' || i || '@dg.example', null
  from generate_series(1, 4) i;

insert into portal_users (id, org_id, partner_id, email, status, notification_prefs) values
  ('a065b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'jane@dg.example', 'active',    '{}'),
  ('a065b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000002', 'kim@dg.example',  'active',    '{"digest": false}'),
  ('a065b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000003', 'lee@dg.example',  'active',    '{}'),
  ('a065b000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000004', 'max@dg.example',  'suspended', '{}');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a065d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a0650000-0000-0000-0000-000000000002', 'Beta Co', '1 A St', 'B', 'b@beta.example', '5550650001', 500000, 'contacted', 'partner_referral'),
  ('a065d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a0650000-0000-0000-0000-000000000002', 'Zeta Co', '2 B St', 'Z', 'z@zeta.example', '5550650002', 300000, 'contacted', 'partner_referral');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, deal_id, assigned_user_id, submitted_by_user_id, submitted_at) values
  ('a065e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'accepted', 'Alpha Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-02 18:00Z'),
  ('a065e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'won',      'Beta Co',  'a065d000-0000-0000-0000-000000000001', 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2029-11-01 18:00Z'),
  ('a065e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'declined', 'Gamma Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-05 18:00Z'),
  ('a065e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted', 'Delta Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-03 12:00Z'),
  ('a065e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'submitted','Eps Co',   null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-08 18:00Z'),
  ('a065e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'won',      'Zeta Co',  'a065d000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2029-11-02 18:00Z'),
  ('a065e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000002', 'inbound',  'rep_entered', 'submitted','Kim Co',   null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-02 18:00Z');

-- Twelve more for P1 in week 2 (2030-01-07 to 2030-01-14).
insert into referrals (org_id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_by_user_id, submitted_at)
select '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted',
       'Bulk ' || i, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002',
       '2030-01-09 18:00Z'::timestamptz + make_interval(mins => i)
  from generate_series(1, 12) i;

-- The status changes inside the weeks (the trigger rows carry the real now()).
insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, created_at) values
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000001', 'submitted', 'accepted', 'user', '2030-01-03 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000002', 'working',   'won',      'user', '2030-01-04 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000003', 'submitted', 'declined', 'user', '2030-01-06 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000006', 'working',   'won',      'user', '2030-01-10 18:00Z');

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
    'public.enqueue_portal_digests(timestamptz)',
    'public.portal_unsubscribe_digest(text, text, text)',
    'public.portal_record_export(uuid, uuid, uuid, text)',
    'public.claim_portal_emails(integer)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '% must be service role only', f;
    end if;
  end loop;
  foreach f in array array[
    'public._portal_digest_token()',
    'public._portal_digest_wants(jsonb)',
    'public._portal_digest_events(uuid, uuid, timestamptz, timestamptz)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '% must be private', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.portal_users', 'digest_unsubscribe_token', 'SELECT') then
    raise exception 'the unsubscribe token is never readable by internal users';
  end if;
end $$;

-- 2. Before 08:00 local on Monday nothing is queued.
do $$ begin
  if public.enqueue_portal_digests('2030-01-07 15:00Z') <> 0 then raise exception '07:00 in Los Angeles is too early'; end if;
  if exists (select 1 from portal_users where org_id = '00000000-0000-0000-0000-000000001065' and digest_week is not null) then
    raise exception 'no week is evaluated before 08:00';
  end if;
end $$;

-- 3. 08:30 local: one digest for PU1, with the week's counts, value, items and token.
do $$ declare n int; o portal_email_outbox; v_token text; begin
  n := public.enqueue_portal_digests('2030-01-07 16:30Z');
  if n <> 1 then raise exception 'expected exactly one digest, got %', n; end if;

  select * into o from portal_email_outbox where kind = 'partner_digest';
  select digest_unsubscribe_token into v_token from portal_users where id = 'a065b000-0000-0000-0000-000000000001';
  if o.portal_user_id <> 'a065b000-0000-0000-0000-000000000001' or o.referral_id is not null or o.recipient_user_id is not null
     or o.dedupe_key <> 'digest:a065b000-0000-0000-0000-000000000001:2030-02' then
    raise exception 'digest row wrong: %', row_to_json(o);
  end if;
  if (select count(*) from jsonb_object_keys(o.payload)) <> 8 then raise exception 'payload must have 8 keys: %', o.payload; end if;
  if o.payload->'counts' <> '{"submitted": 2, "accepted": 1, "inProgress": 0, "closedWon": 1, "notMovingForward": 1, "sentToYou": 1}'::jsonb then
    raise exception 'counts wrong: %', o.payload->'counts';
  end if;
  if (o.payload->>'valueCents')::bigint <> 500000 then raise exception 'value wrong: %', o.payload->'valueCents'; end if;
  if o.payload->'items' <> '[{"companyName": "Gamma Co", "label": "Not Moving Forward"},
                            {"companyName": "Beta Co",  "label": "Closed Won"},
                            {"companyName": "Alpha Co", "label": "Accepted"},
                            {"companyName": "Delta Co", "label": "Sent to you"}]'::jsonb then
    raise exception 'items wrong: %', o.payload->'items';
  end if;
  if o.payload->>'weekLabel' <> 'Dec 31' or o.payload->>'slug' <> 'dg-a' or o.payload->>'orgName' <> 'Digest Org'
     or o.payload->>'partnerName' <> 'Jane CPA' then
    raise exception 'header fields wrong: %', o.payload;
  end if;
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{22}$' or o.payload->>'unsubscribeToken' <> v_token then
    raise exception 'token wrong: % vs %', v_token, o.payload->>'unsubscribeToken';
  end if;

  -- Quiet, opted out, suspended.
  if (select digest_week from portal_users where id = 'a065b000-0000-0000-0000-000000000003') is distinct from '2030-02' then
    raise exception 'a quiet partner is evaluated once for the week';
  end if;
  if exists (select 1 from portal_email_outbox where portal_user_id in ('a065b000-0000-0000-0000-000000000002',
               'a065b000-0000-0000-0000-000000000003', 'a065b000-0000-0000-0000-000000000004')) then
    raise exception 'only PU1 gets a digest';
  end if;
  if (select digest_week from portal_users where id = 'a065b000-0000-0000-0000-000000000002') is not null then
    raise exception 'an opted-out partner is never evaluated';
  end if;
end $$;

-- 4. A re-run the same week queues nothing.
do $$ begin
  if public.enqueue_portal_digests('2030-01-07 18:00Z') <> 0 or public.enqueue_portal_digests('2030-01-10 18:00Z') <> 0 then
    raise exception 'one digest per week';
  end if;
end $$;

-- 5. Week 2 with values hidden: no amount, items capped at 10, counts stay true.
do $$ declare o portal_email_outbox; begin
  update organizations set partner_value_visibility = false where id = '00000000-0000-0000-0000-000000001065';
  if public.enqueue_portal_digests('2030-01-14 16:30Z') <> 1 then raise exception 'week 2 digest missing'; end if;
  select * into o from portal_email_outbox where dedupe_key = 'digest:a065b000-0000-0000-0000-000000000001:2030-03';
  if o.payload->'valueCents' <> 'null'::jsonb then raise exception 'value must be hidden: %', o.payload->'valueCents'; end if;
  if jsonb_array_length(o.payload->'items') <> 10 then raise exception 'items capped at 10, got %', jsonb_array_length(o.payload->'items'); end if;
  if (o.payload->'counts'->>'submitted')::int <> 13 or (o.payload->'counts'->>'closedWon')::int <> 1 then
    raise exception 'week 2 counts wrong: %', o.payload->'counts';
  end if;
  if o.payload->>'weekLabel' <> 'Jan 7' then raise exception 'week 2 label wrong: %', o.payload->>'weekLabel'; end if;
end $$;

-- 6. The claim: a live digest goes out; one whose user turned the digest off is dropped.
do $$ declare v_pu1 uuid; v_pu2 uuid; begin
  insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001065', 'partner_digest', 'a065b000-0000-0000-0000-000000000002', '{}', 't065-pu2');
  select c.id into v_pu1 from public.claim_portal_emails(50) c where c.recipient = 'jane@dg.example' and c.kind = 'partner_digest' limit 1;
  if v_pu1 is null then raise exception 'a live digest must be claimed'; end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't065-pu2' and dropped_at is not null and last_error = 'recipient_inactive') then
    raise exception 'a digest for a user who turned it off must be dropped';
  end if;
end $$;

-- 7. Unsubscribe: by token, per org, silent, idempotent, rate limited per IP.
do $$ declare v_token text; n int; begin
  select digest_unsubscribe_token into v_token from portal_users where id = 'a065b000-0000-0000-0000-000000000001';
  perform public.portal_unsubscribe_digest('DG-A ', v_token, '203.0.113.7');
  if (select notification_prefs from portal_users where id = 'a065b000-0000-0000-0000-000000000001') <> '{"digest": false}'::jsonb then
    raise exception 'unsubscribe did not turn the digest off';
  end if;
  perform public.portal_unsubscribe_digest('dg-a', v_token, '203.0.113.7');
  select count(*) into n from portal_audit_log where action = 'unsubscribe' and ip = '203.0.113.7';
  if n <> 2 then raise exception 'every request is audited, got %', n; end if;

  update portal_users set digest_unsubscribe_token = 'tok3tok3tok3tok3tok3tk' where id = 'a065b000-0000-0000-0000-000000000003';
  perform public.portal_unsubscribe_digest('dg-b', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  perform public.portal_unsubscribe_digest('dg-a', 'not a token', '203.0.113.7');
  perform public.portal_unsubscribe_digest('nope', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  insert into portal_audit_log (org_id, action, ip)
  select '00000000-0000-0000-0000-000000001065', 'unsubscribe', '198.51.100.9' from generate_series(1, 30);
  perform public.portal_unsubscribe_digest('dg-a', 'tok3tok3tok3tok3tok3tk', '198.51.100.9');
  if (select notification_prefs from portal_users where id = 'a065b000-0000-0000-0000-000000000003') <> '{}'::jsonb then
    raise exception 'another org, a bad token, an unknown slug and a limited IP must change nothing';
  end if;
  perform public.portal_unsubscribe_digest('dg-a', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  if (select notification_prefs ->> 'digest' from portal_users where id = 'a065b000-0000-0000-0000-000000000003') <> 'false' then
    raise exception 'the right slug and token must work';
  end if;
end $$;

-- 8. Export audit (NFR-PORT-06).
do $$ declare n int; begin
  perform public.portal_record_export('00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001',
    'a065b000-0000-0000-0000-000000000001', '203.0.113.8');
  select count(*) into n from portal_audit_log where action = 'export' and portal_user_id = 'a065b000-0000-0000-0000-000000000001' and ip = '203.0.113.8';
  if n <> 1 then raise exception 'export must be audited, got %', n; end if;
  perform _t_raises($q$select public.portal_record_export('00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000004',
    'a065b000-0000-0000-0000-000000000004', null)$q$, 'not_authorized');
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/065_portal_digest.sql`
Expected: FAIL with `function public.enqueue_portal_digests(timestamp with time zone) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261022000004_portal_digest.sql`:

```sql
-- 20261022000004_portal_digest.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-83, 84, 85, NFR-PORT-06).
--
-- 1. Weekly summary. portal_notify calls enqueue_portal_digests(now()) every
--    2 minutes, next to enqueue_portal_nudges. For each ACTIVE portal user
--    whose digest preference is on (notification_prefs.digest, missing means
--    on, the Profile page toggle from 2A), once per ISO week, at or after Monday
--    08:00 in the partner OWNER's time zone (path_preferences.timezone through
--    _portal_local_tz, default America/New_York): one email about the previous
--    Monday to Monday. Inbound referrals by partner label (new, Accepted, In
--    Progress, Closed Won, Not Moving Forward) and referrals sent to the
--    partner. Closed Won value only while the ISO shows values (FR-PORT-85).
--    Nothing for a quiet week. portal_users.digest_week remembers the week
--    already evaluated, so a quiet partner is not re-scanned every 2 minutes.
-- 2. Unsubscribe (FR-PORT-84): a per-user token, issued at the first digest,
--    stored as issued (it goes into every digest and can only turn this one
--    email off). portal_unsubscribe_digest answers nothing either way.
-- 3. The claim re-checks the preference at send time, so an opt-out between
--    queueing and sending wins.
-- 4. Export audit (NFR-PORT-06): portal_api records each CSV download.

-- 1. Columns ------------------------------------------------------------------------------
alter table portal_users
  add column if not exists digest_unsubscribe_token text,
  add column if not exists digest_week text;
create unique index if not exists portal_users_digest_token_uidx
  on portal_users (digest_unsubscribe_token) where digest_unsubscribe_token is not null;

-- 2. Helpers ----------------------------------------------------------------------------------
create or replace function public._portal_digest_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

-- Same reading as portal_get_profile: only a JSON false turns it off.
create or replace function public._portal_digest_wants(p_prefs jsonb)
returns boolean language sql immutable security definer set search_path = public, extensions as $$
  select case when jsonb_typeof(p_prefs -> 'digest') = 'boolean' then (p_prefs ->> 'digest')::boolean else true end
$$;

-- Everything that happened to a partner's referrals in [p_from, p_to).
-- rank breaks a same-instant tie toward the later step (accepted then working on a merge).
create or replace function public._portal_digest_events(p_org uuid, p_partner uuid, p_from timestamptz, p_to timestamptz)
returns table (referral_id uuid, company_name text, at timestamptz, kind text, rank integer, label text)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, r.company_name, r.submitted_at, 'submitted'::text, 0, 'Received'::text
    from referrals r
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'inbound'
     and r.submitted_at >= p_from and r.submitted_at < p_to
  union all
  select r.id, r.company_name, h.created_at,
         case h.to_status when 'accepted' then 'accepted'
                          when 'working'  then 'in_progress'
                          when 'won'      then 'closed_won'
                          else 'not_moving_forward' end,
         case h.to_status when 'accepted' then 1 when 'working' then 2 else 3 end,
         public._portal_status_label(h.to_status)
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'inbound'
     and h.to_status in ('accepted','working','won','lost','declined')
     and h.created_at >= p_from and h.created_at < p_to
  union all
  select r.id, r.company_name, r.submitted_at, 'sent_to_you'::text, 0, 'Sent to you'::text
    from referrals r
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'outbound'
     and r.submitted_at >= p_from and r.submitted_at < p_to
$$;

-- 3. The weekly summary ------------------------------------------------------------------------
create or replace function public.enqueue_portal_digests(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_count integer := 0;
  v_token text;
  v_value bigint;
  v_items jsonb;
  v_id    uuid;
  rec     record;
  c       record;
begin
  -- One selection at a time: two overlapping drains must not both build a digest.
  perform pg_advisory_xact_lock(hashtextextended('portal_digests', 0));

  for rec in
    with base as (
      select u.id as portal_user_id, u.org_id, u.partner_id, u.digest_unsubscribe_token, u.digest_week,
             o.slug, o.name as org_name, o.partner_value_visibility, p.name as partner_name,
             public._portal_local_tz(pp.timezone) as tz
        from portal_users u
        join organizations o on o.id = u.org_id
        join partners p on p.id = u.partner_id and p.org_id = u.org_id
        left join path_preferences pp on pp.user_id = p.owner_id
       where u.status = 'active' and o.portal_enabled and not o.is_disabled
         and public._portal_digest_wants(u.notification_prefs)
    ),
    weeks as (
      select b.*, date_trunc('week', v_now at time zone b.tz)::date as week_start
        from base b
    )
    select w.*,
           to_char(w.week_start, 'IYYY-IW') as iso_week,
           ((w.week_start - 7)::timestamp at time zone w.tz) as period_start,
           (w.week_start::timestamp at time zone w.tz) as period_end
      from weeks w
     where (v_now at time zone w.tz) >= w.week_start + time '08:00'
       and w.digest_week is distinct from to_char(w.week_start, 'IYYY-IW')
     order by w.portal_user_id
  loop
    -- Evaluated for this week whether or not anything is sent.
    update portal_users set digest_week = rec.iso_week where id = rec.portal_user_id;

    select count(distinct e.referral_id) filter (where e.kind = 'submitted')          as submitted,
           count(distinct e.referral_id) filter (where e.kind = 'accepted')           as accepted,
           count(distinct e.referral_id) filter (where e.kind = 'in_progress')        as in_progress,
           count(distinct e.referral_id) filter (where e.kind = 'closed_won')         as closed_won,
           count(distinct e.referral_id) filter (where e.kind = 'not_moving_forward') as not_moving_forward,
           count(distinct e.referral_id) filter (where e.kind = 'sent_to_you')        as sent_to_you
      into c
      from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e;

    continue when c.submitted + c.accepted + c.in_progress + c.closed_won
                  + c.not_moving_forward + c.sent_to_you = 0;

    v_value := null;
    if rec.partner_value_visibility and c.closed_won > 0 then
      select coalesce(sum(d.value_cents), 0)::bigint into v_value
        from referrals r
        join deals d on d.id = r.deal_id
       where r.id in (select e.referral_id
                        from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e
                       where e.kind = 'closed_won');
    end if;

    -- Each referral once, at its latest step in the week; newest first; at most 10.
    select coalesce(jsonb_agg(jsonb_build_object('companyName', x.company_name, 'label', x.label)
                              order by x.at desc, x.referral_id), '[]'::jsonb)
      into v_items
      from (
        select y.*
          from (select distinct on (e.referral_id) e.*
                  from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e
                 order by e.referral_id, e.at desc, e.rank desc) y
         order by y.at desc, y.referral_id
         limit 10
      ) x;

    v_token := rec.digest_unsubscribe_token;
    if v_token is null then
      v_token := public._portal_digest_token();
      update portal_users set digest_unsubscribe_token = v_token where id = rec.portal_user_id;
    end if;

    v_id := null;
    insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
    values (rec.org_id, 'partner_digest', rec.portal_user_id,
            jsonb_build_object(
              'slug',             rec.slug,
              'orgName',          rec.org_name,
              'partnerName',      rec.partner_name,
              'weekLabel',        to_char(rec.week_start - 7, 'Mon FMDD'),
              'counts',           jsonb_build_object(
                                    'submitted',        c.submitted,
                                    'accepted',         c.accepted,
                                    'inProgress',       c.in_progress,
                                    'closedWon',        c.closed_won,
                                    'notMovingForward', c.not_moving_forward,
                                    'sentToYou',        c.sent_to_you),
              'valueCents',       v_value,
              'items',            v_items,
              'unsubscribeToken', v_token),
            'digest:' || rec.portal_user_id::text || ':' || rec.iso_week)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

-- 4. Unsubscribe (no session) ---------------------------------------------------------------------
-- Silent on every mismatch (unknown slug, disabled org, malformed or unknown
-- token, another org's token). 30 requests per IP per hour; a missing IP has
-- no bucket. Works while the portal is off: the email may still be in an inbox.
create or replace function public.portal_unsubscribe_digest(p_slug text, p_token text, p_ip text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org   uuid;
  v_ip    text := nullif(btrim(coalesce(p_ip, '')), '');
  v_token text := btrim(coalesce(p_token, ''));
  v_user  uuid;
begin
  select o.id into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and not o.is_disabled;
  if v_org is null then
    return;
  end if;

  if v_ip is not null then
    -- Count-then-insert: serialize the per-IP bucket.
    perform pg_advisory_xact_lock(hashtextextended('portal_unsubscribe_ip:' || v_ip, 0));
    if (select count(*) from portal_audit_log a
         where a.action = 'unsubscribe' and a.ip = v_ip
           and a.created_at > now() - interval '1 hour') >= 30 then
      return;
    end if;
  end if;

  if v_token ~ '^[A-Za-z0-9_-]{16,64}$' then
    update portal_users u
       set notification_prefs = u.notification_prefs || '{"digest": false}'::jsonb,
           updated_at         = now()
     where u.org_id = v_org and u.digest_unsubscribe_token = v_token
    returning u.id into v_user;
  end if;

  perform public._portal_audit(v_org, v_user, 'unsubscribe', v_ip, null);
end $$;

-- 5. Export audit -------------------------------------------------------------------------------------
create or replace function public.portal_record_export(p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  perform public._portal_audit_referral(p_org, p_portal_user, 'export', null, p_ip);
end $$;

-- 6. The claim ----------------------------------------------------------------------------------------
-- Identical to 20261016000003 except the portal-user branch: a partner_digest
-- row has no referral and is live only while the digest preference is on.
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
                              and case when o.kind = 'partner_digest'
                                       then o.referral_id is null
                                            and public._portal_digest_wants(pu.notification_prefs)
                                       else rf.id is not null and rf.org_id = o.org_id
                                            and rf.partner_id = pu.partner_id
                                            and rf.purged_at is null
                                  end, false)
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

-- Privileges --------------------------------------------------------------------------------------------
revoke execute on function public._portal_digest_token()                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_digest_wants(jsonb)                                     from public, anon, authenticated, service_role;
revoke execute on function public._portal_digest_events(uuid, uuid, timestamptz, timestamptz)     from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_digests(timestamptz)                             from public, anon, authenticated;
revoke execute on function public.portal_unsubscribe_digest(text, text, text)                     from public, anon, authenticated;
revoke execute on function public.portal_record_export(uuid, uuid, uuid, text)                    from public, anon, authenticated;
revoke execute on function public.claim_portal_emails(integer)                                    from public, anon, authenticated;
grant  execute on function public.enqueue_portal_digests(timestamptz)                             to service_role;
grant  execute on function public.portal_unsubscribe_digest(text, text, text)                     to service_role;
grant  execute on function public.portal_record_export(uuid, uuid, uuid, text)                    to service_role;
grant  execute on function public.claim_portal_emails(integer)                                    to service_role;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase db reset && for t in 046_portal_email_outbox 052_portal_reads_include_purged 065_portal_digest; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$t.sql || echo "FAILED $t"; done`
Expected: no `FAILED` line (the claim is unchanged for every existing kind).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022000004_portal_digest.sql supabase/tests/065_portal_digest.sql
git commit -m "feat(portal): weekly partner digest, unsubscribe and export audit in SQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Erase notes, queued notes and the unsubscribe token on purge (SQL)

**Files:**
- Create: `supabase/migrations/20261022000005_partner_notes_purge.sql`
- Test: `supabase/tests/066_partner_notes_purge.sql`

**Interfaces:**
- Consumes (SQL): Tasks 1 to 3 (`referral_partner_notes`, `partner_referral_sent` payload key `note`, `portal_users.digest_unsubscribe_token`, `digest_week`, digest payload key `unsubscribeToken`).
- Produces (SQL): `public.purge_declined_referrals(timestamptz) returns integer` and `public.portal_purge_user(uuid) returns void`, same signatures and grants, with these additions only:
  - referral purge: deletes `referral_partner_notes` of the purged referrals; sets `payload.note` to JSON null on their outbox rows.
  - identity erase: deletes that portal user's `referral_partner_notes`; clears `digest_unsubscribe_token` and `digest_week`; sets `payload.unsubscribeToken` to JSON null on that user's outbox rows.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/066_partner_notes_purge.sql`:

```sql
-- Tests for 20261022000005_partner_notes_purge (Partner Portal Phase 2B-3,
-- FR-PORT-91..95, NFR-PORT-09).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/066_partner_notes_purge.sql
-- Self-cleans via ROLLBACK.
--
-- Org np-a: boss administrator; rita rep. P1 Jane CPA (owner rita) with ACTIVE
-- PU1 (token set). R1 outbound, withdrawn 100 days ago, with a partner note and
-- a queued "sent to you" email carrying a note. R2 outbound, live, with a note.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001066', 'Purge Org', 'np-a', 'np-a-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0660000-0000-0000-0000-000000000001', 'boss@np.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0660000-0000-0000-0000-000000000002', 'rita@np.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0660000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'admin', 'administrator',      'Boss',     'boss@np.example', 'npboss'::ltree,      null),
  ('a0660000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'rep',   'sales_professional', 'Rita Rep', 'rita@np.example', 'npboss.rita'::ltree, 'a0660000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a066a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@np.example', null);

insert into portal_users (id, org_id, partner_id, email, status, digest_unsubscribe_token, digest_week) values
  ('a066b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'jane@np.example', 'active', 'npTokennpTokennpToken1', '2030-02');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, notes, partner_note_visible,
                       assigned_user_id, submitted_by_user_id) values
  ('a066e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn',
   'Old Co', 'Olga', 'For Jane', true, 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002'),
  ('a066e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',
   'Live Co', 'Liv', '', false, 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002');

update referral_status_history set created_at = now() - interval '100 days'
 where referral_id = 'a066e000-0000-0000-0000-000000000001';

insert into referral_partner_notes (org_id, referral_id, portal_user_id, body) values
  ('00000000-0000-0000-0000-000000001066', 'a066e000-0000-0000-0000-000000000001', 'a066b000-0000-0000-0000-000000000001', 'Olga says no'),
  ('00000000-0000-0000-0000-000000001066', 'a066e000-0000-0000-0000-000000000002', 'a066b000-0000-0000-0000-000000000001', 'Liv is keen');

insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_referral_sent', 'a066e000-0000-0000-0000-000000000001', 'a066b000-0000-0000-0000-000000000001',
   '{"slug": "np-a", "orgName": "Purge Org", "partnerName": "Jane CPA", "companyName": "Old Co", "ref": "REF-A066E000", "repName": "Rita Rep", "repEmail": "rita@np.example", "note": "For Jane"}',
   't066-sent');
insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_digest', 'a066b000-0000-0000-0000-000000000001',
   '{"slug": "np-a", "orgName": "Purge Org", "partnerName": "Jane CPA", "weekLabel": "Dec 31", "counts": {}, "valueCents": null, "items": [], "unsubscribeToken": "npTokennpTokennpToken1"}',
   't066-digest');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. The referral purge erases the note-back on purged referrals and the note in queued payloads.
do $$ declare n int; begin
  -- The job is global; other fixtures in the database may also be due, so at least one.
  n := public.purge_declined_referrals(now());
  if n < 1 or not exists (select 1 from referrals where id = 'a066e000-0000-0000-0000-000000000001' and purged_at is not null) then
    raise exception 'R1 should be purged (count %)', n;
  end if;
  if exists (select 1 from referral_partner_notes where referral_id = 'a066e000-0000-0000-0000-000000000001') then
    raise exception 'notes on a purged referral must be deleted';
  end if;
  if not exists (select 1 from referral_partner_notes where referral_id = 'a066e000-0000-0000-0000-000000000002') then
    raise exception 'notes on a live referral stay';
  end if;
  if (select payload->'note' from portal_email_outbox where dedupe_key = 't066-sent') <> 'null'::jsonb then
    raise exception 'a queued payload must not keep the note';
  end if;
  if (select dropped_at is null from portal_email_outbox where dedupe_key = 't066-sent') then
    raise exception 'the unsent email for a purged referral is dropped (2A rule)';
  end if;
end $$;

-- 2. Erasing the identity deletes their notes and the unsubscribe token everywhere.
do $$ begin
  perform _t_act('a0660000-0000-0000-0000-000000000001');
  perform public.portal_purge_user('a066a000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  if exists (select 1 from referral_partner_notes where portal_user_id = 'a066b000-0000-0000-0000-000000000001') then
    raise exception 'an erased identity keeps no notes';
  end if;
  if exists (select 1 from portal_users where id = 'a066b000-0000-0000-0000-000000000001'
              and (digest_unsubscribe_token is not null or digest_week is not null)) then
    raise exception 'the token and digest week must be cleared';
  end if;
  if (select payload->'unsubscribeToken' from portal_email_outbox where dedupe_key = 't066-digest') <> 'null'::jsonb
     or (select payload->'partnerName' from portal_email_outbox where dedupe_key = 't066-digest') <> 'null'::jsonb then
    raise exception 'queued payloads must lose the token and the name';
  end if;
  if (select status from portal_users where id = 'a066b000-0000-0000-0000-000000000001') <> 'revoked' then
    raise exception 'the 2A erase still revokes access';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/066_partner_notes_purge.sql`
Expected: FAIL with `notes on a purged referral must be deleted`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261022000005_partner_notes_purge.sql`:

```sql
-- 20261022000005_partner_notes_purge.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-91..95, NFR-PORT-09). The 2A erase
-- functions learn about this phase's personal text:
--   purge_declined_referrals  deletes the partner's notes on purged referrals
--                             (the referral_updates precedent) and nulls the
--                             rep's note in queued "sent to you" payloads.
--   portal_purge_user         deletes that portal user's notes, clears the
--                             unsubscribe token and digest week, and nulls the
--                             token in that user's queued payloads.
-- Both bodies are otherwise identical to 20261016000002 and 20261016000007.

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
  -- The candidate set was read without row locks, so the UPDATE re-checks the
  -- purge predicate: a referral reinstated (or already purged) since the
  -- SELECT is skipped. Every later statement runs on the rows actually erased.
  with erased as (
    update referrals r
       set contact_name          = null,
           contact_email         = null,
           contact_phone         = null,
           address               = null,
           notes                 = '',
           consent_text_snapshot = null,
           decline_note          = null,
           place_id              = null,
           purged_at             = v_now
      from organizations o
     where r.id = any(v_ids)
       and o.id = r.org_id
       and r.purged_at is null
       and r.status in ('declined','withdrawn')
       and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
           <= v_now - make_interval(days => o.declined_retention_days)
    returning r.id
  )
  select coalesce(array_agg(e.id), '{}'::uuid[]) into v_ids from erased e;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  delete from referral_updates u where u.referral_id = any(v_ids);
  -- 2B-3: the partner's own notes on a referral sent to them.
  delete from referral_partner_notes n where n.referral_id = any(v_ids);

  -- Privacy erase of otherwise immutable history: the decline note (copied here
  -- by the status trigger) is personal text. Rows are kept; only note is nulled.
  update referral_status_history h
     set note = null
   where h.referral_id = any(v_ids) and h.note is not null;

  update portal_email_outbox o
     set dropped_at = v_now, last_error = 'purged'
   where o.referral_id = any(v_ids)
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{updateBody}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'updateBody'
     and o.payload->>'updateBody' is not null;

  -- 2B-3: the rep's note for the partner rides "sent to you" payloads.
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{note}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'note'
     and o.payload->>'note' is not null;

  -- Earlier audit rows for these referrals must not keep a partner IP.
  update portal_audit_log a
     set ip = null
   where a.referral_id = any(v_ids) and a.ip is not null;

  insert into portal_audit_log (org_id, action, referral_id)
  select r.org_id, 'purge'::portal_audit_action, r.id
    from referrals r
   where r.id = any(v_ids);

  return cardinality(v_ids);
end $$;

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
     set status                   = 'revoked',
         email                    = 'purged+' || v_user.id::text || '@invalid',
         terms_ip                 = null,
         notification_prefs       = '{}'::jsonb,
         digest_unsubscribe_token = null,
         digest_week              = null,
         updated_at               = now()
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
  -- The partner's name must not outlive the erase in any payload (sent or not).
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{partnerName}', 'null'::jsonb)
   where o.portal_user_id = v_user.id and o.payload ? 'partnerName';
  -- 2B-3: nor the unsubscribe token.
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{unsubscribeToken}', 'null'::jsonb)
   where o.portal_user_id = v_user.id and o.payload ? 'unsubscribeToken';
  -- Profile edits carried the partner's name and phone; keep the audit rows, drop the values.
  update partner_profile_changes c
     set old_value = null, new_value = null
   where c.partner_id = p_partner_id and c.org_id = v_org;
  -- 2B-3: what they wrote back on referrals sent to them.
  delete from referral_partner_notes n where n.portal_user_id = v_user.id;

  perform public._portal_audit(v_org, v_user.id, 'purge', null, auth.uid());
end $$;

-- create or replace keeps grants; restated so this file reads on its own.
revoke execute on function public.purge_declined_referrals(timestamptz) from public, anon, authenticated;
grant  execute on function public.purge_declined_referrals(timestamptz) to service_role;
revoke execute on function public.portal_purge_user(uuid)               from public, anon;
grant  execute on function public.portal_purge_user(uuid)               to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `supabase db reset && for t in 051_referral_purge 056_portal_profile 066_partner_notes_purge; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/$t.sql || echo "FAILED $t"; done`
Expected: no `FAILED` line.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022000005_partner_notes_purge.sql supabase/tests/066_partner_notes_purge.sql
git commit -m "feat(portal): purges erase partner notes and the digest token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Email copy for "sent to you", the weekly summary and partner notes (pure TS)

**Files:**
- Modify: `supabase/functions/_shared/emailTemplate.ts`, test `supabase/functions/_shared/emailTemplate.test.ts`
- Modify: `supabase/functions/_shared/portalNotifyEmail.ts`, test `supabase/functions/_shared/portalNotifyEmail.test.ts`

**Interfaces:**
- Consumes: the outbox payloads from Tasks 1 to 3 (exact key lists there); `portalUrl(appBaseUrl, slug, suffix)` from `portalEmail.ts`; `PORTAL_LABELS`.
- Produces:
  - `EmailOptions.footerLink?: { label: string; url: string }` (rendered under the footnote in HTML and as `<label>: <url>` in text; absent means byte-identical output).
  - In `portalNotifyEmail.ts`: `PARTNER_SENT_KIND = "partner_referral_sent"`, `PARTNER_DIGEST_KIND = "partner_digest"`, `DIGEST_SENT_LABEL = "Sent to you"`; `INTERNAL_NOTIFY_KINDS` gains `"internal_partner_note"`; `parseSentPayload(raw: unknown): PartnerSentPayload | null`; `parseDigestPayload(raw: unknown): PartnerDigestPayload | null`; `PortalNotifyEmail.headers?: Record<string, string>`; `NotifyContext.portalApiUrl?: string` (the portal_api function URL, for the one-click header). `buildPortalNotifyEmail` dispatches the two new partner kinds before the 1C list, so `PARTNER_NOTIFY_KINDS` and `KIND_LABEL` are unchanged (the existing string audit iterates them with the 1C payload).
  - Digest one-click URL: `${portalApiUrl}/unsubscribe_digest?slug=<slug>&t=<token>`; footer link: `${appBaseUrl}/p/<slug>/unsubscribe?t=<token>`; headers exactly `{ "List-Unsubscribe": "<one-click URL>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/emailTemplate.test.ts`:

```ts
describe("renderEmail footerLink", () => {
  const BASE_OPTS = {
    preheader: "p",
    heading: "h",
    bodyLines: ["one"],
    footnote: "You get this weekly.",
  };

  it("renders the link under the footnote, escaped, and as a text line", () => {
    const { html, text } = renderEmail({
      ...BASE_OPTS,
      footerLink: { label: "Unsubscribe <now>", url: 'https://x.example/u?t=a&b="c"' },
    });
    expect(html).toContain('<a href="https://x.example/u?t=a&b=&quot;c&quot;"');
    expect(html).toContain("Unsubscribe &lt;now&gt;</a>");
    expect(text).toContain('Unsubscribe <now>: https://x.example/u?t=a&b="c"');
    expect(text.indexOf("You get this weekly.")).toBeLessThan(text.indexOf("Unsubscribe <now>"));
  });

  it("changes nothing when absent", () => {
    expect(renderEmail({ ...BASE_OPTS, footerLink: undefined })).toEqual(renderEmail(BASE_OPTS));
  });
});
```

(`emailTemplate.test.ts` already imports `describe`, `it`, `expect` and `renderEmail`.)

Append to `supabase/functions/_shared/portalNotifyEmail.test.ts` (extend the existing import from `./portalNotifyEmail` with `DIGEST_SENT_LABEL, PARTNER_DIGEST_KIND, PARTNER_SENT_KIND, parseDigestPayload, parseSentPayload`):

```ts
const API = "https://proj.supabase.co/functions/v1/portal_api";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const SENT = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  note: "Ask for Ann after 3pm.\nShe runs the books.",
};
const DIGEST = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  weekLabel: "Dec 31",
  counts: { submitted: 2, accepted: 1, inProgress: 0, closedWon: 1, notMovingForward: 1, sentToYou: 1 },
  valueCents: 500000,
  items: [
    { companyName: "Gamma Co", label: "Not Moving Forward" },
    { companyName: "Delta Co", label: "Sent to you" },
  ],
  unsubscribeToken: TOKEN,
};

describe("partner_referral_sent", () => {
  it("names the ISO and the business, links to the sent referral, replies to the rep", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { ...CTX, portalApiUrl: API })!;
    expect(e.subject).toBe("Acme ISO sent you a referral: Fresh Bakery");
    expect(e.heading).toBe("Acme ISO sent you a referral");
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/s/${RID}`);
    expect(e.replyTo).toBe("rita@acme.example");
    expect(e.audience).toBe("partner");
    expect(e.orgName).toBe("Acme ISO");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Rita Rep at Acme ISO sent you Fresh Bakery. Open it to see the contact details.",
      "Rita Rep added a note:",
      "Ask for Ann after 3pm.",
      "She runs the books.",
      "Reply to this email to reach Rita Rep.",
    ]);
    expect(e.headers).toBeUndefined();
    expect(e.footerLink).toBeUndefined();
  });

  it("says nothing about a note when there is none, and falls back without a rep", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, { ...SENT, note: null, repName: null, repEmail: null }, CTX)!;
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Acme ISO sent you Fresh Bakery. Open it to see the contact details.",
      "Someone at Acme ISO can tell you more.",
    ]);
    expect(e.replyTo).toBeNull();
  });

  it("links to the portal home without a referral id", () => {
    expect(buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { appBaseUrl: BASE, referralId: null })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
  });

  it("drops a payload with an extra or missing key", () => {
    expect(parseSentPayload({ ...SENT, status: "accepted" })).toBeNull();
    const { note: _note, ...missing } = SENT;
    expect(parseSentPayload(missing)).toBeNull();
    expect(parseSentPayload({ ...SENT, companyName: " " })).toBeNull();
  });
});

describe("partner_digest", () => {
  const ctx = { ...CTX, referralId: null, portalApiUrl: API };

  it("lists only what happened, with the value and the unsubscribe link and headers", () => {
    const e = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, ctx)!;
    expect(e.subject).toBe("Your weekly referral summary from Acme ISO");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Here's what happened with your referrals the week of Dec 31.",
      "New referrals you sent: 2",
      "Accepted: 1",
      "Closed Won: 1 ($5,000)",
      "Not Moving Forward: 1",
      "Acme ISO sent you: 1",
      "Recent activity:",
      "- Gamma Co: Not Moving Forward",
      `- Delta Co: ${DIGEST_SENT_LABEL}`,
    ]);
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/home`);
    expect(e.footerLink).toEqual({ label: "Unsubscribe from the weekly summary", url: `${BASE}/p/acme/unsubscribe?t=${TOKEN}` });
    expect(e.headers).toEqual({
      "List-Unsubscribe": `<${API}/unsubscribe_digest?slug=acme&t=${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(e.replyTo).toBeNull();
    expect(e.audience).toBe("partner");
  });

  it("states Closed Won without an amount when the ISO hides values", () => {
    const e = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, valueCents: null }, ctx)!;
    expect(e.bodyLines).toContain("Closed Won: 1");
    expect(renderEmail(e).text).not.toContain("$");
  });

  it("is not built without the portal_api URL, for a quiet week, or for a bad token", () => {
    expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, { ...ctx, portalApiUrl: undefined })).toBeNull();
    const zero = { submitted: 0, accepted: 0, inProgress: 0, closedWon: 0, notMovingForward: 0, sentToYou: 0 };
    expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, counts: zero, items: [] }, ctx)).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, unsubscribeToken: "short" })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, unsubscribeToken: null })).toBeNull();
  });

  it("drops an item with an internal status, too many items, odd counts, or an extra key", () => {
    expect(parseDigestPayload({ ...DIGEST, items: [{ companyName: "X", label: "won" }] })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, items: Array.from({ length: 11 }, () => ({ companyName: "X", label: "Accepted" })) })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, counts: { ...DIGEST.counts, submitted: -1 } })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, counts: { ...DIGEST.counts, stage: 1 } })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, status: "won" })).toBeNull();
  });
});

describe("internal_partner_note", () => {
  it("tells the rep a partner wrote back and links to the deal", () => {
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_partner_note");
    const e = buildPortalNotifyEmail(
      "internal_partner_note",
      { appUrlPath: "/pipeline/3f9a21c0-1111-4222-8333-444455556666", companyNames: ["Fresh Bakery"], count: 1 },
      CTX,
    )!;
    expect(e.subject).toBe("New partner note: Fresh Bakery");
    expect(e.ctaUrl).toBe(`${BASE}/pipeline/3f9a21c0-1111-4222-8333-444455556666`);
    expect(e.audience).toBe("internal");
    expect(e.headers).toBeUndefined();
  });
});

describe("only the weekly summary can be unsubscribed from (FR-PORT-84)", () => {
  it("no other kind carries headers or a footer link", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, withLabel(label, { updateBody: "Hi" }), { ...CTX, portalApiUrl: API })!;
      expect(e.headers).toBeUndefined();
      expect(e.footerLink).toBeUndefined();
      expect(renderEmail(e).text).not.toMatch(/unsubscribe/i);
    }
    for (const kind of INTERNAL_NOTIFY_KINDS) {
      const e = buildPortalNotifyEmail(kind, { appUrlPath: "/partners", companyNames: ["A"], count: 1 }, CTX)!;
      expect(e.headers).toBeUndefined();
      expect(e.footerLink).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/emailTemplate.test.ts ../../supabase/functions/_shared/portalNotifyEmail.test.ts`
Expected: FAIL (`PARTNER_SENT_KIND` is not exported; the footer link is not rendered).

- [ ] **Step 3: Add `footerLink` to the template**

In `supabase/functions/_shared/emailTemplate.ts`, add to `EmailOptions` after `brand?`:

```ts
  /** Optional link under the footnote (the weekly summary's unsubscribe link). Absent: output unchanged. */
  footerLink?: { label: string; url: string };
```

In `renderEmail`, after the `ctaFallback` constant add:

```ts
  const footerLinkHtml = opts.footerLink
    ? `<br>
          <a href="${escUrl(opts.footerLink.url)}" style="color:#8089A1;text-decoration:underline;">${esc(opts.footerLink.label)}</a>`
    : "";
```

and change the footnote line of the HTML from `${esc(opts.footnote)}${ctaFallback}` to `${esc(opts.footnote)}${footerLinkHtml}${ctaFallback}`. In the `text` array, change the line `opts.footnote,` to:

```ts
    opts.footnote,
    ...(opts.footerLink ? [`${opts.footerLink.label}: ${opts.footerLink.url}`] : []),
```

- [ ] **Step 4: Add the builders**

In `supabase/functions/_shared/portalNotifyEmail.ts`:

Change `INTERNAL_NOTIFY_KINDS` to:

```ts
export const INTERNAL_NOTIFY_KINDS = [
  "internal_new_referral",
  "internal_nudge",
  "internal_reinstate_available",
  "internal_new_submission",
  "internal_partner_note",
] as const;
```

After `PortalNotifyKind`, add:

```ts
/** Phase 2B-3 partner kinds. Kept out of PARTNER_NOTIFY_KINDS: their payloads have no status label. */
export const PARTNER_SENT_KIND = "partner_referral_sent";
export const PARTNER_DIGEST_KIND = "partner_digest";
/** The digest item label for a referral the ISO sent to the partner. */
export const DIGEST_SENT_LABEL = "Sent to you";

export interface PartnerSentPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  companyName: string;
  ref: string;
  repName: string | null;
  repEmail: string | null;
  /** Only a note the rep wrote for the partner (partner_note_visible); null otherwise. */
  note: string | null;
}

export interface PartnerDigestCounts {
  submitted: number;
  accepted: number;
  inProgress: number;
  closedWon: number;
  notMovingForward: number;
  sentToYou: number;
}

export interface PartnerDigestItem {
  companyName: string;
  label: PortalLabel | typeof DIGEST_SENT_LABEL;
}

export interface PartnerDigestPayload {
  slug: string;
  orgName: string;
  partnerName: string;
  weekLabel: string;
  counts: PartnerDigestCounts;
  valueCents: number | null;
  items: PartnerDigestItem[];
  unsubscribeToken: string;
}
```

Add to `PortalNotifyEmail` (after `replyTo`):

```ts
  /** Extra mail headers; only the weekly summary sets them (List-Unsubscribe, FR-PORT-84). */
  headers?: Record<string, string>;
```

Add to `NotifyContext` (after `referralId`):

```ts
  /** The portal_api function URL, for the digest's one-click unsubscribe header. Without it no digest builds. */
  portalApiUrl?: string;
```

After `parseInternalPayload`, add:

```ts
const SENT_KEYS = ["slug", "orgName", "partnerName", "companyName", "ref", "repName", "repEmail", "note"];
const DIGEST_KEYS = ["slug", "orgName", "partnerName", "weekLabel", "counts", "valueCents", "items", "unsubscribeToken"];
const COUNT_KEYS = ["submitted", "accepted", "inProgress", "closedWon", "notMovingForward", "sentToYou"] as const;
const DIGEST_ITEM_KEYS = ["companyName", "label"];
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function parseSentPayload(raw: unknown): PartnerSentPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, SENT_KEYS)) return null;
  const slug = line(raw.slug);
  const orgName = line(raw.orgName);
  const partnerName = line(raw.partnerName);
  const companyName = line(raw.companyName);
  const ref = line(raw.ref);
  if (!slug || !orgName || !partnerName || !companyName || !ref) return null;
  const repEmail = text(raw.repEmail);
  return {
    slug,
    orgName,
    partnerName,
    companyName,
    ref,
    repName: line(raw.repName),
    repEmail: repEmail && EMAIL_RE.test(repEmail) ? repEmail : null,
    note: text(raw.note),
  };
}

export function parseDigestPayload(raw: unknown): PartnerDigestPayload | null {
  if (!isRecord(raw) || !hasExactKeys(raw, DIGEST_KEYS)) return null;
  const slug = line(raw.slug);
  const orgName = line(raw.orgName);
  const partnerName = line(raw.partnerName);
  const weekLabel = line(raw.weekLabel);
  if (!slug || !orgName || !partnerName || !weekLabel) return null;
  const token = raw.unsubscribeToken;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;

  const rawCounts = raw.counts;
  if (!isRecord(rawCounts) || !hasExactKeys(rawCounts, [...COUNT_KEYS])) return null;
  const counts: Record<string, number> = {};
  for (const key of COUNT_KEYS) {
    const v = rawCounts[key];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    counts[key] = v;
  }

  if (!Array.isArray(raw.items) || raw.items.length > 10) return null;
  const items: PartnerDigestItem[] = [];
  for (const item of raw.items) {
    if (!isRecord(item) || !hasExactKeys(item, DIGEST_ITEM_KEYS)) return null;
    const companyName = line(item.companyName);
    const label = item.label;
    if (!companyName || !(isLabel(label) || label === DIGEST_SENT_LABEL)) return null;
    items.push({ companyName, label: label as PartnerDigestItem["label"] });
  }

  const value = raw.valueCents;
  return {
    slug,
    orgName,
    partnerName,
    weekLabel,
    counts: counts as unknown as PartnerDigestCounts,
    valueCents: typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null,
    items,
    unsubscribeToken: token,
  };
}
```

After `buildPartner`, add:

```ts
function noteLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function buildSent(p: PartnerSentPayload, ctx: NotifyContext): PortalNotifyEmail {
  const suffix = ctx.referralId && UUID_RE.test(ctx.referralId) ? `/s/${ctx.referralId}` : "/home";
  const sender = p.repName ? `${p.repName} at ${p.orgName}` : p.orgName;
  const reach = p.repName && p.repEmail
    ? `Reply to this email to reach ${p.repName}.`
    : p.repEmail
      ? "Reply to this email to reach them."
      : `Someone at ${p.orgName} can tell you more.`;
  return {
    subject: `${p.orgName} sent you a referral: ${p.companyName}`,
    preheader: `${sender} sent you ${p.companyName}.`,
    heading: `${p.orgName} sent you a referral`,
    bodyLines: [
      `Hi ${p.partnerName},`,
      `${sender} sent you ${p.companyName}. Open it to see the contact details.`,
      ...(p.note ? [`${p.repName ?? p.orgName} added a note:`, ...noteLines(p.note)] : []),
      reach,
    ],
    ctaLabel: "View referral",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, suffix),
    footnote: `You're getting this because ${p.orgName} sent you a referral. Reference ${p.ref}.`,
    audience: "partner",
    orgName: p.orgName,
    replyTo: p.repEmail,
  };
}

function buildDigest(p: PartnerDigestPayload, ctx: NotifyContext): PortalNotifyEmail | null {
  const api = typeof ctx.portalApiUrl === "string" ? ctx.portalApiUrl.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/\S+$/.test(api)) return null;
  const c = p.counts;
  if (c.submitted + c.accepted + c.inProgress + c.closedWon + c.notMovingForward + c.sentToYou === 0) return null;

  const token = encodeURIComponent(p.unsubscribeToken);
  const oneClick = `${api}/unsubscribe_digest?slug=${encodeURIComponent(p.slug)}&t=${token}`;
  const lines = [
    c.submitted > 0 ? `New referrals you sent: ${c.submitted}` : null,
    c.accepted > 0 ? `Accepted: ${c.accepted}` : null,
    c.inProgress > 0 ? `In Progress: ${c.inProgress}` : null,
    c.closedWon > 0 ? `Closed Won: ${c.closedWon}${p.valueCents !== null ? ` (${money(p.valueCents)})` : ""}` : null,
    c.notMovingForward > 0 ? `Not Moving Forward: ${c.notMovingForward}` : null,
    c.sentToYou > 0 ? `${p.orgName} sent you: ${c.sentToYou}` : null,
  ].filter((l): l is string => l !== null);
  const items = p.items.map((i) => `- ${i.companyName}: ${i.label}`);

  return {
    subject: `Your weekly referral summary from ${p.orgName}`,
    preheader: `Your referrals with ${p.orgName}, the week of ${p.weekLabel}.`,
    heading: `Your week with ${p.orgName}`,
    bodyLines: [
      `Hi ${p.partnerName},`,
      `Here's what happened with your referrals the week of ${p.weekLabel}.`,
      ...lines,
      ...(items.length > 0 ? ["Recent activity:", ...items] : []),
    ],
    ctaLabel: "Open your referrals",
    ctaUrl: portalUrl(ctx.appBaseUrl, p.slug, "/home"),
    footnote: `You're getting this weekly summary because you send referrals to ${p.orgName}. You can turn it off in your profile.`,
    footerLink: {
      label: "Unsubscribe from the weekly summary",
      url: portalUrl(ctx.appBaseUrl, p.slug, `/unsubscribe?t=${token}`),
    },
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    audience: "partner",
    orgName: p.orgName,
    replyTo: null,
  };
}
```

In `buildInternal`, add before the `internal_reinstate_available` branch:

```ts
  if (kind === "internal_partner_note") {
    const name = p.companyNames[0];
    return {
      subject: `New partner note: ${name}`,
      preheader: `A partner wrote back about ${name}.`,
      heading: "A partner wrote back",
      bodyLines: [`The partner you sent ${name} to left a note on it.`, "Open it to read the note."],
      ctaLabel: "Read the note",
      ctaUrl: url,
      footnote: "You're getting this because you sent this referral to a partner.",
      audience: "internal",
      orgName: null,
      replyTo: null,
    };
  }
```

In `buildPortalNotifyEmail`, add as the first lines of the body:

```ts
  if (kind === PARTNER_SENT_KIND) {
    const p = parseSentPayload(payload);
    return p ? buildSent(p, ctx) : null;
  }
  if (kind === PARTNER_DIGEST_KIND) {
    const p = parseDigestPayload(payload);
    return p ? buildDigest(p, ctx) : null;
  }
```

Also update the file's header comment: "Two Phase 2B-3 partner kinds (referral sent to you, weekly summary) carry their own payloads; only the weekly summary has an unsubscribe link and headers (FR-PORT-84)."

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/emailTemplate.test.ts ../../supabase/functions/_shared/emailTemplate.snapshot.test.ts ../../supabase/functions/_shared/portalNotifyEmail.test.ts`
Expected: PASS (the snapshot test unchanged).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/emailTemplate.ts supabase/functions/_shared/emailTemplate.test.ts supabase/functions/_shared/portalNotifyEmail.ts supabase/functions/_shared/portalNotifyEmail.test.ts
git commit -m "feat(portal): emails for referrals sent to you, the weekly summary and partner notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: portal_notify queues digests and sends the unsubscribe headers

**Files:**
- Modify: `supabase/functions/_shared/portalNotify.ts`, test `supabase/functions/_shared/portalNotify.test.ts`
- Modify: `supabase/functions/portal_notify/index.ts`

**Interfaces:**
- Consumes: `enqueue_portal_digests(p_now)` (Task 3); `buildPortalNotifyEmail(kind, payload, { appBaseUrl, referralId, portalApiUrl })` and `PortalNotifyEmail.headers` (Task 5).
- Produces: `PortalNotifyEnv.portalApiUrl?: string`; `PortalNotifyMessage.headers?: Record<string, string>`; `PortalNotifySummary.digestsQueued: number`. Each run calls, in order: `enqueue_portal_nudges`, `enqueue_portal_digests` (both with `p_now`), then `claim_portal_emails`. A failed digest step is logged and the drain continues.

- [ ] **Step 1: Update the existing tests and write the failing ones**

In `supabase/functions/_shared/portalNotify.test.ts`:

In `setup`, after the `enqueue_portal_nudges` line add:

```ts
    if (name === "enqueue_portal_digests") return { data: 1, error: null };
```

Replace the body of `it("queues the nudges for now, then claims one batch", ...)` with:

```ts
    const { deps, rpc } = setup([]);
    const summary = await drainPortalEmails(deps);
    expect(rpc.mock.calls[0]).toEqual(["enqueue_portal_nudges", { p_now: "2026-10-14T22:30:00.000Z" }]);
    expect(rpc.mock.calls[1]).toEqual(["enqueue_portal_digests", { p_now: "2026-10-14T22:30:00.000Z" }]);
    expect(rpc.mock.calls[2]).toEqual(["claim_portal_emails", { p_limit: PORTAL_NOTIFY_BATCH }]);
    expect(PORTAL_NOTIFY_PACE_MS).toBe(600);
    expect(PORTAL_NOTIFY_BATCH).toBe(20);
    expect(summary).toEqual({ nudgesQueued: 2, digestsQueued: 1, claimed: 0, sent: 0, dropped: 0, failed: 0 });
```

In `it("answers 200 with the summary for the right secret", ...)` change the expectation to:

```ts
    expect(await res.json()).toEqual({ nudgesQueued: 2, digestsQueued: 1, claimed: 1, sent: 1, dropped: 0, failed: 0 });
```

Append inside `describe("drainPortalEmails", ...)`:

```ts
  it("keeps draining when the digest step fails", async () => {
    const { deps, sendEmail } = setup([INTERNAL_ROW], {}, {
      enqueue_portal_digests: () => ({ data: null, error: { message: "lock timeout" } }),
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(summary.digestsQueued).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("sends the weekly summary with the one-click unsubscribe headers and no Reply-To", async () => {
    const digest = {
      id: "e-7",
      org_id: "o-1",
      kind: "partner_digest",
      referral_id: null,
      payload: {
        slug: "acme",
        orgName: "Acme ISO",
        partnerName: "Jane",
        weekLabel: "Dec 31",
        counts: { submitted: 1, accepted: 0, inProgress: 0, closedWon: 0, notMovingForward: 0, sentToYou: 0 },
        valueCents: null,
        items: [{ companyName: "Fresh Bakery", label: "Received" }],
        unsubscribeToken: "AbCdEfGhIjKlMnOpQrStUv",
      },
      recipient: "jane@example.com",
      attempts: 1,
    };
    const api = "https://proj.supabase.co/functions/v1/portal_api";
    const { deps, sendEmail, marks } = setup([digest], { env: { ...ENV, portalApiUrl: api } });
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.headers).toEqual({
      "List-Unsubscribe": `<${api}/unsubscribe_digest?slug=acme&t=AbCdEfGhIjKlMnOpQrStUv>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect("replyTo" in msg).toBe(false);
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.text).toContain("Unsubscribe from the weekly summary: https://app.getnavigatr.io/p/acme/unsubscribe?t=AbCdEfGhIjKlMnOpQrStUv");
    expect(marks).toEqual([{ p_id: "e-7", p_outcome: "sent", p_error: null }]);
  });

  it("drops a weekly summary when the portal_api URL is not configured", async () => {
    const digest = {
      id: "e-8",
      org_id: "o-1",
      kind: "partner_digest",
      referral_id: null,
      payload: {
        slug: "acme",
        orgName: "Acme ISO",
        partnerName: "Jane",
        weekLabel: "Dec 31",
        counts: { submitted: 1, accepted: 0, inProgress: 0, closedWon: 0, notMovingForward: 0, sentToYou: 0 },
        valueCents: null,
        items: [],
        unsubscribeToken: "AbCdEfGhIjKlMnOpQrStUv",
      },
      recipient: "jane@example.com",
      attempts: 1,
    };
    const { deps, sendEmail, marks } = setup([digest]);
    await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-8", p_outcome: "dropped", p_error: "invalid_payload" }]);
  });

  it("never adds headers to any other email", async () => {
    const { deps, sendEmail } = setup([partnerRow("e-1"), INTERNAL_ROW], { env: { ...ENV, portalApiUrl: "https://x.example/fn" } });
    await drainPortalEmails(deps);
    for (const [msg] of sendEmail.mock.calls) expect("headers" in msg).toBe(false);
  });
```

(`errorSpy` is the file-level `console.error` spy installed in `beforeEach`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalNotify.test.ts`
Expected: FAIL (`enqueue_portal_digests` is never called; `digestsQueued` missing; no headers).

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/portalNotify.ts`:

- `PortalNotifyMessage`: add `headers?: Record<string, string>;` after `replyTo?`.
- `PortalNotifyEnv`: add

```ts
  /** The portal_api function URL (`${SUPABASE_URL}/functions/v1/portal_api`): the weekly summary's one-click unsubscribe target. */
  portalApiUrl?: string;
```

- `PortalNotifySummary`: add `digestsQueued: number;` after `nudgesQueued`.
- In `deliver`, build with the URL:

```ts
  const built = buildPortalNotifyEmail(row.kind, row.payload, {
    appBaseUrl: deps.env.appBaseUrl,
    referralId: row.referral_id,
    portalApiUrl: deps.env.portalApiUrl,
  });
```

  and send the headers when the email has them:

```ts
    await deps.sendEmail({
      from,
      to: row.recipient,
      subject: built.subject,
      html,
      text,
      ...(built.replyTo ? { replyTo: built.replyTo } : {}),
      ...(built.headers ? { headers: built.headers } : {}),
    });
```

- In `drainPortalEmails`, start the summary as `{ nudgesQueued: 0, digestsQueued: 0, claimed: 0, sent: 0, dropped: 0, failed: 0 }` and, right after the nudge block, add:

```ts
  // Weekly summaries (2B-3). Like the nudges, a failure here never holds up the drain.
  const digests = await deps.rpc("enqueue_portal_digests", { p_now: now.toISOString() });
  if (digests.error) console.error("[portal_notify] digest enqueue failed:", digests.error.message);
  else summary.digestsQueued = typeof digests.data === "number" ? digests.data : 0;
```

- Update the module comment's first paragraph: "Every run: queue the same-day nudges and the weekly partner summaries for "now" (enqueue_portal_nudges, enqueue_portal_digests), claim one batch ...".

In `supabase/functions/portal_notify/index.ts`, add to `env`:

```ts
    // The weekly summary's List-Unsubscribe target (2B-3). No new secret.
    portalApiUrl: `${SUPABASE_URL}/functions/v1/portal_api`,
```

and change the header comment line "Each run queues the same-day nudges, then drains ..." to "Each run queues the same-day nudges and the weekly partner summaries, then drains ...".

- [ ] **Step 4: Run the tests and the Deno check**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalNotify.test.ts`
Expected: PASS.

Run: `NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_notify/deno.json supabase/functions/portal_notify/index.ts`
Expected: exit 0 (Resend's `emails.send` accepts `headers`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalNotify.ts supabase/functions/_shared/portalNotify.test.ts supabase/functions/portal_notify/index.ts
git commit -m "feat(portal): queue weekly summaries and send one-click unsubscribe headers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: portal_api reads sent referrals, posts notes, audits exports

**Files:**
- Create: `supabase/functions/_shared/portalSentApi.ts`, test `supabase/functions/_shared/portalSentApi.test.ts`
- Modify: `supabase/functions/_shared/portalReferralApi.ts`, test `supabase/functions/_shared/portalReferralApi.test.ts`
- Modify: `supabase/functions/portal_api/index.ts` (route comment only)

**Interfaces:**
- Consumes (SQL, Tasks 2 and 3): `portal_list_sent_referrals`, `portal_get_sent_referral`, `portal_partner_notes`, `portal_post_partner_note`, `portal_record_export`; `portalLabel` from `portalLabels.ts`.
- Produces (TS, imported by the portal client in Task 9):
  - `PORTAL_NOTE_MAX = 1000`; `validateNoteBody(value: unknown): string | null` (trimmed, 1 to 1,000 code points).
  - `interface PortalSentReferralSummary { id: string; ref: string; companyName: string; label: PortalLabel; sentAt: string; lastActivityAt: string }`
  - `interface PortalPartnerNote { id: string; body: string; createdAt: string }`
  - `interface PortalSentReferralDetail { id: string; ref: string; companyName: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; repNote: string | null; label: PortalLabel; sentAt: string; rep: { name: string; email: string | null } | null; detailsRemoved: boolean; canPostNote: boolean; notes: PortalPartnerNote[] }`
  - Actions (session required): `list_sent_referrals {window}` returns `{ referrals: PortalSentReferralSummary[] }`; `get_sent_referral {referralId}` returns `{ referral: PortalSentReferralDetail }` or `404 not_found`; `post_note {referralId, body}` returns `{ note: PortalPartnerNote }`, or `404 not_found`, `400 {error:"invalid_body", field:"body"}`, `429 rate_limited`.
  - `export_referrals` now also calls `portal_record_export {p_org, p_partner, p_portal_user, p_ip}` after the rows are read; on its error answers `500 server_error`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/portalSentApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalEnv, type PortalRpcResult } from "./portalApi";
import { PORTAL_NOTE_MAX, validateNoteBody } from "./portalSentApi";

const ENV: PortalEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-22T15:00:00Z");
const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api";
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const LOOKUP = [
  { portal_user_id: "u-1", org_id: "o-1", partner_id: "p-1", partner_name: "Jane", user_email: "jane@example.com", org_name: "Acme ISO", org_slug: "acme" },
];
const ok = (data: unknown): PortalRpcResult => ({ data, error: null });
const fail = (message: string): PortalRpcResult => ({ data: null, error: { message } });
type Handler = (args: Record<string, unknown>) => PortalRpcResult;

function setup(handlers: Record<string, Handler> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "portal_session_lookup") return (handlers.portal_session_lookup ?? (() => ok(LOOKUP)))(args);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected rpc ${name}`);
    return handler(args);
  });
  const deps: PortalApiDeps = { rpc, sendEmail: vi.fn(async () => {}), env: ENV, now: () => NOW };
  return { deps, rpc };
}

async function call(action: string, body: Record<string, unknown>, deps: PortalApiDeps) {
  const res = await handlePortalRequest(
    new Request(`${URL_BASE}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-portal-session": "tok", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ slug: "acme", ...body }),
    }),
    deps,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const DETAIL_ROW = {
  id: RID,
  ref: "REF-3F9A21C0",
  company_name: "Fresh Bakery",
  contact_name: "Ann",
  contact_email: "ann@fresh.example",
  contact_phone: "5550100100",
  rep_note: "Ask for Ann after 3pm.",
  status: "working",
  sent_at: "2026-10-20T12:00:00Z",
  rep_name: "Rita Rep",
  rep_email: "rita@acme.example",
  details_removed: false,
  can_post_note: true,
  // Hostile extras a row must never pass through.
  stage: "proposal",
  value_cents: 123456,
  notes: "INTERNAL deal note",
  decline_reason: "outside_icp",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateNoteBody", () => {
  it("trims, and accepts 1 to 1,000 characters", () => {
    expect(validateNoteBody("  hello \n")).toBe("hello");
    expect(validateNoteBody("x".repeat(PORTAL_NOTE_MAX))).toBe("x".repeat(1000));
    expect(validateNoteBody("x".repeat(1001))).toBeNull();
    expect(validateNoteBody("   ")).toBeNull();
    expect(validateNoteBody(42)).toBeNull();
  });
});

describe("list_sent_referrals", () => {
  it("lists the session's sent referrals with partner labels for the chosen window", async () => {
    const { deps, rpc } = setup({
      portal_list_sent_referrals: () =>
        ok([
          { id: RID, ref: "REF-3F9A21C0", company_name: "Fresh Bakery", status: "working", sent_at: "2026-10-20T12:00:00Z", last_activity_at: "2026-10-21T12:00:00Z", stage: "proposal" },
          { id: "x", ref: "REF-X", company_name: "Bogus", status: "bogus", sent_at: "2026-10-20T12:00:00Z", last_activity_at: "2026-10-20T12:00:00Z" },
        ]),
    });
    const { status, json } = await call("list_sent_referrals", { window: "30d" }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_list_sent_referrals", { p_org: "o-1", p_partner: "p-1", p_since: "2026-09-22T15:00:00.000Z" });
    expect(status).toBe(200);
    expect(json).toEqual({
      referrals: [
        { id: RID, ref: "REF-3F9A21C0", companyName: "Fresh Bakery", label: "In Progress", sentAt: "2026-10-20T12:00:00Z", lastActivityAt: "2026-10-21T12:00:00Z" },
      ],
    });
  });

  it("rejects an unknown window and answers 500 on a database error", async () => {
    const { deps } = setup({ portal_list_sent_referrals: () => fail("boom") });
    expect((await call("list_sent_referrals", { window: "5y" }, deps)).json).toEqual({ error: "invalid_body", field: "window" });
    expect((await call("list_sent_referrals", {}, deps)).status).toBe(500);
  });

  it("401s without a live session and runs no data query", async () => {
    const { deps, rpc } = setup({ portal_session_lookup: () => ok([]) });
    expect((await call("list_sent_referrals", {}, deps)).status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("get_sent_referral", () => {
  it("returns the allowlisted detail with the partner's notes, never the stage, value or internal notes", async () => {
    const { deps, rpc } = setup({
      portal_get_sent_referral: () => ok([DETAIL_ROW]),
      portal_partner_notes: () =>
        ok([
          { id: "n-2", body: "Demo booked.", created_at: "2026-10-21T12:00:00Z", portal_user_id: "u-1" },
          { id: "n-1", body: "Called Ann.", created_at: "2026-10-20T13:00:00Z" },
        ]),
    });
    const { status, json } = await call("get_sent_referral", { referralId: RID }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_get_sent_referral", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_referral: RID, p_ip: "203.0.113.9" });
    expect(status).toBe(200);
    expect(json).toEqual({
      referral: {
        id: RID,
        ref: "REF-3F9A21C0",
        companyName: "Fresh Bakery",
        contactName: "Ann",
        contactEmail: "ann@fresh.example",
        contactPhone: "5550100100",
        repNote: "Ask for Ann after 3pm.",
        label: "In Progress",
        sentAt: "2026-10-20T12:00:00Z",
        rep: { name: "Rita Rep", email: "rita@acme.example" },
        detailsRemoved: false,
        canPostNote: true,
        notes: [
          { id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00Z" },
          { id: "n-1", body: "Called Ann.", createdAt: "2026-10-20T13:00:00Z" },
        ],
      },
    });
    const text = JSON.stringify(json);
    for (const leak of ["proposal", "123456", "INTERNAL", "outside_icp", '"working"', "portal_user_id"]) expect(text).not.toContain(leak);
  });

  it("blanks personal fields and the note once the details were removed", async () => {
    const { deps } = setup({
      portal_get_sent_referral: () => ok([{ ...DETAIL_ROW, details_removed: true, can_post_note: true }]),
      portal_partner_notes: () => ok([]),
    });
    const { json } = await call("get_sent_referral", { referralId: RID }, deps);
    expect(json.referral).toMatchObject({ contactName: null, contactEmail: null, contactPhone: null, repNote: null, detailsRemoved: true, canPostNote: false });
  });

  it("404s a missing, malformed or unlabelled referral, and keeps the page when notes fail", async () => {
    const missing = setup({ portal_get_sent_referral: () => ok([]) });
    expect((await call("get_sent_referral", { referralId: RID }, missing.deps)).status).toBe(404);
    expect((await call("get_sent_referral", { referralId: "not-a-uuid" }, missing.deps)).status).toBe(404);
    const odd = setup({ portal_get_sent_referral: () => ok([{ ...DETAIL_ROW, status: "bogus" }]) });
    expect((await call("get_sent_referral", { referralId: RID }, odd.deps)).status).toBe(404);
    const notesDown = setup({ portal_get_sent_referral: () => ok([DETAIL_ROW]), portal_partner_notes: () => fail("boom") });
    const res = await call("get_sent_referral", { referralId: RID }, notesDown.deps);
    expect(res.status).toBe(200);
    expect((res.json.referral as { notes: unknown[] }).notes).toEqual([]);
  });
});

describe("post_note", () => {
  it("posts the trimmed note for the session and returns only the note", async () => {
    const { deps, rpc } = setup({
      portal_post_partner_note: () => ok([{ id: "n-3", body: "Signed today.", created_at: "2026-10-22T15:00:00Z", org_id: "o-1" }]),
    });
    const { status, json } = await call("post_note", { referralId: RID, body: "  Signed today.  " }, deps);
    expect(rpc).toHaveBeenCalledWith("portal_post_partner_note", {
      p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_referral: RID, p_body: "Signed today.", p_ip: "203.0.113.9",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ note: { id: "n-3", body: "Signed today.", createdAt: "2026-10-22T15:00:00Z" } });
  });

  it("validates before calling the database", async () => {
    const { deps, rpc } = setup();
    expect((await call("post_note", { referralId: RID, body: " " }, deps)).json).toEqual({ error: "invalid_body", field: "body" });
    expect((await call("post_note", { referralId: RID, body: "x".repeat(1001) }, deps)).json).toEqual({ error: "invalid_body", field: "body" });
    expect((await call("post_note", { referralId: "nope", body: "hi" }, deps)).status).toBe(404);
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("portal_post_partner_note");
  });

  it("maps the database refusals", async () => {
    for (const [message, status, body] of [
      ["referral_not_found", 404, { error: "not_found" }],
      ["rate_limited", 429, { error: "rate_limited" }],
      ["invalid_input:body", 400, { error: "invalid_body", field: "body" }],
      ["boom", 500, { error: "server_error" }],
    ] as const) {
      const { deps } = setup({ portal_post_partner_note: () => fail(message) });
      const res = await call("post_note", { referralId: RID, body: "hi" }, deps);
      expect(res.status).toBe(status);
      expect(res.json).toEqual(body);
    }
  });
});
```

In `supabase/functions/_shared/portalReferralApi.test.ts`, inside `describe("export_referrals", ...)`:
- in every `setup({ portal_export_referrals: ... })` call of that block, add the handler `portal_record_export: () => ok(null)` (four places);
- append:

```ts
  it("audits every export with the session's portal user and IP", async () => {
    const { deps, rpc } = setup({ portal_export_referrals: () => ok(ROWS), portal_record_export: () => ok(null) });
    await call("export_referrals", {}, deps);
    expect(rpc).toHaveBeenCalledWith("portal_record_export", { p_org: "o-1", p_partner: "p-1", p_portal_user: "u-1", p_ip: "203.0.113.9" });
  });

  it("delivers no file when the audit cannot be written", async () => {
    const { deps } = setup({ portal_export_referrals: () => ok(ROWS), portal_record_export: () => fail("boom") });
    const res = await call("export_referrals", {}, deps);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "server_error" });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalSentApi.test.ts ../../supabase/functions/_shared/portalReferralApi.test.ts`
Expected: FAIL (`./portalSentApi` does not exist; `list_sent_referrals` answers 404; the export is not audited).

- [ ] **Step 3: Write `portalSentApi.ts`**

Create `supabase/functions/_shared/portalSentApi.ts`:

```ts
/**
 * "Sent to you" and partner note-back behind portal_api (Partner Portal Phase
 * 2B-3, FR-PORT-76, 77, 78).
 *
 * portalReferralApi.ts routes here after portalApi.ts resolved the session; the
 * scope is the one portal_session_lookup returned, never the request.
 *
 * Every response is built field by field: the partner label (portalLabels.ts),
 * the contact snapshot the rep shared by sending the referral, the rep's note
 * only when SQL returned it (partner_note_visible), the sender's name and
 * business email, and the partner's own notes. A row's other fields (stage,
 * value, internal notes, ids of people) are never copied.
 *
 * Pure TS, no Deno globals, .ts imports: vitest covers it.
 */
import { portalLabel, type PortalLabel } from "./portalLabels.ts";

/** Same limit as referral_partner_notes.body in the database. */
export const PORTAL_NOTE_MAX = 1000;

export interface PortalSentReferralSummary {
  id: string;
  ref: string;
  companyName: string;
  label: PortalLabel;
  sentAt: string;
  lastActivityAt: string;
}

export interface PortalPartnerNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface PortalSentReferralDetail {
  id: string;
  ref: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** The note the rep wrote for the partner, or null. */
  repNote: string | null;
  label: PortalLabel;
  sentAt: string;
  /** Who sent it (name and business email), or null when they left the ISO. */
  rep: { name: string; email: string | null } | null;
  /** The ISO's retention period passed and the contact details were erased. */
  detailsRemoved: boolean;
  canPostNote: boolean;
  /** The partner's own notes, newest first. */
  notes: PortalPartnerNote[];
}

export interface SentScope {
  portalUserId: string;
  orgId: string;
  partnerId: string;
}

export interface SentDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface SentResult {
  status: number;
  body: unknown;
}

type Body = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(body: unknown): SentResult {
  return { status: 200, body };
}

function err(status: number, error: string, extra: Record<string, unknown> = {}): SentResult {
  return { status, body: { error, ...extra } };
}

function serverError(where: string, message: string): SentResult {
  console.error(`[portal_api] ${where} failed:`, message);
  return err(500, "server_error");
}

function rows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return data !== null && typeof data === "object" ? [data as Record<string, unknown>] : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The trimmed note, or null when it is empty or longer than PORTAL_NOTE_MAX characters (code points, like char_length). */
export function validateNoteBody(value: unknown): string | null {
  const body = typeof value === "string" ? value.trim() : "";
  const length = Array.from(body).length;
  return length >= 1 && length <= PORTAL_NOTE_MAX ? body : null;
}

function notesFrom(data: unknown): PortalPartnerNote[] {
  const out: PortalPartnerNote[] = [];
  for (const n of rows(data)) {
    const id = str(n.id);
    const body = str(n.body).trim();
    const createdAt = str(n.created_at);
    if (!id || !body || !createdAt) continue;
    out.push({ id, body, createdAt });
  }
  return out;
}

export async function listSentReferrals(scope: SentScope, since: string | null, deps: SentDeps): Promise<SentResult> {
  const { data, error } = await deps.rpc("portal_list_sent_referrals", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_since: since,
  });
  if (error) return serverError("list_sent_referrals", error.message);
  const referrals: PortalSentReferralSummary[] = [];
  for (const r of rows(data)) {
    const label = portalLabel(r.status);
    if (!label) continue;
    referrals.push({
      id: str(r.id),
      ref: str(r.ref),
      companyName: str(r.company_name),
      label,
      sentAt: str(r.sent_at),
      lastActivityAt: str(r.last_activity_at),
    });
  }
  return ok({ referrals });
}

export async function getSentReferral(scope: SentScope, body: Body, ip: string | null, deps: SentDeps): Promise<SentResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const detail = await deps.rpc("portal_get_sent_referral", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_ip: ip,
  });
  if (detail.error) return serverError("get_sent_referral", detail.error.message);
  const row = rows(detail.data)[0];
  const label = row ? portalLabel(row.status) : null;
  if (!row || !label) return err(404, "not_found");

  // A failed notes lookup degrades to no notes (logged) rather than breaking the page.
  const list = await deps.rpc("portal_partner_notes", { p_org: scope.orgId, p_partner: scope.partnerId, p_referral: id });
  let notes: PortalPartnerNote[] = [];
  if (list.error) console.error("[portal_api] partner_notes failed:", list.error.message);
  else notes = notesFrom(list.data);

  // Defense in depth: SQL already blanks these for a purged row.
  const removed = row.details_removed === true;
  const repName = strOrNull(row.rep_name);
  const repEmail = strOrNull(row.rep_email);
  const out: PortalSentReferralDetail = {
    id: str(row.id),
    ref: str(row.ref),
    companyName: str(row.company_name),
    contactName: removed ? null : strOrNull(row.contact_name),
    contactEmail: removed ? null : strOrNull(row.contact_email),
    contactPhone: removed ? null : strOrNull(row.contact_phone),
    repNote: removed ? null : strOrNull(row.rep_note),
    label,
    sentAt: str(row.sent_at),
    rep: repName || repEmail ? { name: repName ?? "", email: repEmail } : null,
    detailsRemoved: removed,
    canPostNote: !removed && row.can_post_note === true,
    notes,
  };
  return ok({ referral: out });
}

export async function postNote(scope: SentScope, body: Body, ip: string | null, deps: SentDeps): Promise<SentResult> {
  const id = str(body.referralId).trim();
  if (!UUID_RE.test(id)) return err(404, "not_found");
  const text = validateNoteBody(body.body);
  if (text === null) return err(400, "invalid_body", { field: "body" });
  const { data, error } = await deps.rpc("portal_post_partner_note", {
    p_org: scope.orgId,
    p_partner: scope.partnerId,
    p_portal_user: scope.portalUserId,
    p_referral: id,
    p_body: text,
    p_ip: ip,
  });
  if (error) {
    if (error.message.includes("referral_not_found")) return err(404, "not_found");
    if (error.message.includes("rate_limited")) return err(429, "rate_limited");
    if (error.message.includes("invalid_input:body")) return err(400, "invalid_body", { field: "body" });
    return serverError("post_note", error.message);
  }
  const note = notesFrom(data)[0];
  if (!note) return serverError("post_note", "no row returned");
  return ok({ note });
}
```

- [ ] **Step 4: Route the actions and audit the export**

In `supabase/functions/_shared/portalReferralApi.ts`:

Add the import:

```ts
import { getSentReferral, listSentReferrals, postNote } from "./portalSentApi.ts";
```

Append to `REFERRAL_ACTIONS` (after `"update_profile"`):

```ts
  "list_sent_referrals",
  "get_sent_referral",
  "post_note",
```

In `handleReferralAction`, change `case "export_referrals": return exportReferrals(scope, body, deps);` to `return exportReferrals(scope, body, ip, deps);` and add before `default`:

```ts
    case "list_sent_referrals": {
      const period = windowArg(body, deps);
      if (!period.ok) return err(400, "invalid_body", { field: "window" });
      return listSentReferrals(scope, period.since, deps);
    }
    case "get_sent_referral":
      return getSentReferral(scope, body, ip, deps);
    case "post_note":
      return postNote(scope, body, ip, deps);
```

Change `exportReferrals` to take the IP and record the export after the rows are read:

```ts
async function exportReferrals(scope: ReferralScope, body: Body, ip: string | null, deps: ReferralDeps): Promise<ActionResult> {
  const period = windowArg(body, deps);
  if (!period.ok) return err(400, "invalid_body", { field: "window" });
  const { data, error } = await deps.rpc("portal_export_referrals", { ...scopeArgs(scope), p_since: period.since });
  if (error) return serverError("export_referrals", error.message);
  // NFR-PORT-06: no file leaves without its audit row.
  const audit = await deps.rpc("portal_record_export", {
    ...scopeArgs(scope),
    p_portal_user: scope.portalUserId,
    p_ip: ip,
  });
  if (audit.error) return serverError("export audit", audit.error.message);
```

(the rest of the function body is unchanged).

In `supabase/functions/portal_api/index.ts`, extend the routes comment with:

```ts
//   list_sent_referrals | get_sent_referral | post_note   (Phase 2B-3, session required)
//   unsubscribe_digest   (Phase 2B-3, no session: the weekly summary opt-out and its one-click POST)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalSentApi.test.ts ../../supabase/functions/_shared/portalReferralApi.test.ts ../../supabase/functions/_shared/portalApi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/portalSentApi.ts supabase/functions/_shared/portalSentApi.test.ts supabase/functions/_shared/portalReferralApi.ts supabase/functions/_shared/portalReferralApi.test.ts supabase/functions/portal_api/index.ts
git commit -m "feat(portal): sent-to-you and note actions in portal_api, audited exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The public `unsubscribe_digest` action, including the one-click POST

**Files:**
- Modify: `supabase/functions/_shared/portalApi.ts`
- Test: `supabase/functions/_shared/portalUnsubscribe.test.ts`

**Interfaces:**
- Consumes: `portal_unsubscribe_digest(p_slug, p_token, p_ip)` (Task 3); `clientIp`, `PORTAL_LIMITS`, `jsonResponse` in `portalApi.ts`.
- Produces: `POST /functions/v1/portal_api/unsubscribe_digest`, no session. Reads `slug` and `t` from the query string when both are present (the `List-Unsubscribe` one-click target, whatever the body), else `slug` and `token` from a JSON body (the portal page). Always `200 { ok: true }` (blank, too long, unknown or valid token alike); `500 { error: "server_error" }` only when the database call fails. Any other method: `405` and no database call.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/portalUnsubscribe.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePortalRequest, type PortalApiDeps, type PortalRpcResult } from "./portalApi";

const URL_BASE = "https://proj.supabase.co/functions/v1/portal_api/unsubscribe_digest";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function setup(result: PortalRpcResult = { data: null, error: null }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => result);
  const deps: PortalApiDeps = {
    rpc,
    sendEmail: vi.fn(async () => {}),
    env: { appBaseUrl: "https://app.getnavigatr.io", fromAddress: "n <a@b.co>", appEnv: "production", emailAllowlist: "" },
  };
  return { deps, rpc };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsubscribe_digest", () => {
  it("accepts the one-click POST: query string, form body, no session", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(
      new Request(`${URL_BASE}?slug=ACME&t=${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.7" },
        body: "List-Unsubscribe=One-Click",
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("portal_unsubscribe_digest", { p_slug: "acme", p_token: TOKEN, p_ip: "203.0.113.7" });
  });

  it("accepts the portal page's JSON body", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "acme", token: TOKEN }) }),
      deps,
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("portal_unsubscribe_digest", { p_slug: "acme", p_token: TOKEN, p_ip: null });
  });

  it("answers the same for a missing, oversized or malformed request, without a database call", async () => {
    const { deps, rpc } = setup();
    for (const req of [
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
      new Request(`${URL_BASE}?slug=acme&t=${"x".repeat(200)}`, { method: "POST", body: "" }),
      new Request(`${URL_BASE}?slug=acme`, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    ]) {
      const res = await handlePortalRequest(req, deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never changes anything on GET (link scanners)", async () => {
    const { deps, rpc } = setup();
    const res = await handlePortalRequest(new Request(`${URL_BASE}?slug=acme&t=${TOKEN}`, { method: "GET" }), deps);
    expect(res.status).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 500 only when the database fails, and never reads x-portal-session", async () => {
    const { deps } = setup({ data: null, error: { message: "boom" } });
    const res = await handlePortalRequest(
      new Request(`${URL_BASE}?slug=acme&t=${TOKEN}`, { method: "POST", headers: { "x-portal-session": "tok" }, body: "" }),
      deps,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalUnsubscribe.test.ts`
Expected: FAIL (`unsubscribe_digest` answers 404 `not_found`).

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/portalApi.ts`:

Add `| "unsubscribe_digest"` to the `PortalAction` union and `"unsubscribe_digest",` to `ACTIONS` (after `"sign_out"`).

In `handlePortalRequest`, right after the line `if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);` add:

```ts
  // FR-PORT-84: no session, and the one-click POST from a mail provider is
  // form-encoded, so this action reads its own input before the JSON parse.
  if (action === "unsubscribe_digest") {
    try {
      return await unsubscribeDigest(req, deps);
    } catch (e) {
      console.error("[portal_api] unsubscribe_digest threw:", e instanceof Error ? e.message : String(e));
      return jsonResponse({ error: "server_error" }, 500);
    }
  }
```

Add the handler after `signOut`:

```ts
/**
 * Weekly summary opt-out (FR-PORT-84). The List-Unsubscribe one-click target
 * carries slug and t in the query string; the portal page posts JSON
 * { slug, token }. The answer never says whether the token matched anyone.
 */
async function unsubscribeDigest(req: Request, deps: PortalApiDeps): Promise<Response> {
  const done = () => jsonResponse({ ok: true });
  let slug = "";
  let token = "";
  try {
    const url = new URL(req.url);
    slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
    token = (url.searchParams.get("t") ?? "").trim();
  } catch {
    // Fall through to the body.
  }
  if (!slug || !token) {
    slug = "";
    token = "";
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      try {
        const parsed: unknown = await req.json();
        if (parsed !== null && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          slug = str(obj.slug).trim().toLowerCase();
          token = str(obj.token).trim();
        }
      } catch {
        return done();
      }
    }
  }
  if (!slug || !token || tooLong(slug, PORTAL_LIMITS.slug) || tooLong(token, PORTAL_LIMITS.token)) return done();
  const { error } = await deps.rpc("portal_unsubscribe_digest", {
    p_slug: slug,
    p_token: token,
    p_ip: truncate(clientIp(req.headers), PORTAL_LIMITS.ip),
  });
  if (error) {
    console.error("[portal_api] unsubscribe failed:", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return done();
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalUnsubscribe.test.ts ../../supabase/functions/_shared/portalApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalApi.ts supabase/functions/_shared/portalUnsubscribe.test.ts
git commit -m "feat(portal): weekly summary unsubscribe action with one-click POST

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Portal client calls and "Sent to you" on the dashboard

**Files:**
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`, test `apps/app/src/features/portal/lib/portalApi.test.ts`
- Create: `apps/app/src/features/portal/components/PortalSentSection.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`, test `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`

**Interfaces:**
- Consumes: Task 7 types (`PortalSentReferralSummary`, `PortalSentReferralDetail`, `PortalPartnerNote` from `_shared/portalSentApi.ts`) and actions; Task 8 action.
- Produces (client, used by Tasks 10 to 12):
  - `portalApi.listSentReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalSentReferralSummary[]>`
  - `portalApi.getSentReferral(slug: string, sessionToken: string, referralId: string): Promise<PortalSentReferralDetail | null>` (null on 404)
  - `portalApi.postNote(slug: string, sessionToken: string, referralId: string, body: string): Promise<PortalPartnerNote>`
  - `portalApi.unsubscribeDigest(slug: string, token: string): Promise<void>` (no session header)
  - Re-exported types `PortalSentReferralSummary`, `PortalSentReferralDetail`, `PortalPartnerNote`.
  - `PortalSentSection({ period }: { period: PortalWindow })`: renders nothing until there is at least one sent referral; query key `portalDataKey(slug, token, "sent", period)`, polled every `PORTAL_POLL_MS`; rows link to `/p/<slug>/s/<id>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/features/portal/lib/portalApi.test.ts`:

```ts
describe("Phase 2B-3 actions", () => {
  it("lists and reads sent referrals with the session, null for a missing one", async () => {
    const ROW = { id: "s-1", ref: "REF-1", companyName: "Fresh Bakery", label: "Accepted", sentAt: "2026-10-20T12:00:00Z", lastActivityAt: "2026-10-20T12:00:00Z" };
    fetchMock.mockResolvedValueOnce(respond(200, { referrals: [ROW] }));
    await expect(portalApi.listSentReferrals("acme", "tok", "30d")).resolves.toEqual([ROW]);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/list_sent_referrals`);
    expect(lastCall().headers["x-portal-session"]).toBe("tok");
    expect(lastCall().body).toEqual({ slug: "acme", window: "30d" });

    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_found" }));
    await expect(portalApi.getSentReferral("acme", "tok", "s-9")).resolves.toBeNull();
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/get_sent_referral`);
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "s-9" });
  });

  it("posts a note and surfaces the refusal codes", async () => {
    const NOTE = { id: "n-1", body: "Called Ann.", createdAt: "2026-10-22T12:00:00Z" };
    fetchMock.mockResolvedValueOnce(respond(200, { note: NOTE }));
    await expect(portalApi.postNote("acme", "tok", "s-1", "Called Ann.")).resolves.toEqual(NOTE);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/post_note`);
    expect(lastCall().body).toEqual({ slug: "acme", referralId: "s-1", body: "Called Ann." });
    fetchMock.mockResolvedValueOnce(respond(429, { error: "rate_limited" }));
    await expect(portalApi.postNote("acme", "tok", "s-1", "x")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("unsubscribes without a session", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await portalApi.unsubscribeDigest("acme", "AbCdEfGhIjKlMnOpQrStUv");
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/unsubscribe_digest`);
    expect(lastCall().headers["x-portal-session"]).toBeUndefined();
    expect(lastCall().body).toEqual({ slug: "acme", token: "AbCdEfGhIjKlMnOpQrStUv" });
  });
});
```

In `apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx`: add `listSentReferrals: vi.fn(),` to the hoisted `api` object; in the `beforeEach` that resolves `api.dashboard`, add `api.listSentReferrals.mockResolvedValue([]);`; add this constant after `ROWS`:

```ts
const SENT = [
  { id: "s-1", ref: "REF-BBBB0001", companyName: "Gold Gym", label: "Accepted", sentAt: "2026-10-03T12:00:00Z", lastActivityAt: "2026-10-04T12:00:00Z" },
];
```

add `waitFor` to the `@testing-library/react` import, and append inside `describe("PortalDashboardPage", ...)`:

```ts
  it("shows what the ISO sent to the partner, linking to each one", async () => {
    api.listSentReferrals.mockResolvedValue(SENT);
    renderHome();
    const section = await screen.findByRole("region", { name: "Sent to you" });
    expect(within(section).getByText("Businesses Acme ISO referred to you.")).toBeInTheDocument();
    const row = within(section).getByRole("link", { name: /Gold Gym/ });
    expect(row).toHaveAttribute("href", "/p/acme/s/s-1");
    expect(within(row).getByText("Accepted")).toBeInTheDocument();
    expect(within(row).getByText("REF-BBBB0001 · Sent Oct 3, 2026")).toBeInTheDocument();
    expect(api.listSentReferrals).toHaveBeenCalledWith("acme", "live", "all");
  });

  it("hides the section when nothing was sent", async () => {
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    expect(screen.queryByRole("region", { name: "Sent to you" })).toBeNull();
  });

  it("hides the section when it cannot load, and keeps the main list", async () => {
    api.listSentReferrals.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await waitFor(() => expect(api.listSentReferrals).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Sent to you" })).toBeNull();
  });

  it("uses the chosen period and polls every 30 seconds", async () => {
    const user = userEvent.setup();
    api.listSentReferrals.mockResolvedValue(SENT);
    const client = renderHome();
    await screen.findByRole("region", { name: "Sent to you" });
    await user.click(screen.getByRole("button", { name: "30 days" }));
    expect(api.listSentReferrals).toHaveBeenLastCalledWith("acme", "live", "30d");
    const query = client.getQueryCache().find({ queryKey: ["portal", "data", "acme", "live", "sent", "30d"], exact: true });
    expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);
  });

  it("returns to sign-in when the sent list says the session is gone", async () => {
    api.listSentReferrals.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderHome();
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/portalApi.test.ts src/features/portal/pages/PortalDashboardPage.test.tsx`
Expected: FAIL (`portalApi.listSentReferrals is not a function`; no "Sent to you" region).

- [ ] **Step 3: Add the client calls**

In `apps/app/src/features/portal/lib/portalApi.ts`:

Add the import and re-export next to the others:

```ts
import type {
  PortalPartnerNote,
  PortalSentReferralDetail,
  PortalSentReferralSummary,
} from "../../../../../../supabase/functions/_shared/portalSentApi";
```

and add `PortalPartnerNote, PortalSentReferralDetail, PortalSentReferralSummary,` to the `export type { ... }` list.

Extend the `PortalAction` union with `| "list_sent_referrals" | "get_sent_referral" | "post_note" | "unsubscribe_digest"`.

Add to the `portalApi` object, after `publicSubmit`:

```ts
  /** Phase 2B-3: referrals the ISO sent to this partner. */
  listSentReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalSentReferralSummary[]> {
    return portalRequest<{ referrals: PortalSentReferralSummary[] }>(
      "list_sent_referrals",
      { slug, window: period },
      sessionToken,
    ).then((r) => r.referrals);
  },

  getSentReferral(slug: string, sessionToken: string, referralId: string): Promise<PortalSentReferralDetail | null> {
    return portalRequest<{ referral: PortalSentReferralDetail }>("get_sent_referral", { slug, referralId }, sessionToken).then(
      (r) => r.referral,
      nullOn(404),
    );
  },

  /** Throws PortalApiError: 404 not_found, 400 invalid_body (field body), 429 rate_limited. */
  postNote(slug: string, sessionToken: string, referralId: string, body: string): Promise<PortalPartnerNote> {
    return portalRequest<{ note: PortalPartnerNote }>("post_note", { slug, referralId, body }, sessionToken).then(
      (r) => r.note,
    );
  },

  /** The weekly summary opt-out (no session). Resolves the same whatever the token. */
  async unsubscribeDigest(slug: string, token: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("unsubscribe_digest", { slug, token });
  },
```

- [ ] **Step 4: Write `PortalSentSection`**

Create `apps/app/src/features/portal/components/PortalSentSection.tsx`:

```tsx
/**
 * "Sent to you" on the partner dashboard (FR-PORT-76): businesses the ISO
 * referred to this partner, kept apart from the referrals the partner sent.
 * Shares the dashboard's time period, refreshes every 30 seconds, and shows
 * nothing until there is something to show (a failed load hides it too; the
 * main list above has its own retry).
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { PortalLabelChip } from "./PortalLabelChip";
import { PORTAL_POLL_MS, isPortalUnauthorized, portalApi, portalDataKey, type PortalWindow } from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";

export function PortalSentSection({ period }: { period: PortalWindow }) {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const q = useQuery({
    queryKey: portalDataKey(slug, token, "sent", period),
    queryFn: () => portalApi.listSentReferrals(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(q.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  if (!q.data || q.data.length === 0) return null;

  return (
    <section aria-labelledby="portal-sent-heading" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 id="portal-sent-heading" className="text-heading-sm text-text-default">
          Sent to you
        </h2>
        <p className="text-body-sm text-text-muted">Businesses {brand.orgName} referred to you.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-radius-md border border-border-subtle bg-surface-default">
        {q.data.map((r) => (
          <li key={r.id}>
            <Link
              to={`/p/${slug}/s/${r.id}`}
              className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body-strong text-text-default">{r.companyName}</span>
                <span className="text-caption text-text-muted">
                  {r.ref} · Sent {formatPortalDate(r.sentAt)}
                </span>
              </span>
              <PortalLabelChip label={r.label} />
              <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Mount it on the dashboard**

In `apps/app/src/features/portal/pages/PortalDashboardPage.tsx`, add `import { PortalSentSection } from "../components/PortalSentSection";` and render it after `{content}` in the returned JSX:

```tsx
      {content}

      <PortalSentSection period={period} />
```

Update the file's header comment with: "Referrals the ISO sent to the partner are listed separately under Sent to you (Phase 2B-3)."

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter app test -- src/features/portal/lib/portalApi.test.ts src/features/portal/pages/PortalDashboardPage.test.tsx`
Expected: PASS, no `act()` warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/portal/lib/portalApi.ts apps/app/src/features/portal/lib/portalApi.test.ts apps/app/src/features/portal/components/PortalSentSection.tsx apps/app/src/features/portal/pages/PortalDashboardPage.tsx apps/app/src/features/portal/pages/PortalDashboardPage.test.tsx
git commit -m "feat(portal): Sent to you on the partner dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The sent referral page with the note composer

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalSentReferralPage.tsx`, test `apps/app/src/features/portal/pages/PortalSentReferralPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: Task 9 (`portalApi.getSentReferral`, `portalApi.postNote`, `PortalSentReferralDetail`); `PORTAL_NOTE_MAX` from `_shared/portalSentApi.ts`; `usePortalSignedIn`, `PortalRetry`, `portalReachMessage`, `PortalLabelChip`, `formatPortalDate`.
- Produces: route `/p/:slug/s/:referralId` inside the signed-in layout; query key `portalDataKey(slug, token, "sent-referral", referralId)`, polled every `PORTAL_POLL_MS`. Copy: back link `Back to your referrals`; card headings `Sent by <rep name or ISO>`, `Business contact`, `Your notes`; composer label `Add a note for <ISO>`, button `Send note`, helper `<rep name or ISO> gets an email when you add one.`; empty notes `No notes yet. Let <ISO> know how it's going.`; errors: 429 `You've added a lot of notes in the last hour. Try again later.`, 404 `This referral is no longer available.`, transient `portalReachMessage(ISO)`, otherwise `We couldn't add your note. Try again.`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalSentReferralPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  getSentReferral: vi.fn(),
  postNote: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const DETAIL = {
  id: "s-1",
  ref: "REF-BBBB0001",
  companyName: "Gold Gym",
  contactName: "Gil",
  contactEmail: "gil@gold.example",
  contactPhone: "5550100200",
  repNote: "Ask for Gil after 3pm.",
  label: "Accepted",
  sentAt: "2026-10-03T12:00:00Z",
  rep: { name: "Rita Rep", email: "rita@acme.example" },
  detailsRemoved: false,
  canPostNote: true,
  notes: [{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-04T12:00:00Z" }],
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

function renderAt(path = "/p/acme/s/s-1") {
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
  api.getSentReferral.mockResolvedValue(DETAIL);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalSentReferralPage", () => {
  it("shows the business, the label, who sent it with their note, the contact and the partner's notes", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { name: "Gold Gym" })).toBeInTheDocument();
    expect(api.getSentReferral).toHaveBeenCalledWith("acme", "live", "s-1");
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("REF-BBBB0001 · Sent Oct 3, 2026")).toBeInTheDocument();

    const from = screen.getByRole("heading", { name: "Sent by Rita Rep" }).closest("section")!;
    expect(within(from).getByText("Ask for Gil after 3pm.")).toBeInTheDocument();
    expect(within(from).getByRole("link", { name: /rita@acme.example/ })).toHaveAttribute("href", "mailto:rita@acme.example");

    const contact = screen.getByRole("heading", { name: "Business contact" }).closest("section")!;
    expect(within(contact).getByText("Gil")).toBeInTheDocument();
    expect(within(contact).getByRole("link", { name: "gil@gold.example" })).toHaveAttribute("href", "mailto:gil@gold.example");
    expect(within(contact).getByRole("link", { name: "5550100200" })).toHaveAttribute("href", "tel:5550100200");

    const notes = screen.getByRole("heading", { name: "Your notes" }).closest("section")!;
    expect(within(notes).getByText("Called Gil.")).toBeInTheDocument();
    expect(within(notes).getByText("Rita Rep gets an email when you add one.")).toBeInTheDocument();
  });

  it("adds a note, clears the box and reloads the referral", async () => {
    const user = userEvent.setup();
    api.postNote.mockResolvedValue({ id: "n-2", body: "Signed today.", createdAt: "2026-10-22T12:00:00Z" });
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    expect(screen.getByRole("button", { name: "Send note" })).toBeDisabled();
    await user.type(box, "  Signed today.  ");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    expect(api.postNote).toHaveBeenCalledWith("acme", "live", "s-1", "Signed today.");
    expect(await screen.findByLabelText("Add a note for Acme ISO")).toHaveValue("");
    expect(api.getSentReferral.mock.calls.length).toBeGreaterThan(1);
  });

  it("explains a refused note", async () => {
    const user = userEvent.setup();
    renderAt();
    const box = await screen.findByLabelText("Add a note for Acme ISO");
    for (const [error, message] of [
      [new PortalApiError(429, "rate_limited"), "You've added a lot of notes in the last hour. Try again later."],
      [new PortalApiError(404, "not_found"), "This referral is no longer available."],
      [new PortalApiError(0, "network_error"), "We couldn't reach Acme ISO. Check your connection and try again."],
      [new PortalApiError(400, "invalid_body", "body"), "We couldn't add your note. Try again."],
    ] as const) {
      api.postNote.mockRejectedValueOnce(error);
      await user.clear(box);
      await user.type(box, "Hello");
      await user.click(screen.getByRole("button", { name: "Send note" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(box).toHaveValue("Hello");
    }
  });

  it("says when the rep wrote no note, when nothing was noted yet, and hides the composer when it cannot be used", async () => {
    api.getSentReferral.mockResolvedValue({ ...DETAIL, repNote: null, rep: null, notes: [], canPostNote: false });
    renderAt();
    expect(await screen.findByRole("heading", { name: "Sent by Acme ISO" })).toBeInTheDocument();
    expect(screen.queryByText("Ask for Gil after 3pm.")).toBeNull();
    expect(screen.getByText("No notes yet. Let Acme ISO know how it's going.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note for Acme ISO")).toBeNull();
  });

  it("says the contact details were removed", async () => {
    api.getSentReferral.mockResolvedValue({
      ...DETAIL, contactName: null, contactEmail: null, contactPhone: null, repNote: null, detailsRemoved: true, canPostNote: false, label: "Withdrawn",
    });
    renderAt();
    expect(await screen.findByText("Contact details for this referral were removed for privacy.")).toBeInTheDocument();
  });

  it("says when the referral cannot be found, and offers a retry when it cannot load", async () => {
    api.getSentReferral.mockResolvedValue(null);
    renderAt();
    expect(await screen.findByRole("heading", { name: "We couldn't find that referral" })).toBeInTheDocument();
  });

  it("offers a retry when the referral cannot be loaded", async () => {
    api.getSentReferral.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderAt();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getSentReferral.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt();
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalSentReferralPage.test.tsx`
Expected: FAIL (the route redirects to sign-in; no "Gold Gym" heading).

- [ ] **Step 3: Write the page**

Create `apps/app/src/features/portal/pages/PortalSentReferralPage.tsx`:

```tsx
/**
 * One referral the ISO sent to the partner (FR-PORT-76, 77, 78): the business,
 * its partner label, who sent it and the note they wrote for the partner (only
 * when they wrote one for the partner), the contact details, and the partner's
 * own notes back with a composer. The sender is emailed for each note.
 * Refreshes every 30 seconds.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Mail, Phone } from "lucide-react";
import { Button, Card, FormField, Textarea } from "@/components/navigatr";
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
import { PORTAL_NOTE_MAX } from "../../../../../../supabase/functions/_shared/portalSentApi";

const RATE_LIMITED = "You've added a lot of notes in the last hour. Try again later.";
const GONE = "This referral is no longer available.";
const FAILED = "We couldn't add your note. Try again.";

export function PortalSentReferralPage() {
  const { referralId = "" } = useParams<{ referralId: string }>();
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const key = portalDataKey(slug, token, "sent-referral", referralId);
  const q = useQuery({
    queryKey: key,
    queryFn: () => portalApi.getSentReferral(slug, token, referralId),
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

  if (unauthorized || q.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  // Retry only when nothing has loaded: a failed background poll keeps the last data.
  if (q.data === undefined) {
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
  const sender = r.rep?.name || brand.orgName;
  const body = draft.trim();

  const send = async () => {
    if (!body) return;
    setBusy(true);
    setNotice(null);
    try {
      await portalApi.postNote(slug, token, r.id, body);
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "rate_limited") setNotice(RATE_LIMITED);
      else if (err instanceof PortalApiError && err.status === 404) setNotice(GONE);
      else if (isPortalTransientError(err)) setNotice(portalReachMessage(brand.orgName));
      else setNotice(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const contact: Array<[string, string | null, string | null]> = [
    ["Contact", r.contactName, null],
    ["Email", r.contactEmail, r.contactEmail ? `mailto:${r.contactEmail}` : null],
    ["Phone", r.contactPhone, r.contactPhone ? `tel:${r.contactPhone.replace(/[^\d+]/g, "")}` : null],
  ];
  const shown = contact.filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-4">
      {back}

      <Card padding="lg" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-heading-lg text-text-default">{r.companyName}</h1>
          <PortalLabelChip label={r.label} />
        </div>
        <p className="text-caption text-text-muted">
          {r.ref} · Sent {formatPortalDate(r.sentAt)}
        </p>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Sent by {sender}</h2>
          {r.repNote && <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{r.repNote}</p>}
          {r.rep?.email && (
            <a
              href={`mailto:${r.rep.email}`}
              className="inline-flex min-h-11 items-center gap-2 break-all text-body-md text-brand-primary"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              {r.rep.email}
            </a>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Business contact</h2>
          {r.detailsRemoved && (
            <p className="text-body-md text-text-muted">Contact details for this referral were removed for privacy.</p>
          )}
          {shown.length > 0 && (
            <dl className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1">
              {shown.map(([k, v, href]) => (
                <React.Fragment key={k}>
                  <dt className="text-caption text-text-subtle">{k}</dt>
                  <dd className="break-words text-body-md text-text-default">
                    {href ? (
                      <a href={href} className="inline-flex min-h-11 items-center gap-2 break-all text-brand-primary">
                        {k === "Phone" && <Phone className="h-4 w-4 shrink-0" aria-hidden />}
                        {v}
                      </a>
                    ) : (
                      v
                    )}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-3">
          <h2 className="text-body-strong text-text-default">Your notes</h2>
          {r.canPostNote && (
            <div className="flex flex-col gap-2">
              <FormField label={`Add a note for ${brand.orgName}`} htmlFor="portal-sent-note">
                <Textarea
                  id="portal-sent-note"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={PORTAL_NOTE_MAX}
                  rows={3}
                  disabled={busy}
                />
              </FormField>
              <p className="text-caption text-text-muted">{sender} gets an email when you add one.</p>
              {notice && (
                <p role="alert" className="text-body-sm text-status-danger">
                  {notice}
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                disabled={busy || !body}
                onClick={() => void send()}
              >
                Send note
              </Button>
            </div>
          )}
          {r.notes.length === 0 ? (
            <p className="text-body-md text-text-muted">No notes yet. Let {brand.orgName} know how it&apos;s going.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {r.notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-1">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{n.body}</p>
                  <time dateTime={n.createdAt} className="text-caption text-text-muted">
                    {formatPortalDate(n.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`, import `PortalSentReferralPage` and add inside the signed-in layout route, after `r/:referralId`:

```tsx
            <Route path="s/:referralId" element={<PortalSentReferralPage />} />
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalSentReferralPage.test.tsx src/features/portal/pages/PortalRoot.test.tsx`
Expected: PASS, no `act()` warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalSentReferralPage.tsx apps/app/src/features/portal/pages/PortalSentReferralPage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx
git commit -m "feat(portal): sent referral page with partner note-back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The unsubscribe page

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalUnsubscribePage.tsx`, test `apps/app/src/features/portal/pages/PortalUnsubscribePage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: `portalApi.unsubscribeDigest(slug, token)` (Task 9), `portalReachMessage`, `PortalBrand`.
- Produces: route `/p/:slug/unsubscribe?t=<token>` OUTSIDE the signed-in layout (no session). Nothing is sent until the button is pressed (mail scanners open links). Copy: heading `Stop the weekly summary?`, body `You'll stop getting the weekly summary email from <ISO>. Emails about your referrals still arrive.`, button `Unsubscribe`; done heading `You're unsubscribed`, body `You won't get the weekly summary. You can turn it back on in your profile.`; without a token heading `This link isn't complete`, body `Open the link from your weekly summary email again, or turn the summary off in your profile.`; failure alert `portalReachMessage(ISO)`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/portal/pages/PortalUnsubscribePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ brand: vi.fn(), unsubscribeDigest: vi.fn() }));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

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
}

beforeEach(() => {
  api.brand.mockReset();
  api.unsubscribeDigest.mockReset();
  api.brand.mockResolvedValue({ orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null });
});

describe("PortalUnsubscribePage", () => {
  it("asks first and changes nothing until the button is pressed", async () => {
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Stop the weekly summary?" })).toBeInTheDocument();
    expect(screen.getByText("You'll stop getting the weekly summary email from Acme ISO. Emails about your referrals still arrive.")).toBeInTheDocument();
    expect(api.unsubscribeDigest).not.toHaveBeenCalled();
  });

  it("unsubscribes with the slug and token, then confirms", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockResolvedValue(undefined);
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(api.unsubscribeDigest).toHaveBeenCalledWith("acme", TOKEN);
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeInTheDocument();
    expect(screen.getByText("You won't get the weekly summary. You can turn it back on in your profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });

  it("says so when it could not reach the ISO, and lets the partner try again", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockRejectedValueOnce(new PortalApiError(500, "server_error")).mockResolvedValueOnce(undefined);
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach Acme ISO. Check your connection and try again.");
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeInTheDocument();
  });

  it("explains a link without a token and offers no button", async () => {
    renderAt("/p/acme/unsubscribe");
    expect(await screen.findByRole("heading", { name: "This link isn't complete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalUnsubscribePage.test.tsx`
Expected: FAIL (the unknown path redirects to sign-in).

- [ ] **Step 3: Write the page**

Create `apps/app/src/features/portal/pages/PortalUnsubscribePage.tsx`:

```tsx
/**
 * Weekly summary opt-out (FR-PORT-84), reached from the link in the summary's
 * footer. No session. Nothing changes until the partner presses the button,
 * because mail scanners and link previews open links on their own. The server
 * answers the same for any token, so this page never says whether it matched.
 * Mail providers use the one-click header instead and never load this page.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@/components/navigatr";
import { portalReachMessage } from "../components/PortalRetry";
import { portalApi, type PortalBrand } from "../lib/portalApi";

type State = "idle" | "busy" | "done" | "error";

export function PortalUnsubscribePage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const [params] = useSearchParams();
  const token = (params.get("t") ?? "").trim();
  const [state, setState] = React.useState<State>("idle");

  const confirm = async () => {
    setState("busy");
    try {
      await portalApi.unsubscribeDigest(slug, token);
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (!token) {
    return (
      <Card padding="lg" className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">This link isn&apos;t complete</h1>
        <p className="text-body-md text-text-muted">
          Open the link from your weekly summary email again, or turn the summary off in your profile.
        </p>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card padding="lg" className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">You&apos;re unsubscribed</h1>
        <p className="text-body-md text-text-muted">
          You won&apos;t get the weekly summary. You can turn it back on in your profile.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h1 className="text-heading-lg text-text-default">Stop the weekly summary?</h1>
      <p className="text-body-md text-text-muted">
        You&apos;ll stop getting the weekly summary email from {brand.orgName}. Emails about your referrals still arrive.
      </p>
      {state === "error" && (
        <p role="alert" className="text-body-sm text-status-danger">
          {portalReachMessage(brand.orgName)}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={state === "busy"}
        disabled={state === "busy"}
        onClick={() => void confirm()}
      >
        Unsubscribe
      </Button>
    </Card>
  );
}
```

- [ ] **Step 4: Add the route**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`, import `PortalUnsubscribePage` and add next to the `refer/:token` route (outside the signed-in layout):

```tsx
          <Route path="unsubscribe" element={<PortalUnsubscribePage slug={slug} brand={data} />} />
```

Add to the header comment: "The weekly summary opt-out lives at unsubscribe and needs no session (Phase 2B-3)."

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalUnsubscribePage.test.tsx src/features/portal/pages/PortalRoot.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalUnsubscribePage.tsx apps/app/src/features/portal/pages/PortalUnsubscribePage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx
git commit -m "feat(portal): weekly summary unsubscribe page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Extend the partner string audit to everything new

**Files:**
- Modify: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: Tasks 5 to 11 (actions, client calls, pages, email kinds).
- Produces: audit coverage for `list_sent_referrals`, `get_sent_referral`, `post_note`, `unsubscribe_digest`, the export audit call, the dashboard "Sent to you" section, the sent referral page, the unsubscribe page, and the `partner_referral_sent` and `partner_digest` emails; plus the FR-PORT-84 check that no other partner email or sign-in email carries an unsubscribe.

- [ ] **Step 1: Add the new API functions and rpc rows**

In the hoisted `api` object add:

```ts
  listSentReferrals: vi.fn(),
  getSentReferral: vi.fn(),
  postNote: vi.fn(),
  unsubscribeDigest: vi.fn(),
```

Extend the imports: from `"../../../../../supabase/functions/_shared/portalNotifyEmail"` also import `PARTNER_DIGEST_KIND, PARTNER_SENT_KIND`; add `import { portalCodeEmail, portalInviteEmail } from "../../../../../supabase/functions/_shared/portalEmail";`.

In `describe("portal_api responses", ...)`, inside the `rpc` switch of `deps(...)`, add before `default`:

```ts
        case "portal_list_sent_referrals":
          return {
            data: INTERNAL_STATUSES.map((s, i) => ({
              id: `s-${i}`,
              ref: `REF-1000000${i}`,
              company_name: "Gold Gym",
              status: s,
              sent_at: "2026-10-01T12:00:00Z",
              last_activity_at: "2026-10-02T12:00:00Z",
              value_cents: 123456,
              notes: `${SECRET} internal note`,
              ...hostile,
            })),
            error: null,
          };
        case "portal_get_sent_referral":
          return {
            data: [{
              id: "3f9a21c0-1111-4222-8333-444455556666",
              ref: "REF-3F9A21C0",
              company_name: "Gold Gym",
              contact_name: "Gil",
              contact_email: "gil@gold.example",
              contact_phone: "5550100200",
              rep_note: "Ask for Gil after 3pm.",
              status,
              sent_at: "2026-10-01T12:00:00Z",
              rep_name: "Rita Rep",
              rep_email: "rita@acme.example",
              details_removed: false,
              can_post_note: true,
              value_cents: 123456,
              notes: `${SECRET} internal note`,
              submitted_by_user_id: SECRET,
              ...hostile,
            }],
            error: null,
          };
        case "portal_partner_notes":
          return {
            data: [{ id: "n-1", body: "Called Gil.", created_at: "2026-10-02T12:00:00Z", portal_user_id: SECRET, org_id: SECRET }],
            error: null,
          };
        case "portal_post_partner_note":
          return {
            data: [{ id: "n-2", body: "Demo booked.", created_at: "2026-10-03T12:00:00Z", portal_user_id: SECRET, status }],
            error: null,
          };
        case "portal_record_export":
          return { data: null, error: null };
        case "portal_unsubscribe_digest":
          return { data: null, error: null };
```

- [ ] **Step 2: Add the API audits**

Append inside `describe("portal_api responses", ...)`:

```ts
  it.each(INTERNAL_STATUSES)("sent-to-you detail leaks nothing internal for a referral that is %s", async (status) => {
    const body = await call("get_sent_referral", { referralId: "3f9a21c0-1111-4222-8333-444455556666" }, status);
    auditJson(body);
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(body.referral.repNote).toBe("Ask for Gil after 3pm.");
    expect(body.referral.notes).toEqual([{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-02T12:00:00Z" }]);
  });

  it("the sent-to-you list and a posted note leak nothing internal", async () => {
    const list = await call("list_sent_referrals", {}, "accepted");
    auditJson(list);
    expect(list.referrals).toHaveLength(INTERNAL_STATUSES.length);
    for (const r of list.referrals as { label: string }[]) expect(PORTAL_LABELS as readonly string[]).toContain(r.label);
    expect(JSON.stringify(list)).not.toContain("123456");
    const note = await call("post_note", { referralId: "3f9a21c0-1111-4222-8333-444455556666", body: "Demo booked." }, "accepted");
    auditJson(note);
    expect(Object.keys(note.note).sort()).toEqual(["body", "createdAt", "id"]);
  });

  it("unsubscribe answers exactly the same for any token", async () => {
    const a = await call("unsubscribe_digest", { token: "AbCdEfGhIjKlMnOpQrStUv" }, "accepted");
    const b = await call("unsubscribe_digest", { token: "no-such-token-at-all-xx" }, "accepted");
    expect(a).toEqual({ ok: true });
    expect(b).toEqual(a);
  });
```

- [ ] **Step 3: Add the rendered-page audits**

In `describe("rendered portal pages: UI copy audit", ...)`'s `beforeEach`, add `api.listSentReferrals.mockResolvedValue([]);`. Append inside that describe:

```ts
  it("dashboard with Sent to you in every label", async () => {
    api.listReferrals.mockResolvedValue([]);
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listSentReferrals.mockResolvedValue(
      PORTAL_LABELS.map((label, i) => ({
        id: `s-${i}`,
        ref: `REF-1000000${i}`,
        companyName: `Sent ${i}`,
        label,
        sentAt: "2026-10-01T12:00:00Z",
        lastActivityAt: "2026-10-02T12:00:00Z",
      })),
    );
    renderAt("/p/acme/home");
    await screen.findByRole("link", { name: /Sent 5/ });
    expectCleanScreen();
  });

  it.each(PORTAL_LABELS)("sent referral page labelled %s, with notes and the composer", async (label) => {
    api.getSentReferral.mockResolvedValue({
      id: "s-1",
      ref: "REF-BBBB0001",
      companyName: "Gold Gym",
      contactName: "Gil",
      contactEmail: "gil@gold.example",
      contactPhone: "5550100200",
      repNote: "Ask for Gil after 3pm.",
      label,
      sentAt: "2026-10-01T12:00:00Z",
      rep: label === "Withdrawn" ? null : { name: "Rita Rep", email: "rita@acme.example" },
      detailsRemoved: false,
      canPostNote: true,
      notes: [{ id: "n-1", body: "Called Gil.", createdAt: "2026-10-02T12:00:00Z" }],
    });
    renderAt("/p/acme/s/s-1");
    await screen.findByRole("heading", { name: "Gold Gym" });
    expectCleanScreen();
  });

  it("sent referral page after a refused note, and with the details removed", async () => {
    const user = userEvent.setup();
    api.getSentReferral.mockResolvedValue({
      id: "s-1",
      ref: "REF-BBBB0001",
      companyName: "Gold Gym",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      repNote: null,
      label: "Accepted",
      sentAt: "2026-10-01T12:00:00Z",
      rep: null,
      detailsRemoved: true,
      canPostNote: true,
      notes: [],
    });
    api.postNote.mockRejectedValue(new PortalApiError(429, "rate_limited"));
    renderAt("/p/acme/s/s-1");
    await user.type(await screen.findByLabelText("Add a note for Acme ISO"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send note" }));
    await screen.findByRole("alert");
    expectCleanScreen();
  });

  it("unsubscribe page, before and after", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockResolvedValue(undefined);
    renderAt("/p/acme/unsubscribe?t=AbCdEfGhIjKlMnOpQrStUv");
    await screen.findByRole("heading", { name: "Stop the weekly summary?" });
    expectCleanScreen();
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByRole("heading", { name: "You're unsubscribed" });
    expectCleanScreen();
  });
```

- [ ] **Step 4: Add the email audits**

Append at the end of the file:

```ts
describe("Phase 2B-3 partner emails: copy audit", () => {
  const XSS = "<script>alert(1)</script>";
  const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation"];
  const TOKEN_RE = new RegExp(`\\b(${[...INTERNAL_STATUSES, ...STAGES].join("|")})\\b`);
  const TEMPLATE_FALLBACK = /Button not working\?/g;
  const REASON_RE = /\b[a-z]+(?:_[a-z]+)+\b/;
  const CTX = {
    appBaseUrl: "https://app.getnavigatr.io",
    referralId: "3f9a21c0-1111-4222-8333-444455556666",
    portalApiUrl: "https://proj.supabase.co/functions/v1/portal_api",
  };
  const SENT = {
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: `Jane ${XSS}`,
    companyName: `Gold Gym ${XSS}`,
    ref: "REF-3F9A21C0",
    repName: "Rita Rep",
    repEmail: "rita@acme.example",
    note: `Ask for Gil after 3pm.\n${XSS}`,
  };
  const DIGEST = {
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: `Jane ${XSS}`,
    weekLabel: "Dec 31",
    counts: { submitted: 2, accepted: 1, inProgress: 1, closedWon: 1, notMovingForward: 1, sentToYou: 1 },
    valueCents: 500000,
    items: [
      ...PORTAL_LABELS.slice(0, 5).map((label): { companyName: string; label: string } => ({ companyName: `Co ${XSS}`, label })),
      { companyName: "Gold Gym", label: "Sent to you" },
    ],
    unsubscribeToken: "AbCdEfGhIjKlMnOpQrStUv",
  };

  it.each([
    [PARTNER_SENT_KIND, SENT],
    [PARTNER_DIGEST_KIND, DIGEST],
  ] as const)("%s: partner words only, the ISO's name, the locked credit, escaped markup", (kind, payload) => {
    const built = buildPortalNotifyEmail(kind, payload, CTX);
    expect(built).not.toBeNull();
    const e = built!;
    const copy = [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
    expect(copy).toContain("Acme ISO");
    expect(copy).not.toMatch(/navigatr/i);

    const { html, text } = renderEmail({ ...e, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    const visibleHtml = html.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, "").replace(TEMPLATE_FALLBACK, "");
    const visibleText = text.replace(/https?:\/\/\S+/g, "").replace(TEMPLATE_FALLBACK, "");
    for (const s of [e.subject, visibleText, visibleHtml]) {
      expect(s.match(TOKEN_RE)).toBeNull();
      expect(s.match(FORBIDDEN_WORDS)).toBeNull();
      expect(s.match(REASON_RE)).toBeNull();
    }
    expect(visibleText.split(POWERED_BY).length - 1).toBe(1);
    expect(visibleText.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops either payload when it carries anything beyond the allowlist", () => {
    for (const extra of [{ status: "lost" }, { stage: "proposal" }, { notes: `${SECRET} deal note` }, { other_partner: OTHER_PARTNER }]) {
      expect(buildPortalNotifyEmail(PARTNER_SENT_KIND, { ...SENT, ...extra }, CTX)).toBeNull();
      expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, ...extra }, CTX)).toBeNull();
    }
  });

  it("only the weekly summary can be unsubscribed from; sign-in and invite emails never (FR-PORT-84)", () => {
    const digest = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, CTX)!;
    expect(renderEmail(digest).text).toMatch(/Unsubscribe from the weekly summary/);
    expect(digest.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const sent = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, CTX)!;
    const code = portalCodeEmail({ orgName: "Acme ISO", code: "123456", signInUrl: "https://app.getnavigatr.io/p/acme" });
    const invite = portalInviteEmail({ orgName: "Acme ISO", partnerName: "Jane", inviteUrl: "https://app.getnavigatr.io/p/acme/invite#t" });
    for (const e of [sent, code, invite]) {
      const { html, text } = renderEmail(e);
      expect(text).not.toMatch(/unsubscribe/i);
      expect(html).not.toMatch(/unsubscribe/i);
      expect("headers" in e && (e as { headers?: unknown }).headers).toBeFalsy();
    }
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, {
        slug: "acme", orgName: "Acme ISO", partnerName: "Jane", companyName: "Fresh Bakery", ref: "REF-3F9A21C0",
        label, valueCents: null, repName: "Rita Rep", repEmail: "rita@acme.example", updateBody: "Hi",
      }, CTX)!;
      expect(renderEmail(e).text).not.toMatch(/unsubscribe/i);
      expect(e.headers).toBeUndefined();
    }
  });
});
```

- [ ] **Step 5: Run the audit**

Run: `pnpm --filter app test -- src/features/portal/portalStringAudit.test.tsx`
Expected: PASS, every existing case still green.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "test(portal): string audit covers sent-to-you, notes, digest and unsubscribe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Rep app: a note the partner will read

**Files:**
- Modify: `apps/app/src/features/partners/hooks/useReferDeal.ts`, test `useReferDeal.test.tsx`
- Modify: `apps/app/src/features/partners/lib/referrals.ts`, test `referrals.test.ts`
- Modify: `apps/app/src/features/pipeline/components/SendReferralSheet.tsx`, test `SendReferralSheet.test.tsx`

**Interfaces:**
- Consumes: `send_referral_to_partner(p_partner_id, p_deal_id, p_partner_note)` (Task 1).
- Produces: `useReferDeal().mutateAsync({ partnerId, dealId, notes? })` unchanged in shape; it now calls `send_referral_to_partner` with `p_partner_note: notes ?? ""` (Partner Detail "Refer a deal" passes no note, so nothing becomes visible). `referralErrorMessage` maps `note_too_long` to `Keep the note under 1,000 characters.`. SendReferralSheet labels the note `Note for <partner name> (they will see this)`.

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/features/partners/hooks/useReferDeal.test.tsx`, change the first two tests:

```ts
  it("calls send_referral_to_partner with partner, deal and the partner-facing note", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "Q3 referral" });
    expect(rpcMock).toHaveBeenCalledWith("send_referral_to_partner", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_partner_note: "Q3 referral",
    });
  });

  it("sends an empty note when none is given (nothing is shown to the partner)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_partner_note: "" });
  });
```

and append:

```ts
  it("says how long a note may be", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "note_too_long" } });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "x" })).rejects.toThrow(
      "Keep the note under 1,000 characters.",
    );
  });
```

In `apps/app/src/features/partners/lib/referrals.test.ts`, next to the `already_linked` assertion add:

```ts
    expect(referralErrorMessage({ message: "note_too_long" }, "x")).toBe("Keep the note under 1,000 characters.");
```

In `apps/app/src/features/pipeline/components/SendReferralSheet.test.tsx`, append inside `describe("SendReferralSheet", ...)`:

```ts
  it("tells the rep the partner will read the note, by name, and sends it", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getByLabelText("Note for the partner (they will see this)")).toHaveAttribute("maxlength", "1000");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Sarah · CPA Co/i }));
    const note = screen.getByLabelText("Note for Sarah (they will see this)");
    expect(note).toHaveAttribute("placeholder", "Optional. Only write what the partner should read.");
    await user.type(note, "  Ask for Ann  ");
    await user.click(screen.getByRole("button", { name: /Send referral/i }));

    await waitFor(() =>
      expect(mutateAsyncSpy).toHaveBeenCalledWith({ dealId: deal.id, partnerId: "p1", notes: "Ask for Ann" }),
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferDeal.test.tsx src/features/partners/lib/referrals.test.ts src/features/pipeline/components/SendReferralSheet.test.tsx`
Expected: FAIL (old RPC name, no `note_too_long` copy, no such label).

- [ ] **Step 3: Implement**

`apps/app/src/features/partners/hooks/useReferDeal.ts`: replace the header comment with

```ts
/**
 * useReferDeal: record that we referred a deal TO a partner (outbound).
 * Calls send_referral_to_partner (migration 20261022000002). A non-blank note
 * is written FOR the partner: they read it in their portal and in the
 * "sent you a referral" email. Without a note nothing is shown to them.
 */
```

and the RPC call with

```ts
      const { error } = await supabase.rpc("send_referral_to_partner", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_partner_note: input.notes ?? "",
      });
```

`apps/app/src/features/partners/lib/referrals.ts`: add to `ERROR_COPY` after `["update_too_long", ...]`:

```ts
  ["note_too_long", "Keep the note under 1,000 characters."],
```

`apps/app/src/features/pipeline/components/SendReferralSheet.tsx`:
- Update the header comment: "Pick a partner and an optional note FOR the partner (they read it in their portal and in the email), then record an outbound referral via useReferDeal (send_referral_to_partner RPC)."
- After `const hasPartners = partners.length > 0;` add:

```tsx
  const partnerName = partners.find((p) => p.id === partnerId)?.name ?? "the partner";
```

- Replace the `<NotesFieldWithMic ... />` element with:

```tsx
              <label htmlFor="send-referral-note" className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">
                  Note for {partnerName} (they will see this)
                </span>
              </label>
              <NotesFieldWithMic
                id="send-referral-note"
                value={notes}
                onChange={setNotes}
                maxLength={1000}
                placeholder="Optional. Only write what the partner should read."
              />
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferDeal.test.tsx src/features/partners/lib/referrals.test.ts src/features/pipeline/components/SendReferralSheet.test.tsx src/features/partners/pages/PartnerDetailPage.test.tsx`
Expected: PASS (Partner Detail still calls `useReferDeal` with `{ partnerId, dealId }` only).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReferDeal.ts apps/app/src/features/partners/hooks/useReferDeal.test.tsx apps/app/src/features/partners/lib/referrals.ts apps/app/src/features/partners/lib/referrals.test.ts apps/app/src/features/pipeline/components/SendReferralSheet.tsx apps/app/src/features/pipeline/components/SendReferralSheet.test.tsx
git commit -m "feat(partners): the referral note is written for the partner to read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Rep app: partner notes on Deal Detail and a count on Partner Detail

**Files:**
- Create: `apps/app/src/features/partners/hooks/useReferralPartnerNotes.ts`, test `useReferralPartnerNotes.test.tsx`
- Create: `apps/app/src/features/partners/components/PartnerNoteBacksPanel.tsx`, test `PartnerNoteBacksPanel.test.tsx`
- Modify: `apps/app/src/features/partners/components/ReferralSection.tsx`, test `ReferralSection.test.tsx`
- Modify: `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`, test `PartnerDetailPage.test.tsx`
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`, test `DealDetailPage.referral.test.tsx`

**Interfaces:**
- Consumes: `referral_partner_notes` under RLS (Task 2), embedded from `referrals` through its `referral_id` foreign key.
- Produces:
  - `useDealPartnerNotes(dealId: string | undefined)`: `useQuery<DealPartnerNotes[]>`, key `["referrals", "partner-notes", "deal", dealId]`; one entry per OUTBOUND referral of the deal that has notes, `{ referralId: string; partnerId: string; partnerName: string | null; notes: { id: string; body: string; createdAt: string }[] }`, notes newest first.
  - `usePartnerNoteCounts(partnerId: string | undefined)`: `useQuery<Record<string, number>>` (deal id to note count over the partner's outbound referrals), key `["referrals", "partner-notes", "partner", partnerId]`.
  - `partnerNoteCountLabel(n: number): string | null`: `null` for 0, `1 note from partner`, `<n> notes from partner`.
  - `PartnerNoteBacksPanel({ dealId }: { dealId: string })`: renders nothing without notes; otherwise one group per partner headed `Notes from <partner name>` (`Notes from the partner` when the name is hidden).
  - `ReferralSection` optional prop `rowNote?: (deal: Deal) => string | null`, shown under the contact name.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/hooks/useReferralPartnerNotes.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { partnerNoteCountLabel, useDealPartnerNotes, usePartnerNoteCounts } from "./useReferralPartnerNotes";

const endMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return endMock(); },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return endMock(); },
      };
      return chain;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  endMock.mockReset();
  calls.length = 0;
});

describe("useDealPartnerNotes", () => {
  it("groups the notes of the deal's outbound referrals by partner, newest first, skipping referrals without notes", async () => {
    endMock.mockResolvedValueOnce({
      data: [
        {
          id: "r-1",
          partner_id: "p-1",
          partner: { name: "Jane CPA" },
          notes: [
            { id: "n-1", body: "Called Ann.", created_at: "2026-10-20T12:00:00+00:00" },
            { id: "n-2", body: "Demo booked.", created_at: "2026-10-21T12:00:00+00:00" },
          ],
        },
        { id: "r-2", partner_id: "p-2", partner: null, notes: [] },
      ],
      error: null,
    });
    const { result } = renderHook(() => useDealPartnerNotes("d-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        referralId: "r-1",
        partnerId: "p-1",
        partnerName: "Jane CPA",
        notes: [
          { id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00+00:00" },
          { id: "n-1", body: "Called Ann.", createdAt: "2026-10-20T12:00:00+00:00" },
        ],
      },
    ]);
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "id, partner_id, partner:partners(name), notes:referral_partner_notes(id, body, created_at)"],
      ["eq", "deal_id", "d-1"],
      ["eq", "direction", "outbound"],
      ["order", "submitted_at", { ascending: true }],
    ]);
  });

  it("does not query without a deal", () => {
    renderHook(() => useDealPartnerNotes(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});

describe("usePartnerNoteCounts", () => {
  it("counts notes per referred deal", async () => {
    endMock.mockResolvedValueOnce({
      data: [
        { deal_id: "d-1", notes: [{ id: "n-1" }, { id: "n-2" }] },
        { deal_id: "d-2", notes: [] },
        { deal_id: null, notes: [{ id: "n-3" }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerNoteCounts("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ "d-1": 2 });
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "deal_id, notes:referral_partner_notes(id)"],
      ["eq", "partner_id", "p-1"],
      ["eq", "direction", "outbound"],
      ["limit", 500],
    ]);
  });

  it("surfaces a read error", async () => {
    endMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => usePartnerNoteCounts("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("partnerNoteCountLabel", () => {
  it("words the count", () => {
    expect(partnerNoteCountLabel(0)).toBeNull();
    expect(partnerNoteCountLabel(1)).toBe("1 note from partner");
    expect(partnerNoteCountLabel(3)).toBe("3 notes from partner");
  });
});
```

Create `apps/app/src/features/partners/components/PartnerNoteBacksPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

let data: unknown = undefined;
vi.mock("../hooks/useReferralPartnerNotes", () => ({
  useDealPartnerNotes: () => ({ data }),
}));

import { PartnerNoteBacksPanel } from "./PartnerNoteBacksPanel";

describe("PartnerNoteBacksPanel", () => {
  it("renders nothing without notes", () => {
    data = [];
    const { container } = render(<PartnerNoteBacksPanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each partner's notes under their name", () => {
    data = [
      { referralId: "r-1", partnerId: "p-1", partnerName: "Jane CPA", notes: [{ id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00Z" }] },
      { referralId: "r-2", partnerId: "p-2", partnerName: null, notes: [{ id: "n-3", body: "Not a fit.", createdAt: "2026-10-22T12:00:00Z" }] },
    ];
    render(<PartnerNoteBacksPanel dealId="d-1" />);
    const jane = screen.getByRole("region", { name: "Notes from Jane CPA" });
    expect(within(jane).getByText("Demo booked.")).toBeInTheDocument();
    expect(within(jane).getByText("Oct 21")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes from the partner" })).getByText("Not a fit.")).toBeInTheDocument();
  });
});
```

Append inside `describe("ReferralSection", ...)` in `ReferralSection.test.tsx`:

```tsx
  it("shows a per-row line when rowNote returns one", () => {
    renderSection({ rowNote: (d) => (d.id === dealA.id ? "2 notes from partner" : null) });
    expect(screen.getByText("2 notes from partner")).toBeInTheDocument();
    expect(screen.getAllByText(/notes? from partner/)).toHaveLength(1);
  });
```

In `apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx`, add next to the other hook mocks:

```tsx
let noteCounts: Record<string, number> = {};
vi.mock("../hooks/useReferralPartnerNotes", () => ({
  usePartnerNoteCounts: () => ({ data: noteCounts }),
  partnerNoteCountLabel: (n: number) => (n <= 0 ? null : n === 1 ? "1 note from partner" : `${n} notes from partner`),
}));
```

and append inside `describe("PartnerDetailPage / inbound + outbound referrals", ...)`:

```tsx
  it("shows how many notes the partner left on a deal referred to them", () => {
    noteCounts = { "d-out": 2 };
    const deals = [deal("d-in", 10_000_00), deal("d-out", 20_000_00)];
    renderPage({ partners: [partner({ id: "p1", attributedDealIds: ["d-in"], outboundDealIds: ["d-out"] })], deals, partnerId: "p1" });
    const outbound = screen.getByRole("heading", { name: /Referred to them/i });
    const card = (outbound.closest("div[class*='rounded']") ?? outbound.parentElement!.parentElement!) as HTMLElement;
    expect(within(card).getByText("2 notes from partner")).toBeInTheDocument();
    noteCounts = {};
  });
```

In `apps/app/src/features/pipeline/pages/DealDetailPage.referral.test.tsx`, add next to the other mocks:

```tsx
let partnerNotes: unknown[] = [];
vi.mock("@/features/partners/hooks/useReferralPartnerNotes", () => ({
  useDealPartnerNotes: () => ({ data: partnerNotes }),
}));
```

add `partnerNotes = [];` to the `beforeEach`, and append inside the describe:

```tsx
  it("shows what a partner wrote back on a referral this deal was sent to them", async () => {
    dealReferral = null;
    partnerNotes = [
      { referralId: "r-9", partnerId: "p-9", partnerName: "Kim CPA", notes: [{ id: "n-1", body: "Signed today.", createdAt: "2026-10-22T12:00:00Z" }] },
    ];
    renderDealDetail();
    const group = await screen.findByRole("region", { name: "Notes from Kim CPA" });
    expect(within(group).getByText("Signed today.")).toBeInTheDocument();
  });
```

(add `within` to that file's `@testing-library/react` import).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralPartnerNotes.test.tsx src/features/partners/components/PartnerNoteBacksPanel.test.tsx src/features/partners/components/ReferralSection.test.tsx src/features/partners/pages/PartnerDetailPage.test.tsx src/features/pipeline/pages/DealDetailPage.referral.test.tsx`
Expected: FAIL (modules missing; no row line; no notes region).

- [ ] **Step 3: Write the hook**

Create `apps/app/src/features/partners/hooks/useReferralPartnerNotes.ts`:

```ts
/**
 * Notes partners wrote back on referrals sent to them (Partner Portal Phase
 * 2B-3, FR-PORT-78). A "Note from partner" record, never an activity. Read
 * under RLS (referral_partner_notes is visible when its referral is); only the
 * partner portal writes them.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PartnerNoteBack {
  id: string;
  body: string;
  createdAt: string;
}

export interface DealPartnerNotes {
  referralId: string;
  partnerId: string;
  /** Null when partners RLS hides the partner from this viewer. */
  partnerName: string | null;
  /** Newest first. */
  notes: PartnerNoteBack[];
}

interface NoteRow {
  id: string;
  body: string;
  created_at: string;
}

interface DealRow {
  id: string;
  partner_id: string;
  partner: { name: string } | null;
  notes: NoteRow[] | null;
}

interface CountRow {
  deal_id: string | null;
  notes: Array<{ id: string }> | null;
}

export function dealPartnerNotesKey(dealId: string) {
  return ["referrals", "partner-notes", "deal", dealId] as const;
}

export function partnerNoteCountsKey(partnerId: string) {
  return ["referrals", "partner-notes", "partner", partnerId] as const;
}

export function useDealPartnerNotes(dealId: string | undefined) {
  return useQuery({
    queryKey: dealPartnerNotesKey(dealId ?? "none"),
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealPartnerNotes[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, partner_id, partner:partners(name), notes:referral_partner_notes(id, body, created_at)")
        .eq("deal_id", dealId as string)
        .eq("direction", "outbound")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as DealRow[])
        .map((r) => ({
          referralId: r.id,
          partnerId: r.partner_id,
          partnerName: r.partner?.name ?? null,
          notes: (r.notes ?? [])
            .map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at }))
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        }))
        .filter((g) => g.notes.length > 0);
    },
    staleTime: 30_000,
  });
}

export function usePartnerNoteCounts(partnerId: string | undefined) {
  return useQuery({
    queryKey: partnerNoteCountsKey(partnerId ?? "none"),
    enabled: Boolean(partnerId),
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("deal_id, notes:referral_partner_notes(id)")
        .eq("partner_id", partnerId as string)
        .eq("direction", "outbound")
        .limit(500);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as CountRow[]) {
        const n = r.notes?.length ?? 0;
        if (!r.deal_id || n === 0) continue;
        counts[r.deal_id] = (counts[r.deal_id] ?? 0) + n;
      }
      return counts;
    },
    staleTime: 30_000,
  });
}

export function partnerNoteCountLabel(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 note from partner" : `${n} notes from partner`;
}
```

- [ ] **Step 4: Write the panel and the row line**

Create `apps/app/src/features/partners/components/PartnerNoteBacksPanel.tsx`:

```tsx
/**
 * PartnerNoteBacksPanel: on Deal Detail under Source (Partner Portal 2B-3,
 * FR-PORT-78). What a partner wrote back on a referral this deal was sent to
 * them, newest first, one group per partner. Short and scannable; hidden when
 * there is nothing to show.
 */
import { useDealPartnerNotes } from "../hooks/useReferralPartnerNotes";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PartnerNoteBacksPanel({ dealId }: { dealId: string }) {
  const { data } = useDealPartnerNotes(dealId);
  if (!data || data.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-border-subtle pt-4">
      {data.map((g) => {
        const title = `Notes from ${g.partnerName ?? "the partner"}`;
        return (
          <section key={g.referralId} aria-label={title} className="flex flex-col gap-2">
            <span className="text-eyebrow text-text-subtle">{title}</span>
            <ul className="flex flex-col gap-2">
              {g.notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-0.5">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{n.body}</p>
                  <span className="text-caption text-text-subtle">{shortDate(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default PartnerNoteBacksPanel;
```

In `apps/app/src/features/partners/components/ReferralSection.tsx`, add to `ReferralSectionProps`:

```ts
  /** Optional short line under a row's contact name (Partner Detail: partner note counts). */
  rowNote?: (deal: Deal) => string | null;
```

destructure `rowNote` in the component's parameters, and inside the row's `<div className="flex min-w-0 flex-col">`, after the contact name paragraph, add:

```tsx
                  {rowNote?.(d) && <p className="truncate text-caption text-brand-primary">{rowNote(d)}</p>}
```

- [ ] **Step 5: Wire the pages**

`apps/app/src/features/partners/pages/PartnerDetailPage.tsx`: import `{ partnerNoteCountLabel, usePartnerNoteCounts } from "../hooks/useReferralPartnerNotes"`; after `const unattribute = useUnattributeDeal();` add `const { data: noteCounts } = usePartnerNoteCounts(partnerId);`; on the "Referred to them" `ReferralSection` add:

```tsx
          rowNote={(d) => partnerNoteCountLabel(noteCounts?.[d.id] ?? 0)}
```

`apps/app/src/features/pipeline/pages/DealDetailPage.tsx`: import `{ PartnerNoteBacksPanel } from "@/features/partners/components/PartnerNoteBacksPanel"`; in `SourceCard`, right after the `{referral && (<ReferralUpdatesPanel ... />)}` block, add:

```tsx
      <PartnerNoteBacksPanel dealId={deal.id} />
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter app test -- src/features/partners src/features/pipeline`
Expected: PASS, no `act()` warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReferralPartnerNotes.ts apps/app/src/features/partners/hooks/useReferralPartnerNotes.test.tsx apps/app/src/features/partners/components/PartnerNoteBacksPanel.tsx apps/app/src/features/partners/components/PartnerNoteBacksPanel.test.tsx apps/app/src/features/partners/components/ReferralSection.tsx apps/app/src/features/partners/components/ReferralSection.test.tsx apps/app/src/features/partners/pages/PartnerDetailPage.tsx apps/app/src/features/partners/pages/PartnerDetailPage.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx apps/app/src/features/pipeline/pages/DealDetailPage.referral.test.tsx
git commit -m "feat(partners): show partner notes on the deal and a count on the partner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Full verification, push, PR to main (the controller runs this task)

**Files:** none changed.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`063` to `066` included, `001` to `062` still passing), the documented SKIPs unchanged.

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

Expected: no `FAILED` line; `Manifest covers every secret the function code reads.` (no new secret: `portal_notify` already reads `SUPABASE_URL`); the destructive check exits 0 (constraints are dropped and re-added, no table or column is dropped).

- [ ] **Step 5: No long dashes on added lines; notes never become activities; no unsubscribe outside the digest**

Run: `git diff origin/main...HEAD | perl -CSD -ne 'print if /^\+/ && /[\x{2013}\x{2014}]/'`
Expected: no output.

Run: `git diff origin/main...HEAD -- supabase/migrations | grep -in "into activities"`
Expected: no output (partner note-back is its own record).

Run: `grep -rln "List-Unsubscribe" supabase/functions/_shared --include=*.ts | grep -v test`
Expected: exactly `supabase/functions/_shared/portalNotifyEmail.ts`.

- [ ] **Step 6: Push the feature branch and open the PR to main (do not merge)**

Push the current feature branch (`claude/partner-portal-2b3`) to origin with upstream tracking, never `main` or the production branch, then open the PR:

```bash
git push -u origin claude/partner-portal-2b3
gh pr create --base main --title "Partner Portal 2B-3: referrals sent to you, partner note-back, weekly summary" --body "$(cat <<'EOF'
## Summary
- Partners now see "Sent to you" in their portal: every deal a rep referred to them, with the business contact (name, email, phone), who sent it, the date, and its current label. The rep's note shows only when the rep wrote it for the partner; older referrals and internal notes never show.
- On Deal Detail, "Send as referral" now labels the note "Note for <partner> (they will see this)". "Refer a deal" on the partner page sends no note, as before.
- When a rep sends a referral to a partner with portal access, the partner gets "<ISO> sent you a referral: <Company>", replying to the rep.
- Partners can write a note back on a referral sent to them (up to 1,000 characters, 20 an hour). The rep who sent it (or the deal owner if they left) gets an email, sees "Notes from <partner>" on the deal, and the partner page shows a note count on that referral. The note is its own record, never an activity, so it does not touch the activity reports.
- Weekly summary: Monday from 8am in the partner owner's time zone, one email about the previous week (new referrals, Accepted, In Progress, Closed Won with the amount only when the ISO shows values, Not Moving Forward, and referrals sent to them). Nothing is sent for a quiet week. Partners can turn it off in their profile, from the link in the email (a confirm page), or with their mail app's one-click unsubscribe. No other email ever has an unsubscribe link.
- CSV downloads from the portal are now audited.
- Privacy: the 90-day purge and the partner erase also delete the partner's notes, the rep note in queued emails, and the unsubscribe token.

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md
Plan: docs/superpowers/plans/2026-10-22-partner-portal-2b3-sent-notes-digest.md

## Deviations (details in the plan)
- The partner-visible note uses a new save action; the old one stays for older app versions and never shows a note to a partner.
- The "sent you a referral" email is sent by both save actions, including "Refer a deal" on the partner page (without a note).
- A referral a rep removed stays in the partner's "Sent to you" list as Withdrawn.
- The weekly summary covers the previous Monday to Monday and is sent from Monday 8am in the partner owner's time zone.

## Not in this PR
- Custom domains and finding the ISO by host name (FR-PORT-88), Firms, attachments, the 1-hour SLA, partner accept or decline, commission, status-change emails for referrals sent to a partner.

## Test plan
- [ ] DB tests 063 to 066 pass in CI from an empty database, with 001 to 062 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] Staging: from a deal, Send as referral to a partner with portal access, with a note; the partner gets the email (reply goes to the rep) and sees the deal under Sent to you with the note
- [ ] Staging: "Refer a deal" from the partner page; the partner sees it with no note
- [ ] Staging: as the partner, add a note; the rep gets "New partner note" and sees it on the deal; the partner page shows "1 note from partner"
- [ ] Staging: the next Monday after 8am, the partner gets the weekly summary; the footer link opens the confirm page and Unsubscribe stops the next one; Gmail shows its own unsubscribe button
- [ ] Staging: a CSV download from the portal writes an export row in the portal audit log

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
| 1 | `partner_note_visible`, `send_referral_to_partner`, the "sent you a referral" email, outbox kinds, audit actions |
| 2 | `referral_partner_notes`; sent-to-you reads; `portal_post_partner_note` with the internal email |
| 3 | `enqueue_portal_digests`, `portal_unsubscribe_digest`, `portal_record_export`, digest-aware claim |
| 4 | Purges erase notes, queued notes and the unsubscribe token |
| 5 | Email copy: sent to you, weekly summary (footer link, headers), partner note |
| 6 | portal_notify queues digests and sends headers |
| 7 | portal_api: sent list, sent detail, post note; audited export |
| 8 | portal_api: `unsubscribe_digest` incl. one-click POST |
| 9 | Portal client calls; "Sent to you" on the dashboard |
| 10 | Sent referral page with the note composer |
| 11 | Unsubscribe page |
| 12 | String audit for every new response, page and email |
| 13 | Rep app: note labelled for the partner; new RPC |
| 14 | Rep app: partner notes on Deal Detail, count on Partner Detail |
| 15 | Verification, push, PR |

## Not in this PR (deferred, recorded)

- FR-PORT-88: tenant resolution by host header and custom domains.
- Firms, attachments, the 1-hour SLA, partner accept or decline, commission (agreed cuts).
- Status-change emails for outbound referrals (their status follows the deal stage; avoided as noise).

## Open questions for Ryan (product, not engineering)

1. **Old outbound referrals become visible to partners.** Every deal already linked as "Referred to them" (including ones moved over from the old partner links) will appear under the partner's "Sent to you" with the business contact name, email and phone captured when it was linked, but never the old notes. The plan shows them all, since those businesses were already sent to the partner. Say if only referrals sent from this release on should appear.
2. **"Refer a deal" on the partner page also emails the partner** ("<ISO> sent you a referral"), the same as "Send as referral" from the deal. Say if only the deal-page path should email.
3. **Removed links stay listed as Withdrawn.** When a rep removes a "Referred to them" link, the partner keeps seeing that referral labelled Withdrawn (their notes stay until the 90-day purge). Say if removed links should disappear from the partner's list instead.
