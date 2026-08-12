-- Add Deal via Google Places, slice C (tiered duplicate detection).
--
-- The existing dedupe (20260724000001 + 20260804000002) recognizes two identity
-- keys: place_id and normalized name+address, both used as HARD blocks. The
-- search-first Add-Deal flow needs a softer, graduated answer so a rep can:
--   - see a BLOCKING match (same record) and open/attach instead of re-adding
--   - get a SOFT confirm on a likely-same business (shared phone or name) and
--     decide, rather than being silently blocked or silently duplicating
--   - recognize a real SECOND LOCATION (same base name, different site) and add
--     it as a sibling instead of having it blocked as a dupe
--
-- This adds three normalizers + one read-only RPC that returns tiered candidate
-- matches for a business being added. It mirrors the pure client normalizers in
-- apps/app/src/features/pipeline/lib/placeDedupe.ts. Nothing here changes the
-- hard-block trigger or discovery hiding — those stay as-is; this is an
-- ADDITIVE, read-only pre-check the Add-Deal sheet calls.

-- ── 1. Name-only key (the NAME half of deal_dedupe_key, reusable alone). ──
create or replace function public.deal_name_key(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_name text;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;
  v_name := lower(p_name);
  v_name := replace(v_name, '&', ' and ');
  v_name := regexp_replace(v_name, '[^a-z0-9]+', ' ', 'g');
  v_name := regexp_replace(
    v_name,
    '\y(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp|the)\y',
    ' ', 'g');
  v_name := btrim(regexp_replace(v_name, '\s+', ' ', 'g'));
  if v_name = '' then
    return null;
  end if;
  return v_name;
end;
$$;

-- ── 2. Phone key: last 10 significant digits (drop a leading country 1). ──
-- NULL when fewer than 10 digits remain (too little to match on).
create or replace function public.deal_phone_key(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p_phone is null then
    return null;
  end if;
  v := regexp_replace(p_phone, '\D', '', 'g');
  if length(v) = 11 and left(v, 1) = '1' then
    v := substr(v, 2);
  end if;
  if length(v) < 10 then
    return null;
  end if;
  return right(v, 10);
end;
$$;

-- ── 3. Base-name key: name key with trailing location qualifiers + a trailing
--       store/unit number stripped, for second-location detection. Only strips
--       from the END so a leading directional stays meaningful. ──
create or replace function public.deal_base_name_key(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
  tokens text[];
  last_tok text;
begin
  v := public.deal_name_key(p_name);
  if v is null then
    return null;
  end if;
  tokens := regexp_split_to_array(v, ' ');
  while array_length(tokens, 1) > 1 loop
    last_tok := tokens[array_length(tokens, 1)];
    if last_tok ~ '^\d+$'
       or last_tok in ('north','south','east','west','northeast','northwest',
                       'southeast','southwest','downtown','uptown','midtown',
                       'central','location','store','branch','at','of') then
      tokens := tokens[1:array_length(tokens, 1) - 1];
    else
      exit;
    end if;
  end loop;
  return array_to_string(tokens, ' ');
end;
$$;

grant execute on function public.deal_name_key(text) to authenticated;
grant execute on function public.deal_phone_key(text) to authenticated;
grant execute on function public.deal_base_name_key(text) to authenticated;

-- ── 4. Tiered candidate finder for the Add-Deal-via-Places sheet. ──
-- Returns up to a handful of ACTIVE deals in the caller's org that relate to the
-- business being added, each tagged with the STRONGEST tier it matches. Ordered
-- strongest-first so the client takes rows[0] for the interstitial. Read-only,
-- SECURITY DEFINER + explicit org scope (same posture as find_active_duplicate_deal).
--
-- tier values (strongest -> weakest):
--   place_id      exact Google id match          BLOCKING
--   name_address  same normalized name+address    BLOCKING
--   phone         same last-10 phone digits        soft
--   name          same normalized business name    soft
--   base_name     same base name, different site   soft (second location)
create or replace function public.find_place_duplicate_candidates(
  p_place_id text,
  p_name     text,
  p_phone    text,
  p_address  text
)
returns table (
  id           uuid,
  company_name text,
  stage        text,
  owner_id     uuid,
  place_id     text,
  match_tier   text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with cand as (
    select
      nullif(btrim(p_place_id), '')          as place_id,
      public.deal_dedupe_key(p_name, p_address) as na_key,
      public.deal_phone_key(p_phone)          as phone_key,
      public.deal_name_key(p_name)            as name_key,
      public.deal_base_name_key(p_name)       as base_key
  ),
  matched as (
    select
      d.id, d.company_name, d.stage::text as stage, d.owner_id, d.place_id,
      case
        when c.place_id is not null and d.place_id = c.place_id then 'place_id'
        when c.na_key is not null and d.dedupe_key = c.na_key then 'name_address'
        when c.phone_key is not null and public.deal_phone_key(d.contact_phone) = c.phone_key then 'phone'
        when c.name_key is not null and public.deal_name_key(d.company_name) = c.name_key then 'name'
        when c.base_key is not null and public.deal_base_name_key(d.company_name) = c.base_key then 'base_name'
      end as match_tier,
      d.created_at
    from deals d
    cross join cand c
    where d.org_id = public.user_org_id()
      and d.stage not in ('won','lost')
      and (
        (c.place_id is not null and d.place_id = c.place_id)
        or (c.na_key is not null and d.dedupe_key = c.na_key)
        or (c.phone_key is not null and public.deal_phone_key(d.contact_phone) = c.phone_key)
        or (c.name_key is not null and public.deal_name_key(d.company_name) = c.name_key)
        or (c.base_key is not null and public.deal_base_name_key(d.company_name) = c.base_key)
      )
  )
  select id, company_name, stage, owner_id, place_id, match_tier
  from matched
  order by
    case match_tier
      when 'place_id' then 1
      when 'name_address' then 2
      when 'phone' then 3
      when 'name' then 4
      when 'base_name' then 5
      else 6
    end,
    created_at asc
  limit 5;
$$;

grant execute on function public.find_place_duplicate_candidates(text, text, text, text) to authenticated;
