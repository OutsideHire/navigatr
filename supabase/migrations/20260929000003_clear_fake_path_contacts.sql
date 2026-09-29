-- Clear the business names sitting in the contact-name field.
--
-- Until the same-day code fix, a Path drop-in wrote the MERCHANT's name into
-- deals.contact_name (DropInSheet passed `contactName: merchant.name`). So the
-- deal record showed the company as though it were a person. That reads as
-- filled in rather than missing, which is why almost nobody corrected it.
--
-- Measured on production 2026-09-29: 156 of 478 deals carried a contact name
-- identical to their company name, and ALL 156 were lead_source = 'path'. The
-- other nine lead sources had exactly zero between them, which is what makes
-- this safe to do in bulk: no hand-typed name is being touched. A sole trader
-- genuinely named after their business would be indistinguishable, but such a
-- deal would have to have arrived through Path AND never been edited, and the
-- restore below costs nothing if we get one wrong.
--
-- NOT DESTRUCTIVE IN PRACTICE: the value being removed is the company name,
-- which is still on the same row. To undo:
--   update deals set contact_name = company_name
--    where lead_source = 'path' and contact_name = '' and <this date window>;
--
-- Blank rather than a placeholder, because contact_name is NOT NULL and an
-- empty field is the honest state: we do not know who runs this business yet,
-- and an empty field invites a rep to fill it in.
update deals
   set contact_name = ''
 where lead_source = 'path'
   and contact_name = company_name
   and contact_name <> '';
