-- Tests for 20261014000001_referral_updates (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/045_referral_updates.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-upd): boss administrator; mgr (sales_manager) under boss;
-- rep1 under mgr; rep2 under boss in another branch. Partner P1 (owner rep1) has
-- referral X (accepted, deal D1 owned by rep1) and outbound Q. Partner P2 (owner
-- rep2) has W. Org portal-upd-b: admin bob, partner PB, referral Z.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001045', 'Update Org',   'portal-upd',   'portal-upd-a1',   true),
  ('00000000-0000-0000-0000-000000001145', 'Update Org B', 'portal-upd-b', 'portal-upd-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0450000-0000-0000-0000-000000000001', 'boss@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000002', 'mgr@upd.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000003', 'rep1@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000004', 'rep2@upd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0450000-0000-0000-0000-000000000005', 'bob@updb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0450000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'admin',   'administrator',      'Boss',     'boss@upd.example', 'updboss'::ltree,          null),
  ('a0450000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'manager', 'sales_manager',      'Mia Mgr',  'mgr@upd.example',  'updboss.mgr'::ltree,      'a0450000-0000-0000-0000-000000000001'),
  ('a0450000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001045', 'rep',     'sales_professional', 'Rita Rep', 'rep1@upd.example', 'updboss.mgr.rep1'::ltree, 'a0450000-0000-0000-0000-000000000002'),
  ('a0450000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001045', 'rep',     'sales_professional', 'Rob Rep',  'rep2@upd.example', 'updboss.rep2'::ltree,     'a0450000-0000-0000-0000-000000000001'),
  ('a0450000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001145', 'admin',   'administrator',      'Bob',      'bob@updb.example', 'updbob'::ltree,           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a045a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000003', 'a0450000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@upd.example'),
  ('a045a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000004', 'a0450000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@upd.example'),
  ('a045a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001145', 'a0450000-0000-0000-0000-000000000005', 'a0450000-0000-0000-0000-000000000005', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@updb.example');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a045d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a0450000-0000-0000-0000-000000000003', 'Fresh Bakery', '5 Oak St', 'Ann', 'ann@fresh.example', '5550450001', 100000, 'contacted', 'partner_referral');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, assigned_user_id, deal_id) values
  ('a045f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'accepted',  'Fresh Bakery', 'a0450000-0000-0000-0000-000000000003', 'a045d000-0000-0000-0000-000000000001'),
  ('a045f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered',      'accepted',  'Out Co',       'a0450000-0000-0000-0000-000000000003', null),
  ('a045f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000002', 'inbound',  'portal_signed_in', 'submitted', 'Corner Cafe',  'a0450000-0000-0000-0000-000000000004', null),
  ('a045f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001145', 'a045a000-0000-0000-0000-000000000003', 'inbound',  'portal_signed_in', 'submitted', 'Other Org Co', 'a0450000-0000-0000-0000-000000000005', null);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

create or replace function _t_update_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from referral_updates;
  return n;
end $$;

-- Privileges (before any role switch).
do $$ begin
  if has_table_privilege('authenticated', 'public.referral_updates', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_updates', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_updates', 'DELETE') then
    raise exception 'authenticated must not write referral_updates directly';
  end if;
  if not has_table_privilege('authenticated', 'public.referral_updates', 'SELECT') then
    raise exception 'authenticated should read referral_updates through RLS';
  end if;
  if has_table_privilege('anon', 'public.referral_updates', 'SELECT') then
    raise exception 'anon must not read referral_updates';
  end if;
  if not has_function_privilege('authenticated', 'public.publish_referral_update(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated should execute publish_referral_update';
  end if;
  if has_function_privilege('anon', 'public.publish_referral_update(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute publish_referral_update';
  end if;
  if has_function_privilege('authenticated', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'portal_referral_updates must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_referral_updates(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'service_role should execute portal_referral_updates';
  end if;
end $$;

-- 1. The assignee publishes; the body is trimmed and attributed (role switches from here on).
do $$ declare v_id uuid; u record; begin
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  v_id := public.publish_referral_update('a045f000-0000-0000-0000-000000000001', '  Called the owner, demo Tuesday  ');
  select * into u from referral_updates where id = v_id;
  if u.body is distinct from 'Called the owner, demo Tuesday'
     or u.author_user_id is distinct from 'a0450000-0000-0000-0000-000000000003'
     or u.org_id is distinct from '00000000-0000-0000-0000-000000001045'
     or u.referral_id is distinct from 'a045f000-0000-0000-0000-000000000001' then
    raise exception 'published update stored wrong: %', row_to_json(u);
  end if;
end $$;

-- 2. The manager above and an administrator may publish too.
do $$ begin
  perform _t_act('a0450000-0000-0000-0000-000000000002');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'Manager note for the partner');
  perform _t_act('a0450000-0000-0000-0000-000000000001');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'Admin note for the partner');
end $$;

-- 3. Length rules: blank refused, 1000 accepted, 1001 refused.
do $$ begin
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', '   ')$q$, 'update_required');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', null)$q$, 'update_required');
  -- C5: newline-only, tab-only, CRLF-only and mixed whitespace bodies are blank too.
  perform _t_raises(format('select public.publish_referral_update(%L, %L)', 'a045f000-0000-0000-0000-000000000001', E'\n\n'), 'update_required');
  perform _t_raises(format('select public.publish_referral_update(%L, %L)', 'a045f000-0000-0000-0000-000000000001', E'\t\t'), 'update_required');
  perform _t_raises(format('select public.publish_referral_update(%L, %L)', 'a045f000-0000-0000-0000-000000000001', E' \r\n\t '), 'update_required');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', repeat('a', 1001))$q$, 'update_too_long');
  perform public.publish_referral_update('a045f000-0000-0000-0000-000000000001', repeat('b', 1000));
end $$;

-- 4. Rights and scope.
do $$ begin
  -- rep2 is in another branch: cannot triage X and cannot see its deal.
  perform _t_act('a0450000-0000-0000-0000-000000000004');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000001', 'hi')$q$, 'not_authorized');
  -- rep1 cannot publish on rep2's referral W.
  perform _t_act('a0450000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000003', 'hi')$q$, 'not_authorized');
  -- Another org, an outbound referral, and a missing id all look missing.
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000004', 'hi')$q$, 'referral_not_found');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-000000000002', 'hi')$q$, 'referral_not_found');
  perform _t_raises($q$select public.publish_referral_update('a045f000-0000-0000-0000-0000000000ff', 'hi')$q$, 'referral_not_found');
end $$;

-- 5. Reading follows referral visibility.
do $$ begin
  if _t_update_rows('a0450000-0000-0000-0000-000000000003') <> 4 then raise exception 'rep1 should see the 4 updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000002') <> 4 then raise exception 'mgr should see the 4 updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000004') <> 0 then raise exception 'rep2 must not see updates on X'; end if;
  if _t_update_rows('a0450000-0000-0000-0000-000000000005') <> 0 then raise exception 'another org must see nothing'; end if;
end $$;

-- 6. The portal read: scoped, newest first, author name, deactivated author hidden.
do $$ declare names text[]; bodies text[]; n int; begin
  perform set_config('role', 'postgres', true);
  update referral_updates set published_at = now() - interval '3 hours' where body = 'Called the owner, demo Tuesday';
  update referral_updates set published_at = now() - interval '2 hours' where body = 'Manager note for the partner';
  update referral_updates set published_at = now() - interval '1 hours' where body = 'Admin note for the partner';
  update referral_updates set published_at = now()                      where body = repeat('b', 1000);
  update profiles set deactivated_at = now() where id = 'a0450000-0000-0000-0000-000000000002';

  select array_agg(u.body order by ord), array_agg(coalesce(u.author_name, '(none)') order by ord)
    into bodies, names
    from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001')
         with ordinality as u(body, published_at, author_name, ord);
  if bodies <> array[repeat('b', 1000), 'Admin note for the partner', 'Manager note for the partner', 'Called the owner, demo Tuesday'] then
    raise exception 'portal updates should be newest first, got %', bodies;
  end if;
  if names <> array['Rita Rep', 'Boss', '(none)', 'Rita Rep'] then
    raise exception 'author names wrong (deactivated author must be null), got %', names;
  end if;

  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000002', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'another partner must get nothing for X'; end if;
  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001145', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'another org must get nothing for X'; end if;
  update referrals set purged_at = now() where id = 'a045f000-0000-0000-0000-000000000001';
  select count(*) into n from public.portal_referral_updates('00000000-0000-0000-0000-000000001045', 'a045a000-0000-0000-0000-000000000001', 'a045f000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'a purged referral must return nothing'; end if;
end $$;

rollback;
