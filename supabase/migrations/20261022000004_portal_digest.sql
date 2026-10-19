-- 20261022000004_portal_digest.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-83, 84, 85, NFR-PORT-06).
--
-- 1. Weekly summary. portal_notify calls enqueue_portal_digests(now()) every
--    2 minutes, next to enqueue_portal_nudges. For each ACTIVE portal user
--    whose digest preference is on (notification_prefs.digest, missing means
--    on, the Profile page toggle from 2A), once per ISO week, at or after Monday
--    08:00 in the partner OWNER's time zone (path_preferences.timezone through
--    _portal_local_tz, default America/New_York): one email about the previous
--    Monday to Monday. Inbound referrals by partner label (new, Accepted, In
--    Progress, Closed Won, Not Moving Forward) and referrals sent to the
--    partner (only shared ones, Ryan ruling Q1, and not removed links, Q3).
--    Closed Won value only while the ISO shows values (FR-PORT-85).
--    Nothing for a quiet week. portal_users.digest_week remembers the week
--    already evaluated, so a quiet partner is not re-scanned every 2 minutes.
-- 2. Unsubscribe (FR-PORT-84): a per-user token, issued at the first digest,
--    stored as issued (it goes into every digest and can only turn this one
--    email off). portal_unsubscribe_digest answers nothing either way.
-- 3. The claim re-checks the preference at send time, so an opt-out between
--    queueing and sending wins.
-- 4. Export audit (NFR-PORT-06): portal_api records each CSV download.

-- 1. Columns ------------------------------------------------------------------------------
alter table portal_users
  add column if not exists digest_unsubscribe_token text,
  add column if not exists digest_week text;
create unique index if not exists portal_users_digest_token_uidx
  on portal_users (digest_unsubscribe_token) where digest_unsubscribe_token is not null;

-- 2. Helpers ----------------------------------------------------------------------------------
create or replace function public._portal_digest_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

-- Same reading as portal_get_profile: only a JSON false turns it off.
create or replace function public._portal_digest_wants(p_prefs jsonb)
returns boolean language sql immutable security definer set search_path = public, extensions as $$
  select case when jsonb_typeof(p_prefs -> 'digest') = 'boolean' then (p_prefs ->> 'digest')::boolean else true end
$$;

-- Everything that happened to a partner's referrals in [p_from, p_to).
-- rank breaks a same-instant tie toward the later step (accepted then working on a merge).
create or replace function public._portal_digest_events(p_org uuid, p_partner uuid, p_from timestamptz, p_to timestamptz)
returns table (referral_id uuid, company_name text, at timestamptz, kind text, rank integer, label text)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, r.company_name, r.submitted_at, 'submitted'::text, 0, 'Received'::text
    from referrals r
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'inbound'
     and r.submitted_at >= p_from and r.submitted_at < p_to
  union all
  select r.id, r.company_name, h.created_at,
         case h.to_status when 'accepted' then 'accepted'
                          when 'working'  then 'in_progress'
                          when 'won'      then 'closed_won'
                          else 'not_moving_forward' end,
         case h.to_status when 'accepted' then 1 when 'working' then 2 else 3 end,
         public._portal_status_label(h.to_status)
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'inbound'
     and h.to_status in ('accepted','working','won','lost','declined')
     and h.created_at >= p_from and h.created_at < p_to
  union all
  select r.id, r.company_name, r.shared_with_partner_at, 'sent_to_you'::text, 0, 'Sent to you'::text
    from referrals r
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'outbound'
     and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
     and r.shared_with_partner_at >= p_from and r.shared_with_partner_at < p_to
$$;

-- 3. The weekly summary ------------------------------------------------------------------------
create or replace function public.enqueue_portal_digests(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now   timestamptz := coalesce(p_now, now());
  v_count integer := 0;
  v_token text;
  v_value bigint;
  v_items jsonb;
  v_id    uuid;
  rec     record;
  c       record;
begin
  -- One selection at a time: two overlapping drains must not both build a digest.
  perform pg_advisory_xact_lock(hashtextextended('portal_digests', 0));

  for rec in
    with base as (
      select u.id as portal_user_id, u.org_id, u.partner_id, u.digest_unsubscribe_token, u.digest_week,
             o.slug, o.name as org_name, o.partner_value_visibility, p.name as partner_name,
             public._portal_local_tz(pp.timezone) as tz
        from portal_users u
        join organizations o on o.id = u.org_id
        join partners p on p.id = u.partner_id and p.org_id = u.org_id
        left join path_preferences pp on pp.user_id = p.owner_id
       where u.status = 'active' and o.portal_enabled and not o.is_disabled
         and public._portal_digest_wants(u.notification_prefs)
    ),
    weeks as (
      select b.*, date_trunc('week', v_now at time zone b.tz)::date as week_start
        from base b
    )
    select w.*,
           to_char(w.week_start, 'IYYY-IW') as iso_week,
           ((w.week_start - 7)::timestamp at time zone w.tz) as period_start,
           (w.week_start::timestamp at time zone w.tz) as period_end
      from weeks w
     where (v_now at time zone w.tz) >= w.week_start + time '08:00'
       and w.digest_week is distinct from to_char(w.week_start, 'IYYY-IW')
     order by w.portal_user_id
  loop
    -- Evaluated for this week whether or not anything is sent.
    update portal_users set digest_week = rec.iso_week where id = rec.portal_user_id;

    select count(distinct e.referral_id) filter (where e.kind = 'submitted')          as submitted,
           count(distinct e.referral_id) filter (where e.kind = 'accepted')           as accepted,
           count(distinct e.referral_id) filter (where e.kind = 'in_progress')        as in_progress,
           count(distinct e.referral_id) filter (where e.kind = 'closed_won')         as closed_won,
           count(distinct e.referral_id) filter (where e.kind = 'not_moving_forward') as not_moving_forward,
           count(distinct e.referral_id) filter (where e.kind = 'sent_to_you')        as sent_to_you
      into c
      from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e;

    continue when c.submitted + c.accepted + c.in_progress + c.closed_won
                  + c.not_moving_forward + c.sent_to_you = 0;

    v_value := null;
    if rec.partner_value_visibility and c.closed_won > 0 then
      select coalesce(sum(d.value_cents), 0)::bigint into v_value
        from referrals r
        join deals d on d.id = r.deal_id
       where r.id in (select e.referral_id
                        from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e
                       where e.kind = 'closed_won');
    end if;

    -- Each referral once, at its latest step in the week; newest first; at most 10.
    select coalesce(jsonb_agg(jsonb_build_object('companyName', x.company_name, 'label', x.label)
                              order by x.at desc, x.referral_id), '[]'::jsonb)
      into v_items
      from (
        select y.*
          from (select distinct on (e.referral_id) e.*
                  from public._portal_digest_events(rec.org_id, rec.partner_id, rec.period_start, rec.period_end) e
                 order by e.referral_id, e.at desc, e.rank desc) y
         order by y.at desc, y.referral_id
         limit 10
      ) x;

    v_token := rec.digest_unsubscribe_token;
    if v_token is null then
      v_token := public._portal_digest_token();
      update portal_users set digest_unsubscribe_token = v_token where id = rec.portal_user_id;
    end if;

    v_id := null;
    insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
    values (rec.org_id, 'partner_digest', rec.portal_user_id,
            jsonb_build_object(
              'slug',             rec.slug,
              'orgName',          rec.org_name,
              'partnerName',      rec.partner_name,
              'weekLabel',        to_char(rec.week_start - 7, 'Mon FMDD'),
              'counts',           jsonb_build_object(
                                    'submitted',        c.submitted,
                                    'accepted',         c.accepted,
                                    'inProgress',       c.in_progress,
                                    'closedWon',        c.closed_won,
                                    'notMovingForward', c.not_moving_forward,
                                    'sentToYou',        c.sent_to_you),
              'valueCents',       v_value,
              'items',            v_items,
              'unsubscribeToken', v_token),
            'digest:' || rec.portal_user_id::text || ':' || rec.iso_week)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

-- 4. Unsubscribe (no session) ---------------------------------------------------------------------
-- Silent on every mismatch (unknown slug, disabled org, malformed or unknown
-- token, another org's token). 30 requests per IP per hour; a missing IP has
-- no bucket. Works while the portal is off: the email may still be in an inbox.
create or replace function public.portal_unsubscribe_digest(p_slug text, p_token text, p_ip text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org   uuid;
  v_ip    text := nullif(btrim(coalesce(p_ip, '')), '');
  v_token text := btrim(coalesce(p_token, ''));
  v_user  uuid;
begin
  select o.id into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and not o.is_disabled;
  if v_org is null then
    return;
  end if;

  if v_ip is not null then
    -- Count-then-insert: serialize the per-IP bucket.
    perform pg_advisory_xact_lock(hashtextextended('portal_unsubscribe_ip:' || v_ip, 0));
    if (select count(*) from portal_audit_log a
         where a.action = 'unsubscribe' and a.ip = v_ip
           and a.created_at > now() - interval '1 hour') >= 30 then
      return;
    end if;
  end if;

  if v_token ~ '^[A-Za-z0-9_-]{16,64}$' then
    update portal_users u
       set notification_prefs = u.notification_prefs || '{"digest": false}'::jsonb,
           updated_at         = now()
     where u.org_id = v_org and u.digest_unsubscribe_token = v_token
    returning u.id into v_user;
  end if;

  perform public._portal_audit(v_org, v_user, 'unsubscribe', v_ip, null);
end $$;

-- 5. Export audit -------------------------------------------------------------------------------------
create or replace function public.portal_record_export(p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  perform public._portal_audit_referral(p_org, p_portal_user, 'export', null, p_ip);
end $$;

-- 6. The claim ----------------------------------------------------------------------------------------
-- Identical to 20261016000003 except the portal-user branch: a partner_digest
-- row has no referral and is live only while the digest preference is on.
create or replace function public.claim_portal_emails(p_limit integer)
returns table (
  id uuid, org_id uuid, kind text, referral_id uuid, payload jsonb, recipient text, attempts integer
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
begin
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'stale'
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.created_at < now() - interval '48 hours'
        for update skip locked);

  update portal_email_outbox o
     set failed_at = now()
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.attempts >= 5
        and (s.last_attempt_at is null or s.last_attempt_at < now() - interval '10 minutes')
        for update skip locked);

  return query
  with picked as (
    select o.id
      from portal_email_outbox o
     where o.sent_at is null and o.dropped_at is null and o.failed_at is null
       and o.attempts < 5
       and (o.last_attempt_at is null
            or o.last_attempt_at <= now() - make_interval(mins => 2 * o.attempts))
     order by o.created_at, o.id
     limit v_limit
       for update skip locked
  ),
  resolved as (
    select o.id,
           case when o.portal_user_id is not null then pu.email else pr.email end as email,
           case when o.portal_user_id is not null
                then coalesce(pu.status = 'active' and org.portal_enabled and not org.is_disabled
                              and case when o.kind = 'partner_digest'
                                       then o.referral_id is null
                                            and public._portal_digest_wants(pu.notification_prefs)
                                       else rf.id is not null and rf.org_id = o.org_id
                                            and rf.partner_id = pu.partner_id
                                            and rf.purged_at is null
                                            -- 2B-3: a "sent to you" email goes out only while the
                                            -- referral is still shared and not removed (Ryan Q1, Q3).
                                            and (o.kind <> 'partner_referral_sent'
                                                 or (rf.direction = 'outbound'
                                                     and rf.shared_with_partner_at is not null
                                                     and rf.status <> 'withdrawn'))
                                  end, false)
                else coalesce(pr.deactivated_at is null and pr.org_id = o.org_id
                              and nullif(btrim(pr.email), '') is not null and not org.is_disabled, false)
           end as live
      from portal_email_outbox o
      join picked k on k.id = o.id
      join organizations org on org.id = o.org_id
      left join portal_users pu on pu.id = o.portal_user_id and pu.org_id = o.org_id
      left join profiles pr on pr.id = o.recipient_user_id
      left join referrals rf on rf.id = o.referral_id
  ),
  dropped as (
    update portal_email_outbox o
       set dropped_at = now(), last_error = 'recipient_inactive'
      from resolved r
     where r.id = o.id and not r.live
    returning o.id
  ),
  claimed as (
    update portal_email_outbox o
       set attempts = o.attempts + 1, last_attempt_at = now()
      from resolved r
     where r.id = o.id and r.live
    returning o.id, o.org_id, o.kind, o.referral_id, o.payload, r.email, o.attempts
  )
  select c.id, c.org_id, c.kind, c.referral_id, c.payload, c.email, c.attempts from claimed c;
end $$;

-- Privileges --------------------------------------------------------------------------------------------
revoke execute on function public._portal_digest_token()                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_digest_wants(jsonb)                                     from public, anon, authenticated, service_role;
revoke execute on function public._portal_digest_events(uuid, uuid, timestamptz, timestamptz)     from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_portal_digests(timestamptz)                             from public, anon, authenticated;
revoke execute on function public.portal_unsubscribe_digest(text, text, text)                     from public, anon, authenticated;
revoke execute on function public.portal_record_export(uuid, uuid, uuid, text)                    from public, anon, authenticated;
revoke execute on function public.claim_portal_emails(integer)                                    from public, anon, authenticated;
grant  execute on function public.enqueue_portal_digests(timestamptz)                             to service_role;
grant  execute on function public.portal_unsubscribe_digest(text, text, text)                     to service_role;
grant  execute on function public.portal_record_export(uuid, uuid, uuid, text)                    to service_role;
grant  execute on function public.claim_portal_emails(integer)                                    to service_role;
