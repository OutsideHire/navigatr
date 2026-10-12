# Partner Portal Phase 2B-1 (referral links and public intake) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every active internal user gets a personal public referral form link, administrators get one company link, and anyone holding a link can send a business through a branded, sign-in-free form protected by a honeypot, a minimum time-to-submit, a per-connection limit and (past the limit) a Cloudflare Turnstile check. Submissions are stored as Unattributed Submissions routed to the link's rep (or their manager, or the administrator queue), and the person sending sees a reference on screen and, if they gave their own email, gets a confirmation email. Ships dark: no tenant can turn the form on until Phase 2B-2 adds the toggle and triage.

**Architecture:** Every rule lives in SQL. Links live in `referral_form_links` (no direct client access; three authenticated RPCs). Public submissions live in their own table `referral_form_submissions`, never in `referrals`. The public side is two new unauthenticated `portal_api` actions (`public_form`, `public_submit`) in a new pure module `_shared/portalPublicForm.ts`; they call three service-role-only SQL functions. The form token the server hands out is an HMAC over the slug, the link token and the issue time, so the minimum time-to-submit cannot be faked. Turnstile's script loads in the browser only after the server answers `captcha_required`. The rep app gets a "Share referral form" sheet on the Partners page (link, QR, download, native share, new link).

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Deno edge functions, React 18 + TypeScript, TanStack Query 5, vitest 4 + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`, `qrcode@1.5.4` (dynamically imported), Cloudflare Turnstile (explicit render).

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (patterns; section 9 lists 2B) and the Phase 2B-1 design brief (binding, referred to as "brief scope N" below), which implements PRD Addendum v1.0 sections 6.2 and 7, FR-PORT-24 to FR-PORT-34. The template for format is `docs/superpowers/plans/2026-10-16-partner-portal-2a-prd-completion.md`.

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261018000001_...` to `20261018000003_...`, applied in filename order. The latest existing migration is `20261016000007`. Never hand-apply SQL to staging or production; CI and `promote-production` apply them. Never run a `supabase` command against a remote project while building this plan.
- New enum values (`referral_source` `portal_public`; `portal_audit_action` `public_submit` and `link_regenerate`) are added alone in the first migration file: a value added with `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.
- Public functions (`portal_public_*`) are `security definer set search_path = public, extensions`, then `revoke execute ... from public, anon, authenticated;` and `grant execute ... to service_role;`. Private helpers (`_portal_*`, `_referral_*`) are also revoked from `service_role`. Supabase grants `authenticated` and `PUBLIC` function EXECUTE by default, so both are revoked by name.
- Internal RPCs (`get_my_referral_link`, `get_tenant_referral_link`, `regenerate_referral_link`) are `security definer set search_path = public, extensions`, re-check org and role inside, `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`. `referral_route_user` keeps the posture of `referral_route_assignee` (`set search_path = public`, revoked from `public, anon, authenticated`).
- New tables enable RLS and `revoke all ... from anon, authenticated` first (default privileges from 20260813000002 grant `authenticated` full DML on new tables). `referral_form_links` gets no grant and no policy. `referral_form_submissions` gets a column-level SELECT grant (never `submitter_ip`) and one SELECT policy.
- pgcrypto calls are schema-qualified (`extensions.gen_random_bytes`).
- Link tokens: 16 random bytes, base64url, no padding (22 characters of `[A-Za-z0-9_-]`). Stored in plain text: a link is a routing key the rep re-copies, not a credential.
- Public field caps (brief scope 4, mirrors `PORTAL_FIELD_LIMITS`): company 160, contact name 120, email 254, phone 40 with at least 7 digits, notes 4000, "who referred" 160, the referrer's own email 254 (validated like any email). Company, contact name, email, phone and notes are required (FR-PORT-29); "who referred" and "Your email" are optional.
- Bot rules (FR-PORT-30, brief scope 6): minimum time-to-submit 3 seconds, form token valid 24 hours, honeypot field `website`, soft limit 5 per IP per hour (then Turnstile), hard limit 30 per IP per hour even with Turnstile. A too-fast post or a filled honeypot answers exactly like success with a random reference and writes nothing.
- FR-PORT-34: no duplicate check of any kind at intake, and no response differs by whether the business exists.
- Turnstile: test site key `1x00000000000000000000AA`, test secret `1x0000000000000000000000000000000AA` (always pass) for local and staging until Ryan creates the real site. Script URL `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, verify URL `https://challenges.cloudflare.com/turnstile/v0/siteverify`. The script loads only after a `captcha_required` answer.
- Edge secrets `PUBLIC_FORM_SIGNING_SECRET` and `TURNSTILE_SECRET_KEY` fail closed when unset: no signing secret means the form answers `not_available`; no Turnstile secret means a connection over the soft limit can never pass. Client key `VITE_TURNSTILE_SITE_KEY`; unset means a connection over the soft limit sees "try again later".
- Public copy names the ISO, never "navigatr", never echoes internal tokens, and never uses the lowercase words submitted, accepted, working, won, lost, declined or withdrawn. The confirmation email (FR-PORT-33, controller ruling) goes ONLY to the optional referrer email (`referrer_email`), never to the business contact's email; no referrer email means no confirmation email (the on-screen reference still shows). It carries the ISO name and the reference only, never text the submitter typed. Partner and public pages keep 44px tap targets (`min-h-11` or `size="lg"`).
- `_shared` modules are dependency-free TS with no Deno globals at module scope, import each other with the `.ts` extension, and their tests import without the extension. Every new `_shared` source file is added to the `include` list in `apps/app/tsconfig.app.json`.
- DB tests: plain psql scripts `supabase/tests/057_referral_form_links.sql` and `058_public_form_submissions.sql`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch. Service-role-only functions are called as `postgres` (switch back with `perform set_config('role', 'postgres', true);`). Assert function privileges with `has_function_privilege` and table or column privileges with `has_table_privilege` or `has_column_privilege`, never by calling something the role cannot execute: local Postgres 17.6 segfaults on a live function-level permission denied.
- Run DB tests locally: `supabase start`, then `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. One file: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/NNN_name.sql`.
- Frontend tests: `pnpm --filter app test -- <path>` for one file, `pnpm --filter app test` for all. Tests live next to source. No `act()` warnings. Every portal test file that renders `PortalRoot` installs its own in-memory `Storage` shim in `beforeEach` and restores the original in `afterEach` (Node 25 ships a broken global `localStorage`).
- Before any push: `pnpm --filter app build` must pass (`tsc -b && vite build`).
- Deno: `deno check --no-lock --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts`.
- Existing behavior is preserved: Phase 0 to 2A tests (DB `001` to `056`, all vitest files, the email snapshot files) must still pass unchanged.
- No em dashes or en dashes anywhere: copy, comments, SQL, commit messages, PR text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A quick send right after the form (re)loads.** The server treats a form token younger than 3 seconds as a bot and answers with a fake success, so a person who clicks "Send another" and fills nothing, or who re-sends right after a "page was open a while" refetch, would lose the referral silently. Expected: the page never sends a token younger than 3.5 seconds (it waits), and never refetches the form on window focus. Pinned in Task 9 (`waitForFormAge` is awaited with the form's load time; a focus event does not refetch) and Task 8 (`sendDelay` unit test).
2. **A link that dies between load and send** (regenerated, or the ISO turns the form off). Expected: the page shows "This form isn't available", never "Thanks for the referral". Pinned in Task 6 (zero rows from `portal_public_submit` answers 404) and Task 9 (404 on send shows the unavailable card).
3. **An environment without a Turnstile site key** (Vercel env not set). Expected: a connection over the limit sees "Too many referrals from this connection right now. Try again later.", no broken widget, no script load. Pinned in Task 9.
4. **The confirmation email as a spam relay, or a surprise to the business.** Anyone can type any email address. Expected: the email goes only to the optional "Your email" address (never to the business contact), is not sent at all when that field is blank, says only the ISO name and the reference (never the company, notes or "who referred" text), and respects the non-production allowlist. Pinned in Task 6 and Task 10.
5. **A deactivated or unplaced rep's printed QR code.** Expected: the form still works, does not show that rep's name, and the submission routes to their manager (or the administrator queue when there is no active manager). Pinned in Task 3 (DB test 058).

---

## File map

**Create**
- `supabase/migrations/20261018000001_public_form_enums.sql`: `referral_source` gains `portal_public`; `portal_audit_action` gains `public_submit`, `link_regenerate`.
- `supabase/migrations/20261018000002_referral_form_links.sql`: `organizations.public_form_enabled`, `referral_form_links`, `referral_route_user` (and `referral_route_assignee` re-expressed through it), `_referral_link_token`, `_referral_form_open`, `_referral_form_link`, `get_my_referral_link`, `get_tenant_referral_link`, `regenerate_referral_link`.
- `supabase/migrations/20261018000003_public_form_submissions.sql`: `referral_form_submissions` (+ RLS), `_portal_public_link`, `portal_public_form`, `portal_public_submit`, `portal_public_rate`.
- `supabase/tests/057_referral_form_links.sql`, `supabase/tests/058_public_form_submissions.sql`.
- `supabase/functions/_shared/portalPublicForm.ts` (+ `.test.ts`): limits, validation, form token signing, fake reference, Turnstile verify, and the `public_form` / `public_submit` handlers.
- `apps/app/src/features/portal/lib/turnstile.ts` (+ `.test.ts`): script loader and site key.
- `apps/app/src/features/portal/lib/publicFormTiming.ts` (+ `.test.ts`): the 3.5 second send guard.
- `apps/app/src/features/portal/components/TurnstileWidget.tsx` (+ `.test.tsx`).
- `apps/app/src/features/portal/pages/PortalPublicFormPage.tsx` (+ `.test.tsx`).
- `apps/app/src/features/partners/lib/referralQr.ts` (+ `.test.ts`).
- `apps/app/src/features/partners/hooks/useReferralLinks.ts` (+ `.test.tsx`).
- `apps/app/src/features/partners/components/ShareReferralForm.tsx` (+ `.test.tsx`).

**Modify**
- `supabase/functions/_shared/emailTemplate.ts` (+ test): the button is optional (output byte-identical when present).
- `supabase/functions/_shared/portalEmail.ts` (+ test): `portalPublicConfirmationEmail`.
- `supabase/functions/_shared/portalApi.ts` (+ test): routes `public_form` and `public_submit` with no session; `PortalEnv` and `PortalApiDeps` gain optional public-form fields.
- `supabase/functions/portal_api/index.ts`: the two secrets and `fetch`.
- `supabase/secrets.manifest.json`: both secrets required in staging, demo and production.
- `apps/app/tsconfig.app.json`: include `portalPublicForm.ts`.
- `apps/app/src/vite-env.d.ts`: `VITE_TURNSTILE_SITE_KEY`.
- `apps/app/.env.local.example`: document `VITE_TURNSTILE_SITE_KEY`.
- `apps/app/src/features/portal/lib/portalApi.ts` (+ test): `publicForm`, `publicSubmit`.
- `apps/app/src/features/portal/lib/portalAddress.ts` (+ test): `referralFormAddress`.
- `apps/app/src/features/portal/pages/PortalRoot.tsx`: `refer/:token` route outside the signed-in layout.
- `apps/app/src/features/portal/portalStringAudit.test.tsx`: public form responses, page, email.
- `apps/app/src/features/partners/pages/PartnersPage.tsx`: the Share referral form button in the header.
- `apps/app/package.json`, `pnpm-lock.yaml`: `qrcode@1.5.4`, `@types/qrcode@1.5.5`.

**Deviations from the brief, recorded here:**

1. **`referral_route_assignee` is re-expressed through a new `referral_route_user(p_user uuid)`** (brief scope "Rulings": add a sibling taking a user). The partner version now returns `referral_route_user(<partner owner>)`, so the owner, manager, queue rule exists once. Behavior is identical (a partner's `owner_id` is `not null` and `on delete restrict`); DB tests `001` to `056` and a parity assertion in `057` prove it.
2. **The rep's name shows on the form only when the link routes to that rep.** A deactivated or unplaced rep's link still works but shows no name, since the referral goes to their manager or the queue (FR-PORT-25 "may show").
3. **`referral_form_submissions` adds `consent_version` and `consent_text_snapshot`** (NFR-PORT-07, the same rule as portal referrals). Contact name, email, phone, notes and the consent snapshot are nullable at the table level so the 2B-2 purge can erase them; `portal_public_submit` enforces them as required. `form_link_id` is `on delete set null` (account deletion cascades a deleted user's links). `outcome` is constrained to `accepted`, `declined`, `merged` now (FR-PORT-32).
4. **`portal_public_rate(p_ip text, p_window_minutes integer)`** takes minutes, not an `interval`: PostgREST passes RPC arguments as JSON and an integer is unambiguous.
5. **The 30 per hour hard limit is enforced in SQL too**, inside `portal_public_submit` under a per-IP advisory lock, so parallel posts cannot race past the edge pre-check. The soft limit (5, then Turnstile) stays at the edge.
6. **A missing, forged or expired (over 24 hours) form token answers `409 form_expired`**, not a fake success: a person who left the tab open overnight gets "send it again" instead of a silent loss. Only too-fast (under 3 seconds) and the honeypot get the fake success. The page waits until its token is 3.5 seconds old before sending and never refetches the form on focus (Review Focus 1).
7. **`public_form` returns no brand.** `PortalRoot` already loads the brand through `portal_brand` before any route renders. The response is `{ orgName, repName, consentText, consentVersion, formToken }`.
8. **The confirmation email goes only to a new optional "Your email" field** (controller ruling on FR-PORT-33, whose "submitter" is not the business contact). `referral_form_submissions.referrer_email` (cap 254, validated like other emails, lowercased, nullable, erased by the 2B-2 purge with the other personal fields). Blank means no confirmation email; the business contact's email never receives one. The email has no button, so `renderEmail` gets an optional button; output with a button is byte-identical (the snapshot files are unchanged).
9. **CRON_SECRET has no local or CI provisioning to mirror.** Cron functions are not served locally and CI runs only the pure `_shared` tests and `deno check`, which inject secrets. So the two new secrets are added to `supabase/secrets.manifest.json` (required in staging, demo and production, which makes the deploy check enforce them and the CI audit pass), and local development puts them in `supabase/functions/.env` (gitignored by the root `.env` rule), which `supabase functions serve` reads.
10. **`get_my_referral_link` and `get_tenant_referral_link` return a null token and create nothing while the form is off.** "On" is `portal_enabled and public_form_enabled and not is_disabled`, the same test the public side uses, so a link is never shown that would not work.
11. **Every active user gets a personal link.** Bundle 2 lets any active org member create and own partners (`partners_insert` checks only `org_id = user_org_id()` and `created_by = auth.uid()`).
12. **A user may regenerate their own link** (brief), administrators may regenerate any user's link in their org and the tenant link (FR-PORT-27). The rep app shows "Get a new link" for the viewer's own link and, for administrators, the company link. An administrator control for another user's link is not in this phase (2B-2).
13. **`link_regenerate` and `public_submit` are written to `portal_audit_log`**: its `portal_user_id` is nullable and `actor_user_id` holds the internal user, so it fits without a new table.
14. **The QR library is `qrcode@1.5.4`, loaded with a dynamic `import()`** inside `referralQrDataUrl`, so it is a separate chunk fetched only when the Share sheet opens. The sheet itself is small and is not lazy-loaded.

## Operator steps (Ryan, before merging to main)

The staging deploy runs `node tools/check-secrets.mjs staging`, which fails if a required secret is missing, so these come first.

1. Cloudflare: create a Turnstile widget (Managed mode) with hostnames `app.getnavigatr.io`, `staging.getnavigatr.io`, `demo.getnavigatr.io`. Keep the site key and secret key.
2. Supabase Edge Function secrets, per project (Dashboard, Project Settings, Edge Functions, Secrets; never paste values into chat or a file):
   - `PUBLIC_FORM_SIGNING_SECRET`: a fresh random value per project (for example `openssl rand -hex 32`), on staging (`hjhxdznpdytnafsxvptx`), demo (`xjitygvbnvclaooefvtw`) and production (`ogvcveimjjeywfdkkinb`).
   - `TURNSTILE_SECRET_KEY`: the Cloudflare test secret `1x0000000000000000000000000000000AA` on staging and demo until the real one exists; the real secret on production.
3. Vercel environment variable `VITE_TURNSTILE_SITE_KEY`: the test site key `1x00000000000000000000AA` for Preview (staging); the real site key for Production. A rebuild picks it up.
4. Local development (optional): `supabase/functions/.env` with `PUBLIC_FORM_SIGNING_SECRET=local-dev-only` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`, and `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` in `apps/app/.env.local`.
5. On staging, submit one test referral and check the portal_api log for which client IP header arrived (cf-connecting-ip expected). Look at the request headers in the invocation's metadata (Dashboard, Edge Functions, portal_api, Invocations); no code logs IPs, and none should be added for production. If cf-connecting-ip is missing or a client-sent value survives, `clientIp` in `supabase/functions/_shared/portalApi.ts` needs a different header order; the per-link and per-org limits in SQL hold either way.

Nothing is visible to customers after this ships: `public_form_enabled` defaults to false and has no UI until 2B-2. Trying it end to end on staging waits for the 2B-2 toggle (or a one-off staging-only update Ryan explicitly approves; never production).

---

### Task 1: New enum values

**Files:**
- Create: `supabase/migrations/20261018000001_public_form_enums.sql`

**Interfaces:**
- Produces (SQL): `referral_source` value `portal_public` (used by 2B-2 when a submission becomes a referral); `portal_audit_action` values `public_submit` (Task 3) and `link_regenerate` (Task 2).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261018000001_public_form_enums.sql`:

```sql
-- 20261018000001_public_form_enums.sql
--
-- Partner Portal Phase 2B-1 (public referral form). New enum values, alone in
-- this file: a value added with ALTER TYPE ... ADD VALUE cannot be used in the
-- transaction that adds it, and 20261018000002 and 20261018000003 use them.
--   referral_source portal_public       a referral made from a public form
--                                        submission at triage (Phase 2B-2)
--   portal_audit_action public_submit   a public form submission was stored
--   portal_audit_action link_regenerate an internal user retired a form link

alter type referral_source add value if not exists 'portal_public';
alter type portal_audit_action add value if not exists 'public_submit';
alter type portal_audit_action add value if not exists 'link_regenerate';
```

- [ ] **Step 2: Apply it**

Run: `supabase db reset`
Expected: finishes with `Finished supabase db reset`, no errors.

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "select (select string_agg(e, ',') from unnest(enum_range(null::portal_audit_action)::text[]) e where e in ('public_submit','link_regenerate')) || ' ' || ('portal_public' = any(enum_range(null::referral_source)::text[]))::text"`
Expected: `public_submit,link_regenerate true`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261018000001_public_form_enums.sql
git commit -m "$(cat <<'EOF'
feat(portal): enum values for the public referral form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Referral form links (SQL)

**Files:**
- Create: `supabase/migrations/20261018000002_referral_form_links.sql`
- Test: `supabase/tests/057_referral_form_links.sql`

**Interfaces:**
- Consumes (SQL): `organizations`, `profiles`, `partners`, `portal_audit_log`; `public.user_org_id()`, `public.caller_is_admin()`, `public._portal_audit(p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid) returns void`; enum value `link_regenerate` (Task 1).
- Produces (SQL):
  - Column `organizations.public_form_enabled boolean not null default false` (FR-PORT-28).
  - Table `referral_form_links (id uuid, org_id uuid, link_type text 'tenant'|'user', user_id uuid null for tenant, token text unique, created_by uuid, created_at timestamptz, retired_at timestamptz)`. Partial unique indexes `referral_form_links_tenant_active_uidx (org_id) where link_type = 'tenant' and retired_at is null` and `referral_form_links_user_active_uidx (org_id, user_id) where link_type = 'user' and retired_at is null`. Check constraint `referral_form_links_user_matches_type`. No client access.
  - `public.referral_route_user(p_user uuid) returns uuid`: the user if active and placed (or an administrator), else their active manager, else null. Private.
  - `public.referral_route_assignee(p_partner uuid) returns uuid`: unchanged behavior, now `referral_route_user(<partner owner>)`.
  - `public._referral_link_token() returns text`, `public._referral_form_open(p_org uuid) returns boolean`, `public._referral_form_link(p_org uuid, p_link_type text, p_user uuid) returns text`: private.
  - `public.get_my_referral_link() returns table (link_token text, org_slug text, public_form_enabled boolean)`: authenticated. Error `not_authorized` for a deactivated caller. Null token and nothing created while the form is off.
  - `public.get_tenant_referral_link() returns table (link_token text, org_slug text, public_form_enabled boolean)`: authenticated, administrators only (`not_authorized`).
  - `public.regenerate_referral_link(p_link_type text, p_user_id uuid default null) returns text`: authenticated. Errors `not_authorized`, `invalid_link_type`. Retires the active link, returns the new token, audits `link_regenerate` with `actor_user_id = auth.uid()`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/057_referral_form_links.sql`:

```sql
-- Tests for 20261018000002_referral_form_links (Partner Portal Phase 2B-1,
-- FR-PORT-24..28).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/057_referral_form_links.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture, org A pf-links (portal on, public form on): boss administrator,
-- rita rep under boss, dee rep under boss (deactivated). Partner P1 owned by rita.
-- Org B pf-links-b (portal on, public form off): bob administrator.
-- Org C pf-links-c: created with every default.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001057', 'Links Org',   'pf-links',   'pf-links-a1',   true),
  ('00000000-0000-0000-0000-000000001157', 'Links Org B', 'pf-links-b', 'pf-links-b-a1', true);
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001257', 'Links Org C', 'pf-links-c', 'pf-links-c-a1');
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001057';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0570000-0000-0000-0000-000000000001', 'boss@links.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000002', 'rita@links.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000003', 'dee@links.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000004', 'bob@linksb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0570000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001057', 'admin', 'administrator',      'Boss',     'boss@links.example', 'lnkboss'::ltree,      null,                                   null),
  ('a0570000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001057', 'rep',   'sales_professional', 'Rita Rep', 'rita@links.example', 'lnkboss.rita'::ltree, 'a0570000-0000-0000-0000-000000000001', null),
  ('a0570000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001057', 'rep',   'sales_professional', 'Dee Rep',  'dee@links.example',  'lnkboss.dee'::ltree,  'a0570000-0000-0000-0000-000000000001', now()),
  ('a0570000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001157', 'admin', 'administrator',      'Bob',      'bob@linksb.example', 'lnkbob'::ltree,       null,                                   null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a057a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001057', 'a0570000-0000-0000-0000-000000000002', 'a0570000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa');

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

-- 1. Defaults, privileges, routing parity (as postgres, before any role switch).
do $$ begin
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001257') then
    raise exception 'the public form defaults to off';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_referral_link()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_tenant_referral_link()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.regenerate_referral_link(text, uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute the link RPCs';
  end if;
  if has_function_privilege('anon', 'public.get_my_referral_link()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_tenant_referral_link()', 'EXECUTE')
     or has_function_privilege('anon', 'public.regenerate_referral_link(text, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the link RPCs';
  end if;
  if has_function_privilege('authenticated', 'public.referral_route_user(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_route_user(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_form_link(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_form_link(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_link_token()', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_link_token()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_form_open(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_form_open(uuid)', 'EXECUTE') then
    raise exception 'the link helpers are private';
  end if;
  if has_table_privilege('authenticated', 'public.referral_form_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_form_links', 'UPDATE')
     or has_table_privilege('anon', 'public.referral_form_links', 'SELECT') then
    raise exception 'nobody reads or writes referral_form_links directly';
  end if;
  if public.referral_route_assignee('a057a000-0000-0000-0000-000000000001')
     is distinct from public.referral_route_user('a0570000-0000-0000-0000-000000000002') then
    raise exception 'routing a partner must equal routing its owner';
  end if;
  if public.referral_route_user('a0570000-0000-0000-0000-000000000002') is distinct from 'a0570000-0000-0000-0000-000000000002'::uuid then
    raise exception 'an active placed rep routes to themselves';
  end if;
  if public.referral_route_user('a0570000-0000-0000-0000-000000000003') is distinct from 'a0570000-0000-0000-0000-000000000001'::uuid then
    raise exception 'a deactivated rep routes to their manager';
  end if;
  if public.referral_route_user(null) is not null then
    raise exception 'no user routes to the administrator queue';
  end if;
end $$;

-- 2. A rep gets a personal link, lazily, once; rep-only refusals.
do $$ declare v record; v2 record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000002');
  select * into v from public.get_my_referral_link();
  if v.link_token is null or v.link_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'a rep gets a 22-character link, got %', v.link_token;
  end if;
  if v.org_slug <> 'pf-links' or not v.public_form_enabled then
    raise exception 'slug and flag come back, got % %', v.org_slug, v.public_form_enabled;
  end if;
  select * into v2 from public.get_my_referral_link();
  if v2.link_token <> v.link_token then
    raise exception 'the link is stable across calls';
  end if;
  perform set_config('t.rita_first', v.link_token, true);

  perform _t_raises($q$select * from public.get_tenant_referral_link()$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('tenant')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('bogus')$q$, 'invalid_link_type');
end $$;

-- 3. A rep gets a new link; the old one is retired and the change is audited.
do $$ declare v_new text; v record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000002');
  v_new := public.regenerate_referral_link('user');
  if v_new is null or v_new = current_setting('t.rita_first') then
    raise exception 'regenerating returns a different token';
  end if;
  select * into v from public.get_my_referral_link();
  if v.link_token <> v_new then
    raise exception 'the new link is the active one';
  end if;
  perform set_config('t.rita_second', v_new, true);

  perform set_config('role', 'postgres', true);
  if (select retired_at from referral_form_links where token = current_setting('t.rita_first')) is null then
    raise exception 'the old link is retired';
  end if;
  if (select count(*) from referral_form_links
       where user_id = 'a0570000-0000-0000-0000-000000000002' and retired_at is null) <> 1 then
    raise exception 'exactly one active link per user';
  end if;
  if not exists (select 1 from portal_audit_log a
                  where a.org_id = '00000000-0000-0000-0000-000000001057' and a.action = 'link_regenerate'
                    and a.actor_user_id = 'a0570000-0000-0000-0000-000000000002' and a.portal_user_id is null) then
    raise exception 'regenerating is audited with the acting user';
  end if;
end $$;

-- 4. An administrator: the tenant link, and regenerating a rep's link.
do $$ declare v record; v_t text; v_r text; begin
  perform _t_act('a0570000-0000-0000-0000-000000000001');
  select * into v from public.get_tenant_referral_link();
  if v.link_token is null or not v.public_form_enabled or v.org_slug <> 'pf-links' then
    raise exception 'an administrator gets the tenant link';
  end if;
  v_t := public.regenerate_referral_link('tenant');
  if v_t is null or v_t = v.link_token then
    raise exception 'the tenant link is regenerated';
  end if;
  perform _t_raises($q$select public.regenerate_referral_link('tenant', 'a0570000-0000-0000-0000-000000000002')$q$, 'not_authorized');
  v_r := public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000002');
  if v_r is null or v_r = current_setting('t.rita_second') then
    raise exception 'an administrator regenerates a rep''s link';
  end if;
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000004')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-0000000000ff')$q$, 'not_authorized');

  perform set_config('role', 'postgres', true);
  if (select count(*) from referral_form_links
       where org_id = '00000000-0000-0000-0000-000000001057' and link_type = 'tenant' and retired_at is null) <> 1 then
    raise exception 'exactly one active tenant link';
  end if;
  if (select token from referral_form_links
       where user_id = 'a0570000-0000-0000-0000-000000000002' and retired_at is null) <> v_r then
    raise exception 'the administrator''s regenerated link is rita''s active link';
  end if;
end $$;

-- 5. Public form off: no token, nothing created. Deactivated caller: refused.
do $$ declare v record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000004');
  select * into v from public.get_my_referral_link();
  if v.link_token is not null or v.public_form_enabled or v.org_slug <> 'pf-links-b' then
    raise exception 'no personal link while the form is off, got %', row_to_json(v);
  end if;
  select * into v from public.get_tenant_referral_link();
  if v.link_token is not null or v.public_form_enabled then
    raise exception 'no tenant link while the form is off';
  end if;

  perform _t_act('a0570000-0000-0000-0000-000000000003');
  perform _t_raises($q$select * from public.get_my_referral_link()$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user')$q$, 'not_authorized');

  perform set_config('role', 'postgres', true);
  if exists (select 1 from referral_form_links where org_id = '00000000-0000-0000-0000-000000001157') then
    raise exception 'nothing is created while the public form is off';
  end if;
end $$;

-- 6. One active link per user and per tenant, enforced by the table.
do $$ begin
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001057', 'user', 'a0570000-0000-0000-0000-000000000002', 'dupDupDupDupDup0001')$q$,
    'referral_form_links_user_active_uidx');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, token)
    values ('00000000-0000-0000-0000-000000001057', 'tenant', 'dupDupDupDupDup0002')$q$,
    'referral_form_links_tenant_active_uidx');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001157', 'tenant', 'a0570000-0000-0000-0000-000000000004', 'dupDupDupDupDup0003')$q$,
    'referral_form_links_user_matches_type');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001157', 'user', 'a0570000-0000-0000-0000-000000000004', 'short')$q$,
    'referral_form_links_token_check');
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/057_referral_form_links.sql`
Expected: FAIL with `column "public_form_enabled" of relation "organizations" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261018000002_referral_form_links.sql`:

```sql
-- 20261018000002_referral_form_links.sql
--
-- Partner Portal Phase 2B-1 (PRD FR-PORT-24..28). Public referral form links.
-- Every active internal user can have one personal link and each tenant one
-- company link. A link is a routing key a rep re-copies and prints as a QR
-- code, not a credential, so the token is stored as is. Links never expire;
-- regenerating retires the old one (FR-PORT-27).
--
-- Ships dark: organizations.public_form_enabled defaults to false and has no
-- UI until Phase 2B-2, and while it is false the link RPCs create nothing.
--
-- Access model: referral_form_links has RLS on, no grants and no policies.
-- The three RPCs below are the only way in; portal_public_* (20261018000003)
-- reads links as the service role.

-- 1. Tenant switch (FR-PORT-28) ---------------------------------------------------
alter table organizations
  add column if not exists public_form_enabled boolean not null default false;

-- 2. Links ---------------------------------------------------------------------------
create table referral_form_links (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  link_type  text not null check (link_type in ('tenant','user')),
  user_id    uuid references profiles(id) on delete cascade,
  token      text not null unique constraint referral_form_links_token_check check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint referral_form_links_user_matches_type check ((link_type = 'tenant') = (user_id is null))
);
create unique index referral_form_links_tenant_active_uidx
  on referral_form_links (org_id) where link_type = 'tenant' and retired_at is null;
create unique index referral_form_links_user_active_uidx
  on referral_form_links (org_id, user_id) where link_type = 'user' and retired_at is null;

alter table referral_form_links enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_form_links from anon, authenticated;

-- 3. Routing for a user (FR-PORT-25, spec 4.4) ----------------------------------------
-- The user if active and placed (or an administrator), else the user's active
-- manager, else NULL = the administrator queue. referral_route_assignee
-- (20261007000001) is the same rule for a partner's owner, so it now calls this.
create or replace function public.referral_route_user(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with o as (
    select pr.id, pr.manager_id, pr.deactivated_at, pr.role_path, pr.role_level
    from profiles pr
    where pr.id = p_user
  ),
  m as (
    select pr.id, pr.deactivated_at from profiles pr where pr.id = (select manager_id from o)
  )
  select case
    when exists (select 1 from o)
         and (select deactivated_at from o) is null
         and ((select role_path from o) is not null or (select role_level from o) = 'administrator')
      then (select id from o)
    when exists (select 1 from m) and (select deactivated_at from m) is null
      then (select id from m)
    else null
  end
$$;

create or replace function public.referral_route_assignee(p_partner uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select public.referral_route_user((select p.owner_id from partners p where p.id = p_partner))
$$;

-- 4. Private helpers ---------------------------------------------------------------------

-- 16 random bytes, base64url without padding: 22 characters.
create or replace function public._referral_link_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

-- Is the public form on for this tenant? One definition for the RPCs below and
-- the public side (20261018000003).
create or replace function public._referral_form_open(p_org uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from organizations o
     where o.id = p_org and o.portal_enabled and o.public_form_enabled and not o.is_disabled
  )
$$;

-- The active link for (org, tenant) or (org, user), created when missing.
-- Serialized per link owner so two first calls cannot both insert.
create or replace function public._referral_form_link(p_org uuid, p_link_type text, p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('referral_form_link:' || p_org::text || ':' || coalesce(p_user::text, 'tenant'), 0));
  select l.token into v_token
    from referral_form_links l
   where l.org_id = p_org and l.link_type = p_link_type
     and l.user_id is not distinct from p_user and l.retired_at is null;
  if v_token is null then
    v_token := public._referral_link_token();
    insert into referral_form_links (org_id, link_type, user_id, token, created_by)
    values (p_org, p_link_type, p_user, v_token, auth.uid());
  end if;
  return v_token;
end $$;

-- 5. RPCs (authenticated) ------------------------------------------------------------------

-- The caller's personal link (FR-PORT-24). Every active user can own partners
-- (Bundle 2: partners_insert only checks the org), so every active user has one.
create or replace function public.get_my_referral_link()
returns table (link_token text, org_slug text, public_form_enabled boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
begin
  select o.* into v_org from organizations o where o.id = public.user_org_id();
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_form_open(v_org.id) then
    return query select null::text, v_org.slug, false;
    return;
  end if;
  return query select public._referral_form_link(v_org.id, 'user', auth.uid()), v_org.slug, true;
end $$;

-- The tenant link for websites and printed material (FR-PORT-26).
create or replace function public.get_tenant_referral_link()
returns table (link_token text, org_slug text, public_form_enabled boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
begin
  select o.* into v_org from organizations o where o.id = public.user_org_id();
  if v_org.id is null or not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_form_open(v_org.id) then
    return query select null::text, v_org.slug, false;
    return;
  end if;
  return query select public._referral_form_link(v_org.id, 'tenant', null), v_org.slug, true;
end $$;

-- Retire a link and issue a new one (FR-PORT-27). A user may regenerate their
-- own; an administrator may regenerate any user's link in the org and the
-- tenant link.
create or replace function public.regenerate_referral_link(p_link_type text, p_user_id uuid default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid    uuid := auth.uid();
  v_org    uuid := public.user_org_id();
  v_target uuid;
  v_token  text;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_link_type = 'tenant' then
    if p_user_id is not null or not public.caller_is_admin() then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_target := null;
  elsif p_link_type = 'user' then
    v_target := coalesce(p_user_id, v_uid);
    if v_target <> v_uid and not public.caller_is_admin() then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    if not exists (select 1 from profiles pr where pr.id = v_target and pr.org_id = v_org) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  else
    raise exception 'invalid_link_type' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('referral_form_link:' || v_org::text || ':' || coalesce(v_target::text, 'tenant'), 0));
  update referral_form_links l
     set retired_at = now()
   where l.org_id = v_org and l.link_type = p_link_type
     and l.user_id is not distinct from v_target and l.retired_at is null;
  v_token := public._referral_form_link(v_org, p_link_type, v_target);
  perform public._portal_audit(v_org, null, 'link_regenerate', null, v_uid);
  return v_token;
end $$;

-- 6. Privileges ------------------------------------------------------------------------------
revoke execute on function public.referral_route_user(uuid)                      from public, anon, authenticated;
revoke execute on function public._referral_link_token()                         from public, anon, authenticated, service_role;
revoke execute on function public._referral_form_open(uuid)                      from public, anon, authenticated, service_role;
revoke execute on function public._referral_form_link(uuid, text, uuid)          from public, anon, authenticated, service_role;

revoke execute on function public.get_my_referral_link()                         from public, anon;
revoke execute on function public.get_tenant_referral_link()                     from public, anon;
revoke execute on function public.regenerate_referral_link(text, uuid)           from public, anon;
grant  execute on function public.get_my_referral_link()                         to authenticated;
grant  execute on function public.get_tenant_referral_link()                     to authenticated;
grant  execute on function public.regenerate_referral_link(text, uuid)           to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `057_referral_form_links.sql` PASS, and every earlier test (`001` to `056`) still PASS (they exercise `referral_route_assignee` through `log_referral` and `portal_submit_referral`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261018000002_referral_form_links.sql supabase/tests/057_referral_form_links.sql
git commit -m "$(cat <<'EOF'
feat(portal): personal and company referral form links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Public form submissions (SQL)

**Files:**
- Create: `supabase/migrations/20261018000003_public_form_submissions.sql`
- Test: `supabase/tests/058_public_form_submissions.sql`

**Interfaces:**
- Consumes (SQL, Task 2): `referral_form_links`, `public.referral_route_user(uuid)`, `public._referral_form_open(uuid)`; existing `public._portal_consent_text(text)`, `public._portal_referral_ref(uuid)`, `public._portal_audit(...)`, `public.user_org_id()`, `public.caller_is_admin()`, `public.user_can_see_owner(uuid)`, `org_branding (org_id, logo_url, primary_color)`.
- Produces (SQL):
  - Table `referral_form_submissions (id, org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip, submitted_at, triaged_at, triaged_by, outcome, referral_id, deal_id, purged_at)`. Authenticated may SELECT every column except `submitter_ip`, through policy `referral_form_submissions_select` (assignee and everyone above them, or the administrator queue for administrators, same org).
  - `public._portal_public_link(p_slug text, p_token text) returns uuid`: private. The active link id, or null when the org is unknown, the portal or public form is off, the org is disabled, the token is unknown or retired, or a user link's user is not in that org.
  - `public.portal_public_form(p_slug text, p_token text) returns table (org_name text, rep_name text, consent_text text, consent_version integer)`: service role only. Zero rows when not available (generic).
  - `public.portal_public_submit(p_slug text, p_token text, p_company text, p_contact_name text, p_contact_email text, p_contact_phone text, p_notes text, p_referred_by text, p_referrer_email text, p_consent_version integer, p_ip text) returns table (id uuid, ref text, org_name text, logo_url text, primary_color text)`: service role only. Zero rows when not available. Errors `consent_changed`, `invalid_input:<field>` with field one of `companyName`, `contactName`, `email`, `phone`, `notes`, `referredBy`, `referrerEmail`, and `rate_limited` (30 per IP per hour across all orgs).
  - `public.portal_public_rate(p_ip text, p_window_minutes integer) returns integer`: service role only. Submissions from that IP across all orgs in the window; 0 for a blank IP.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/058_public_form_submissions.sql`:

```sql
-- Tests for 20261018000003_public_form_submissions (Partner Portal Phase 2B-1,
-- FR-PORT-25, 26, 29..31, 34).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/058_public_form_submissions.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-pub (portal on, public form on, consent v2 "I may share this."):
--   boss administrator; mia manager under boss; rita rep under mia; dee rep
--   under mia (deactivated); uma rep with no placement and no manager.
-- Org B pf-pub-b (portal on, public form off): bob administrator.
-- Org C pf-pub-c (portal off, public form on).
-- Links (org A unless noted): rita, dee, uma, tenant, a retired rita link, a
-- "foreign" user link pointing at bob (org B), org B tenant, org C tenant.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001058', 'Public Org',   'pf-pub',   'pf-pub-a1',   true,  'I may share this.', 2),
  ('00000000-0000-0000-0000-000000001158', 'Public Org B', 'pf-pub-b', 'pf-pub-b-a1', true,  null,                0),
  ('00000000-0000-0000-0000-000000001258', 'Public Org C', 'pf-pub-c', 'pf-pub-c-a1', false, null,                0);
update organizations set public_form_enabled = true
 where id in ('00000000-0000-0000-0000-000000001058', '00000000-0000-0000-0000-000000001258');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0580000-0000-0000-0000-000000000001', 'boss@pub.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000002', 'mia@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000003', 'rita@pub.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000004', 'dee@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000005', 'uma@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000006', 'bob@pubb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0580000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001058', 'admin',   'administrator',      'Boss',     'boss@pub.example', 'pubboss'::ltree,          null,                                   null),
  ('a0580000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001058', 'manager', 'sales_manager',      'Mia Mgr',  'mia@pub.example',  'pubboss.mia'::ltree,      'a0580000-0000-0000-0000-000000000001', null),
  ('a0580000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Rita Rep', 'rita@pub.example', 'pubboss.mia.rita'::ltree, 'a0580000-0000-0000-0000-000000000002', null),
  ('a0580000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Dee Rep',  'dee@pub.example',  'pubboss.mia.dee'::ltree,  'a0580000-0000-0000-0000-000000000002', now()),
  ('a0580000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Uma Rep',  'uma@pub.example',  null,                      null,                                   null),
  ('a0580000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001158', 'admin',   'administrator',      'Bob',      'bob@pubb.example', 'pubbob'::ltree,           null,                                   null);

insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
  ('a058c000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000003', 'ritaLinkToken0000001', null),
  ('a058c000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000004', 'deeLinkToken00000001', null),
  ('a058c000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000005', 'umaLinkToken00000001', null),
  ('a058c000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001058', 'tenant', null,                                   'tenantLinkToken00001', null),
  ('a058c000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000003', 'retiredLinkToken0001', now()),
  ('a058c000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000006', 'foreignLinkToken0001', null),
  ('a058c000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001158', 'tenant', null,                                   'orgBTenantToken00001', null),
  ('a058c000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000001258', 'tenant', null,                                   'orgCTenantToken00001', null);

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

-- The three named submissions this user can see, by company, comma-joined.
create or replace function _t_seen(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform _t_act(p_user);
  select string_agg(s.company_name, ',' order by s.company_name) into v
    from referral_form_submissions s
   where s.id in (current_setting('t.s_rita')::uuid, current_setting('t.s_mia')::uuid, current_setting('t.s_queue')::uuid);
  return coalesce(v, '');
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('service_role', 'public.portal_public_form(text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.portal_public_rate(text, integer)', 'EXECUTE') then
    raise exception 'service_role should execute the public form functions';
  end if;
  if has_function_privilege('authenticated', 'public.portal_public_form(text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_form(text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_public_rate(text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_rate(text, integer)', 'EXECUTE') then
    raise exception 'the public form functions are service role only';
  end if;
  if has_function_privilege('service_role', 'public._portal_public_link(text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._portal_public_link(text, text)', 'EXECUTE') then
    raise exception '_portal_public_link is private';
  end if;
  if not has_column_privilege('authenticated', 'public.referral_form_submissions', 'company_name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.referral_form_submissions', 'assigned_user_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.referral_form_submissions', 'submitter_ip', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'DELETE')
     or has_table_privilege('anon', 'public.referral_form_submissions', 'SELECT') then
    raise exception 'authenticated reads submissions (never the IP) and writes none; anon gets nothing';
  end if;
end $$;

-- 2. What the form shows, and the one generic "nothing" for every unavailable case.
do $$ declare v record; r record; n integer; begin
  select * into v from public.portal_public_form('  PF-PUB ', 'ritaLinkToken0000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is distinct from 'Rita Rep'
     or v.consent_text is distinct from 'I may share this.' or v.consent_version is distinct from 2 then
    raise exception 'rita''s link shows the org, her name and the consent line, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'tenantLinkToken00001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'the tenant link shows no rep name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'deeLinkToken00000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'a deactivated rep''s link works but shows no name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'umaLinkToken00000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'an unplaced rep''s link works but shows no name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub-b', 'orgBTenantToken00001');
  if v.org_name is not null then raise exception 'org B has the public form off'; end if;

  for r in select * from (values
      ('pf-pub'::text,   'retiredLinkToken0001'::text),
      ('pf-pub',         'noSuchLinkToken00001'),
      ('pf-pub-b',       'orgBTenantToken00001'),
      ('pf-pub-c',       'orgCTenantToken00001'),
      ('pf-pub',         'foreignLinkToken0001'),
      ('pf-pub-b',       'ritaLinkToken0000001'),
      ('pf-pub',         'RITALINKTOKEN0000001'),
      ('pf-pub',         null),
      (null,             'ritaLinkToken0000001')
    ) t(s, k) loop
    select count(*) into n from public.portal_public_form(r.s, r.k);
    if n <> 0 then raise exception 'expected nothing for % %', r.s, r.k; end if;
  end loop;
end $$;

-- 3. Submitting: what is stored and where it is routed.
do $$ declare v record; s referral_form_submissions; n integer; begin
  select * into v from public.portal_public_submit(
    'pf-pub', 'ritaLinkToken0000001', '  Fresh Bakery ', ' Ann Owner ', ' ANN@Bakery.Example ',
    '(555) 010-0100', ' Needs a new terminal. ', ' Joe at the bank ', ' Joe@Bank.Example ', 2, '198.51.100.1');
  if v.id is null or v.ref <> 'REF-' || upper(left(v.id::text, 8)) or v.org_name <> 'Public Org' then
    raise exception 'submit returns the id, the reference and the org name, got %', row_to_json(v);
  end if;
  select * into s from referral_form_submissions where id = v.id;
  if s.org_id <> '00000000-0000-0000-0000-000000001058'
     or s.assigned_user_id is distinct from 'a0580000-0000-0000-0000-000000000003'
     or s.link_type <> 'user' or s.form_link_id <> 'a058c000-0000-0000-0000-000000000001'
     or s.company_name <> 'Fresh Bakery' or s.contact_name <> 'Ann Owner'
     or s.contact_email <> 'ann@bakery.example' or s.contact_phone <> '(555) 010-0100'
     or s.notes <> 'Needs a new terminal.' or s.referred_by_text <> 'Joe at the bank'
     or s.referrer_email is distinct from 'joe@bank.example'
     or s.consent_version <> 2 or s.consent_text_snapshot <> 'I may share this.'
     or s.submitter_ip <> '198.51.100.1' or s.triaged_at is not null or s.outcome is not null then
    raise exception 'stored submission is wrong: %', row_to_json(s);
  end if;
  perform set_config('t.s_rita', v.id::text, true);
  if not exists (select 1 from portal_audit_log a
                  where a.org_id = '00000000-0000-0000-0000-000000001058' and a.action = 'public_submit'
                    and a.ip = '198.51.100.1' and a.portal_user_id is null and a.actor_user_id is null) then
    raise exception 'a public submission is audited with its IP';
  end if;

  select * into v from public.portal_public_submit(
    'pf-pub', 'deeLinkToken00000001', 'Corner Cafe', 'Cal', 'cal@cafe.example', '555 010 0101', 'Wants a quote.', '  ', null, 2, '198.51.100.2');
  select * into s from referral_form_submissions where id = v.id;
  if s.assigned_user_id is distinct from 'a0580000-0000-0000-0000-000000000002' or s.referred_by_text is not null
     or s.referrer_email is not null then
    raise exception 'a deactivated rep''s link routes to their manager; blank "who referred" and no referrer email are null';
  end if;
  perform set_config('t.s_mia', v.id::text, true);

  select * into v from public.portal_public_submit(
    'pf-pub', 'umaLinkToken00000001', 'Uma Co', 'Una', 'una@uma.example', '555 010 0102', 'Call after 3.', null, null, 2, '198.51.100.3');
  if (select assigned_user_id from referral_form_submissions where id = v.id) is not null then
    raise exception 'an unplaced rep with no manager routes to the administrator queue';
  end if;

  select * into v from public.portal_public_submit(
    'pf-pub', 'tenantLinkToken00001', 'Tenant Co', 'Tia', 'tia@tenant.example', '555 010 0103', 'Saw the website.', null, null, 2, '198.51.100.4');
  select * into s from referral_form_submissions where id = v.id;
  if s.assigned_user_id is not null or s.link_type <> 'tenant' then
    raise exception 'the tenant link goes to the administrator queue';
  end if;
  perform set_config('t.s_queue', v.id::text, true);

  select count(*) into n from referral_form_submissions;
  if (select count(*) from public.portal_public_submit(
        'pf-pub', 'retiredLinkToken0001', 'Ghost Co', 'G', 'g@ghost.example', '555 010 0104', 'n', null, null, 2, '198.51.100.5')) <> 0
     or (select count(*) from public.portal_public_submit(
        'pf-pub-b', 'orgBTenantToken00001', 'Ghost Co', 'G', 'g@ghost.example', '555 010 0104', 'n', null, null, 0, '198.51.100.5')) <> 0 then
    raise exception 'an unavailable link answers with nothing';
  end if;
  if (select count(*) from referral_form_submissions) <> n then
    raise exception 'an unavailable link writes nothing';
  end if;
end $$;

-- 4. Field rules and the consent version.
do $$ begin
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','  ','Ann','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:companyName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001',repeat('x',161),'Ann','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:companyName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:contactName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','nope','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:email');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann',null,'5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:email');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','555-01',  'Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:phone');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example',null,'Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:phone');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','  ',null,null,2,'198.51.100.9')$q$, 'invalid_input:notes');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100',repeat('n',4001),null,null,2,'198.51.100.9')$q$, 'invalid_input:notes');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',repeat('r',161),null,2,'198.51.100.9')$q$, 'invalid_input:referredBy');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,'not-an-email',2,'198.51.100.9')$q$, 'invalid_input:referrerEmail');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,repeat('e',250) || '@b.co',2,'198.51.100.9')$q$, 'invalid_input:referrerEmail');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,null,1,'198.51.100.9')$q$, 'consent_changed');
end $$;

-- 5. The per-IP count spans every org and only the window.
do $$ begin
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at) values
    ('00000000-0000-0000-0000-000000001158', 'a058c000-0000-0000-0000-000000000007', 'tenant', 'Rate Co 1', 'R', 'r@x.example', '5550100100', 'n', 0, 'c', '192.0.2.50', now() - interval '10 minutes'),
    ('00000000-0000-0000-0000-000000001058', 'a058c000-0000-0000-0000-000000000004', 'tenant', 'Rate Co 2', 'R', 'r@x.example', '5550100100', 'n', 2, 'c', '192.0.2.50', now() - interval '20 minutes'),
    ('00000000-0000-0000-0000-000000001058', 'a058c000-0000-0000-0000-000000000004', 'tenant', 'Rate Co 3', 'R', 'r@x.example', '5550100100', 'n', 2, 'c', '192.0.2.50', now() - interval '2 hours');
  if public.portal_public_rate('192.0.2.50', 60) <> 2 then
    raise exception 'the last hour counts across orgs, got %', public.portal_public_rate('192.0.2.50', 60);
  end if;
  if public.portal_public_rate('192.0.2.50', 180) <> 3 then
    raise exception 'a wider window counts more';
  end if;
  if public.portal_public_rate('192.0.2.51', 60) <> 0
     or public.portal_public_rate(null, 60) <> 0
     or public.portal_public_rate('  ', 60) <> 0 then
    raise exception 'an unseen or blank IP counts zero';
  end if;
end $$;

-- 6. The hard limit: 30 per IP per hour, whatever the edge decided.
do $$ begin
  for i in 1..30 loop
    perform public.portal_public_submit('pf-pub', 'tenantLinkToken00001', 'Cap Co ' || i, 'Cap', 'cap@cap.example',
                                        '555 010 0110', 'Needs a terminal.', null, null, 2, '203.0.113.30');
  end loop;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Cap Co 31','Cap','cap@cap.example','555 010 0110','Needs a terminal.',null,null,2,'203.0.113.30')$q$, 'rate_limited');
  if (select count(*) from public.portal_public_submit('pf-pub', 'tenantLinkToken00001', 'Other IP Co', 'Oz', 'oz@other.example',
                                                       '555 010 0111', 'Fine.', null, null, 2, '203.0.113.31')) <> 1 then
    raise exception 'another IP is not limited';
  end if;
end $$;

-- 7. Who can read a submission (role switches from here on).
do $$ declare v text; begin
  v := _t_seen('a0580000-0000-0000-0000-000000000003');
  if v <> 'Fresh Bakery' then raise exception 'rita sees only her own, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000002');
  if v <> 'Corner Cafe,Fresh Bakery' then raise exception 'mia sees hers and her rep''s, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000001');
  if v <> 'Corner Cafe,Fresh Bakery,Tenant Co' then raise exception 'an administrator sees everything including the queue, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000005');
  if v <> '' then raise exception 'an unplaced rep sees nobody else''s, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000006');
  if v <> '' then raise exception 'another org sees nothing, got %', v; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/tests/058_public_form_submissions.sql`
Expected: FAIL in block 1 with `function public.portal_public_form(text, text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261018000003_public_form_submissions.sql`:

```sql
-- 20261018000003_public_form_submissions.sql
--
-- Partner Portal Phase 2B-1 (PRD FR-PORT-25, 26, 29..31, 33, 34). Public
-- referral form submissions are stored here, NOT in referrals: a referral
-- always has a partner (partner_id not null, the org trigger and RLS all
-- assume one). Phase 2B-2 triages a submission (attribution, then accept,
-- decline or merge) and fills triaged_*, outcome, referral_id or deal_id.
--
-- No duplicate check of any kind happens here (FR-PORT-34): nothing a public
-- caller gets back depends on what the tenant already has.
--
-- Service role only (portal_api): portal_public_form, portal_public_submit,
-- portal_public_rate. Internal users read through RLS (2B-2 builds the queue).

-- 1. Submissions -----------------------------------------------------------------
create table referral_form_submissions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  -- Null only after a deleted account cascaded its links away; link_type keeps
  -- which kind of link it came through.
  form_link_id          uuid references referral_form_links(id) on delete set null,
  link_type             text not null check (link_type in ('tenant','user')),
  assigned_user_id      uuid references profiles(id) on delete set null,
  company_name          text not null check (char_length(company_name) between 1 and 160),
  -- Required at intake (portal_public_submit); nullable so the 2B-2 purge can erase them.
  contact_name          text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email         text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone         text check (contact_phone is null or char_length(contact_phone) <= 40),
  notes                 text check (notes is null or char_length(notes) <= 4000),
  referred_by_text      text check (referred_by_text is null or char_length(referred_by_text) <= 160),
  -- Optional: the sender's own email, the only address the confirmation goes to
  -- (FR-PORT-33). Personal data: the 2B-2 purge erases it with the contact fields.
  referrer_email        text check (referrer_email is null or char_length(referrer_email) <= 254),
  -- NFR-PORT-07: the consent wording and version the submitter agreed to.
  consent_version       integer not null,
  consent_text_snapshot text,
  submitter_ip          text check (submitter_ip is null or char_length(submitter_ip) <= 64),
  submitted_at          timestamptz not null default now(),
  triaged_at            timestamptz,
  triaged_by            uuid references profiles(id) on delete set null,
  outcome               text check (outcome is null or outcome in ('accepted','declined','merged')),
  referral_id           uuid references referrals(id) on delete set null,
  deal_id               uuid references deals(id) on delete set null,
  purged_at             timestamptz
);
create index referral_form_submissions_org_idx
  on referral_form_submissions (org_id, submitted_at desc);
create index referral_form_submissions_open_idx
  on referral_form_submissions (org_id, assigned_user_id) where triaged_at is null;
-- portal_public_rate and the hard limit in portal_public_submit (FR-PORT-30).
create index referral_form_submissions_ip_idx
  on referral_form_submissions (submitter_ip, submitted_at) where submitter_ip is not null;

alter table referral_form_submissions enable row level security;
revoke all on referral_form_submissions from anon, authenticated;
-- Everything but the submitter's IP address.
grant select (
  id, org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name,
  contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot,
  submitted_at, triaged_at, triaged_by, outcome, referral_id, deal_id, purged_at
) on referral_form_submissions to authenticated;

-- The referral triage rule (can_triage_referral, 20261007000001) inlined:
-- the assignee and everyone above them, or the administrator queue for
-- administrators. can_triage_referral itself is not executable by authenticated.
create policy referral_form_submissions_select on referral_form_submissions for select to authenticated using (
  org_id = public.user_org_id()
  and (
    (assigned_user_id is null and public.caller_is_admin())
    or (assigned_user_id is not null and public.user_can_see_owner(assigned_user_id))
  )
);

-- 2. Which link is this? ----------------------------------------------------------------
-- One answer for every "not available" case (unknown org, portal or public form
-- off, disabled org, unknown or retired token, a user link whose user is not in
-- the org), so a caller cannot tell them apart. Tokens are case-sensitive.
create or replace function public._portal_public_link(p_slug text, p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select l.id
    from referral_form_links l
    join organizations o on o.id = l.org_id
    left join profiles pr on pr.id = l.user_id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and l.token = btrim(coalesce(p_token, ''))
     and l.retired_at is null
     and public._referral_form_open(o.id)
     and (l.link_type = 'tenant' or pr.org_id = l.org_id)
$$;

-- 3. What the form shows (FR-PORT-25) ---------------------------------------------------
-- The rep's name only when the link routes to that rep; a deactivated or
-- unplaced rep's link still works but routes to the manager or the queue.
create or replace function public.portal_public_form(p_slug text, p_token text)
returns table (org_name text, rep_name text, consent_text text, consent_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select o.name,
         case when l.link_type = 'user' and public.referral_route_user(l.user_id) = l.user_id
              then nullif(btrim(coalesce(pr.full_name, '')), '') end,
         public._portal_consent_text(o.consent_text),
         o.consent_version
    from referral_form_links l
    join organizations o on o.id = l.org_id
    left join profiles pr on pr.id = l.user_id
   where l.id = public._portal_public_link(p_slug, p_token)
$$;

-- 4. Per-IP count across every tenant (FR-PORT-30) --------------------------------------
create or replace function public.portal_public_rate(p_ip text, p_window_minutes integer)
returns integer language sql stable security definer set search_path = public, extensions as $$
  select case
    when nullif(btrim(coalesce(p_ip, '')), '') is null then 0
    else (select count(*)::integer
            from referral_form_submissions s
           where s.submitter_ip = btrim(p_ip)
             and s.submitted_at > now() - make_interval(mins => greatest(coalesce(p_window_minutes, 60), 1)))
  end
$$;

-- 5. Store a submission (FR-PORT-25, 26, 29, 31) ------------------------------------------
-- Zero rows when the link is not available. Field rules mirror
-- _shared/portalPublicForm.ts. The hard limit of 30 per IP per hour is checked
-- here, serialized per IP, so parallel posts cannot race past it.
create or replace function public.portal_public_submit(
  p_slug            text,
  p_token           text,
  p_company         text,
  p_contact_name    text,
  p_contact_email   text,
  p_contact_phone   text,
  p_notes           text,
  p_referred_by     text,
  p_referrer_email  text,
  p_consent_version integer,
  p_ip              text
)
returns table (id uuid, ref text, org_name text, logo_url text, primary_color text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_link    referral_form_links;
  v_org     organizations;
  v_company text := btrim(coalesce(p_company, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_email   text := lower(btrim(coalesce(p_contact_email, '')));
  v_phone   text := btrim(coalesce(p_contact_phone, ''));
  v_notes   text := btrim(coalesce(p_notes, ''));
  v_by      text := nullif(btrim(coalesce(p_referred_by, '')), '');
  v_ref_em  text := nullif(lower(btrim(coalesce(p_referrer_email, ''))), '');
  v_ip      text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
  v_id      uuid;
begin
  select l.* into v_link from referral_form_links l where l.id = public._portal_public_link(p_slug, p_token);
  if v_link.id is null then
    return;
  end if;
  select o.* into v_org from organizations o where o.id = v_link.org_id;

  if p_consent_version is distinct from v_org.consent_version then
    raise exception 'consent_changed' using errcode = 'P0001';
  end if;
  if v_company = '' or length(v_company) > 160 then
    raise exception 'invalid_input:companyName' using errcode = '22023';
  end if;
  if v_contact = '' or length(v_contact) > 120 then
    raise exception 'invalid_input:contactName' using errcode = '22023';
  end if;
  if v_email = '' or length(v_email) > 254 or position('@' in v_email) < 2 then
    raise exception 'invalid_input:email' using errcode = '22023';
  end if;
  if v_phone = '' or length(v_phone) > 40 or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;
  if v_notes = '' or length(v_notes) > 4000 then
    raise exception 'invalid_input:notes' using errcode = '22023';
  end if;
  if v_by is not null and length(v_by) > 160 then
    raise exception 'invalid_input:referredBy' using errcode = '22023';
  end if;
  if v_ref_em is not null and (length(v_ref_em) > 254 or position('@' in v_ref_em) < 2) then
    raise exception 'invalid_input:referrerEmail' using errcode = '22023';
  end if;

  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_public_ip:' || v_ip, 0));
    if (select count(*) from referral_form_submissions s
         where s.submitter_ip = v_ip and s.submitted_at > now() - interval '1 hour') >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  insert into referral_form_submissions (
    org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name,
    contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version,
    consent_text_snapshot, submitter_ip
  ) values (
    v_org.id, v_link.id, v_link.link_type,
    case when v_link.link_type = 'user' then public.referral_route_user(v_link.user_id) end,
    v_company, v_contact, v_email, v_phone, v_notes, v_by, v_ref_em, v_org.consent_version,
    public._portal_consent_text(v_org.consent_text), v_ip
  ) returning referral_form_submissions.id into v_id;

  perform public._portal_audit(v_org.id, null, 'public_submit', v_ip, null);

  return query
    select v_id, public._portal_referral_ref(v_id), o.name, b.logo_url, b.primary_color
      from organizations o
      left join org_branding b on b.org_id = o.id
     where o.id = v_org.id;
end $$;

-- 6. Privileges ----------------------------------------------------------------------------
revoke execute on function public._portal_public_link(text, text) from public, anon, authenticated, service_role;

revoke execute on function public.portal_public_form(text, text) from public, anon, authenticated;
revoke execute on function public.portal_public_rate(text, integer) from public, anon, authenticated;
revoke execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.portal_public_form(text, text) to service_role;
grant  execute on function public.portal_public_rate(text, integer) to service_role;
grant  execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text) to service_role;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `057` and `058` PASS; `001` to `056` still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261018000003_public_form_submissions.sql supabase/tests/058_public_form_submissions.sql
git commit -m "$(cat <<'EOF'
feat(portal): store public referral form submissions with routing and limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: Public form rules: validation, form token, Turnstile check (pure TS)

**Files:**
- Create: `supabase/functions/_shared/portalPublicForm.ts`
- Test: `supabase/functions/_shared/portalPublicForm.test.ts`
- Modify: `apps/app/tsconfig.app.json`

**Interfaces:**
- Consumes: `PORTAL_FIELD_LIMITS` from `_shared/portalSubmission.ts`; `timingSafeEquals(a: string, b: string): boolean` from `_shared/cronAuth.ts`.
- Produces (TS, `_shared/portalPublicForm.ts`):
  - `export const PUBLIC_FORM_LIMITS: { companyName: 160; contactName: 120; email: 254; phone: 40; notes: 4000; referredBy: 160; referrerEmail: 254; formToken: 128; captchaToken: 2048 }`
  - `export const PUBLIC_FORM_MIN_AGE_MS = 3000`, `PUBLIC_FORM_MAX_AGE_MS = 86400000`, `PUBLIC_SOFT_LIMIT_PER_HOUR = 5`, `PUBLIC_HARD_LIMIT_PER_HOUR = 30`, `PUBLIC_HONEYPOT_FIELD = "website"`
  - `export type PublicFormField = "companyName" | "contactName" | "email" | "phone" | "notes" | "referredBy" | "referrerEmail" | "consent"`
  - `export const PUBLIC_FORM_FIELDS: readonly PublicFormField[]`, `export function isPublicFormField(value: unknown): value is PublicFormField`
  - `export interface PublicSubmission { companyName: string; contactName: string; email: string; phone: string; notes: string; referredBy: string | null; referrerEmail: string | null; consentVersion: number }`
  - `export type PublicSubmissionCheck = { ok: true; value: PublicSubmission } | { ok: false; field: PublicFormField }`
  - `export function validatePublicSubmission(input: Readonly<Record<string, unknown>>): PublicSubmissionCheck`
  - `export interface PortalPublicForm { orgName: string; repName: string | null; consentText: string; consentVersion: number; formToken: string }`
  - `export type PortalPublicSubmitInput = { companyName: string; contactName: string; email: string; phone: string; notes: string; referredBy: string; referrerEmail: string; consent: boolean; consentVersion: number; formToken: string; website: string; captchaToken?: string }`
  - `export interface PortalPublicSubmitted { ref: string }`
  - `export function signFormToken(secret: string, slug: string, token: string, issuedAtMs: number): Promise<string>` (format `<issuedAtMs>.<64 hex>`)
  - `export type FormTokenCheck = "ok" | "too_fast" | "invalid"`
  - `export function checkFormToken(secret: string, slug: string, token: string, formToken: string, nowMs: number): Promise<FormTokenCheck>`
  - `export function fakeRef(): string` (`REF-` and 8 uppercase hex)
  - `export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"`
  - `export type FetchLike = (input: string, init: RequestInit) => Promise<Response>`
  - `export function verifyTurnstile(fetchFn: FetchLike | undefined, secret: string | null | undefined, captchaToken: string, ip: string | null): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/portalPublicForm.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  PUBLIC_FORM_FIELDS,
  PUBLIC_FORM_LIMITS,
  PUBLIC_FORM_MAX_AGE_MS,
  PUBLIC_FORM_MIN_AGE_MS,
  TURNSTILE_VERIFY_URL,
  checkFormToken,
  fakeRef,
  isPublicFormField,
  signFormToken,
  validatePublicSubmission,
  verifyTurnstile,
} from "./portalPublicForm";

const GOOD = {
  companyName: "  Fresh Bakery ",
  contactName: " Ann Owner ",
  email: " ANN@Bakery.Example ",
  phone: " (555) 010-0100 ",
  notes: " Needs a new terminal. ",
  referredBy: " Joe at the bank ",
  referrerEmail: " Joe@Bank.Example ",
  consent: true,
  consentVersion: 2,
};

describe("validatePublicSubmission", () => {
  it("trims every field, lowercases the email and keeps who referred", () => {
    expect(validatePublicSubmission(GOOD)).toEqual({
      ok: true,
      value: {
        companyName: "Fresh Bakery",
        contactName: "Ann Owner",
        email: "ann@bakery.example",
        phone: "(555) 010-0100",
        notes: "Needs a new terminal.",
        referredBy: "Joe at the bank",
        referrerEmail: "joe@bank.example",
        consentVersion: 2,
      },
    });
  });

  it("turns a blank or missing 'who referred' into null", () => {
    const blank = validatePublicSubmission({ ...GOOD, referredBy: "   " });
    expect(blank.ok && blank.value.referredBy).toBeNull();
    const { referredBy: _omit, ...rest } = GOOD;
    const missing = validatePublicSubmission(rest);
    expect(missing.ok && missing.value.referredBy).toBeNull();
  });

  it("turns a blank or missing referrer email into null (no confirmation email)", () => {
    const blank = validatePublicSubmission({ ...GOOD, referrerEmail: "  " });
    expect(blank.ok && blank.value.referrerEmail).toBeNull();
    const { referrerEmail: _omit, ...rest } = GOOD;
    const missing = validatePublicSubmission(rest);
    expect(missing.ok && missing.value.referrerEmail).toBeNull();
  });

  it.each([
    ["companyName", { companyName: "  " }],
    ["companyName", { companyName: "x".repeat(PUBLIC_FORM_LIMITS.companyName + 1) }],
    ["contactName", { contactName: "" }],
    ["contactName", { contactName: "x".repeat(PUBLIC_FORM_LIMITS.contactName + 1) }],
    ["email", { email: "" }],
    ["email", { email: "nope" }],
    ["email", { email: `${"a".repeat(250)}@b.co` }],
    ["phone", { phone: "" }],
    ["phone", { phone: "555-01" }],
    ["phone", { phone: "5".repeat(PUBLIC_FORM_LIMITS.phone + 1) }],
    ["notes", { notes: "  " }],
    ["notes", { notes: "n".repeat(PUBLIC_FORM_LIMITS.notes + 1) }],
    ["referredBy", { referredBy: "r".repeat(PUBLIC_FORM_LIMITS.referredBy + 1) }],
    ["referrerEmail", { referrerEmail: "not-an-email" }],
    ["referrerEmail", { referrerEmail: `${"a".repeat(250)}@b.co` }],
    ["referrerEmail", { referrerEmail: 42 }],
    ["consent", { consent: false }],
    ["consent", { consent: "true" }],
    ["consent", { consentVersion: "2" }],
    ["consent", { consentVersion: 1.5 }],
  ])("points at %s", (field, patch) => {
    expect(validatePublicSubmission({ ...GOOD, ...patch })).toEqual({ ok: false, field });
  });

  it("accepts every field at its cap", () => {
    const atCap = validatePublicSubmission({
      ...GOOD,
      companyName: "c".repeat(PUBLIC_FORM_LIMITS.companyName),
      contactName: "n".repeat(PUBLIC_FORM_LIMITS.contactName),
      phone: "5".repeat(PUBLIC_FORM_LIMITS.phone),
      notes: "x".repeat(PUBLIC_FORM_LIMITS.notes),
      referredBy: "r".repeat(PUBLIC_FORM_LIMITS.referredBy),
    });
    expect(atCap.ok).toBe(true);
  });

  it("treats an empty body as a missing company", () => {
    expect(validatePublicSubmission({})).toEqual({ ok: false, field: "companyName" });
  });

  it("knows its own field names and nothing else", () => {
    for (const f of PUBLIC_FORM_FIELDS) expect(isPublicFormField(f)).toBe(true);
    expect(isPublicFormField("address")).toBe(false);
    expect(isPublicFormField(7)).toBe(false);
  });
});

describe("form token", () => {
  const SECRET = "test-signing-secret";
  const ISSUED = Date.parse("2026-10-18T12:00:00Z");

  it("signs the issue time and accepts the token once it is old enough", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(t).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(t.startsWith(`${ISSUED}.`)).toBe(true);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MIN_AGE_MS)).toBe("ok");
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MAX_AGE_MS)).toBe("ok");
  });

  it("calls a token younger than 3 seconds, or from the future, too fast", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MIN_AGE_MS - 1)).toBe("too_fast");
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED - 60_000)).toBe("too_fast");
  });

  it("rejects an expired, forged, moved or malformed token", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MAX_AGE_MS + 1)).toBe("invalid");
    expect(await checkFormToken("other-secret", "acme", "tok123", t, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "other", "tok123", t, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "acme", "tok999", t, ISSUED + 10_000)).toBe("invalid");
    const earlier = `${ISSUED - 10_000}.${t.split(".")[1]}`;
    expect(await checkFormToken(SECRET, "acme", "tok123", earlier, ISSUED + 10_000)).toBe("invalid");
    for (const bad of ["", "abc", `${ISSUED}.`, `${ISSUED}.zz`, `x.${"0".repeat(64)}`]) {
      expect(await checkFormToken(SECRET, "acme", "tok123", bad, ISSUED + 10_000)).toBe("invalid");
    }
  });
});

describe("fakeRef", () => {
  it("looks exactly like a real reference and is random", () => {
    const a = fakeRef();
    const b = fakeRef();
    expect(a).toMatch(/^REF-[0-9A-F]{8}$/);
    expect(b).toMatch(/^REF-[0-9A-F]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe("verifyTurnstile", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("posts the secret, the token and the IP and trusts only success: true", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok({ success: true }));
    expect(await verifyTurnstile(fetchFn, "sek", "tt-1", "203.0.113.5")).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("secret")).toBe("sek");
    expect(form.get("response")).toBe("tt-1");
    expect(form.get("remoteip")).toBe("203.0.113.5");
  });

  it("leaves the IP out when there is none", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok({ success: true }));
    await verifyTurnstile(fetchFn, "sek", "tt-1", null);
    expect(new URLSearchParams(String(fetchFn.mock.calls[0][1].body)).has("remoteip")).toBe(false);
  });

  it("fails closed without a secret, a token or a fetch, and never calls out", async () => {
    const fetchFn = vi.fn(async () => ok({ success: true }));
    expect(await verifyTurnstile(fetchFn, "", "tt-1", null)).toBe(false);
    expect(await verifyTurnstile(fetchFn, null, "tt-1", null)).toBe(false);
    expect(await verifyTurnstile(fetchFn, "sek", "", null)).toBe(false);
    expect(await verifyTurnstile(undefined, "sek", "tt-1", null)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails on success: false, a non-2xx answer, bad JSON or a network error", async () => {
    expect(await verifyTurnstile(async () => ok({ success: false }), "sek", "tt", null)).toBe(false);
    expect(await verifyTurnstile(async () => ok({ success: true }, 500), "sek", "tt", null)).toBe(false);
    expect(await verifyTurnstile(async () => new Response("not json"), "sek", "tt", null)).toBe(false);
    expect(
      await verifyTurnstile(async () => {
        throw new Error("offline");
      }, "sek", "tt", null),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalPublicForm.test.ts`
Expected: FAIL with `Failed to resolve import "./portalPublicForm"`.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/portalPublicForm.ts`:

```ts
/**
 * Public referral form (Partner Portal Phase 2B-1, PRD FR-PORT-24..34).
 *
 * Anyone holding a rep's or the ISO's form link can send a business with no
 * sign-in. Bot mitigation (FR-PORT-30) is invisible to people:
 *   - a hidden "website" field that only bots fill (the honeypot);
 *   - a signed form token: an HMAC over the slug, the link token and the issue
 *     time, so the server can tell how long the form was open without storing
 *     anything, and a post under 3 seconds is treated as a bot;
 *   - a per-IP count across every tenant: past 5 an hour the caller must pass
 *     Cloudflare Turnstile, and past 30 nothing goes through.
 * A too-fast post or a filled honeypot gets a response identical to success
 * with a random reference, so a bot learns nothing.
 *
 * Pure TS, no Deno globals at module scope: vitest covers it. Web Crypto
 * (globalThis.crypto) exists in both Deno and Node.
 */
import { timingSafeEquals } from "./cronAuth.ts";
import { PORTAL_FIELD_LIMITS } from "./portalSubmission.ts";

export const PUBLIC_FORM_LIMITS = {
  companyName: PORTAL_FIELD_LIMITS.companyName,
  contactName: PORTAL_FIELD_LIMITS.contactName,
  email: PORTAL_FIELD_LIMITS.email,
  phone: PORTAL_FIELD_LIMITS.phone,
  notes: PORTAL_FIELD_LIMITS.notes,
  referredBy: 160,
  referrerEmail: PORTAL_FIELD_LIMITS.email,
  formToken: 128,
  captchaToken: 2048,
} as const;

/** Minimum time-to-submit (FR-PORT-30). */
export const PUBLIC_FORM_MIN_AGE_MS = 3_000;
/** A form left open longer than this must be reloaded. */
export const PUBLIC_FORM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Per IP per hour, across every tenant. Past the soft limit Turnstile is required. */
export const PUBLIC_SOFT_LIMIT_PER_HOUR = 5;
/** Per IP per hour, even with Turnstile. portal_public_submit enforces it again in SQL. */
export const PUBLIC_HARD_LIMIT_PER_HOUR = 30;
/** The honeypot: a field people never see and bots fill. */
export const PUBLIC_HONEYPOT_FIELD = "website";

export type PublicFormField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "notes"
  | "referredBy"
  | "referrerEmail"
  | "consent";

export const PUBLIC_FORM_FIELDS: readonly PublicFormField[] = [
  "companyName",
  "contactName",
  "email",
  "phone",
  "notes",
  "referredBy",
  "referrerEmail",
  "consent",
];

export function isPublicFormField(value: unknown): value is PublicFormField {
  return typeof value === "string" && (PUBLIC_FORM_FIELDS as readonly string[]).includes(value);
}

export interface PublicSubmission {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string | null;
  /** The sender's own email: the only address the confirmation goes to (FR-PORT-33). */
  referrerEmail: string | null;
  consentVersion: number;
}

export type PublicSubmissionCheck = { ok: true; value: PublicSubmission } | { ok: false; field: PublicFormField };

/** What public_form answers. Brand comes from portal_brand, which the page already loaded. */
export interface PortalPublicForm {
  orgName: string;
  /** The rep the link routes to, or null (tenant link, or a rep who no longer takes referrals). */
  repName: string | null;
  consentText: string;
  consentVersion: number;
  /** Echo back on public_submit. Opaque to the browser. */
  formToken: string;
}

/** The browser's public_submit body (besides slug and token). A type alias so it is a Record. */
export type PortalPublicSubmitInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string;
  /** Optional "Your email": "" for none. */
  referrerEmail: string;
  consent: boolean;
  consentVersion: number;
  formToken: string;
  /** The honeypot. Always "" from a person. */
  website: string;
  captchaToken?: string;
};

export interface PortalPublicSubmitted {
  ref: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Required: company, contact name, email, phone, notes (FR-PORT-29). Optional: who referred, the sender's own email. */
export function validatePublicSubmission(input: Readonly<Record<string, unknown>>): PublicSubmissionCheck {
  const text = (key: string): string => {
    const v = input[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const fail = (field: PublicFormField): PublicSubmissionCheck => ({ ok: false, field });

  const companyName = text("companyName");
  if (!companyName || companyName.length > PUBLIC_FORM_LIMITS.companyName) return fail("companyName");
  const contactName = text("contactName");
  if (!contactName || contactName.length > PUBLIC_FORM_LIMITS.contactName) return fail("contactName");
  const email = text("email").toLowerCase();
  if (!email || email.length > PUBLIC_FORM_LIMITS.email || !EMAIL_RE.test(email)) return fail("email");
  const phone = text("phone");
  if (!phone || phone.length > PUBLIC_FORM_LIMITS.phone || phone.replace(/\D/g, "").length < 7) return fail("phone");
  const notes = text("notes");
  if (!notes || notes.length > PUBLIC_FORM_LIMITS.notes) return fail("notes");
  const referredBy = text("referredBy");
  if (referredBy.length > PUBLIC_FORM_LIMITS.referredBy) return fail("referredBy");
  const rawReferrer = input.referrerEmail;
  if (rawReferrer !== undefined && rawReferrer !== null && typeof rawReferrer !== "string") return fail("referrerEmail");
  const referrerEmail = text("referrerEmail").toLowerCase();
  if (referrerEmail && (referrerEmail.length > PUBLIC_FORM_LIMITS.referrerEmail || !EMAIL_RE.test(referrerEmail))) {
    return fail("referrerEmail");
  }

  if (input.consent !== true) return fail("consent");
  const consentVersion = input.consentVersion;
  if (typeof consentVersion !== "number" || !Number.isInteger(consentVersion)) return fail("consent");

  return {
    ok: true,
    value: {
      companyName,
      contactName,
      email,
      phone,
      notes,
      referredBy: referredBy || null,
      referrerEmail: referrerEmail || null,
      consentVersion,
    },
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

/** `<issuedAtMs>.<hex HMAC-SHA256 of "slug.token.issuedAtMs">`. */
export async function signFormToken(secret: string, slug: string, token: string, issuedAtMs: number): Promise<string> {
  return `${issuedAtMs}.${await hmacSha256Hex(secret, `${slug}.${token}.${issuedAtMs}`)}`;
}

export type FormTokenCheck = "ok" | "too_fast" | "invalid";

/**
 * "invalid": missing, malformed, forged, for another link, or older than 24
 * hours (the caller answers form_expired). "too_fast": genuine but younger
 * than 3 seconds, or issued in the future (the caller answers a fake success).
 */
export async function checkFormToken(
  secret: string,
  slug: string,
  token: string,
  formToken: string,
  nowMs: number,
): Promise<FormTokenCheck> {
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(formToken);
  if (!m) return "invalid";
  const issuedAt = Number(m[1]);
  const expected = await hmacSha256Hex(secret, `${slug}.${token}.${issuedAt}`);
  if (!timingSafeEquals(expected, m[2])) return "invalid";
  const age = nowMs - issuedAt;
  if (age > PUBLIC_FORM_MAX_AGE_MS) return "invalid";
  if (age < PUBLIC_FORM_MIN_AGE_MS) return "too_fast";
  return "ok";
}

/** Same shape as _portal_referral_ref: REF- and 8 uppercase hex digits. */
export function fakeRef(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return `REF-${hex(bytes).toUpperCase()}`;
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Cloudflare Turnstile siteverify. Never throws; anything but success: true is false. */
export async function verifyTurnstile(
  fetchFn: FetchLike | undefined,
  secret: string | null | undefined,
  captchaToken: string,
  ip: string | null,
): Promise<boolean> {
  if (!fetchFn || !secret || !captchaToken) return false;
  try {
    const form = new URLSearchParams({ secret, response: captchaToken });
    if (ip) form.set("remoteip", ip);
    const res = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
```

In `apps/app/tsconfig.app.json`, add the new module to `include`, right after the `portalProfile.ts` line:

```json
    "../../supabase/functions/_shared/portalProfile.ts",
    "../../supabase/functions/_shared/portalPublicForm.ts",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalPublicForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portalPublicForm.ts supabase/functions/_shared/portalPublicForm.test.ts apps/app/tsconfig.app.json
git commit -m "$(cat <<'EOF'
feat(portal): public form validation, signed form token and Turnstile check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: A confirmation email with no button

**Files:**
- Modify: `supabase/functions/_shared/emailTemplate.ts`
- Test: `supabase/functions/_shared/emailTemplate.test.ts`
- Modify: `supabase/functions/_shared/portalEmail.ts`
- Test: `supabase/functions/_shared/portalEmail.test.ts`

**Interfaces:**
- Consumes: `renderEmail`, `EmailOptions`, `POWERED_BY` (`emailTemplate.ts`); `PortalEmail` (`portalEmail.ts`).
- Produces (TS):
  - `EmailOptions.ctaLabel` and `EmailOptions.ctaUrl` become optional. With both set, `renderEmail` output is byte-identical to before (the `__snapshots__` files do not change). With either missing, there is no button row, no "Button not working?" fallback and no text-version link line.
  - `export function portalPublicConfirmationEmail(args: { orgName: string; ref: string }): PortalEmail` in `portalEmail.ts`: subject `${orgName} received your referral`, the reference, no button, no submitter-typed text.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/emailTemplate.test.ts` (inside the file, after the existing `describe("renderEmail", ...)` block; `base` there is local, so this block defines its own):

```ts
describe("renderEmail without a button", () => {
  const noButton = {
    preheader: "Your reference is REF-1A2B3C4D.",
    heading: "Thanks for the referral",
    bodyLines: ["Acme ISO received the details sent through their referral form."],
    footnote: "If you didn't expect this email, you can ignore it.",
    brand: { name: "Acme ISO", logoUrl: null, primaryColor: "#0f766e" },
  };

  it("drops the button, the fallback link and the text link line", () => {
    const out = renderEmail(noButton);
    expect(out.html).not.toContain("Button not working?");
    expect(out.html).not.toContain("<a href=");
    expect(out.html).toContain("Thanks for the referral");
    expect(out.html).toContain("If you didn't expect this email, you can ignore it.");
    expect(out.html).toContain(POWERED_BY);
    expect(out.text).toBe(
      [
        "Thanks for the referral",
        "",
        "Acme ISO received the details sent through their referral form.",
        "",
        "If you didn't expect this email, you can ignore it.",
        "",
        POWERED_BY,
      ].join("\n"),
    );
  });

  it("needs both a label and a url to show a button", () => {
    expect(renderEmail({ ...noButton, ctaLabel: "Open" }).html).not.toContain("Button not working?");
    expect(renderEmail({ ...noButton, ctaUrl: "https://x.example" }).html).not.toContain("Button not working?");
    expect(renderEmail({ ...noButton, ctaLabel: "Open", ctaUrl: "https://x.example" }).html).toContain(
      "Button not working?",
    );
  });
});
```

Append to `supabase/functions/_shared/portalEmail.test.ts`, and add `portalPublicConfirmationEmail` to its import from `./portalEmail`:

```ts
describe("portalPublicConfirmationEmail", () => {
  it("names the ISO and the reference, and has no button", () => {
    const email = portalPublicConfirmationEmail({ orgName: "Acme ISO", ref: "REF-1A2B3C4D" });
    expect(email.subject).toBe("Acme ISO received your referral");
    expect(email.ctaLabel).toBeUndefined();
    expect(email.ctaUrl).toBeUndefined();
    const { html, text } = renderEmail({ ...email, brand: portalEmailBrand("Acme ISO", null) });
    expect(text).toContain("REF-1A2B3C4D");
    expect(text).toContain("Acme ISO");
    expect(html).not.toContain("Button not working?");
    expect(`${email.subject} ${text}`).not.toMatch(/\b(submitted|accepted|working|won|lost|declined|withdrawn)\b/);
    expect(text.replace("Powered by navigatr", "")).not.toMatch(/navigatr/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/emailTemplate.test.ts ../../supabase/functions/_shared/portalEmail.test.ts`
Expected: FAIL (`portalPublicConfirmationEmail` is not exported; the no-button html still contains "Button not working?").

- [ ] **Step 3: Make the button optional**

In `supabase/functions/_shared/emailTemplate.ts`, change the two fields in `EmailOptions`:

```ts
  /** Button label. A button shows only when both ctaLabel and ctaUrl are set. */
  ctaLabel?: string;
  ctaUrl?: string;
```

In `renderEmail`, right after the `codeHtml` constant, add:

```ts
  const ctaLabel = opts.ctaLabel ?? "";
  const ctaUrl = opts.ctaUrl ?? "";
  const hasCta = ctaLabel !== "" && ctaUrl !== "";
  const ctaHtml = hasCta
    ? `<tr><td style="padding:8px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:${accent};border-radius:9px;">
            <a href="${escUrl(ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${accentText};text-decoration:none;">${esc(ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>`
    : "";
  const ctaFallback = hasCta
    ? `<br>
          Button not working? Paste this link into your browser:<br>
          <a href="${escUrl(ctaUrl)}" style="color:${accent};word-break:break-all;">${escUrl(ctaUrl)}</a>`
    : "";
```

In the `html` template, replace the button block:

```
      ${codeHtml}
      <tr><td style="padding:8px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:${accent};border-radius:9px;">
            <a href="${escUrl(opts.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${accentText};text-decoration:none;">${esc(opts.ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>
```

with:

```
      ${codeHtml}
      ${ctaHtml}
```

and replace the footer lines:

```
          ${esc(opts.footnote)}<br>
          Button not working? Paste this link into your browser:<br>
          <a href="${escUrl(opts.ctaUrl)}" style="color:${accent};word-break:break-all;">${escUrl(opts.ctaUrl)}</a>
        </p>${poweredBy}
```

with:

```
          ${esc(opts.footnote)}${ctaFallback}
        </p>${poweredBy}
```

In the `text` array, replace:

```ts
    "",
    `${opts.ctaLabel}: ${opts.ctaUrl}`,
```

with:

```ts
    ...(hasCta ? ["", `${ctaLabel}: ${ctaUrl}`] : []),
```

- [ ] **Step 4: Add the confirmation email**

Append to `supabase/functions/_shared/portalEmail.ts`:

```ts
/**
 * Confirmation for a public referral form submission (FR-PORT-33). It goes
 * only to the optional "Your email" the sender typed (never to the business
 * contact), which anyone can type, so it carries only the ISO's name and the
 * reference: never the company, notes or other text the
 * submitter wrote (the form must not become a way to send arbitrary text
 * through the ISO's name). No button: there is nothing for the reader to open.
 */
export function portalPublicConfirmationEmail(args: { orgName: string; ref: string }): PortalEmail {
  return {
    subject: `${args.orgName} received your referral`,
    preheader: `Your reference is ${args.ref}.`,
    heading: "Thanks for the referral",
    bodyLines: [
      `${args.orgName} received the details sent through their referral form.`,
      `Your reference is ${args.ref}. Keep it in case you need to follow up.`,
    ],
    footnote: "If you didn't expect this email, you can ignore it.",
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass, snapshots unchanged**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/emailTemplate.test.ts ../../supabase/functions/_shared/emailTemplate.snapshot.test.ts ../../supabase/functions/_shared/portalEmail.test.ts ../../supabase/functions/_shared/portalNotifyEmail.test.ts`
Expected: PASS, with no snapshot written or updated (`git status supabase/functions/_shared/__snapshots__` shows nothing).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/emailTemplate.ts supabase/functions/_shared/emailTemplate.test.ts supabase/functions/_shared/portalEmail.ts supabase/functions/_shared/portalEmail.test.ts
git commit -m "$(cat <<'EOF'
feat(portal): public form confirmation email; email button is optional

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: `portal_api` actions `public_form` and `public_submit`

**Files:**
- Modify: `supabase/functions/_shared/portalPublicForm.ts`
- Test: `supabase/functions/_shared/portalPublicForm.test.ts`
- Modify: `supabase/functions/_shared/portalApi.ts`
- Test: `supabase/functions/_shared/portalApi.test.ts`
- Modify: `supabase/functions/portal_api/index.ts`
- Modify: `supabase/secrets.manifest.json`

**Interfaces:**
- Consumes: Task 3 SQL (`portal_public_form`, `portal_public_rate`, `portal_public_submit`); Task 4 helpers; Task 5 `portalPublicConfirmationEmail`; `shouldSend` (`emailGuard.ts`); `renderEmail` (`emailTemplate.ts`); `portalEmailBrand`, `portalFromAddress` (`portalEmail.ts`); `type ActionResult` (`portalReferralApi.ts`).
- Produces (TS):
  - `_shared/portalPublicForm.ts`:
    - `export const PUBLIC_FORM_ACTIONS = ["public_form", "public_submit"] as const`, `export type PublicFormAction`, `export function isPublicFormAction(action: string): action is PublicFormAction`
    - `export interface PublicFormEnv { fromAddress: string; appEnv: string | null | undefined; emailAllowlist: string; publicFormSigningSecret?: string | null; turnstileSecretKey?: string | null }`
    - `export interface PublicFormDeps { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>; sendEmail(msg: { from: string; to: string; subject: string; html: string; text: string }): Promise<void>; background?(p: Promise<unknown>): void; fetch?: FetchLike; now?(): Date; env: PublicFormEnv }`
    - `export function handlePublicFormAction(action: PublicFormAction, slug: string, token: string, body: Record<string, unknown>, ip: string | null, deps: PublicFormDeps): Promise<ActionResult>`
  - Confirmation email: sent only when `referrerEmail` is non-blank, only to that address; never to `email` (the business contact).
  - Responses: `public_form` (body `{ slug, token }`) answers `{ form: PortalPublicForm }`, `404 { error: "not_available" }`, `503 { error: "not_available" }` (signing secret unset) or `500`. `public_submit` (body `{ slug, token, ...PortalPublicSubmitInput }`) answers `{ submission: { ref } }` (also for too-fast and honeypot), `400 { error: "invalid_body", field }`, `409 { error: "form_expired" }`, `409 { error: "consent_changed" }`, `429 { error: "captcha_required" }`, `429 { error: "rate_limited" }`, `404 { error: "not_available" }`, `503` or `500`.
  - `_shared/portalApi.ts`: `PortalEnv` gains optional `publicFormSigningSecret?: string | null` and `turnstileSecretKey?: string | null`; `PortalApiDeps` gains optional `fetch?(input: string, init: RequestInit): Promise<Response>`; `PortalAction` includes `PublicFormAction`. Neither public action reads `x-portal-session`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/portalPublicForm.test.ts`, and extend its import from `./portalPublicForm` with `handlePublicFormAction`, `PUBLIC_HONEYPOT_FIELD` and `type PublicFormDeps`:

```ts
describe("handlePublicFormAction", () => {
  const SECRET = "test-signing-secret";
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const FORM_ROW = {
    org_name: "Acme ISO",
    rep_name: "Rita Rep",
    consent_text: "I may share this.",
    consent_version: 2,
    org_id: "secret-org",
    user_id: "secret-user",
  };
  const SUBMIT_ROW = {
    id: "1a2b3c4d-0000-0000-0000-000000000000",
    ref: "REF-1A2B3C4D",
    org_name: "Acme ISO",
    logo_url: null,
    primary_color: "#0f766e",
  };
  type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

  function setup(rpcImpl: Rpc, env: Partial<PublicFormDeps["env"]> = {}, fetchOk = true) {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args));
    const sendEmail = vi.fn(async (_m: { from: string; to: string; subject: string; html: string; text: string }) => {});
    const background = vi.fn();
    const fetchFn = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ success: fetchOk })));
    const deps: PublicFormDeps = {
      rpc,
      sendEmail,
      background,
      fetch: fetchFn,
      now: () => new Date(NOW),
      env: {
        fromAddress: "navigatr <invites@send.getnavigatr.io>",
        appEnv: "production",
        emailAllowlist: "",
        publicFormSigningSecret: SECRET,
        turnstileSecretKey: "turnstile-secret",
        ...env,
      },
    };
    return { deps, rpc, sendEmail, background, fetchFn };
  }

  const routes = (recent: number, submit: { data: unknown; error: { message: string } | null } = { data: [SUBMIT_ROW], error: null }): Rpc =>
    (name) => {
      if (name === "portal_public_rate") return { data: recent, error: null };
      if (name === "portal_public_submit") return submit;
      return { data: null, error: { message: `unexpected ${name}` } };
    };

  async function body(overrides: Record<string, unknown> = {}, ageMs = 10_000) {
    return {
      companyName: "Fresh Bakery",
      contactName: "Ann Owner",
      email: "ann@bakery.example",
      phone: "(555) 010-0100",
      notes: "Needs a new terminal.",
      referredBy: "Joe at the bank",
      referrerEmail: "joe@bank.example",
      consent: true,
      consentVersion: 2,
      formToken: await signFormToken(SECRET, "acme", "tok123", NOW - ageMs),
      [PUBLIC_HONEYPOT_FIELD]: "",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("public_form", () => {
    it("answers only the allowlisted fields with a form token signed now", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect(rpc).toHaveBeenCalledWith("portal_public_form", { p_slug: "acme", p_token: "tok123" });
      expect(res.status).toBe(200);
      const form = (res.body as { form: Record<string, unknown> }).form;
      expect(Object.keys(form).sort()).toEqual(["consentText", "consentVersion", "formToken", "orgName", "repName"]);
      expect(form).toMatchObject({ orgName: "Acme ISO", repName: "Rita Rep", consentText: "I may share this.", consentVersion: 2 });
      expect(String(form.formToken).startsWith(`${NOW}.`)).toBe(true);
      expect(await checkFormToken(SECRET, "acme", "tok123", String(form.formToken), NOW + 5_000)).toBe("ok");
    });

    it("passes a missing rep name as null", async () => {
      const { deps } = setup(() => ({ data: [{ ...FORM_ROW, rep_name: null }], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect((res.body as { form: { repName: unknown } }).form.repName).toBeNull();
    });

    it("answers one generic not_available for every unavailable link", async () => {
      const { deps } = setup(() => ({ data: [], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect(res).toEqual({ status: 404, body: { error: "not_available" } });
    });

    it("fails closed without a signing secret, before any database call", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }), { publicFormSigningSecret: "" });
      expect(await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps)).toEqual({
        status: 503,
        body: { error: "not_available" },
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("answers not_available for a blank slug or token without a database call", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }));
      expect((await handlePublicFormAction("public_form", "", "tok123", {}, null, deps)).status).toBe(404);
      expect((await handlePublicFormAction("public_form", "acme", "", {}, null, deps)).status).toBe(404);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("500s on a database error", async () => {
      const { deps } = setup(() => ({ data: null, error: { message: "boom" } }));
      expect((await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps)).status).toBe(500);
    });
  });

  describe("public_submit", () => {
    it("stores the referral, emails only the ISO name and reference to the referrer, and answers the reference", async () => {
      const { deps, rpc, sendEmail, background } = setup(routes(0));
      const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps);
      expect(res).toEqual({ status: 200, body: { submission: { ref: "REF-1A2B3C4D" } } });
      expect(rpc).toHaveBeenNthCalledWith(1, "portal_public_rate", { p_ip: "203.0.113.5", p_window_minutes: 60 });
      expect(rpc).toHaveBeenNthCalledWith(2, "portal_public_submit", {
        p_slug: "acme",
        p_token: "tok123",
        p_company: "Fresh Bakery",
        p_contact_name: "Ann Owner",
        p_contact_email: "ann@bakery.example",
        p_contact_phone: "(555) 010-0100",
        p_notes: "Needs a new terminal.",
        p_referred_by: "Joe at the bank",
        p_referrer_email: "joe@bank.example",
        p_consent_version: 2,
        p_ip: "203.0.113.5",
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(background).toHaveBeenCalledTimes(1);
      const msg = sendEmail.mock.calls[0][0];
      expect(msg.to).toBe("joe@bank.example");
      expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
      expect(msg.subject).toBe("Acme ISO received your referral");
      expect(msg.text).toContain("REF-1A2B3C4D");
      expect(msg.html).toContain("#0f766e");
      for (const typed of ["Fresh Bakery", "Ann Owner", "ann@bakery.example", "Needs a new terminal.", "Joe at the bank", "555"]) {
        expect(msg.text).not.toContain(typed);
        expect(msg.html).not.toContain(typed);
      }
    });

    it("sends no confirmation without a referrer email, and never to the business contact", async () => {
      const { deps, rpc, sendEmail } = setup(routes(0));
      const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body({ referrerEmail: "" }), null, deps);
      expect(res).toEqual({ status: 200, body: { submission: { ref: "REF-1A2B3C4D" } } });
      expect(rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_referrer_email: null }));
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("points at a malformed referrer email", async () => {
      const { deps, rpc } = setup(routes(0));
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ referrerEmail: "joe@" }), null, deps),
      ).toEqual({ status: 400, body: { error: "invalid_body", field: "referrerEmail" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("answers a too-fast post or a filled honeypot exactly like success, writing and sending nothing", async () => {
      for (const b of [await body({}, 1_000), await body({ [PUBLIC_HONEYPOT_FIELD]: "http://spam.example" })]) {
        const { deps, rpc, sendEmail } = setup(routes(0));
        const res = await handlePublicFormAction("public_submit", "acme", "tok123", b, "203.0.113.5", deps);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body as object)).toEqual(["submission"]);
        expect(Object.keys((res.body as { submission: object }).submission)).toEqual(["ref"]);
        expect((res.body as { submission: { ref: string } }).submission.ref).toMatch(/^REF-[0-9A-F]{8}$/);
        expect(rpc).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
      }
    });

    it("asks for a reload when the form token is missing, forged or a day old", async () => {
      for (const b of [
        await body({ formToken: "" }),
        await body({ formToken: `${NOW - 10_000}.${"0".repeat(64)}` }),
        await body({}, 25 * 60 * 60 * 1000),
      ]) {
        const { deps, rpc } = setup(routes(0));
        expect(await handlePublicFormAction("public_submit", "acme", "tok123", b, null, deps)).toEqual({
          status: 409,
          body: { error: "form_expired" },
        });
        expect(rpc).not.toHaveBeenCalled();
      }
    });

    it("points at the first bad field before any database call", async () => {
      const { deps, rpc } = setup(routes(0));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body({ phone: "12" }), null, deps)).toEqual({
        status: 400,
        body: { error: "invalid_body", field: "phone" },
      });
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body({ consent: false }), null, deps)).toEqual({
        status: 400,
        body: { error: "invalid_body", field: "consent" },
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("asks for the check past 5 in an hour, and stores nothing without it", async () => {
      const { deps, rpc, fetchFn } = setup(routes(5));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
        status: 429,
        body: { error: "captcha_required" },
      });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("lets a passed check through and refuses a failed one", async () => {
      const passed = setup(routes(7));
      const res = await handlePublicFormAction(
        "public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", passed.deps,
      );
      expect(res.status).toBe(200);
      expect(passed.fetchFn).toHaveBeenCalledTimes(1);
      expect(passed.rpc).toHaveBeenCalledWith("portal_public_submit", expect.anything());

      const failed = setup(routes(7), {}, false);
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-bad" }), "203.0.113.5", failed.deps),
      ).toEqual({ status: 429, body: { error: "captcha_required" } });
      expect(failed.rpc).not.toHaveBeenCalledWith("portal_public_submit", expect.anything());
    });

    it("fails the check closed when the Turnstile secret is unset", async () => {
      const { deps, fetchFn } = setup(routes(5), { turnstileSecretKey: "" });
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), null, deps),
      ).toEqual({ status: 429, body: { error: "captcha_required" } });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("refuses past 30 in an hour, even with a check", async () => {
      const { deps, fetchFn } = setup(routes(30));
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), null, deps),
      ).toEqual({ status: 429, body: { error: "rate_limited" } });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("maps database refusals", async () => {
      const cases: Array<[string, unknown]> = [
        ["rate_limited", { status: 429, body: { error: "rate_limited" } }],
        ["consent_changed", { status: 409, body: { error: "consent_changed" } }],
        ["invalid_input:phone", { status: 400, body: { error: "invalid_body", field: "phone" } }],
        ["invalid_input:referrerEmail", { status: 400, body: { error: "invalid_body", field: "referrerEmail" } }],
        ["invalid_input:address", { status: 500, body: { error: "server_error" } }],
        ["boom", { status: 500, body: { error: "server_error" } }],
      ];
      for (const [message, expected] of cases) {
        const { deps } = setup(routes(0, { data: null, error: { message } }));
        expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, deps)).toEqual(expected);
      }
    });

    it("answers not_available when the link died after the form loaded, sending nothing", async () => {
      const { deps, sendEmail } = setup(routes(0, { data: [], error: null }));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, deps)).toEqual({
        status: 404,
        body: { error: "not_available" },
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("500s when the rate count fails", async () => {
      const { deps } = setup(() => ({ data: null, error: { message: "boom" } }));
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, deps)).status).toBe(500);
    });

    it("keeps the reference when the allowlist drops the email or the send fails", async () => {
      const staging = setup(routes(0), { appEnv: "staging", emailAllowlist: "someone@else.example" });
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, staging.deps)).status).toBe(200);
      expect(staging.sendEmail).not.toHaveBeenCalled();

      const failing = setup(routes(0));
      failing.sendEmail.mockRejectedValueOnce(new Error("resend down"));
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, failing.deps)).status).toBe(200);

      const throwing = setup(routes(0));
      throwing.sendEmail.mockImplementationOnce(() => {
        throw new Error("sync throw");
      });
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, throwing.deps)).status).toBe(200);
    });
  });
});
```

Also add `beforeEach, afterEach` to the vitest import at the top of that file.

Append to `supabase/functions/_shared/portalApi.test.ts`:

```ts
describe("public form routes", () => {
  const PUBLIC_ENV: PortalEnv = { ...ENV, publicFormSigningSecret: "s" };

  it("serves the public form with no session header", async () => {
    const { deps, rpc } = setup(
      () => ok([{ org_name: "Acme ISO", rep_name: null, consent_text: "I may share this.", consent_version: 1 }]),
      PUBLIC_ENV,
    );
    const res = await handlePortalRequest(post("public_form", { slug: " ACME ", token: " tok123 " }), deps);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("portal_public_form", { p_slug: "acme", p_token: "tok123" });
    expect(rpc).not.toHaveBeenCalledWith("portal_session_lookup", expect.anything());
  });

  it("answers not_available for an oversized token without a database call", async () => {
    const { deps, rpc } = setup(() => ok([]), PUBLIC_ENV);
    const res = await handlePortalRequest(post("public_form", { slug: "acme", token: "t".repeat(129) }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_available" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("routes public_submit and passes the client IP", async () => {
    const { deps, rpc } = setup(() => ok(0), PUBLIC_ENV);
    const res = await handlePortalRequest(
      post("public_submit", { slug: "acme", token: "tok123", formToken: "" }, { "x-forwarded-for": "203.0.113.5" }),
      deps,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "form_expired" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalPublicForm.test.ts ../../supabase/functions/_shared/portalApi.test.ts`
Expected: FAIL (`handlePublicFormAction` is not exported; `public_form` answers 404 `not_found`).

- [ ] **Step 3: Write the handlers**

In `supabase/functions/_shared/portalPublicForm.ts`, extend the imports at the top:

```ts
import { timingSafeEquals } from "./cronAuth.ts";
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { portalEmailBrand, portalFromAddress, portalPublicConfirmationEmail } from "./portalEmail.ts";
import type { ActionResult } from "./portalReferralApi.ts";
import { PORTAL_FIELD_LIMITS } from "./portalSubmission.ts";
```

Append to the same file:

```ts
// --- portal_api actions (no session) ------------------------------------------------

export const PUBLIC_FORM_ACTIONS = ["public_form", "public_submit"] as const;
export type PublicFormAction = (typeof PUBLIC_FORM_ACTIONS)[number];

export function isPublicFormAction(action: string): action is PublicFormAction {
  return (PUBLIC_FORM_ACTIONS as readonly string[]).includes(action);
}

export interface PublicFormEnv {
  fromAddress: string;
  appEnv: string | null | undefined;
  emailAllowlist: string;
  /** PUBLIC_FORM_SIGNING_SECRET. Unset: the form answers not_available (fail closed). */
  publicFormSigningSecret?: string | null;
  /** TURNSTILE_SECRET_KEY. Unset: nobody over the soft limit can pass the check (fail closed). */
  turnstileSecretKey?: string | null;
}

export interface PublicFormDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  sendEmail(msg: { from: string; to: string; subject: string; html: string; text: string }): Promise<void>;
  background?(p: Promise<unknown>): void;
  fetch?: FetchLike;
  now?(): Date;
  env: PublicFormEnv;
}

interface FormRow {
  org_name: unknown;
  rep_name: unknown;
  consent_text: unknown;
  consent_version: unknown;
}

interface SubmitRow {
  ref: unknown;
  org_name: unknown;
  logo_url?: unknown;
  primary_color?: unknown;
}

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

function one<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data.length > 0 ? (data[0] as T) : null;
  return data !== null && typeof data === "object" ? (data as T) : null;
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

/** The only success shape, real or fake. */
function submitted(ref: string): ActionResult {
  return ok({ submission: { ref } });
}

export async function handlePublicFormAction(
  action: PublicFormAction,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PublicFormDeps,
): Promise<ActionResult> {
  const secret = deps.env.publicFormSigningSecret ?? "";
  if (!secret) {
    console.error("[portal_api] PUBLIC_FORM_SIGNING_SECRET is not set; the public form is unavailable");
    return err(503, "not_available");
  }
  if (!slug || !token) return err(404, "not_available");
  return action === "public_form"
    ? publicForm(secret, slug, token, deps)
    : publicSubmit(secret, slug, token, body, ip, deps);
}

async function publicForm(secret: string, slug: string, token: string, deps: PublicFormDeps): Promise<ActionResult> {
  const { data, error } = await deps.rpc("portal_public_form", { p_slug: slug, p_token: token });
  if (error) return serverError("public_form", error.message);
  const row = one<FormRow>(data);
  if (!row) return err(404, "not_available");
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const form: PortalPublicForm = {
    orgName: str(row.org_name),
    repName: strOrNull(row.rep_name),
    consentText: str(row.consent_text),
    consentVersion: num(row.consent_version),
    formToken: await signFormToken(secret, slug, token, nowMs),
  };
  return ok({ form });
}

async function publicSubmit(
  secret: string,
  slug: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
  deps: PublicFormDeps,
): Promise<ActionResult> {
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const formToken = str(body.formToken);
  const stamp =
    formToken.length > PUBLIC_FORM_LIMITS.formToken ? "invalid" : await checkFormToken(secret, slug, token, formToken, nowMs);
  if (stamp === "invalid") return err(409, "form_expired");
  // A bot learns nothing: identical to success, nothing written, nothing sent.
  if (stamp === "too_fast" || str(body[PUBLIC_HONEYPOT_FIELD]).trim() !== "") return submitted(fakeRef());

  const check = validatePublicSubmission(body);
  if (!check.ok) return err(400, "invalid_body", { field: check.field });
  const s = check.value;

  const rate = await deps.rpc("portal_public_rate", { p_ip: ip, p_window_minutes: 60 });
  if (rate.error) return serverError("public_rate", rate.error.message);
  const recent = num(rate.data);
  if (recent >= PUBLIC_HARD_LIMIT_PER_HOUR) return err(429, "rate_limited");
  if (recent >= PUBLIC_SOFT_LIMIT_PER_HOUR) {
    const captchaToken = str(body.captchaToken).trim();
    const passed =
      captchaToken !== "" &&
      captchaToken.length <= PUBLIC_FORM_LIMITS.captchaToken &&
      (await verifyTurnstile(deps.fetch, deps.env.turnstileSecretKey, captchaToken, ip));
    if (!passed) return err(429, "captcha_required");
  }

  const { data, error } = await deps.rpc("portal_public_submit", {
    p_slug: slug,
    p_token: token,
    p_company: s.companyName,
    p_contact_name: s.contactName,
    p_contact_email: s.email,
    p_contact_phone: s.phone,
    p_notes: s.notes,
    p_referred_by: s.referredBy,
    p_referrer_email: s.referrerEmail,
    p_consent_version: s.consentVersion,
    p_ip: ip,
  });
  if (error) {
    const message = error.message;
    if (message.includes("rate_limited")) return err(429, "rate_limited");
    if (message.includes("consent_changed")) return err(409, "consent_changed");
    const field = /invalid_input:([A-Za-z]+)/.exec(message)?.[1];
    if (field && isPublicFormField(field)) return err(400, "invalid_body", { field });
    return serverError("public_submit", message);
  }
  const row = one<SubmitRow>(data);
  if (!row || !str(row.ref)) return err(404, "not_available");
  // FR-PORT-33 (controller ruling): only to the sender's own optional email, never the business contact.
  if (s.referrerEmail) sendConfirmation(s.referrerEmail, str(row.org_name), str(row.ref), row, deps);
  return submitted(str(row.ref));
}

/** FR-PORT-33. Never fails the submit, and never delays the response. */
function sendConfirmation(to: string, orgName: string, ref: string, brandRow: SubmitRow, deps: PublicFormDeps): void {
  try {
    if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, to)) {
      console.log(`[portal_api][emailGuard] dropped a public form confirmation in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
      return;
    }
    const built = portalPublicConfirmationEmail({ orgName, ref });
    const { html, text } = renderEmail({ ...built, brand: portalEmailBrand(orgName, brandRow) });
    const sending = deps
      .sendEmail({ from: portalFromAddress(deps.env.fromAddress, orgName), to, subject: built.subject, html, text })
      .catch((e: unknown) => {
        console.error("[portal_api] public form confirmation failed:", e instanceof Error ? e.message : String(e));
      });
    if (deps.background) deps.background(sending);
  } catch (e) {
    console.error("[portal_api] public form confirmation failed:", e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: Route the actions in `portalApi.ts`**

In `supabase/functions/_shared/portalApi.ts`, add the import:

```ts
import { PUBLIC_FORM_ACTIONS, handlePublicFormAction, isPublicFormAction, type PublicFormAction } from "./portalPublicForm.ts";
```

Add the two optional fields at the end of `PortalEnv`:

```ts
  /** Phase 2B-1: PUBLIC_FORM_SIGNING_SECRET. Unset means the public form answers not_available. */
  publicFormSigningSecret?: string | null;
  /** Phase 2B-1: TURNSTILE_SECRET_KEY. Unset means the Turnstile check always fails. */
  turnstileSecretKey?: string | null;
```

Add to `PortalApiDeps`, after `background?`:

```ts
  /** Outbound HTTP for the Turnstile check (Phase 2B-1). Absent means the check always fails. */
  fetch?(input: string, init: RequestInit): Promise<Response>;
```

Change `PortalAction` and `ACTIONS`:

```ts
export type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out"
  | ReferralAction
  | PublicFormAction;

const ACTIONS: ReadonlySet<string> = new Set<PortalAction>([
  "brand",
  "request_code",
  "verify_code",
  "peek_invite",
  "accept_invite",
  "me",
  "sign_out",
  ...REFERRAL_ACTIONS,
  ...PUBLIC_FORM_ACTIONS,
]);
```

In `handlePortalRequest`, replace the `default:` branch with:

```ts
      default: {
        if (isPublicFormAction(action)) {
          // The public form has no session (FR-PORT-24): x-portal-session is never read.
          const token = str(body.token).trim();
          if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "not_available" }, 404);
          const result = await handlePublicFormAction(action, slug, token, body, ip, deps);
          return jsonResponse(result.body, result.status);
        }
        if (isReferralAction(action)) {
          const token = sessionTokenFrom(req.headers);
          if (slugTooLong || tooLong(token, PORTAL_LIMITS.token)) return jsonResponse({ error: "unauthorized" }, 401);
          return await referral(action, slug, token, body, ip, deps);
        }
        return jsonResponse({ error: "not_found" }, 404);
      }
```

- [ ] **Step 5: Wire the secrets in the edge function and the manifest**

In `supabase/functions/portal_api/index.ts`, extend the route comment:

```ts
//   export_referrals | get_profile | update_profile   (Phase 2A, session required)
//   public_form | public_submit   (Phase 2B-1, no session: the public referral form)
```

After the `TRANSCRIBE_MOCK` line add:

```ts
// Phase 2B-1 public referral form. Both fail closed when unset: without the
// signing secret the form answers not_available; without the Turnstile secret
// a connection over the soft limit can never pass the check.
const PUBLIC_FORM_SIGNING_SECRET = Deno.env.get("PUBLIC_FORM_SIGNING_SECRET") ?? "";
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
```

In `deps`, after the `transcribe` entry add:

```ts
  fetch: (input, init) => fetch(input, init),
```

and change `env` to:

```ts
  env: {
    appBaseUrl: APP_BASE_URL,
    fromAddress: FROM_ADDRESS,
    appEnv: APP_ENV,
    emailAllowlist: EMAIL_ALLOWLIST,
    publicFormSigningSecret: PUBLIC_FORM_SIGNING_SECRET,
    turnstileSecretKey: TURNSTILE_SECRET_KEY,
  },
```

Declare both secrets as required in every environment (the CI audit `node tools/check-secrets.mjs --audit` fails otherwise):

```bash
node -e '
const fs = require("fs");
const p = "supabase/secrets.manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
for (const env of ["staging", "demo", "production"]) {
  for (const k of ["PUBLIC_FORM_SIGNING_SECRET", "TURNSTILE_SECRET_KEY"]) {
    if (!m.environments[env].required.includes(k)) m.environments[env].required.push(k);
  }
}
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
'
git diff --stat supabase/secrets.manifest.json
```

Expected: `1 file changed, 9 insertions(+), 3 deletions(-)` (two names appended to each of three `required` lists, plus a comma on each list's previous last line; nothing else moves). If `git diff` shows any other change, run `git checkout supabase/secrets.manifest.json` and add the six names by hand.

- [ ] **Step 6: Run the tests, the audit and Deno**

Run: `pnpm --filter app test -- ../../supabase/functions/_shared/portalPublicForm.test.ts ../../supabase/functions/_shared/portalApi.test.ts ../../supabase/functions/_shared/portalReferralApi.test.ts`
Expected: PASS.

Run: `node tools/check-secrets.mjs --audit`
Expected: `Manifest covers every secret the function code reads.`

Run: `NO_COLOR=1 deno check --no-lock --config supabase/functions/portal_api/deno.json supabase/functions/portal_api/index.ts`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/portalPublicForm.ts supabase/functions/_shared/portalPublicForm.test.ts supabase/functions/_shared/portalApi.ts supabase/functions/_shared/portalApi.test.ts supabase/functions/portal_api/index.ts supabase/secrets.manifest.json
git commit -m "$(cat <<'EOF'
feat(portal): public_form and public_submit actions with bot checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: Portal API client: `publicForm` and `publicSubmit`

**Files:**
- Modify: `apps/app/src/features/portal/lib/portalApi.ts`
- Test: `apps/app/src/features/portal/lib/portalApi.test.ts`

**Interfaces:**
- Consumes: `PortalPublicForm`, `PortalPublicSubmitInput`, `PortalPublicSubmitted` (Task 4, `_shared/portalPublicForm.ts`); the Task 6 responses.
- Produces (TS, `portalApi`):
  - `publicForm(slug: string, token: string): Promise<PortalPublicForm | null>` (null on 404 `not_available`; throws `PortalApiError` otherwise).
  - `publicSubmit(slug: string, token: string, input: PortalPublicSubmitInput): Promise<PortalPublicSubmitted>` (throws `PortalApiError` with `status`, `code`, `field`).
  - Re-exports `type PortalPublicForm`, `type PortalPublicSubmitInput`, `type PortalPublicSubmitted`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("portalApi", ...)` block of `apps/app/src/features/portal/lib/portalApi.test.ts`:

```ts
  it("loads the public form without a session and returns null when it is not available", async () => {
    const form = { orgName: "Acme ISO", repName: "Rita Rep", consentText: "I may share this.", consentVersion: 2, formToken: "1.ab" };
    fetchMock.mockResolvedValueOnce(respond(200, { form }));
    await expect(portalApi.publicForm("acme", "tok123")).resolves.toEqual(form);
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/public_form`);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok123" });
    expect(lastCall().headers["x-portal-session"]).toBeUndefined();

    fetchMock.mockResolvedValueOnce(respond(404, { error: "not_available" }));
    await expect(portalApi.publicForm("acme", "old")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(respond(503, { error: "not_available" }));
    await expect(portalApi.publicForm("acme", "tok123")).rejects.toMatchObject({ status: 503 });
  });

  it("sends a public referral and surfaces the refusal codes", async () => {
    const input = {
      companyName: "Fresh Bakery",
      contactName: "Ann Owner",
      email: "ann@bakery.example",
      phone: "5550100100",
      notes: "Needs a terminal.",
      referredBy: "",
      referrerEmail: "",
      consent: true,
      consentVersion: 2,
      formToken: "1.ab",
      website: "",
    };
    fetchMock.mockResolvedValueOnce(respond(200, { submission: { ref: "REF-1A2B3C4D" } }));
    await expect(portalApi.publicSubmit("acme", "tok123", input)).resolves.toEqual({ ref: "REF-1A2B3C4D" });
    expect(lastCall().url).toBe(`${PORTAL_API_URL}/public_submit`);
    expect(lastCall().body).toEqual({ slug: "acme", token: "tok123", ...input });
    expect(lastCall().headers["x-portal-session"]).toBeUndefined();

    fetchMock.mockResolvedValueOnce(respond(429, { error: "captcha_required" }));
    await expect(portalApi.publicSubmit("acme", "tok123", input)).rejects.toMatchObject({ status: 429, code: "captcha_required" });
    fetchMock.mockResolvedValueOnce(respond(400, { error: "invalid_body", field: "phone" }));
    await expect(portalApi.publicSubmit("acme", "tok123", input)).rejects.toMatchObject({ status: 400, field: "phone" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/portalApi.test.ts`
Expected: FAIL with `portalApi.publicForm is not a function`.

- [ ] **Step 3: Add the client calls**

In `apps/app/src/features/portal/lib/portalApi.ts`, after the `portalProfile` type import add:

```ts
import type {
  PortalPublicForm,
  PortalPublicSubmitInput,
  PortalPublicSubmitted,
} from "../../../../../../supabase/functions/_shared/portalPublicForm";
```

Add the three names to the `export type { ... }` list:

```ts
  PortalPublicForm,
  PortalPublicSubmitInput,
  PortalPublicSubmitted,
```

Add to the `PortalAction` union, after `| "update_profile"`:

```ts
  | "public_form"
  | "public_submit";
```

(removing the `;` that ended `| "update_profile"`).

Add to the `portalApi` object, after `updateProfile`:

```ts
  /** Phase 2B-1 public referral form: no session. Null when the link is not available. */
  publicForm(slug: string, token: string): Promise<PortalPublicForm | null> {
    return portalRequest<{ form: PortalPublicForm }>("public_form", { slug, token }).then((r) => r.form, nullOn(404));
  },

  publicSubmit(slug: string, token: string, input: PortalPublicSubmitInput): Promise<PortalPublicSubmitted> {
    return portalRequest<{ submission: PortalPublicSubmitted }>("public_submit", { slug, token, ...input }).then(
      (r) => r.submission,
    );
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal/lib/portalApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/portal/lib/portalApi.ts apps/app/src/features/portal/lib/portalApi.test.ts
git commit -m "$(cat <<'EOF'
feat(portal): client calls for the public referral form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Turnstile loader and widget, and the send guard

**Files:**
- Create: `apps/app/src/features/portal/lib/turnstile.ts`
- Test: `apps/app/src/features/portal/lib/turnstile.test.ts`
- Create: `apps/app/src/features/portal/components/TurnstileWidget.tsx`
- Test: `apps/app/src/features/portal/components/TurnstileWidget.test.tsx`
- Create: `apps/app/src/features/portal/lib/publicFormTiming.ts`
- Test: `apps/app/src/features/portal/lib/publicFormTiming.test.ts`
- Modify: `apps/app/src/vite-env.d.ts`
- Modify: `apps/app/.env.local.example`

**Interfaces:**
- Consumes: `PUBLIC_FORM_MIN_AGE_MS` (Task 4).
- Produces (TS):
  - `lib/turnstile.ts`: `export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"`; `export interface TurnstileRenderOptions { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; theme?: "auto" | "light" | "dark" }`; `export interface TurnstileApi { render(container: HTMLElement, options: TurnstileRenderOptions): string; remove(widgetId: string): void }`; `export function turnstileSiteKey(): string`; `export function loadTurnstile(doc?: Document): Promise<TurnstileApi>`; `export function resetTurnstileLoader(): void` (tests only). Declares `Window.turnstile?: TurnstileApi`.
  - `components/TurnstileWidget.tsx`: `export function TurnstileWidget(props: { siteKey: string; onToken: (token: string) => void; onError: () => void }): JSX.Element`.
  - `lib/publicFormTiming.ts`: `export const PUBLIC_SEND_GUARD_MS = PUBLIC_FORM_MIN_AGE_MS + 500`; `export function sendDelay(loadedAtMs: number, nowMs: number): number`; `export function waitForFormAge(loadedAtMs: number, now?: () => number, sleep?: (ms: number) => Promise<void>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/portal/lib/turnstile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TURNSTILE_SCRIPT_URL, loadTurnstile, resetTurnstileLoader, turnstileSiteKey, type TurnstileApi } from "./turnstile";

const FAKE: TurnstileApi = { render: vi.fn(() => "w1"), remove: vi.fn() };

function scripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`));
}

beforeEach(() => {
  resetTurnstileLoader();
  delete window.turnstile;
  scripts().forEach((s) => s.remove());
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe("loadTurnstile", () => {
  it("resolves at once when the script is already on the page", async () => {
    window.turnstile = FAKE;
    await expect(loadTurnstile()).resolves.toBe(FAKE);
    expect(scripts()).toHaveLength(0);
  });

  it("adds the script once, explicitly rendered, and resolves when it loads", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);
    window.turnstile = FAKE;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(FAKE);
    await expect(second).resolves.toBe(FAKE);
  });

  it("rejects when the script fails, and tries again next time", async () => {
    const failed = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow("turnstile_load_failed");
    expect(scripts()).toHaveLength(0);
    const retry = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    window.turnstile = FAKE;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(FAKE);
  });

  it("rejects when the script loads without the API", async () => {
    const p = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(p).rejects.toThrow("turnstile_missing");
  });
});

describe("turnstileSiteKey", () => {
  it("reads VITE_TURNSTILE_SITE_KEY, trimmed, and is empty when unset", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", " 1x00000000000000000000AA ");
    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBe("");
  });
});
```

Create `apps/app/src/features/portal/components/TurnstileWidget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../lib/turnstile", () => ({ loadTurnstile: () => fake.load() }));

import { TurnstileWidget } from "./TurnstileWidget";

beforeEach(() => {
  fake.load.mockReset();
  fake.render.mockReset();
  fake.remove.mockReset();
  fake.render.mockReturnValue("w1");
  fake.load.mockResolvedValue({ render: fake.render, remove: fake.remove });
});

describe("TurnstileWidget", () => {
  it("renders the check with the site key and passes the token on", async () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="1x00000000000000000000AA" onToken={onToken} onError={vi.fn()} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1));
    const [container, options] = fake.render.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLElement);
    expect(options).toMatchObject({ sitekey: "1x00000000000000000000AA", theme: "auto" });
    options.callback("tt-1");
    expect(onToken).toHaveBeenCalledWith("tt-1");
  });

  it("reports a check error and a script that will not load", async () => {
    const onError = vi.fn();
    render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={onError} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalled());
    fake.render.mock.calls[0][1]["error-callback"]();
    expect(onError).toHaveBeenCalledTimes(1);

    fake.load.mockRejectedValueOnce(new Error("turnstile_load_failed"));
    const second = vi.fn();
    render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={second} />);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  });

  it("removes the widget on unmount, and renders nothing after an early unmount", async () => {
    const { unmount } = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalled());
    unmount();
    expect(fake.remove).toHaveBeenCalledWith("w1");

    fake.render.mockClear();
    const early = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />);
    early.unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.render).not.toHaveBeenCalled();
  });
});
```

Create `apps/app/src/features/portal/lib/publicFormTiming.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PUBLIC_SEND_GUARD_MS, sendDelay, waitForFormAge } from "./publicFormTiming";

describe("send guard", () => {
  it("is the server's 3 second minimum plus half a second", () => {
    expect(PUBLIC_SEND_GUARD_MS).toBe(3_500);
  });

  it("waits out the rest of the guard, and never a negative time", () => {
    expect(sendDelay(10_000, 10_000)).toBe(3_500);
    expect(sendDelay(10_000, 12_000)).toBe(1_500);
    expect(sendDelay(10_000, 13_500)).toBe(0);
    expect(sendDelay(10_000, 60_000)).toBe(0);
  });

  it("sleeps only when the form is too fresh", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await waitForFormAge(10_000, () => 11_000, sleep);
    expect(sleep).toHaveBeenCalledWith(2_500);
    sleep.mockClear();
    await waitForFormAge(10_000, () => 20_000, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses a real timer by default", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = waitForFormAge(Date.now()).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(3_499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/turnstile.test.ts src/features/portal/components/TurnstileWidget.test.tsx src/features/portal/lib/publicFormTiming.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the loader, the widget and the guard**

Create `apps/app/src/features/portal/lib/turnstile.ts`:

```ts
/**
 * Cloudflare Turnstile for the public referral form (FR-PORT-30). The script
 * loads only after portal_api answers captcha_required, so people under the
 * limit never fetch anything from Cloudflare. Explicit render: the widget is
 * placed by TurnstileWidget, not by a class name scan.
 *
 * The site key is public (VITE_TURNSTILE_SITE_KEY). Unset means the page tells
 * the person to try later instead of showing a broken check.
 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

export function turnstileSiteKey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();
}

/** Adds the script once; a failed load is forgotten so the next call tries again. */
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  const ready = doc.defaultView?.turnstile;
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = doc.defaultView?.turnstile;
      if (api) {
        resolve(api);
        return;
      }
      loading = null;
      reject(new Error("turnstile_missing"));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("turnstile_load_failed"));
    };
    doc.head.appendChild(script);
  });
  return loading;
}

/** Tests only: forget a finished or pending load. */
export function resetTurnstileLoader(): void {
  loading = null;
}
```

Create `apps/app/src/features/portal/components/TurnstileWidget.tsx`:

```tsx
/**
 * The Turnstile check, shown on the public referral form only after the
 * server asked for it. Calls onToken with the check's token (the page then
 * sends the referral again with it) and onError when the check or its script
 * fails. The latest callbacks are always used, without re-rendering the check.
 */
import * as React from "react";
import { loadTurnstile, type TurnstileApi } from "../lib/turnstile";

export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onError: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const handlers = React.useRef({ onToken, onError });
  React.useEffect(() => {
    handlers.current = { onToken, onError };
  });

  React.useEffect(() => {
    let cancelled = false;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;
    loadTurnstile().then(
      (loaded) => {
        if (cancelled || !ref.current) return;
        api = loaded;
        widgetId = loaded.render(ref.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => handlers.current.onToken(token),
          "error-callback": () => handlers.current.onError(),
        });
      },
      () => {
        if (!cancelled) handlers.current.onError();
      },
    );
    return () => {
      cancelled = true;
      if (api && widgetId !== null) api.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={ref} className="flex min-h-[65px] justify-center" />;
}
```

Create `apps/app/src/features/portal/lib/publicFormTiming.ts`:

```ts
/**
 * The server treats a form token younger than 3 seconds as a bot and answers
 * with a fake success, writing nothing. A person who sends right after the
 * form (re)loaded would lose their referral without knowing it, so the page
 * waits until its token is at least 3.5 seconds old before sending.
 */
import { PUBLIC_FORM_MIN_AGE_MS } from "../../../../../../supabase/functions/_shared/portalPublicForm";

export const PUBLIC_SEND_GUARD_MS = PUBLIC_FORM_MIN_AGE_MS + 500;

export function sendDelay(loadedAtMs: number, nowMs: number): number {
  return Math.max(0, loadedAtMs + PUBLIC_SEND_GUARD_MS - nowMs);
}

export function waitForFormAge(
  loadedAtMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const ms = sendDelay(loadedAtMs, now());
  return ms > 0 ? sleep(ms) : Promise.resolve();
}
```

In `apps/app/src/vite-env.d.ts`, add to `ImportMetaEnv`:

```ts
  /** Cloudflare Turnstile site key for the public referral form (public value). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
```

Append to `apps/app/.env.local.example`:

```
# Public referral form bot check (Cloudflare Turnstile). Public value. Leave
# unset locally unless you are testing the check; the form then says "try
# again later" to a connection over the limit. Cloudflare's always-pass test
# key is 1x00000000000000000000AA (pair it with the test secret on the edge).
# VITE_TURNSTILE_SITE_KEY=
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal/lib/turnstile.test.ts src/features/portal/components/TurnstileWidget.test.tsx src/features/portal/lib/publicFormTiming.test.ts`
Expected: PASS, no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/portal/lib/turnstile.ts apps/app/src/features/portal/lib/turnstile.test.ts apps/app/src/features/portal/components/TurnstileWidget.tsx apps/app/src/features/portal/components/TurnstileWidget.test.tsx apps/app/src/features/portal/lib/publicFormTiming.ts apps/app/src/features/portal/lib/publicFormTiming.test.ts apps/app/src/vite-env.d.ts apps/app/.env.local.example
git commit -m "$(cat <<'EOF'
feat(portal): on-demand Turnstile check and the public form send guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: The public referral form page

**Files:**
- Create: `apps/app/src/features/portal/pages/PortalPublicFormPage.tsx`
- Test: `apps/app/src/features/portal/pages/PortalPublicFormPage.test.tsx`
- Modify: `apps/app/src/features/portal/pages/PortalRoot.tsx`

**Interfaces:**
- Consumes: `portalApi.publicForm`, `portalApi.publicSubmit`, `PortalApiError`, `isPortalTransientError`, `type PortalBrand`, `type PortalPublicSubmitInput` (Task 7, `lib/portalApi.ts`); `TurnstileWidget` (Task 8); `turnstileSiteKey` (Task 8, `lib/turnstile.ts`); `waitForFormAge` (Task 8, `lib/publicFormTiming.ts`); `PUBLIC_FORM_LIMITS`, `PUBLIC_HONEYPOT_FIELD`, `isPublicFormField`, `validatePublicSubmission`, `type PublicFormField` (Task 4); `PortalRetry`, `portalReachMessage` (`components/PortalRetry.tsx`); `Button`, `Card`, `Checkbox`, `FormField`, `Input`, `Textarea` (`@/components/navigatr`).
- Produces (TS): `export function PortalPublicFormPage(props: { slug: string; brand: PortalBrand }): JSX.Element`, mounted by `PortalRoot` at `/p/:slug/refer/:token` outside `PortalSignedInLayout`.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/portal/pages/PortalPublicFormPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  publicForm: vi.fn(),
  publicSubmit: vi.fn(),
}));
const turnstile = vi.hoisted(() => ({ siteKey: "1x00000000000000000000AA", render: vi.fn() }));
const timing = vi.hoisted(() => ({ wait: vi.fn() }));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});
vi.mock("../lib/turnstile", () => ({
  turnstileSiteKey: () => turnstile.siteKey,
  loadTurnstile: () => Promise.resolve({ render: turnstile.render, remove: vi.fn() }),
}));
vi.mock("../lib/publicFormTiming", () => ({ waitForFormAge: (...a: unknown[]) => timing.wait(...a) }));

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const FORM = {
  orgName: "Acme ISO",
  repName: "Rita Rep",
  consentText: "I may share this business's details.",
  consentVersion: 2,
  formToken: "1760788800000.abc",
};

function renderAt(path = "/p/acme/refer/tok123") {
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

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Business name"), "Fresh Bakery");
  await user.type(screen.getByLabelText("Contact name"), "Ann Owner");
  await user.type(screen.getByLabelText("Email"), "ann@bakery.example");
  await user.type(screen.getByLabelText("Phone"), "555 010 0100");
  await user.type(screen.getByLabelText("Notes"), "Needs a new terminal.");
  await user.click(screen.getByRole("checkbox", { name: FORM.consentText }));
}

const SENT = {
  companyName: "Fresh Bakery",
  contactName: "Ann Owner",
  email: "ann@bakery.example",
  phone: "555 010 0100",
  notes: "Needs a new terminal.",
  referredBy: "",
  referrerEmail: "",
  website: "",
  consent: true,
  consentVersion: 2,
  formToken: FORM.formToken,
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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  turnstile.render.mockReset();
  turnstile.siteKey = "1x00000000000000000000AA";
  timing.wait.mockReset();
  timing.wait.mockResolvedValue(undefined);
  api.brand.mockResolvedValue(BRAND);
  api.publicForm.mockResolvedValue(FORM);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalPublicFormPage", () => {
  it("shows the ISO and the rep, sends the referral, and shows the reference", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    expect(await screen.findByRole("heading", { name: "Refer a business to Acme ISO" })).toBeInTheDocument();
    expect(screen.getByText("Your referral goes to Rita Rep at Acme ISO.")).toBeInTheDocument();
    expect(api.publicForm).toHaveBeenCalledWith("acme", "tok123");

    await fill(user);
    await user.type(screen.getByLabelText("Who referred this business? (optional)"), "Joe");
    await user.click(screen.getByRole("button", { name: "Send referral" }));

    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(screen.getByText("Acme ISO has it. Your reference is REF-1A2B3C4D.")).toBeInTheDocument();
    expect(screen.queryByText("A confirmation email is on its way.")).toBeNull();
    expect(api.publicSubmit).toHaveBeenCalledWith("acme", "tok123", { ...SENT, referredBy: "Joe" });
    expect(timing.wait).toHaveBeenCalledWith(expect.any(Number));
    expect(document.body.textContent).not.toMatch(/navigatr/i);
  });

  it("asks for the sender's own email as optional and promises a confirmation only when given", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    await fill(user);
    expect(screen.getByText("For a confirmation. Optional.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your email (optional)"), "joe@bank.example");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("A confirmation email is on its way.")).toBeInTheDocument();
    expect(api.publicSubmit).toHaveBeenCalledWith("acme", "tok123", { ...SENT, referrerEmail: "joe@bank.example" });
  });

  it("points at a malformed referrer email before sending", async () => {
    const user = userEvent.setup();
    renderAt();
    await fill(user);
    await user.type(screen.getByLabelText("Your email (optional)"), "joe@");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(screen.getByText("Check your email address, or leave it blank.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your email (optional)")).toHaveFocus();
    expect(api.publicSubmit).not.toHaveBeenCalled();
  });

  it("speaks for the ISO when the link has no rep", async () => {
    api.publicForm.mockResolvedValue({ ...FORM, repName: null });
    renderAt();
    expect(await screen.findByText("Tell Acme ISO about a business they can help.")).toBeInTheDocument();
  });

  it("says the form is not available for a dead link, and offers a retry for a network failure", async () => {
    api.publicForm.mockResolvedValue(null);
    const dead = renderAt();
    expect(await screen.findByRole("heading", { name: "This form isn't available" })).toBeInTheDocument();
    dead.unmount();

    api.publicForm.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderAt();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("checks the fields before sending and moves focus to the first problem", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Send referral" }));
    expect(screen.getByText("Add the business name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toHaveFocus();
    expect(api.publicSubmit).not.toHaveBeenCalled();
  });

  it("hides the honeypot from people and sends it empty", async () => {
    renderAt();
    const trap = (await screen.findByLabelText("Website", { selector: "input" })) as HTMLInputElement;
    expect(trap.name).toBe("website");
    expect(trap.tabIndex).toBe(-1);
    expect(trap.autocomplete).toBe("off");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("shows the check when asked, then sends again with its token", async () => {
    const user = userEvent.setup();
    api.publicSubmit
      .mockRejectedValueOnce(new PortalApiError(429, "captcha_required"))
      .mockResolvedValueOnce({ ref: "REF-00000001" });
    turnstile.render.mockImplementation((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      queueMicrotask(() => opts.callback("captcha-ok"));
      return "w1";
    });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(api.publicSubmit).toHaveBeenLastCalledWith("acme", "tok123", { ...SENT, captchaToken: "captcha-ok" });
  });

  it("says try later, with no check, when this site has no Turnstile key", async () => {
    const user = userEvent.setup();
    turnstile.siteKey = "";
    api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Too many referrals from this connection right now. Try again later.")).toBeInTheDocument();
    expect(turnstile.render).not.toHaveBeenCalled();
  });

  it("says try later when the hard limit is reached", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(429, "rate_limited"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Too many referrals from this connection right now. Try again later.")).toBeInTheDocument();
  });

  it("shows the unavailable card when the link died after the form loaded", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(404, "not_available"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "This form isn't available" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Thanks for the referral" })).toBeNull();
  });

  it("reloads the form and asks again when it was open too long or the wording changed", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "form_expired"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("This page was open for a while. Check your details and send it again.")).toBeInTheDocument();
    await waitFor(() => expect(api.publicForm).toHaveBeenCalledTimes(2));

    api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The wording changed. Please review it and tick the box again.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: FORM.consentText })).not.toBeChecked();
  });

  it("points at the field the server named", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(400, "invalid_body", "phone"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add a phone number with at least 7 digits.")).toBeInTheDocument();
  });

  it("does not refetch the form when the window regains focus", async () => {
    renderAt();
    await screen.findByLabelText("Business name");
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await Promise.resolve();
    expect(api.publicForm).toHaveBeenCalledTimes(1);
  });

  it("Send another clears the form and loads a fresh one", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await user.click(await screen.findByRole("button", { name: "Send another" }));
    expect(await screen.findByLabelText("Business name")).toHaveValue("");
    await waitFor(() => expect(api.publicForm).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalPublicFormPage.test.tsx`
Expected: FAIL (no `refer/:token` route: the catch-all redirects to the sign-in page, so the heading is not found).

- [ ] **Step 3: Write the page**

Create `apps/app/src/features/portal/pages/PortalPublicFormPage.tsx`:

```tsx
/**
 * The public referral form (Partner Portal Phase 2B-1, FR-PORT-24..34), at
 * /p/:slug/refer/:token. Anyone with a rep's or the ISO's link can send a
 * business with no sign-in. Built for a phone: one column, big targets.
 *
 * Bot checks are invisible to people: a hidden "website" field, a signed form
 * token the server ages, and a per-connection limit. Past the limit the server
 * asks for a Cloudflare Turnstile check, and only then does this page load the
 * Turnstile script.
 *
 * The form is fetched once (no refetch on focus) and a send waits until the
 * form token is 3.5 seconds old: the server silently drops anything younger
 * than 3 seconds as a bot, and a person must never lose a referral that way.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Unlink } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { TurnstileWidget } from "../components/TurnstileWidget";
import {
  PortalApiError,
  isPortalTransientError,
  portalApi,
  type PortalBrand,
  type PortalPublicSubmitInput,
} from "../lib/portalApi";
import { waitForFormAge } from "../lib/publicFormTiming";
import { turnstileSiteKey } from "../lib/turnstile";
import {
  PUBLIC_FORM_LIMITS,
  PUBLIC_HONEYPOT_FIELD,
  isPublicFormField,
  validatePublicSubmission,
  type PublicFormField,
} from "../../../../../../supabase/functions/_shared/portalPublicForm";

type Draft = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string;
  referrerEmail: string;
  website: string;
};

const EMPTY: Draft = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  referredBy: "",
  referrerEmail: "",
  website: "",
};

const FIELD_MESSAGES: Record<PublicFormField, string> = {
  companyName: "Add the business name.",
  contactName: "Add a contact name.",
  email: "Add a valid email address.",
  phone: "Add a phone number with at least 7 digits.",
  notes: "Add a note about what the business needs.",
  referredBy: "Shorten this to 160 characters or fewer.",
  referrerEmail: "Check your email address, or leave it blank.",
  consent: "Check the box to confirm you have permission.",
};

const FIELD_IDS: Record<PublicFormField, string> = {
  companyName: "pf-company",
  contactName: "pf-contact",
  email: "pf-email",
  phone: "pf-phone",
  notes: "pf-notes",
  referredBy: "pf-referred-by",
  referrerEmail: "pf-referrer-email",
  consent: "pf-consent",
};

const TOO_MANY = "Too many referrals from this connection right now. Try again later.";
const CHECK_PROMPT = "One more step. Complete the check below and we'll send it.";
const CHECK_FAILED = "That check didn't go through. Try it again.";
const CHECK_UNAVAILABLE = "The check couldn't load. Try again later.";
const FORM_EXPIRED = "This page was open for a while. Check your details and send it again.";
const CONSENT_CHANGED = "The wording changed. Please review it and tick the box again.";

function PublicFormUnavailable() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Unlink className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-heading-lg text-text-default">This form isn&apos;t available</h1>
      <p className="text-body-md text-text-muted">
        Check the link you were given, or ask the person who shared it for a new one.
      </p>
    </Card>
  );
}

export function PortalPublicFormPage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const { token = "" } = useParams<{ token: string }>();
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  // The consent version ticked against, or null when unticked.
  const [consentedVersion, setConsentedVersion] = React.useState<number | null>(null);
  const [fieldError, setFieldError] = React.useState<PublicFormField | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [captchaKey, setCaptchaKey] = React.useState<number | null>(null);
  const [sentRef, setSentRef] = React.useState<string | null>(null);
  // Whether the sender gave their own email, so a confirmation is on its way.
  const [confirmationSent, setConfirmationSent] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const inFlight = React.useRef(false);

  const form = useQuery({
    queryKey: ["portal", "public-form", slug, token],
    queryFn: () => portalApi.publicForm(slug, token),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  React.useEffect(() => {
    if (fieldError !== null) document.getElementById(FIELD_IDS[fieldError])?.focus();
  }, [fieldError]);

  const update = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const consent = consentedVersion !== null && consentedVersion === form.data?.consentVersion;

  const send = async (captchaToken?: string) => {
    if (!form.data || inFlight.current) return;
    const input: PortalPublicSubmitInput = {
      ...draft,
      consent,
      consentVersion: consentedVersion ?? form.data.consentVersion,
      formToken: form.data.formToken,
      ...(captchaToken ? { captchaToken } : {}),
    };
    const check = validatePublicSubmission(input);
    if (!check.ok) {
      setFieldError(check.field);
      setNotice(null);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFieldError(null);
    setNotice(null);
    try {
      await waitForFormAge(form.dataUpdatedAt);
      const res = await portalApi.publicSubmit(slug, token, input);
      setCaptchaKey(null);
      setConfirmationSent(check.value.referrerEmail !== null);
      setSentRef(res.ref);
    } catch (err) {
      if (err instanceof PortalApiError && err.status === 404) {
        setGone(true);
      } else if (err instanceof PortalApiError && err.code === "captcha_required") {
        if (!turnstileSiteKey()) {
          setNotice(TOO_MANY);
        } else {
          setNotice(captchaToken ? CHECK_FAILED : CHECK_PROMPT);
          setCaptchaKey((k) => (k ?? 0) + 1);
        }
      } else if (err instanceof PortalApiError && err.status === 429) {
        setNotice(TOO_MANY);
      } else if (err instanceof PortalApiError && err.code === "form_expired") {
        setNotice(FORM_EXPIRED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.code === "consent_changed") {
        setConsentedVersion(null);
        setNotice(CONSENT_CHANGED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.status === 400 && isPublicFormField(err.field)) {
        setFieldError(err.field);
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't send that. Try again.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (form.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (form.isError && isPortalTransientError(form.error) && !gone) {
    return <PortalRetry name={brand.orgName} onRetry={() => void form.refetch()} busy={form.isFetching} />;
  }
  if (gone || !form.data) return <PublicFormUnavailable />;

  if (sentRef) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Thanks for the referral</h1>
          <p className="text-body-md text-text-default">{`${brand.orgName} has it. Your reference is ${sentRef}.`}</p>
          {confirmationSent && <p className="text-body-sm text-text-muted">A confirmation email is on its way.</p>}
        </div>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => {
            setSentRef(null);
            setDraft(EMPTY);
            setConsentedVersion(null);
            void form.refetch();
          }}
        >
          Send another
        </Button>
      </Card>
    );
  }

  const data = form.data;
  const errorFor = (field: PublicFormField): string | undefined =>
    fieldError === field ? FIELD_MESSAGES[field] : undefined;
  const siteKey = turnstileSiteKey();

  return (
    <Card padding="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">{`Refer a business to ${data.orgName}`}</h1>
          <p className="text-body-md text-text-muted">
            {data.repName
              ? `Your referral goes to ${data.repName} at ${data.orgName}.`
              : `Tell ${data.orgName} about a business they can help.`}
          </p>
        </div>

        <FormField label="Business name" htmlFor={FIELD_IDS.companyName} error={errorFor("companyName")}>
          <Input
            id={FIELD_IDS.companyName}
            autoComplete="organization"
            maxLength={PUBLIC_FORM_LIMITS.companyName}
            value={draft.companyName}
            onChange={(e) => update("companyName")(e.target.value)}
          />
        </FormField>

        <FormField label="Contact name" htmlFor={FIELD_IDS.contactName} error={errorFor("contactName")}>
          <Input
            id={FIELD_IDS.contactName}
            autoComplete="name"
            maxLength={PUBLIC_FORM_LIMITS.contactName}
            value={draft.contactName}
            onChange={(e) => update("contactName")(e.target.value)}
          />
        </FormField>

        <FormField label="Email" htmlFor={FIELD_IDS.email} error={errorFor("email")}>
          <Input
            id={FIELD_IDS.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={PUBLIC_FORM_LIMITS.email}
            value={draft.email}
            onChange={(e) => update("email")(e.target.value)}
          />
        </FormField>

        <FormField label="Phone" htmlFor={FIELD_IDS.phone} error={errorFor("phone")}>
          <Input
            id={FIELD_IDS.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PUBLIC_FORM_LIMITS.phone}
            value={draft.phone}
            onChange={(e) => update("phone")(e.target.value)}
          />
        </FormField>

        <FormField label="Notes" htmlFor={FIELD_IDS.notes} error={errorFor("notes")}>
          <Textarea
            id={FIELD_IDS.notes}
            rows={4}
            maxLength={PUBLIC_FORM_LIMITS.notes}
            placeholder="What does the business need? When is a good time to call?"
            value={draft.notes}
            onChange={(e) => update("notes")(e.target.value)}
          />
        </FormField>

        <FormField
          label="Who referred this business? (optional)"
          htmlFor={FIELD_IDS.referredBy}
          error={errorFor("referredBy")}
        >
          <Input
            id={FIELD_IDS.referredBy}
            autoComplete="off"
            maxLength={PUBLIC_FORM_LIMITS.referredBy}
            value={draft.referredBy}
            onChange={(e) => update("referredBy")(e.target.value)}
          />
        </FormField>

        <FormField
          label="Your email (optional)"
          htmlFor={FIELD_IDS.referrerEmail}
          helper="For a confirmation. Optional."
          error={errorFor("referrerEmail")}
        >
          <Input
            id={FIELD_IDS.referrerEmail}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={PUBLIC_FORM_LIMITS.referrerEmail}
            value={draft.referrerEmail}
            onChange={(e) => update("referrerEmail")(e.target.value)}
          />
        </FormField>

        {/* Honeypot (FR-PORT-30): off screen, out of the tab order, hidden from
            assistive tech. Only bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="pf-website">Website</label>
          <input
            id="pf-website"
            name={PUBLIC_HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={draft.website}
            onChange={(e) => update("website")(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Checkbox
            id={FIELD_IDS.consent}
            checked={consent}
            onCheckedChange={(checked) => setConsentedVersion(checked ? data.consentVersion : null)}
            label={data.consentText}
          />
          {fieldError === "consent" && (
            <p role="alert" className="text-caption text-status-danger">
              {FIELD_MESSAGES.consent}
            </p>
          )}
        </div>

        {captchaKey !== null && siteKey && (
          <TurnstileWidget
            key={captchaKey}
            siteKey={siteKey}
            onToken={(captchaToken) => void send(captchaToken)}
            onError={() => setNotice(CHECK_UNAVAILABLE)}
          />
        )}

        {notice && (
          <p role="alert" className="text-body-sm text-status-danger">
            {notice}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
          Send referral
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Mount the route**

In `apps/app/src/features/portal/pages/PortalRoot.tsx`, add the import:

```tsx
import { PortalPublicFormPage } from "./PortalPublicFormPage";
```

and add the route right after the `invite` route (outside the signed-in layout):

```tsx
          <Route path="refer/:token" element={<PortalPublicFormPage slug={slug} brand={data} />} />
```

Update the file's header comment, adding one line after the branding paragraph:

```tsx
 * The public referral form (Phase 2B-1) lives at refer/:token and needs no session.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/portal/pages/PortalPublicFormPage.test.tsx src/features/portal/pages/PortalRoot.test.tsx`
Expected: PASS, no `act()` warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/portal/pages/PortalPublicFormPage.tsx apps/app/src/features/portal/pages/PortalPublicFormPage.test.tsx apps/app/src/features/portal/pages/PortalRoot.tsx
git commit -m "$(cat <<'EOF'
feat(portal): public referral form page with on-demand bot check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 10: String audit covers the public form

**Files:**
- Modify: `apps/app/src/features/portal/portalStringAudit.test.tsx`

**Interfaces:**
- Consumes: `handlePortalRequest`, `type PortalApiDeps`, `type PortalRpcResult` (`_shared/portalApi.ts`); `PUBLIC_HONEYPOT_FIELD`, `signFormToken` (Task 4); `PortalPublicFormPage` through `PortalRoot` (Task 9); existing helpers in the file (`auditJson`, `expectCleanScreen`, `renderAt`, `memoryStorage`, `SECRET`, `FORBIDDEN_WORDS`, `FORBIDDEN_VALUES`).
- Produces: no new code; tests only.

- [ ] **Step 1: Extend the audit**

In `apps/app/src/features/portal/portalStringAudit.test.tsx`:

Add to the imports:

```ts
import { PUBLIC_HONEYPOT_FIELD, signFormToken } from "../../../../../supabase/functions/_shared/portalPublicForm";
```

Add to the hoisted `api` object:

```ts
  publicForm: vi.fn(),
  publicSubmit: vi.fn(),
```

Add a module mock for the send guard, next to the existing `vi.mock("./lib/portalApi", ...)`:

```ts
vi.mock("./lib/publicFormTiming", () => ({ waitForFormAge: () => Promise.resolve() }));
```

Add `"portal_public"` to `FORBIDDEN_VALUES` (after `"portal_signed_in"`), and extend `FORBIDDEN_WORDS` with `|portal_public` right after `portal_signed_in`.

Append a new block after the `describe("portal_api responses", ...)` block:

```ts
describe("public referral form: responses", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const SIGNING = "audit-signing-secret";
  const REP_EMAIL = "rita@acme.example";

  function publicDeps() {
    const rpc = vi.fn(async (name: string): Promise<PortalRpcResult> => {
      switch (name) {
        case "portal_public_form":
          return {
            data: [
              {
                org_name: "Acme ISO",
                rep_name: "Rita Rep",
                consent_text: "I may share this.",
                consent_version: 2,
                org_id: SECRET,
                user_id: SECRET,
                token: SECRET,
                email: REP_EMAIL,
                status: "submitted",
              },
            ],
            error: null,
          };
        case "portal_public_rate":
          return { data: 0, error: null };
        case "portal_public_submit":
          return {
            data: [
              {
                id: "1a2b3c4d-0000-0000-0000-000000000000",
                ref: "REF-1A2B3C4D",
                org_name: "Acme ISO",
                logo_url: null,
                primary_color: null,
                assigned_user_id: SECRET,
                source: "portal_public",
              },
            ],
            error: null,
          };
        default:
          return { data: null, error: { message: `unexpected ${name}` } };
      }
    });
    const sendEmail = vi.fn(async (_msg: { from: string; to: string; subject: string; html: string; text: string }) => {});
    const deps: PortalApiDeps = {
      rpc,
      sendEmail,
      now: () => new Date(NOW),
      env: {
        appBaseUrl: "https://app.getnavigatr.io",
        fromAddress: "navigatr <invites@send.getnavigatr.io>",
        appEnv: "production",
        emailAllowlist: "",
        publicFormSigningSecret: SIGNING,
      },
    };
    return { deps, sendEmail };
  }

  async function post(deps: PortalApiDeps, action: string, body: Record<string, unknown>) {
    const res = await handlePortalRequest(
      new Request(`https://proj.supabase.co/functions/v1/portal_api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      deps,
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function submitBody(overrides: Record<string, unknown> = {}) {
    return {
      slug: "acme",
      token: "tok123",
      companyName: "Fresh Bakery",
      contactName: "Ann Owner",
      email: "ann@bakery.example",
      phone: "5550100100",
      notes: `${SECRET} typed by the submitter`,
      referredBy: "Joe",
      referrerEmail: "joe@bank.example",
      consent: true,
      consentVersion: 2,
      formToken: await signFormToken(SIGNING, "acme", "tok123", NOW - 10_000),
      [PUBLIC_HONEYPOT_FIELD]: "",
      ...overrides,
    };
  }

  it("the form carries only the five public fields", async () => {
    const { status, json } = await post(publicDeps().deps, "public_form", { slug: "acme", token: "tok123" });
    expect(status).toBe(200);
    auditJson(json);
    const form = json.form as Record<string, unknown>;
    expect(Object.keys(form).sort()).toEqual(["consentText", "consentVersion", "formToken", "orgName", "repName"]);
    expect(JSON.stringify(json)).not.toContain(REP_EMAIL);
    expect(JSON.stringify(json)).not.toMatch(/navigatr/i);
  });

  it("a real submission and a bot's look exactly alike", async () => {
    const real = await post(publicDeps().deps, "public_submit", await submitBody());
    const bot = await post(publicDeps().deps, "public_submit", await submitBody({ [PUBLIC_HONEYPOT_FIELD]: "spam" }));
    for (const r of [real, bot]) {
      expect(r.status).toBe(200);
      auditJson(r.json);
      expect(Object.keys(r.json)).toEqual(["submission"]);
      expect(Object.keys(r.json.submission as object)).toEqual(["ref"]);
      expect((r.json.submission as { ref: string }).ref).toMatch(/^REF-[0-9A-F]{8}$/);
      expect(JSON.stringify(r.json)).not.toMatch(/navigatr/i);
    }
  });

  it("the confirmation email carries no submitter text and no internal word", async () => {
    const { deps, sendEmail } = publicDeps();
    await post(deps, "public_submit", await submitBody());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("joe@bank.example");
    expect(`${msg.subject} ${msg.text} ${msg.html}`).not.toContain("ann@bakery.example");
    for (const part of [msg.subject, msg.text]) {
      expect(part.match(FORBIDDEN_WORDS)).toBeNull();
      expect(part).not.toContain(SECRET);
      expect(part).not.toContain("Fresh Bakery");
      expect(part).not.toContain("Joe");
    }
    expect(msg.html).not.toContain(SECRET);
    expect(msg.html.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
    expect(msg.text.replace(POWERED_BY, "")).not.toMatch(/navigatr/i);
  });
});
```

Append inside the existing `describe("rendered portal pages: UI copy audit", ...)` block:

```ts
  it("public form and its confirmation", async () => {
    const user = userEvent.setup();
    api.publicForm.mockResolvedValue({
      orgName: "Acme ISO",
      repName: "Rita Rep",
      consentText: "I may share this.",
      consentVersion: 2,
      formToken: "1.ab",
    });
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt("/p/acme/refer/tok123");
    await screen.findByRole("heading", { name: "Refer a business to Acme ISO" });
    expectCleanScreen();

    await user.type(screen.getByLabelText("Business name"), "Fresh Bakery");
    await user.type(screen.getByLabelText("Contact name"), "Ann");
    await user.type(screen.getByLabelText("Email"), "ann@bakery.example");
    await user.type(screen.getByLabelText("Phone"), "5550100100");
    await user.type(screen.getByLabelText("Notes"), "Needs a terminal.");
    await user.click(screen.getByRole("checkbox", { name: "I may share this." }));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await screen.findByRole("heading", { name: "Thanks for the referral" });
    expectCleanScreen();
  });

  it("public form unavailable", async () => {
    api.publicForm.mockResolvedValue(null);
    renderAt("/p/acme/refer/old");
    await screen.findByRole("heading", { name: "This form isn't available" });
    expectCleanScreen();
  });
```

- [ ] **Step 2: Run the audit**

Run: `pnpm --filter app test -- src/features/portal/portalStringAudit.test.tsx`
Expected: PASS. If a rendered assertion fails, fix the copy in `PortalPublicFormPage.tsx` (never loosen the audit).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/portal/portalStringAudit.test.tsx
git commit -m "$(cat <<'EOF'
test(portal): string audit covers the public referral form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rep app plumbing: form address, QR image, link hooks

**Files:**
- Modify: `apps/app/src/features/portal/lib/portalAddress.ts`
- Test: `apps/app/src/features/portal/lib/portalAddress.test.ts`
- Create: `apps/app/src/features/partners/lib/referralQr.ts`
- Test: `apps/app/src/features/partners/lib/referralQr.test.ts`
- Create: `apps/app/src/features/partners/hooks/useReferralLinks.ts`
- Test: `apps/app/src/features/partners/hooks/useReferralLinks.test.tsx`
- Modify: `apps/app/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `portalAddress(slug, origin?)` (`features/portal/lib/portalAddress.ts`); Task 2 RPCs `get_my_referral_link`, `get_tenant_referral_link`, `regenerate_referral_link`; `supabase` (`@/lib/supabase`); `useAuth` (`@/stores/auth`).
- Produces (TS):
  - `export function referralFormAddress(slug: string, token: string, origin?: string): string` (`<origin>/p/<slug>/refer/<token>`).
  - `features/partners/lib/referralQr.ts`: `export function referralQrDataUrl(url: string): Promise<string>` (PNG data URL, 512px, dynamic `import("qrcode")`); `export function referralQrFileName(linkType: "user" | "tenant"): string`.
  - `features/partners/hooks/useReferralLinks.ts`: `export type ReferralLinkType = "user" | "tenant"`; `export interface ReferralLink { enabled: boolean; slug: string; token: string | null }`; `export function toReferralLink(data: unknown): ReferralLink | null`; `export const REFERRAL_LINK_QUERY_KEY: (kind: ReferralLinkType, userId?: string) => readonly ["referral-links", ReferralLinkType, string]`; `export function useMyReferralLink()`; `export function useTenantReferralLink(enabled: boolean)`; `export function useRegenerateReferralLink()` (mutation input `{ linkType: ReferralLinkType }`, resolves to the new token, invalidates `["referral-links"]`, errors are `Error` with rep-facing copy).

- [ ] **Step 1: Add the QR dependency**

Run: `pnpm --filter app add qrcode@1.5.4 && pnpm --filter app add -D @types/qrcode@1.5.5`
Expected: `apps/app/package.json` lists `"qrcode": "1.5.4"` (or `^1.5.4`) under dependencies and `@types/qrcode` under devDependencies; `pnpm-lock.yaml` updated. Pin the exact version: edit `apps/app/package.json` so both read exactly `"1.5.4"` and `"1.5.5"` (no caret), then run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

Append to `apps/app/src/features/portal/lib/portalAddress.test.ts` (and add `referralFormAddress` to its import):

```ts
describe("referralFormAddress", () => {
  it("builds the public form address for a link", () => {
    expect(referralFormAddress("acme", "aB3_-xYz", "https://app.getnavigatr.io/")).toBe(
      "https://app.getnavigatr.io/p/acme/refer/aB3_-xYz",
    );
  });

  it("defaults to the current origin and encodes the parts", () => {
    expect(referralFormAddress("acme co", "t/1")).toBe(`${window.location.origin}/p/acme%20co/refer/t%2F1`);
  });
});
```

Create `apps/app/src/features/partners/lib/referralQr.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL } }));

import { referralQrDataUrl, referralQrFileName } from "./referralQr";

describe("referralQrDataUrl", () => {
  it("draws a 512px PNG for the address", async () => {
    toDataURL.mockResolvedValueOnce("data:image/png;base64,AAAA");
    await expect(referralQrDataUrl("https://app.getnavigatr.io/p/acme/refer/tok")).resolves.toBe("data:image/png;base64,AAAA");
    expect(toDataURL).toHaveBeenCalledWith("https://app.getnavigatr.io/p/acme/refer/tok", {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  });
});

describe("referralQrDataUrl without a default export", () => {
  it("uses the namespace's own toDataURL", async () => {
    const named = vi.fn(async () => "data:image/png;base64,BBBB");
    vi.resetModules();
    vi.doMock("qrcode", () => ({ toDataURL: named }));
    const fresh = await import("./referralQr");
    await expect(fresh.referralQrDataUrl("https://x.example/p/a/refer/t")).resolves.toBe("data:image/png;base64,BBBB");
    expect(named).toHaveBeenCalledTimes(1);
    vi.doUnmock("qrcode");
  });
});

describe("referralQrFileName", () => {
  it("names the personal and the company QR images", () => {
    expect(referralQrFileName("user")).toBe("my-referral-qr.png");
    expect(referralQrFileName("tenant")).toBe("company-referral-qr.png");
  });
});
```

Create `apps/app/src/features/partners/hooks/useReferralLinks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
const auth = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: auth.user }),
}));

import {
  REFERRAL_LINK_QUERY_KEY,
  toReferralLink,
  useMyReferralLink,
  useRegenerateReferralLink,
  useTenantReferralLink,
} from "./useReferralLinks";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  rpcMock.mockReset();
  auth.user = { id: "user-1" };
});

describe("toReferralLink", () => {
  it("maps the first row, and null for nothing", () => {
    expect(toReferralLink([{ link_token: "tok", org_slug: "acme", public_form_enabled: true }])).toEqual({
      enabled: true,
      slug: "acme",
      token: "tok",
    });
    expect(toReferralLink({ link_token: null, org_slug: "acme", public_form_enabled: false })).toEqual({
      enabled: false,
      slug: "acme",
      token: null,
    });
    expect(toReferralLink([])).toBeNull();
    expect(toReferralLink(null)).toBeNull();
  });
});

describe("useMyReferralLink", () => {
  it("asks for the caller's link once signed in", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ link_token: "tok", org_slug: "acme", public_form_enabled: true }], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyReferralLink(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_my_referral_link");
    expect(result.current.data).toEqual({ enabled: true, slug: "acme", token: "tok" });
  });

  it("does nothing while signed out, and surfaces an error", async () => {
    auth.user = null;
    const { wrapper } = setup();
    renderHook(() => useMyReferralLink(), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();

    auth.user = { id: "user-1" };
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useMyReferralLink(), { wrapper: setup().wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useTenantReferralLink", () => {
  it("asks only when enabled (administrators with the sheet open)", async () => {
    const { wrapper } = setup();
    renderHook(() => useTenantReferralLink(false), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValueOnce({ data: [{ link_token: "ten", org_slug: "acme", public_form_enabled: true }], error: null });
    const { result } = renderHook(() => useTenantReferralLink(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_tenant_referral_link");
    expect(result.current.data?.token).toBe("ten");
  });
});

describe("useRegenerateReferralLink", () => {
  it("retires the link, returns the new one and refreshes both links", async () => {
    rpcMock.mockResolvedValueOnce({ data: "newtok", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useRegenerateReferralLink(), { wrapper });
    await expect(result.current.mutateAsync({ linkType: "tenant" })).resolves.toBe("newtok");
    expect(rpcMock).toHaveBeenCalledWith("regenerate_referral_link", { p_link_type: "tenant" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["referral-links"] });
  });

  it("explains a refusal and any other failure", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRegenerateReferralLink(), { wrapper });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    await expect(result.current.mutateAsync({ linkType: "user" })).rejects.toThrow("You don't have access to do that.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(result.current.mutateAsync({ linkType: "user" })).rejects.toThrow("Couldn't get a new link. Try again.");
  });
});

describe("REFERRAL_LINK_QUERY_KEY", () => {
  it("keys by kind and user", () => {
    expect(REFERRAL_LINK_QUERY_KEY("user", "u-1")).toEqual(["referral-links", "user", "u-1"]);
    expect(REFERRAL_LINK_QUERY_KEY("tenant")).toEqual(["referral-links", "tenant", "anon"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/portal/lib/portalAddress.test.ts src/features/partners/lib/referralQr.test.ts src/features/partners/hooks/useReferralLinks.test.tsx`
Expected: FAIL (`referralFormAddress` is not exported; the two new modules are missing).

- [ ] **Step 4: Write the code**

Append to `apps/app/src/features/portal/lib/portalAddress.ts`:

```ts
/** A public referral form address (Phase 2B-1, FR-PORT-24): <origin>/p/<slug>/refer/<token>. */
export function referralFormAddress(slug: string, token: string, origin: string = window.location.origin): string {
  return `${portalAddress(slug, origin)}/refer/${encodeURIComponent(token)}`;
}
```

Create `apps/app/src/features/partners/lib/referralQr.ts`:

```ts
/**
 * QR images for the public referral form links (FR-PORT-24). The qrcode
 * library is imported on demand, so it is a separate chunk fetched only when
 * a rep opens the Share sheet.
 */
export async function referralQrDataUrl(url: string): Promise<string> {
  const mod = await import("qrcode");
  // qrcode is CommonJS: depending on the bundler's interop the functions sit on
  // the namespace or on its default export.
  const lib = (mod as { default?: typeof mod }).default ?? mod;
  return lib.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: "M" });
}

export function referralQrFileName(linkType: "user" | "tenant"): string {
  return linkType === "tenant" ? "company-referral-qr.png" : "my-referral-qr.png";
}
```

Create `apps/app/src/features/partners/hooks/useReferralLinks.ts`:

```ts
/**
 * Public referral form links (Phase 2B-1, FR-PORT-24..27). Every active user
 * has a personal link; administrators also have the company link. While the
 * ISO has the public form off, the server answers enabled: false with no
 * token and creates nothing, and the app shows no Share button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type ReferralLinkType = "user" | "tenant";

export interface ReferralLink {
  enabled: boolean;
  slug: string;
  token: string | null;
}

interface LinkRow {
  link_token: string | null;
  org_slug: string;
  public_form_enabled: boolean;
}

export const REFERRAL_LINK_QUERY_KEY = (kind: ReferralLinkType, userId?: string) =>
  ["referral-links", kind, userId ?? "anon"] as const;

export function toReferralLink(data: unknown): ReferralLink | null {
  const row = (Array.isArray(data) ? data[0] : data) as LinkRow | null | undefined;
  if (!row || typeof row !== "object") return null;
  return { enabled: row.public_form_enabled === true, slug: row.org_slug, token: row.link_token ?? null };
}

export function useMyReferralLink() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_LINK_QUERY_KEY("user", userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<ReferralLink | null> => {
      const { data, error } = await supabase.rpc("get_my_referral_link");
      if (error) throw error;
      return toReferralLink(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useTenantReferralLink(enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_LINK_QUERY_KEY("tenant", userId),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReferralLink | null> => {
      const { data, error } = await supabase.rpc("get_tenant_referral_link");
      if (error) throw error;
      return toReferralLink(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function useRegenerateReferralLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkType: ReferralLinkType }): Promise<string> => {
      const { data, error } = await supabase.rpc("regenerate_referral_link", { p_link_type: input.linkType });
      if (error) {
        throw new Error(
          error.message.includes("not_authorized") ? "You don't have access to do that." : "Couldn't get a new link. Try again.",
        );
      }
      return typeof data === "string" ? data : "";
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["referral-links"] });
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass, and typecheck**

Run: `pnpm --filter app test -- src/features/portal/lib/portalAddress.test.ts src/features/partners/lib/referralQr.test.ts src/features/partners/hooks/useReferralLinks.test.tsx`
Expected: PASS.

Run: `pnpm --filter app exec tsc -b`
Expected: exits 0. (`@/lib/supabase` is an untyped `createClient`, so new RPC names need no generated types, the same as `list_referral_assignees` in `useReassignReferral.ts`.)

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/src/features/portal/lib/portalAddress.ts apps/app/src/features/portal/lib/portalAddress.test.ts apps/app/src/features/partners/lib/referralQr.ts apps/app/src/features/partners/lib/referralQr.test.ts apps/app/src/features/partners/hooks/useReferralLinks.ts apps/app/src/features/partners/hooks/useReferralLinks.test.tsx
git commit -m "$(cat <<'EOF'
feat(partners): referral form addresses, QR images and link hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 12: Share referral form sheet on the Partners page (rep app)

**Files:**
- Create: `apps/app/src/features/partners/components/ShareReferralForm.tsx`
- Test: `apps/app/src/features/partners/components/ShareReferralForm.test.tsx`
- Modify: `apps/app/src/features/partners/pages/PartnersPage.tsx`

**Interfaces:**
- Consumes: `useMyReferralLink`, `useTenantReferralLink`, `useRegenerateReferralLink`, `type ReferralLink`, `type ReferralLinkType` (Task 11); `referralFormAddress` (Task 11); `referralQrDataUrl`, `referralQrFileName` (Task 11); `useProfile` (`@/features/auth/useProfile`, `role_level`); `Button` (`@/components/navigatr`); `@radix-ui/react-dialog`; `toast` (`sonner`).
- Produces (TS): `export function ShareReferralFormButton(): JSX.Element | null` (renders nothing unless the public form is on); `export function ShareReferralFormSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element`. `PartnersPage` renders `ShareReferralFormButton` beside the "Partners" heading (visible on phone and desktop).

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/partners/components/ShareReferralForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  mine: { data: { enabled: true, slug: "acme", token: "myTok123" } as { enabled: boolean; slug: string; token: string | null } | null | undefined },
  tenant: { data: { enabled: true, slug: "acme", token: "coTok456" } as { enabled: boolean; slug: string; token: string | null } | null | undefined },
  tenantEnabled: [] as boolean[],
  roleLevel: "sales_professional",
  regenerate: vi.fn(),
  qr: vi.fn(),
}));
vi.mock("../hooks/useReferralLinks", () => ({
  useMyReferralLink: () => state.mine,
  useTenantReferralLink: (enabled: boolean) => {
    state.tenantEnabled.push(enabled);
    return enabled ? state.tenant : { data: undefined };
  },
  useRegenerateReferralLink: () => ({ mutateAsync: state.regenerate, isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role_level: state.roleLevel } }) }));
vi.mock("../lib/referralQr", () => ({
  referralQrDataUrl: (url: string) => state.qr(url),
  referralQrFileName: (t: string) => (t === "tenant" ? "company-referral-qr.png" : "my-referral-qr.png"),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { ShareReferralFormButton } from "./ShareReferralForm";

const MY_URL = `${window.location.origin}/p/acme/refer/myTok123`;
const CO_URL = `${window.location.origin}/p/acme/refer/coTok456`;
const writeText = vi.fn();
const origShare = (navigator as { share?: unknown }).share;
const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  state.mine = { data: { enabled: true, slug: "acme", token: "myTok123" } };
  state.tenant = { data: { enabled: true, slug: "acme", token: "coTok456" } };
  state.tenantEnabled = [];
  state.roleLevel = "sales_professional";
  state.regenerate.mockReset();
  state.qr.mockReset();
  state.qr.mockImplementation(async (url: string) => `data:image/png;base64,${btoa(url)}`);
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
  if (origClipboard) Object.defineProperty(navigator, "clipboard", origClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

// userEvent.setup() installs its own clipboard stub, so ours goes in after it.
async function open() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<ShareReferralFormButton />);
  await user.click(screen.getByRole("button", { name: "Share referral form" }));
  return user;
}

describe("ShareReferralFormButton", () => {
  it("is hidden while the ISO has the public form off, or before the link loads", () => {
    state.mine = { data: { enabled: false, slug: "acme", token: null } };
    const off = render(<ShareReferralFormButton />);
    expect(screen.queryByRole("button", { name: "Share referral form" })).toBeNull();
    off.unmount();
    state.mine = { data: undefined };
    render(<ShareReferralFormButton />);
    expect(screen.queryByRole("button", { name: "Share referral form" })).toBeNull();
  });

  it("shows the rep's link, its QR code and a download", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Share referral form" })).toBeInTheDocument();
    expect(screen.getByText(MY_URL)).toBeInTheDocument();
    const img = await screen.findByRole("img", { name: "QR code for your link" });
    expect(img).toHaveAttribute("src", `data:image/png;base64,${btoa(MY_URL)}`);
    const download = screen.getByRole("link", { name: "Download QR" });
    expect(download).toHaveAttribute("download", "my-referral-qr.png");
    expect(download).toHaveAttribute("href", `data:image/png;base64,${btoa(MY_URL)}`);
    expect(screen.queryByText(CO_URL)).toBeNull();
    expect(state.tenantEnabled.every((e) => e === false)).toBe(true);
  });

  it("copies the link", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(MY_URL);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied.");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't copy. Press and hold the link to copy it."));
  });

  it("uses the phone's share sheet when there is one, and copies otherwise", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith(MY_URL);

    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    writeText.mockClear();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ title: "Referral form", url: MY_URL });
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new Error("not allowed"));
    await user.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MY_URL));
  });

  it("gets a new link only after confirming", async () => {
    state.regenerate.mockResolvedValueOnce("newTok");
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    expect(screen.getByText("Get a new link? Your old link and QR code stop working right away.")).toBeInTheDocument();
    expect(state.regenerate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.regenerate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    expect(state.regenerate).toHaveBeenCalledWith({ linkType: "user" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("New link ready. The old one no longer works."));
  });

  it("explains a refused new link", async () => {
    state.regenerate.mockRejectedValueOnce(new Error("You don't have access to do that."));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Get a new link" }));
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You don't have access to do that."));
  });

  it("gives administrators the company link with its own QR and new link", async () => {
    state.roleLevel = "administrator";
    state.regenerate.mockResolvedValue("x");
    const user = await open();
    expect(screen.getByText(CO_URL)).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "QR code for the company link" })).toBeInTheDocument();
    const downloads = screen.getAllByRole("link", { name: "Download QR" });
    expect(downloads.map((a) => a.getAttribute("download"))).toEqual(["my-referral-qr.png", "company-referral-qr.png"]);
    const getNew = screen.getAllByRole("button", { name: "Get a new link" });
    await user.click(getNew[1]);
    expect(screen.getByText("Get a new company link? The old link and QR code stop working right away.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get new link" }));
    expect(state.regenerate).toHaveBeenCalledWith({ linkType: "tenant" });
  });

  it("keeps the sheet usable when the QR image cannot be drawn", async () => {
    state.qr.mockRejectedValue(new Error("canvas"));
    await open();
    expect(screen.getByText(MY_URL)).toBeInTheDocument();
    await waitFor(() => expect(state.qr).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Download QR" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/components/ShareReferralForm.test.tsx`
Expected: FAIL with `Failed to resolve import "./ShareReferralForm"`.

- [ ] **Step 3: Write the sheet**

Create `apps/app/src/features/partners/components/ShareReferralForm.tsx`:

```tsx
/**
 * Share referral form (Partner Portal Phase 2B-1, FR-PORT-24, 26, 27). A rep
 * shares their personal public form link as a link, an on-screen QR code, a
 * downloadable QR image or through the phone's share sheet. Administrators
 * also get the company link for the website and printed material. "Get a new
 * link" retires the old link and QR code.
 *
 * Shown only while the ISO has the public form on (FR-PORT-28); the server
 * answers enabled: false otherwise.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Download, Loader2, QrCode, RefreshCw, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { referralFormAddress } from "@/features/portal/lib/portalAddress";
import {
  useMyReferralLink,
  useRegenerateReferralLink,
  useTenantReferralLink,
  type ReferralLink,
  type ReferralLinkType,
} from "../hooks/useReferralLinks";
import { referralQrDataUrl, referralQrFileName } from "../lib/referralQr";

export function ShareReferralFormButton() {
  const link = useMyReferralLink();
  const [open, setOpen] = React.useState(false);
  if (!link.data?.enabled) return null;
  return (
    <>
      <Button variant="secondary" size="md" leadingIcon={QrCode} onClick={() => setOpen(true)}>
        Share referral form
      </Button>
      <ShareReferralFormSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ShareReferralFormSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mine = useMyReferralLink();
  const isAdmin = useProfile().data?.role_level === "administrator";
  const tenant = useTenantReferralLink(open && isAdmin);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-5 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 text-text-default shadow-card-hover sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg sm:max-h-[85vh]"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Share referral form</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-radius-sm text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <p className="text-body-sm text-text-muted">
            Anyone with this link can send you a business. No sign-in needed.
          </p>
          <ReferralLinkPanel
            title="Your link"
            qrAlt="QR code for your link"
            description="Referrals sent through this link come to you."
            confirmText="Get a new link? Your old link and QR code stop working right away."
            linkType="user"
            link={mine.data}
          />
          {isAdmin && (
            <ReferralLinkPanel
              title="Company link"
              qrAlt="QR code for the company link"
              description="For your website and printed material. Referrals go to the administrator queue."
              confirmText="Get a new company link? The old link and QR code stop working right away."
              linkType="tenant"
              link={tenant.data}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReferralLinkPanel({
  title,
  qrAlt,
  description,
  confirmText,
  linkType,
  link,
}: {
  title: string;
  qrAlt: string;
  description: string;
  confirmText: string;
  linkType: ReferralLinkType;
  link: ReferralLink | null | undefined;
}) {
  const regenerate = useRegenerateReferralLink();
  const [confirming, setConfirming] = React.useState(false);
  const [qr, setQr] = React.useState<string | null>(null);
  const url = link?.token ? referralFormAddress(link.slug, link.token) : null;

  React.useEffect(() => {
    setQr(null);
    if (!url) return;
    let live = true;
    referralQrDataUrl(url).then(
      (dataUrl) => {
        if (live) setQr(dataUrl);
      },
      () => {
        if (live) setQr(null);
      },
    );
    return () => {
      live = false;
    };
  }, [url]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  };

  const share = async () => {
    if (!url) return;
    if (typeof navigator.share !== "function") {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "Referral form", url });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) await copy();
    }
  };

  const getNew = async () => {
    try {
      await regenerate.mutateAsync({ linkType });
      toast.success("New link ready. The old one no longer works.");
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't get a new link. Try again.");
    }
  };

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body-strong text-text-default">{title}</h3>
        <p className="text-body-sm text-text-muted">{description}</p>
      </div>
      {link === undefined && <Loader2 className="h-5 w-5 animate-spin text-text-subtle" aria-label="Loading" />}
      {url && (
        <>
          <p className="break-all rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-default">{url}</p>
          {qr ? (
            <img src={qr} alt={qrAlt} className="mx-auto h-48 w-48 rounded-radius-md bg-white p-2" />
          ) : (
            <div className="mx-auto h-48 w-48 rounded-radius-md bg-surface-sunken" aria-hidden />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" leadingIcon={Copy} onClick={() => void copy()}>
              Copy link
            </Button>
            <Button variant="secondary" size="lg" leadingIcon={Share2} onClick={() => void share()}>
              Share
            </Button>
          </div>
          {qr && (
            <a
              href={qr}
              download={referralQrFileName(linkType)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-radius-md border border-border-default text-body-sm text-text-default hover:bg-surface-sunken"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download QR
            </a>
          )}
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-text-default">{confirmText}</p>
              <div className="flex gap-2">
                <Button variant="destructive" size="lg" loading={regenerate.isPending} onClick={() => void getNew()}>
                  Get new link
                </Button>
                <Button variant="tertiary" size="lg" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="tertiary" size="lg" leadingIcon={RefreshCw} onClick={() => setConfirming(true)}>
              Get a new link
            </Button>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Put the button on the Partners page**

In `apps/app/src/features/partners/pages/PartnersPage.tsx`, add the import next to the other component imports:

```tsx
import { ShareReferralFormButton } from "../components/ShareReferralForm";
```

Replace the heading line inside the header's title column:

```tsx
            <h1 className="text-heading-lg text-text-default">Partners</h1>
```

with:

```tsx
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-heading-lg text-text-default">Partners</h1>
              <ShareReferralFormButton />
            </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/components/ShareReferralForm.test.tsx src/features/partners/pages/PartnersPage.regression-001.test.tsx`
Expected: PASS. (The regression test renders with no signed-in user, so `useMyReferralLink` stays disabled and the button does not render.)

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/partners/components/ShareReferralForm.tsx apps/app/src/features/partners/components/ShareReferralForm.test.tsx apps/app/src/features/partners/pages/PartnersPage.tsx
git commit -m "$(cat <<'EOF'
feat(partners): Share referral form sheet with link, QR, download and new link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification, push, PR to main (the controller runs this task)

**Files:** none changed.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (`057` and `058` included, `001` to `056` still passing), the documented SKIPs unchanged.

- [ ] **Step 2: Full frontend and `_shared` suite**

Run: `pnpm --filter app test`
Expected: all PASS, coverage thresholds met, no `act()` warnings from the new files, no snapshot written.

- [ ] **Step 3: Real production build, and the QR chunk is separate**

Run: `pnpm --filter app build`
Expected: exits 0.

Run: `grep -l "toDataURL" apps/app/dist/assets/*.js | xargs -n1 basename`
Expected: the `qrcode` code is in its own chunk, not in the main `index-*.js` entry chunk.

- [ ] **Step 4: Deno typecheck and the secrets audit**

Run:

```bash
for f in portal_api portal_notify portal_invite send_auth_email; do
  NO_COLOR=1 deno check --no-lock --config supabase/functions/$f/deno.json supabase/functions/$f/index.ts || echo "FAILED $f"
done
node tools/check-secrets.mjs --audit
```

Expected: no `FAILED` line; `Manifest covers every secret the function code reads.`

- [ ] **Step 5: No long dashes on added lines; the portal never uses the app session**

Run: `git diff origin/main...HEAD | perl -CSD -ne 'print if /^\+/ && /[\x{2013}\x{2014}]/'`
Expected: no output.

Run: `grep -rn "supabase.functions.invoke\|supabase.auth" apps/app/src/features/portal --include='*.ts' --include='*.tsx' | grep -v "\.test\."`
Expected: no output.

Run: `grep -rn "navigatr" apps/app/src/features/portal/pages/PortalPublicFormPage.tsx supabase/functions/_shared/portalPublicForm.ts`
Expected: no output.

- [ ] **Step 6: Push and open the PR (do not merge)**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal 2B-1: referral form links and public intake" --body "$(cat <<'EOF'
## Summary
- Every rep has a personal public referral form link, and administrators have one company link (for the website and printed material). The Partners page gets a "Share referral form" button: copy the link, show a QR code, download the QR image, share through the phone, or get a new link (the old one stops working).
- Anyone with a link can send a business without signing in: company, contact name, email, phone and notes are required, "Who referred this business?" is optional, plus the ISO's consent line. They see a reference number. If they fill in the optional "Your email", that address (never the business's) gets a confirmation email that says only the ISO's name and that reference.
- Bot protection people never notice: a hidden trap field, a minimum of 3 seconds to fill the form, and a limit of 5 per hour per connection. Past that, a Cloudflare Turnstile check appears (its script loads only then). Past 30 an hour, nothing goes through.
- A referral through a rep's link goes to that rep, or to their manager if the rep is deactivated or unplaced, or to the administrator queue. The company link goes to the administrator queue. Submissions are stored separately from referrals until 2B-2 adds triage.
- Nothing about whether the business is already known ever reaches the public form (no duplicate check at intake).
- Ships dark: the public form switch defaults to off and has no UI until 2B-2, so no customer sees anything yet.

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (section 9)
Plan: docs/superpowers/plans/2026-10-18-partner-portal-2b1-public-intake.md

## Setup per environment (before merging: the staging deploy checks secrets)
- Edge Function secrets on staging, demo and production: `PUBLIC_FORM_SIGNING_SECRET` (a fresh random value per project) and `TURNSTILE_SECRET_KEY` (Cloudflare test secret on staging and demo until the real site exists).
- Vercel: `VITE_TURNSTILE_SITE_KEY` (test site key on Preview, real key on Production).

## Deviations (details in the plan)
- Routing a partner's referral now goes through a new per-user routing helper; behavior is unchanged.
- The rep's name shows on the form only when the referral will reach that rep.
- Submissions also store the consent wording and version, like portal referrals.
- A form left open over 24 hours asks the person to send again instead of silently dropping it; only too-fast and trap-field posts get the silent fake success, and the page waits until it is safe to send.
- The confirmation goes only to a new optional "Your email" field (stored as referrer_email), never to the business contact; no email given means no confirmation email.
- The confirmation email has no button, so the shared email template's button became optional (existing emails are byte-identical).

## Not in this PR
- The admin "Public referral form" switch, the Unattributed Submissions triage queue, attribution, submission nudges, purge of submissions (2B-2). Referrals sent to you, partner note-back, weekly digest (2B-3).

## Test plan
- [ ] DB tests 057 and 058 pass in CI from an empty database, with 001 to 056 unchanged
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass; `node tools/check-secrets.mjs --audit` passes
- [ ] Staging (after 2B-2 or a staging-only switch): open Partners, Share referral form, scan the QR on a phone, send a referral; the confirmation shows a reference
- [ ] Staging: send 6 referrals from one connection; the sixth shows the Turnstile check and goes through after it
- [ ] Staging: Get a new link, then open the old QR; it says the form isn't available

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
| 1 | Enum values `portal_public`, `public_submit`, `link_regenerate` |
| 2 | `public_form_enabled`, `referral_form_links`, `referral_route_user`, link RPCs (get mine, get tenant, regenerate) |
| 3 | `referral_form_submissions` + RLS, `portal_public_form`, `portal_public_submit` (routing, 30/hour cap), `portal_public_rate` |
| 4 | Pure rules: validation, signed form token, fake reference, Turnstile verify |
| 5 | Optional email button; public confirmation email |
| 6 | `portal_api` actions `public_form`, `public_submit`; secrets wired and declared |
| 7 | Client `publicForm`, `publicSubmit` |
| 8 | Turnstile loader and widget; 3.5 second send guard |
| 9 | Public form page at `/p/:slug/refer/:token` |
| 10 | String audit over public responses, page and email |
| 11 | `referralFormAddress`, QR image helper (`qrcode@1.5.4`), link hooks |
| 12 | Share referral form sheet on the Partners page |
| 13 | Verification, push, PR |
