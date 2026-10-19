-- Tests for 20261020000004_form_submission_purge (Partner Portal Phase 2B-2, FR-PORT-93, 94).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/062_form_submission_purge.sql
-- Self-cleans via ROLLBACK. Runs as postgres (the cron job's role).
--
-- Org pf-prg keeps 90 days, org pf-prg-b keeps 30. Submissions (org A unless noted):
--   P1 declined 100 days ago        -> erased
--   P2 declined 40 days ago         -> kept
--   P3 untriaged, sent 91 days ago  -> erased
--   P4 untriaged, sent 80 days ago  -> kept
--   P5 attributed 200 days ago      -> untouched (already thin)
--   P6 org B, declined 31 days ago  -> erased
--   P7 already purged 5 days ago    -> untouched
-- Boundary rows (org A), judged by a run at T = now() + 1 day:
--   Q1 declined exactly 90 days before T          -> erased
--   Q2 untriaged, sent exactly 90 days before T   -> erased
--   Q3 declined 90 days less a minute before T    -> kept
--   Q4 untriaged, 90 days less a minute before T  -> kept

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001062', 'Purge Org',   'pf-prg',   'pf-prg-a1',   true),
  ('00000000-0000-0000-0000-000000001162', 'Purge Org B', 'pf-prg-b', 'pf-prg-b-a1', true);
update organizations set declined_retention_days = 30 where id = '00000000-0000-0000-0000-000000001162';

insert into referral_form_submissions (
  id, org_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
  referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip,
  submitted_at, triaged_at, outcome, decline_reason, decline_note, purged_at
) values
  ('a062e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001062', 'tenant', 'Old Decline', 'Ann', 'a@x.example', '5550620001', 'n1', 'Jane', 'j@x.example', 1, 'I may share this.', '198.51.100.62', now() - interval '101 days', now() - interval '100 days', 'declined',   'outside_icp', 'Owner was rude', null),
  ('a062e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001062', 'tenant', 'New Decline', 'Bo',  'b@x.example', '5550620002', 'n2', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '41 days',  now() - interval '40 days',  'declined',   'duplicate',   null,             null),
  ('a062e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001062', 'tenant', 'Stale Co',    'Cy',  'c@x.example', '5550620003', 'n3', 'Jo',   'jo@x.example', 1, 'I may share this.', '198.51.100.62', now() - interval '91 days',  null,                        null,         null,          null,             null),
  ('a062e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001062', 'tenant', 'Fresh Co',    'Di',  'd@x.example', '5550620004', 'n4', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '80 days',  null,                        null,         null,          null,             null),
  ('a062e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001062', 'tenant', 'Thin Co',     null,  null,          null,         null, null,   null,          1, 'I may share this.', null,            now() - interval '201 days', now() - interval '200 days', 'attributed', null,          null,             null),
  ('a062e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001162', 'tenant', 'B Decline',   'Ed',  'e@x.example', '5550620006', 'n6', null,   null,          1, 'I may share this.', '198.51.100.62', now() - interval '32 days',  now() - interval '31 days',  'declined',   'outside_footprint', null,       null),
  ('a062e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001062', 'tenant', 'Done Co',     null,  null,          null,         null, null,   null,          1, null,                null,            now() - interval '120 days', null,                        null,         null,          null,             now() - interval '5 days'),
  ('a062e000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001062', 'tenant', 'Line Decline', 'Fy', 'f@x.example', '5550620011', 'n', null,   null,          1, 'I may share this.', '198.51.100.62', now() + interval '1 day' - interval '95 days', now() + interval '1 day' - interval '90 days', 'declined', 'duplicate', null, null),
  ('a062e000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001062', 'tenant', 'Line Stale',   'Gi', 'g@x.example', '5550620012', 'n', null,   null,          1, 'I may share this.', '198.51.100.62', now() + interval '1 day' - interval '90 days', null, null, null, null, null),
  ('a062e000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000001062', 'tenant', 'Near Decline', 'Ho', 'h@x.example', '5550620013', 'n', null,   null,          1, 'I may share this.', '198.51.100.62', now() + interval '1 day' - interval '95 days', now() + interval '1 day' - interval '90 days' + interval '1 minute', 'declined', 'duplicate', null, null),
  ('a062e000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000001062', 'tenant', 'Near Stale',   'Iv', 'i@x.example', '5550620014', 'n', null,   null,          1, 'I may share this.', '198.51.100.62', now() + interval '1 day' - interval '90 days' + interval '1 minute', null, null, null, null, null);

-- 1. Privileges, column and schedule.
do $$ declare j record; begin
  if not has_function_privilege('service_role', 'public.purge_form_submissions(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_form_submissions(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_form_submissions(timestamptz)', 'EXECUTE') then
    raise exception 'purge_form_submissions is service role only';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'portal_audit_log' and column_name = 'submission_id') then
    raise exception 'portal_audit_log.submission_id exists';
  end if;
  select schedule, command into j from cron.job where jobname = 'purge-form-submissions';
  if j.schedule is distinct from '20 6 * * *' or position('public.purge_form_submissions(now())' in j.command) = 0 then
    raise exception 'daily job at 06:20 UTC, got %', row_to_json(j);
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-declined-referrals') then
    raise exception 'the referral purge job is untouched';
  end if;
end $$;

-- 2. One run erases exactly the expired ones.
do $$ declare n integer; s referral_form_submissions; begin
  n := public.purge_form_submissions(now());
  if n <> 3 then raise exception 'three erased (P1, P3, P6), got %', n; end if;

  select * into s from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000001';
  if s.contact_name is not null or s.contact_email is not null or s.contact_phone is not null or s.notes is not null
     or s.referred_by_text is not null or s.referrer_email is not null or s.consent_text_snapshot is not null
     or s.submitter_ip is not null or s.decline_note is not null or s.purged_at is distinct from now()
     or s.company_name <> 'Old Decline' or s.decline_reason <> 'outside_icp' or s.outcome <> 'declined' then
    raise exception 'P1 erased but company and reason kept, got %', row_to_json(s);
  end if;
  select * into s from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000003';
  if s.contact_name is not null or s.referrer_email is not null or s.purged_at is null
     or s.triaged_at is not null or s.outcome is not null or s.company_name <> 'Stale Co' then
    raise exception 'P3 expired untriaged and erased, got %', row_to_json(s);
  end if;
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000006') is null then
    raise exception 'P6 uses its own org''s 30 days';
  end if;
  if (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000002') <> 'Bo'
     or (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000004') <> 'Di'
     or (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000005') is not null
     or (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000007') > now() - interval '4 days' then
    raise exception 'P2, P4, P5 and P7 are untouched';
  end if;

  if (select string_agg(submission_id::text, ',' order by submission_id) from portal_audit_log
       where action = 'purge' and submission_id is not null and ip is null)
     <> 'a062e000-0000-0000-0000-000000000001,a062e000-0000-0000-0000-000000000003,a062e000-0000-0000-0000-000000000006' then
    raise exception 'one purge audit row per erased submission, no IP';
  end if;
  if (select org_id from portal_audit_log where submission_id = 'a062e000-0000-0000-0000-000000000006')
     <> '00000000-0000-0000-0000-000000001162' then
    raise exception 'the audit row carries the submission''s org';
  end if;

  if public.purge_form_submissions(now()) <> 0 then raise exception 'a second run erases nothing'; end if;
end $$;

-- 3. The exact 90-day line: at the line is erased, a minute inside is kept.
do $$ begin
  perform public.purge_form_submissions(now() + interval '1 day');
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000011') is null
     or (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000011') is not null then
    raise exception 'Q1 declined exactly at the line is erased';
  end if;
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000012') is null then
    raise exception 'Q2 untriaged exactly at the line is erased';
  end if;
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000013') is not null
     or (select contact_name from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000013') <> 'Ho' then
    raise exception 'Q3 declined a minute inside the line is kept';
  end if;
  if (select purged_at from referral_form_submissions where id = 'a062e000-0000-0000-0000-000000000014') is not null then
    raise exception 'Q4 untriaged a minute inside the line is kept';
  end if;
end $$;

rollback;
