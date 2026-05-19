-- Fix: claim_invite_code raised SQLSTATE 42702 ("column reference org_id is
-- ambiguous") on every call. The RETURNS TABLE(org_id uuid, role user_role)
-- declares OUT parameters in function scope, which conflict with the bare
-- `org_id` column on profiles. Same hazard with `role` (matches user_role
-- enum but Postgres also got confused about it).
--
-- Solution: qualify every column reference with its table name. The trigger
-- function (handle_new_user_signup) was unaffected because it returns
-- `trigger`, not a TABLE.

create or replace function claim_invite_code(p_code text)
returns table (org_id uuid, role user_role)
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

  -- Idempotent: if profile already exists, return it as success.
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
    auth.uid(), v_org.id, v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.raw_user_meta_data->>'name'      from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    )
  );

  return query select v_org.id, v_role;
end $$;

grant execute on function claim_invite_code(text) to authenticated;
