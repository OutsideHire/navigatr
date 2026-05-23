-- Bulk reassignment of deal ownership from one profile to another.
-- Both profiles must belong to the caller's org. Caller must be a
-- manager or admin. Returns the count of deals moved so the UI can
-- confirm the action quantitatively.
--
-- Use case: admin deactivates a rep who had open deals; before flipping
-- their profile.deactivated_at, the admin picks a successor to inherit
-- the open work. The from-profile can be active OR already deactivated
-- (you may want to clean up dangling deals from a previously revoked rep).

create or replace function admin_reassign_deals(
  p_from_profile uuid,
  p_to_profile   uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_count  int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  -- Both targets must be profiles in the caller's org. We do NOT require
  -- the to-profile to be currently active — but you'd typically pick one
  -- that is. Soft-deactivated rep as a target is allowed (admin's call).
  if not exists (
    select 1 from profiles where id = p_from_profile and org_id = v_org_id
  ) then raise exception 'from_profile_not_in_org'; end if;

  if not exists (
    select 1 from profiles where id = p_to_profile and org_id = v_org_id
  ) then raise exception 'to_profile_not_in_org'; end if;

  if p_from_profile = p_to_profile then
    raise exception 'same_profile';
  end if;

  -- Only move deals that are still active (not closed-out). Closed-out
  -- deals (won/lost) preserve attribution — moving them would rewrite
  -- history. If a manager truly needs to retroactively re-attribute a
  -- won deal, they can edit that single deal directly.
  update deals
     set owner_id = p_to_profile, updated_at = now()
   where org_id = v_org_id
     and owner_id = p_from_profile
     and stage not in ('won', 'lost');

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function admin_reassign_deals(uuid, uuid) to authenticated;
