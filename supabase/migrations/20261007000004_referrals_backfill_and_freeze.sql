-- 20261007000004_referrals_backfill_and_freeze.sql
--
-- Spec 4.7. Move every partner_deals link into referrals, then stop the app from
-- writing partner_deals. The table stays for one production promotion so a stale
-- PWA client fails loudly instead of writing somewhere nobody reads; a follow-up
-- migration rewrites reset_demo_data_base() and drops it. Until then the mirror
-- trigger keeps the demo reseed (SECURITY DEFINER, still inserts partner_deals)
-- producing referrals.

-- 1. Backfill ------------------------------------------------------------------
select set_config('navigatr.referral_actor', 'system', true);

insert into referrals (
  org_id, partner_id, direction, source, status, company_name, contact_name,
  contact_email, contact_phone, address, place_id, industry, partner_company_snapshot,
  deal_id, assigned_user_id, submitted_by_user_id, submitted_at, triaged_by,
  triaged_at, notes
)
select pd.org_id, pd.partner_id, pd.direction, 'rep_entered',
       public.referral_status_for_stage(d.stage), d.company_name, d.contact_name,
       d.contact_email, d.contact_phone, d.address, d.place_id, d.industry, p.company,
       pd.deal_id, d.owner_id, pd.attributed_by, pd.attributed_at, pd.attributed_by,
       pd.attributed_at, coalesce(pd.notes, '')
  from partner_deals pd
  join deals d    on d.id = pd.deal_id
  join partners p on p.id = pd.partner_id
on conflict do nothing;

select set_config('navigatr.referral_actor', '', true);

-- 2. Mirror (demo reseed bridge) ------------------------------------------------
create or replace function public.partner_deals_mirror_to_referrals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform set_config('navigatr.referral_actor', 'system', true);
    insert into referrals (
      org_id, partner_id, direction, source, status, company_name, contact_name,
      contact_email, contact_phone, address, place_id, industry, partner_company_snapshot,
      deal_id, assigned_user_id, submitted_by_user_id, submitted_at, triaged_by,
      triaged_at, notes
    )
    select new.org_id, new.partner_id, new.direction, 'rep_entered',
           public.referral_status_for_stage(d.stage), d.company_name, d.contact_name,
           d.contact_email, d.contact_phone, d.address, d.place_id, d.industry, p.company,
           new.deal_id, d.owner_id, new.attributed_by, new.attributed_at, new.attributed_by,
           new.attributed_at, coalesce(new.notes, '')
      from deals d
      join partners p on p.id = new.partner_id
     where d.id = new.deal_id
    on conflict do nothing;
    perform set_config('navigatr.referral_actor', '', true);
    return new;
  end if;
  delete from referrals
   where partner_id = old.partner_id and deal_id = old.deal_id and source = 'rep_entered';
  return old;
end $$;

revoke execute on function public.partner_deals_mirror_to_referrals() from public, anon, authenticated;

create trigger partner_deals_mirror
  after insert or delete on partner_deals
  for each row execute function public.partner_deals_mirror_to_referrals();

-- 3. Freeze app writes ------------------------------------------------------------
revoke insert, update, delete on partner_deals from authenticated;
