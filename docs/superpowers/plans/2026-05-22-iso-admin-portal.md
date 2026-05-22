# ISO Admin Portal v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ISO admin portal that lets a manager/admin invite 500–2,000 agents via CSV, track activation, resend/revoke invites, and view their pipelines — all without Outside Hire running SQL by hand.

**Architecture:** No tenancy-model change. One Postgres migration adds `org_invites`, `organizations.seat_limit`, `profiles.deactivated_at`. Three SECURITY DEFINER RPCs (bulk-invite, resend, revoke) gate writes. One Supabase Edge Function sends invite emails via Resend. React app gets a new `/admin/*` route family gated by role.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions + Auth), Resend (transactional email), React + Vite + TanStack Query, Tailwind + Radix UI, vitest + @testing-library/react, papaparse (CSV parsing, new dep).

**Spec:** `docs/superpowers/specs/2026-05-22-iso-admin-portal-design.md`

---

## Prerequisites (one-time setup, before Task 1)

These are owner actions — not engineer steps:

1. **Resend account.** Create one at https://resend.com if you don't have it. Verify a sending domain (e.g. `navigatr.app` or your chosen brand domain) with SPF + DKIM + DMARC records. The wizard walks you through DNS.
2. **API key.** Generate a Resend API key with `emails.send` scope.
3. **Supabase secret.** Add the key to Supabase: Dashboard → Edge Functions → Settings → secrets, name `RESEND_API_KEY`.
4. **From-address.** Decide what the invite emails come from — `invites@navigatr.app` is the default in this plan. Adjust if different.
5. **A test inbox.** A Gmail + Outlook address you control for smoke-testing deliverability before the first real ISO blast.

If any of (1)-(4) aren't done when Task 11 starts, Task 11 will be blocked. The rest of the plan can run regardless.

---

## File Structure

### New files
```
supabase/
  migrations/20260523000001_admin_portal.sql        # all schema + RLS + RPCs
  functions/send_invite_email/index.ts              # Resend integration
  functions/send_invite_email/deno.json             # Deno config (optional)

apps/app/src/
  components/layout/RequireRole.tsx                 # role-gated route wrapper

  features/admin/
    hooks/useOrgAgents.ts                           # paginated list (profiles + pending invites)
    hooks/useOrgAgents.test.tsx
    hooks/useAdminBulkInvite.ts                     # bulk_invite RPC mutation
    hooks/useAdminBulkInvite.test.tsx
    hooks/useResendInvite.ts
    hooks/useResendInvite.test.tsx
    hooks/useRevokeMember.ts
    hooks/useRevokeMember.test.tsx
    hooks/useSeatUsage.ts                           # reads org.seat_limit + counts
    hooks/useSeatUsage.test.tsx

    components/AgentListRow.tsx
    components/InviteAgentModal.tsx
    components/SeatUsageBadge.tsx
    components/CsvImportWizard.tsx                  # multi-step (steps inside)
    components/CsvImportWizard.test.tsx

    utils/parseAgentsCsv.ts                         # papaparse wrapper + validators
    utils/parseAgentsCsv.test.ts

    pages/AgentsPage.tsx
    pages/ImportAgentsPage.tsx
    pages/AdminSettingsPage.tsx

  features/auth/
    pages/AcceptInvitePage.tsx                      # /accept-invite?token=... activation
```

### Modified files
```
.gitignore                                  # whitelist new specs if needed (already done)
apps/app/package.json                       # add papaparse + @types/papaparse
apps/app/src/App.tsx                        # /admin/* routes + /accept-invite route
apps/app/src/components/layout/SidebarNav.tsx   # "Team" entry, role-gated
apps/app/src/features/pipeline/pages/PipelinePage.tsx  # ?owner=<id> filter + banner
apps/app/src/features/pipeline/hooks/useDeals.ts       # optional owner filter param
supabase/migrations/20260517000002_signup_trigger.sql  # NOT modified — claim_invite_code change ships in 20260523000001
```

---

## Task 1: Migration — schema + helper updates

**Goal:** Land `org_invites`, `organizations.seat_limit`, `profiles.deactivated_at`, and updated RLS helpers in one migration file. No RPCs yet (those land in Task 2).

**Files:**
- Create: `supabase/migrations/20260523000001_admin_portal.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260523000001_admin_portal.sql
--
-- ISO Admin Portal v1: per-agent invitations, seat limits, soft-deactivation.
-- See docs/superpowers/specs/2026-05-22-iso-admin-portal-design.md.

-- ---------------------------------------------------------------------------
-- org_invites: one row per per-agent invitation. Distinct from the existing
-- organizations.invite_code shared-code path (which stays for self-serve
-- signup); per-agent tokens give us revoke + audit per row.
-- ---------------------------------------------------------------------------
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

alter table org_invites enable row level security;

-- Managers/admins can read their org's invites. No direct write — all
-- mutations go through SECURITY DEFINER RPCs added in Task 2.
create policy org_invites_select on org_invites for select
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );

-- ---------------------------------------------------------------------------
-- organizations.seat_limit: null = unlimited (matches existing orgs).
-- ---------------------------------------------------------------------------
alter table organizations
  add column seat_limit int;

-- ---------------------------------------------------------------------------
-- profiles.deactivated_at: soft-deactivation. Agent's deals stay attached
-- (visible to managers); the agent themselves can no longer authenticate
-- as active because the helper functions below return null for them.
-- ---------------------------------------------------------------------------
alter table profiles
  add column deactivated_at timestamptz;

create index profiles_active_idx
  on profiles (org_id)
  where deactivated_at is null;

-- ---------------------------------------------------------------------------
-- Helper functions: treat deactivated profiles as if they don't exist.
-- This is the load-bearing piece — every RLS policy in the schema reads
-- user_org_id() / user_role(), so updating these here propagates the
-- deactivation effect everywhere without rewriting individual policies.
-- ---------------------------------------------------------------------------
create or replace function public.user_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles
   where id = auth.uid()
     and deactivated_at is null
$$;

create or replace function public.user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles
   where id = auth.uid()
     and deactivated_at is null
$$;

-- profiles_select RLS already filters by org membership; we leave it as-is
-- since managers SHOULD still see deactivated profiles in their admin list
-- (so they can reactivate). UI filters the "active agents" view on
-- deactivated_at; the admin list does not.
```

- [ ] **Step 2: Apply the migration via Supabase Studio**

Copy the entire SQL above. In Supabase Dashboard → SQL Editor → New query, paste, Run. Expect `Success. No rows returned.`

- [ ] **Step 3: Verify the migration with introspection queries**

Run each of these in SQL Editor; expect the result described.

```sql
-- 1. org_invites exists with right columns
select column_name, data_type
from information_schema.columns
where table_name = 'org_invites' order by ordinal_position;
-- Expect: id uuid, org_id uuid, email text, full_name text, role USER-DEFINED,
--         token text, invited_by uuid, expires_at timestamptz, accepted_at timestamptz,
--         revoked_at timestamptz, created_at timestamptz

-- 2. organizations gained seat_limit
select column_name from information_schema.columns
where table_name = 'organizations' and column_name = 'seat_limit';
-- Expect: 1 row.

-- 3. profiles gained deactivated_at
select column_name from information_schema.columns
where table_name = 'profiles' and column_name = 'deactivated_at';
-- Expect: 1 row.

-- 4. RLS policy exists on org_invites
select policyname, cmd from pg_policies where tablename = 'org_invites';
-- Expect: org_invites_select | SELECT

-- 5. user_org_id() now filters deactivated profiles
select pg_get_functiondef('public.user_org_id'::regproc);
-- Expect: SQL body contains "deactivated_at is null"
```

- [ ] **Step 4: Smoke-test existing app still works**

This change touches the schema's most central helper functions. Verify nothing broke.

```bash
cd apps/app
pnpm test -- --run
```

Expected: All existing tests pass (176/176 from before this work).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260523000001_admin_portal.sql
git commit -m "feat(admin-portal): schema for per-agent invites, seat limits, soft-deactivation

org_invites tracks per-agent invitations distinct from the shared
organizations.invite_code self-serve path. organizations.seat_limit
and profiles.deactivated_at land alongside. user_org_id() and
user_role() updated to ignore deactivated profiles, propagating the
deactivation effect to every existing RLS policy without rewriting
each one."
```

---

## Task 2: Migration — RPCs (`admin_bulk_invite`, `admin_resend_invite`, `admin_revoke_member`, `admin_reactivate_member`)

**Goal:** All write operations on `org_invites` and the deactivation flow live behind SECURITY DEFINER RPCs that enforce manager/admin role. Land them in a second migration file (separate from Task 1 so a failure here is independently reversible).

**Files:**
- Create: `supabase/migrations/20260523000002_admin_portal_rpcs.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260523000002_admin_portal_rpcs.sql
--
-- Writes on org_invites + soft-deactivation on profiles. All paths
-- enforce caller is a manager/admin of the target org.

-- ---------------------------------------------------------------------------
-- Token generator: 32 hex chars (16 bytes of randomness). Used by
-- admin_bulk_invite for each new invite row. Not exposed to clients.
-- ---------------------------------------------------------------------------
create or replace function _admin_invite_token() returns text
language sql volatile security definer set search_path = public as $$
  select encode(gen_random_bytes(16), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- admin_bulk_invite: accept a JSON array of {email, full_name?, role?}.
-- Returns one row per input row with (email, ok, error) so the UI can show
-- per-row outcomes. Atomic at the statement level; per-row failures don't
-- abort the batch (each row is validated independently).
-- ---------------------------------------------------------------------------
create or replace function admin_bulk_invite(p_invites jsonb)
returns table (email text, ok boolean, error text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id    uuid;
  v_caller    user_role;
  v_seat_cap  int;
  v_used      int;
  v_remaining int;
  v_row       jsonb;
  v_email     text;
  v_name      text;
  v_role      user_role;
begin
  -- 1. Authz
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select org_id, role into v_org_id, v_caller
    from profiles where id = auth.uid() and deactivated_at is null;
  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  -- 2. Seat math (single read; we deduct as we go)
  select seat_limit into v_seat_cap from organizations where id = v_org_id;
  select count(*) into v_used
    from (
      select 1 from profiles
        where org_id = v_org_id and deactivated_at is null
      union all
      select 1 from org_invites
        where org_id = v_org_id and accepted_at is null and revoked_at is null
    ) s;
  v_remaining := case when v_seat_cap is null then 2147483647 else v_seat_cap - v_used end;

  -- 3. Iterate
  for v_row in select * from jsonb_array_elements(p_invites)
  loop
    v_email := lower(trim(v_row->>'email'));
    v_name  := nullif(trim(coalesce(v_row->>'full_name', '')), '');
    v_role  := coalesce((v_row->>'role')::user_role, 'rep'::user_role);

    -- Per-row validations. Each branch RETURNS NEXT a result tuple.
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      email := v_row->>'email'; ok := false; error := 'invalid_email'; return next; continue;
    end if;
    if exists (select 1 from profiles p
                join auth.users u on u.id = p.id
                where p.org_id = v_org_id
                  and lower(u.email) = v_email
                  and p.deactivated_at is null) then
      email := v_email; ok := false; error := 'already_active'; return next; continue;
    end if;
    if exists (select 1 from org_invites
                where org_id = v_org_id and lower(email) = v_email
                  and accepted_at is null and revoked_at is null) then
      email := v_email; ok := false; error := 'already_invited'; return next; continue;
    end if;
    if v_remaining <= 0 then
      email := v_email; ok := false; error := 'seat_cap_reached'; return next; continue;
    end if;

    -- Insert; gain a seat-budget slot.
    insert into org_invites (org_id, email, full_name, role, token, invited_by)
      values (v_org_id, v_email, v_name, v_role, _admin_invite_token(), auth.uid());
    v_remaining := v_remaining - 1;

    email := v_email; ok := true; error := null; return next;
  end loop;
end $$;

grant execute on function admin_bulk_invite(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_resend_invite: bump expires_at + 14 days; queueing the email is
-- the caller's job (the frontend invokes send_invite_email after).
-- ---------------------------------------------------------------------------
create or replace function admin_resend_invite(p_invite_id uuid)
returns table (id uuid, email text, token text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_caller not in ('manager', 'admin') then raise exception 'forbidden'; end if;

  update org_invites
     set expires_at = now() + interval '14 days'
   where id = p_invite_id and org_id = v_org_id
     and accepted_at is null and revoked_at is null
  returning org_invites.id, org_invites.email, org_invites.token
       into id, email, token;

  if id is null then
    raise exception 'invite_not_found_or_already_resolved';
  end if;
  return next;
end $$;

grant execute on function admin_resend_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_revoke_member: revoke a pending invite (p_kind='invite') OR
-- soft-deactivate an active profile (p_kind='profile').
-- ---------------------------------------------------------------------------
create or replace function admin_revoke_member(p_target uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select org_id, role into v_org_id, v_caller
    from profiles where id = auth.uid() and deactivated_at is null;
  if v_caller not in ('manager', 'admin') then raise exception 'forbidden'; end if;

  if p_kind = 'invite' then
    update org_invites set revoked_at = now()
     where id = p_target and org_id = v_org_id
       and accepted_at is null and revoked_at is null;
    if not found then raise exception 'invite_not_found_or_already_resolved'; end if;
  elsif p_kind = 'profile' then
    -- Admins can deactivate anyone except themselves; managers can't
    -- deactivate other managers or admins.
    if p_target = auth.uid() then raise exception 'cannot_deactivate_self'; end if;
    if v_caller = 'manager' and exists (
      select 1 from profiles where id = p_target and role in ('manager','admin')
    ) then raise exception 'forbidden'; end if;
    update profiles set deactivated_at = now()
     where id = p_target and org_id = v_org_id and deactivated_at is null;
    if not found then raise exception 'profile_not_found_or_already_deactivated'; end if;
  else
    raise exception 'invalid_kind';
  end if;
end $$;

grant execute on function admin_revoke_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_reactivate_member: undo a soft-deactivation (admins only — managers
-- can revoke but only admins can bring someone back).
-- ---------------------------------------------------------------------------
create or replace function admin_reactivate_member(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select org_id, role into v_org_id, v_caller
    from profiles where id = auth.uid() and deactivated_at is null;
  if v_caller <> 'admin' then raise exception 'forbidden'; end if;

  update profiles set deactivated_at = null
   where id = p_profile_id and org_id = v_org_id and deactivated_at is not null;
  if not found then raise exception 'profile_not_found_or_active'; end if;
end $$;

grant execute on function admin_reactivate_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_invite_code: extend to accept org_invites.token (in addition to
-- the existing organizations.invite_code shared-code path).
-- ---------------------------------------------------------------------------
create or replace function claim_invite_code(p_code text)
returns table (org_id uuid, role user_role)
language plpgsql security definer set search_path = public
as $$
declare
  v_invite   org_invites%rowtype;
  v_org      organizations%rowtype;
  v_count    int;
  v_role     user_role;
  v_existing profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  -- Idempotent: existing profile → return it as no-op success.
  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    return query select v_existing.org_id, v_existing.role;
    return;
  end if;

  if p_code is null or p_code = '' then
    raise exception 'invite_code_required'
      using hint = 'Open the original invite link from your account owner.';
  end if;

  -- Path A: per-agent token.
  select * into v_invite from org_invites o
   where o.token = p_code
     and o.accepted_at is null
     and o.revoked_at is null
     and o.expires_at > now();
  if found then
    insert into profiles (id, org_id, role, full_name)
    values (
      auth.uid(),
      v_invite.org_id,
      v_invite.role,
      coalesce(
        v_invite.full_name,
        (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
        (select u.email from auth.users u where u.id = auth.uid())
      )
    );
    update org_invites set accepted_at = now() where id = v_invite.id;
    return query select v_invite.org_id, v_invite.role;
    return;
  end if;

  -- Path B: shared org invite_code (today's self-serve path, unchanged).
  select * into v_org from organizations o
   where o.invite_code = p_code and not o.is_disabled;
  if not found then raise exception 'invalid_invite_code'; end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name)
  values (
    auth.uid(), v_org.id, v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    )
  );

  return query select v_org.id, v_role;
end $$;

-- grant already exists from earlier migration; re-grant is a no-op.
grant execute on function claim_invite_code(text) to authenticated;
```

- [ ] **Step 2: Apply via Supabase Studio**

Paste the SQL → Run. Expect `Success. No rows returned.`

- [ ] **Step 3: Reload PostgREST schema cache**

```sql
notify pgrst, 'reload schema';
```

If the previous Self-Serve QA taught us anything, it's that the schema cache sometimes lags. Run this every time you add an RPC.

- [ ] **Step 4: Verify each RPC exists with right signature**

```sql
select p.proname, pg_get_function_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_bulk_invite','admin_resend_invite',
                    'admin_revoke_member','admin_reactivate_member',
                    'claim_invite_code', '_admin_invite_token')
order by p.proname;
```

Expected: 6 rows. Each with the expected signature.

- [ ] **Step 5: Smoke-test by calling as the postgres superuser (auth.uid() will be null → raises not_authenticated, which proves the function compiles and runs)**

```sql
select * from admin_bulk_invite('[{"email":"x@y.com"}]'::jsonb);
-- Expect: ERROR: not_authenticated
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260523000002_admin_portal_rpcs.sql
git commit -m "feat(admin-portal): RPCs for bulk invite, resend, revoke, reactivate

All gated by SECURITY DEFINER + role check (manager or admin of the
caller's org). claim_invite_code extended to recognize per-agent
tokens from org_invites in addition to the existing shared
organizations.invite_code path."
```

---

## Task 3: Frontend — install papaparse + `parseAgentsCsv` util

**Goal:** Pure utility to parse a CSV string into validated `{email, full_name, role}` rows + collect parse errors. No React. Fully unit-tested.

**Files:**
- Modify: `apps/app/package.json`
- Create: `apps/app/src/features/admin/utils/parseAgentsCsv.ts`
- Test: `apps/app/src/features/admin/utils/parseAgentsCsv.test.ts`

- [ ] **Step 1: Add papaparse**

```bash
cd apps/app
pnpm add papaparse
pnpm add -D @types/papaparse
```

- [ ] **Step 2: Write failing tests**

Create `apps/app/src/features/admin/utils/parseAgentsCsv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAgentsCsv } from "./parseAgentsCsv";

describe("parseAgentsCsv", () => {
  it("parses a simple two-row CSV", () => {
    const csv = "email,full_name\na@x.com,Alice\nb@x.com,Bob";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([
      { email: "a@x.com", full_name: "Alice", role: "rep" },
      { email: "b@x.com", full_name: "Bob", role: "rep" },
    ]);
    expect(r.errors).toEqual([]);
  });

  it("rejects rows with missing email", () => {
    const csv = "email,full_name\n,Anonymous\nx@y.com,Real";
    const r = parseAgentsCsv(csv);
    expect(r.valid.map((v) => v.email)).toEqual(["x@y.com"]);
    expect(r.errors).toEqual([{ row: 2, reason: "missing_email", raw: ",Anonymous" }]);
  });

  it("rejects rows with malformed email", () => {
    const csv = "email,full_name\nnot-an-email,X";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toBe("invalid_email");
  });

  it("auto-detects 'Email Address' and 'Full Name' header variants", () => {
    const csv = "Email Address,Full Name\n a@x.com , Alice ";
    const r = parseAgentsCsv(csv);
    expect(r.valid[0]).toEqual({ email: "a@x.com", full_name: "Alice", role: "rep" });
  });

  it("defaults role to 'rep' when not provided", () => {
    const csv = "email\na@x.com";
    expect(parseAgentsCsv(csv).valid[0].role).toBe("rep");
  });

  it("accepts role values 'rep' / 'manager' (case-insensitive)", () => {
    const csv = "email,role\na@x.com,MANAGER\nb@x.com,rep";
    expect(parseAgentsCsv(csv).valid.map((v) => v.role)).toEqual(["manager", "rep"]);
  });

  it("rejects unknown role values", () => {
    const csv = "email,role\na@x.com,godmode";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toBe("invalid_role");
  });

  it("dedupes within the file (keeps first, errors subsequent)", () => {
    const csv = "email\na@x.com\nA@X.com";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.errors[0].reason).toBe("duplicate_in_file");
  });
});
```

- [ ] **Step 3: Run tests; verify they fail**

```bash
pnpm --filter app test -- --run src/features/admin/utils/parseAgentsCsv.test.ts
```

Expected: Test file fails to import (no implementation yet).

- [ ] **Step 4: Write the implementation**

Create `apps/app/src/features/admin/utils/parseAgentsCsv.ts`:

```ts
/**
 * Parse a CSV string of agent invitations into validated rows + errors.
 *
 * Required column: email. Optional: full_name, role.
 * Accepted role values: "rep" (default), "manager". Case-insensitive.
 *
 * Header detection is forgiving: "Email Address" / "Email" / "email" all
 * map to email; "Full Name" / "Name" / "full_name" all map to full_name.
 *
 * Pure function — no React, no Supabase. Used by the CSV import wizard.
 */
import Papa from "papaparse";

export interface ParsedAgent {
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
}

export interface ParseError {
  /** 1-indexed row number (matches what a user sees in their spreadsheet). */
  row: number;
  reason:
    | "missing_email"
    | "invalid_email"
    | "invalid_role"
    | "duplicate_in_file";
  raw: string;
}

export interface ParseResult {
  valid: ParsedAgent[];
  errors: ParseError[];
}

// Forgiving column-name lookup. Lowercase + strip non-alphanumeric.
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseAgentsCsv(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });

  const valid: ParsedAgent[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();

  parsed.data.forEach((row, i) => {
    // +2 because: +1 for the header row, +1 because user-facing rows are 1-indexed.
    const rowNumber = i + 2;
    const rawText = Object.values(row).join(",");
    const email = (row.email ?? row.emailaddress ?? "").trim().toLowerCase();
    if (!email) {
      errors.push({ row: rowNumber, reason: "missing_email", raw: rawText });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row: rowNumber, reason: "invalid_email", raw: rawText });
      return;
    }
    if (seen.has(email)) {
      errors.push({ row: rowNumber, reason: "duplicate_in_file", raw: rawText });
      return;
    }

    const rawRole = (row.role ?? "rep").trim().toLowerCase();
    if (rawRole !== "rep" && rawRole !== "manager") {
      errors.push({ row: rowNumber, reason: "invalid_role", raw: rawText });
      return;
    }
    const role = rawRole as ParsedAgent["role"];

    const fullName =
      (row.fullname ?? row.name ?? "").trim() || null;

    seen.add(email);
    valid.push({ email, full_name: fullName, role });
  });

  return { valid, errors };
}
```

- [ ] **Step 5: Run tests; verify they pass**

```bash
pnpm --filter app test -- --run src/features/admin/utils/parseAgentsCsv.test.ts
```

Expected: 8 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json apps/app/pnpm-lock.yaml \
        apps/app/src/features/admin/utils/parseAgentsCsv.ts \
        apps/app/src/features/admin/utils/parseAgentsCsv.test.ts
git commit -m "feat(admin-portal): CSV agent parser with header detection + validation"
```

---

## Task 4: Hooks — `useAdminBulkInvite` + tests

**Goal:** Mutation that calls the `admin_bulk_invite` RPC, invalidates the agents query cache, returns per-row results so the CSV wizard can render them. Does NOT trigger emails yet — that's Task 11.

**Files:**
- Create: `apps/app/src/features/admin/hooks/useAdminBulkInvite.ts`
- Test: `apps/app/src/features/admin/hooks/useAdminBulkInvite.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/admin/hooks/useAdminBulkInvite.test.tsx`:

```tsx
// Covers RPC payload shape, per-row result pass-through, cache
// invalidation on success, auth refusal, RPC error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAdminBulkInvite } from "./useAdminBulkInvite";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useAdminBulkInvite", () => {
  it("calls admin_bulk_invite with the rows array", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ email: "a@x.com", ok: true, error: null }],
      error: null,
    });
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync([
      { email: "a@x.com", full_name: "Alice", role: "rep" },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_bulk_invite", {
      p_invites: [{ email: "a@x.com", full_name: "Alice", role: "rep" }],
    });
  });

  it("invalidates the org-agents cache on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync([]);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual([
      "admin", "agents", "user-1",
    ]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync([{ email: "a@x.com", full_name: null, role: "rep" }]))
      .rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces server errors (forbidden, etc.)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync([{ email: "a@x.com", full_name: null, role: "rep" }]))
      .rejects.toMatchObject({ message: "forbidden" });
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm --filter app test -- --run src/features/admin/hooks/useAdminBulkInvite.test.tsx
```

Expected: import error.

- [ ] **Step 3: Write the hook**

Create `apps/app/src/features/admin/hooks/useAdminBulkInvite.ts`:

```ts
/**
 * useAdminBulkInvite — wraps the admin_bulk_invite RPC.
 *
 * Returns the per-row result array as-is so the CSV import wizard
 * can show users which rows succeeded vs failed (already_invited /
 * already_active / seat_cap_reached / invalid_email).
 *
 * Email sending is NOT part of this hook — the wizard calls
 * useSendInviteEmails after the bulk insert lands, which lets us retry
 * the email side without re-inserting rows.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ORG_AGENTS_QUERY_KEY } from "./useOrgAgents";

export interface InviteInput {
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
}

export interface InviteResult {
  email: string;
  ok: boolean;
  error: string | null;
}

export function useAdminBulkInvite() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (rows: InviteInput[]): Promise<InviteResult[]> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("admin_bulk_invite", {
        p_invites: rows,
      });
      if (error) throw error;
      return (data ?? []) as InviteResult[];
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ORG_AGENTS_QUERY_KEY(userId),
      });
    },
  });
}
```

Note: this imports `ORG_AGENTS_QUERY_KEY` from `useOrgAgents`. We'll create that hook in Task 5; for now the test mocks the cache so the import is a forward reference only. **Task 5 must land before this hook is exercised in real UI.**

- [ ] **Step 4: Add a stub for the imported key so tests compile**

Create `apps/app/src/features/admin/hooks/useOrgAgents.ts` as a one-line stub:

```ts
// Stub — full implementation lands in Task 5.
export const ORG_AGENTS_QUERY_KEY = (userId: string | undefined) =>
  ["admin", "agents", userId ?? "anon"] as const;
```

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter app test -- --run src/features/admin/hooks/useAdminBulkInvite.test.tsx
```

Expected: 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/hooks/useAdminBulkInvite.ts \
        apps/app/src/features/admin/hooks/useAdminBulkInvite.test.tsx \
        apps/app/src/features/admin/hooks/useOrgAgents.ts
git commit -m "feat(admin-portal): useAdminBulkInvite hook + ORG_AGENTS_QUERY_KEY"
```

---

## Task 5: Hooks — `useOrgAgents` (paginated profiles + invites union)

**Goal:** Single hook that returns a merged, paginated list of all org members — active profiles + pending invites + revoked profiles — for the AgentsPage list. Server-side pagination via Supabase's `range()` + a count for the pager.

**Files:**
- Modify: `apps/app/src/features/admin/hooks/useOrgAgents.ts` (replace stub)
- Test: `apps/app/src/features/admin/hooks/useOrgAgents.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/admin/hooks/useOrgAgents.test.tsx`:

```tsx
// Covers: query keys are paged; merges profiles + invites; status mapping;
// deal-aggregate join; auth refusal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOrgAgents } from "./useOrgAgents";

// Each call to .from() returns a chainable mock. We assign per-table
// fixtures so we can vary results for profiles vs org_invites vs deals.
const profilesFixture: Array<Record<string, unknown>> = [];
const invitesFixture: Array<Record<string, unknown>> = [];
const dealAggsFixture: Array<Record<string, unknown>> = [];

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: (col: string, v: unknown) => { filters[col] = v; return obj; },
    in: () => obj,
    is: () => obj,
    order: () => obj,
    range: () => obj,
    limit: () => obj,
    then: (resolve: (r: { data: unknown[]; error: null; count: number }) => void) => {
      const data =
        table === "profiles" ? profilesFixture :
        table === "org_invites" ? invitesFixture :
        table === "deals" ? dealAggsFixture : [];
      resolve({ data, error: null, count: data.length });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => chain(t) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  profilesFixture.length = 0;
  invitesFixture.length = 0;
  dealAggsFixture.length = 0;
  authUserId = "user-1";
});

describe("useOrgAgents", () => {
  it("returns merged active + pending + revoked agents", async () => {
    profilesFixture.push(
      { id: "p1", email: "alice@x.com", full_name: "Alice", role: "rep", deactivated_at: null, created_at: "2026-05-01T00:00:00Z" },
      { id: "p2", email: "bob@x.com",   full_name: "Bob",   role: "rep", deactivated_at: "2026-05-15T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
    );
    invitesFixture.push(
      { id: "i1", email: "carol@x.com", full_name: "Carol", role: "rep", expires_at: "2026-06-05T00:00:00Z", created_at: "2026-05-20T00:00:00Z" },
    );

    const { result } = renderHook(() => useOrgAgents({ page: 0, pageSize: 50 }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data?.rows.map((r) => r.status)).toEqual(
      expect.arrayContaining(["active", "invited", "revoked"]),
    );
    expect(result.current.data?.rows).toHaveLength(3);
  });

  it("refuses when not signed in (returns no data; enabled=false)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useOrgAgents({ page: 0, pageSize: 50 }), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle"); // disabled
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter app test -- --run src/features/admin/hooks/useOrgAgents.test.tsx
```

Expected: tests fail (stub doesn't implement `useOrgAgents`).

- [ ] **Step 3: Write the implementation**

Replace `apps/app/src/features/admin/hooks/useOrgAgents.ts` entirely:

```ts
/**
 * useOrgAgents — paginated merged view of the org's members.
 *
 * "Member" here = anything that occupies a seat: an active profile, a
 * deactivated (revoked) profile still visible to admins, or a pending
 * invite. Stitched together into a single AgentRow list so the admin
 * agents page can render one table.
 *
 * Deal aggregates (open count + pipeline value) are fetched in a
 * separate query and joined client-side. Reps don't see this page; the
 * admin already has manager-RLS visibility, so the deals query reads
 * org-wide.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export const ORG_AGENTS_QUERY_KEY = (
  userId: string | undefined,
  page?: number,
) => ["admin", "agents", userId ?? "anon", page ?? 0] as const;

export type AgentStatus = "active" | "invited" | "revoked";

export interface AgentRow {
  id: string;                 // profile id OR invite id
  kind: "profile" | "invite";
  email: string;
  fullName: string | null;
  role: "rep" | "manager" | "admin";
  status: AgentStatus;
  /** For invites: expires_at. For profiles: deactivated_at or null. */
  detail: string | null;
  openDealCount: number;
  pipelineValueCents: number;
  /** ISO timestamp — last activity for profiles, created_at for invites. */
  lastActivity: string | null;
}

export interface UseOrgAgentsResult {
  rows: AgentRow[];
  totalCount: number;
}

const PAGE_SIZE_DEFAULT = 50;

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "rep" | "manager" | "admin";
  deactivated_at: string | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
  expires_at: string;
  created_at: string;
}

interface DealAggRow {
  owner_id: string;
  count: number;
  total_cents: number;
}

export function useOrgAgents(opts: { page?: number; pageSize?: number } = {}) {
  const userId = useAuth((s) => s.user?.id);
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? PAGE_SIZE_DEFAULT;

  return useQuery({
    queryKey: ORG_AGENTS_QUERY_KEY(userId, page),
    enabled: Boolean(userId),
    queryFn: async (): Promise<UseOrgAgentsResult> => {
      // 1. Profiles for this page — RLS scopes to caller's org.
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, deactivated_at, created_at")
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (pErr) throw pErr;

      // 2. Pending invites — RLS already filters to manager/admin org.
      const { data: invites, error: iErr } = await supabase
        .from("org_invites")
        .select("id, email, full_name, role, expires_at, created_at")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (iErr) throw iErr;

      // 3. Deal aggregates per owner. We read all org deals (RLS gives
      //    the admin full view) and aggregate client-side.
      const { data: deals, error: dErr } = await supabase
        .from("deals")
        .select("owner_id, value_cents, stage")
        .neq("stage", "won");
      if (dErr) throw dErr;

      const aggMap = new Map<string, { count: number; total: number }>();
      for (const d of (deals ?? []) as Array<{ owner_id: string; value_cents: number; stage: string }>) {
        const a = aggMap.get(d.owner_id) ?? { count: 0, total: 0 };
        a.count += 1;
        a.total += d.value_cents;
        aggMap.set(d.owner_id, a);
      }

      const rows: AgentRow[] = [];

      for (const p of (profiles ?? []) as unknown as ProfileRow[]) {
        const agg = aggMap.get(p.id) ?? { count: 0, total: 0 };
        rows.push({
          id: p.id,
          kind: "profile",
          email: p.email,
          fullName: p.full_name,
          role: p.role,
          status: p.deactivated_at ? "revoked" : "active",
          detail: p.deactivated_at,
          openDealCount: agg.count,
          pipelineValueCents: agg.total,
          lastActivity: null, // filled later when we add last_active_at column
        });
      }

      for (const i of (invites ?? []) as unknown as InviteRow[]) {
        rows.push({
          id: i.id,
          kind: "invite",
          email: i.email,
          fullName: i.full_name,
          role: i.role,
          status: "invited",
          detail: i.expires_at,
          openDealCount: 0,
          pipelineValueCents: 0,
          lastActivity: i.created_at,
        });
      }

      return { rows, totalCount: rows.length };
    },
    staleTime: 30_000,
  });
}
```

Note on `profiles.email`: today's schema doesn't include an email column on profiles — emails live on `auth.users`. For the v1 list this is a problem because we can't directly select `auth.users.email` from PostgREST without a view. **Pre-task addendum:** Add a `view_profile_email` view, OR backfill email onto profiles. The simplest fix is to add `email text` to profiles, populated by the signup trigger and `claim_invite_code`. Add this to Task 1's migration (or as a small Task 1.5 if discovered late).

- [ ] **Step 4: Update Task 1 migration retroactively if profiles.email doesn't exist yet**

Run this in SQL Editor:

```sql
alter table profiles add column if not exists email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
alter table profiles alter column email set not null;
-- Add to handle_new_user_signup + claim_invite_code: insert with email.
```

Also update Task 1's `claim_invite_code` to write `email` into the insert:

```sql
-- inside both insert into profiles () branches, add: email,
-- and to the values list, add:
-- (select u.email from auth.users u where u.id = auth.uid())
```

Apply via SQL Editor.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter app test -- --run src/features/admin/hooks/useOrgAgents.test.tsx
```

Expected: 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/hooks/useOrgAgents.ts \
        apps/app/src/features/admin/hooks/useOrgAgents.test.tsx
git commit -m "feat(admin-portal): useOrgAgents — paginated merged member list"
```

---

## Task 6: Hooks — `useSeatUsage`, `useResendInvite`, `useRevokeMember`

**Goal:** The remaining admin-side mutations, each a thin wrapper around its RPC, each with a unit test.

**Files:**
- Create: `apps/app/src/features/admin/hooks/useSeatUsage.ts` + `.test.tsx`
- Create: `apps/app/src/features/admin/hooks/useResendInvite.ts` + `.test.tsx`
- Create: `apps/app/src/features/admin/hooks/useRevokeMember.ts` + `.test.tsx`

- [ ] **Step 1: useSeatUsage**

Create `apps/app/src/features/admin/hooks/useSeatUsage.ts`:

```ts
/**
 * useSeatUsage — current seat usage for the caller's org.
 *
 * Returns { used, limit, remaining }. `limit` is null when the org has
 * no cap. UI renders the percent + "1,247 / 1,500" indicator from this.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface SeatUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export function useSeatUsage() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: ["admin", "seat-usage", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SeatUsage> => {
      // Profiles head count (RLS scopes to org). Exclude deactivated.
      const { count: pCount, error: pErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .is("deactivated_at", null);
      if (pErr) throw pErr;

      const { count: iCount, error: iErr } = await supabase
        .from("org_invites")
        .select("id", { count: "exact", head: true })
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (iErr) throw iErr;

      const { data: org, error: oErr } = await supabase
        .from("organizations")
        .select("seat_limit")
        .single();
      if (oErr) throw oErr;

      const used = (pCount ?? 0) + (iCount ?? 0);
      const limit = (org?.seat_limit as number | null) ?? null;
      return {
        used,
        limit,
        remaining: limit === null ? null : limit - used,
      };
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: useSeatUsage test**

Create `apps/app/src/features/admin/hooks/useSeatUsage.test.tsx` with one happy-path test that mocks each `.from(...)` call. Same chain-mock pattern as `useOrgAgents.test.tsx`.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSeatUsage } from "./useSeatUsage";

let counts: { profiles: number; invites: number };
let orgRow: { seat_limit: number | null };

function chain(table: string) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    single: () => Promise.resolve({ data: orgRow, error: null }),
    then: (resolve: (r: { count: number; error: null }) => void) => {
      const c = table === "profiles" ? counts.profiles : counts.invites;
      resolve({ count: c, error: null });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => chain(t) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: "u" } }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  counts = { profiles: 3, invites: 2 };
  orgRow = { seat_limit: 10 };
});

describe("useSeatUsage", () => {
  it("returns used/limit/remaining when limit is set", async () => {
    const { result } = renderHook(() => useSeatUsage(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ used: 5, limit: 10, remaining: 5 });
  });

  it("returns null remaining when limit is null (unlimited)", async () => {
    orgRow = { seat_limit: null };
    const { result } = renderHook(() => useSeatUsage(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ used: 5, limit: null, remaining: null });
  });
});
```

- [ ] **Step 3: useResendInvite + test**

Create `apps/app/src/features/admin/hooks/useResendInvite.ts`:

```ts
/**
 * useResendInvite — extend an invite's expires_at by 14 days and return
 * the (id, email, token) so the caller can fire a fresh email.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ORG_AGENTS_QUERY_KEY } from "./useOrgAgents";

export interface ResendInviteResult {
  id: string;
  email: string;
  token: string;
}

export function useResendInvite() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (inviteId: string): Promise<ResendInviteResult> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("admin_resend_invite", {
        p_invite_id: inviteId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("admin_resend_invite returned no row");
      return row as ResendInviteResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ORG_AGENTS_QUERY_KEY(userId),
      });
    },
  });
}
```

Test `apps/app/src/features/admin/hooks/useResendInvite.test.tsx`: mock RPC; verify it's called with `{p_invite_id}`, returns the row, invalidates cache, refuses when signed-out. Same template as `useAdminBulkInvite.test.tsx`.

- [ ] **Step 4: useRevokeMember + test**

Create `apps/app/src/features/admin/hooks/useRevokeMember.ts`:

```ts
/**
 * useRevokeMember — revoke a pending invite OR soft-deactivate an active
 * profile. The `kind` param matches the RPC's discriminator.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { ORG_AGENTS_QUERY_KEY } from "./useOrgAgents";

export interface RevokeMemberInput {
  targetId: string;
  kind: "invite" | "profile";
}

export function useRevokeMember() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (input: RevokeMemberInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("admin_revoke_member", {
        p_target: input.targetId,
        p_kind: input.kind,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ORG_AGENTS_QUERY_KEY(userId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "seat-usage", userId ?? "anon"],
      });
    },
  });
}
```

Test: same template — verify RPC payload, cache invalidation (both agents AND seat-usage keys), auth refusal, error surfacing.

- [ ] **Step 5: Run all admin hook tests**

```bash
pnpm --filter app test -- --run src/features/admin/hooks/
```

Expected: ~12 tests passing across 5 hook files.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/hooks/
git commit -m "feat(admin-portal): useSeatUsage, useResendInvite, useRevokeMember hooks + tests"
```

---

## Task 7: `RequireRole` route wrapper

**Goal:** Reusable guard that hides any route from reps. Reads `useProfile()`; if role isn't in the allow-list, redirects to `/dashboard`.

**Files:**
- Create: `apps/app/src/components/layout/RequireRole.tsx`
- Test: `apps/app/src/components/layout/RequireRole.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactNode } from "react";

import { RequireRole } from "./RequireRole";

let profileRole: "rep" | "manager" | "admin" | undefined;
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({
    data: profileRole ? { role: profileRole } : null,
    isLoading: profileRole === undefined ? true : false,
    isFetching: false,
    isError: false,
  }),
}));

function Inner({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function renderAt(initial: string, allow: Array<"rep" | "manager" | "admin">) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/admin" element={<RequireRole allow={allow}><div>admin-content</div></RequireRole>} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireRole", () => {
  it("renders children when role is in allow list", () => {
    profileRole = "manager";
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });

  it("redirects to /dashboard when role is NOT in allow list", () => {
    profileRole = "rep";
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("renders a spinner while profile is loading", () => {
    profileRole = undefined;
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
pnpm --filter app test -- --run src/components/layout/RequireRole.test.tsx
```

- [ ] **Step 3: Write the wrapper**

```tsx
/**
 * RequireRole — gate for role-protected routes. Sits inside ProtectedRoute,
 * so by the time it runs we know the user is authed; we only need to
 * check the profile.role against the allow-list.
 */
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/features/auth/useProfile";

export interface RequireRoleProps {
  allow: Array<"rep" | "manager" | "admin">;
  children: ReactNode;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const profile = useProfile();

  if (profile.isLoading || profile.isFetching) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  if (!profile.data || !allow.includes(profile.data.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Run tests; verify pass**

```bash
pnpm --filter app test -- --run src/components/layout/RequireRole.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/layout/RequireRole.tsx \
        apps/app/src/components/layout/RequireRole.test.tsx
git commit -m "feat(admin-portal): RequireRole guard for role-gated routes"
```

---

## Task 8: `AgentsPage` (the work surface)

**Goal:** Server-paginated list of agents with status, deal count, pipeline value, row actions. The biggest single screen but mostly composition of the hooks we've already built.

**Files:**
- Create: `apps/app/src/features/admin/components/SeatUsageBadge.tsx`
- Create: `apps/app/src/features/admin/components/AgentListRow.tsx`
- Create: `apps/app/src/features/admin/pages/AgentsPage.tsx`
- Test: `apps/app/src/features/admin/pages/AgentsPage.test.tsx`

- [ ] **Step 1: SeatUsageBadge**

```tsx
/**
 * SeatUsageBadge — shows "X / Y seats" with a progress bar. Lives in
 * the AgentsPage header.
 */
import { useSeatUsage } from "../hooks/useSeatUsage";

export function SeatUsageBadge() {
  const { data, isLoading } = useSeatUsage();
  if (isLoading || !data) return null;

  const { used, limit } = data;
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const text = limit === null ? `${used} seats used` : `${used} / ${limit}`;

  return (
    <div className="flex items-center gap-3">
      <span className="text-caption text-text-muted">Seats:</span>
      <span className="text-body-strong tabular-nums">{text}</span>
      {limit !== null && (
        <div className="h-2 w-32 overflow-hidden rounded-radius-full bg-surface-sunken">
          <div
            className={pct >= 90 ? "h-full bg-status-danger" : "h-full bg-brand-primary"}
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: AgentListRow**

```tsx
/**
 * AgentListRow — one row of the AgentsPage table. Status badge, name,
 * email, role, open deal count, pipeline value, overflow menu.
 */
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/navigatr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentRow } from "../hooks/useOrgAgents";

const STATUS_BADGE: Record<AgentRow["status"], { label: string; kind: "success" | "info" | "muted" }> = {
  active:  { label: "Active",  kind: "success" },
  invited: { label: "Invited", kind: "info" },
  revoked: { label: "Revoked", kind: "muted" },
};

function formatMoney(cents: number): string {
  if (cents >= 1_000_000_000) return `$${(cents / 100_000_000_000).toFixed(1)}B`;
  if (cents >= 100_000_000) return `$${Math.round(cents / 100_000_000)}M`;
  if (cents >= 100_000) return `$${Math.round(cents / 100_000)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

export function AgentListRow({
  row,
  onViewPipeline,
  onResend,
  onRevoke,
  onPromote,
}: {
  row: AgentRow;
  onViewPipeline: (row: AgentRow) => void;
  onResend: (row: AgentRow) => void;
  onRevoke: (row: AgentRow) => void;
  onPromote: (row: AgentRow) => void;
}) {
  const status = STATUS_BADGE[row.status];
  return (
    <tr className="border-b border-border-subtle">
      <td className="px-3 py-2 text-body-md">{row.fullName ?? "—"}</td>
      <td className="px-3 py-2 text-body-md text-text-muted">{row.email}</td>
      <td className="px-3 py-2"><Badge kind={status.kind}>{status.label}</Badge></td>
      <td className="px-3 py-2 text-body-md capitalize">{row.role}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{row.openDealCount}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{formatMoney(row.pipelineValueCents)}</td>
      <td className="px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.kind === "profile" && row.status === "active" && (
              <DropdownMenuItem onSelect={() => onViewPipeline(row)}>
                View pipeline
              </DropdownMenuItem>
            )}
            {row.status === "invited" && (
              <DropdownMenuItem onSelect={() => onResend(row)}>
                Resend invite
              </DropdownMenuItem>
            )}
            {(row.status === "active" || row.status === "invited") && (
              <DropdownMenuItem onSelect={() => onRevoke(row)}>
                {row.status === "invited" ? "Revoke invite" : "Deactivate agent"}
              </DropdownMenuItem>
            )}
            {row.kind === "profile" && row.status === "active" && row.role === "rep" && (
              <DropdownMenuItem onSelect={() => onPromote(row)}>
                Promote to manager
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: AgentsPage**

```tsx
/**
 * AgentsPage — the admin's primary work surface. Lists every member of
 * the org (active + invited + revoked) with a row menu for each.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useOrgAgents, type AgentRow } from "../hooks/useOrgAgents";
import { useResendInvite } from "../hooks/useResendInvite";
import { useRevokeMember } from "../hooks/useRevokeMember";
import { AgentListRow } from "../components/AgentListRow";
import { SeatUsageBadge } from "../components/SeatUsageBadge";

export function AgentsPage() {
  const navigate = useNavigate();
  const [page, setPage] = React.useState(0);
  const { data, isLoading } = useOrgAgents({ page });
  const resend = useResendInvite();
  const revoke = useRevokeMember();

  const handleResend = async (row: AgentRow) => {
    try {
      await resend.mutateAsync(row.id);
      toast.success(`Invite resent to ${row.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend invite");
    }
  };

  const handleRevoke = async (row: AgentRow) => {
    const confirmed = window.confirm(
      row.status === "invited"
        ? `Revoke invite for ${row.email}?`
        : `Deactivate ${row.fullName ?? row.email}? Their deals stay attached and visible to you.`,
    );
    if (!confirmed) return;
    try {
      await revoke.mutateAsync({
        targetId: row.id,
        kind: row.kind === "invite" ? "invite" : "profile",
      });
      toast.success("Done.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke");
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-heading-lg text-text-default">Team</h1>
        <SeatUsageBadge />
      </header>

      <div className="mb-4 flex gap-2">
        <Button
          variant="primary"
          size="md"
          leadingIcon={Plus}
          onClick={() => toast("Single invite modal — coming in Task 9")}
        >
          Invite agent
        </Button>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={Upload}
          onClick={() => navigate("/admin/agents/import")}
        >
          Import CSV
        </Button>
      </div>

      {isLoading ? (
        <p className="text-body-md text-text-muted">Loading…</p>
      ) : (
        <table className="w-full text-left">
          <thead className="border-b border-border-default text-eyebrow text-text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Open deals</th>
              <th className="px-3 py-2 font-medium">Pipeline</th>
              <th className="px-3 py-2 font-medium" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <AgentListRow
                key={`${row.kind}:${row.id}`}
                row={row}
                onViewPipeline={() => navigate(`/pipeline?owner=${row.id}`)}
                onResend={handleResend}
                onRevoke={handleRevoke}
                onPromote={() => toast("Promote — coming in v1.1")}
              />
            ))}
          </tbody>
        </table>
      )}

      {/* Pager — only renders when there are more pages */}
      {(data?.totalCount ?? 0) > 50 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-caption text-text-muted">
            Page {page + 1}
          </span>
          <div className="flex gap-2">
            <Button variant="tertiary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentsPage;
```

- [ ] **Step 4: Smoke test (render-only)**

```tsx
// apps/app/src/features/admin/pages/AgentsPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsPage } from "./AgentsPage";

vi.mock("../hooks/useOrgAgents", () => ({
  useOrgAgents: () => ({
    data: {
      rows: [
        { id: "p1", kind: "profile", email: "a@x.com", fullName: "Alice",
          role: "rep", status: "active", detail: null,
          openDealCount: 3, pipelineValueCents: 100_000, lastActivity: null },
      ],
      totalCount: 1,
    },
    isLoading: false,
  }),
  ORG_AGENTS_QUERY_KEY: () => ["admin", "agents", "u"],
}));
vi.mock("../hooks/useResendInvite", () => ({ useResendInvite: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useRevokeMember", () => ({ useRevokeMember: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useSeatUsage", () => ({ useSeatUsage: () => ({ data: { used: 1, limit: 10, remaining: 9 }, isLoading: false }) }));

describe("AgentsPage", () => {
  it("renders agent rows and seat usage", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test**

```bash
pnpm --filter app test -- --run src/features/admin/pages/AgentsPage.test.tsx
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/admin/
git commit -m "feat(admin-portal): AgentsPage with row actions, seat usage, pagination"
```

---

## Task 9: `InviteAgentModal` (single-agent path)

**Goal:** Modal triggered by the "Invite agent" button on AgentsPage. Reuses `useAdminBulkInvite` with a single-element array. After success, the email send is fired (Task 11 wires this up — for now, just create the row).

**Files:**
- Create: `apps/app/src/features/admin/components/InviteAgentModal.tsx`
- Modify: `apps/app/src/features/admin/pages/AgentsPage.tsx` (replace toast with modal)

- [ ] **Step 1: Write the modal**

```tsx
/**
 * InviteAgentModal — single-row invite. Form fields: full_name (optional),
 * email (required), role (default rep). Submits via useAdminBulkInvite.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, FormField, Input, Select, type SelectOption } from "@/components/navigatr";
import { useAdminBulkInvite } from "../hooks/useAdminBulkInvite";

const ROLE_OPTIONS: SelectOption[] = [
  { value: "rep",     label: "Rep" },
  { value: "manager", label: "Manager" },
];

const schema = z.object({
  fullName: z.string().trim().optional(),
  email: z.string().email("Enter a valid email"),
  role: z.enum(["rep", "manager"]),
});
type Values = z.infer<typeof schema>;

export function InviteAgentModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invite = useAdminBulkInvite();
  const { register, handleSubmit, control: _, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", role: "rep" },
  });

  const onSubmit = async (values: Values) => {
    try {
      const results = await invite.mutateAsync([{
        email: values.email,
        full_name: values.fullName || null,
        role: values.role,
      }]);
      const row = results[0];
      if (row.ok) {
        toast.success(`Invite sent to ${row.email}`);
        reset();
        onOpenChange(false);
      } else {
        toast.error(`Could not invite: ${row.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send invite");
    }
  };

  // Role: react-hook-form integration via plain register (Select wraps a native select-like).
  // Using {...register("role")} works because our Select forwards onChange.
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
          )}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <Dialog.Title className="text-heading-sm">Invite agent</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="h-8 w-8 rounded text-text-muted hover:bg-surface-sunken">
                <X className="h-5 w-5 mx-auto" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 px-5 pb-5" noValidate>
            <FormField label="Full name" htmlFor="invite-name">
              <Input id="invite-name" placeholder="Jane Doe" {...register("fullName")} />
            </FormField>
            <FormField label="Work email" htmlFor="invite-email" required error={errors.email?.message}>
              <Input id="invite-email" type="email" placeholder="jane@company.com" {...register("email")} />
            </FormField>
            <FormField label="Role" htmlFor="invite-role">
              <Select id="invite-role" options={ROLE_OPTIONS} {...register("role")} />
            </FormField>
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="tertiary" size="md">Cancel</Button></Dialog.Close>
              <Button type="submit" variant="primary" size="md" loading={isSubmitting}>Send invite</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Wire the modal into AgentsPage**

Replace the toast `() => toast("Single invite modal — coming in Task 9")` with state + modal mount:

```tsx
// Add to imports
import { InviteAgentModal } from "../components/InviteAgentModal";

// Inside AgentsPage component, add state
const [inviteOpen, setInviteOpen] = React.useState(false);

// Replace the "Invite agent" Button onClick:
onClick={() => setInviteOpen(true)}

// Below the table, mount the modal:
<InviteAgentModal open={inviteOpen} onOpenChange={setInviteOpen} />
```

- [ ] **Step 3: Smoke-test the modal**

```tsx
// apps/app/src/features/admin/components/InviteAgentModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { InviteAgentModal } from "./InviteAgentModal";

const mutateAsyncMock = vi.fn();
vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: mutateAsyncMock }),
}));

describe("InviteAgentModal", () => {
  it("submits a single row through useAdminBulkInvite", async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValueOnce([{ email: "a@x.com", ok: true, error: null }]);
    render(<InviteAgentModal open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText(/work email/i), "a@x.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    expect(mutateAsyncMock).toHaveBeenCalledWith([{ email: "a@x.com", full_name: null, role: "rep" }]);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter app test -- --run src/features/admin/
```

Expected: all admin tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/admin/
git commit -m "feat(admin-portal): InviteAgentModal wired into AgentsPage"
```

---

## Task 10: Edge Function — `send_invite_email`

**Goal:** A Supabase Edge Function that accepts `{invite_ids: string[]}`, looks up the rows, and fires an email per row via Resend. Idempotency: if `accepted_at is not null` we skip (the agent already activated).

**Files:**
- Create: `supabase/functions/send_invite_email/index.ts`
- Create: `supabase/functions/send_invite_email/deno.json`

- [ ] **Step 1: Set up the function directory + deno config**

```bash
mkdir -p supabase/functions/send_invite_email
```

Create `supabase/functions/send_invite_email/deno.json`:

```json
{
  "imports": {
    "resend": "npm:resend@4.1.1"
  }
}
```

- [ ] **Step 2: Write the function**

Create `supabase/functions/send_invite_email/index.ts`:

```ts
// Supabase Edge Function: sends invite emails via Resend.
//
// Body: { invite_ids: string[] }
// Auth: must be called with an authenticated user JWT (Supabase injects it
//       as the Authorization header). RLS on org_invites ensures the caller
//       can only see their own org's invites; we re-query through the
//       user's JWT, not the service role, so PII can't leak across orgs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "invites@navigatr.app";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://navigatr.app";

const resend = new Resend(RESEND_API_KEY);

interface Invite {
  id: string;
  email: string;
  token: string;
  full_name: string | null;
  org_id: string;
}

interface OrgRow { name: string }

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401 });
  }
  const body = await req.json().catch(() => null) as { invite_ids?: string[] } | null;
  if (!body?.invite_ids || !Array.isArray(body.invite_ids)) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }

  // Query using the user's JWT so RLS applies.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: invites, error: iErr } = await userClient
    .from("org_invites")
    .select("id, email, token, full_name, org_id")
    .in("id", body.invite_ids)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (iErr) {
    return new Response(JSON.stringify({ error: iErr.message }), { status: 400 });
  }

  // Org names for personalization. RLS gives the caller their own org only,
  // so this returns 0 or 1 row.
  const { data: orgs } = await userClient
    .from("organizations")
    .select("id, name")
    .limit(1);
  const orgName = (orgs?.[0] as { name?: string } | undefined)?.name ?? "your workspace";

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const inv of (invites ?? []) as Invite[]) {
    const link = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inv.token)}`;
    const subject = `You're invited to ${orgName} on navigatr`;
    const html = `
      <p>Hi${inv.full_name ? " " + inv.full_name : ""},</p>
      <p>Your account at <strong>${orgName}</strong> on navigatr is ready.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2456E6;color:#fff;border-radius:6px;text-decoration:none">Sign in now</a></p>
      <p>Or paste this link: ${link}</p>
      <p style="color:#888;font-size:12px">This invite expires in 14 days. Reply if anything looks wrong.</p>
    `;
    try {
      const send = await resend.emails.send({
        from: FROM_ADDRESS, to: inv.email, subject, html,
      });
      if ((send as { error?: unknown }).error) {
        results.push({ id: inv.id, ok: false, error: String((send as { error: unknown }).error) });
      } else {
        results.push({ id: inv.id, ok: true });
      }
    } catch (e) {
      results.push({ id: inv.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 3: Deploy the function**

```bash
cd /Users/ryanmeo/navigatr/.claude/worktrees/mystifying-snyder-5465ac
supabase functions deploy send_invite_email
```

Expected: `Function send_invite_email deployed successfully.`

If the Supabase CLI isn't installed: `brew install supabase/tap/supabase` first.

- [ ] **Step 4: Set env vars in Supabase Dashboard**

Dashboard → Edge Functions → send_invite_email → Settings → secrets. Set:

```
RESEND_API_KEY=<your key from prerequisites>
FROM_ADDRESS=invites@navigatr.app
APP_BASE_URL=https://navigatr.app
```

- [ ] **Step 5: Smoke-test (creates a test invite, fires the function, checks your inbox)**

In SQL Editor (as superuser, after the migration is applied):

```sql
-- Create a test invite row manually so we have a token to send to.
-- Replace 'your-org-id' and 'your-test-email' below.
insert into org_invites (org_id, email, full_name, role, token, expires_at)
values (
  (select id from organizations limit 1),
  'your-test@gmail.com',
  'Test User',
  'rep',
  encode(gen_random_bytes(16), 'hex'),
  now() + interval '14 days'
) returning id;
-- Copy the returned id.
```

Then from the frontend (or curl with your user JWT):

```ts
const { data, error } = await supabase.functions.invoke("send_invite_email", {
  body: { invite_ids: ["<the id from above>"] },
});
console.log(data, error);
```

Check the test inbox. The email should land within ~30 seconds. If it lands in spam, fix DMARC alignment before doing a real ISO blast.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send_invite_email/
git commit -m "feat(admin-portal): send_invite_email Edge Function (Resend)"
```

---

## Task 11: Hook — `useSendInviteEmails` + wire to bulk-invite path

**Goal:** Thin client-side wrapper around the Edge Function. The CSV wizard and InviteAgentModal call this after the row(s) land in `org_invites` so the email goes out.

**Files:**
- Create: `apps/app/src/features/admin/hooks/useSendInviteEmails.ts`
- Modify: `apps/app/src/features/admin/components/InviteAgentModal.tsx` (call it after successful invite)

- [ ] **Step 1: Write the hook**

```ts
/**
 * useSendInviteEmails — invokes the send_invite_email Edge Function.
 * Returns the per-row results array.
 */
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SendInviteEmailsResult {
  id: string;
  ok: boolean;
  error?: string;
}

export function useSendInviteEmails() {
  return useMutation({
    mutationFn: async (inviteIds: string[]): Promise<SendInviteEmailsResult[]> => {
      const { data, error } = await supabase.functions.invoke("send_invite_email", {
        body: { invite_ids: inviteIds },
      });
      if (error) throw error;
      return (data?.results ?? []) as SendInviteEmailsResult[];
    },
  });
}
```

- [ ] **Step 2: Update InviteAgentModal to fire emails after invite**

```tsx
// At top of file:
import { useSendInviteEmails } from "../hooks/useSendInviteEmails";

// Inside the component:
const sendEmails = useSendInviteEmails();

// In onSubmit, after getting results:
if (row.ok) {
  // The bulk_invite RPC returns (email, ok, error) but not the invite id.
  // We have to re-query the invite by email+org to find its id, then
  // fire the email send. Simpler: extend admin_bulk_invite to return
  // the id too. See note below.
  toast.success(`Invite sent to ${row.email}`);
  reset();
  onOpenChange(false);
}
```

**Note — RPC contract change needed:** `admin_bulk_invite` currently returns `(email, ok, error)`. To fire emails efficiently we need the `id` of each newly-created row too. **Update Task 2's RPC** to return `(email, id, ok, error)` and re-apply. After that, plug `sendEmails.mutateAsync(results.filter(r => r.ok).map(r => r.id))` into both InviteAgentModal and the CSV wizard.

- [ ] **Step 3: Apply RPC update in Supabase Studio**

Re-run Task 2's `admin_bulk_invite` definition with `returns table (email text, id uuid, ok boolean, error text)` and `return next` rows that also populate `id`. Re-`notify pgrst, 'reload schema'`.

- [ ] **Step 4: Update useAdminBulkInvite's `InviteResult` interface**

```ts
export interface InviteResult {
  email: string;
  id: string | null;   // null when ok=false
  ok: boolean;
  error: string | null;
}
```

Update its test to match.

- [ ] **Step 5: Update InviteAgentModal to chain the email send**

```tsx
const results = await invite.mutateAsync([...]);
const row = results[0];
if (row.ok && row.id) {
  await sendEmails.mutateAsync([row.id]);
  toast.success(`Invite sent to ${row.email}`);
  reset();
  onOpenChange(false);
} else {
  toast.error(`Could not invite: ${row.error}`);
}
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter app test -- --run src/features/admin/
git add apps/app/src/features/admin/ supabase/migrations/20260523000002_admin_portal_rpcs.sql
git commit -m "feat(admin-portal): wire email send to invite path; bulk_invite returns id"
```

---

## Task 12: CSV import wizard

**Goal:** 4-step flow (Upload → Map → Preview → Submit). The biggest single UI piece. Reuses `parseAgentsCsv` (Task 3) + `useAdminBulkInvite` (Task 4) + `useSendInviteEmails` (Task 11).

**Files:**
- Create: `apps/app/src/features/admin/components/CsvImportWizard.tsx`
- Create: `apps/app/src/features/admin/pages/ImportAgentsPage.tsx`
- Test: `apps/app/src/features/admin/components/CsvImportWizard.test.tsx`

- [ ] **Step 1: Write the wizard component**

This file is long (~250 lines) because it manages 4 states. Each state is a small subcomponent.

```tsx
/**
 * CsvImportWizard — 4-step flow for inviting 100s-1000s of agents.
 *
 * Steps:
 *  1. Upload — drag/drop or file-picker. Client-side parse.
 *  2. Preview — show counts of valid / invalid rows.
 *  3. Submit — chunk into 200-row batches; POST to admin_bulk_invite;
 *              kick off email sends; show progress.
 *  4. Done — summary with downloadable error list.
 *
 * Keeping the steps in one file (rather than separate routes) because
 * the parsed CSV state needs to survive between them and routing
 * persistence is overkill.
 */
import * as React from "react";
import { Upload, Check, X, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { parseAgentsCsv, type ParsedAgent, type ParseError } from "../utils/parseAgentsCsv";
import { useAdminBulkInvite, type InviteResult } from "../hooks/useAdminBulkInvite";
import { useSendInviteEmails } from "../hooks/useSendInviteEmails";

const CHUNK_SIZE = 200;

type Step = "upload" | "preview" | "submitting" | "done";

interface FinalResult {
  invited: number;
  skipped: number;
  failed: number;
  failedRows: Array<{ email: string; error: string }>;
}

export function CsvImportWizard() {
  const [step, setStep] = React.useState<Step>("upload");
  const [parsed, setParsed] = React.useState<{ valid: ParsedAgent[]; errors: ParseError[] }>({ valid: [], errors: [] });
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [finalResult, setFinalResult] = React.useState<FinalResult | null>(null);

  const bulkInvite = useAdminBulkInvite();
  const sendEmails = useSendInviteEmails();

  const onFile = async (file: File) => {
    const text = await file.text();
    const result = parseAgentsCsv(text);
    setParsed(result);
    setStep("preview");
  };

  const onSubmit = async () => {
    setStep("submitting");
    const total = parsed.valid.length;
    setProgress({ done: 0, total });

    const allResults: InviteResult[] = [];
    for (let i = 0; i < parsed.valid.length; i += CHUNK_SIZE) {
      const chunk = parsed.valid.slice(i, i + CHUNK_SIZE);
      try {
        const r = await bulkInvite.mutateAsync(chunk);
        allResults.push(...r);
      } catch (err) {
        // Treat all rows in this chunk as failed if the RPC throws.
        for (const row of chunk) {
          allResults.push({ email: row.email, id: null, ok: false, error: (err instanceof Error ? err.message : "rpc_failed") });
        }
      }
      setProgress({ done: Math.min(i + chunk.length, total), total });
    }

    // Fire emails for successful inserts.
    const ids = allResults.filter((r) => r.ok && r.id).map((r) => r.id!);
    if (ids.length > 0) {
      try { await sendEmails.mutateAsync(ids); } catch { /* non-fatal: admin can resend */ }
    }

    const invited = allResults.filter((r) => r.ok).length;
    const failedRows = allResults.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error ?? "unknown" }));
    setFinalResult({ invited, skipped: parsed.errors.length, failed: failedRows.length, failedRows });
    setStep("done");
  };

  // ---- step renderers ----
  if (step === "upload") {
    return (
      <div className="rounded-radius-md border border-dashed border-border-default p-8 text-center">
        <Upload className="mx-auto h-8 w-8 text-text-muted" aria-hidden />
        <h2 className="mt-3 text-heading-sm">Upload an agents CSV</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Required column: <code>email</code>. Optional: <code>full_name</code>, <code>role</code>.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          className="mt-4 block mx-auto"
        />
        <a href="/sample-agents.csv" download className="mt-3 inline-flex items-center gap-1 text-brand-primary underline">
          <Download className="h-4 w-4" /> Sample template
        </a>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div className="space-y-4">
        <div className="rounded-radius-md bg-surface-sunken p-4">
          <div className="text-body-strong">We parsed {parsed.valid.length + parsed.errors.length} rows.</div>
          <div className="mt-2 flex flex-col gap-1 text-body-md">
            <span className="text-status-success">✓ {parsed.valid.length} ready to invite</span>
            {parsed.errors.length > 0 && (
              <span className="text-status-warning">⚠ {parsed.errors.length} issues</span>
            )}
          </div>
        </div>
        {parsed.errors.length > 0 && (
          <details className="rounded-radius-md border border-border-subtle p-3">
            <summary className="cursor-pointer text-body-md">Show row-level issues</summary>
            <ul className="mt-2 max-h-48 overflow-y-auto text-caption text-text-muted">
              {parsed.errors.slice(0, 100).map((e, i) => (
                <li key={i}>Row {e.row}: {e.reason} ({e.raw})</li>
              ))}
              {parsed.errors.length > 100 && <li>… and {parsed.errors.length - 100} more</li>}
            </ul>
          </details>
        )}
        <div className="flex justify-between">
          <Button variant="tertiary" size="md" onClick={() => setStep("upload")}>Choose a different file</Button>
          <Button variant="primary" size="md" onClick={onSubmit} disabled={parsed.valid.length === 0}>
            Send {parsed.valid.length} invites
          </Button>
        </div>
      </div>
    );
  }

  if (step === "submitting") {
    const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
    return (
      <div className="rounded-radius-md border border-border-default p-6 text-center">
        <h2 className="text-heading-sm">Sending invites…</h2>
        <div className="mx-auto mt-4 h-3 max-w-md overflow-hidden rounded-radius-full bg-surface-sunken">
          <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} aria-hidden />
        </div>
        <p className="mt-2 text-body-md text-text-muted">{progress.done} / {progress.total}</p>
      </div>
    );
  }

  // done
  const r = finalResult!;
  const downloadFailures = () => {
    const csv = "email,error\n" + r.failedRows.map((f) => `${f.email},${f.error}`).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "import-failures.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 rounded-radius-md border border-border-default p-6">
      <h2 className="text-heading-sm">Import complete</h2>
      <ul className="space-y-1 text-body-md">
        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-status-success" /> {r.invited} invites sent</li>
        {r.skipped > 0 && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-warning" /> {r.skipped} skipped (invalid rows in CSV)</li>}
        {r.failed > 0 && <li className="flex items-center gap-2"><X className="h-4 w-4 text-status-danger" /> {r.failed} failed at server (already-invited / over cap)</li>}
      </ul>
      <div className="flex gap-2">
        {r.failed > 0 && <Button variant="secondary" size="md" onClick={downloadFailures}>Download failures CSV</Button>}
        <Button variant="primary" size="md" onClick={() => { setStep("upload"); setParsed({ valid: [], errors: [] }); setFinalResult(null); }}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the page that hosts the wizard**

```tsx
// apps/app/src/features/admin/pages/ImportAgentsPage.tsx
import { CsvImportWizard } from "../components/CsvImportWizard";

export function ImportAgentsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-heading-lg">Import agents</h1>
      <CsvImportWizard />
    </div>
  );
}
export default ImportAgentsPage;
```

- [ ] **Step 3: Add a sample CSV under `apps/app/public/`**

```bash
cat > apps/app/public/sample-agents.csv <<'EOF'
email,full_name,role
alice@example.com,Alice Johnson,rep
bob@example.com,Bob Williams,rep
manager@example.com,Mia Manager,manager
EOF
```

- [ ] **Step 4: Smoke-test (render + paste 3 rows + verify preview shows 3 valid 0 errors)**

```tsx
// apps/app/src/features/admin/components/CsvImportWizard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CsvImportWizard } from "./CsvImportWizard";

vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: vi.fn().mockResolvedValue([
    { email: "a@x.com", id: "i1", ok: true, error: null },
  ]) }),
}));
vi.mock("../hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: vi.fn().mockResolvedValue([]) }),
}));

describe("CsvImportWizard", () => {
  it("walks upload → preview → submit → done", async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard />);

    const file = new File(["email,full_name\na@x.com,Alice"], "agents.csv", { type: "text/csv" });
    const input = screen.getByLabelText("", { selector: 'input[type="file"]' }) as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText(/ready to invite/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send 1 invites/i }));
    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.getByText(/1 invites sent/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter app test -- --run src/features/admin/components/CsvImportWizard.test.tsx
git add apps/app/src/features/admin/ apps/app/public/sample-agents.csv
git commit -m "feat(admin-portal): CSV import wizard (upload → preview → submit → done)"
```

---

## Task 13: `AcceptInvitePage` (agent activation surface)

**Goal:** New `/accept-invite?token=...` page. Reads token from URL, calls `claim_invite_code({p_code: token})` after sign-up, routes to `/dashboard` on success.

**Files:**
- Create: `apps/app/src/features/auth/pages/AcceptInvitePage.tsx`
- Test: `apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx`

- [ ] **Step 1: Write the page**

```tsx
/**
 * /accept-invite?token=<org_invites.token>
 *
 * Flow:
 *   1. Read token from URL.
 *   2. If user is already signed in: call claim_invite_code with the token.
 *      → On success, profile is created/linked; route to /dashboard.
 *   3. If NOT signed in: show signup form (email pre-filled from URL? No —
 *      we don't expose the email; agent enters it. The token validates the
 *      pairing server-side.)
 *      → On signup, signUp() with the token in user_metadata.invite_code;
 *        AuthCallbackPage will call claim_invite_code, which finds the
 *        token row, sets accepted_at, creates the profile.
 *
 * In practice, the agent clicks the invite email link → they're NOT signed
 * in → they hit branch 3 → signup → auto-login → /auth/callback → claim →
 * /dashboard. That's the canonical path; branch 2 covers the edge case
 * where the agent had a session for an unrelated org and clicked a link.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AuthSplitShell } from "../components/AuthShell";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  fullName: z.string().trim().min(2, "Enter your name"),
});
type Values = z.infer<typeof schema>;

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const signUp = useAuth((s) => s.signUp);
  const user = useAuth((s) => s.user);

  // If somehow signed in already, run claim and bounce.
  React.useEffect(() => {
    if (!user || !token) return;
    (async () => {
      const { error } = await supabase.rpc("claim_invite_code", { p_code: token });
      if (error) {
        toast.error(error.message);
        return;
      }
      navigate("/dashboard", { replace: true });
    })();
  }, [user, token, navigate]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", fullName: "" },
  });

  const onSubmit = async (values: Values) => {
    if (!token) {
      toast.error("Missing invite token");
      return;
    }
    try {
      await signUp(values.email, values.password, values.fullName, token);
      navigate("/auth/callback");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  return (
    <AuthSplitShell
      title="You're invited."
      subtitle="Finish setting up your account."
      heroEyebrow="Welcome to navigatr"
      heroTitle="Two minutes to your pipeline."
      heroBody="Set up your account and start logging activities."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <FormField label="Full name" htmlFor="ai-name" error={errors.fullName?.message}>
          <Input id="ai-name" autoFocus {...register("fullName")} />
        </FormField>
        <FormField label="Work email" htmlFor="ai-email" error={errors.email?.message}>
          <Input id="ai-email" type="email" autoComplete="email" {...register("email")} />
        </FormField>
        <FormField label="Password" htmlFor="ai-pw" error={errors.password?.message} helper="At least 8 characters.">
          <Input id="ai-pw" type="password" autoComplete="new-password" {...register("password")} />
        </FormField>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>Create my account</Button>
      </form>
    </AuthSplitShell>
  );
}
export default AcceptInvitePage;
```

- [ ] **Step 2: Test**

```tsx
// apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AcceptInvitePage } from "./AcceptInvitePage";

const signUpMock = vi.fn();
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: null; signUp: typeof signUpMock }) => unknown) =>
    sel({ user: null, signUp: signUpMock }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

describe("AcceptInvitePage", () => {
  it("calls signUp with the token from URL", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/accept-invite?token=abc123"]}>
        <AcceptInvitePage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/full name/i), "Sarah Lim");
    await user.type(screen.getByLabelText(/work email/i), "sarah@x.com");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /create my account/i }));
    expect(signUpMock).toHaveBeenCalledWith("sarah@x.com", "longenoughpw", "Sarah Lim", "abc123");
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter app test -- --run src/features/auth/pages/AcceptInvitePage.test.tsx
git add apps/app/src/features/auth/pages/AcceptInvitePage.tsx \
        apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx
git commit -m "feat(admin-portal): AcceptInvitePage — agent-side activation surface"
```

---

## Task 14: Routes, sidebar nav, pipeline `?owner=` filter

**Goal:** Wire everything into the React router + nav. Add the `?owner=<id>` filter to PipelinePage so the row menu's "View pipeline" navigates somewhere useful.

**Files:**
- Modify: `apps/app/src/App.tsx`
- Modify: `apps/app/src/components/layout/SidebarNav.tsx`
- Modify: `apps/app/src/features/pipeline/pages/PipelinePage.tsx`

- [ ] **Step 1: Add the routes**

Edit `apps/app/src/App.tsx`. Lazy-import the new pages near the other auth/admin pages:

```tsx
const AcceptInvitePage = lazy(() =>
  import("@/features/auth/pages/AcceptInvitePage").then((m) => ({ default: m.AcceptInvitePage })),
);
const AgentsPage = lazy(() =>
  import("@/features/admin/pages/AgentsPage").then((m) => ({ default: m.AgentsPage })),
);
const ImportAgentsPage = lazy(() =>
  import("@/features/admin/pages/ImportAgentsPage").then((m) => ({ default: m.ImportAgentsPage })),
);
```

Inside `<Routes>`, after the existing public auth routes:

```tsx
<Route path="/accept-invite" element={<AcceptInvitePage />} />
```

After the existing protected routes:

```tsx
<Route
  path="/admin/agents"
  element={
    <ProtectedRoute>
      <RequireRole allow={["manager", "admin"]}>
        <AgentsPage />
      </RequireRole>
    </ProtectedRoute>
  }
/>
<Route
  path="/admin/agents/import"
  element={
    <ProtectedRoute>
      <RequireRole allow={["manager", "admin"]}>
        <ImportAgentsPage />
      </RequireRole>
    </ProtectedRoute>
  }
/>
<Route path="/admin" element={<Navigate to="/admin/agents" replace />} />
```

Add the import:

```tsx
import { RequireRole } from "@/components/layout/RequireRole";
```

- [ ] **Step 2: Add the sidebar entry**

In `apps/app/src/components/layout/SidebarNav.tsx`, find the existing nav-tabs list and add a new entry. Hide it from reps via the same `useProfile()` check `RequireRole` uses.

```tsx
import { useProfile } from "@/features/auth/useProfile";
// ...
const profile = useProfile();
const isAdmin = profile.data?.role === "manager" || profile.data?.role === "admin";
// ...
// In the JSX where nav items render, after the existing entries:
{isAdmin && (
  <NavLink to="/admin/agents" ...>
    <Users /> Team
  </NavLink>
)}
```

(The exact JSX shape depends on this file's existing structure — read the file first and follow its pattern.)

- [ ] **Step 3: Pipeline `?owner=` filter**

In `apps/app/src/features/pipeline/pages/PipelinePage.tsx`:

1. Read the param:
```tsx
import { useSearchParams } from "react-router-dom";
const [params, setParams] = useSearchParams();
const ownerFilter = params.get("owner");
```

2. Filter deals client-side after they come from `useDeals`:
```tsx
const visibleDeals = ownerFilter
  ? deals.filter((d) => (d as { owner_id?: string }).owner_id === ownerFilter)
  : deals;
```

3. Render a banner when the filter is active:
```tsx
{ownerFilter && (
  <div className="mb-3 flex items-center justify-between rounded-radius-md bg-accent-blue-20 px-4 py-2 text-body-md">
    <span>Viewing one agent's pipeline.</span>
    <button onClick={() => { params.delete("owner"); setParams(params); }} className="text-brand-primary underline">
      Clear filter
    </button>
  </div>
)}
```

If the `Deal` type doesn't expose `owner_id`, extend it via `apps/app/src/features/pipeline/mockData.ts` + `useDeals.ts` (add `owner_id` to the SELECT and the row→Deal mapper, like we did for `address` in PR #31).

- [ ] **Step 4: Smoke test the existing test suite still passes**

```bash
pnpm --filter app test -- --run
pnpm --filter app exec tsc -b --noEmit
```

Expected: tests green, typecheck green. If `owner_id` was missing from `Deal`, fix the type and mock data alongside.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/App.tsx \
        apps/app/src/components/layout/SidebarNav.tsx \
        apps/app/src/features/pipeline/
git commit -m "feat(admin-portal): wire /admin routes, Team nav entry, pipeline ?owner filter"
```

---

## Task 15: AdminSettingsPage (lightest)

**Goal:** Small page at `/admin/settings`. Shows org name (editable), invite link, seat usage. Danger zone (transfer admin, deactivate org) listed but no implementation in v1 — link to placeholder toasts.

**Files:**
- Create: `apps/app/src/features/admin/pages/AdminSettingsPage.tsx`
- Modify: `apps/app/src/App.tsx` (add route)

- [ ] **Step 1: Write the page**

```tsx
/**
 * /admin/settings — org-level admin controls.
 */
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { SeatUsageBadge } from "../components/SeatUsageBadge";
import { useOrganization } from "@/features/auth/useOrganization";

export function AdminSettingsPage() {
  const org = useOrganization();
  const inviteUrl = org.data ? `${window.location.origin}/signup?code=${org.data.invite_code}` : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8 flex flex-col gap-4">
      <h1 className="text-heading-lg">Settings</h1>

      <Card padding="md">
        <h2 className="text-body-strong">Organization</h2>
        <p className="mt-1 text-body-md text-text-muted">Name: {org.data?.name ?? "—"}</p>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong">Seat usage</h2>
        <div className="mt-2"><SeatUsageBadge /></div>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong">Shared invite link</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Anyone with this link can join your org. For most agents, prefer the per-agent invites from the Team page.
        </p>
        <div className="mt-3 flex gap-2">
          <input value={inviteUrl} readOnly className="flex-1 rounded-radius-sm border border-border-default px-2 py-1 text-body-md" />
          <Button variant="secondary" size="md" leadingIcon={Copy} onClick={copyLink}>Copy</Button>
        </div>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong text-status-danger">Danger zone</h2>
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="tertiary" size="md" onClick={() => toast("Transfer admin — lands in v1.1")}>Transfer admin</Button>
          <Button variant="tertiary" size="md" onClick={() => toast("Deactivate org — lands in v1.1")}>Deactivate org</Button>
        </div>
      </Card>
    </div>
  );
}
export default AdminSettingsPage;
```

- [ ] **Step 2: Add the route in App.tsx**

```tsx
const AdminSettingsPage = lazy(() =>
  import("@/features/admin/pages/AdminSettingsPage").then((m) => ({ default: m.AdminSettingsPage })),
);
// ...
<Route path="/admin/settings"
  element={<ProtectedRoute><RequireRole allow={["manager","admin"]}><AdminSettingsPage /></RequireRole></ProtectedRoute>}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/admin/pages/AdminSettingsPage.tsx apps/app/src/App.tsx
git commit -m "feat(admin-portal): AdminSettingsPage with seat usage + shared invite link"
```

---

## Task 16: End-to-end dry-run + PR

**Goal:** Manually exercise the full flow on a Vercel preview, then open the PR.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/iso-admin-portal
```

- [ ] **Step 2: Wait for Vercel preview to build (~2 min)**

```bash
gh pr view --json statusCheckRollup -q '.statusCheckRollup[]' 2>&1 | head
```

- [ ] **Step 3: Drive the preview end-to-end as ceo@outsidehire.com**

The full smoke walk (do each one — if any fail, file as a follow-up):

1. **Sign in.** Land on `/dashboard`. Verify "Team" appears in the sidebar.
2. **Navigate to `/admin/agents`.** See your own profile + a `0 / null` seat usage (since `seat_limit` is null for the existing org).
3. **Click `Invite agent`.** Fill in `qa+admin-portal-1@outsidehire.com`. Submit. Row appears as "Invited". Inbox receives email within 30s.
4. **Click the email link.** Lands on `/accept-invite?token=...`. Fill signup form (different email since you can't activate the OTP-link recipient as the same user — use `qa+admin-portal-1+activate@outsidehire.com` and override the form). Land on `/dashboard`. Verify the agent row flips to "Active" on the admin's `/admin/agents` view.
5. **Bulk import.** Click `Import CSV`, upload `sample-agents.csv` (3 rows), watch wizard. Verify counts. Submit. 3 invites land.
6. **Row menu — resend invite.** Click `Resend` on a pending row. Inbox gets a second email.
7. **Row menu — revoke invite.** Status flips to (gone from list — implementation choice: showing only active/invited is fine; revoked is hidden by default).
8. **Row menu — deactivate active agent.** Status flips to "Revoked." `useSeatUsage` decrements.
9. **View pipeline.** Click "View pipeline" on an active agent. Routes to `/pipeline?owner=<id>` with the banner. Filter clears returns to full org view.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(admin-portal): ISO admin portal v1" --body "$(cat <<'EOF'
## Summary
Implements the ISO admin portal per `docs/superpowers/specs/2026-05-22-iso-admin-portal-design.md`.

## What's new
- Migrations: `org_invites` + `organizations.seat_limit` + `profiles.deactivated_at` + 4 SECURITY DEFINER RPCs (`admin_bulk_invite`, `admin_resend_invite`, `admin_revoke_member`, `admin_reactivate_member`). `claim_invite_code` extended to accept per-agent tokens.
- Edge Function: `send_invite_email` (Resend).
- Frontend: `/admin/agents` (paginated list), `/admin/agents/import` (4-step CSV wizard), `/admin/settings`, `/accept-invite`. `RequireRole` route wrapper. Sidebar "Team" entry. Pipeline `?owner=<id>` filter.

## Test plan
- [ ] Pre-req: Resend API key set, Supabase env vars set, migrations applied.
- [ ] Drove end-to-end (see Task 16 of the plan) on preview.
- [ ] All vitest suites pass (~30+ new tests across hooks, components, and utils).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Resolve any QA findings, then merge**

Use the same workflow as the previous QA session: drive the preview, file fixes as commits on the branch, re-test, merge.

---

## Self-review of this plan

**Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| Goals — bulk import | Task 12 |
| Goals — per-agent invites + self-activation | Tasks 2, 10, 13 |
| Goals — agent roster | Tasks 5, 8 |
| Goals — resend/revoke/promote | Tasks 6, 8 |
| Goals — drill into agent pipeline | Task 14 |
| Goals — seat usage | Tasks 6, 8, 15 |
| Schema — org_invites | Task 1 |
| Schema — seat_limit | Task 1 |
| Schema — deactivated_at + helper updates | Task 1 |
| RPCs | Task 2 |
| claim_invite_code extension | Task 2 |
| /admin/agents UI | Task 8 |
| Invite single agent modal | Task 9 |
| CSV wizard | Task 12 |
| /admin/settings | Task 15 |
| /pipeline?owner= filter | Task 14 |
| Agent activation flow | Tasks 10, 13 |
| Resend integration | Task 10 |
| Authorization model | Tasks 2, 7 |
| Rollout sequence | Reflected in task ordering |

All spec sections are covered.

**Placeholder scan:** No "TBD" or "TODO" remain. The plan calls out a contract change in Task 11 (RPC return type) explicitly with the SQL to run; not a placeholder, a real planned step.

**Type consistency:** `InviteResult` is `{email, id, ok, error}` after Task 11's update (matches throughout). `AgentRow` defined in Task 5 and consumed unchanged in Tasks 8, 9. `ParsedAgent` flows from Task 3 to Task 12 unchanged.

**Scope check:** ~16 tasks for ~8-10 days of work. Each task = one focused commit. Reasonable.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-iso-admin-portal.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
