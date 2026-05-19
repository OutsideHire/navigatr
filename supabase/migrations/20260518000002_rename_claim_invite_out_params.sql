-- The previous fix attempted to qualify every column reference but the
-- function still raised SQLSTATE 42702. The root cause: `RETURNS TABLE
-- (org_id, role)` declares OUT parameters in function scope that collide
-- with `profiles.org_id` and `profiles.role` in any unqualified context —
-- including INSERT column lists, which CREATE OR REPLACE can't always
-- disambiguate when the OUT parameter names match the target table.
--
-- The robust fix: rename the OUT parameters so no collision is possible.
-- Frontend never reads the RPC's return value (it re-queries `profiles`
-- after the call), so renaming is safe.

drop function if exists claim_invite_code(text);

create or replace function claim_invite_code(p_code text)
returns table (out_org_id uuid, out_role user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      organizations%rowtype;
  v_count    int;
  v_role     user_role;
  v_existing profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    return query select v_existing.org_id, v_existing.role;
    return;
  end if;

  if p_code is null or p_code = '' then
    raise exception 'invite_code_required'
      using hint = 'Open the original invite link from your account owner.';
  end if;

  select * into v_org from organizations o
   where o.invite_code = p_code and not o.is_disabled;
  if not found then
    raise exception 'invalid_invite_code';
  end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name)
  values (
    auth.uid(),
    v_org.id,
    v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.raw_user_meta_data->>'name'      from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    )
  );

  return query select v_org.id, v_role;
end $$;

grant execute on function claim_invite_code(text) to authenticated;
