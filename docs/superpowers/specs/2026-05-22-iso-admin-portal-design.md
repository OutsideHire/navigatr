# ISO Admin Portal — Design

**Status:** Approved 2026-05-22
**Owner:** Ryan Meo (Outside Hire)
**Implementation target:** v1, ~8-10 working days
**Successor to:** PR #30 (self-serve org creation, merged)

## Context

navigatr sells to ISOs / partners (5 major accounts ready, each with 500-2,000 agents). Today there is no UI for an ISO admin to invite, activate, or manage their agents. New orgs are created by running SQL manually. Per-agent invites do not exist — only a shared 8-character `invite_code` per organization. That does not scale to 1,500-agent onboardings.

This spec defines the v1 admin portal that closes that gap.

## Goals

- ISO admin can bulk-import 500-2,000 agents via CSV in one operation.
- Each imported agent receives a per-agent invite email and self-activates (sets password or uses magic link) without any further admin step.
- ISO admin sees a live agent roster with status (active / invited / revoked), open deal count, and pipeline value.
- ISO admin can resend invites, revoke pending or active members, and promote a rep to manager.
- ISO admin can drill into any agent's pipeline view ("view as Sarah Lim") without true impersonation — same RLS-driven read access a manager already has today.
- Seat usage is tracked per-org and enforced server-side.

## Non-goals (v1)

- **Teams / regions / branch managers.** Useful in 1,500-agent orgs but not blocking. Deferred to v2 once delegation pain is real.
- **Per-ISO white-labeling** (logo, colors, custom from-address). Lightweight to add later; ship plain navigatr branding first.
- **SSO / SAML / OIDC.** Worth building once an ISO standardizes on Okta or Google Workspace. Not required for the first 5.
- **Stripe self-serve billing.** First 5 ISOs are invoiced out-of-band. Add Stripe portal when the 6th ISO can't be served by hand.
- **Per-ISO from-address on invite emails.** All v1 invites come from `invites@navigatr.app`.
- **Bulk import of historical deals.** If any ISO is bringing existing CRM data, that is a separate spec — not part of the agent-onboarding portal.
- **Backstage "Outside Hire creates an ISO" portal.** Use SQL for the first 5; reassess when ISO #6+ shows up.
- **True impersonation** ("sign in as Sarah"). Manager RLS already lets the ISO admin read everything; `/pipeline?owner=<id>` covers the "view as" use case without the audit-and-security weight of real impersonation.

## Architecture overview

No tenancy-model change. Today's schema already supports the model we want: one `organizations` row per ISO, agents are `profiles` with role `rep` inside it, RLS scopes reps to their own deals and managers/admins to org-wide. The portal is a UI + ops-tooling layer on top, not a foundation rewrite.

What's new:

1. **`org_invites` table** — one row per per-agent invitation. Tracks email, token, status, and audit fields. Distinct from the existing `organizations.invite_code` shared-code path (which stays for self-serve signup).
2. **`organizations.seat_limit`** column — nullable means unlimited (matches current orgs); non-null is enforced server-side.
3. **Three new SECURITY DEFINER RPCs** — `admin_bulk_invite`, `admin_resend_invite`, `admin_revoke_member`. All check the caller is a manager/admin of the target org. No direct INSERT/UPDATE/DELETE on `org_invites` from the client.
4. **Transactional email via Resend** — Supabase Edge Function `send_invite_email` fired from the bulk-invite RPC's after-insert path. Async; failures don't roll back the invite row (admin can resend).
5. **`/admin` route family** in the React app, gated by `profile.role ∈ ('manager','admin')`. New "Team" sidebar entry, hidden from reps.
6. **Existing `claim_invite_code` RPC extended** — accepts either a shared org `invite_code` (today's path) or a per-agent `org_invites.token` (new path). Token path is the activation flow.

## Data model

### Migration: `20260523000001_org_invites_and_seats.sql`

```sql
-- Per-agent invitation. Distinct from organizations.invite_code (the
-- shared self-serve code). Per-agent tokens give us revoke + audit per row.
create table org_invites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          user_role not null default 'rep',
  token         text not null unique,
  invited_by    uuid references profiles(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- Working index for the admin portal's "pending invites" list.
create index org_invites_org_pending_idx
  on org_invites (org_id)
  where accepted_at is null and revoked_at is null;

-- Idempotency: admin clicking "invite" twice for the same email becomes a
-- no-op rather than two rows. Active + revoked invites are excluded so a
-- previously-revoked email can be re-invited cleanly.
create unique index org_invites_email_per_org_pending_idx
  on org_invites (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- Seat limit on the org. Null = unlimited (matches existing orgs).
alter table organizations
  add column seat_limit int;

-- Soft-deactivation for profiles. Cleaner than cascade-deleting the profile
-- when a manager revokes an agent — the agent's deals stay attached and
-- visible to managers/admins; the agent themselves can no longer sign in.
alter table profiles
  add column deactivated_at timestamptz;

-- Reactivation is just `update profiles set deactivated_at = null` via an
-- admin RPC; reuses the same admin_revoke_member surface in reverse.

alter table org_invites enable row level security;

-- Managers/admins can read their org's invites. No direct write — all
-- mutations go through SECURITY DEFINER RPCs.
create policy org_invites_select on org_invites for select
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager','admin')
  );
```

### RPCs (skeletons)

```sql
-- Bulk invite. Atomic at the RPC level; per-row success/failure surfaced
-- in the return table so the UI can render a results breakdown.
create function admin_bulk_invite(p_invites jsonb)
returns table (email text, ok boolean, error text)
language plpgsql security definer set search_path = public
as $$
-- 1. Authorize: auth.uid() is manager/admin of caller's org.
-- 2. Determine target org from caller's profile.
-- 3. For each row in p_invites:
--    a. Validate email format.
--    b. Check not already an active profile in this org.
--    c. Check not a pending invite already (idempotency index).
--    d. Check seat_limit not exceeded (counting profiles + pending invites).
--    e. Generate token (gen_random_bytes + base32-ish).
--    f. Insert row.
--    g. Queue invite email (via Edge Function or pg_notify).
--    h. Return (email, ok, error) tuple.
$$;

create function admin_resend_invite(p_invite_id uuid) returns void;
create function admin_revoke_member(p_target uuid, p_kind text) returns void;
```

`p_kind` on `admin_revoke_member` is `'invite'` (sets `org_invites.revoked_at`) or `'profile'` (soft-deactivates: sets `profiles.deactivated_at = now()`; deals stay attached, hidden from RLS for the agent themselves but still visible to managers/admins; a separate "reassign deals" UI handles handoff). The migration adds `profiles.deactivated_at timestamptz` and updates RLS so deactivated profiles can't sign in / log activity / be queried as active. See **Agent deactivation** below.

### Extension to `claim_invite_code`

Today's RPC accepts a shared `invite_code`. Extend to also accept a per-agent token: if the input matches a row in `org_invites` where `accepted_at is null and revoked_at is null and expires_at > now()`, treat that as the profile-creation path. Sets `accepted_at = now()` on the invite row in the same transaction as the profile insert. Shared-code path is unchanged.

## UI

### Route map

```
/admin                            redirect → /admin/agents
/admin/agents                     primary list + invite + import entry
/admin/agents/import              CSV bulk-import wizard
/admin/settings                   org name, invite link, seat usage, danger zone
```

All gated by `RequireRole(['manager','admin'])` wrapper on `ProtectedRoute`. Reps hitting `/admin` get bounced to `/dashboard`.

Sidebar gains a "Team" entry (named for forward-compatibility with v2 teams feature). Hidden from reps.

### `/admin/agents`

The work surface. Server-side paginated list of profiles + pending invites in one merged view.

Columns:
- **Name** — from profile, or `—` for unaccepted invites
- **Email**
- **Status** — `Active` / `Invited (Nd left)` / `Revoked` badges
- **Open deals** — count of agent's deals in non-`won` stages
- **Pipeline value** — sum of open deal `value_cents`
- **Row menu** — View pipeline · Resend invite · Revoke · Promote to manager

Header: seat usage indicator (e.g. `Seats: 1,247 / 1,500 ▓▓▓▓▓░░░ 83%`), `+ Invite agent` button, `↑ Import CSV` button, search box, status filter.

Pagination is server-side cursor pagination (50/page). Existing `useDeals` cache will be reused for the per-agent deal aggregates; a new `useOrgAgents` hook handles the paginated profiles + invites join.

### Invite single agent (modal on `/admin/agents`)

Three fields: full name (required), work email (required), role (defaults `rep`). Submit → `admin_bulk_invite([{...}])` → row appears in list as "Invited."

### `/admin/agents/import` — 4-step CSV wizard

This is the most important screen given the 500-2,000 agent scale.

**Step 1 — Upload.** Drag/drop or pick a CSV. Required columns: `email`, `full_name`. Optional: `role` (defaults `rep`), `team` (ignored until v2). Sample template downloadable. Client-side parse via `papaparse`. Raw file is never uploaded to the server.

**Step 2 — Map columns** (skipped if headers match). Auto-detection for common variants (`Email Address`, `Name`, `Full Name`).

**Step 3 — Validation preview.**

```
We parsed 1,508 rows.
✅ 1,488 ready to invite
⚠️  20 issues:
   • 8 invalid emails
   • 9 duplicates (already invited or active)
   • 3 over seat cap
[Download failing rows]   [Skip errors, send 1,488 invites]   [Cancel]
```

**Step 4 — Submit + progress.** Posts the valid rows to `admin_bulk_invite` in chunks of 200 (Supabase JS RPC payload + Postgres transaction size sanity). Progress bar. Final summary: `1,488 invites sent, 0 failed, 20 skipped.`

### `/admin/settings`

- Org name (editable; calls existing `organizations` UPDATE via a small RPC).
- Generated invite link + copy button (links to `/signup?invite=<organizations.invite_code>` — useful for stragglers).
- Seat usage card.
- Danger zone: transfer admin to another manager, deactivate org. Both gated behind a confirm dialog.

### `/pipeline?owner=<agent_id>` — view-as-agent

A small new query param on the existing pipeline filter. When set, the page renders a banner at the top: `Viewing: Sarah Lim's pipeline ✕`. Underlying query adds an `eq('owner_id', <id>)` filter. RLS is unchanged — manager already has read access.

## Agent activation flow

```
1. ISO admin imports CSV
   └─→ Backend creates org_invites rows + queues invite emails

2. Agent receives email
   "Sarah, your account at Acme Payments is ready."
   [Sign in now] → /accept-invite?token=<token>

3. /accept-invite page
   Email pre-filled from token. User chooses:
   ─ Set a password (default)
   ─ Use magic-link instead
   On submit:
     claim_invite_code({ p_code: <token> }) → creates profile,
     marks org_invites.accepted_at = now()

4. Lands on /dashboard with empty pipeline
```

The `/accept-invite` page is new but lightweight — most of its work reuses `claim_invite_code`. The activation auth offers password-or-magic-link parity with the existing login page.

## Transactional email

**Provider: Resend.**

- Verified sending domain (`invites@navigatr.app` or chosen brand domain) with SPF + DKIM + DMARC. Mandatory at this volume; without it, ~30% of invites land in spam.
- Templates: `invite` (initial), `invite_resend` (later than initial), `welcome` (post-activation), `revoked` (optional courtesy).
- Implementation: Supabase Edge Function `send_invite_email` called from the bulk-invite RPC. Async; failures do not roll back the invite. Admin UI exposes "Resend" per row to recover from any individual delivery failure.

Three things known up-front:
1. **Rate limits.** Resend's standard tier caps at ~10/sec; a 1,500-agent blast = ~2.5 min of background sends. UI returns immediately; progress shown on the agents page.
2. **Spam folder.** Send a handful of test invites to Gmail + Outlook before a real blast for each new ISO. Audit DMARC alignment if anything lands in spam.
3. **Per-ISO from-address** is a v2 feature, not v1. Requires per-ISO DNS verification.

## Agent deactivation

Revoking an active profile soft-deactivates rather than deletes. `profiles.deactivated_at` is set to `now()`. Effects:

- Agent's existing JWT becomes useless on next request: a new RLS gate on `profiles_select` and on the `user_org_id()` / `user_role()` helpers returns null when `deactivated_at is not null`. Effectively the agent is signed out within seconds.
- Agent's deals stay in `deals` with `owner_id` unchanged. Managers/admins continue to see them. Other reps still can't (own-only RLS).
- A future admin action can reactivate (`set deactivated_at = null`) — useful for accidental revokes.
- Bulk-reassign of a deactivated agent's deals is a v1.1 feature (see open question 2). For v1, an admin can edit deals one at a time via `EditDealSheet` if they choose to expose the `owner_id` field there.

## Authorization model

| Operation | Rep | Manager | Admin |
|---|---|---|---|
| See `/admin` nav entry | no | yes | yes |
| Invite agent (single or bulk) | no | yes | yes |
| Revoke agent | no | yes | yes |
| Promote rep → manager | no | no | yes |
| Demote manager → rep | no | no | yes |
| Update org name | no | no | yes |
| Transfer admin | no | no | yes |

All enforced at the RPC layer (SECURITY DEFINER functions check `public.user_role()`). UI hides what the role can't do but is not the source of truth.

## Rollout sequence

```
Week 1 · Schema + RPCs + RLS                              (~1 day)
Week 1 · Resend integration + invite email templates      (~1 day)
Week 1 · /admin/agents list + pagination                  (~1 day)
Week 2 · Invite single agent + resend/revoke flows        (~1 day)
Week 2 · CSV bulk-import wizard (4 steps)                 (~2 days)
Week 2 · /accept-invite page (token-based activation)     (~1 day)
Week 2 · /admin/settings + seat usage indicator           (~0.5 day)
Week 3 · "View as agent" via /pipeline?owner=X            (~0.5 day)
Week 3 · Dry-run with 5 fake agents end-to-end            (~0.5 day)
Week 3 · Onboard ISO #1 manually (SQL + portal exercise)  (~1 day)
```

Total: ~8-10 working days.

## Open questions & risks

1. **Historical data import.** Do any of the 5 ISOs need their existing CRM deals imported alongside agent onboarding? If yes, that is a separate (probably larger) spec.
2. **Reassign-deals UI.** Spec settles on soft-deactivation (`profiles.deactivated_at`) so deals stay attached and managers still see them. A "reassign Sarah's open deals to..." picker is a separate but small piece of UI. v1 ships without it (managers can do this via the existing deal-edit sheet's "owner" field if we expose it; today that field isn't user-editable). Decide before implementation whether to add the bulk-reassign affordance now or in a v1.1.
3. **Compliance.** Merchant services + treasury reps deal with sensitive customer data. Some ISOs may have audit / access-log / SOC 2 asks. Worth surfacing in contracts before onboarding.
4. **Support load.** Even with magic-links, ~1,500 first-time activations will produce password-reset and "I never got the email" tickets. Day-1 SLA needs to be planned per-ISO.
5. **Reporting at 1,500-agent scale.** Today's `/dashboard` scans all org rows. At ~30k deals/org it remains fine; pre-aggregating into a materialized view becomes worth it around ~100k deals — not v1 work.
6. **Agent inter-ISO movement.** If an agent leaves ISO A and joins ISO B, the model assumes: ISO A revokes profile (data stays with A), agent gets a new invite from B, fresh workspace. Confirm this matches reality before signing the first ISO contract.

## Out-of-scope (re-stated for the implementation team)

- Teams / regional managers
- White-labeling per ISO
- SSO / SAML / OIDC
- Stripe billing UI
- Per-ISO email from-address
- Bulk *deal* import
- Backstage Outside Hire portal
- True impersonation

These are real future work but not in v1.
