-- 20260804000002_pipeline_name_address_dedupe.sql
--
-- Pipeline de-duplication, second identity key: normalized NAME + ADDRESS.
--
-- The existing de-dup (20260724000001) anchors only on the Google place_id, so
-- it protects the Path-discovery drop-in path and nothing else. Manually added
-- deals, imports, and any deal without a place_id carry a NULL place_id, and
-- Postgres treats every NULL as distinct, so those never de-dup and duplicates
-- like the two "Behn Mouthpieces" slip in.
--
-- This adds a SECOND recognizer that works without a place_id: a canonical key
-- built from the business name + address. It plugs into the SAME two enforcement
-- points as place_id:
--   1. A hard block on new/reopened ACTIVE deals (a BEFORE trigger, so it does
--      NOT choke on duplicates that already exist, and is naturally skipped by
--      the demo-seed which runs with session_replication_role = replica).
--   2. Discovery hides a business whose name+address matches an active deal, not
--      only its place_id.
-- Plus find_active_duplicate_deal() for the client's soft "already in pipeline?"
-- pre-check on the Add-deal form.
--
-- Name+address is deliberately fuzzy (per product decision): a blank address
-- yields a NULL key and is not de-duped (safe: never a wrong block); two genuine
-- businesses sharing a name and street address could collide (rare).

-- ── 1. The shared normalizer. IMMUTABLE so it can back a generated column. ──
-- Returns NULL when either name or address is effectively empty (no reliable
-- identity to match on). Otherwise: lowercase, drop company suffixes/articles
-- from the name, expand common US street-type + unit abbreviations in the
-- address, reduce every run of non-alphanumerics to one space, and join with '|'.
create or replace function public.deal_dedupe_key(p_name text, p_address text)
returns text
language plpgsql
immutable
as $$
declare
  v_name text;
  v_addr text;
begin
  if p_name is null or btrim(p_name) = '' or p_address is null or btrim(p_address) = '' then
    return null;
  end if;

  -- NAME
  v_name := lower(p_name);
  v_name := replace(v_name, '&', ' and ');
  v_name := regexp_replace(v_name, '[^a-z0-9]+', ' ', 'g');
  -- Drop legal suffixes + leading article as standalone tokens.
  v_name := regexp_replace(
    v_name,
    '\y(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp|the)\y',
    ' ', 'g');
  v_name := btrim(regexp_replace(v_name, '\s+', ' ', 'g'));

  -- ADDRESS
  v_addr := lower(p_address);
  v_addr := regexp_replace(v_addr, '[^a-z0-9]+', ' ', 'g');
  v_addr := regexp_replace(v_addr, '\y(street|str)\y', 'st', 'g');
  v_addr := regexp_replace(v_addr, '\y(avenue|av)\y', 'ave', 'g');
  v_addr := regexp_replace(v_addr, '\yroad\y', 'rd', 'g');
  v_addr := regexp_replace(v_addr, '\yboulevard\y', 'blvd', 'g');
  v_addr := regexp_replace(v_addr, '\ydrive\y', 'dr', 'g');
  v_addr := regexp_replace(v_addr, '\ylane\y', 'ln', 'g');
  v_addr := regexp_replace(v_addr, '\ycourt\y', 'ct', 'g');
  v_addr := regexp_replace(v_addr, '\y(highway|hwy)\y', 'hwy', 'g');
  -- Drop unit designators but KEEP the number after them, so "Suite 200",
  -- "Ste 200", and "#200" all collapse to "200" (different unit numbers stay
  -- different; a shared building without a unit still matches).
  v_addr := regexp_replace(
    v_addr,
    '\y(suite|ste|unit|apt|apartment|building|bldg|floor|fl|no|number)\y',
    ' ', 'g');
  v_addr := btrim(regexp_replace(v_addr, '\s+', ' ', 'g'));

  if v_name = '' or v_addr = '' then
    return null;
  end if;

  return v_name || '|' || v_addr;
end;
$$;

-- ── 2. Materialize the key on every deal + index the active ones. ──
-- A STORED generated column so existing rows get keyed too and discovery /
-- soft-check / detection can look it up by index (the trigger below computes
-- NEW's key live, since a generated value is not visible inside a BEFORE trigger).
alter table deals
  add column if not exists dedupe_key text
  generated always as (public.deal_dedupe_key(company_name, address)) stored;

create index if not exists deals_org_dedupe_active_idx
  on deals (org_id, dedupe_key)
  where dedupe_key is not null and stage not in ('won','lost');

-- ── 3. Hard block: no two ACTIVE deals in an org share a name+address key. ──
-- A trigger (not a unique index) on purpose: unique-index creation would fail
-- outright on orgs that already hold duplicates, and the demo-seed intentionally
-- creates bulk data with session_replication_role = replica (triggers off), which
-- this must not fight. Races between two simultaneous inserts are not covered by
-- a trigger; at beta scale that is acceptable and the soft-check catches the
-- realistic case first.
create or replace function public.enforce_active_deal_dedupe()
returns trigger
language plpgsql
as $$
declare
  v_key text;
begin
  if NEW.stage in ('won','lost') then
    return NEW;
  end if;
  v_key := public.deal_dedupe_key(NEW.company_name, NEW.address);
  if v_key is null then
    return NEW; -- no reliable identity (e.g. blank address) → not de-duped
  end if;
  if exists (
    select 1 from deals d
    where d.org_id = NEW.org_id
      and d.id <> NEW.id
      and d.stage not in ('won','lost')
      and d.dedupe_key = v_key
  ) then
    -- 23505 + a recognizable token so the client maps it to the same calm
    -- "already in your team's pipeline" message as the place_id guard.
    raise exception 'This business is already in your team''s pipeline (deals_active_dedupe).'
      using errcode = '23505';
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_active_deal_dedupe on deals;
create trigger enforce_active_deal_dedupe
  before insert or update of company_name, address, stage on deals
  for each row execute function public.enforce_active_deal_dedupe();

-- ── 4. Discovery hiding: also hide a prospect whose name+address matches an
--       active deal, alongside the existing place_id match. ──
create or replace function prospects_nearby(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_limit          integer default 30,
  p_include_chains boolean default false,
  p_categories     text[] default null
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
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and (p_include_chains or not p.is_chain)
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
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

-- Keep the hidden-count companion in step: a prospect counts as in-pipeline if
-- EITHER identity key matches an active deal.
create or replace function prospects_nearby_hidden_counts(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_include_chains boolean default false,
  p_categories     text[] default null
)
returns table (
  chains_hidden      integer,
  in_pipeline_hidden integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    coalesce(count(*) filter (
      where not p_include_chains and p.is_chain
    ), 0)::int as chains_hidden,
    coalesce(count(*) filter (
      where (p_include_chains or not p.is_chain)
        and exists (
          select 1 from deals d
          where d.org_id = public.user_org_id()
            and d.stage not in ('won','lost')
            and (
              d.place_id = p.place_id
              or (d.dedupe_key is not null and d.dedupe_key = public.deal_dedupe_key(p.name, p.address))
            )
        )
    ), 0)::int as in_pipeline_hidden
  from prospects p
  where p.in_profile
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m);
$$;

-- ── 5. Soft pre-check for the Add-deal form. Returns the matching ACTIVE deal
--       (if any) in the caller's org, so the form can offer "open it instead".
--       SECURITY DEFINER + explicit org scope, matching the discovery reads. ──
create or replace function public.find_active_duplicate_deal(
  p_name    text,
  p_address text
)
returns table (
  id           uuid,
  company_name text,
  stage        text,
  owner_id     uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.id, d.company_name, d.stage::text, d.owner_id
  from deals d
  where d.org_id = public.user_org_id()
    and d.stage not in ('won','lost')
    and d.dedupe_key is not null
    and d.dedupe_key = public.deal_dedupe_key(p_name, p_address)
  order by d.created_at asc
  limit 1;
$$;

grant execute on function public.find_active_duplicate_deal(text, text) to authenticated;
grant execute on function public.deal_dedupe_key(text, text) to authenticated;
