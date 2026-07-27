-- appointments_awaiting_rollup(): manager/admin view of per-rep count of
-- scheduled appointments awaiting an outcome (W2d). On-read aggregation, one
-- row per visible rep with their awaiting count (reps with zero appear too;
-- the client filters to nonzero), hierarchy-scoped via user_can_see_owner
-- (manager -> subtree, admin -> org). "Awaiting" mirrors the W2c nudge and
-- the scheduled_appointments_awaiting_idx partial index: end time passed,
-- still status 'scheduled', no outcome recorded. Mirrors coverage_rollup's
-- authz + SECURITY DEFINER pattern exactly.

create or replace function appointments_awaiting_rollup()
returns table (
  user_id        uuid,
  full_name      text,
  awaiting_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- coalesce so a NULL role (deactivated / profile-less caller — user_role()
  -- returns NULL) raises 'forbidden' rather than silently passing the IN check
  -- (NULL not in (...) is NULL, not TRUE). Matches coverage_rollup / team_leaderboard.
  if coalesce(public.user_role()::text, '') not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  return query
  select p.id, p.full_name,
         coalesce(a.awaiting_count, 0)::integer
  from profiles p
  left join lateral (
    select count(*) as awaiting_count
    from scheduled_appointments sa
    where sa.owner_id = p.id
      and sa.status = 'scheduled'
      and sa.outcome is null
      and sa.end_at < now()
  ) a on true
  where p.org_id = public.user_org_id()
    and p.deactivated_at is null
    and public.user_can_see_owner(p.id)
  order by p.full_name, p.id;  -- p.id tiebreaker -> deterministic order
end $$;

grant execute on function appointments_awaiting_rollup() to authenticated;
