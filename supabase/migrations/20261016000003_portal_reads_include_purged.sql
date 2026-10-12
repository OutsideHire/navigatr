-- 20261016000003_portal_reads_include_purged.sql
--
-- Partner Portal Phase 2A (FR-PORT-92): a purged referral still counts in the
-- partner's list, tiles and conversion rate, so partner reads now INCLUDE
-- purged rows. Their personal columns are already null; the detail also says
-- the details were removed. Only duplicate matching and the email claim
-- exclude purged rows. Withdraw keeps its filter (a purged referral is closed),
-- and so does portal_referral_updates (its rows are deleted on purge).
--
-- Also the CSV export rows (FR-PORT-75). Service role only, pinned to the
-- session's (org, partner), like every 1B read.

-- 1. List: purged rows included -------------------------------------------------
create or replace function public.portal_list_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  id uuid, ref text, company_name text, status referral_status,
  submitted_at timestamptz, last_activity_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select r.id,
         public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at)) as last_activity_at
    from referrals r
    left join lateral (
      select max(x.created_at) as last_at
        from referral_status_history x
       where x.referral_id = r.id
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

-- 2. Detail: purged rows included, personal fields never returned for them ------
drop function if exists public.portal_get_referral(uuid, uuid, uuid, uuid, text);

create function public.portal_get_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, address text, industry text, urgency text, notes text,
  status referral_status, source referral_source, submitted_at timestamptz,
  rep_name text, rep_email text, can_withdraw boolean, details_removed boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_found boolean;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select true into v_found
    from referrals r
   where r.id = p_referral and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound';
  if v_found is null then
    return;
  end if;

  if not exists (
    select 1 from portal_audit_log a
     where a.portal_user_id = p_portal_user and a.action = 'view_referral'
       and a.referral_id = p_referral and a.created_at > now() - interval '1 hour'
  ) then
    perform public._portal_audit_referral(p_org, p_portal_user, 'view_referral', p_referral, p_ip);
  end if;

  return query
    select r.id,
           public._portal_referral_ref(r.id),
           r.company_name,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_name end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_email end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.contact_phone end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.address end,
           case when r.source = 'portal_signed_in' then r.industry end,
           case when r.source = 'portal_signed_in' then r.urgency end,
           case when r.source = 'portal_signed_in' and r.purged_at is null then r.notes end,
           r.status,
           r.source,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.status = 'submitted' and r.source = 'portal_signed_in' and r.purged_at is null),
           (r.purged_at is not null)
      from referrals r
      left join profiles pr on pr.id = r.assigned_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

-- 3. History and tiles: purged rows included -------------------------------------
create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
   order by h.created_at, h.to_status, h.id
$$;

create or replace function public.portal_dashboard_stats(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  submitted bigint, active bigint, closed_won bigint, not_moving_forward bigint,
  won_value_cents bigint, value_visible boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select count(r.id),
         count(r.id) filter (where r.status in ('submitted','accepted','working')),
         count(r.id) filter (where r.status = 'won'),
         count(r.id) filter (where r.status in ('lost','declined')),
         coalesce(sum(d.value_cents) filter (where r.status = 'won'), 0)::bigint,
         coalesce((select o.partner_value_visibility from organizations o where o.id = p_org), false)
    from referrals r
    left join deals d on d.id = r.deal_id
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and (p_since is null or r.submitted_at >= p_since)
$$;

-- 4. Duplicate matching: a purged referral never takes credit -------------------
create or replace function public._portal_find_duplicates(
  p_org uuid, p_partner uuid, p_name text, p_phone text, p_address text, p_exclude uuid
)
returns table (dup_referral_id uuid, dup_deal_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  with viewer as (
    select p.owner_id from partners p where p.id = p_partner and p.org_id = p_org
  ),
  k as (
    select public.deal_phone_key(p_phone)            as phone_key,
           public.deal_dedupe_key(p_name, p_address) as na_key,
           public.deal_name_key(p_name)              as name_key
  )
  select
    (select r.id
       from referrals r
       join partners rp on rp.id = r.partner_id
       cross join k
      where r.org_id = p_org
        and r.direction = 'inbound'
        and r.status not in ('declined','withdrawn')
        and r.purged_at is null
        and r.id is distinct from p_exclude
        and (r.partner_id = p_partner
             or public.profile_can_see_owner((select v.owner_id from viewer v), rp.owner_id))
        and (
          (k.phone_key is not null and public.deal_phone_key(r.contact_phone) = k.phone_key)
          or (k.na_key is not null and public.deal_dedupe_key(r.company_name, r.address) = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or public.deal_dedupe_key(r.company_name, r.address) is null)
              and public.deal_name_key(r.company_name) = k.name_key)
        )
      order by r.submitted_at, r.id
      limit 1),
    (select d.id
       from deals d
       cross join k
      where d.org_id = p_org
        and d.stage not in ('won','lost')
        and public.profile_can_see_owner((select v.owner_id from viewer v), d.owner_id)
        and (
          (k.phone_key is not null and public.deal_phone_key(d.contact_phone) = k.phone_key)
          or (k.na_key is not null and d.dedupe_key = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or d.dedupe_key is null)
              and public.deal_name_key(d.company_name) = k.name_key)
        )
      order by d.created_at, d.id
      limit 1)
$$;

-- 5. Email claim: a partner email about a purged referral is never sent --------
-- Identical to 20261014000002 except the one added predicate rf.purged_at is null.
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
                              and rf.id is not null and rf.org_id = o.org_id
                              and rf.partner_id = pu.partner_id
                              and rf.purged_at is null, false)
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

-- 6. CSV export rows (FR-PORT-75) ----------------------------------------------
-- The INTERNAL status comes back; portal_api maps it to a partner label and
-- never passes it through. Value only on won rows while the ISO shows values.
create or replace function public.portal_export_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  ref text, company_name text, status referral_status, submitted_at timestamptz,
  last_activity_at timestamptz, won_value_cents bigint, value_visible boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at)),
         case when r.status = 'won' and o.partner_value_visibility then d.value_cents::bigint end,
         o.partner_value_visibility
    from referrals r
    join organizations o on o.id = r.org_id
    left join deals d on d.id = r.deal_id
    left join lateral (
      select max(x.created_at) as last_at
        from referral_status_history x
       where x.referral_id = r.id
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.submitted_at >= p_since)
   order by r.submitted_at desc, r.id
   limit 5000
$$;

-- Privileges (create or replace keeps grants; the dropped function needs them again).
revoke execute on function public.portal_list_referrals(uuid, uuid, timestamptz)              from public, anon, authenticated;
revoke execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)           from public, anon, authenticated;
revoke execute on function public.portal_referral_history(uuid, uuid, uuid)                   from public, anon, authenticated;
revoke execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)             from public, anon, authenticated;
revoke execute on function public.claim_portal_emails(integer)                                from public, anon, authenticated;
revoke execute on function public.portal_export_referrals(uuid, uuid, timestamptz)            from public, anon, authenticated;
revoke execute on function public._portal_find_duplicates(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant  execute on function public.portal_list_referrals(uuid, uuid, timestamptz)              to service_role;
grant  execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)           to service_role;
grant  execute on function public.portal_referral_history(uuid, uuid, uuid)                   to service_role;
grant  execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)             to service_role;
grant  execute on function public.claim_portal_emails(integer)                                to service_role;
grant  execute on function public.portal_export_referrals(uuid, uuid, timestamptz)            to service_role;
