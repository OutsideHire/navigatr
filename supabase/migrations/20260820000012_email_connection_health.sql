-- 20260820000012_email_connection_health.sql
--
-- Automatic Email Activity Capture, Phase 1 (Slice 5d): an operational readout
-- of which reps have connected Outlook for email logging and whether their
-- poll is healthy. Email capture, like location capture, ships without a
-- rep-facing status surface, so during beta an operator needs to see at a
-- glance that it is working (or which connections need a reconnect).
--
-- Admin-only + operational, mirroring location_capture_health: SECURITY DEFINER
-- so it can read the org's email_connection rows regardless of the caller's
-- hierarchy scope, but it returns rows only to an administrator
-- (caller_is_admin) and only for their own org. A non-admin gets an empty set.

create or replace function public.email_connection_health()
returns table (
  user_id            uuid,
  rep_name           text,
  provider           text,
  health             text,
  last_poll_at       timestamptz,
  capture_start_date timestamptz,
  last_error         text
)
language sql stable security definer set search_path = public as $$
  select
    ec.user_id,
    p.full_name as rep_name,
    ec.provider,
    ec.health,
    ec.last_poll_at,
    ec.capture_start_date,
    ec.last_error
  from email_connection ec
  join profiles p on p.id = ec.user_id
  where ec.org_id = public.user_org_id()
    and public.caller_is_admin()
  -- Unhealthy connections first, then by rep name, so the operator sees
  -- what needs attention at the top.
  order by (ec.health <> 'ok') desc, p.full_name asc
$$;

grant execute on function public.email_connection_health() to authenticated;
