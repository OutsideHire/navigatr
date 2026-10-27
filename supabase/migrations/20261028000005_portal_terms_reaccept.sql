-- 20261028000005_portal_terms_reaccept.sql
--
-- FR-PORT-18 (Robert's answer Q13): when an ISO changes its partner terms,
-- existing partners accept the new version at their next sign-in (or next
-- action) before they can use the portal. update_portal_settings already bumps
-- organizations.partner_terms_version whenever the text changes, and
-- portal_accept_invite already records portal_users.terms_version, so the gate
-- is a comparison of the two.
--
-- Current means: the org has never set terms (version 0, which blocks nobody),
-- or the partner's accepted version equals the org's. A partner who joined
-- before terms existed (terms_version null) is current only while the org
-- stays at version 0.
--
--   portal_session_lookup  gains a terms_current column. A new return column
--                          changes the result type, so it is dropped, recreated
--                          and re-granted (service_role only, as before). Body
--                          copied from 20261009000003_portal_sign_in.sql (its
--                          only definition).
--   portal_get_terms       new: the text and version a signed-in partner must
--                          accept, for the portal's terms screen.
--   portal_accept_terms    new: records the acceptance on the session's own
--                          portal user, raising terms_changed when the version
--                          the partner read is no longer the org's.
--
-- portal_api enforces the gate: every signed-in data action answers 403
-- terms_required while terms_current is false. me, get_terms, accept_terms,
-- sign_out and the weekly-summary unsubscribe link stay open.

-- 1. Session lookup with the terms flag -----------------------------------------
-- destructive-ok: return type change; recreated immediately below with the same grants.
drop function if exists public.portal_session_lookup(text, text);

create function public.portal_session_lookup(p_slug text, p_token text)
returns table (
  portal_user_id uuid, org_id uuid, partner_id uuid, partner_name text,
  user_email text, org_name text, org_slug text, terms_current boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select u.id, u.org_id, u.partner_id, p.name, u.email, o.name, o.slug,
         (o.partner_terms_version = 0
           or coalesce(u.terms_version = o.partner_terms_version, false))
    from portal_sessions s
    join portal_users u  on u.id = s.portal_user_id
    join partners p      on p.id = u.partner_id
    join organizations o on o.id = s.org_id
   where s.token_hash = public._portal_hash(p_token)
     and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and u.org_id = s.org_id
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- 2. The terms a signed-in partner is asked to accept ----------------------------
create function public.portal_get_terms(p_slug text, p_token text)
returns table (terms_text text, terms_version integer, terms_current boolean)
language sql stable security definer set search_path = public, extensions as $$
  select o.partner_terms_text, o.partner_terms_version,
         (o.partner_terms_version = 0
           or coalesce(u.terms_version = o.partner_terms_version, false))
    from portal_sessions s
    join portal_users u  on u.id = s.portal_user_id
    join organizations o on o.id = s.org_id
   where s.token_hash = public._portal_hash(p_token)
     and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and u.org_id = s.org_id
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- 3. Accept the current terms -----------------------------------------------------
-- The org row is share-locked so a concurrent terms edit (update_portal_settings
-- locks it for update) cannot slip in between the version check and the write.
create function public.portal_accept_terms(
  p_slug text, p_token text, p_terms_version integer, p_ip text
)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user_id       uuid;
  v_org_id        uuid;
  v_terms_version integer;
begin
  select u.id, o.id, o.partner_terms_version
    into v_user_id, v_org_id, v_terms_version
    from portal_sessions s
    join portal_users u  on u.id = s.portal_user_id
    join organizations o on o.id = s.org_id
   where s.token_hash = public._portal_hash(p_token)
     and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and u.org_id = s.org_id
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
     for update of u for share of o;
  if v_user_id is null then
    raise exception 'invalid_session' using errcode = 'P0002';
  end if;
  if p_terms_version is distinct from v_terms_version then
    raise exception 'terms_changed' using errcode = 'P0001';
  end if;

  update portal_users
     set terms_accepted_at = now(),
         terms_version     = p_terms_version,
         terms_ip          = nullif(btrim(coalesce(p_ip, '')), ''),
         updated_at        = now()
   where id = v_user_id;

  perform public._portal_audit(v_org_id, v_user_id, 'terms_accept', p_ip, null);
end $$;

-- 4. Privileges ----------------------------------------------------------------------
revoke execute on function public.portal_session_lookup(text, text)                 from public, anon, authenticated;
revoke execute on function public.portal_get_terms(text, text)                      from public, anon, authenticated;
revoke execute on function public.portal_accept_terms(text, text, integer, text)    from public, anon, authenticated;
grant  execute on function public.portal_session_lookup(text, text)                 to service_role;
grant  execute on function public.portal_get_terms(text, text)                      to service_role;
grant  execute on function public.portal_accept_terms(text, text, integer, text)    to service_role;
