-- 20261014000004_portal_nudges.sql
--
-- Partner Portal Phase 1C (spec 5.9, rulings R4 and R5): the same-day nudge.
-- Once a reviewer's local time passes their end of day, they get ONE digest of
-- the partner referrals received that day (before end of day) that are still
-- waiting. Assigned referrals nudge their assignee; administrator-queue items
-- (and items whose assignee was deactivated) nudge every active administrator,
-- each in their own time zone. No reassignment, no escalation.
--
-- Time zone: path_preferences.timezone, default America/New_York (also for a
-- stored value Postgres does not know). End of day: path_preferences.
-- end_of_day_minutes, default 1080 (18:00), the same default the app uses
-- (DEFAULT_END_OF_DAY_MINUTES in apps/app/src/features/path/lib/pathCapacityDefaults.ts).
--
-- referral_nudges remembers who was nudged about what, because an
-- administrator-queue item nudges several people at different times.
-- referrals.nudged_at keeps the first nudge, and an assigned referral is only
-- nudged while it is null, so each referral is nudged once per reviewer role.
--
-- portal_notify calls enqueue_portal_nudges(now()) every 2 minutes. p_now is a
-- parameter so 048 can test it with fixed clocks.

create table referral_nudges (
  referral_id uuid not null references referrals(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  nudged_at   timestamptz not null default now(),
  primary key (referral_id, user_id)
);
alter table referral_nudges enable row level security;
revoke all on referral_nudges from anon;
revoke all on referral_nudges from authenticated;

create index if not exists referrals_nudge_candidates_idx
  on referrals (submitted_at)
  where status = 'submitted' and source = 'portal_signed_in';

create or replace function public._portal_local_tz(p_tz text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select n.name from pg_timezone_names n where n.name = p_tz), 'America/New_York')
$$;

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
      select r.id, r.org_id, r.company_name, r.submitted_at, r.assigned_user_id, r.nudged_at
        from referrals r
        join organizations o on o.id = r.org_id
       where r.status = 'submitted' and r.source = 'portal_signed_in' and r.direction = 'inbound'
         and r.purged_at is null and not o.is_disabled
         -- Seven local days in any time zone lie inside the last eight days.
         and r.submitted_at > v_now - interval '8 days' and r.submitted_at <= v_now
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
         -- An assigned referral nudges its assignee once; queue items are gated by the log.
         and (z.user_id is distinct from z.assigned_user_id or z.nudged_at is null)
         and not exists (select 1 from referral_nudges n where n.referral_id = z.id and n.user_id = z.user_id)
    )
    select d.org_id,
           d.user_id,
           (v_now at time zone d.tz)::date as local_day,
           array_agg(d.id order by d.submitted_at, d.id) as referral_ids,
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
    -- Only a digest that was really queued consumes its referrals. If today's
    -- digest already exists they stay un-nudged and ride the next day's digest.
    if v_id is not null then
      v_count := v_count + 1;

      insert into referral_nudges (referral_id, user_id, nudged_at)
      select unnest(rec.referral_ids), rec.user_id, v_now
      on conflict (referral_id, user_id) do nothing;

      update referrals set nudged_at = v_now
       where id = any(rec.referral_ids) and nudged_at is null;
    end if;
  end loop;

  return v_count;
end $$;

revoke execute on function public._portal_local_tz(text)                from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_nudges(timestamptz)    from public, anon, authenticated;
grant  execute on function public.enqueue_portal_nudges(timestamptz)    to service_role;
