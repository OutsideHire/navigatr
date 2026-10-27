-- Partner Portal: Closed Won by close date (FR-PORT-70, Robert's answer Q7).
--
-- In the 30 days / 90 days / 12 months view, Closed Won and its value count by
-- the day the deal closed, not the day the referral was sent. Submitted,
-- Active and Not moving forward still count by sent date. won_sent is the
-- number of won referrals that were also sent inside the window; the
-- conversion rate uses it so a close from an older referral cannot push the
-- rate above 100 percent.
--
-- closed_won_at is set once when a deal is won and is not cleared on reopen,
-- so a won count also requires the referral itself to be won. A null p_since
-- is "all time" and counts every won referral.
-- Purged referrals stay counted, exactly as in 20261016000003.
--
-- The return type changes, so the function is dropped and created again.

drop function if exists public.portal_dashboard_stats(uuid, uuid, timestamptz);

create function public.portal_dashboard_stats(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  submitted bigint, active bigint, closed_won bigint, not_moving_forward bigint,
  won_value_cents bigint, value_visible boolean, won_sent bigint
)
language sql stable security definer set search_path = public, extensions as $$
  select count(r.id) filter (where p_since is null or r.submitted_at >= p_since),
         count(r.id) filter (where r.status in ('submitted','accepted','working')
                               and (p_since is null or r.submitted_at >= p_since)),
         count(r.id) filter (where r.status = 'won'
                               and (p_since is null or d.closed_won_at >= p_since)),
         count(r.id) filter (where r.status in ('lost','declined')
                               and (p_since is null or r.submitted_at >= p_since)),
         coalesce(sum(d.value_cents) filter (where r.status = 'won'
                               and (p_since is null or d.closed_won_at >= p_since)), 0)::bigint,
         coalesce((select o.partner_value_visibility from organizations o where o.id = p_org), false),
         count(r.id) filter (where r.status = 'won'
                               and (p_since is null or r.submitted_at >= p_since))
    from referrals r
    left join deals d on d.id = r.deal_id
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
$$;

revoke execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.portal_dashboard_stats(uuid, uuid, timestamptz) to service_role;
