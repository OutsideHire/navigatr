-- 20261014000003_portal_email_enqueue.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief E1/E2): decide every referral email
-- in SQL, at the moment the change commits, and queue it in portal_email_outbox.
--
--   AFTER INSERT on referrals (portal submissions only):
--     partner_received        to the partner (when they have active portal access)
--     internal_new_referral   to the assignee, or every active administrator
--   AFTER UPDATE OF status on referrals (inbound only):
--     accepted                partner_accepted
--     won                     partner_closed_won (value only when the ISO allows it)
--     lost, declined          partner_not_moving_forward
--     withdrawn               partner_withdrawn, unless the partner withdrew it
--     submitted, working      nothing (In Progress would be noise)
--   AFTER INSERT on referral_updates:
--     partner_update          the published text and the current label
--
-- Payloads carry only the brief E1 allowlist: never a stage, a decline reason, a
-- note, or anything another partner sent. Dedupe keys make a retried or repeated
-- transition harmless (a reopen and re-win sends Closed Won once).

-- Labels: the SQL mirror of _shared/portalLabels.ts (tested in 047).
create or replace function public._portal_status_label(p_status referral_status)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select case p_status
    when 'submitted' then 'Received'
    when 'accepted'  then 'Accepted'
    when 'working'   then 'In Progress'
    when 'won'       then 'Closed Won'
    when 'lost'      then 'Not Moving Forward'
    when 'declined'  then 'Not Moving Forward'
    when 'withdrawn' then 'Withdrawn'
  end
$$;

-- Who reviews a referral: its assignee while active in the org; otherwise
-- (administrator queue, or a deactivated assignee) every active administrator.
create or replace function public._portal_review_recipients(p_org uuid, p_assignee uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public, extensions as $$
  select p.id
    from profiles p
   where p.id = p_assignee and p.org_id = p_org and p.deactivated_at is null
  union all
  select p.id
    from profiles p
   where p.org_id = p_org and p.role_level = 'administrator' and p.deactivated_at is null
     and not exists (select 1 from profiles a
                      where a.id = p_assignee and a.org_id = p_org and a.deactivated_at is null)
$$;

-- The partner email payload (brief E1). Exactly ten keys, always present.
create or replace function public._portal_partner_payload(p_referral uuid, p_status referral_status, p_update_body text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
           'slug',        o.slug,
           'orgName',     o.name,
           'partnerName', p.name,
           'companyName', r.company_name,
           'ref',         public._portal_referral_ref(r.id),
           'label',       public._portal_status_label(p_status),
           'valueCents',  case when p_status = 'won' and o.partner_value_visibility then d.value_cents end,
           'repName',     pr.full_name,
           'repEmail',    pr.email,
           'updateBody',  p_update_body)
    from referrals r
    join organizations o on o.id = r.org_id
    join partners p on p.id = r.partner_id
    left join deals d on d.id = r.deal_id
    left join profiles pr on pr.id = r.assigned_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where r.id = p_referral
$$;

-- Queue one partner email, only for an inbound, unpurged referral whose partner
-- has ACTIVE portal access while the portal is on. Partners without portal
-- access get nothing (brief scope 3).
create or replace function public._portal_enqueue_partner(
  p_referral referrals, p_kind text, p_dedupe text, p_update_body text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_portal_user uuid;
begin
  if p_referral.direction <> 'inbound' or p_referral.purged_at is not null then
    return;
  end if;
  select u.id into v_portal_user
    from portal_users u
    join organizations o on o.id = u.org_id
   where u.partner_id = p_referral.partner_id and u.org_id = p_referral.org_id
     and u.status = 'active' and o.portal_enabled and not o.is_disabled;
  if v_portal_user is null then
    return;
  end if;
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key)
  values (p_referral.org_id, p_kind, p_referral.id, v_portal_user,
          public._portal_partner_payload(p_referral.id, p_referral.status, p_update_body), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- "New partner referral for you" (FR-PORT-80) to each review recipient.
create or replace function public._portal_enqueue_new_referral(p_referral referrals)
returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_email_outbox (org_id, kind, referral_id, recipient_user_id, payload, dedupe_key)
  select p_referral.org_id, 'internal_new_referral', p_referral.id, rcp.user_id,
         jsonb_build_object('appUrlPath', '/partners',
                            'companyNames', jsonb_build_array(p_referral.company_name),
                            'count', 1),
         'internal_new_referral:' || p_referral.id::text || ':' || rcp.user_id::text
    from public._portal_review_recipients(p_referral.org_id, p_referral.assigned_user_id) rcp
  on conflict (dedupe_key) do nothing
$$;

-- Triggers --------------------------------------------------------------------
create or replace function public.referrals_enqueue_insert_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.source = 'portal_signed_in' and new.direction = 'inbound' then
    -- Each enqueue in its own block: one failing never skips the other, and
    -- neither ever blocks the live RPC transaction. The warning names the
    -- trigger and the error only (no address, no payload).
    begin
      perform public._portal_enqueue_partner(new, 'partner_received', 'partner_received:' || new.id::text, null);
    exception when others then
      raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
    end;
    begin
      perform public._portal_enqueue_new_referral(new);
    exception when others then
      raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
    end;
  end if;
  return new;
end $$;

create or replace function public.referrals_enqueue_status_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_kind  text;
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
    perform public._portal_enqueue_partner(
      new, v_kind, v_kind || ':' || new.id::text || ':' || new.status::text, null);
  end if;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create or replace function public.referral_updates_enqueue_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r referrals;
begin
  begin
    select * into r from referrals where id = new.referral_id;
    if r.id is not null then
      perform public._portal_enqueue_partner(
        r, 'partner_update', 'partner_update:' || r.id::text || ':' || new.id::text, new.body);
    end if;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referrals_enqueue_insert_email
  after insert on referrals
  for each row execute function public.referrals_enqueue_insert_email();

create trigger referrals_enqueue_status_email
  after update of status on referrals
  for each row execute function public.referrals_enqueue_status_email();

create trigger referral_updates_enqueue_email
  after insert on referral_updates
  for each row execute function public.referral_updates_enqueue_email();

-- Privileges: all private. Triggers fire without an EXECUTE check.
revoke execute on function public._portal_status_label(referral_status)               from public, anon, authenticated, service_role;
revoke execute on function public._portal_review_recipients(uuid, uuid)               from public, anon, authenticated, service_role;
revoke execute on function public._portal_partner_payload(uuid, referral_status, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_partner(referrals, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_new_referral(referrals)             from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_insert_email()                    from public, anon, authenticated, service_role;
revoke execute on function public.referrals_enqueue_status_email()                    from public, anon, authenticated, service_role;
revoke execute on function public.referral_updates_enqueue_email()                    from public, anon, authenticated, service_role;
