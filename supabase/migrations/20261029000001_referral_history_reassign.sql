-- Referral history in the app, with reassignments (FR-PORT-60).
--
-- 1. reassign_referral also writes a history row. The status does not change, so
--    from_status = to_status = the current status; the note names the new owner.
-- 2. portal_referral_history skips those rows. They are internal, a partner must
--    never see who handled their referral internally.

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
  update referrals set assigned_user_id = p_user_id where id = r.id;
  select full_name into v_name from profiles where id = p_user_id;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (r.org_id, r.id, r.status, r.status, 'user', auth.uid(), 'Reassigned to ' || coalesce(v_name, 'a teammate'));
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and h.from_status is distinct from h.to_status
   order by h.created_at, h.to_status, h.id
$$;

-- 3. Every other partner-facing reader skips reassignment rows too ----------------------------
-- A reassignment is internal. It must not make the partner's list or CSV look
-- freshly active, add a line to the weekly summary, or restart the purge clock.
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
         and x.from_status is distinct from x.to_status
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

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
         and x.from_status is distinct from x.to_status
    ) h on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.submitted_at >= p_since)
   order by r.submitted_at desc, r.id
   limit 5000
$$;

create or replace function public.portal_list_sent_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  id uuid, ref text, company_name text, status referral_status,
  sent_at timestamptz, last_activity_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select r.id,
         public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.shared_with_partner_at,
         greatest(r.shared_with_partner_at, coalesce(h.last_at, r.shared_with_partner_at),
                  coalesce(n.last_at, r.shared_with_partner_at)) as last_activity_at
    from referrals r
    join organizations o on o.id = r.org_id
    left join lateral (
      select max(x.created_at) as last_at from referral_status_history x
       where x.referral_id = r.id and x.from_status is distinct from x.to_status
    ) h on true
    left join lateral (
      select max(x.created_at) as last_at from referral_partner_notes x where x.referral_id = r.id
    ) n on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'outbound'
     and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.shared_with_partner_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

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
     and h.from_status is distinct from h.to_status
     and h.created_at >= p_from and h.created_at < p_to
  union all
  select r.id, r.company_name, r.shared_with_partner_at, 'sent_to_you'::text, 0, 'Sent to you'::text
    from referrals r
   where r.org_id = p_org and r.partner_id = p_partner and r.direction = 'outbound'
     and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
     and r.shared_with_partner_at >= p_from and r.shared_with_partner_at < p_to
$$;

create or replace function public._referral_status_since(p_referral uuid, p_status referral_status)
returns timestamptz language sql stable security definer set search_path = public, extensions as $$
  select max(h.created_at)
    from referral_status_history h
   where h.referral_id = p_referral and h.to_status = p_status
     and h.from_status is distinct from h.to_status
$$;
