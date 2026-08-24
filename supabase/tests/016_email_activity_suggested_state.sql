-- Tests for migration 20260820000010_email_activity_suggested_state
-- (Automatic Email Activity Capture, D-07 suggested-first lifecycle).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/016_email_activity_suggested_state.sql
--
-- Self-cleans via ROLLBACK. Verifies a SUGGESTED email row (no activity yet)
-- can exist with a null activity_id + status 'suggested', is fail-closed
-- readable (sender + admin yes, peer no), and that the status check rejects
-- junk values.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e2', 'Sugg Test', 'sugg-test', 'sugg-test-aaaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('c0000000-0000-0000-0000-000000000001', 'admin@s.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('c0000000-0000-0000-0000-000000000002', 'rep1@s.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('c0000000-0000-0000-0000-000000000003', 'rep2@s.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'admin', 'Admin', 'admin@s.example', 'top'::ltree),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'rep',   'Rep1',  'rep1@s.example',  'top.rep1'::ltree),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e2', 'rep',   'Rep2',  'rep2@s.example',  'top.rep2'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('c1000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-000000000002', 'S Co', 'C', 'c@s.example', '+15550050001', 10000);

-- A SUGGESTED email (matched to a deal, no activity yet). Seeded as superuser
-- (service-role stand-in). activity_id is NULL, status defaults 'suggested'.
insert into email_activity (org_id, sender_user_id, provider, provider_message_id, sent_at, subject, matched_deal_id) values
  ('00000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-000000000002', 'outlook', 'msg-sugg-1', now(), 'Suggested', 'c1000000-0000-0000-0000-0000000000d1');

-- Null activity_id + default status is allowed now.
do $$
declare n int;
begin
  select count(*) into n from email_activity
    where provider_message_id = 'msg-sugg-1' and activity_id is null and status = 'suggested';
  if n <> 1 then raise exception 'suggested row: expected 1 with null activity + status suggested, got %', n; end if;
end $$;

-- status check rejects junk.
do $$
declare bad boolean := false;
begin
  begin
    insert into email_activity (org_id, sender_user_id, provider, provider_message_id, sent_at, status)
    values ('00000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-000000000002', 'outlook', 'msg-bad', now(), 'nonsense');
  exception when check_violation then bad := true;
  end;
  if not bad then raise exception 'status check should reject an unknown value'; end if;
end $$;

-- Fail-closed reads: sender + admin see the suggestion, peer does not.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true); -- sender
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity; if n <> 1 then raise exception 'sender should see 1 suggestion, got %', n; end if;
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true); -- peer
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity; if n <> 0 then raise exception 'peer should see 0 suggestions, got %', n; end if;
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true); -- admin
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity; if n <> 1 then raise exception 'admin should see 1 suggestion, got %', n; end if;
end $$;

rollback;
