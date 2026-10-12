-- Tests for 20261014000006_portal_notify_cron (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/050_portal_notify_cron.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-health): boss administrator, rita rep, one active portal
-- user. Outbox: one pending (30 minutes old), one failed yesterday, one sent two
-- days ago, one sent ten days ago. A second org has a pending row that must not
-- be counted.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001050', 'Health Org',   'portal-health',   'portal-health-a1',   true),
  ('00000000-0000-0000-0000-000000001150', 'Health Org B', 'portal-health-b', 'portal-health-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0500000-0000-0000-0000-000000000001', 'boss@health.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0500000-0000-0000-0000-000000000002', 'rita@health.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0500000-0000-0000-0000-000000000003', 'boss@healthb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001050', 'admin', 'administrator',      'Boss',     'boss@health.example',  'hlthboss'::ltree,      null),
  ('a0500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001050', 'rep',   'sales_professional', 'Rita Rep', 'rita@health.example',  'hlthboss.rita'::ltree, 'a0500000-0000-0000-0000-000000000001'),
  ('a0500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001150', 'admin', 'administrator',      'Boss B',   'boss@healthb.example', 'hlthbossb'::ltree,     null);

insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key, created_at, sent_at, failed_at, attempts) values
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:pending', now() - interval '30 minutes', null, null, 0),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:failed',  now() - interval '2 days',   null, now() - interval '1 day', 5),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:sent',    now() - interval '2 days',   now() - interval '2 days', null, 1),
  ('00000000-0000-0000-0000-000000001050', 'internal_nudge', 'a0500000-0000-0000-0000-000000000002', '{}', 't50:old',     now() - interval '10 days',  now() - interval '10 days', null, 1),
  ('00000000-0000-0000-0000-000000001150', 'internal_nudge', 'a0500000-0000-0000-0000-000000000003', '{}', 't50:other',   now() - interval '1 hour',   null, null, 0);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- The job is registered every 2 minutes with the per-environment URL and the shared secret.
do $$ declare j record; begin
  select schedule, command into j from cron.job where jobname = 'portal-notify';
  if j.schedule is distinct from '*/2 * * * *' then raise exception 'portal-notify should run every 2 minutes, got %', j.schedule; end if;
  if position('portal_notify_fn_url' in j.command) = 0 or position('cron_secret' in j.command) = 0 then
    raise exception 'portal-notify must read its URL and the cron secret from Vault: %', j.command;
  end if;
  if position('http' in replace(j.command, 'net.http_post', '')) > 0 then
    raise exception 'portal-notify must not hardcode a URL: %', j.command;
  end if;
end $$;

-- Privileges unchanged.
do $$ begin
  if not has_function_privilege('authenticated', 'public.cron_health()', 'EXECUTE') then
    raise exception 'authenticated should still execute cron_health';
  end if;
end $$;

-- An administrator sees their org's partner email health (role switches from here on).
do $$ declare h jsonb; begin
  perform _t_act('a0500000-0000-0000-0000-000000000001');
  h := public.cron_health() -> 'portal_email';
  if (h->>'pending')::int <> 1 or (h->>'failed_7d')::int <> 1 or (h->>'sent_7d')::int <> 1 then
    raise exception 'portal_email counts wrong: %', h;
  end if;
  if (h->>'oldest_pending_at') is null then raise exception 'oldest_pending_at should be set: %', h; end if;
  if (public.cron_health() ? 'email_capture') is not true then raise exception 'existing keys must stay'; end if;
end $$;

-- A rep gets nothing.
do $$ begin
  perform _t_act('a0500000-0000-0000-0000-000000000002');
  if public.cron_health() <> '{}'::jsonb then raise exception 'a non-admin must get {}'; end if;
end $$;

rollback;
