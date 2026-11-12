-- Tests for 20261112000002_path_data_quality (PRD Path Data Quality Fix v1.2).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/082_path_data_quality.sql
-- Self-cleans via ROLLBACK.
--
-- Two orgs. Org X: reps Ana and Ben. Org Y: rep Yan. Every prospect sits within
-- a few hundred meters of the search point, so radius never decides a result.
-- The numbers in brackets are the spec's acceptance tests (section 7).

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000000821', 'Quality X', 'quality-x', 'quality-x-a1'),
  ('00000000-0000-0000-0000-000000000822', 'Quality Y', 'quality-y', 'quality-y-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('82100000-0000-0000-0000-00000000000a', 'ana@qx.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('82100000-0000-0000-0000-00000000000b', 'ben@qx.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('82200000-0000-0000-0000-00000000000a', 'yan@qy.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('82100000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000821', 'rep', 'sales_professional', 'Ana', 'ana@qx.example', 'ana'::ltree),
  ('82100000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000821', 'rep', 'sales_professional', 'Ben', 'ben@qx.example', 'ben'::ltree),
  ('82200000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000822', 'rep', 'sales_professional', 'Yan', 'yan@qy.example', 'yan'::ltree);

-- Search point 40.0, -100.0. Names sort the way distance does.
insert into prospects (place_id, name, category, lat, lng, geo_cell, in_profile, is_chain, business_status, pure_service_area, primary_type) values
  ('q_open_1',   'A Open',          'retail', 40.0005, -100.0, '9y0hb', true, false, 'OPERATIONAL',        null, 'store'),
  ('q_unknown',  'B Unknown',       'retail', 40.0001, -100.0, '9y0hb', true, false, null,                 null, 'store'),
  ('q_open_2',   'C Open',          'retail', 40.0020, -100.0, '9y0hb', true, false, 'OPERATIONAL',        null, 'store'),
  ('q_perm',     'D Closed Perm',   'retail', 40.0002, -100.0, '9y0hb', true, false, 'CLOSED_PERMANENTLY', null, 'store'),
  ('q_temp',     'E Closed Temp',   'retail', 40.0003, -100.0, '9y0hb', true, false, 'CLOSED_TEMPORARILY', null, 'store'),
  ('q_sab',      'F Service Area',  'retail', 40.0004, -100.0, '9y0hb', true, false, 'OPERATIONAL',        true, 'store'),
  ('q_flag',     'G Flagged Home',  'retail', 40.0006, -100.0, '9y0hb', true, false, 'OPERATIONAL',        null, 'store'),
  ('q_gone',     'H Flagged Gone',  'retail', 40.0007, -100.0, '9y0hb', true, false, 'OPERATIONAL',        null, 'store'),
  ('q_notnow',   'I Closed Now',    'retail', 40.0008, -100.0, '9y0hb', true, false, 'OPERATIONAL',        null, 'store');

-- Ana's deals at G, H and I, created by drop-ins on discovery stops, then
-- marked lost so the in-pipeline de-dup does not hide them on its own. Ben owes
-- a drop-in at H (his own open deal, a commitment) and has one at closed D.
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, place_id, stage) values
  ('821d0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000a', 'G Flagged Home', 'C', 'c@qx.example', '+15550008201', 100, 'q_flag',   'lost'),
  ('821d0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000a', 'H Flagged Gone', 'C', 'c@qx.example', '+15550008202', 100, 'q_gone',   'lost'),
  ('821d0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000a', 'I Closed Now',   'C', 'c@qx.example', '+15550008203', 100, 'q_notnow', 'lost'),
  ('821d0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000b', 'H Flagged Gone', 'C', 'c@qx.example', '+15550008204', 100, null,       'new'),
  ('821d0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000b', 'D Closed Perm',  'C', 'c@qx.example', '+15550008205', 100, null,       'new');

create or replace function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

-- Discovery names for the current user, in returned order.
create or replace function pg_temp.found(p_quality boolean, p_limit int default 50, p_home boolean default false)
returns text language sql as $$
  select coalesce(string_agg(name, ' / ' order by ord), '-')
  from (
    select name, row_number() over () as ord
    from prospects_nearby(40.0, -100.0, 2000, null, p_limit, false, null, p_home, p_quality)
  ) t
$$;

-- 1-3. Closed never appears; unknown status comes after every OPERATIONAL one.
do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  v := pg_temp.found(true);
  perform pg_temp.back();
  if v like '%Closed Perm%' then raise exception '[1] CLOSED_PERMANENTLY appeared: %', v; end if;
  if v like '%Closed Temp%' then raise exception '[2] CLOSED_TEMPORARILY appeared: %', v; end if;
  if v not like '%B Unknown' then raise exception '[3] unknown status should come last, got: %', v; end if;
end $$;

-- 3. "Considered after": with room for only two, both are OPERATIONAL even
--    though the unknown one is the nearest business of all.
do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  v := pg_temp.found(true, 2);
  perform pg_temp.back();
  if v <> 'A Open / G Flagged Home' then raise exception '[3] limit should pick OPERATIONAL first, got: %', v; end if;
end $$;

-- 4. Service area stays hidden (R3, live), and "show them" reveals it but never
--    a closed business.
do $$ declare v text; w text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  v := pg_temp.found(true);
  w := pg_temp.found(true, 50, true);
  perform pg_temp.back();
  if v like '%Service Area%' then raise exception '[4] service area business appeared: %', v; end if;
  if w not like '%Service Area%' then raise exception '[4] show them should reveal service area: %', w; end if;
  if w like '%Closed%Perm%' or w like '%Closed Temp%' then raise exception '[4] show them revealed a closed business: %', w; end if;
end $$;

-- 13. With the filter off, discovery is exactly as before this change: closed
--     businesses come back and order is distance only.
do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  v := pg_temp.found(false, 4);
  perform pg_temp.back();
  if v <> 'B Unknown / D Closed Perm / E Closed Temp / A Open' then
    raise exception '[13] filter off should be distance order with closed included, got: %', v;
  end if;
end $$;

-- 6, 7, 8. Ana closes out G as Home-based, H as Out of business, and I as
--          Closed right now (not_in_office). The trigger records the first two.
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at) values
  ('821a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000821', '821d0000-0000-0000-0000-000000000001', '82100000-0000-0000-0000-00000000000a', 'drop_in', 'home_based',      '2026-11-10 15:00+00'),
  ('821a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000821', '821d0000-0000-0000-0000-000000000002', '82100000-0000-0000-0000-00000000000a', 'drop_in', 'out_of_business', '2026-11-10 16:00+00'),
  ('821a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000821', '821d0000-0000-0000-0000-000000000003', '82100000-0000-0000-0000-00000000000a', 'drop_in', 'not_in_office',   '2026-11-10 17:00+00');

do $$ declare v text; begin
  select string_agg(place_id || ':' || outcome || ':' || reported_by::text || ':' || source, ' / ' order by place_id)
    into v from place_suppressions where org_id = '00000000-0000-0000-0000-000000000821';
  if v is distinct from
     'q_flag:home_based:82100000-0000-0000-0000-00000000000a:outcome / q_gone:out_of_business:82100000-0000-0000-0000-00000000000a:outcome' then
    raise exception 'suppression records wrong: %', v;
  end if;
end $$;

do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');  -- Ben, same org
  v := pg_temp.found(true);
  perform pg_temp.back();
  if v like '%Flagged Home%' then raise exception '[6] Home-based business shown to a teammate: %', v; end if;
  if v like '%Flagged Gone%' then raise exception '[7] Out of business business shown to a teammate: %', v; end if;
  if v not like '%I Closed Now%' then raise exception '[8] Closed right now must not suppress: %', v; end if;
end $$;

-- 9. Another organization is unaffected.
do $$ declare v text; begin
  perform pg_temp.act('82200000-0000-0000-0000-00000000000a');  -- Yan, org Y
  v := pg_temp.found(true);
  perform pg_temp.back();
  if v not like '%Flagged Home%' or v not like '%Flagged Gone%' then
    raise exception '[9] org Y should still see both businesses: %', v;
  end if;
end $$;

-- 13 (again). With the filter off, suppression is ignored too.
do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  v := pg_temp.found(false);
  perform pg_temp.back();
  if v not like '%Flagged Home%' then raise exception '[13] filter off should ignore suppression: %', v; end if;
end $$;

-- 10. The lead or deal is untouched by suppression.
do $$ declare n int; begin
  select count(*) into n from deals
   where id in ('821d0000-0000-0000-0000-000000000001', '821d0000-0000-0000-0000-000000000002')
     and stage = 'lost' and owner_id = '82100000-0000-0000-0000-00000000000a';
  if n <> 2 then raise exception '[10] suppression changed a deal'; end if;
end $$;

-- First report wins: a second outcome on the same place keeps Ana's record.
insert into activities (org_id, deal_id, logged_by, type, disposition, occurred_at) values
  ('00000000-0000-0000-0000-000000000821', '821d0000-0000-0000-0000-000000000001', '82100000-0000-0000-0000-00000000000b', 'drop_in', 'out_of_business', now());
do $$ declare v text; begin
  select outcome || ':' || reported_by::text into v from place_suppressions
   where org_id = '00000000-0000-0000-0000-000000000821' and place_id = 'q_flag';
  if v <> 'home_based:82100000-0000-0000-0000-00000000000a' then raise exception 'first report should win, got %', v; end if;
end $$;

-- Changing an outcome to Out of business later also suppresses.
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, place_id, stage) values
  ('821d0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000821', '82100000-0000-0000-0000-00000000000a', 'C Open', 'C', 'c@qx.example', '+15550008206', 100, 'q_open_2', 'lost');
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at) values
  ('821a0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000821', '821d0000-0000-0000-0000-000000000006', '82100000-0000-0000-0000-00000000000a', 'drop_in', 'met_dm', now());
update activities set disposition = 'out_of_business' where id = '821a0000-0000-0000-0000-000000000006';
do $$ begin
  if not exists (select 1 from place_suppressions where place_id = 'q_open_2') then
    raise exception 'editing an outcome to Out of business should suppress';
  end if;
end $$;

-- 11 + 5. Ben's commitments are explained, never hidden. His deal at H carries
--         no place ID in the fixture above, so give it one now.
update deals set place_id = 'q_gone' where id = '821d0000-0000-0000-0000-000000000004';
update deals set place_id = 'q_perm' where id = '821d0000-0000-0000-0000-000000000005';
do $$ declare v text; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  select string_agg(deal_id::text || ':' || google_closed || ':' || suppressed, ' / ' order by deal_id) into v
    from public.place_quality_flags(array[
      '821d0000-0000-0000-0000-000000000004',
      '821d0000-0000-0000-0000-000000000005']::uuid[]);
  perform pg_temp.back();
  if v is distinct from
     '821d0000-0000-0000-0000-000000000004:false:true / 821d0000-0000-0000-0000-000000000005:true:false' then
    raise exception '[5/11] commitment flags wrong: %', v;
  end if;
end $$;

-- A user in another org learns nothing about org X's deals.
do $$ declare n int; begin
  perform pg_temp.act('82200000-0000-0000-0000-00000000000a');
  select count(*) into n from public.place_quality_flags(array['821d0000-0000-0000-0000-000000000004']::uuid[]);
  perform pg_temp.back();
  if n <> 0 then raise exception 'flags leaked across organizations'; end if;
end $$;

-- Suppressions: members read their own org's only, and cannot write.
do $$ declare n int; begin
  perform pg_temp.act('82200000-0000-0000-0000-00000000000a');
  select count(*) into n from place_suppressions;
  perform pg_temp.back();
  if n <> 0 then raise exception 'org Y read org X suppressions (%)', n; end if;
end $$;
do $$ begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  begin
    insert into place_suppressions (org_id, place_id, outcome, reported_at)
      values ('00000000-0000-0000-0000-000000000821', 'q_open_1', 'home_based', now());
    raise exception 'a rep could write a suppression directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from place_suppressions where place_id = 'q_gone';
    if found then raise exception 'a rep could delete a suppression'; end if;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.back();
end $$;

-- R7 counts: each business is counted under the first filter that removed it.
do $$ declare r record; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  select * into r from prospects_nearby_hidden_counts(40.0, -100.0, 2000, null, false, null, false, true);
  perform pg_temp.back();
  -- closed: D, E. service area: F. suppressed: G, H, C (edited above).
  -- candidates: all 9 in the area.
  if r.closed_hidden <> 2 or r.home_based_hidden <> 1 or r.suppressed_hidden <> 3 or r.candidates <> 9 then
    raise exception 'R7 counts wrong: closed % home % suppressed % candidates %',
      r.closed_hidden, r.home_based_hidden, r.suppressed_hidden, r.candidates;
  end if;
end $$;
do $$ declare r record; begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  select * into r from prospects_nearby_hidden_counts(40.0, -100.0, 2000, null, false, null, false, false);
  perform pg_temp.back();
  if r.closed_hidden <> 0 or r.suppressed_hidden <> 0 or r.home_based_hidden <> 1 then
    raise exception '[13] counts with the filter off should match today: closed % suppressed % home %',
      r.closed_hidden, r.suppressed_hidden, r.home_based_hidden;
  end if;
end $$;

-- The search log is service-role only.
do $$ begin
  perform pg_temp.act('82100000-0000-0000-0000-00000000000b');
  begin
    perform 1 from path_search_log limit 1;
    raise exception 'a rep could read path_search_log';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.back();
end $$;

-- Functions: nobody can call the trigger function directly, anon cannot search.
do $$ begin
  if has_function_privilege('authenticated', 'public.record_place_suppression()', 'execute') then
    raise exception 'authenticated can execute record_place_suppression';
  end if;
  if has_function_privilege('anon',
       'public.prospects_nearby(double precision, double precision, double precision, text, integer, boolean, text[], boolean, boolean)',
       'execute') then
    raise exception 'anon can execute prospects_nearby';
  end if;
  if not has_function_privilege('authenticated', 'public.place_quality_flags(uuid[])', 'execute') then
    raise exception 'authenticated cannot execute place_quality_flags';
  end if;
end $$;

-- 12. Backfill: replay the migration's backfill statement over a past Out of
--     business outcome that predates the trigger, and over one with no place ID.
alter table activities disable trigger activities_record_place_suppression;
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, place_id, stage) values
  ('821d0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000822', '82200000-0000-0000-0000-00000000000a', 'A Open', 'C', 'c@qy.example', '+15550008207', 100, 'q_open_1', 'new'),
  ('821d0000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000822', '82200000-0000-0000-0000-00000000000a', 'No Place', 'C', 'c@qy.example', '+15550008208', 100, null, 'new');
insert into activities (org_id, deal_id, logged_by, type, disposition, occurred_at) values
  ('00000000-0000-0000-0000-000000000822', '821d0000-0000-0000-0000-000000000007', '82200000-0000-0000-0000-00000000000a', 'drop_in', 'out_of_business', '2026-09-01 12:00+00'),
  ('00000000-0000-0000-0000-000000000822', '821d0000-0000-0000-0000-000000000007', '82200000-0000-0000-0000-00000000000a', 'drop_in', 'out_of_business', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-000000000822', '821d0000-0000-0000-0000-000000000008', '82200000-0000-0000-0000-00000000000a', 'drop_in', 'out_of_business', '2026-10-01 12:00+00');
alter table activities enable trigger activities_record_place_suppression;

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

do $$ declare v text; begin
  select string_agg(place_id || ':' || reported_at::date::text, ' / ') into v
    from place_suppressions
   where org_id = '00000000-0000-0000-0000-000000000822' and source = 'backfill';
  if v is distinct from 'q_open_1:2026-09-01' then
    raise exception '[12] backfill should keep the earliest report per place, got %', v;
  end if;
  -- Existing outcome-sourced rows in org X were not duplicated or replaced.
  if (select count(*) from place_suppressions
       where org_id = '00000000-0000-0000-0000-000000000821' and source = 'backfill') <> 0 then
    raise exception '[12] backfill replaced a live suppression';
  end if;
end $$;

rollback;
