-- 20261009000001_portal_access_schema.sql
--
-- Partner Portal Phase 1A (spec docs/superpowers/specs/2026-10-07-partner-portal-design.md,
-- sections 5.2 and 5.10). Partners sign in with the portal's own tokens and are
-- never Supabase Auth users (spec R2). This migration adds the tenant settings,
-- the portal identity table, one-time tokens, sessions and the audit trail.
--
-- Access model:
--   portal_tokens, portal_sessions, portal_audit_log: service role only (the
--     portal_api and portal_invite edge functions, through SECURITY DEFINER SQL).
--   portal_users: internal users who can see the partner read a few safe columns
--     (status and dates, never the email, IP or terms detail). Nobody writes it
--     directly; SECURITY DEFINER functions do (20261009000002..000004).

-- Tenant settings -------------------------------------------------------------
alter table organizations
  add column if not exists portal_enabled           boolean not null default false,
  add column if not exists partner_value_visibility boolean not null default false,
  add column if not exists partner_terms_text       text,
  add column if not exists partner_terms_version    integer not null default 0,
  add column if not exists consent_text             text,
  add column if not exists consent_version          integer not null default 0;

-- Types -------------------------------------------------------------------------
create type portal_user_status as enum ('invited','active','suspended','revoked');
create type portal_token_type  as enum ('invite','sign_in_code');
create type portal_audit_action as enum (
  'invite','code_request','sign_in','sign_out','terms_accept',
  'suspend','revoke','restore','submit','withdraw','view_referral'
);

-- Portal identities: one per partner, one per email inside an org --------------
create table portal_users (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  partner_id         uuid not null unique references partners(id) on delete cascade,
  email              text not null check (email = lower(btrim(email)) and email <> ''),
  status             portal_user_status not null default 'invited',
  invited_at         timestamptz,
  invited_by         uuid references profiles(id) on delete set null,
  activated_at       timestamptz,
  last_login_at      timestamptz,
  terms_accepted_at  timestamptz,
  terms_version      integer,
  terms_ip           text,
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index portal_users_org_email_uidx on portal_users (org_id, lower(email));

-- One-time secrets. Only the SHA-256 hash is stored. Invite hashes are unique;
-- sign-in code hashes are salted per user and may legitimately repeat over time.
create table portal_tokens (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  token_type     portal_token_type not null,
  token_hash     text not null,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  revoked_at     timestamptz,
  attempts       integer not null default 0,
  ip             text
);
create unique index portal_tokens_invite_hash_uidx on portal_tokens (token_hash) where token_type = 'invite';
create index portal_tokens_hash_idx on portal_tokens (token_hash);
create index portal_tokens_user_type_idx on portal_tokens (portal_user_id, token_type, issued_at);

create table portal_sessions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  ip             text,
  user_agent     text
);
create index portal_sessions_user_idx on portal_sessions (portal_user_id);

create table portal_audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  actor_user_id  uuid references profiles(id) on delete set null,
  action         portal_audit_action not null,
  referral_id    uuid references referrals(id) on delete set null,
  ip             text,
  created_at     timestamptz not null default now()
);
create index portal_audit_log_rate_idx on portal_audit_log (action, ip, created_at);
create index portal_audit_log_org_idx  on portal_audit_log (org_id, created_at);

-- Privileges + RLS --------------------------------------------------------------
alter table portal_users     enable row level security;
alter table portal_tokens    enable row level security;
alter table portal_sessions  enable row level security;
alter table portal_audit_log enable row level security;

-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on portal_users, portal_tokens, portal_sessions, portal_audit_log from anon;
revoke all on portal_users, portal_tokens, portal_sessions, portal_audit_log from authenticated;

grant select (id, org_id, partner_id, status, invited_at, activated_at, last_login_at)
  on portal_users to authenticated;

create policy portal_users_select on portal_users for select to authenticated using (
  org_id = public.user_org_id() and public.can_see_partner(partner_id)
);

-- Tenant settings RPCs (spec 5.10) ----------------------------------------------
create or replace function public.get_portal_settings()
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select o.portal_enabled, o.partner_terms_text, o.partner_terms_version, o.consent_text,
           o.consent_version, o.partner_value_visibility, o.slug, o.name
      from organizations o
     where o.id = public.user_org_id();
end $$;

create or replace function public.update_portal_settings(
  p_enabled          boolean,
  p_terms_text       text,
  p_consent_text     text,
  p_value_visibility boolean
)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text
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

revoke execute on function public.get_portal_settings() from public, anon;
revoke execute on function public.update_portal_settings(boolean, text, text, boolean) from public, anon;
grant execute on function public.get_portal_settings() to authenticated;
grant execute on function public.update_portal_settings(boolean, text, text, boolean) to authenticated;
