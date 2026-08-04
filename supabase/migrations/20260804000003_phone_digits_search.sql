-- 20260804000003_phone_digits_search.sql
--
-- Make phone numbers searchable in global search. Phones are stored in mixed
-- formats (E.164 "+14056516063" from the Add-deal form, "(405) 651-6063" from
-- other paths), so a plain ilike on the raw column can't match reliably. Add a
-- STORED generated column holding digits only, on both deals and partners, and
-- index it. Global search matches the typed number (also reduced to digits)
-- against these, so "(405) 651-6063", "405-651-6063", and "4056516063" all find
-- the same record regardless of how it was stored.

alter table deals
  add column if not exists contact_phone_digits text
  generated always as (regexp_replace(coalesce(contact_phone, ''), '[^0-9]', '', 'g')) stored;

create index if not exists deals_org_phone_digits_idx
  on deals (org_id, contact_phone_digits)
  where contact_phone_digits <> '';

alter table partners
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;

create index if not exists partners_org_phone_digits_idx
  on partners (org_id, phone_digits)
  where phone_digits <> '';
