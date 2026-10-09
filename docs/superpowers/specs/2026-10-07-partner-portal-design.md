# Partner Portal: design (Phase 0 + Phase 1)

Date: 2026-10-07
Source PRD: navigatr PRD Addendum, Partner Portal v1.0 (Robert, 22 Sept 2026), FR-PORT-06 to FR-PORT-95
Status: design approved in chat (Ryan, 2026-10-07); Robert agreed to all review recommendations (2026-10-07)
Driver: beta ISOs Elavon and Propelr have both asked for the portal.

## 1. What this is

External referral partners (CPAs, bankers, payroll providers) sign in to a tenant-branded portal,
submit businesses to the ISO's reps, and watch a simplified status for each referral. Inside the
app, reps triage those referrals (Accept, Decline, Merge) and choose what, if anything, the partner
gets to read.

This spec covers two phases that ship back to back:

- **Phase 0, in-app foundation.** A real Referral object with status and immutable history,
  in-app triage, correct lead source, first follow-up task, and the partner-link visibility fix. No
  partner-facing surface yet. Useful to beta reps on its own.
- **Phase 1, the portal.** Separate partner sign-in, branded portal, submission, partner
  dashboard/list/detail, "Share update with partner", partner and internal emails, same-day nudge.

Phase 2 (public form + per-rep QR links, "Referrals sent to you" with note-back, 90-day purge job,
CSV export, weekly digest, Firms) gets its own spec later. Section 9 lists it so nothing is lost.

## 2. Decisions that override the PRD

Each was raised in the 2026-10-06 review and accepted by Robert on 2026-10-07.

| # | PRD said | We do | Why |
|---|---|---|---|
| R1 | Magic link, 15 min (FR-PORT-22) | 6-digit email code, 15 min | Links break across browsers on phones; the internal app already moved to codes for this reason |
| R2 | Portal user = principal in the app's auth (implied by "realm") | Portal has its **own** sign-in; partners are never Supabase Auth users | A profile-less Supabase user is routed to create-organization and can call `create_organization` / `claim_invite_code`. Own sign-in removes partners from that surface entirely and makes revoke instant |
| R3 | Merge may overwrite lead source (FR-PORT-59) | Merge never changes lead source | Respects the existing lead-source lock (20260731000001) |
| R4 | 1 business-hour SLA + manager escalation (FR-PORT-53/54) | Same-day nudge to the assigned rep | Reps are in the car; hourly escalation would flood managers |
| R5 | Tenant business hours + time zone | The assigned rep's own time zone and end-of-day | `path_preferences.timezone` and `end_of_day_minutes` already exist |
| R6 | Firm entity in v1 (FR-PORT-07..11) | Deferred | Internal reporting only; partner company is snapshotted on each referral so nothing is lost |
| R7 | Public form in v1 (Section 7) | Phase 2 | Needs bot protection we do not have |
| R8 | Duplicate rule = phone OR email OR name+ZIP (FR-PORT-44) | Reuse the existing deal dedupe tiers, no email | One rule, not two (PRD's own A-07 instruction); Robert: try without email |
| R9 | "Lead" entity created on submit (FR-PORT-40) | Submitted business fields live on the Referral row | No Leads table exists; a New-stage deal is the lead |
| R10 | 60s freshness via event push (FR-PORT-63) | Status changes are trigger-driven in the DB; the portal polls every 30s | No realtime in the app today; polling meets the 60s bar |
| R11 | ICP advisory flags at triage (FR-PORT-58) | Partner submissions skip the filter; advisory flags deferred | ICP check only runs inside discovery today |

## 3. Current state this builds on (verified 2026-10-06)

- `partners`: one person per row, `company` free text NOT NULL, `owner_id` with hierarchy RLS
  (Bundle 2, 20260820000006). `can_see_partner()` is hierarchy-aware.
- `partner_deals(partner_id, deal_id, direction, attributed_at, attributed_by, notes)`: the only
  referral record today. No status, no history. **RLS still org-wide** (out of scope in
  20260825000001). Read only by `usePartners`; written by `useAttributeDeal`, `useUnattributeDeal`,
  `useReferDeal`; also referenced by the demo reset/seed functions.
- `deals.lead_source` locked once set; `partner_referral` exists in the taxonomy but nothing writes it.
- Dedupe: unique `(org_id, place_id)` on active deals, name+address hard-block trigger, tiered RPC
  `find_place_duplicate_candidates` (org-wide by design).
- `task` table exists; nothing creates a task on deal creation.
- Email: Resend via edge functions, single `FROM_ADDRESS`, hardcoded navigatr logo in
  `_shared/emailTemplate.ts`. `org_branding` holds logo/dark logo/color/product name.
- Cron: pg_cron + `net.http_post` + `CRON_SECRET` (`_shared/cronAuth.ts`).
- Routing: one flat React Router tree in `App.tsx`; global 401 handler sends to `/login`.

## 4. Phase 0: in-app foundation

### 4.1 Data model

New enum `referral_status`: `submitted, accepted, working, won, lost, declined, withdrawn`.
New enum `referral_source`: `rep_entered, portal_signed_in` (`portal_public` added in Phase 2).
New enum `referral_decline_reason`: `duplicate, outside_footprint, outside_icp,
insufficient_contact, existing_customer, withdrawn_by_partner`.

**`referrals`**

| Column | Notes |
|---|---|
| `id, org_id` | org from parent partner (trigger, as `partner_deals` does today) |
| `partner_id` | not null |
| `direction` | `inbound` / `outbound` |
| `source` | `referral_source` |
| `status` | `referral_status`, not null |
| `company_name` | not null |
| `contact_name, contact_email, contact_phone, address, place_id, industry, notes` | submitted business data (R9) |
| `partner_company_snapshot` | partner's `company` at submission (stands in for the Firm snapshot, R6) |
| `deal_id` | nullable; set on Accept/Merge |
| `assigned_user_id` | owning internal user (routing rule 4.4) |
| `submitted_by_user_id` | internal user for `rep_entered` |
| `submitted_by_portal_user_id` | Phase 1, nullable |
| `submitted_at` | attribution clock |
| `triaged_by, triaged_at` | |
| `decline_reason, decline_note` | internal only |
| `duplicate_of_referral_id, duplicate_of_deal_id` | Phase 1 attribution |
| `consent_text_version` | Phase 1 |
| `nudged_at` | Phase 1 same-day nudge (5.9) |
| `purged_at` | Phase 2 purge |
| `created_at, updated_at` | |

Partial unique index: one non-terminal referral per `(partner_id, deal_id)` where `deal_id` is not
null (replaces the `partner_deals` PK semantics).

**`referral_status_history`** (append-only): `id, org_id, referral_id, from_status, to_status,
actor_type (user|partner|system), actor_id, note, created_at`. `authenticated` gets SELECT only; no
UPDATE/DELETE grant for anyone. Rows are written by an AFTER trigger on `referrals.status` changes,
so every path (RPC, deal-sync trigger, backfill) records history.

**`deals`** gains `source_referral_id uuid null references referrals(id)` and
`source_partner_id uuid null references partners(id)`.

### 4.2 Visibility (fixes the partner-link gap)

`referrals` SELECT: `org_id = user_org_id()` AND (`can_see_partner(partner_id)` OR
`user_can_see_owner(assigned_user_id)` OR the linked deal is visible via `user_can_see_owner`).
The assignee always sees their item even if they cannot see the partner (FR-PORT-55); the deal
then shows the partner name read-only.

No direct INSERT/UPDATE/DELETE policies. All writes go through SECURITY DEFINER RPCs (4.3), each
re-checking visibility, each `revoke execute ... from public, anon` and `grant ... to
authenticated`. This keeps status and history consistent and avoids the PUBLIC-execute default
flagged in the 2026-09-28 tenant audit.

### 4.3 Operations (RPCs)

| RPC | Effect |
|---|---|
| `log_referral(partner_id, business fields, place_id?)` | Rep records "a partner told me about this business". Creates `inbound`, `rep_entered`, status `submitted`, assigned per 4.4. |
| `attribute_deal_to_partner(partner_id, deal_id, note?)` | Replaces `useAttributeDeal`. Creates an inbound referral already linked to the deal; status derived from deal stage (4.5). Lead source untouched (locked). |
| `refer_deal_to_partner(partner_id, deal_id, note?)` | Replaces `useReferDeal`. `outbound` row, linked. |
| `remove_referral_link(referral_id)` | Replaces `useUnattributeDeal`. Only for `rep_entered` rows; manager/admin or the creator (mirrors today's delete rule). |
| `accept_referral(referral_id)` | Creates a deal at `new` with `lead_source='partner_referral'`, `source_referral_id`, `source_partner_id`, owner = assignee, business fields copied; links it; status `accepted`; creates the first follow-up task (4.6). Existing dedupe triggers still apply: on a hard-block the RPC returns a typed `duplicate` result with the blocking deal id if visible, so the UI can offer Merge or Decline. |
| `decline_referral(referral_id, reason, note?)` | Status `declined`. |
| `merge_referral(referral_id, deal_id)` | Links an existing visible deal; status per 4.5 (FR-PORT-66). Never changes the deal's lead source (R3). Sets `source_partner_id` only if null. |
| `withdraw_referral(referral_id, note?)` | Internal withdraw at any non-terminal status. |
| `reassign_referral(referral_id, user_id)` | Manager/admin; returns a warning flag when the new assignee cannot see the partner. |

### 4.4 Routing

Assignee = partner's `owner_id`; if deactivated or unplaced, the owner's `manager_id`; else the
org's administrator queue (assigned_user_id null, visible to administrators). For `rep_entered`,
the logging rep is the assignee.

### 4.5 Status follows the deal

AFTER UPDATE OF `stage` trigger on `deals`: for linked referrals in `accepted|working|won|lost`,
set status to `accepted` (stage `new`), `working` (any other open stage), `won`, or `lost`. A deal
reopened from lost moves the referral back to `working`. Declined and withdrawn are never touched.
Accept or Merge into a deal already past `new` lands in `working` (or the matching terminal
status) in the same transaction.

### 4.6 First follow-up task on Accept

`accept_referral` inserts one `task`: type `call`, title "Follow up on referral from <partner
name>", `owner_id` = assignee, `deal_id` = new deal, `date_source='interval'`, all date bands =
next business day (via `business_days_between` / `business_holidays`).

### 4.7 Migrating `partner_deals`

Migration backfills one referral per `partner_deals` row: `source='rep_entered'`, direction kept,
`company_name` from the deal, `submitted_at = attributed_at`, `submitted_by_user_id =
attributed_by`, `assigned_user_id` = deal owner, status derived from deal stage, one history row
with `actor_type='system'`. The demo reset/seed functions are rewritten to seed `referrals`. Frontend
hooks switch to the RPCs and to reading `referrals`. `partner_deals` stays read-only for one
production promotion (insert/update/delete revoked) and is dropped in a follow-up migration, so a
stale PWA client fails loudly instead of writing to a dead table.

### 4.8 In-app UI

- **Partners page:** a "Referrals to review" entry with a count badge (status `submitted`,
  assigned to me, or the admin queue for administrators).
- **Review sheet:** submitted business details, partner, any duplicate candidates (existing
  `find_place_duplicate_candidates` tiers), and Accept / Decline (reason picker) / Merge (deal
  picker over deals I can see).
- **Partner detail:** "Referred to us" / "Referred to them" read from `referrals`, each row showing
  its status chip. New "Log a referral" action opens a sheet reusing the Add Deal place search
  and `NotesFieldWithMic`. KPIs on the hero count referrals, not links.
- **Deal detail:** when `source_referral_id` is set, a "Referred by <partner>" line.

Rep-facing labels use the internal status names. Partner-facing labels (Section 5.6) never appear
in the app and internal names never appear in the portal.

## 5. Phase 1: the portal

### 5.1 Architecture

```
Partner browser (same SPA, route tree /p/:slug/*, no Supabase auth store)
        |  Authorization: Portal <session token>
        v
Edge function portal_api (verify_jwt=false, service role)
        |  1. resolve tenant from slug (or host header later)
        |  2. hash token -> portal_sessions -> portal_user -> partner_id
        |  3. reject if portal user not Active or session expired/revoked
        |  4. every query filtered by (org_id, partner_id) from the session
        v
Postgres: portal_* tables (RLS on, no authenticated/anon policies)
          + narrow SECURITY DEFINER SQL functions taking (org_id, partner_id)
```

- Partners never receive a Supabase JWT, so no app RLS policy, RPC, or edge function that trusts
  `authenticated` can be reached with a partner credential (NFR-PORT-01 by construction).
- A Supabase JWT is not accepted by `portal_api` (it only reads the `Portal` scheme).
- All partner data access lives in one function. Each action calls a SQL function whose
  signature takes `(org_id, partner_id)` and returns only that partner's rows: the scoping is in
  one auditable place, not spread across RLS.

### 5.2 Tables

| Table | Key fields | Access |
|---|---|---|
| `portal_users` | `id, org_id, partner_id unique, email, status (invited/active/suspended/revoked), invited_at, activated_at, last_login_at, terms_accepted_at, terms_version, terms_ip, notification_prefs jsonb` | internal SELECT when `can_see_partner(partner_id)`; writes via RPC/edge only |
| `portal_tokens` | `token_hash, token_type (invite/sign_in_code), portal_user_id, org_id, issued_at, expires_at, consumed_at, attempts, ip` | service role only |
| `portal_sessions` | `token_hash, portal_user_id, org_id, created_at, expires_at (30d), revoked_at, user_agent` | service role only |
| `referral_updates` | `id, org_id, referral_id, author_user_id, body, published_at` | internal SELECT inherits referral visibility; insert via RPC |
| `portal_audit_log` | `org_id, portal_user_id, action (sign_in/submit/withdraw/view_referral/terms_accept/revoke), referral_id, ip, created_at` | service role only; admins SELECT |

`organizations` gains: `portal_enabled bool default false`, `partner_value_visibility bool default
false` (FR-PORT-71), `partner_terms_text`, `partner_terms_version`, `consent_text`,
`consent_version`. The portal URL uses the existing unique `organizations.slug`.

Email is unique per `(org_id, lower(email))` in `portal_users`, so a partner in two tenants is two
identities (PRD open question, accepted for v1).

### 5.3 Sign-in and access lifecycle

- **Invite** (FR-PORT-20/21): "Invite to portal" on the partner record for the owner, anyone above
  them who can see the partner, and administrators. Requires the partner to have an email. Creates
  or reuses `portal_users` (status `invited`), issues a single-use invite token (7 days), emails a
  link to `/p/:slug/invite?token=...`. Resend invalidates prior invite tokens. Invite tokens are
  bound to the portal user's email by construction (the token row points at one portal user).
- **Accepting the invite:** consumes the token, shows the tenant's partner terms; acceptance
  records timestamp, IP, version (FR-PORT-18); then creates a session and sets status `active`.
  Declining terms ends there.
- **Sign-in** (R1): `/p/:slug` asks for email; `portal_api` always answers "if you have access,
  we sent a code" (NFR-PORT-04). For an active portal user it issues a 6-digit code (15 min,
  max 5 verify attempts, max 5 codes per email per hour). Verify creates a 30-day session.
- **Tokens:** 32 random bytes for invite/session, stored as SHA-256 hashes; codes stored hashed
  with the portal user id as salt (NFR-PORT-03).
- **Session storage:** portal session token in `localStorage` under a portal-specific key, never
  shared with the app's Supabase session.
- **Suspend / revoke** (FR-PORT-13): sets status and stamps `revoked_at` on every session and
  unconsumed token for that user. Because every request looks the session up, the next request
  fails (acceptance criterion: within one request cycle).
- **Copy portal address** on the partner record (FR-PORT-23).

### 5.4 Branding before sign-in

`portal_api` action `brand(slug)` (no session) returns, only when `portal_enabled`, the org's
display name, logo, dark logo, primary color, and product name from `org_branding`. Nothing else.
Unknown or disabled slugs return a generic "portal not available" page with no tenant detail.

### 5.5 Submission (FR-PORT-35..43)

Fields: company (required), contact name (required), email or phone (one required), address
(optional, Google Places autocomplete via the existing `resolve_place` path, proxied through
`portal_api`), industry, urgency, notes with `NotesFieldWithMic`. Draft autosaves to
`localStorage`. The consent line (tenant text + version) is shown and stored.

- **Speech-to-text:** `transcribe` currently trusts any Supabase JWT. Add a portal path:
  `portal_api` action `transcribe` validates the portal session, then calls the same AssemblyAI
  helper (extracted to `_shared/transcribe.ts`).
- **Soft duplicate warning** (FR-PORT-38/45/50): the check runs with the *partner owner's*
  visibility, not org-wide. Needs a new SQL helper `owner_can_see_owner(viewer_id, target_owner_id)`
  (same logic as `user_can_see_owner` with an explicit viewer) and a variant of the dedupe
  candidate query scoped by it. The partner only ever sees "This business may already be in
  progress". They may submit anyway; the referral is flagged.
- **Attribution** (FR-PORT-46..49): when a new submission matches an earlier non-declined,
  non-withdrawn referral within the owner's scope, the earlier one keeps credit; the new one is
  flagged with `duplicate_of_referral_id` and Decline (duplicate) preselected at triage. Override
  requires a written reason, recorded in history.
- Creates a `referrals` row: `inbound`, `portal_signed_in`, `submitted`, routed per 4.4. No deal.
- **Withdraw** (FR-PORT-42): partner can withdraw only while `submitted`.

### 5.6 Partner-facing views

Label mapping (FR-PORT-62), implemented once in a shared module used by `portal_api` responses
and emails:

| Internal | Partner sees |
|---|---|
| submitted | Received |
| accepted | Accepted |
| working | In Progress |
| won | Closed Won |
| lost, declined | Not Moving Forward |
| withdrawn | Withdrawn |

- **Dashboard** (FR-PORT-68/69): submit button, tiles (submitted, active, closed won, conversion
  rate; total value tile only when `partner_value_visibility`), list sorted by latest activity.
  Polls every 30s.
- **Detail** (FR-PORT-72): what they submitted, label, history with dates (labels only), assigned
  rep's name and business email/phone, and published updates.
- **Never returned** (FR-PORT-16/73): deal stage, internal status names, decline/loss reasons
  (unless a rep publishes one), deal notes, activities, other partners, any aggregate beyond their
  own referrals. `portal_api` responses are built from an explicit allowlist of fields, not by
  passing rows through.
- **Value:** closed-won value only, and only when the tenant allows it (FR-PORT-70/71), including
  in emails (FR-PORT-85).

### 5.7 "Share update with partner" (FR-PORT-74)

On the referral (in the review sheet and on the deal's "Referred by" line) a rep can write an
update and publish it. RPC `publish_referral_update` inserts into `referral_updates` and triggers
the partner email. This is the only text path from app to portal. No other note field is ever read
by `portal_api`.

### 5.8 Emails

New `_shared/portalEmail.ts` built on `emailTemplate.ts`, extended to accept a brand (logo, color,
product name). Sender: shared navigatr address with the tenant's name as display name (D14).
Reply-To the assigned rep's email on referral-specific emails, no-reply otherwise. The "Powered by
navigatr" footer follows the existing locked rule. Sent through the existing non-prod allowlist
guard (`emailGuard.ts`).

- **Partner:** invite, sign-in code, submission received, accepted, not moving forward, closed won,
  withdrawn, update published.
- **Internal:** referral assigned to you; same-day nudge (5.9).

Values are suppressed when `partner_value_visibility` is off.

### 5.9 Same-day nudge (R4, R5)

Hourly cron (`CRON_SECRET` pattern) → `notify_untriaged_referrals`. For each assignee with
`submitted` referrals received today, once their local time (from `path_preferences.timezone`,
default America/New_York when unset) passes their end-of-day, send
one digest email and stamp `nudged_at` on those referrals so each is nudged once. Admin-queue
items nudge every administrator. No reassignment, no manager escalation.

### 5.10 Tenant settings

An admin "Partner portal" settings card: enable portal, partner terms text (version bumps on
save), consent line, show closed-won value to partners, copy portal address.

### 5.11 Frontend structure

- New feature folder `apps/app/src/features/portal/` with its own API client (`portalApi.ts`),
  session store, and pages: sign-in, code entry, invite accept + terms, dashboard, referral detail,
  submit, profile (name, phone, notification prefs per FR-PORT-19).
- Route tree `/p/:slug/*` mounted in `App.tsx` outside `ProtectedRoute`, `BrandProvider` fed from
  the `brand` action.
- The global 401 handler, `PublicOnlyRoute`, and the PWA auth-route guard must ignore `/p/*`.
- Mobile-first at 360px, WCAG 2.1 AA (NFR-PORT-08).

## 6. Security checklist

- Partners never get a Supabase session (R2). Covered by a test that `portal_api` rejects a
  Supabase JWT and that the app API rejects a portal token.
- Every `portal_api` action except `brand`, `request_code`, `verify_code`, `accept_invite` requires
  a valid session; scoping comes only from the session, never from request parameters.
- Cross-tenant and cross-partner object references return not-found (tests with two tenants and
  two partners in one tenant).
- New RPCs revoke EXECUTE from `public, anon`.
- Rate limits: code requests per email and per IP; verify attempts per code.
- Audit log for sign-ins, submissions, withdrawals, detail views, revokes (NFR-PORT-06).
- No partner-visible string comes from a free-text internal field except `referral_updates.body`.

## 7. Testing

- **Unit (vitest):** status label mapping; status-from-stage mapping; portal response allowlist
  builder (snapshot that no forbidden keys appear); dedupe normalizers reuse; nudge time-window
  calculation across time zones.
- **DB / RLS tests (`supabase/tests`, run in CI from zero):** referral visibility across
  self/subtree/other/admin; assignee-can-see-without-partner; history append-only (UPDATE/DELETE
  denied); deal stage sync including reopen; accept/decline/merge state and history; merge leaves
  lead source untouched; backfill from `partner_deals`; portal tables invisible to
  `authenticated` and `anon`.
- **Edge function tests:** token hashing, expiry, single use, revoke ends session on next request,
  code rate limits, generic response for unknown emails, two-tenant isolation.
- **E2E (Playwright) golden path:** rep invites partner → partner accepts terms → submits →
  rep accepts → partner sees Accepted → deal moves stage → partner sees In Progress.
- **String audit:** render portal pages and emails for every status and assert no internal status
  name, stage name, or reason code appears (acceptance criterion in PRD Section 19).

## 8. Rollout

- Ships through the normal pipeline (feature branch → PR → staging → promote-production).
- Phase 0 is invisible to partners and safe to promote alone.
- Phase 1 is gated per tenant by `portal_enabled` (default off). Turn on for Elavon and Propelr
  after staging verification.
- Before the first real invite: portal web address confirmed (shared domain + slug) and Robert's
  attorney answer on navigatr-level partner terms.

## 9. Deferred (Phase 2 and later)

Public referral form + per-rep QR links + tenant link + bot protection (PRD Sections 6.2, 7);
"Referrals sent to you" view with note-back (Section 13); 90-day personal-data purge job (Section
16); CSV export (FR-PORT-75); weekly digest (FR-PORT-83/84); Firms (FR-PORT-07..11); ICP advisory
flags at triage (FR-PORT-58); email in the duplicate rule; plus the PRD's own deferred register
(partner accept/decline, territory/round-robin routing, tenant-domain email, per-tenant
subdomains, commission visibility, cross-tenant SSO).

## 10. Open items (do not block the build)

- Portal web address (configuration only).
- Navigatr-level partner terms (Robert checking with attorney).
- Whether a tenant may publish a default loss reason automatically (PRD Section 21); v1 requires
  a rep to publish.
