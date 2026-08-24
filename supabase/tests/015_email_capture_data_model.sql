-- Tests for migration 20260820000009_email_capture_data_model
-- (Automatic Email Activity Capture, Phase 1 Slice 1: data model RLS).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/015_email_capture_data_model.sql
--
-- Self-cleans via ROLLBACK. Verifies fail-closed reads: the sending rep + an
-- admin can read their email rows; a peer cannot. And that clients cannot
-- insert/delete (service-role only), while a rep can resolve their own
-- unmatched-queue row (UPDATE).

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e1', 'Email Test', 'email-test', 'email-test-aaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('b0000000-0000-0000-0000-000000000001', 'admin@e.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('b0000000-0000-0000-0000-000000000002', 'rep1@e.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('b0000000-0000-0000-0000-000000000003', 'rep2@e.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'admin', 'Admin', 'admin@e.example', 'top'::ltree),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'rep',   'Rep1',  'rep1@e.example',  'top.rep1'::ltree),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'rep',   'Rep2',  'rep2@e.example',  'top.rep2'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('b1000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-000000000002', 'E Co', 'C', 'c@e.example', '+15550040001', 10000);

-- A matched email activity (activity row + email_activity detail), sent by rep1.
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at, capture_source, direction) values
  ('b2000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-000000000002', 'email', 'sent_pricing', now(), 'automatic', 'outbound');

-- Seeded as superuser (service-role stand-in); clients can't insert.
insert into email_activity (org_id, activity_id, sender_user_id, provider, provider_message_id, sent_at, subject, has_attachments, deep_link_url, matched_deal_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000002', 'outlook', 'msg-1', now(), 'Pricing', false, 'https://outlook.example/msg-1', 'b1000000-0000-0000-0000-0000000000d1');

insert into email_unmatched_queue (org_id, sender_user_id, provider, provider_message_id, sent_at, subject) values
  ('00000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-000000000002', 'outlook', 'msg-2', now(), 'Unmatched');

insert into email_connection (user_id, org_id, provider) values
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'outlook');

-- ─── SELECT fail-closed: sender + admin yes, peer no ──────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true); -- rep1 (sender)
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity;        if n <> 1 then raise exception 'rep1 email_activity: expected 1, got %', n; end if;
  select count(*) into n from email_unmatched_queue; if n <> 1 then raise exception 'rep1 queue: expected 1, got %', n; end if;
  select count(*) into n from email_connection;      if n <> 1 then raise exception 'rep1 connection: expected 1, got %', n; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true); -- rep2 (peer)
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity;        if n <> 0 then raise exception 'peer email_activity: expected 0, got %', n; end if;
  select count(*) into n from email_unmatched_queue; if n <> 0 then raise exception 'peer queue: expected 0, got %', n; end if;
  select count(*) into n from email_connection;      if n <> 0 then raise exception 'peer connection: expected 0, got %', n; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true); -- admin
  perform set_config('role', 'authenticated', true);
  select count(*) into n from email_activity;        if n <> 1 then raise exception 'admin email_activity: expected 1, got %', n; end if;
  select count(*) into n from email_connection;      if n <> 1 then raise exception 'admin connection: expected 1, got %', n; end if;
end $$;

-- ─── Clients cannot insert email_activity (service-role only) ──────────
do $$
declare denied boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into email_activity (org_id, activity_id, sender_user_id, provider, provider_message_id, sent_at)
    values ('00000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000002', 'outlook', 'msg-x', now());
  exception when others then denied := true;
  end;
  if not denied then raise exception 'client must NOT insert email_activity (service-role only)'; end if;
end $$;

-- ─── Rep can resolve (UPDATE) their own unmatched-queue row ───────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true); -- rep1 (sender)
  perform set_config('role', 'authenticated', true);
  update email_unmatched_queue set status = 'dismissed' where provider_message_id = 'msg-2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'sender should resolve own queue row (1), got %', n; end if;
end $$;

-- ─── A peer cannot resolve someone else's queue row ───────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true); -- rep2 (peer)
  perform set_config('role', 'authenticated', true);
  update email_unmatched_queue set status = 'assigned' where provider_message_id = 'msg-2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'peer must NOT resolve another rep queue row, affected %', n; end if;
end $$;

rollback;
