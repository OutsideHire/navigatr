-- Restart the end-of-day reminder after a reassign or a reinstate (FR-PORT-48, FR-PORT-55).
--
-- A reminder is sent once per item per reviewer, and the window is counted from
-- the item's submit time. A reassigned item therefore never reminded its new
-- owner, and a reinstated referral that was days old had aged out of the window.
-- nudge_from_at is the restart time: reassign_referral, reassign_form_submission
-- and reinstate_referral set it to now(), clear nudged_at and delete the item's
-- rows from the nudge log. enqueue_portal_nudges measures its window from
-- coalesce(nudge_from_at, submitted_at), so the new owner gets a full window
-- from the restart and is reminded at their next end of day.

alter table referrals add column nudge_from_at timestamptz;
alter table referral_form_submissions add column nudge_from_at timestamptz;

-- 1. The digest ----------------------------------------------------------------------------
-- Identical to 20261020000003 except the window reads coalesce(nudge_from_at, submitted_at).
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
      select 'referral'::text as item, r.id, r.org_id, r.company_name, r.submitted_at, r.assigned_user_id, r.nudged_at,
             coalesce(r.nudge_from_at, r.submitted_at) as window_at
        from referrals r
        join organizations o on o.id = r.org_id
       where r.status = 'submitted' and r.source in ('portal_signed_in', 'portal_public') and r.direction = 'inbound'
         and r.purged_at is null and not o.is_disabled
         -- Seven local days in any time zone lie inside the last eight days.
         and coalesce(r.nudge_from_at, r.submitted_at) > v_now - interval '8 days'
         and coalesce(r.nudge_from_at, r.submitted_at) <= v_now
      union all
      select 'submission'::text, s.id, s.org_id, s.company_name, s.submitted_at, s.assigned_user_id, s.nudged_at,
             coalesce(s.nudge_from_at, s.submitted_at)
        from referral_form_submissions s
        join organizations o on o.id = s.org_id
       where s.triaged_at is null and s.purged_at is null and not o.is_disabled
         and coalesce(s.nudge_from_at, s.submitted_at) > v_now - interval '8 days'
         and coalesce(s.nudge_from_at, s.submitted_at) <= v_now
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
       where (z.window_at at time zone z.tz)::date >= (v_now at time zone z.tz)::date - 6
         -- Received before today's end of day: anything that arrived after
         -- yesterday's end of day rides in today's digest.
         and z.window_at < ((v_now at time zone z.tz)::date + make_time(z.eod / 60, z.eod % 60, 0)) at time zone z.tz
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


-- 2. reassign_referral ----------------------------------------------------------------------
-- Identical to 20261029000001 (history row kept) plus the reminder restart.
create or replace function public.reassign_referral(p_referral_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r       referrals := public._referral_for_update(p_referral_id);
  v_owner uuid;
  v_name  text;
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles
                 where id = p_user_id and org_id = r.org_id and deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referrals
     set assigned_user_id = p_user_id,
         nudge_from_at    = now(),
         nudged_at        = null
   where id = r.id;
  delete from referral_nudges where referral_id = r.id;
  select full_name into v_name from profiles where id = p_user_id;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (r.org_id, r.id, r.status, r.status, 'user', auth.uid(), 'Reassigned to ' || coalesce(v_name, 'a teammate'));
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

-- 3. reassign_form_submission -----------------------------------------------------------------
-- Identical to 20261020000002 plus the reminder restart.
create or replace function public.reassign_form_submission(p_submission_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions := public._form_submission_for_update(p_submission_id);
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles p
                  where p.id = p_user_id and p.org_id = s.org_id and p.deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referral_form_submissions x
     set assigned_user_id = p_user_id,
         nudge_from_at    = now(),
         nudged_at        = null
   where x.id = s.id;
  delete from form_submission_nudges where submission_id = s.id;
end $$;

-- 4. reinstate_referral -------------------------------------------------------------------------
-- Identical to 20261016000005 plus the reminder restart. The submission log is
-- cleared too: an attributed referral is held back when its submission already
-- reached the same person.
create or replace function public.reinstate_referral(p_referral_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r     referrals := public._referral_for_update(p_referral_id);
  v_ref text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_reinstatable(r.id) then
    raise exception 'referral_not_reinstatable' using errcode = '22023';
  end if;
  v_ref := public._portal_referral_ref(r.duplicate_of_referral_id);
  perform public._referral_set_note('Reinstated: earlier referral ' || v_ref || ' is closed');
  -- The earlier referral no longer holds credit, so this one is no longer a
  -- probable duplicate of it (referral or deal); accepting it needs no
  -- override reason.
  update referrals
     set status                   = 'submitted',
         decline_reason           = null,
         decline_note             = null,
         triaged_by               = null,
         triaged_at               = null,
         nudged_at                = null,
         nudge_from_at            = now(),
         duplicate_of_referral_id = null,
         duplicate_of_deal_id     = null
   where id = r.id;
  delete from referral_nudges where referral_id = r.id;
  delete from form_submission_nudges
   where submission_id in (select fs.id from referral_form_submissions fs where fs.referral_id = r.id);
  perform public._referral_set_note('');
end $$;

revoke execute on function public.enqueue_portal_nudges(timestamptz)          from public, anon, authenticated;
grant  execute on function public.enqueue_portal_nudges(timestamptz)          to service_role;
revoke execute on function public.reassign_referral(uuid, uuid)               from public, anon;
grant  execute on function public.reassign_referral(uuid, uuid)               to authenticated;
revoke execute on function public.reassign_form_submission(uuid, uuid)        from public, anon;
grant  execute on function public.reassign_form_submission(uuid, uuid)        to authenticated;
revoke execute on function public.reinstate_referral(uuid)                    from public, anon;
grant  execute on function public.reinstate_referral(uuid)                    to authenticated;
