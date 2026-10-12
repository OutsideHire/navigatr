-- Tests for 20261016000004_referral_icp_flags (Partner Portal Phase 2A, FR-PORT-58).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/053_referral_icp_flags.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-icp): boss administrator, rita rep owns partner P1, which
-- has an active portal user. Deal D1 'Subway Plaza' owned by rita.
-- exclusion_seed (from migrations): 'subway' is active; 'true value' is inactive.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001053', 'ICP Org', 'portal-icp', 'portal-icp-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0530000-0000-0000-0000-000000000001', 'boss@icp.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0530000-0000-0000-0000-000000000002', 'rita@icp.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0530000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'admin', 'administrator',      'Boss',     'boss@icp.example', 'icpboss'::ltree,      null),
  ('a0530000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001053', 'rep',   'sales_professional', 'Rita Rep', 'rita@icp.example', 'icpboss.rita'::ltree, 'a0530000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a053a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a0530000-0000-0000-0000-000000000002', 'a0530000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@icp.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a053b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a053a000-0000-0000-0000-000000000001', 'jane@icp.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a053d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001053', 'a0530000-0000-0000-0000-000000000002', 'Subway Plaza', '7 Main St', 'Sam', 'sam@plaza.example', '5550530009', 100000, 'new', 'partner_referral');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. Privileges, and no partner function can return the flags (before any role switch).
do $$ declare f record; begin
  if has_function_privilege('authenticated', 'public._referral_chain_brand(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_chain_brand(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public._referral_chain_brand(text)', 'EXECUTE') then
    raise exception '_referral_chain_brand must be private';
  end if;
  for f in
    select p.oid::regprocedure::text as sig, pg_get_function_result(p.oid) as res
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%'
  loop
    if f.res ilike '%icp%' or f.res in ('referrals', 'SETOF referrals') then
      raise exception 'portal function % could return ICP flags: %', f.sig, f.res;
    end if;
  end loop;
  -- No partner function so much as reads the column.
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ilike '%icp_flags%'
  loop
    raise exception 'portal function % mentions icp_flags', f.sig;
  end loop;
end $$;

-- 2. A rep-logged referral is flagged at insert (role switches from here on).
do $$ declare v uuid; f text[]; begin
  perform _t_act('a0530000-0000-0000-0000-000000000002');

  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Subway #1234');
  select icp_flags into f from referrals where id = v;
  if f is distinct from array['chain:Subway'] then raise exception 'Subway should be flagged, got %', f; end if;

  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Corner Cafe');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'an independent business gets no flag, got %', f; end if;

  -- An inactive pattern never flags (True Value is a co-op of independents).
  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Adam True Value Hardware');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'inactive patterns must not flag, got %', f; end if;

  -- A deal-linked referral is never triaged, so it gets no flag.
  v := public.attribute_deal_to_partner('a053a000-0000-0000-0000-000000000001', 'a053d000-0000-0000-0000-000000000001');
  select icp_flags into f from referrals where id = v;
  if f is distinct from '{}'::text[] then raise exception 'a deal-linked referral gets no flag, got %', f; end if;
end $$;

-- 3. A portal submission is flagged too, whatever the case.
do $$ declare v uuid; f text[]; begin
  perform set_config('role', 'postgres', true);
  select s.id into v
    from public.portal_submit_referral(
      '00000000-0000-0000-0000-000000001053', 'a053a000-0000-0000-0000-000000000001', 'a053b000-0000-0000-0000-000000000001',
      'SUBWAY Downtown', 'Ann', null, '5550530001', null, null, null, '', true, 0, null) s;
  select icp_flags into f from referrals where id = v;
  if f is distinct from array['chain:Subway'] then raise exception 'portal submissions are flagged too, got %', f; end if;
end $$;

-- 4. Ruling D3: an error inside the advisory check never blocks an insert.
do $$ declare v uuid; f text[]; begin
  perform set_config('role', 'postgres', true);
  create or replace function public._referral_chain_brand(p_company text)
  returns text language plpgsql as 'begin raise exception ''boom''; end';
  v := public.log_referral('a053a000-0000-0000-0000-000000000001', 'Subway #9');
  select icp_flags into f from referrals where id = v;
  if v is null or f is distinct from '{}'::text[] then raise exception 'a failing check must fall back to no flag, got %', f; end if;
end $$;

rollback;
