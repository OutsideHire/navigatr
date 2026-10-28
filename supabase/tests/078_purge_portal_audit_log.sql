-- Tests for 20261030000002_purge_portal_audit_log (Partner Portal audit fixes, NFR-PORT-06).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/078_purge_portal_audit_log.sql
-- Self-cleans via ROLLBACK.
--
-- The portal activity log is kept 2 years. The run time is fixed at 2026-10-30 06:25 UTC.
--   OLD  2 years and 1 day old     deleted
--   EDGE exactly 2 years old       kept (the cutoff is a strict less than)
--   NEW  2 years minus 1 day old   kept
--   FRESH just now                 kept

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-00000000078a', 'Audit Purge Org', 'portal-auditpurge', 'portal-auditpurge1', true);

insert into portal_audit_log (id, org_id, action, created_at) values
  ('a0780000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000078a', 'purge',
   timestamptz '2026-10-30 06:25+00' - interval '2 years 1 day'),
  ('a0780000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000078a', 'purge',
   timestamptz '2026-10-30 06:25+00' - interval '2 years'),
  ('a0780000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000078a', 'purge',
   timestamptz '2026-10-30 06:25+00' - interval '2 years' + interval '1 day'),
  ('a0780000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000078a', 'purge',
   timestamptz '2026-10-30 06:25+00');

-- 1. Privileges and schedule.
do $$ begin
  if not has_function_privilege('service_role', 'public.purge_portal_audit_log(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_portal_audit_log(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_portal_audit_log(timestamptz)', 'EXECUTE') then
    raise exception 'purge_portal_audit_log is service role only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-portal-audit-log' and schedule = '25 6 * * *') then
    raise exception 'purge-portal-audit-log is scheduled daily at 06:25';
  end if;
end $$;

-- 2. Old row deleted, newer rows kept.
-- Counts are scoped to this fixture's org so the test also passes on a seeded dev DB.
do $$ begin
  perform public.purge_portal_audit_log(timestamptz '2026-10-30 06:25+00');
  if exists (select 1 from portal_audit_log where id = 'a0780000-0000-0000-0000-000000000001') then
    raise exception '2 years plus 1 day old row is deleted';
  end if;
  if (select count(*) from portal_audit_log where id in
        ('a0780000-0000-0000-0000-000000000002', 'a0780000-0000-0000-0000-000000000003')) <> 2 then
    raise exception 'rows inside 2 years are kept';
  end if;
  if not exists (select 1 from portal_audit_log where id = 'a0780000-0000-0000-0000-000000000004') then
    raise exception 'a row exactly 2 years old is kept (strict less than)';
  end if;
  if (select count(*) from portal_audit_log where org_id = '00000000-0000-0000-0000-00000000078a') <> 3 then
    raise exception 'three fixture rows remain';
  end if;
  -- Second run is a no-op.
  perform public.purge_portal_audit_log(timestamptz '2026-10-30 06:25+00');
  if (select count(*) from portal_audit_log where org_id = '00000000-0000-0000-0000-00000000078a') <> 3 then
    raise exception 'second run deletes nothing';
  end if;
end $$;

rollback;
