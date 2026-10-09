-- 20261007000002_referrals_follow_deal_stage.sql
--
-- Spec 4.5: a referral linked to a deal follows that deal. new -> accepted,
-- any other open stage -> working, won -> won, lost -> lost (a reopened deal
-- moves the referral back to working). Declined, withdrawn and still-submitted
-- referrals are never touched. SECURITY DEFINER because the app role has no
-- UPDATE on referrals; history attributes these changes to 'system'.

create or replace function public.referrals_follow_deal_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target referral_status;
begin
  if new.stage is not distinct from old.stage then
    return new;
  end if;
  v_target := public.referral_status_for_stage(new.stage);
  perform set_config('navigatr.referral_actor', 'system', true);
  update referrals r
     set status = v_target
   where r.deal_id = new.id
     and r.status in ('accepted','working','won','lost')
     and r.status <> v_target;
  perform set_config('navigatr.referral_actor', '', true);
  return new;
end $$;

revoke execute on function public.referrals_follow_deal_stage() from public, anon, authenticated;

create trigger deals_referrals_follow_stage
  after update of stage on deals
  for each row execute function public.referrals_follow_deal_stage();
