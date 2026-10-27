-- "Already a customer" warning for the rep reviewing a referral (FR-PORT-44, Q4).
--
-- Reviewer-only read. Returns the newest WON deal in the caller's org, owned by
-- someone the caller can see, that matches the referral by phone, by name plus
-- address, or by name alone when the referral has no address. Reuses the same
-- key normalizers as the pipeline dedupe. The partner-side duplicate checks are
-- untouched: they skip won deals on purpose and keep doing so.
create or replace function public.referral_customer_match(
  p_company text,
  p_phone   text,
  p_address text
)
returns table (deal_id uuid, company_name text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with cand as (
    select
      public.deal_dedupe_key(p_company, p_address) as na_key,
      public.deal_phone_key(p_phone)               as phone_key,
      public.deal_name_key(p_company)              as name_key,
      (p_address is null or btrim(p_address) = '') as no_address
  )
  select d.id, d.company_name
  from deals d
  cross join cand c
  where d.org_id = public.user_org_id()
    and d.stage = 'won'
    and public.user_can_see_owner(d.owner_id)
    and (
      (c.na_key is not null and d.dedupe_key = c.na_key)
      or (c.phone_key is not null and public.deal_phone_key(d.contact_phone) = c.phone_key)
      or (c.no_address and c.name_key is not null and public.deal_name_key(d.company_name) = c.name_key)
    )
  order by d.created_at desc
  limit 1;
$$;

revoke execute on function public.referral_customer_match(text, text, text) from public, anon, authenticated;
grant execute on function public.referral_customer_match(text, text, text) to authenticated;
