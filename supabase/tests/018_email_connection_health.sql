-- Tests for migration 20260820000012_email_connection_health
-- (Email Capture Phase 1, Slice 5d: admin connection-health readout).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/018_email_connection_health.sql
--
-- Self-cleans via ROLLBACK. Verifies email_connection_health():
--   * returns one row per email_connection in the caller's org, with the rep
--     name joined,
--   * orders unhealthy connections first (needs_reauth/error before ok),
--   * is admin-only (a non-admin gets an empty set).

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e2', 'Email Health Test', 'email-health-test', 'email-health-aa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('b0000000-0000-0000-0000-000000000001', 'admin@eh.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('b0000000-0000-0000-0000-000000000002', 'rep@eh.example',   'authenticated', 'authenticated', now(), now(), now());

-- role_level derived from role by the profiles_fill_role_level trigger.
insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'admin', 'Admin', 'admin@eh.example', 'top'::ltree),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'rep',   'Rep',   'rep@eh.example',   'top.rep'::ltree);

-- Admin's connection is healthy; the rep's needs a reconnect.
insert into email_connection (user_id, org_id, provider, health, last_poll_at, last_error) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'outlook', 'ok',           now(),                   null),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'outlook', 'needs_reauth', now() - interval '2 hours', 'reauth required');

-- ─── Admin: sees both, unhealthy first ────────────────────────────────
do $$
declare v_rows int; v_first_health text; v_first_name text;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_rows from public.email_connection_health();
  if v_rows <> 2 then raise exception 'email health: admin expected 2 rows, got %', v_rows; end if;
  select health, rep_name into v_first_health, v_first_name
    from public.email_connection_health() limit 1;
  if v_first_health <> 'needs_reauth' then
    raise exception 'email health: unhealthy connection must sort first, got %', v_first_health;
  end if;
  if v_first_name <> 'Rep' then
    raise exception 'email health: expected rep name joined on first row, got %', v_first_name;
  end if;
end $$;

-- ─── Non-admin: empty ─────────────────────────────────────────────────
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_rows from public.email_connection_health();
  if v_rows <> 0 then raise exception 'email health: non-admin must get an empty set, got % rows', v_rows; end if;
end $$;

rollback;
