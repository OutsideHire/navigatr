-- Warn administrators 15 days before untriaged form submissions are erased (FR-PORT-93, Q19).
--
-- purge_form_submissions erases an untriaged submission once it is
-- declined_retention_days old (default 90). Fifteen days earlier, every active
-- administrator of the org gets one internal_purge_warning email per local day
-- listing what is due, and the covered submissions are stamped purge_warned_at
-- so each is warned once. The portal_notify drain calls the enqueue on every run.
-- Payload keeps the internal three keys: {appUrlPath, companyNames, count}.

-- 1. Column -----------------------------------------------------------------------
-- Not granted to authenticated: the table has no app grants at all (20261018000003).
alter table referral_form_submissions add column purge_warned_at timestamptz;

create index if not exists referral_form_submissions_purge_warning_candidates_idx
  on referral_form_submissions (org_id, submitted_at)
  where triaged_at is null and purged_at is null and purge_warned_at is null;

-- 2. Outbox kind ------------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission',
  'partner_referral_sent','partner_digest','internal_partner_note',
  'internal_assigned',
  'internal_purge_warning'));

-- 3. The warning ------------------------------------------------------------------
create or replace function public.enqueue_form_submission_purge_warnings(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_count integer := 0;
  v_id    uuid;
  v_orgs  uuid[] := '{}';
  rec     record;
begin
  -- One selection at a time: two overlapping drains must not both warn.
  perform pg_advisory_xact_lock(hashtextextended('form_submission_purge_warnings', 0));

  for rec in
    with due as (
      select s.id, s.org_id, s.company_name, s.submitted_at
        from referral_form_submissions s
        join organizations o on o.id = s.org_id
       where s.triaged_at is null and s.purged_at is null and s.purge_warned_at is null
         and not o.is_disabled
         and s.submitted_at <= v_now - make_interval(days => o.declined_retention_days - 15)
         -- Already past the line: the next purge run erases it, so "in 15 days" would be untrue.
         and s.submitted_at > v_now - make_interval(days => o.declined_retention_days)
    ),
    per_org as (
      select d.org_id,
             array_agg(d.id order by d.submitted_at, d.id) as submission_ids,
             -- The email lists at most 20 names (oldest first); count stays the true total.
             to_jsonb((array_agg(d.company_name order by d.submitted_at, d.id))[1:20]) as company_names,
             count(*)::integer as total_count
        from due d
       group by d.org_id
    )
    select po.*,
           p.id as user_id,
           (v_now at time zone public._portal_local_tz(pp.timezone))::date as local_day
      from per_org po
      join profiles p on p.org_id = po.org_id and p.role_level = 'administrator' and p.deactivated_at is null
      left join path_preferences pp on pp.user_id = p.id
  loop
    v_id := null;
    insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
    values (rec.org_id, 'internal_purge_warning', rec.user_id,
            jsonb_build_object('appUrlPath', '/partners',
                               'companyNames', rec.company_names,
                               'count', rec.total_count),
            'internal_purge_warning:' || rec.user_id::text || ':' || rec.local_day::text)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    -- Only a warning that was really queued covers its submissions. If today's
    -- warning already went out they stay unwarned and ride tomorrow's.
    if v_id is not null then
      v_count := v_count + 1;
      update referral_form_submissions set purge_warned_at = v_now
       where id = any(rec.submission_ids) and purge_warned_at is null;
    end if;
  end loop;

  return v_count;
end $$;

revoke execute on function public.enqueue_form_submission_purge_warnings(timestamptz) from public, anon, authenticated;
grant  execute on function public.enqueue_form_submission_purge_warnings(timestamptz) to service_role;
