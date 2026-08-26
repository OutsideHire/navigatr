-- Auditable Terms/Privacy consent record (legal requirement for paid beta).
--
-- The client clickwrap (SignUpForm / AcceptInvitePage checkbox + the login-page
-- Google consent line) ENFORCES that a user agrees before an account can be
-- created. This migration adds the durable, append-only RECORD of that consent:
-- who accepted, which document versions, and when.
--
-- How it's captured: a single AFTER INSERT trigger on `profiles`. Every real
-- account (self-serve signup via handle_new_user_signup, invited rep via
-- claim_invite_code, self-serve admin via create_organization) inserts exactly
-- one profiles row in normal (origin) replication mode, so the trigger fires
-- once per real account, atomically with account creation. Demo/synthetic users
-- are seeded under `session_replication_role = replica`, which suppresses normal
-- triggers, so they never get a (false) consent record -- the same mechanism
-- that already keeps reporting_line_history demo-clean.
--
-- Mirrors the reporting_line_history audit-table pattern (20260820000004):
-- append-only (no client writes), RLS so an org admin can read their own org's
-- records for compliance, and a SECURITY DEFINER trigger owns the writes.

-- 1) Document versions -- single source of truth. BUMP THESE together with the
--    "Last updated" dates on the /terms and /privacy pages
--    (apps/app/src/features/legal/pages/{TermsPage,PrivacyPage}.tsx) whenever the
--    documents change, so re-acceptance can be required and the record is exact.
--    NOTE: the Terms page is currently marked DRAFT -- finalize that text before
--    relying on these records as binding consent.
create or replace function public.current_terms_version() returns text
  language sql immutable as $$ select 'terms-2026-05-29'::text $$;
create or replace function public.current_privacy_version() returns text
  language sql immutable as $$ select 'privacy-2026-07-08'::text $$;

-- 2) Append-only audit log. Retained across user/org deletion (a legal record
--    must outlive the account), so FKs are ON DELETE SET NULL and email is
--    denormalized rather than joined.
create table if not exists terms_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  org_id           uuid references organizations(id) on delete set null,
  email            text not null,
  terms_version    text not null,
  privacy_version  text not null,
  accepted_at      timestamptz not null default now()
);

create index terms_acceptances_user_idx on terms_acceptances (user_id);
create index terms_acceptances_org_idx  on terms_acceptances (org_id, accepted_at);

alter table terms_acceptances enable row level security;

-- Org admins can read their own org's acceptance records (compliance export).
drop policy if exists terms_acceptances_select on terms_acceptances;
create policy terms_acceptances_select on terms_acceptances for select
  using (org_id = public.user_org_id() and public.caller_is_admin());

-- Append-only: rows come ONLY from the SECURITY DEFINER trigger below, never a
-- client write. (The explicit-grants regime grants authenticated CRUD on new
-- tables by default; strip the writes. SELECT stays, gated by the RLS policy.
-- anon gets nothing.)
revoke insert, update, delete on terms_acceptances from authenticated;

-- 3) Record consent atomically at real-account creation.
create or replace function public.record_terms_acceptance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into terms_acceptances (user_id, org_id, email, terms_version, privacy_version)
  values (
    new.id,
    new.org_id,
    coalesce(new.email, (select u.email from auth.users u where u.id = new.id)),
    public.current_terms_version(),
    public.current_privacy_version()
  );
  return null; -- AFTER trigger; return value ignored
end $$;

drop trigger if exists profiles_record_terms_acceptance on profiles;
create trigger profiles_record_terms_acceptance
  after insert on profiles
  for each row execute function public.record_terms_acceptance();
