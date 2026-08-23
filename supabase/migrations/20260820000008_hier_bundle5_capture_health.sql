-- 20260820000008_hier_bundle5_capture_health.sql
--
-- PRD Addendum 6.12.A, Bundle 5, FR-HIER-37: a weekly capture-health figure,
-- reported during beta. The location capture (migration ...0007) ships with no
-- rep-facing UI, so without an operational readout it could fail silently for
-- the whole beta. This RPC returns, for the caller's org over a trailing
-- window, the count of LOGGED ACTIVITIES broken down by their geostamp
-- capture_status, with a 'no_geostamp' bucket for activities that carry none
-- (rep opted out, or logged before this feature). The client turns that into a
-- "% captured" figure.
--
-- Admin-only + operational. SECURITY DEFINER so it can read across the org's
-- activities regardless of the caller's hierarchy scope, but it returns rows
-- only to an administrator (caller_is_admin) and only for their own org. A
-- non-admin gets an empty set.

create or replace function public.location_capture_health(p_days int default 7)
returns table (
  capture_status text,
  activity_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(al.capture_status, 'no_geostamp') as capture_status,
    count(*)::bigint as activity_count
  from activities a
  left join activity_locations al on al.activity_id = a.id
  where a.org_id = public.user_org_id()
    and public.caller_is_admin()
    and a.occurred_at >= now() - make_interval(days => greatest(p_days, 1))
  group by coalesce(al.capture_status, 'no_geostamp')
$$;

grant execute on function public.location_capture_health(int) to authenticated;
