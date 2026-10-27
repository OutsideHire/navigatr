-- Tests for 20261029000003_internal_assigned_email (Partner Portal audit fixes, FR-PORT-80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/075_internal_assigned_email.sql
-- Self-cleans via ROLLBACK.
--
-- Reassigning a referral or a form submission emails the new assignee
-- (kind internal_assigned), unless the assignee did not change or the caller
-- assigned it to themselves.
--
-- Org portal-assign: boss administrator; rita and rob reps. Partner P1 owned by rita.
--   R1 submitted referral Assign Co, assigned to rita
--   S1 submission Form Assign Co, assigned to rita

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001075', 'Assign Org', 'portal-assign', 'portal-assign-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0750000-0000-0000-0000-000000000001', 'boss@assign.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0750000-0000-0000-0000-000000000002', 'rita@assign.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0750000-0000-0000-0000-000000000003', 'rob@assign.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0750000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001075', 'admin', 'administrator',      'Boss',     'boss@assign.example', 'rmboss'::ltree,      null),
  ('a0750000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001075', 'rep',   'sales_professional', 'Rita Rep', 'rita@assign.example', 'rmboss.rita'::ltree, 'a0750000-0000-0000-0000-000000000001'),
  ('a0750000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001075', 'rep',   'sales_professional', 'Rob Rep',  'rob@assign.example',  'rmboss.rob'::ltree,  'a0750000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a075a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001075', 'a0750000-0000-0000-0000-000000000002', 'a0750000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@assign.example');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone, assigned_user_id, submitted_at) values
  ('a075f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001075', 'a075a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Assign Co', 'Hal', '5550750001',
   'a0750000-0000-0000-0000-000000000002', now());

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at
) values
  ('a075e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001075', 'user', 'a0750000-0000-0000-0000-000000000002', 'Form Assign Co', 'Cy', 'c@x.example', '5550750021', 'n', 0, now());

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function _t_assigned(p_user uuid, p_company text) returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox
   where kind = 'internal_assigned' and recipient_user_id = p_user and payload->'companyNames' ->> 0 = p_company;
  return n;
end $$;

-- 1. Reassigning a referral to another rep queues one internal_assigned row.
do $$ declare o record; n integer; begin
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_referral('a075f000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox where kind = 'internal_assigned';
  if n <> 1 then raise exception 'reassign_referral should queue exactly one row, got %', n; end if;
  select * into o from portal_email_outbox where kind = 'internal_assigned';
  if o.recipient_user_id <> 'a0750000-0000-0000-0000-000000000003' or o.org_id <> '00000000-0000-0000-0000-000000001075'
     or o.portal_user_id is not null or o.referral_id is not null then
    raise exception 'wrong recipient or columns: %', row_to_json(o);
  end if;
  if o.payload <> jsonb_build_object('appUrlPath', '/partners', 'companyNames', jsonb_build_array('Assign Co'), 'count', 1) then
    raise exception 'wrong payload: %', o.payload;
  end if;
  if o.dedupe_key !~ '^internal_assigned:a075f000-0000-0000-0000-000000000001:a0750000-0000-0000-0000-000000000003:[0-9]+$' then
    raise exception 'wrong dedupe key: %', o.dedupe_key;
  end if;
end $$;

-- 2. No change (already rob) queues nothing more.
do $$ begin
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_referral('a075f000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  if _t_assigned('a0750000-0000-0000-0000-000000000003', 'Assign Co') <> 1 then
    raise exception 'an unchanged assignee should not queue another row';
  end if;
end $$;

-- 2b. Reassigning to the current assignee is a no-op: no history row, nudge clock untouched.
do $$ declare h int; f timestamptz; begin
  perform set_config('role', 'postgres', true);
  select count(*) into h from referral_status_history where referral_id = 'a075f000-0000-0000-0000-000000000001';
  update referrals set nudge_from_at = '2026-01-01 00:00+00' where id = 'a075f000-0000-0000-0000-000000000001';
  f := '2026-01-01 00:00+00';
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_referral('a075f000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  if (select count(*) from referral_status_history where referral_id = 'a075f000-0000-0000-0000-000000000001') <> h then
    raise exception 'same-assignee reassign must not write a history row';
  end if;
  if (select nudge_from_at from referrals where id = 'a075f000-0000-0000-0000-000000000001') is distinct from f then
    raise exception 'same-assignee reassign must not restart the nudge clock';
  end if;
end $$;

-- 3. The caller assigning to themselves queues nothing.
do $$ begin
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_referral('a075f000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000001');
  if _t_assigned('a0750000-0000-0000-0000-000000000001', 'Assign Co') <> 0 then
    raise exception 'assigning to the caller should not queue a row';
  end if;
end $$;

-- 4. The earlier behaviour is kept: history row and nudge restart.
do $$ declare r referrals; begin
  perform set_config('role', 'postgres', true);
  select * into r from referrals where id = 'a075f000-0000-0000-0000-000000000001';
  if r.assigned_user_id <> 'a0750000-0000-0000-0000-000000000001' or r.nudge_from_at is null or r.nudge_from_at < now() - interval '1 minute' then
    raise exception 'reassign lost its earlier behaviour: %', row_to_json(r);
  end if;
  if not exists (select 1 from referral_status_history
                  where referral_id = r.id and note = 'Reassigned to Boss') then
    raise exception 'reassign should keep its history row';
  end if;
end $$;

-- 5. Reassigning a form submission to another rep queues one row.
do $$ declare o record; n integer; begin
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_form_submission('a075e000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox
   where kind = 'internal_assigned' and payload->'companyNames' ->> 0 = 'Form Assign Co';
  if n <> 1 then raise exception 'reassign_form_submission should queue exactly one row, got %', n; end if;
  select * into o from portal_email_outbox where kind = 'internal_assigned' and payload->'companyNames' ->> 0 = 'Form Assign Co';
  if o.recipient_user_id <> 'a0750000-0000-0000-0000-000000000003'
     or o.payload <> jsonb_build_object('appUrlPath', '/partners', 'companyNames', jsonb_build_array('Form Assign Co'), 'count', 1)
     or o.dedupe_key !~ '^internal_assigned:a075e000-0000-0000-0000-000000000001:a0750000-0000-0000-0000-000000000003:[0-9]+$' then
    raise exception 'wrong submission row: %', row_to_json(o);
  end if;
end $$;

-- 5b. Submission reassigned to its current assignee: nudge clock untouched.
do $$ begin
  perform set_config('role', 'postgres', true);
  update referral_form_submissions set nudge_from_at = '2026-01-01 00:00+00' where id = 'a075e000-0000-0000-0000-000000000001';
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_form_submission('a075e000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  if (select nudge_from_at from referral_form_submissions where id = 'a075e000-0000-0000-0000-000000000001') is distinct from '2026-01-01 00:00+00'::timestamptz then
    raise exception 'same-assignee reassign of a submission must not restart the nudge clock';
  end if;
end $$;

-- 6. Submission: no change and self-assign queue nothing.
do $$ begin
  perform _t_act('a0750000-0000-0000-0000-000000000001');
  perform public.reassign_form_submission('a075e000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000003');
  perform public.reassign_form_submission('a075e000-0000-0000-0000-000000000001', 'a0750000-0000-0000-0000-000000000001');
  if _t_assigned('a0750000-0000-0000-0000-000000000003', 'Form Assign Co') <> 1
     or _t_assigned('a0750000-0000-0000-0000-000000000001', 'Form Assign Co') <> 0 then
    raise exception 'unchanged or self assignment of a submission should queue nothing';
  end if;
end $$;

-- 7. The kind is accepted by the outbox check.
do $$ begin
  perform set_config('role', 'postgres', true);
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001075', 'internal_assigned', 'a0750000-0000-0000-0000-000000000002',
          '{"appUrlPath":"/partners","companyNames":["X"],"count":1}', 't75:direct');
end $$;

rollback;
