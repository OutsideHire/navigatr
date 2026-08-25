-- Tests for migration 20260825000002_cron_health.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/020_cron_health.sql
--
-- Self-cleans via ROLLBACK. Verifies cron_health():
--   * admin gets a jsonb with the three job keys (freshness FACTS; the
--     ok/stale/idle judgement is the client lib's job, unit-tested there),
--   * a non-admin gets {} (admin-only operational surface),
--   * the persistence fact reflects the caller's own org's latest snapshot.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000ca', 'Cron Health Test', 'cron-health-test', 'cron-health-aa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('ca000000-0000-0000-0000-000000000001', 'admin@ch.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ca000000-0000-0000-0000-000000000002', 'rep@ch.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('ca000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ca', 'admin', 'Admin', 'admin@ch.example', 'top'::ltree),
  ('ca000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ca', 'rep',   'Rep',   'rep@ch.example',   'top.rep'::ltree);

-- A company persistence snapshot dated today, so the persistence fact is populated.
insert into persistence_company_snapshot (org_id, snapshot_date, composite_median, composite_p90, rep_count, formula_version)
values ('00000000-0000-0000-0000-0000000000ca', current_date, 50, 70, 1, 2);

-- ─── Admin: jsonb with the three keys + the org's latest persistence date ───
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  v := public.cron_health();
  if not (v ? 'persistence' and v ? 'coverage' and v ? 'email_capture') then
    raise exception 'cron_health: admin result missing job keys: %', v;
  end if;
  if (v->'persistence'->>'latest_date') <> current_date::text then
    raise exception 'cron_health: persistence latest_date expected %, got %', current_date, v->'persistence'->>'latest_date';
  end if;
  if (v->'persistence'->>'rows')::int <> 1 then
    raise exception 'cron_health: persistence rows expected 1, got %', v->'persistence'->>'rows';
  end if;
  if (v->'email_capture'->>'connections')::int <> 0 then
    raise exception 'cron_health: email_capture connections expected 0, got %', v->'email_capture'->>'connections';
  end if;
end $$;

-- ─── Non-admin: empty object ───────────────────────────────────────────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  v := public.cron_health();
  if v <> '{}'::jsonb then
    raise exception 'cron_health: non-admin must get {}, got %', v;
  end if;
end $$;

rollback;
