-- Tests for 20261018000002_referral_form_links (Partner Portal Phase 2B-1,
-- FR-PORT-24..28).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/057_referral_form_links.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture, org A pf-links (portal on, public form on): boss administrator,
-- rita rep under boss, dee rep under boss (deactivated). Partner P1 owned by rita.
-- Org B pf-links-b (portal on, public form off): bob administrator.
-- Org C pf-links-c: created with every default.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001057', 'Links Org',   'pf-links',   'pf-links-a1',   true),
  ('00000000-0000-0000-0000-000000001157', 'Links Org B', 'pf-links-b', 'pf-links-b-a1', true);
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001257', 'Links Org C', 'pf-links-c', 'pf-links-c-a1');
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001057';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0570000-0000-0000-0000-000000000001', 'boss@links.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000002', 'rita@links.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000003', 'dee@links.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0570000-0000-0000-0000-000000000004', 'bob@linksb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0570000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001057', 'admin', 'administrator',      'Boss',     'boss@links.example', 'lnkboss'::ltree,      null,                                   null),
  ('a0570000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001057', 'rep',   'sales_professional', 'Rita Rep', 'rita@links.example', 'lnkboss.rita'::ltree, 'a0570000-0000-0000-0000-000000000001', null),
  ('a0570000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001057', 'rep',   'sales_professional', 'Dee Rep',  'dee@links.example',  'lnkboss.dee'::ltree,  'a0570000-0000-0000-0000-000000000001', now()),
  ('a0570000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001157', 'admin', 'administrator',      'Bob',      'bob@linksb.example', 'lnkbob'::ltree,       null,                                   null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a057a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001057', 'a0570000-0000-0000-0000-000000000002', 'a0570000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa');

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

-- 1. Defaults, privileges, routing parity (as postgres, before any role switch).
do $$ begin
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001257') then
    raise exception 'the public form defaults to off';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_referral_link()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_tenant_referral_link()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.regenerate_referral_link(text, uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute the link RPCs';
  end if;
  if has_function_privilege('anon', 'public.get_my_referral_link()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_tenant_referral_link()', 'EXECUTE')
     or has_function_privilege('anon', 'public.regenerate_referral_link(text, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the link RPCs';
  end if;
  if has_function_privilege('authenticated', 'public.referral_route_user(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_route_user(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_form_link(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_form_link(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_link_token()', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_link_token()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._referral_form_open(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_form_open(uuid)', 'EXECUTE') then
    raise exception 'the link helpers are private';
  end if;
  if has_table_privilege('authenticated', 'public.referral_form_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_form_links', 'UPDATE')
     or has_table_privilege('anon', 'public.referral_form_links', 'SELECT') then
    raise exception 'nobody reads or writes referral_form_links directly';
  end if;
  if public.referral_route_assignee('a057a000-0000-0000-0000-000000000001')
     is distinct from public.referral_route_user('a0570000-0000-0000-0000-000000000002') then
    raise exception 'routing a partner must equal routing its owner';
  end if;
  if public.referral_route_user('a0570000-0000-0000-0000-000000000002') is distinct from 'a0570000-0000-0000-0000-000000000002'::uuid then
    raise exception 'an active placed rep routes to themselves';
  end if;
  if public.referral_route_user('a0570000-0000-0000-0000-000000000003') is distinct from 'a0570000-0000-0000-0000-000000000001'::uuid then
    raise exception 'a deactivated rep routes to their manager';
  end if;
  if public.referral_route_user(null) is not null then
    raise exception 'no user routes to the administrator queue';
  end if;
end $$;

-- 2. A rep gets a personal link, lazily, once; rep-only refusals.
do $$ declare v record; v2 record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000002');
  select * into v from public.get_my_referral_link();
  if v.link_token is null or v.link_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'a rep gets a 22-character link, got %', v.link_token;
  end if;
  if v.org_slug <> 'pf-links' or not v.public_form_enabled then
    raise exception 'slug and flag come back, got % %', v.org_slug, v.public_form_enabled;
  end if;
  select * into v2 from public.get_my_referral_link();
  if v2.link_token <> v.link_token then
    raise exception 'the link is stable across calls';
  end if;
  perform set_config('t.rita_first', v.link_token, true);

  perform _t_raises($q$select * from public.get_tenant_referral_link()$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('tenant')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('bogus')$q$, 'invalid_link_type');
end $$;

-- 3. A rep gets a new link; the old one is retired and the change is audited.
do $$ declare v_new text; v record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000002');
  v_new := public.regenerate_referral_link('user');
  if v_new is null or v_new = current_setting('t.rita_first') then
    raise exception 'regenerating returns a different token';
  end if;
  select * into v from public.get_my_referral_link();
  if v.link_token <> v_new then
    raise exception 'the new link is the active one';
  end if;
  perform set_config('t.rita_second', v_new, true);

  perform set_config('role', 'postgres', true);
  if (select retired_at from referral_form_links where token = current_setting('t.rita_first')) is null then
    raise exception 'the old link is retired';
  end if;
  if (select count(*) from referral_form_links
       where user_id = 'a0570000-0000-0000-0000-000000000002' and retired_at is null) <> 1 then
    raise exception 'exactly one active link per user';
  end if;
  if not exists (select 1 from portal_audit_log a
                  where a.org_id = '00000000-0000-0000-0000-000000001057' and a.action = 'link_regenerate'
                    and a.actor_user_id = 'a0570000-0000-0000-0000-000000000002' and a.portal_user_id is null) then
    raise exception 'regenerating is audited with the acting user';
  end if;
end $$;

-- 4. An administrator: the tenant link, and regenerating a rep's link.
do $$ declare v record; v_t text; v_r text; begin
  perform _t_act('a0570000-0000-0000-0000-000000000001');
  select * into v from public.get_tenant_referral_link();
  if v.link_token is null or not v.public_form_enabled or v.org_slug <> 'pf-links' then
    raise exception 'an administrator gets the tenant link';
  end if;
  v_t := public.regenerate_referral_link('tenant');
  if v_t is null or v_t = v.link_token then
    raise exception 'the tenant link is regenerated';
  end if;
  perform _t_raises($q$select public.regenerate_referral_link('tenant', 'a0570000-0000-0000-0000-000000000002')$q$, 'not_authorized');
  v_r := public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000002');
  if v_r is null or v_r = current_setting('t.rita_second') then
    raise exception 'an administrator regenerates a rep''s link';
  end if;
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000004')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-0000000000ff')$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user', 'a0570000-0000-0000-0000-000000000003')$q$, 'not_authorized');

  perform set_config('role', 'postgres', true);
  if (select count(*) from referral_form_links
       where org_id = '00000000-0000-0000-0000-000000001057' and link_type = 'tenant' and retired_at is null) <> 1 then
    raise exception 'exactly one active tenant link';
  end if;
  if (select token from referral_form_links
       where user_id = 'a0570000-0000-0000-0000-000000000002' and retired_at is null) <> v_r then
    raise exception 'the administrator''s regenerated link is rita''s active link';
  end if;
end $$;

-- 5. Public form off: no token, nothing created. Deactivated caller: refused.
do $$ declare v record; begin
  perform _t_act('a0570000-0000-0000-0000-000000000004');
  select * into v from public.get_my_referral_link();
  if v.link_token is not null or v.public_form_enabled or v.org_slug <> 'pf-links-b' then
    raise exception 'no personal link while the form is off, got %', row_to_json(v);
  end if;
  select * into v from public.get_tenant_referral_link();
  if v.link_token is not null or v.public_form_enabled then
    raise exception 'no tenant link while the form is off';
  end if;
  if public.regenerate_referral_link('user') is not null then
    raise exception 'regenerating returns null while the form is off';
  end if;

  perform _t_act('a0570000-0000-0000-0000-000000000003');
  perform _t_raises($q$select * from public.get_my_referral_link()$q$, 'not_authorized');
  perform _t_raises($q$select public.regenerate_referral_link('user')$q$, 'not_authorized');

  perform set_config('role', 'postgres', true);
  if exists (select 1 from referral_form_links where org_id = '00000000-0000-0000-0000-000000001157') then
    raise exception 'nothing is created while the public form is off';
  end if;
  if exists (select 1 from portal_audit_log where org_id = '00000000-0000-0000-0000-000000001157' and action = 'link_regenerate') then
    raise exception 'nothing is audited while the public form is off';
  end if;
end $$;

-- 6. One active link per user and per tenant, enforced by the table.
do $$ begin
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001057', 'user', 'a0570000-0000-0000-0000-000000000002', 'dupDupDupDupDup0001')$q$,
    'referral_form_links_user_active_uidx');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, token)
    values ('00000000-0000-0000-0000-000000001057', 'tenant', 'dupDupDupDupDup0002')$q$,
    'referral_form_links_tenant_active_uidx');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001157', 'tenant', 'a0570000-0000-0000-0000-000000000004', 'dupDupDupDupDup0003')$q$,
    'referral_form_links_user_matches_type');
  perform _t_raises($q$insert into referral_form_links (org_id, link_type, user_id, token)
    values ('00000000-0000-0000-0000-000000001157', 'user', 'a0570000-0000-0000-0000-000000000004', 'short')$q$,
    'referral_form_links_token_check');
end $$;

rollback;
