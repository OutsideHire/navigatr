-- 20261009000002_portal_invites.sql
--
-- Partner Portal Phase 1A (spec 5.3): invite, peek, accept. Called only by the
-- portal_invite and portal_api edge functions with the service role. Raw secrets
-- are returned once and never stored; only their SHA-256 hashes are.
--
-- pgcrypto lives in the extensions schema. Always call extensions.digest and
-- extensions.gen_random_bytes by their qualified names.

-- Private helpers ---------------------------------------------------------------
create or replace function public._portal_hash(p_value text)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_value, ''), 'sha256'), 'hex')
$$;

create or replace function public._portal_new_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select encode(extensions.gen_random_bytes(32), 'hex')
$$;

create or replace function public._portal_audit(
  p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_ip text, p_actor uuid
) returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_audit_log (org_id, portal_user_id, action, ip, actor_user_id)
  values (p_org, p_portal_user, p_action, nullif(btrim(coalesce(p_ip, '')), ''), p_actor)
$$;

create or replace function public._portal_create_session(p_portal_user_id uuid, p_ip text, p_user_agent text)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_token   text := public._portal_new_token();
  v_expires timestamptz := now() + interval '30 days';
begin
  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at, ip, user_agent)
  select u.org_id, u.id, public._portal_hash(v_token), v_expires,
         nullif(btrim(coalesce(p_ip, '')), ''), left(p_user_agent, 512)
    from portal_users u
   where u.id = p_portal_user_id;
  return query select v_token, v_expires;
end $$;

-- Invite (spec 5.3, brief D4) ---------------------------------------------------
-- p_actor is the internal user the edge function verified with auth.getUser().
-- Visibility is re-checked here with an explicit viewer, because the service
-- role has no auth.uid().
create or replace function public.portal_create_invite(p_partner_id uuid, p_actor uuid)
returns table (invite_token text, invite_email text, partner_name text, org_name text, org_slug text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_partner   partners;
  v_org       organizations;
  v_actor_org uuid;
  v_email     text;
  v_user_id   uuid;
  v_status    portal_user_status;
  v_token     text := public._portal_new_token();
begin
  select * into v_partner from partners p where p.id = p_partner_id;
  if v_partner.id is null then
    raise exception 'partner_not_found' using errcode = 'P0002';
  end if;

  select pr.org_id into v_actor_org from profiles pr where pr.id = p_actor and pr.deactivated_at is null;
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

  return query select v_token, v_email, v_partner.name, v_org.name, v_org.slug;
end $$;

-- Peek: what the invite page shows before the partner accepts ------------------
create or replace function public.portal_peek_invite(p_slug text, p_token text)
returns table (partner_name text, org_name text, terms_text text, terms_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select p.name, o.name, o.partner_terms_text, o.partner_terms_version
    from portal_tokens t
    join portal_users u  on u.id = t.portal_user_id
    join partners p      on p.id = u.partner_id
    join organizations o on o.id = t.org_id
   where t.token_hash = public._portal_hash(p_token)
     and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
     and u.status = 'invited'
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- Accept: consume the invite, record the terms, activate, open a session -------
create or replace function public.portal_accept_invite(
  p_slug text, p_token text, p_terms_version integer, p_ip text, p_user_agent text
)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_token_id      uuid;
  v_user_id       uuid;
  v_org_id        uuid;
  v_terms_version integer;
begin
  select t.id, u.id, o.id, o.partner_terms_version
    into v_token_id, v_user_id, v_org_id, v_terms_version
    from portal_tokens t
    join portal_users u  on u.id = t.portal_user_id
    join organizations o on o.id = t.org_id
   where t.token_hash = public._portal_hash(p_token)
     and t.token_type = 'invite'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
     and u.status = 'invited'
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
     for update of t, u;
  if v_token_id is null then
    raise exception 'invalid_invite' using errcode = 'P0002';
  end if;
  if p_terms_version is distinct from v_terms_version then
    raise exception 'terms_changed' using errcode = 'P0001';
  end if;

  update portal_tokens set consumed_at = now() where id = v_token_id;
  update portal_users
     set status            = 'active',
         activated_at      = coalesce(activated_at, now()),
         last_login_at     = now(),
         terms_accepted_at = now(),
         terms_version     = p_terms_version,
         terms_ip          = nullif(btrim(coalesce(p_ip, '')), ''),
         updated_at        = now()
   where id = v_user_id;

  -- Defence in depth: any session left over from before a suspend or revoke
  -- (for example one a racing sign-in opened) dies here, so accepting a fresh
  -- invite never revives it.
  update portal_sessions s
     set revoked_at = now()
   where s.portal_user_id = v_user_id and s.revoked_at is null;

  perform public._portal_audit(v_org_id, v_user_id, 'terms_accept', p_ip, null);
  perform public._portal_audit(v_org_id, v_user_id, 'sign_in', p_ip, null);

  return query select * from public._portal_create_session(v_user_id, p_ip, p_user_agent);
end $$;

-- Privileges --------------------------------------------------------------------
revoke execute on function public._portal_hash(text)                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_new_token()                                          from public, anon, authenticated, service_role;
revoke execute on function public._portal_audit(uuid, uuid, portal_audit_action, text, uuid)   from public, anon, authenticated, service_role;
revoke execute on function public._portal_create_session(uuid, text, text)                     from public, anon, authenticated, service_role;

revoke execute on function public.portal_create_invite(uuid, uuid)                             from public, anon, authenticated;
revoke execute on function public.portal_peek_invite(text, text)                               from public, anon, authenticated;
revoke execute on function public.portal_accept_invite(text, text, integer, text, text)        from public, anon, authenticated;
grant  execute on function public.portal_create_invite(uuid, uuid)                             to service_role;
grant  execute on function public.portal_peek_invite(text, text)                               to service_role;
grant  execute on function public.portal_accept_invite(text, text, integer, text, text)        to service_role;
