-- 20261012000002_portal_sign_in_caps.sql
--
-- Partner Portal Phase 1B (1A tracker items): at most 20 sign-in codes per
-- portal user per 24 hours, and an audit row on every failed verification.
-- Both functions keep their 1A signatures, so CREATE OR REPLACE keeps their
-- service-role-only privileges.

create index if not exists portal_audit_log_user_action_idx
  on portal_audit_log (portal_user_id, action, created_at);

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
  -- has no bucket, so only the per-user limits apply to it.
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
  -- Phase 1B: a daily ceiling as well, so a slow drip cannot mail a partner all day.
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '24 hours') >= 20 then
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
    perform public._portal_audit(v_org_id, null, 'sign_in_failed', p_ip, null);
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
    perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in_failed', p_ip, null);
    return;
  end if;

  update portal_tokens set consumed_at = now()
   where id = v_hit and consumed_at is null and revoked_at is null;
  if not found then
    perform public._portal_audit(v_user.org_id, v_user.id, 'sign_in_failed', p_ip, null);
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

-- Restated so the file stands alone; CREATE OR REPLACE already kept them.
revoke execute on function public.portal_issue_code(text, text, text)              from public, anon, authenticated;
revoke execute on function public.portal_verify_code(text, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_issue_code(text, text, text)              to service_role;
grant  execute on function public.portal_verify_code(text, text, text, text, text) to service_role;
