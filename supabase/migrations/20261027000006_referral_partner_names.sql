-- Referring partner's name on the deal page and the referral queue (FR-PORT-55).
--
-- A rep can see a referral (through its deal or its assignment) without being
-- able to open the partner record, so the partners embed comes back null and
-- the UI had no name to show. This read returns ONLY the partner's name and
-- company, plus whether the caller may open the partner, for the referrals the
-- caller could already select. The row filter mirrors referrals_select
-- (20261007000001) exactly; the deal branch also pins the deal to the
-- referral's org, which the deals RLS did implicitly. Nothing else about an
-- invisible partner leaves this function.
create or replace function public.referral_partner_names(p_referral_ids uuid[])
returns table (referral_id uuid, partner_id uuid, name text, company text, visible boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select r.id, r.partner_id, p.name, p.company, public.can_see_partner(r.partner_id)
  from referrals r
  join partners p on p.id = r.partner_id and p.org_id = r.org_id
  where r.id = any(p_referral_ids)
    and r.org_id = public.user_org_id()
    and (
      public.can_see_partner(r.partner_id)
      or (r.assigned_user_id is not null and public.user_can_see_owner(r.assigned_user_id))
      or (r.assigned_user_id is null and public.caller_is_admin())
      or (r.deal_id is not null and exists (
            select 1 from deals d
            where d.id = r.deal_id
              and d.org_id = r.org_id
              and public.user_can_see_owner(d.owner_id)))
    );
$$;

revoke execute on function public.referral_partner_names(uuid[]) from public, anon, authenticated;
grant execute on function public.referral_partner_names(uuid[]) to authenticated;
