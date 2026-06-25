-- coverage_rollup(): manager/admin view of per-rep Activity Logging Coverage
-- (SP2b). On-read aggregation (no persisted coverage_aggregate_snapshot) — one
-- row per visible rep with their LATEST coverage_snapshot, hierarchy-scoped via
-- user_can_see_owner (manager → subtree, admin → org). Returns SCORES only;
-- raw coverage_signal rows stay rep-only (PRD §3.3.C.10/11). Mirrors the
-- team_leaderboard authz + SECURITY DEFINER pattern.

create or replace function coverage_rollup()
returns table (
  user_id            uuid,
  full_name          text,
  role               user_role,
  snapshot_date      date,
  composite_coverage numeric,
  confidence_level   text,
  call_coverage      numeric,
  call_event_count   int,
  active_channels    text[]
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
  -- (NULL not in (...) is NULL, not TRUE). Matches team_leaderboard's behavior.
  if coalesce(public.user_role()::text, '') not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  return query
  select p.id, p.full_name, p.role,
         s.snapshot_date, s.composite_coverage, s.confidence_level,
         s.call_coverage, s.call_event_count, s.active_channels
  from profiles p
  left join lateral (
    select cs.snapshot_date, cs.composite_coverage, cs.confidence_level,
           cs.call_coverage, cs.call_event_count, cs.active_channels
    from coverage_snapshot cs
    where cs.user_id = p.id
    order by cs.snapshot_date desc
    limit 1
  ) s on true
  where p.org_id = public.user_org_id()
    and p.deactivated_at is null
    and public.user_can_see_owner(p.id)
  order by p.full_name, p.id;  -- p.id tiebreaker → deterministic order
end $$;

grant execute on function coverage_rollup() to authenticated;
