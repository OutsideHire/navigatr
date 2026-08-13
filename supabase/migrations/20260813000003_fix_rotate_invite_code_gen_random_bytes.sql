-- Fix a live bug: rotate_invite_code() has never worked.
--
-- It is declared SECURITY DEFINER with `SET search_path TO 'public'` and calls
-- bare gen_random_bytes(), which lives in the `extensions` schema. With
-- search_path pinned to public, that name does not resolve, so every call fails
-- with:
--
--   ERROR: function gen_random_bytes(integer) does not exist
--
-- The function is wired into the UI (Settings, Organization tab, via
-- useRotateInviteCode.ts), so the "rotate invite code" action has been erroring
-- for any administrator who pressed it.
--
-- The bare call was introduced in 20260625000003 and carried forward verbatim
-- into 20260722000003, whose own comment notes it was "reproduced verbatim from
-- 20260625000003 (bare gen_random_bytes)". The same mistake was made and then
-- corrected elsewhere: 20260523000002 documents that "gen_random_bytes lives in
-- the pgcrypto extension", and create_organization was fixed the same way in
-- 20260722000002. This call site was simply missed.
--
-- HOW IT SURVIVED: nothing exercised it. It is an occasional admin action, and
-- the frontend tests mock the RPC rather than calling a database. It surfaced
-- only when `supabase db push` to a brand-new staging project failed on an
-- unrelated bare gen_random_bytes, which prompted a grep for the rest.
--
-- Identical to the current definition apart from the schema qualification.

create or replace function public.rotate_invite_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_caller role_level;
  v_code   text;
  v_n      int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid();

  if v_org_id is null or v_caller not in ('administrator','cso_cro') then
    raise exception 'forbidden';
  end if;

  -- Fresh 8-char code; retry on the (astronomically unlikely) collision.
  -- extensions.gen_random_bytes, NOT bare: search_path is pinned to public.
  for v_n in 1..8 loop
    v_code := lower(substring(encode(extensions.gen_random_bytes(8), 'hex') from 1 for 8));
    exit when not exists (select 1 from organizations o where o.invite_code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'invite_code_collision'
      using hint = 'Try again.';
  end if;

  update organizations set invite_code = v_code where id = v_org_id;
  return v_code;
end;
$function$;
