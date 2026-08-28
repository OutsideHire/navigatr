-- Seat-limit enforcement + the invite server-gate.
--
-- Run with a service-role connection (see tools/run-db-tests.sh):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/030_seat_limit.sql
--
-- Self-cleans via the wrapping transaction's rollback.
--
-- WHY (regression protocol, Phase 2). A beta ISO on a seat cap must get a clean
-- per-row rejection, not a silent over-provision. admin_bulk_invite counts used
-- seats (active profiles + pending invites) and returns error='seat_cap_reached'
-- for each row past the cap while still accepting the rows below it. Nothing
-- exercised the boundary. Also pins the server gate that backs the client
-- `inviteUsers` capability: only administrator/cso_cro may invite.

begin;

-- seat_limit 4, one admin + one sales pro already active => 2 seats used, 2 left.
insert into organizations (id, name, slug, invite_code, seat_limit) values
  ('eeee0000-0000-4000-8000-0000000000e0', 'Org E Payments', 'org-e-seat', 'org-e-seat', 4);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('eeee0000-0000-4000-8000-0000000000e1', 'admin_e@seat.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('eeee0000-0000-4000-8000-0000000000e2', 'pro_e@seat.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('eeee0000-0000-4000-8000-0000000000e1', 'eeee0000-0000-4000-8000-0000000000e0', 'admin', 'administrator',      'Admin E', 'admin_e@seat.example', null),
  ('eeee0000-0000-4000-8000-0000000000e2', 'eeee0000-0000-4000-8000-0000000000e0', 'rep',   'sales_professional', 'Pro E',   'pro_e@seat.example',   null);

-- ───────────────────────────────────────────────────────────────────
-- Case 1: with 2 seats left, a 3-invite batch accepts 2 and caps the 3rd.
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_ok int; v_cap int;
begin
  perform set_config('request.jwt.claim.sub', 'eeee0000-0000-4000-8000-0000000000e1', true);
  perform set_config('role', 'authenticated', true);

  select count(*) filter (where ok), count(*) filter (where error = 'seat_cap_reached')
    into v_ok, v_cap
    from admin_bulk_invite('[{"email":"s1@seat.example"},{"email":"s2@seat.example"},{"email":"s3@seat.example"}]'::jsonb);

  if v_ok <> 2 then
    raise exception 'seat: expected 2 invites accepted (2 seats left), got %', v_ok;
  end if;
  if v_cap <> 1 then
    raise exception 'seat: expected 1 row capped as seat_cap_reached, got %', v_cap;
  end if;
end $$;

-- The two accepted invites really landed as pending rows (visible to the admin).
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'eeee0000-0000-4000-8000-0000000000e1', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n
    from org_invites
   where org_id = 'eeee0000-0000-4000-8000-0000000000e0'
     and accepted_at is null and revoked_at is null;
  if n <> 2 then
    raise exception 'seat: expected 2 pending invites created, got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: the invite server-gate. A sales_professional must NOT be able to
-- invite (matches the client `inviteUsers` capability = administrator/cso_cro).
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_raised boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'eeee0000-0000-4000-8000-0000000000e2', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform admin_bulk_invite('[{"email":"z@seat.example"}]'::jsonb);
  exception when others then
    v_raised := true;
    if sqlerrm <> 'forbidden' then
      raise exception 'gate: expected forbidden for a sales_professional, got "%"', sqlerrm;
    end if;
  end;
  if not v_raised then
    raise exception 'gate: a sales_professional must NOT be allowed to invite (no error raised)';
  end if;
end $$;

rollback;
