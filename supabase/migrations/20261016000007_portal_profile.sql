-- 20261016000007_portal_profile.sql
--
-- Partner Portal Phase 2A (FR-PORT-19): a signed-in partner keeps their own
-- name and phone current and chooses whether to get the weekly email (the
-- digest itself ships in Phase 2B). The email is the sign-in identity and is
-- never changed here.
--
-- Name and phone edits update the Partner record and are written to
-- partner_profile_changes, which the partner page shows. partner_activities
-- cannot hold them: logged_by must be an internal profile, and every insert
-- moves partners.last_touch_at, but a partner's own edit is not a rep touch.
--
-- Service role only (portal_api), pinned to the session's (org, partner,
-- portal user) like every 1B function.

create table partner_profile_changes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  partner_id     uuid not null references partners(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  field          text not null check (field in ('name','phone')),
  old_value      text,
  new_value      text,
  changed_at     timestamptz not null default now()
);
create index partner_profile_changes_partner_idx on partner_profile_changes (partner_id, changed_at desc);

alter table partner_profile_changes enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on partner_profile_changes from anon;
revoke all on partner_profile_changes from authenticated;
grant select on partner_profile_changes to authenticated;

create policy partner_profile_changes_select on partner_profile_changes for select to authenticated using (
  org_id = public.user_org_id() and public.can_see_partner(partner_id)
);

create or replace function public.portal_get_profile(p_org uuid, p_partner uuid, p_portal_user uuid)
returns table (name text, phone text, email text, weekly_digest boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  return query
    select p.name,
           p.phone,
           u.email,
           case when jsonb_typeof(u.notification_prefs -> 'digest') = 'boolean'
                then (u.notification_prefs ->> 'digest')::boolean
                else true end
      from partners p
      join portal_users u on u.partner_id = p.id and u.id = p_portal_user
     where p.id = p_partner and p.org_id = p_org;
end $$;

create or replace function public.portal_update_profile(
  p_org           uuid,
  p_partner       uuid,
  p_portal_user   uuid,
  p_name          text,
  p_phone         text,
  p_weekly_digest boolean,
  p_ip            text
)
returns table (name text, phone text, email text, weekly_digest boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_partner partners;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);

  -- Lock the active portal user row before any write, so a concurrent
  -- portal_purge_user (which locks the same row) either runs first and this
  -- save is refused, or waits until this save commits and then erases it.
  perform 1 from portal_users u
   where u.id = p_portal_user and u.org_id = p_org and u.partner_id = p_partner
     and u.status = 'active'
     for update;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Field rules mirror _shared/portalProfile.ts.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'invalid_input:name' using errcode = '22023';
  end if;
  if v_phone is not null
     and (char_length(v_phone) > 40 or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7) then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;

  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_profile:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'profile_update'
         and a.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select * into v_partner from partners x where x.id = p_partner and x.org_id = p_org for update;

  if v_partner.name is distinct from v_name then
    insert into partner_profile_changes (org_id, partner_id, portal_user_id, field, old_value, new_value)
    values (p_org, p_partner, p_portal_user, 'name', v_partner.name, v_name);
  end if;
  if v_partner.phone is distinct from v_phone then
    insert into partner_profile_changes (org_id, partner_id, portal_user_id, field, old_value, new_value)
    values (p_org, p_partner, p_portal_user, 'phone', v_partner.phone, v_phone);
  end if;
  if v_partner.name is distinct from v_name or v_partner.phone is distinct from v_phone then
    update partners x set name = v_name, phone = v_phone where x.id = p_partner;
  end if;

  update portal_users u
     set notification_prefs = u.notification_prefs || jsonb_build_object('digest', coalesce(p_weekly_digest, true)),
         updated_at         = now()
   where u.id = p_portal_user;

  perform public._portal_audit_referral(p_org, p_portal_user, 'profile_update', null, p_ip);

  return query select * from public.portal_get_profile(p_org, p_partner, p_portal_user);
end $$;

revoke execute on function public.portal_get_profile(uuid, uuid, uuid)                                from public, anon, authenticated;
revoke execute on function public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)  from public, anon, authenticated;
grant  execute on function public.portal_get_profile(uuid, uuid, uuid)                                to service_role;
grant  execute on function public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)  to service_role;

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
  -- The partner's name must not outlive the erase in any payload (sent or not).
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{partnerName}', 'null'::jsonb)
   where o.portal_user_id = v_user.id and o.payload ? 'partnerName';
  -- Profile edits carried the partner's name and phone; keep the audit rows, drop the values.
  update partner_profile_changes c
     set old_value = null, new_value = null
   where c.partner_id = p_partner_id and c.org_id = v_org;

  perform public._portal_audit(v_org, v_user.id, 'purge', null, auth.uid());
end $$;

-- Controller ruling D2: the erase also clears profile-change values and the
-- partner name in email payloads (portal_purge_user redefined above).
revoke execute on function public.portal_purge_user(uuid) from public, anon;
grant  execute on function public.portal_purge_user(uuid) to authenticated;
