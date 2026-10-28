-- Reply-To rules (FR-PORT-81): the invite replies to the inviting rep, so
-- portal_create_invite also returns that rep's email (null when the profile has none).
-- destructive-ok: return type change (one added column); recreated immediately below with the same grants.
drop function public.portal_create_invite(uuid, uuid);

create function public.portal_create_invite(p_partner_id uuid, p_actor uuid)
returns table (invite_token text, invite_email text, partner_name text, org_name text, org_slug text, inviter_email text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_partner   partners;
  v_org       organizations;
  v_actor_org uuid;
  v_inviter   text;
  v_email     text;
  v_user_id   uuid;
  v_status    portal_user_status;
  v_token     text := public._portal_new_token();
begin
  select * into v_partner from partners p where p.id = p_partner_id;
  if v_partner.id is null then
    raise exception 'partner_not_found' using errcode = 'P0002';
  end if;

  select pr.org_id, nullif(btrim(pr.email), '') into v_actor_org, v_inviter from profiles pr where pr.id = p_actor and pr.deactivated_at is null;
  if v_actor_org is null or v_actor_org <> v_partner.org_id
     or not public.profile_can_see_owner(p_actor, v_partner.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_org from organizations o where o.id = v_partner.org_id;
  if not v_org.portal_enabled or v_org.is_disabled then
    raise exception 'portal_disabled' using errcode = '55000';
  end if;

  v_email := lower(btrim(coalesce(v_partner.email, '')));
  if v_email = '' then
    raise exception 'partner_email_required' using errcode = '22023';
  end if;

  select u.id, u.status into v_user_id, v_status from portal_users u where u.partner_id = p_partner_id for update;
  if v_status = 'active' then
    raise exception 'portal_already_active' using errcode = '55000';
  end if;

  begin
    if v_user_id is null then
      insert into portal_users (org_id, partner_id, email, status, invited_at, invited_by)
      values (v_partner.org_id, p_partner_id, v_email, 'invited', now(), p_actor)
      returning id into v_user_id;
    else
      update portal_users
         set email = v_email, status = 'invited', invited_at = now(), invited_by = p_actor, updated_at = now()
       where id = v_user_id;
    end if;
  exception when unique_violation then
    raise exception 'portal_email_in_use' using errcode = '23505';
  end;

  -- Resend invalidates every earlier invite for this partner.
  update portal_tokens t
     set revoked_at = now()
   where t.portal_user_id = v_user_id and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null;

  insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at)
  values (v_partner.org_id, v_user_id, 'invite', public._portal_hash(v_token), now() + interval '7 days');

  perform public._portal_audit(v_partner.org_id, v_user_id, 'invite', null, p_actor);

  return query select v_token, v_email, v_partner.name, v_org.name, v_org.slug, v_inviter;
end $$;

revoke execute on function public.portal_create_invite(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.portal_create_invite(uuid, uuid) to service_role;
