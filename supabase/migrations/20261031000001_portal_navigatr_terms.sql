-- 20261031000001_portal_navigatr_terms.sql
--
-- Every partner, on every ISO's portal, also accepts navigatr's own "Navigatr
-- Referral Portal Terms" (attorney-approved) alongside the ISO's partner terms.
-- One checkbox accepts both. The text and its version live in code
-- (supabase/functions/_shared/portalNavigatrTerms.ts) because no ISO can edit
-- them; this migration only records which navigatr version each partner
-- accepted. portal_api compares that against the current version, so the
-- database never needs to know what "current" is.
--
--   portal_users.navigatr_terms_version  new, nullable. Null means the partner
--                          has not accepted any navigatr version yet (everyone
--                          at rollout), which portal_api treats as not current.
--   portal_session_lookup  also returns navigatr_terms_version. Return type
--                          change: dropped, recreated, re-granted. Body copied
--                          from 20261028000005_portal_terms_reaccept.sql.
--   portal_get_terms       also returns navigatr_terms_version. Same.
--   portal_accept_terms    gains p_navigatr_terms_version and stores it with the
--                          ISO version. Signature change: dropped, recreated,
--                          re-granted. ISO version check and locks unchanged.
--   portal_accept_invite   gains p_navigatr_terms_version and stores it at
--                          acceptance. Body copied from
--                          20261009000002_portal_invites.sql (its only
--                          definition).
--
-- Deploy skew: the new parameter is LAST and defaults to null, so the portal_api
-- still running between `db push` and the functions deploy (which calls with the
-- old named arguments) keeps working. It stores null, which portal_api treats as
-- not accepted, so that partner is asked again once the new code is live.

-- 1. The accepted navigatr version --------------------------------------------------
-- portal_users is already revoked from anon and authenticated
-- (20261009000001_portal_access_schema.sql), so the new column is service-role only.
alter table portal_users add column if not exists navigatr_terms_version text;

-- 2. Session lookup with the navigatr version ---------------------------------------
-- destructive-ok: function return type and signature changes only (no table or column is dropped); each is recreated immediately below with the same service-role-only grants.
drop function if exists public.portal_session_lookup(text, text);

create function public.portal_session_lookup(p_slug text, p_token text)
returns table (
  portal_user_id uuid, org_id uuid, partner_id uuid, partner_name text,
  user_email text, org_name text, org_slug text, terms_current boolean,
  navigatr_terms_version text
)
language sql stable security definer set search_path = public, extensions as $$
  select u.id, u.org_id, u.partner_id, p.name, u.email, o.name, o.slug,
         (o.partner_terms_version = 0
           or coalesce(u.terms_version = o.partner_terms_version, false)),
         u.navigatr_terms_version
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

-- 3. The terms a signed-in partner is asked to accept --------------------------------
drop function if exists public.portal_get_terms(text, text);

create function public.portal_get_terms(p_slug text, p_token text)
returns table (terms_text text, terms_version integer, terms_current boolean, navigatr_terms_version text)
language sql stable security definer set search_path = public, extensions as $$
  select o.partner_terms_text, o.partner_terms_version,
         (o.partner_terms_version = 0
           or coalesce(u.terms_version = o.partner_terms_version, false)),
         u.navigatr_terms_version
    from portal_sessions s
    join portal_users u  on u.id = s.portal_user_id
    join organizations o on o.id = s.org_id
   where s.token_hash = public._portal_hash(p_token)
     and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and u.org_id = s.org_id
     and o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- 4. Accept the current terms (ISO and navigatr) -------------------------------------
-- The org row is share-locked so a concurrent terms edit (update_portal_settings
-- locks it for update) cannot slip in between the version check and the write.
drop function if exists public.portal_accept_terms(text, text, integer, text);

create function public.portal_accept_terms(
  p_slug text, p_token text, p_terms_version integer, p_ip text,
  p_navigatr_terms_version text default null
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
     set terms_accepted_at      = now(),
         terms_version          = p_terms_version,
         navigatr_terms_version = nullif(btrim(coalesce(p_navigatr_terms_version, '')), ''),
         terms_ip               = nullif(btrim(coalesce(p_ip, '')), ''),
         updated_at             = now()
   where id = v_user_id;

  perform public._portal_audit(v_org_id, v_user_id, 'terms_accept', p_ip, null);
end $$;

-- 5. Accept an invite: consume it, record both terms, activate, open a session -------
drop function if exists public.portal_accept_invite(text, text, integer, text, text);

create function public.portal_accept_invite(
  p_slug text, p_token text, p_terms_version integer, p_ip text, p_user_agent text,
  p_navigatr_terms_version text default null
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
     set status                 = 'active',
         activated_at           = coalesce(activated_at, now()),
         last_login_at          = now(),
         terms_accepted_at      = now(),
         terms_version          = p_terms_version,
         navigatr_terms_version = nullif(btrim(coalesce(p_navigatr_terms_version, '')), ''),
         terms_ip               = nullif(btrim(coalesce(p_ip, '')), ''),
         updated_at             = now()
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

-- 6. Privileges ----------------------------------------------------------------------
revoke execute on function public.portal_session_lookup(text, text)                          from public, anon, authenticated;
revoke execute on function public.portal_get_terms(text, text)                               from public, anon, authenticated;
revoke execute on function public.portal_accept_terms(text, text, integer, text, text)       from public, anon, authenticated;
revoke execute on function public.portal_accept_invite(text, text, integer, text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_session_lookup(text, text)                          to service_role;
grant  execute on function public.portal_get_terms(text, text)                               to service_role;
grant  execute on function public.portal_accept_terms(text, text, integer, text, text)       to service_role;
grant  execute on function public.portal_accept_invite(text, text, integer, text, text, text) to service_role;
