-- 20261007000003_referral_rpcs.sql
--
-- Spec 4.3: the only write path for referrals. Every function re-checks org,
-- partner/deal visibility and triage rights, because the app role has no
-- INSERT/UPDATE/DELETE on referrals. Errors carry a stable token in the
-- message (mapped to copy in apps/app/src/features/partners/lib/referrals.ts).

-- Shared loader: the caller's referral row, locked, or a not-found error.
create or replace function public._referral_for_update(p_referral_id uuid)
returns referrals language plpgsql security definer set search_path = public as $$
declare
  r referrals;
begin
  select * into r from referrals where id = p_referral_id for update;
  if not found or r.org_id is distinct from public.user_org_id() then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public._referral_set_note(p_note text)
returns void language sql security definer set search_path = public as $$
  select set_config('navigatr.referral_note', coalesce(p_note, ''), true);
$$;

-- Log: "a partner told me about this business" ------------------------------
create or replace function public.log_referral(
  p_partner_id    uuid,
  p_company_name  text,
  p_contact_name  text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_address       text default null,
  p_place_id      text default null,
  p_industry      text default null,
  p_notes         text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.user_org_id();
  v_company text;
  v_id      uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if coalesce(btrim(p_company_name), '') = '' then
    raise exception 'company_required' using errcode = '22023';
  end if;
  select company into v_company from partners where id = p_partner_id;
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name,
    contact_email, contact_phone, address, place_id, industry, notes,
    partner_company_snapshot, assigned_user_id, submitted_by_user_id
  ) values (
    v_org, p_partner_id, 'inbound', 'rep_entered', 'submitted', btrim(p_company_name),
    nullif(btrim(p_contact_name), ''), nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''), nullif(btrim(p_address), ''),
    nullif(btrim(p_place_id), ''), nullif(btrim(p_industry), ''), coalesce(p_notes, ''),
    v_company, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end $$;

-- Link an existing deal (keeps the partner page's "Attach deal" / "Refer a deal") --
create or replace function public._link_deal_to_partner(
  p_partner_id uuid, p_deal_id uuid, p_direction text, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.user_org_id();
  v_deal    deals;
  v_company text;
  v_id      uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id <> v_org or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  select company into v_company from partners where id = p_partner_id;
  begin
    insert into referrals (
      org_id, partner_id, direction, source, status, company_name, contact_name,
      contact_email, contact_phone, address, place_id, industry, notes,
      partner_company_snapshot, deal_id, assigned_user_id, submitted_by_user_id,
      triaged_by, triaged_at
    ) values (
      v_org, p_partner_id, p_direction, 'rep_entered',
      public.referral_status_for_stage(v_deal.stage),
      coalesce(nullif(btrim(v_deal.company_name), ''), 'Unnamed business'),
      v_deal.contact_name, v_deal.contact_email, v_deal.contact_phone, v_deal.address,
      v_deal.place_id, v_deal.industry, coalesce(p_note, ''), v_company, p_deal_id,
      v_deal.owner_id, auth.uid(), auth.uid(), now()
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;
  if p_direction = 'inbound' then
    update deals set source_partner_id = p_partner_id
     where id = p_deal_id and source_partner_id is null;
  end if;
  return v_id;
end $$;

create or replace function public.attribute_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language sql security definer set search_path = public as $$
  select public._link_deal_to_partner(p_partner_id, p_deal_id, 'inbound', p_note)
$$;

create or replace function public.refer_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language sql security definer set search_path = public as $$
  select public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', p_note)
$$;

-- Remove a rep-entered link (today's "x" on the partner page). The referral is
-- withdrawn, never deleted, so its status history stays intact. Allowed for the
-- submitter or anyone who can triage it, and only on a deal the caller can see.
create or replace function public.remove_referral_link(
  p_partner_id uuid, p_deal_id uuid, p_direction text default 'inbound'
) returns void language plpgsql security definer set search_path = public as $$
declare
  n      int;
  v_deal deals;
begin
  if p_direction not in ('inbound','outbound') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id is distinct from public.user_org_id()
     or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  perform public._referral_set_note('Link removed');
  update referrals
     set status = 'withdrawn'
   where partner_id = p_partner_id
     and deal_id = p_deal_id
     and direction = p_direction
     and source = 'rep_entered'
     and org_id = public.user_org_id()
     and status not in ('declined','withdrawn')
     and (submitted_by_user_id = auth.uid() or public.can_triage_referral(assigned_user_id));
  get diagnostics n = row_count;
  perform public._referral_set_note('');
  if n = 0 then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update deals set source_partner_id = null
   where id = p_deal_id and source_partner_id = p_partner_id
     and not exists (select 1 from referrals r
                     where r.deal_id = p_deal_id and r.partner_id = p_partner_id
                       and r.direction = 'inbound' and r.status not in ('declined','withdrawn'));
end $$;

-- Accept: create the deal, tag the lead source, add the first follow-up -------
create or replace function public.accept_referral(p_referral_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         referrals := public._referral_for_update(p_referral_id);
  v_owner   uuid;
  v_deal    uuid;
  v_dup     uuid;
  v_partner text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  -- A deactivated (or missing) assignee cannot own the new deal; the accepter does.
  v_owner := auth.uid();
  if r.assigned_user_id is not null and exists (
       select 1 from profiles where id = r.assigned_user_id and deactivated_at is null) then
    v_owner := r.assigned_user_id;
  end if;

  begin
    insert into deals (
      org_id, owner_id, company_name, address, industry, contact_name, contact_email,
      contact_phone, value_cents, stage, lead_source, place_id, source_referral_id,
      source_partner_id
    ) values (
      r.org_id, v_owner, r.company_name, r.address, r.industry,
      coalesce(r.contact_name, r.company_name), r.contact_email, coalesce(r.contact_phone, ''),
      null, 'new', 'partner_referral', r.place_id, r.id, r.partner_id
    ) returning id into v_deal;
  exception when unique_violation then
    -- Blocked by the active-deal dedupe (place_id index or name+address trigger).
    select d.id into v_dup
      from deals d
     where d.org_id = r.org_id
       and d.stage not in ('won','lost')
       and ((r.place_id is not null and d.place_id = r.place_id)
            or d.dedupe_key = public.deal_dedupe_key(r.company_name, r.address))
       and public.user_can_see_owner(d.owner_id)
     limit 1;
    return jsonb_build_object('result', 'duplicate', 'deal_id', v_dup);
  end;

  update referrals
     set status = 'accepted', deal_id = v_deal, assigned_user_id = v_owner,
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;

  select name into v_partner from partners where id = r.partner_id;
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    r.org_id, v_owner, 'call', 'Follow up on referral from ' || v_partner, v_deal,
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    'interval'
  );

  return jsonb_build_object('result', 'accepted', 'deal_id', v_deal);
end $$;

create or replace function public.decline_referral(
  p_referral_id uuid, p_reason referral_decline_reason, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r referrals := public._referral_for_update(p_referral_id);
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  perform public._referral_set_note(p_note);
  update referrals
     set status = 'declined', decline_reason = p_reason, decline_note = nullif(btrim(p_note), ''),
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;
  perform public._referral_set_note('');
end $$;

-- Merge: link to an existing deal the caller can see. Never touches lead_source.
create or replace function public.merge_referral(p_referral_id uuid, p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      referrals := public._referral_for_update(p_referral_id);
  v_deal deals;
  v_to   referral_status;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id <> r.org_id or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  begin
    update referrals
       set status = 'accepted', deal_id = p_deal_id,
           assigned_user_id = coalesce(assigned_user_id, auth.uid()),
           triaged_by = auth.uid(), triaged_at = now()
     where id = r.id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;
  v_to := public.referral_status_for_stage(v_deal.stage);
  if v_to <> 'accepted' then
    update referrals set status = v_to where id = r.id;
  end if;
  update deals set source_partner_id = r.partner_id
   where id = p_deal_id and source_partner_id is null;
end $$;

create or replace function public.withdraw_referral(p_referral_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r referrals := public._referral_for_update(p_referral_id);
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status in ('won','lost','declined','withdrawn') then
    raise exception 'referral_closed' using errcode = '22023';
  end if;
  perform public._referral_set_note(p_note);
  update referrals set status = 'withdrawn' where id = r.id;
  perform public._referral_set_note('');
end $$;

-- Reassign (managers/admins). Returns whether the new assignee can see the partner,
-- so the UI can warn (FR-PORT-55).
create or replace function public.reassign_referral(p_referral_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r       referrals := public._referral_for_update(p_referral_id);
  v_owner uuid;
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
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

-- PostgREST computed field: lets the referral queue filter to rows the caller
-- can actually triage (RLS visibility is wider: it includes partner visibility).
create or replace function public.can_triage(r referrals)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_triage_referral(r.assigned_user_id)
$$;

-- Privileges ------------------------------------------------------------------
revoke execute on function public._referral_for_update(uuid)                          from public, anon, authenticated;
revoke execute on function public._referral_set_note(text)                            from public, anon, authenticated;
revoke execute on function public._link_deal_to_partner(uuid, uuid, text, text)       from public, anon, authenticated;

revoke execute on function public.can_triage(referrals)                               from public, anon;
revoke execute on function public.log_referral(uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.attribute_deal_to_partner(uuid, uuid, text)         from public, anon;
revoke execute on function public.refer_deal_to_partner(uuid, uuid, text)             from public, anon;
revoke execute on function public.remove_referral_link(uuid, uuid, text)              from public, anon;
revoke execute on function public.accept_referral(uuid)                               from public, anon;
revoke execute on function public.decline_referral(uuid, referral_decline_reason, text) from public, anon;
revoke execute on function public.merge_referral(uuid, uuid)                          from public, anon;
revoke execute on function public.withdraw_referral(uuid, text)                       from public, anon;
revoke execute on function public.reassign_referral(uuid, uuid)                       from public, anon;

grant execute on function public.can_triage(referrals)                                to authenticated;
grant execute on function public.log_referral(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.attribute_deal_to_partner(uuid, uuid, text)          to authenticated;
grant execute on function public.refer_deal_to_partner(uuid, uuid, text)              to authenticated;
grant execute on function public.remove_referral_link(uuid, uuid, text)               to authenticated;
grant execute on function public.accept_referral(uuid)                                to authenticated;
grant execute on function public.decline_referral(uuid, referral_decline_reason, text) to authenticated;
grant execute on function public.merge_referral(uuid, uuid)                           to authenticated;
grant execute on function public.withdraw_referral(uuid, text)                        to authenticated;
grant execute on function public.reassign_referral(uuid, uuid)                        to authenticated;
