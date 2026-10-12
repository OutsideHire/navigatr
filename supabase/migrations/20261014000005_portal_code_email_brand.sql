-- 20261014000005_portal_code_email_brand.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief scope 5): the sign-in code email is
-- branded with the ISO's logo and color. portal_api must not look the brand up
-- separately: request_code answers before the email is sent so its response
-- time never reveals whether an account exists (1A), and a second lookup only
-- on the success path would. So the brand rides along in the row
-- portal_issue_code already returns.
--
-- Body, limits and audit are exactly 20261012000002's. Only the return type
-- grows, which needs a drop and recreate, so the privileges are restated.

drop function if exists public.portal_issue_code(text, text, text);

create function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text, logo_url text, primary_color text)
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

  -- Phase 1C: the brand for the email (null without a branding row).
  return query
    select v_code, v_user.email, v_org.name, v_org.slug, b.logo_url, b.primary_color
      from (select v_org.id as org_id) x
      left join org_branding b on b.org_id = x.org_id;
end $$;

revoke execute on function public.portal_issue_code(text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_issue_code(text, text, text) to service_role;
