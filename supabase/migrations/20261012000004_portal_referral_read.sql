-- 20261012000004_portal_referral_read.sql
--
-- Partner Portal Phase 1B (spec 5.5 withdraw, 5.6 views): what a signed-in
-- partner can read and the one change they can make. Service role only
-- (portal_api). Every query is pinned to (org, partner) from the session, and
-- to inbound, unpurged referrals, so another partner's or another org's id
-- looks exactly like a missing one.
--
-- These functions return the INTERNAL status; portal_api maps it to a partner
-- label through _shared/portalLabels.ts and never passes it through.

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
     and r.direction = 'inbound' and r.purged_at is null
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

-- Detail. Business fields come back only for what the partner typed themselves
-- (source portal_signed_in); a rep-logged referral shows its company name and
-- status, never text a rep wrote (spec 6). The assigned rep's name and business
-- email (profiles has no phone). Detail views are audited once per hour per
-- referral, because the page polls.
create or replace function public.portal_get_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, address text, industry text, urgency text, notes text,
  status referral_status, source referral_source, submitted_at timestamptz,
  rep_name text, rep_email text, can_withdraw boolean
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
     and r.direction = 'inbound' and r.purged_at is null;
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
           case when r.source = 'portal_signed_in' then r.contact_name end,
           case when r.source = 'portal_signed_in' then r.contact_email end,
           case when r.source = 'portal_signed_in' then r.contact_phone end,
           case when r.source = 'portal_signed_in' then r.address end,
           case when r.source = 'portal_signed_in' then r.industry end,
           case when r.source = 'portal_signed_in' then r.urgency end,
           case when r.source = 'portal_signed_in' then r.notes end,
           r.status,
           r.source,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.status = 'submitted' and r.source = 'portal_signed_in')
      from referrals r
      left join profiles pr on pr.id = r.assigned_user_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

-- Status changes, oldest first. Two changes in one transaction share a
-- timestamp (for example accepted then working on a merge), so the enum order
-- breaks the tie in the natural direction.
create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
   order by h.created_at, h.to_status, h.id
$$;

-- Dashboard tiles (FR-PORT-68..71). Active = submitted, accepted, working.
-- Not moving forward = lost or declined. Value is the closed-won deals' value;
-- portal_api drops it unless value_visible.
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
     and r.direction = 'inbound' and r.purged_at is null
     and (p_since is null or r.submitted_at >= p_since)
$$;

-- Withdraw (FR-PORT-42): only the partner's own portal submission, only while
-- it is still submitted. History records the partner as the actor.
create or replace function public.portal_withdraw_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  r referrals;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into r
    from referrals x
   where x.id = p_referral and x.org_id = p_org and x.partner_id = p_partner
     and x.direction = 'inbound' and x.purged_at is null
     for update;
  if r.id is null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'submitted' or r.source <> 'portal_signed_in' then
    raise exception 'not_withdrawable' using errcode = '55000';
  end if;

  perform set_config('navigatr.referral_actor', 'partner', true);
  perform set_config('navigatr.referral_actor_id', p_portal_user::text, true);
  update referrals set status = 'withdrawn' where id = r.id;
  perform set_config('navigatr.referral_actor', '', true);
  perform set_config('navigatr.referral_actor_id', '', true);

  perform public._portal_audit_referral(p_org, p_portal_user, 'withdraw', r.id, p_ip);
end $$;

-- Speech-to-text budget (brief D6): 30 per portal user per hour. Returns false
-- instead of raising so nothing is recorded for a refused request.
create or replace function public.portal_claim_transcribe(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_ip text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  perform pg_advisory_xact_lock(hashtextextended('portal_transcribe:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'transcribe'
         and a.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  perform public._portal_audit_referral(p_org, p_portal_user, 'transcribe', null, p_ip);
  return true;
end $$;

-- Privileges ---------------------------------------------------------------------
revoke execute on function public.portal_list_referrals(uuid, uuid, timestamptz)          from public, anon, authenticated;
revoke execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)       from public, anon, authenticated;
revoke execute on function public.portal_referral_history(uuid, uuid, uuid)               from public, anon, authenticated;
revoke execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)         from public, anon, authenticated;
revoke execute on function public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)  from public, anon, authenticated;
revoke execute on function public.portal_claim_transcribe(uuid, uuid, uuid, text)         from public, anon, authenticated;
grant  execute on function public.portal_list_referrals(uuid, uuid, timestamptz)          to service_role;
grant  execute on function public.portal_get_referral(uuid, uuid, uuid, uuid, text)       to service_role;
grant  execute on function public.portal_referral_history(uuid, uuid, uuid)               to service_role;
grant  execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz)         to service_role;
grant  execute on function public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)  to service_role;
grant  execute on function public.portal_claim_transcribe(uuid, uuid, uuid, text)         to service_role;
