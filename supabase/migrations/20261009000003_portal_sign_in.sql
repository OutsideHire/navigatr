-- 20261009000003_portal_sign_in.sql
--
-- Partner Portal Phase 1A (spec 5.3, 5.4, R1): branding before sign-in, 6-digit
-- email codes, session lookup and sign-out. Service role only (portal_api).
--
-- The issue and verify functions never raise for an expected failure. They
-- return zero rows instead, so portal_api can answer generically
-- (NFR-PORT-04) and so a wrong guess's attempt counter is committed rather than
-- rolled back with an exception.

-- Controller ruling P7: a session for a user id that matches no row used to
-- succeed silently with a token that was never stored. Raise instead.
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
  if not found then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;
  return query select v_token, v_expires;
end $$;

revoke execute on function public._portal_create_session(uuid, text, text) from public, anon, authenticated, service_role;

-- Branding before sign-in (spec 5.4) --------------------------------------------
create or replace function public.portal_brand(p_slug text)
returns table (org_name text, product_name text, primary_color text, logo_url text, dark_logo_url text)
language sql stable security definer set search_path = public, extensions as $$
  select o.name, coalesce(b.product_name, 'navigatr'), b.primary_color, b.logo_url, b.dark_logo_url
    from organizations o
    left join org_branding b on b.org_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

-- Issue a sign-in code ----------------------------------------------------------
create or replace function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org   organizations;
  v_user  portal_users;
  v_ip    text := nullif(btrim(coalesce(p_ip, '')), '');
  v_bytes bytea;
  v_code  text;
begin
  select * into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org.id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org.id and lower(u.email) = lower(btrim(coalesce(p_email, '')))
     for update;
  -- Both limits are count-then-insert, so they must be serialized or parallel
  -- requests all pass the check. The row lock above serializes issuance per
  -- user; the advisory lock below serializes the per-IP bucket. A missing IP
  -- has no bucket, so only the per-user limit applies to it.
  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_code_ip:' || v_ip, 0));
  end if;

  -- Every request counts toward the per-IP limit, whether or not the email exists.
  perform public._portal_audit(v_org.id, v_user.id, 'code_request', v_ip, null);
  if v_ip is not null and (select count(*) from portal_audit_log a
       where a.action = 'code_request' and a.ip = v_ip
         and a.created_at > now() - interval '1 hour') > 20 then
    return;
  end if;

  if v_user.id is null or v_user.status <> 'active' then
    return;
  end if;
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '1 hour') >= 5 then
    return;
  end if;

  -- Parenthesized: in Postgres << and | share one precedence level.
  v_bytes := extensions.gen_random_bytes(3);
  v_code  := lpad(
    (((get_byte(v_bytes, 0) << 16) | (get_byte(v_bytes, 1) << 8) | get_byte(v_bytes, 2)) % 1000000)::text,
    6, '0');

  insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at, ip)
  values (v_org.id, v_user.id, 'sign_in_code', public._portal_hash(v_code || ':' || v_user.id::text),
          now() + interval '15 minutes', v_ip);

  return query select v_code, v_user.email, v_org.name, v_org.slug;
end $$;

-- Verify a code and open a session -----------------------------------------------
create or replace function public.portal_verify_code(
  p_slug text, p_email text, p_code text, p_ip text, p_user_agent text
)
returns table (session_token text, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org_id uuid;
  v_user   portal_users;
  v_hash   text;
  v_hit    uuid;
begin
  select o.id into v_org_id from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org_id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org_id and lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.status = 'active'
     for update;
  -- The row lock serializes this sign-in against portal_set_access. If a
  -- suspend or revoke commits while we wait, plpgsql re-reads the row and the
  -- status = 'active' predicate is applied again, so no session is opened.
  if v_user.id is null then
    return;
  end if;

  -- Lock this user's live codes so parallel guesses cannot slip past the cap.
  perform 1 from portal_tokens t
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5
     for update;

  v_hash := public._portal_hash(btrim(coalesce(p_code, '')) || ':' || v_user.id::text);
  select t.id into v_hit from portal_tokens t
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5
     and t.token_hash = v_hash
   limit 1;

  if v_hit is null then
    update portal_tokens t
       set attempts = t.attempts + 1
     where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
       and t.consumed_at is null and t.revoked_at is null and t.expires_at > now() and t.attempts < 5;
    return;
  end if;

  update portal_tokens set consumed_at = now()
   where id = v_hit and consumed_at is null and revoked_at is null;
  if not found then
    return;
  end if;
  update portal_tokens t
     set revoked_at = now()
   where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
     and t.consumed_at is null and t.revoked_at is null;
  update portal_users set last_login_at = now(), updated_at = now() where id = v_user.id;
  perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in', p_ip, null);

  return query select * from public._portal_create_session(v_user.id, p_ip, p_user_agent);
end $$;

-- Who is this session? (every signed-in portal_api action calls this first) ------
create or replace function public.portal_session_lookup(p_slug text, p_token text)
returns table (
  portal_user_id uuid, org_id uuid, partner_id uuid, partner_name text,
  user_email text, org_name text, org_slug text
)
language sql stable security definer set search_path = public, extensions as $$
  select u.id, u.org_id, u.partner_id, p.name, u.email, o.name, o.slug
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

create or replace function public.portal_sign_out(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  update portal_sessions s
     set revoked_at = now()
   where s.token_hash = public._portal_hash(p_token) and s.revoked_at is null
  returning s.portal_user_id, s.org_id into v_user, v_org;
  if v_user is not null then
    perform public._portal_audit(v_org, v_user, 'sign_out', null, null);
  end if;
end $$;

-- Privileges --------------------------------------------------------------------
revoke execute on function public.portal_brand(text)                                   from public, anon, authenticated;
revoke execute on function public.portal_issue_code(text, text, text)                  from public, anon, authenticated;
revoke execute on function public.portal_verify_code(text, text, text, text, text)     from public, anon, authenticated;
revoke execute on function public.portal_session_lookup(text, text)                    from public, anon, authenticated;
revoke execute on function public.portal_sign_out(text)                                from public, anon, authenticated;
grant  execute on function public.portal_brand(text)                                   to service_role;
grant  execute on function public.portal_issue_code(text, text, text)                  to service_role;
grant  execute on function public.portal_verify_code(text, text, text, text, text)     to service_role;
grant  execute on function public.portal_session_lookup(text, text)                    to service_role;
grant  execute on function public.portal_sign_out(text)                                to service_role;
