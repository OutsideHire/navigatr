-- 20261020000003_form_submission_notify.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-80, spec 5.9 rulings R4 and R5).
--   1. A new form submission emails its reviewer (the assignee while active,
--      else every active administrator) through the 1C outbox, kind
--      internal_new_submission. Same payload allowlist as internal_new_referral.
--   2. The end-of-day digest covers untriaged, unpurged form submissions too.
--      Still ONE internal_nudge per person per local day: partner referrals and
--      submissions are listed together, oldest first. form_submission_nudges
--      mirrors referral_nudges so each submission nudges each reviewer once.
--      The referral arm also covers portal_public referrals (a submission
--      attributed to a partner but not finished). Its submission is triaged,
--      so it is never counted twice, and a business already nudged to someone
--      as a submission is not nudged to them again as its referral.

-- 1. Outbox kind ------------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission'));

create or replace function public.referral_form_submissions_enqueue_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Never blocks the public insert; the warning names the trigger and error only.
  begin
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    select new.org_id, 'internal_new_submission', rcp.user_id,
           jsonb_build_object('appUrlPath', '/partners',
                              'companyNames', jsonb_build_array(new.company_name),
                              'count', 1),
           'internal_new_submission:' || new.id::text || ':' || rcp.user_id::text
      from public._portal_review_recipients(new.org_id, new.assigned_user_id) rcp
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referral_form_submissions_enqueue_email
  after insert on referral_form_submissions
  for each row execute function public.referral_form_submissions_enqueue_email();

-- 2. Nudge log ----------------------------------------------------------------------
create table form_submission_nudges (
  submission_id uuid not null references referral_form_submissions(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  nudged_at     timestamptz not null default now(),
  primary key (submission_id, user_id)
);
alter table form_submission_nudges enable row level security;
revoke all on form_submission_nudges from anon;
revoke all on form_submission_nudges from authenticated;

create index if not exists referral_form_submissions_nudge_candidates_idx
  on referral_form_submissions (submitted_at)
  where triaged_at is null and purged_at is null;

-- The digest looks up an attributed referral's submission by referral_id.
create index if not exists referral_form_submissions_referral_id_idx
  on referral_form_submissions (referral_id)
  where referral_id is not null;

-- 3. The digest, now over both sources --------------------------------------------------
-- Identical to 20261014000004 except: the referral arm also takes source
-- portal_public, cand unions in submissions (item tells them apart), the
-- per-item log check reads the matching table (and, for a portal_public
-- referral, its submission's log), and the queued digest marks both logs.
create or replace function public.enqueue_portal_nudges(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_count integer := 0;
  v_id    uuid;
  rec     record;
begin
  -- One selection at a time: two overlapping drains must not both build a digest.
  perform pg_advisory_xact_lock(hashtextextended('portal_nudges', 0));

  for rec in
    with cand as (
      select 'referral'::text as item, r.id, r.org_id, r.company_name, r.submitted_at, r.assigned_user_id, r.nudged_at
        from referrals r
        join organizations o on o.id = r.org_id
       where r.status = 'submitted' and r.source in ('portal_signed_in', 'portal_public') and r.direction = 'inbound'
         and r.purged_at is null and not o.is_disabled
         -- Seven local days in any time zone lie inside the last eight days.
         and r.submitted_at > v_now - interval '8 days' and r.submitted_at <= v_now
      union all
      select 'submission'::text, s.id, s.org_id, s.company_name, s.submitted_at, s.assigned_user_id, s.nudged_at
        from referral_form_submissions s
        join organizations o on o.id = s.org_id
       where s.triaged_at is null and s.purged_at is null and not o.is_disabled
         and s.submitted_at > v_now - interval '8 days' and s.submitted_at <= v_now
    ),
    pairs as (
      select c.*, rcp.user_id
        from cand c
        cross join lateral public._portal_review_recipients(c.org_id, c.assigned_user_id) rcp
    ),
    zoned as (
      select pr.*,
             public._portal_local_tz(pp.timezone) as tz,
             least(greatest(coalesce(pp.end_of_day_minutes, 1080), 1), 1439) as eod
        from pairs pr
        left join path_preferences pp on pp.user_id = pr.user_id
    ),
    due as (
      select z.*
        from zoned z
       where (z.submitted_at at time zone z.tz)::date >= (v_now at time zone z.tz)::date - 6
         -- Received before today's end of day: anything that arrived after
         -- yesterday's end of day rides in today's digest.
         and z.submitted_at < ((v_now at time zone z.tz)::date + make_time(z.eod / 60, z.eod % 60, 0)) at time zone z.tz
         and (v_now at time zone z.tz)::time >= make_time(z.eod / 60, z.eod % 60, 0)
         -- An assigned item nudges its assignee once; queue items are gated by the logs.
         and (z.user_id is distinct from z.assigned_user_id or z.nudged_at is null)
         and not exists (select 1 from referral_nudges n
                          where z.item = 'referral' and n.referral_id = z.id and n.user_id = z.user_id)
         and not exists (select 1 from form_submission_nudges n
                          where z.item = 'submission' and n.submission_id = z.id and n.user_id = z.user_id)
         -- An attributed referral whose submission already reached this person.
         and not exists (select 1 from referral_form_submissions fs
                           join form_submission_nudges n on n.submission_id = fs.id
                          where z.item = 'referral' and fs.referral_id = z.id and n.user_id = z.user_id)
    )
    select d.org_id,
           d.user_id,
           (v_now at time zone d.tz)::date as local_day,
           coalesce(array_agg(d.id order by d.submitted_at, d.id) filter (where d.item = 'referral'), '{}'::uuid[]) as referral_ids,
           coalesce(array_agg(d.id order by d.submitted_at, d.id) filter (where d.item = 'submission'), '{}'::uuid[]) as submission_ids,
           -- The email lists at most 20 names (oldest first); count stays the true total.
           to_jsonb((array_agg(d.company_name order by d.submitted_at, d.id))[1:20]) as company_names,
           count(*)::integer as total_count
      from due d
     group by d.org_id, d.user_id, d.tz
  loop
    v_id := null;
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    values (rec.org_id, 'internal_nudge', rec.user_id,
            jsonb_build_object('appUrlPath', '/partners',
                               'companyNames', rec.company_names,
                               'count', rec.total_count),
            'internal_nudge:' || rec.user_id::text || ':' || rec.local_day::text)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    -- Only a digest that was really queued consumes its items. If today's
    -- digest already exists they stay un-nudged and ride the next day's digest.
    if v_id is not null then
      v_count := v_count + 1;

      insert into referral_nudges (referral_id, user_id, nudged_at)
      select unnest(rec.referral_ids), rec.user_id, v_now
      on conflict (referral_id, user_id) do nothing;
      update referrals set nudged_at = v_now
       where id = any(rec.referral_ids) and nudged_at is null;

      insert into form_submission_nudges (submission_id, user_id, nudged_at)
      select unnest(rec.submission_ids), rec.user_id, v_now
      on conflict (submission_id, user_id) do nothing;
      update referral_form_submissions set nudged_at = v_now
       where id = any(rec.submission_ids) and nudged_at is null;
    end if;
  end loop;

  return v_count;
end $$;

revoke execute on function public.referral_form_submissions_enqueue_email() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_nudges(timestamptz)        from public, anon, authenticated;
grant  execute on function public.enqueue_portal_nudges(timestamptz)        to service_role;
