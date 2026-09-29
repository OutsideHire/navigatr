-- Give a deal somewhere to keep its website.
--
-- Robert, 2026-09-29: "any and all details provided from Google Places should
-- be added to the deal record, e.g. Address, Website, Phone number". Website
-- was the one with no landing place at all. We request places.websiteUri in the
-- discovery field mask, store it on prospects.website, carry it on the Path
-- Merchant object, and then had nowhere to put it: `deals` has never had a
-- website column, so the drop-in insert silently dropped a field we had already
-- fetched and paid for.
--
-- Nullable with no default and no backfill, deliberately. Most deals will never
-- have one (a merchant with no site, or a deal created by hand), and a blank
-- string would be indistinguishable from "we looked and there wasn't one".
-- Existing rows are not repaired here: the prospects cache still holds the
-- website against place_id, so a backfill is a later, separate decision, and it
-- can only reach deals that carry a place_id in the first place.
alter table deals add column if not exists website text;

comment on column deals.website is
  'Business website, from Google Places websiteUri at discovery. Null when Places had none or the deal was created by hand.';
