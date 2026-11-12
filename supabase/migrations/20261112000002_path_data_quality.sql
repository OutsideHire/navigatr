-- Path Data Quality Fix v1.2: keep closed businesses and the ones a rep has
-- already found to be closed or home-based out of Path discovery.
--
--   R2  Google's businessStatus is stored on the shared prospect cache. When
--       the quality filter is on, CLOSED_TEMPORARILY and CLOSED_PERMANENTLY
--       never come back from discovery, and a row with no status (Google did
--       not say, or the row was cached before this change) is only picked
--       after every OPERATIONAL candidate.
--   R6  An "Out of business" or "Home-based" outcome on a stop suppresses that
--       Google place for the rep's whole organization, permanently. Only the
--       place ID, the outcome, the reporter and the time are stored. Nothing
--       about the lead, deal, contact or activity changes.
--   R4  Commitments are never removed. place_quality_flags lets the Path day
--       show why a commitment's business is suspect without hiding it.
--   R7  One measurement row per discovery search (path_search_log).
--
-- The quality filter is a parameter (p_quality_filter, default false) rather
-- than a database setting. The discover_prospects edge function decides it from
-- its PATH_QUALITY_FILTER setting, so it can be turned off from the Supabase
-- dashboard with no deploy and no database edit. The default of false also
-- means an edge function deployed before this migration keeps today's behavior.
--
-- R3 (service area and trade businesses, live since 2026-09-29) is unchanged.
-- Its "show them" reveal (p_include_home_based) never reveals a closed or
-- suppressed business: those are separate predicates.

-- ---------------------------------------------------------------------------
-- R2: business status on the shared prospect cache.
-- ---------------------------------------------------------------------------
alter table prospects
  add column if not exists business_status text
    check (business_status in ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'));

comment on column prospects.business_status is
  'Google Places businessStatus at the last pull. NULL = Google did not say, or '
  'the row predates 2026-11-12; such rows refresh on the normal 30-day cell TTL.';

-- ---------------------------------------------------------------------------
-- R6: organization-wide suppression.
-- ---------------------------------------------------------------------------
create table if not exists place_suppressions (
  org_id             uuid not null references organizations(id) on delete cascade,
  place_id           text not null,
  outcome            text not null check (outcome in ('out_of_business', 'home_based')),
  reported_by        uuid references auth.users(id) on delete set null,
  reported_at        timestamptz not null,
  -- The activity that caused it. Not a foreign key: deleting that activity must
  -- not silently lift the suppression (it is permanent by design).
  source_activity_id uuid,
  -- 'outcome' = written when a rep closed out a stop; 'backfill' = created from
  -- a past outcome when this shipped. Lets the backfill report be re-run.
  source             text not null default 'outcome' check (source in ('outcome', 'backfill')),
  created_at         timestamptz not null default now(),
  primary key (org_id, place_id)
);

comment on table place_suppressions is
  'Google place IDs a rep in the organization closed out as Out of business or '
  'Home-based. Excluded from that organization''s Path discovery (PRD Path Data '
  'Quality v1.2 R6). Place ID only, no other Google content.';

alter table place_suppressions enable row level security;

-- Members may read their own organization's suppressions (the Path day uses
-- them to explain a commitment). There are no client write policies: rows are
-- written by the trigger below, which runs as the table owner.
drop policy if exists place_suppressions_select on place_suppressions;
create policy place_suppressions_select on place_suppressions for select
  using (org_id = public.user_org_id());

revoke all on place_suppressions from anon;
revoke insert, update, delete on place_suppressions from authenticated;
grant select on place_suppressions to authenticated;

create or replace function public.record_place_suppression()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.disposition::text in ('out_of_business', 'home_based') then
    insert into place_suppressions
      (org_id, place_id, outcome, reported_by, reported_at, source_activity_id, source)
    select d.org_id, d.place_id, new.disposition::text, new.logged_by,
           new.occurred_at, new.id, 'outcome'
      from deals d
     where d.id = new.deal_id
       and d.place_id is not null
    -- First report wins: the original reporter and time are kept.
    on conflict (org_id, place_id) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.record_place_suppression() from public;
revoke all on function public.record_place_suppression() from anon;
revoke all on function public.record_place_suppression() from authenticated;

drop trigger if exists activities_record_place_suppression on activities;
create trigger activities_record_place_suppression
  after insert or update of disposition on activities
  for each row execute function public.record_place_suppression();

-- One-time backfill from every past "Out of business" outcome that has a Google
-- place ID, keeping the earliest report per organization and place.
do $$
declare
  r record;
  v_skipped integer;
begin
  insert into place_suppressions
    (org_id, place_id, outcome, reported_by, reported_at, source_activity_id, source)
  select distinct on (d.org_id, d.place_id)
         d.org_id, d.place_id, 'out_of_business', a.logged_by, a.occurred_at, a.id, 'backfill'
    from activities a
    join deals d on d.id = a.deal_id
   where a.disposition::text = 'out_of_business'
     and d.place_id is not null
   order by d.org_id, d.place_id, a.occurred_at asc
  on conflict (org_id, place_id) do nothing;

  for r in
    select org_id, count(*) as n
      from place_suppressions
     where source = 'backfill'
     group by org_id
     order by org_id
  loop
    raise notice 'place_suppressions backfill: org % created %', r.org_id, r.n;
  end loop;

  select count(*) into v_skipped
    from activities a
    join deals d on d.id = a.deal_id
   where a.disposition::text = 'out_of_business'
     and d.place_id is null;
  raise notice 'place_suppressions backfill: % past Out of business outcomes skipped (no place ID)', v_skipped;
end $$;

-- ---------------------------------------------------------------------------
-- R7: one measurement row per discovery search. Written by the
-- discover_prospects edge function with the service role; no client access.
-- ---------------------------------------------------------------------------
create table if not exists path_search_log (
  id                    bigint generated always as identity primary key,
  org_id                uuid references organizations(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,
  search_type           text not null,
  quality_filter_on     boolean not null,
  candidates            integer not null,
  removed_closed        integer not null,
  removed_service_area  integer not null,
  removed_suppressed    integer not null,
  final_stops           integer not null,
  created_at            timestamptz not null default now()
);

comment on table path_search_log is
  'One row per Path discovery search (PRD Path Data Quality v1.2 R7). Logging '
  'only. candidates = in-radius businesses in the searched industries; the '
  'removed_* columns are counted in that order so a business is counted once.';

create index if not exists path_search_log_org_created_idx
  on path_search_log (org_id, created_at desc);

alter table path_search_log enable row level security;
revoke all on path_search_log from anon;
revoke all on path_search_log from authenticated;

-- ---------------------------------------------------------------------------
-- Discovery read path. Dropped and recreated because the signatures gain a
-- parameter (and the counts gain columns).
-- ---------------------------------------------------------------------------
drop function if exists prospects_nearby(
  double precision, double precision, double precision, text, integer, boolean, text[], boolean);
drop function if exists prospects_nearby_hidden_counts(
  double precision, double precision, double precision, text, boolean, text[], boolean);

create function prospects_nearby(
  p_lat                double precision,
  p_lng                double precision,
  p_radius_m           double precision default 3000,
  p_profession         text default null,
  p_limit              integer default 30,
  p_include_chains     boolean default false,
  p_categories         text[] default null,
  p_include_home_based boolean default false,
  p_quality_filter     boolean default false
)
returns table (
  id               uuid,
  place_id         text,
  name             text,
  category         text,
  address          text,
  lat              double precision,
  lng              double precision,
  phone            text,
  website          text,
  employee_count   integer,
  rating_count     integer,
  rating           double precision,
  primary_type     text,
  is_chain         boolean,
  chain_confidence text,
  chain_brand_name text,
  is_home_based    boolean,
  distance_m       double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count, p.rating, p.primary_type,
    p.is_chain, p.chain_confidence, p.chain_brand_name,
    public.prospect_is_home_based(p.primary_type, p.pure_service_area,
      p.containing_places_count, p.has_accessibility, p.address, p.id) as is_home_based,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and (
      p_include_chains
      or (
        not p.is_chain
        and not exists (
          select 1 from exclusion_seed s
          where s.active
            and position(lower(s.name_pattern) in lower(p.name)) > 0
        )
      )
    )
    and (
      p_include_home_based
      or not public.prospect_is_home_based(p.primary_type, p.pure_service_area,
            p.containing_places_count, p.has_accessibility, p.address, p.id)
    )
    -- R2: closed is never eligible, and "show them" does not reveal it.
    and (
      not p_quality_filter
      or p.business_status is null
      or p.business_status = 'OPERATIONAL'
    )
    -- R6: suppressed by a rep in the caller's organization.
    and (
      not p_quality_filter
      or not exists (
        select 1 from place_suppressions s
        where s.org_id = public.user_org_id()
          and s.place_id = p.place_id
      )
    )
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
    and not exists (
      select 1 from deals d
      where d.place_id = p.place_id
        and d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
    )
    and not exists (
      select 1 from deals d
      where d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
        and d.dedupe_key is not null
        and d.dedupe_key = public.deal_dedupe_key(p.name, p.address)
    )
  -- R2: a business with no known status is considered only after every
  -- OPERATIONAL one. Display order is still the app's own re-rank.
  order by
    (p_quality_filter and p.business_status is distinct from 'OPERATIONAL') asc,
    distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

create function prospects_nearby_hidden_counts(
  p_lat                double precision,
  p_lng                double precision,
  p_radius_m           double precision default 3000,
  p_profession         text default null,
  p_include_chains     boolean default false,
  p_categories         text[] default null,
  p_include_home_based boolean default false,
  p_quality_filter     boolean default false
)
returns table (
  chains_hidden      integer,
  in_pipeline_hidden integer,
  home_based_hidden  integer,
  closed_hidden      integer,
  suppressed_hidden  integer,
  candidates         integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with area as (
    select p.*
    from prospects p
    where (p_categories is null or p.category = any(p_categories))
      and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  ),
  scoped as (
    select a.*,
      (a.is_chain or exists (
        select 1 from exclusion_seed s
        where s.active and position(lower(s.name_pattern) in lower(a.name)) > 0
      )) as chain_now,
      public.prospect_is_home_based(a.primary_type, a.pure_service_area,
        a.containing_places_count, a.has_accessibility, a.address, a.id) as home_now,
      (p_quality_filter
        and a.business_status in ('CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')) as closed_now,
      (p_quality_filter and exists (
        select 1 from place_suppressions s
        where s.org_id = public.user_org_id() and s.place_id = a.place_id
      )) as suppressed_now
    from area a
    where a.in_profile
  )
  -- Each business is counted under the FIRST filter that removed it, in the
  -- order chain, closed (R2), home-based (R3), suppressed (R6), in pipeline.
  select
    coalesce(count(*) filter (where not p_include_chains and chain_now), 0)::int,
    coalesce(count(*) filter (
      where (p_include_chains or not chain_now)
        and not closed_now
        and (p_include_home_based or not home_now)
        and not suppressed_now
        and exists (
          select 1 from deals d
          where d.org_id = public.user_org_id()
            and d.stage not in ('won','lost')
            and (
              d.place_id = scoped.place_id
              or (d.dedupe_key is not null and d.dedupe_key = public.deal_dedupe_key(scoped.name, scoped.address))
            )
        )
    ), 0)::int,
    coalesce(count(*) filter (
      where not p_include_home_based
        and home_now
        and (p_include_chains or not chain_now)
        and not closed_now
    ), 0)::int,
    coalesce(count(*) filter (
      where closed_now
        and (p_include_chains or not chain_now)
    ), 0)::int,
    coalesce(count(*) filter (
      where suppressed_now
        and (p_include_chains or not chain_now)
        and not closed_now
        and (p_include_home_based or not home_now)
    ), 0)::int,
    (select count(*) from area)::int
  from scoped;
$$;

revoke all on function prospects_nearby(
  double precision, double precision, double precision, text, integer, boolean, text[], boolean, boolean)
  from public, anon;
grant execute on function prospects_nearby(
  double precision, double precision, double precision, text, integer, boolean, text[], boolean, boolean)
  to authenticated;
revoke all on function prospects_nearby_hidden_counts(
  double precision, double precision, double precision, text, boolean, text[], boolean, boolean)
  from public, anon;
grant execute on function prospects_nearby_hidden_counts(
  double precision, double precision, double precision, text, boolean, text[], boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- R4: why a commitment's business is suspect, for the deals on a rep's day.
-- Security invoker: deals, prospects and place_suppressions RLS all apply, so a
-- caller only learns about deals they can already see. No Google request is
-- ever made here; google_closed is only true when the cached prospect says so.
-- ---------------------------------------------------------------------------
create or replace function public.place_quality_flags(p_deal_ids uuid[])
returns table (
  deal_id       uuid,
  google_closed boolean,
  suppressed    boolean
)
language sql
stable
set search_path = public
as $$
  select
    d.id,
    exists (
      select 1 from prospects p
      where p.place_id = d.place_id
        and p.business_status in ('CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')
    ),
    exists (
      select 1 from place_suppressions s
      where s.org_id = d.org_id and s.place_id = d.place_id
    )
  from deals d
  where d.id = any(p_deal_ids)
    and d.place_id is not null;
$$;

revoke all on function public.place_quality_flags(uuid[]) from public, anon;
grant execute on function public.place_quality_flags(uuid[]) to authenticated;
