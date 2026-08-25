-- Activation heads-up: detect beta orgs that have never created a deal, so a
-- daily cron can nudge the org's admin ("add your first deal") and send the
-- Navigatr operator a heads-up digest. See supabase/functions/notify_no_deals.
--
-- "No deals" = zero rows in `deals` for the org (deals has no soft-delete, so a
-- missing row is the true never-activated signal). Excludes demo orgs
-- (org_features.demo_reset enabled), disabled orgs (is_disabled), orgs younger
-- than the activation window, and orgs already nudged. Requires an active
-- administrator to nudge.

-- One nudge per org: the cron selects `no_deals_nudged_at is null` and stamps it
-- after sending, so a daily job never re-nudges the same org.
alter table organizations add column if not exists no_deals_nudged_at timestamptz;

-- Candidate query, exposed as a function so the cron makes one call and so the
-- detection logic is covered by supabase/tests/023. SECURITY INVOKER: the cron
-- runs as service_role (BYPASSRLS) and sees every org; a normal user calling it
-- would be scoped by RLS to their own org anyway. Execute is revoked from
-- anon/authenticated regardless, because it returns admin emails across orgs and
-- must never be reachable from the browser.
create or replace function public.orgs_needing_no_deals_nudge(p_min_age_days int)
returns table (org_id uuid, org_name text, created_at timestamptz, admin_emails text[])
language sql
stable
security invoker
set search_path = public
as $$
  select o.id, o.name, o.created_at,
         array_agg(p.email order by p.email)
    from organizations o
    join profiles p
      on p.org_id = o.id
     and p.role_level = 'administrator'
     and p.deactivated_at is null
   where o.is_disabled = false
     and o.no_deals_nudged_at is null
     and o.created_at < now() - make_interval(days => greatest(p_min_age_days, 0))
     and not exists (select 1 from deals d where d.org_id = o.id)
     and not exists (
       select 1 from org_features f
        where f.org_id = o.id and f.feature_key = 'demo_reset' and f.enabled
     )
   group by o.id, o.name, o.created_at;
$$;

revoke all on function public.orgs_needing_no_deals_nudge(int) from public;
revoke all on function public.orgs_needing_no_deals_nudge(int) from anon;
revoke all on function public.orgs_needing_no_deals_nudge(int) from authenticated;
grant execute on function public.orgs_needing_no_deals_nudge(int) to service_role;
