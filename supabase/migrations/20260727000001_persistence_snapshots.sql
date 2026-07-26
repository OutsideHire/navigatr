-- 20260727000001_persistence_snapshots.sql
--
-- Persistence Index SP-B: per-tenant config + nightly snapshot tables.
-- Mirrors the Logging Coverage snapshot pattern (20260624000003): denormalized
-- trigger-enforced org_id, unique(user_id, snapshot_date), SELECT-only RLS so
-- ONLY the service-role nightly job writes. NO BACKFILL: tables start empty and
-- accumulate forward from cron start (a deliberate beta choice, per Robert).

alter table organizations
  add column if not exists persistence_index_config jsonb not null default '{}'::jsonb;

create table if not exists persistence_index_snapshot (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  user_id                   uuid not null references profiles(id) on delete cascade,
  snapshot_date             date not null,
  composite                 numeric,
  followup_points           numeric,
  followup_below_floor      boolean not null default false,
  followup_due_count        int not null default 0,
  cadence_points            numeric,
  reengagement_points       numeric,
  reengagement_rate         numeric,
  deals_went_silent_count   int not null default 0,
  deals_re_engaged_count    int not null default 0,
  response_velocity_points  numeric,
  formula_version           int not null,
  window_start_date         date not null,
  window_end_date           date not null,
  created_at                timestamptz not null default now(),
  unique (user_id, snapshot_date)
);
create index if not exists persistence_snapshot_user_date_idx on persistence_index_snapshot (user_id, snapshot_date desc);
create index if not exists persistence_snapshot_org_date_idx  on persistence_index_snapshot (org_id, snapshot_date);

create table if not exists persistence_company_snapshot (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  snapshot_date     date not null,
  composite_median  numeric,
  composite_p90     numeric,
  rep_count         int not null default 0,
  formula_version   int not null,
  created_at        timestamptz not null default now(),
  unique (org_id, snapshot_date)
);
create index if not exists persistence_company_snapshot_org_date_idx on persistence_company_snapshot (org_id, snapshot_date desc);

create or replace function persistence_snapshot_enforce_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from profiles where id = new.user_id;
  if v_org is null then raise exception 'user % has no org', new.user_id; end if;
  new.org_id := v_org;
  return new;
end;
$$;
drop trigger if exists persistence_snapshot_enforce_org_trg on persistence_index_snapshot;
create trigger persistence_snapshot_enforce_org_trg
  before insert or update on persistence_index_snapshot
  for each row execute function persistence_snapshot_enforce_org();

alter table persistence_index_snapshot enable row level security;
create policy persistence_snapshot_select on persistence_index_snapshot for select
  using (org_id = public.user_org_id() and (user_id = auth.uid() or public.user_can_see_owner(user_id)));

alter table persistence_company_snapshot enable row level security;
create policy persistence_company_snapshot_select on persistence_company_snapshot for select
  using (org_id = public.user_org_id());
