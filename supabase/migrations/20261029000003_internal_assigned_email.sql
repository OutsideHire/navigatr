-- "Assigned to you" email (FR-PORT-80).
--
-- Reassigning a referral or a form submission emails the new assignee through the
-- outbox, kind internal_assigned. Nothing is queued when the assignee did not
-- change or when the caller assigned the item to themselves. The enqueue never
-- blocks the reassign. Payload keeps the internal three keys:
-- {appUrlPath, companyNames, count}.

-- 1. Outbox kind ------------------------------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission',
  'partner_referral_sent','partner_digest','internal_partner_note',
  'internal_assigned'));

-- 2. reassign_referral ----------------------------------------------------------------------
-- Identical to 20261029000002 plus the email to the new assignee.
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
  -- Tell the new assignee, unless nothing changed or they assigned it to themselves.
  if p_user_id is distinct from r.assigned_user_id and p_user_id is distinct from auth.uid() then
    begin
      insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
      values (r.org_id, 'internal_assigned', p_user_id,
              jsonb_build_object('appUrlPath', '/partners',
                                 'companyNames', jsonb_build_array(r.company_name),
                                 'count', 1),
              'internal_assigned:' || r.id::text || ':' || p_user_id::text || ':'
                || floor(extract(epoch from clock_timestamp()))::bigint::text)
      on conflict (dedupe_key) do nothing;
    exception when others then
      raise warning 'reassign_referral email skipped: % %', SQLSTATE, SQLERRM;
    end;
  end if;
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

-- 3. reassign_form_submission -----------------------------------------------------------------
-- Identical to 20261029000002 plus the email to the new assignee.
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
  if p_user_id is distinct from s.assigned_user_id and p_user_id is distinct from auth.uid() then
    begin
      insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
      values (s.org_id, 'internal_assigned', p_user_id,
              jsonb_build_object('appUrlPath', '/partners',
                                 'companyNames', jsonb_build_array(s.company_name),
                                 'count', 1),
              'internal_assigned:' || s.id::text || ':' || p_user_id::text || ':'
                || floor(extract(epoch from clock_timestamp()))::bigint::text)
      on conflict (dedupe_key) do nothing;
    exception when others then
      raise warning 'reassign_form_submission email skipped: % %', SQLSTATE, SQLERRM;
    end;
  end if;
end $$;

revoke execute on function public.reassign_referral(uuid, uuid)               from public, anon;
grant  execute on function public.reassign_referral(uuid, uuid)               to authenticated;
revoke execute on function public.reassign_form_submission(uuid, uuid)        from public, anon;
grant  execute on function public.reassign_form_submission(uuid, uuid)        to authenticated;
