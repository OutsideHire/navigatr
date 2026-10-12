-- 20261016000002_referral_purge.sql
--
-- Partner Portal Phase 2A (FR-PORT-91..95, D13, NFR-PORT-09).
--
-- 1. A daily job erases the personal details on referrals that have been
--    Declined or Withdrawn for the org's retention period (default 90 days).
--    The referral itself stays, with its status history, partner, partner
--    company snapshot, decline reason, dates, company name, industry and
--    urgency, so partner lists, counts and conversion rates stay correct.
--    Published updates are deleted (their body cannot be blank, and the text is
--    the personal part); unsent emails are dropped and no stored payload keeps
--    update text. Also erased: the decline note copied into status history (rows
--    kept), the Google place_id, and the IP on audit rows for the referral.
-- 2. portal_purge_user erases a departed partner's portal identity: access is
--    revoked, the email is replaced, IPs and user agents are nulled. Their
--    referrals stay.
--
-- Pure-SQL cron job (same pattern as purge-activity-location-coords in
-- 20260820000007): pg_cron calls the function directly, no edge function.

alter table organizations
  add column if not exists declined_retention_days integer not null default 90
    constraint organizations_declined_retention_days_check
    check (declined_retention_days between 30 and 3650);

create index if not exists referrals_purge_candidates_idx
  on referrals (org_id)
  where purged_at is null and status in ('declined','withdrawn');

-- When did the referral reach this status? The latest history row for it.
create or replace function public._referral_status_since(p_referral uuid, p_status referral_status)
returns timestamptz language sql stable security definer set search_path = public, extensions as $$
  select max(h.created_at)
    from referral_status_history h
   where h.referral_id = p_referral and h.to_status = p_status
$$;

create or replace function public.purge_declined_referrals(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_ids uuid[];
begin
  -- One run at a time.
  perform pg_advisory_xact_lock(hashtextextended('purge_declined_referrals', 0));

  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_ids
    from referrals r
    join organizations o on o.id = r.org_id
   where r.purged_at is null
     and r.status in ('declined','withdrawn')
     and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
         <= v_now - make_interval(days => o.declined_retention_days);

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Status is not in the SET list, so no history row and no status email.
  -- The candidate set was read without row locks, so the UPDATE re-checks the
  -- purge predicate: a referral reinstated (or already purged) since the
  -- SELECT is skipped. Every later statement runs on the rows actually erased.
  with erased as (
    update referrals r
       set contact_name          = null,
           contact_email         = null,
           contact_phone         = null,
           address               = null,
           notes                 = '',
           consent_text_snapshot = null,
           decline_note          = null,
           place_id              = null,
           purged_at             = v_now
      from organizations o
     where r.id = any(v_ids)
       and o.id = r.org_id
       and r.purged_at is null
       and r.status in ('declined','withdrawn')
       and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
           <= v_now - make_interval(days => o.declined_retention_days)
    returning r.id
  )
  select coalesce(array_agg(e.id), '{}'::uuid[]) into v_ids from erased e;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  delete from referral_updates u where u.referral_id = any(v_ids);

  -- Privacy erase of otherwise immutable history: the decline note (copied here
  -- by the status trigger) is personal text. Rows are kept; only note is nulled.
  update referral_status_history h
     set note = null
   where h.referral_id = any(v_ids) and h.note is not null;

  update portal_email_outbox o
     set dropped_at = v_now, last_error = 'purged'
   where o.referral_id = any(v_ids)
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{updateBody}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'updateBody'
     and o.payload->>'updateBody' is not null;

  -- Earlier audit rows for these referrals must not keep a partner IP.
  update portal_audit_log a
     set ip = null
   where a.referral_id = any(v_ids) and a.ip is not null;

  insert into portal_audit_log (org_id, action, referral_id)
  select r.org_id, 'purge'::portal_audit_action, r.id
    from referrals r
   where r.id = any(v_ids);

  return cardinality(v_ids);
end $$;

-- Offboarding (NFR-PORT-09): administrators erase a partner's portal identity.
-- email is NOT NULL and unique per org, so it becomes a per-user placeholder.
-- A later invite (portal_create_invite) sets it back from the partner record.
create or replace function public.portal_purge_user(p_partner_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.user_org_id();
  v_user portal_users;
begin
  if v_org is null or not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_user from portal_users u
   where u.partner_id = p_partner_id and u.org_id = v_org
     for update;
  if v_user.id is null then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;

  update portal_users
     set status             = 'revoked',
         email              = 'purged+' || v_user.id::text || '@invalid',
         terms_ip           = null,
         notification_prefs = '{}'::jsonb,
         updated_at         = now()
   where id = v_user.id;

  update portal_sessions s
     set revoked_at = coalesce(s.revoked_at, now()), ip = null, user_agent = null
   where s.portal_user_id = v_user.id;
  update portal_tokens t
     set revoked_at = coalesce(t.revoked_at, now()), ip = null
   where t.portal_user_id = v_user.id;
  update portal_audit_log a
     set ip = null
   where a.portal_user_id = v_user.id and a.ip is not null;
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'purged'
   where o.portal_user_id = v_user.id
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  perform public._portal_audit(v_org, v_user.id, 'purge', null, auth.uid());
end $$;

revoke execute on function public._referral_status_since(uuid, referral_status) from public, anon, authenticated, service_role;
revoke execute on function public.purge_declined_referrals(timestamptz)         from public, anon, authenticated;
grant  execute on function public.purge_declined_referrals(timestamptz)         to service_role;
revoke execute on function public.portal_purge_user(uuid)                       from public, anon;
grant  execute on function public.portal_purge_user(uuid)                       to authenticated;

-- Daily at 06:15 UTC. Idempotent: re-applying replaces the job.
create extension if not exists pg_cron;

select cron.unschedule('purge-declined-referrals')
where exists (select 1 from cron.job where jobname = 'purge-declined-referrals');

select cron.schedule(
  'purge-declined-referrals',
  '15 6 * * *',
  $$ select public.purge_declined_referrals(now()) $$
);
