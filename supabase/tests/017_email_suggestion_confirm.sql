-- Tests for migration 20260820000011_email_suggestion_confirm
-- (Automatic Email Activity Capture, Slice 5a confirm/dismiss).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/017_email_suggestion_confirm.sql
--
-- Self-cleans via ROLLBACK. Verifies confirm creates + links the activity and
-- flips status; is sender-gated + idempotent; and dismiss is sender-gated.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e3', 'Confirm Test', 'confirm-test', 'confirm-test-a');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('d0000000-0000-0000-0000-000000000002', 'rep1@c2.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('d0000000-0000-0000-0000-000000000003', 'rep2@c2.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e3', 'rep', 'Rep1', 'rep1@c2.example', 'top.rep1'::ltree),
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e3', 'rep', 'Rep2', 'rep2@c2.example', 'top.rep2'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('d1000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000002', 'C2 Co', 'C', 'c@c2.example', '+15550060001', 10000);

-- Two suggested emails owned by rep1 (service-role seed).
insert into email_activity (id, org_id, sender_user_id, provider, provider_message_id, sent_at, subject, matched_deal_id, status) values
  ('d2000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000002', 'outlook', 'msg-c1', now(), 'Quote', 'd1000000-0000-0000-0000-0000000000d1', 'suggested'),
  ('d2000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000002', 'outlook', 'msg-c2', now(), 'Followup', 'd1000000-0000-0000-0000-0000000000d1', 'suggested');

-- ─── A peer cannot confirm someone else's suggestion ──────────────────
do $$
declare denied boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000003', true); -- rep2
  perform set_config('role', 'authenticated', true);
  begin
    perform public.confirm_email_suggestion('d2000000-0000-0000-0000-0000000000a1');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'peer must NOT confirm another rep suggestion'; end if;
end $$;

-- ─── Sender confirms: activity created + linked, status flipped ───────
do $$
declare v_activity uuid; n int;
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true); -- rep1
  perform set_config('role', 'authenticated', true);
  v_activity := public.confirm_email_suggestion('d2000000-0000-0000-0000-0000000000a1');
  if v_activity is null then raise exception 'confirm should return the new activity id'; end if;

  select count(*) into n from activities
    where id = v_activity and type = 'email' and capture_source = 'automatic'
      and direction = 'outbound' and disposition = 'sent_information'
      and deal_id = 'd1000000-0000-0000-0000-0000000000d1' and logged_by = 'd0000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'confirm should create the auto email activity, got %', n; end if;

  select count(*) into n from email_activity
    where id = 'd2000000-0000-0000-0000-0000000000a1' and status = 'confirmed' and activity_id = v_activity;
  if n <> 1 then raise exception 'suggestion should be confirmed + linked, got %', n; end if;
end $$;

-- ─── Confirm is idempotent (returns the same activity) ────────────────
do $$
declare a1 uuid; a2 uuid;
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  select activity_id into a1 from email_activity where id = 'd2000000-0000-0000-0000-0000000000a1';
  a2 := public.confirm_email_suggestion('d2000000-0000-0000-0000-0000000000a1');
  if a1 <> a2 then raise exception 'confirm must be idempotent (same activity), got % vs %', a1, a2; end if;
end $$;

-- ─── Dismiss: sender rejects the other suggestion ─────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  perform public.dismiss_email_suggestion('d2000000-0000-0000-0000-0000000000a2');
  select count(*) into n from email_activity where id = 'd2000000-0000-0000-0000-0000000000a2' and status = 'dismissed' and activity_id is null;
  if n <> 1 then raise exception 'dismiss should set status dismissed with no activity, got %', n; end if;
end $$;

rollback;
