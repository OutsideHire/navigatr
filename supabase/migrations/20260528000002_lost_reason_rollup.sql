-- 20260528000002_lost_reason_rollup.sql
--
-- Lost-reason rollup RPC for the admin dashboard. Pairs with the
-- lost_reason_category enum + deals.lost_reason_category column added
-- in 20260524000004_lost_reason.sql.
--
-- The function answers one question the admin asks every Monday:
-- "Why are we losing deals?" Returns count + total $$ lost per category
-- inside a configurable window, ordered by count desc.
--
-- Authz: SECURITY DEFINER so the policy stack on `deals` doesn't have to
-- be navigated by the caller — the function pins org_id = user_org_id()
-- itself. Callable by any authenticated user in the org. Reps benefit
-- from seeing the same rollup their manager sees.
--
-- p_window_days: clamped [1, 365] like the team_leaderboard RPC; 0 / null
-- normalises to 30. Matches the leaderboard's window picker UI.

create or replace function lost_reason_rollup(p_window_days int default 30)
returns table (
  category        lost_reason_category,
  deal_count      int,
  lost_value_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with windowed as (
    select
      d.lost_reason_category as category,
      d.value_cents
    from deals d
    where d.org_id = public.user_org_id()
      and d.stage = 'lost'
      and d.lost_reason_category is not null
      and d.updated_at >= (now() - make_interval(
        days => greatest(1, least(365, coalesce(nullif(p_window_days, 0), 30)))
      ))
  )
  select
    category,
    count(*)::int            as deal_count,
    coalesce(sum(value_cents), 0)::bigint as lost_value_cents
  from windowed
  group by category
  order by deal_count desc, lost_value_cents desc;
$$;

grant execute on function lost_reason_rollup(int) to authenticated;

-- Smoke check (commented; uncomment + run manually in SQL editor to verify):
-- select * from lost_reason_rollup(30);
