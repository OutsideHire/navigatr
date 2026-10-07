-- 20261007000001_referrals_foundation.sql
--
-- Partner Portal Phase 0 (spec docs/superpowers/specs/2026-10-07-partner-portal-design.md,
-- sections 4.1 and 4.2). A referral becomes a first-class record with a status and
-- an append-only history, replacing the bare partner_deals link (migrated in
-- 20261007000004).
--
-- Writes: none from the app role. Every change goes through SECURITY DEFINER RPCs
-- (20261007000003) so status and history can never disagree.
-- Reads: you see a referral when you can see its partner, its assignee, or its deal
-- (the assignee always sees their own item, FR-PORT-55).

create type referral_status as enum ('submitted','accepted','working','won','lost','declined','withdrawn');
create type referral_source as enum ('rep_entered','portal_signed_in');
create type referral_decline_reason as enum (
  'duplicate','outside_footprint','outside_icp','insufficient_contact','existing_customer','withdrawn_by_partner'
);
create type referral_actor_type as enum ('user','partner','system');

create table referrals (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organizations(id) on delete cascade,
  partner_id                  uuid not null references partners(id) on delete cascade,
  direction                   text not null default 'inbound' check (direction in ('inbound','outbound')),
  source                      referral_source not null default 'rep_entered',
  status                      referral_status not null default 'submitted',

  -- What was referred. Lives here because there is no Leads table: a referral
  -- exists before any deal does.
  company_name                text not null check (length(btrim(company_name)) > 0),
  contact_name                text,
  contact_email               text,
  contact_phone               text,
  address                     text,
  place_id                    text,
  industry                    text,
  notes                       text not null default '',
  -- partners.company at the time of the referral (stands in for the deferred Firm snapshot).
  partner_company_snapshot    text,

  deal_id                     uuid references deals(id) on delete set null,
  assigned_user_id            uuid references profiles(id) on delete set null,
  submitted_by_user_id        uuid references profiles(id) on delete set null,
  submitted_by_portal_user_id uuid,
  submitted_at                timestamptz not null default now(),
  triaged_by                  uuid references profiles(id) on delete set null,
  triaged_at                  timestamptz,
  decline_reason              referral_decline_reason,
  decline_note                text,
  duplicate_of_referral_id    uuid references referrals(id) on delete set null,
  duplicate_of_deal_id        uuid references deals(id) on delete set null,
  consent_text_version        text,
  nudged_at                   timestamptz,
  purged_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index referrals_org_status_idx      on referrals (org_id, status);
create index referrals_partner_idx         on referrals (partner_id);
create index referrals_deal_idx            on referrals (deal_id) where deal_id is not null;
create index referrals_assignee_status_idx on referrals (assigned_user_id, status);
-- One live link per partner + deal + direction (the old partner_deals PK).
create unique index referrals_partner_deal_live_uidx
  on referrals (partner_id, deal_id, direction)
  where deal_id is not null and status not in ('declined','withdrawn');

-- org_id always comes from the partner; a linked deal must be in the same org.
create or replace function public.referrals_enforce_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_partner_org uuid;
  v_deal_org    uuid;
begin
  select org_id into v_partner_org from partners where id = new.partner_id;
  if v_partner_org is null then
    raise exception 'referral partner not found' using errcode = '23503';
  end if;
  new.org_id := v_partner_org;
  if new.deal_id is not null then
    select org_id into v_deal_org from deals where id = new.deal_id;
    if v_deal_org is distinct from v_partner_org then
      raise exception 'referral deal and partner are in different orgs' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger referrals_enforce_org
  before insert or update on referrals
  for each row execute function public.referrals_enforce_org();

-- Append-only status history -----------------------------------------------
create table referral_status_history (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  referral_id  uuid not null references referrals(id) on delete cascade,
  from_status  referral_status,
  to_status    referral_status not null,
  actor_type   referral_actor_type not null,
  actor_id     uuid,
  note         text,
  created_at   timestamptz not null default now()
);
create index referral_status_history_referral_idx on referral_status_history (referral_id, created_at);

-- Writers set navigatr.referral_actor = 'system' for automatic changes and
-- navigatr.referral_note for a human reason; both are transaction-local.
create or replace function public.referrals_record_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_note  text := nullif(current_setting('navigatr.referral_note', true), '');
  v_sys   boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_sys := v_actor = 'system' or auth.uid() is null;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (
    new.org_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    case when v_sys then 'system'::referral_actor_type else 'user'::referral_actor_type end,
    case when v_sys then null else auth.uid() end,
    v_note
  );
  return new;
end $$;

create trigger referrals_record_status
  after insert or update of status on referrals
  for each row execute function public.referrals_record_status();

-- Deals remember which referral and partner produced them --------------------
alter table deals add column if not exists source_referral_id uuid references referrals(id) on delete set null;
alter table deals add column if not exists source_partner_id  uuid references partners(id)  on delete set null;

-- Privileges + RLS ------------------------------------------------------------
alter table referrals enable row level security;
alter table referral_status_history enable row level security;

revoke all on referrals, referral_status_history from anon;
revoke insert, update, delete on referrals, referral_status_history from authenticated;
grant select on referrals, referral_status_history to authenticated;

create policy referrals_select on referrals for select using (
  org_id = public.user_org_id()
  and (
    public.can_see_partner(partner_id)
    or (assigned_user_id is not null and public.user_can_see_owner(assigned_user_id))
    or (assigned_user_id is null and public.caller_is_admin())
    or (deal_id is not null and exists (
          select 1 from deals d
          where d.id = referrals.deal_id and public.user_can_see_owner(d.owner_id)))
  )
);

create policy referral_status_history_select on referral_status_history for select using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_status_history.referral_id)
);

-- Helpers -------------------------------------------------------------------

-- Deal stage -> referral status for a linked referral (spec 4.5).
create or replace function public.referral_status_for_stage(p_stage deal_stage)
returns referral_status language sql immutable as $$
  select case p_stage
    when 'new'  then 'accepted'::referral_status
    when 'won'  then 'won'::referral_status
    when 'lost' then 'lost'::referral_status
    else 'working'::referral_status
  end
$$;

-- user_can_see_owner with an explicit viewer, for checks made on someone
-- else's behalf (reassignment now, portal duplicate scope in Phase 1).
create or replace function public.profile_can_see_owner(p_viewer uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with v as (select role_path, role_level, org_id, deactivated_at from profiles where id = p_viewer),
       t as (select role_path, org_id from profiles where id = p_owner)
  select case
    when p_viewer is null or p_owner is null then false
    when not exists (select 1 from v) or not exists (select 1 from t) then false
    when (select deactivated_at from v) is not null then false
    when (select org_id from v) is distinct from (select org_id from t) then false
    when p_viewer = p_owner then true
    when (select role_level from v) = 'administrator' then true
    when (select role_path from v) is null then false
    when (select role_path from t) is null then false
    else (select role_path from t) <@ (select role_path from v)
  end
$$;

-- Routing (spec 4.4): partner owner if active and placed (or an administrator),
-- else the owner's active manager, else NULL = administrator queue.
create or replace function public.referral_route_assignee(p_partner uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with o as (
    select pr.id, pr.manager_id, pr.deactivated_at, pr.role_path, pr.role_level
    from partners p join profiles pr on pr.id = p.owner_id
    where p.id = p_partner
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

-- First business day after p_from, skipping weekends and global or org holidays.
create or replace function public.next_business_day(p_from date, p_org uuid)
returns date language plpgsql stable security definer set search_path = public as $$
declare
  d date := p_from + 1;
begin
  while extract(isodow from d) in (6, 7)
     or exists (select 1 from business_holidays h
                where h.holiday_date = d and (h.org_id is null or h.org_id = p_org)) loop
    d := d + 1;
  end loop;
  return d;
end $$;

-- Who may triage: anyone who can see the assignee (self, managers above,
-- admins); the administrator queue (NULL assignee) is admins only.
create or replace function public.can_triage_referral(p_assignee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_assignee is null then public.caller_is_admin()
    else public.user_can_see_owner(p_assignee)
  end
$$;

revoke execute on function public.profile_can_see_owner(uuid, uuid) from public, anon;
revoke execute on function public.referral_route_assignee(uuid)      from public, anon;
revoke execute on function public.next_business_day(date, uuid)       from public, anon;
revoke execute on function public.can_triage_referral(uuid)           from public, anon;
revoke execute on function public.referrals_enforce_org()             from public, anon;
revoke execute on function public.referrals_record_status()           from public, anon;
