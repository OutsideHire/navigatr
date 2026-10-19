-- 20261020000001_public_form_switch.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-28): administrators turn the public
-- referral form on and off. The switch saves on its own RPC the moment it is
-- flipped, so update_portal_settings keeps its signature. The settings read
-- and save RPCs return the switch too; a return table cannot change in place,
-- so both are dropped and re-created with unchanged bodies.
--
-- Turning the portal off keeps public_form_enabled as stored; the form stays
-- closed because _referral_form_open checks both. The form can only be turned
-- ON while the portal is on. Not audited: portal settings changes never were.

drop function if exists public.update_portal_settings(boolean, text, text, boolean);
drop function if exists public.get_portal_settings();

create function public.get_portal_settings()
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select o.portal_enabled, o.partner_terms_text, o.partner_terms_version, o.consent_text,
           o.consent_version, o.partner_value_visibility, o.slug, o.name, o.public_form_enabled
      from organizations o
     where o.id = public.user_org_id();
end $$;

create function public.update_portal_settings(
  p_enabled          boolean,
  p_terms_text       text,
  p_consent_text     text,
  p_value_visibility boolean
)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org     organizations;
  v_enabled boolean := coalesce(p_enabled, false);
  v_terms   text := nullif(btrim(coalesce(p_terms_text, '')), '');
  v_consent text := nullif(btrim(coalesce(p_consent_text, '')), '');
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_org from organizations o where o.id = public.user_org_id() for update;
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Blank input keeps what is stored; texts can be replaced, not cleared.
  v_terms   := coalesce(v_terms, v_org.partner_terms_text);
  v_consent := coalesce(v_consent, v_org.consent_text);

  -- First switch-on seeds editable placeholders (attorney review pending, spec 10).
  if v_enabled and v_terms is null then
    v_terms := format(
      'By using this portal you agree to share business referrals with %s and to only submit contact details you have permission to share. %s may contact the businesses you refer.',
      v_org.name, v_org.name);
  end if;
  if v_enabled and v_consent is null then
    v_consent := 'I have permission to share this business''s contact details.';
  end if;

  update organizations o
     set portal_enabled           = v_enabled,
         partner_value_visibility = coalesce(p_value_visibility, false),
         partner_terms_text       = v_terms,
         partner_terms_version    = o.partner_terms_version
                                    + case when v_terms is distinct from v_org.partner_terms_text then 1 else 0 end,
         consent_text             = v_consent,
         consent_version          = o.consent_version
                                    + case when v_consent is distinct from v_org.consent_text then 1 else 0 end
   where o.id = v_org.id;

  return query select * from public.get_portal_settings();
end $$;

create or replace function public.set_public_form_enabled(p_enabled boolean)
returns table (
  enabled boolean, terms_text text, terms_version integer, consent_text text,
  consent_version integer, value_visibility boolean, slug text, org_name text,
  public_form_enabled boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
  v_on  boolean := coalesce(p_enabled, false);
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_org from organizations o where o.id = public.user_org_id() for update;
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_on and not v_org.portal_enabled then
    raise exception 'portal_disabled' using errcode = '22023';
  end if;
  update organizations o set public_form_enabled = v_on where o.id = v_org.id;
  return query select * from public.get_portal_settings();
end $$;

revoke execute on function public.get_portal_settings()                                from public, anon;
revoke execute on function public.update_portal_settings(boolean, text, text, boolean) from public, anon;
revoke execute on function public.set_public_form_enabled(boolean)                     from public, anon;
grant  execute on function public.get_portal_settings()                                to authenticated;
grant  execute on function public.update_portal_settings(boolean, text, text, boolean) to authenticated;
grant  execute on function public.set_public_form_enabled(boolean)                     to authenticated;
