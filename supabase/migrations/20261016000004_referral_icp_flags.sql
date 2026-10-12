-- 20261016000004_referral_icp_flags.sql
--
-- Partner Portal Phase 2A (FR-PORT-58): partner referrals skip ICP filtering,
-- but the checks still run as ADVICE for the rep at triage. Without Google
-- place types the realistic check is the chain list Path discovery already
-- uses: exclusion_seed, matched the same way prospects_nearby matches it
-- (active rows, case-insensitive substring of the business name).
--
-- Stored on the referral at insert time by a trigger, so log_referral and
-- portal_submit_referral both get it without being re-created. Only inbound
-- referrals with no deal (the ones that are triaged) are checked.
--
-- Never shown to partners: no portal_* function selects icp_flags, and the
-- string audit (apps/app/src/features/portal/portalStringAudit.test.tsx)
-- asserts no portal response or CSV carries it.

alter table referrals add column if not exists icp_flags text[] not null default '{}';

-- The brand of the longest active pattern found in the name, or null.
create or replace function public._referral_chain_brand(p_company text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select s.brand
    from exclusion_seed s
   where s.active
     and btrim(coalesce(p_company, '')) <> ''
     and position(lower(s.name_pattern) in lower(p_company)) > 0
   order by length(s.name_pattern) desc, s.brand
   limit 1
$$;

create or replace function public.referrals_set_icp_flags()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_brand text;
begin
  begin
    if new.direction = 'inbound' and new.deal_id is null then
      v_brand := public._referral_chain_brand(new.company_name);
      new.icp_flags := case when v_brand is null then '{}'::text[] else array['chain:' || v_brand] end;
    end if;
  exception when others then
    -- An advisory flag must never block an insert (log_referral, portal
    -- submit, deal linking, the partner_deals mirror, the demo reseed).
    new.icp_flags := '{}'::text[];
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

create trigger referrals_set_icp_flags
  before insert on referrals
  for each row execute function public.referrals_set_icp_flags();

-- The open queue gets its flags now; closed referrals are never triaged again.
update referrals r
   set icp_flags = array['chain:' || public._referral_chain_brand(r.company_name)]
 where r.status = 'submitted' and r.direction = 'inbound' and r.deal_id is null
   and public._referral_chain_brand(r.company_name) is not null;

revoke execute on function public._referral_chain_brand(text)    from public, anon, authenticated, service_role;
revoke execute on function public.referrals_set_icp_flags()      from public, anon, authenticated, service_role;
