-- 20261016000005_referral_reinstate.sql
--
-- Partner Portal Phase 2A (FR-PORT-48, FR-PORT-80): a referral declined as a
-- duplicate can come back once the referral that held credit is itself
-- declined or withdrawn. The rep reinstates it (status back to submitted,
-- triage reset, history note), and the duplicate's reviewer is emailed when it
-- becomes possible, through the 1C outbox (new internal kind).

-- 1. New outbox kind -------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available'));

-- 2. Eligibility -------------------------------------------------------------------
create or replace function public._referral_reinstatable(p_referral uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1
      from referrals r
      join referrals h on h.id = r.duplicate_of_referral_id
     where r.id = p_referral
       and r.direction = 'inbound'
       and r.status = 'declined'
       and r.decline_reason = 'duplicate'
       and r.purged_at is null
       and r.deal_id is null
       and h.status in ('declined','withdrawn')
  )
$$;

-- PostgREST computed field: .eq("can_reinstate", true) on referrals.
create or replace function public.can_reinstate(r referrals)
returns boolean language sql stable security definer set search_path = public as $$
  select r.org_id = public.user_org_id()
     and public.can_triage_referral(r.assigned_user_id)
     and public._referral_reinstatable(r.id)
$$;

-- 3. Reinstate -------------------------------------------------------------------
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
         duplicate_of_referral_id = null,
         duplicate_of_deal_id     = null
   where id = r.id;
  perform public._referral_set_note('');
end $$;

-- 4. "You can reinstate" email ---------------------------------------------------
create or replace function public.referrals_enqueue_reinstate_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    if new.status in ('declined','withdrawn') and old.status not in ('declined','withdrawn') then
      insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
      select d.org_id,
             'internal_reinstate_available',
             rcp.user_id,
             jsonb_build_object(
               'appUrlPath', '/partners/' || d.partner_id::text,
               'companyNames', to_jsonb((array_agg(d.company_name order by d.submitted_at, d.id))[1:20]),
               'count', count(*)::integer),
             'internal_reinstate_available:' || new.id::text || ':' || rcp.user_id::text || ':' || d.partner_id::text
        from referrals d
        cross join lateral public._portal_review_recipients(d.org_id, d.assigned_user_id) rcp
       where d.duplicate_of_referral_id = new.id
         and public._referral_reinstatable(d.id)
       group by d.org_id, d.partner_id, rcp.user_id
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    -- Never block the status change; the warning names the trigger only.
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referrals_enqueue_reinstate_email
  after update of status on referrals
  for each row execute function public.referrals_enqueue_reinstate_email();

-- 5. Partner "not moving forward" email: one per decline TRANSITION ---------------
-- A referral can now be declined, reinstated and declined again. The 1C key
-- (kind:referral:status) would swallow the second email, so a decline keys on
-- its ordinal among the referral's decline transitions. This trigger fires
-- before referrals_record_status writes the history row, and the ordinal is a
-- count of earlier decline rows, so it is unique per transition either way.
-- Other statuses keep the 1C key (a re-win must still send one Closed Won).
create or replace function public.referrals_enqueue_status_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_kind  text;
  v_key   text;
begin
  begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'accepted'  then 'partner_accepted'
    when 'won'       then 'partner_closed_won'
    when 'lost'      then 'partner_not_moving_forward'
    when 'declined'  then 'partner_not_moving_forward'
    -- The partner already knows when they withdrew it themselves.
    when 'withdrawn' then case when v_actor = 'partner' then null else 'partner_withdrawn' end
    else null
  end;
  if v_kind is not null then
    v_key := v_kind || ':' || new.id::text || ':' || new.status::text;
    if new.status = 'declined' then
      v_key := v_key || ':' || (
        select count(*) from referral_status_history h
         where h.referral_id = new.id and h.to_status = 'declined')::text;
    end if;
    perform public._portal_enqueue_partner(new, v_kind, v_key, null);
  end if;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

revoke execute on function public.referrals_enqueue_status_email() from public, anon, authenticated, service_role;

-- Privileges -----------------------------------------------------------------------
revoke execute on function public._referral_reinstatable(uuid)            from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_reinstate_email()     from public, anon, authenticated, service_role;
revoke execute on function public.can_reinstate(referrals)                from public, anon;
revoke execute on function public.reinstate_referral(uuid)                from public, anon;
grant  execute on function public.can_reinstate(referrals)                to authenticated;
grant  execute on function public.reinstate_referral(uuid)                to authenticated;
