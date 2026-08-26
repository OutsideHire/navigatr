-- Auditable Terms/Privacy consent record (legal requirement for paid beta).
--
-- The client clickwrap (SignUpForm / AcceptInvitePage / CreateOrganizationPage
-- checkbox + the login-page Google consent line) ENFORCES that a user agrees
-- before an account can be created. This migration adds the durable,
-- append-only RECORD of that consent: which user, which document versions, and
-- when.
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
-- Privacy by design: this table stores NO denormalized PII. It keeps only the
-- pseudonymous user_id (+ org_id), the document versions, and the timestamp.
-- The human identity (name / email) is derived by joining the account at export
-- time, so the app's account-deletion / anonymization flow propagates
-- automatically -- there is no second copy of the email to scrub. On a hard
-- delete the FKs SET NULL, leaving the consent EVENT (versions + when) intact
-- but dissociated from the erased person. The table is not exposed to org
-- admins; ops/legal read it via the service role.

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

-- 2) Append-only audit log. No PII columns; FKs SET NULL so the consent event
--    outlives a hard-deleted user/org.
create table if not exists terms_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  org_id           uuid references organizations(id) on delete set null,
  terms_version    text not null,
  privacy_version  text not null,
  accepted_at      timestamptz not null default now()
);

create index terms_acceptances_user_idx on terms_acceptances (user_id);
create index terms_acceptances_org_idx  on terms_acceptances (org_id, accepted_at);

-- Ops/legal-only: not exposed to any app role. RLS is enabled with NO policy
-- (deny-all for authenticated/anon), and all grants are revoked; rows are
-- written solely by the SECURITY DEFINER trigger below and read via the service
-- role. (The explicit-grants regime grants authenticated CRUD on new tables by
-- default, so the revoke is required to actually lock it down.)
alter table terms_acceptances enable row level security;
revoke all on terms_acceptances from authenticated;
revoke all on terms_acceptances from anon;

-- 3) Record consent atomically at real-account creation.
create or replace function public.record_terms_acceptance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into terms_acceptances (user_id, org_id, terms_version, privacy_version)
  values (new.id, new.org_id, public.current_terms_version(), public.current_privacy_version());
  return null; -- AFTER trigger; return value ignored
end $$;

drop trigger if exists profiles_record_terms_acceptance on profiles;
create trigger profiles_record_terms_acceptance
  after insert on profiles
  for each row execute function public.record_terms_acceptance();
