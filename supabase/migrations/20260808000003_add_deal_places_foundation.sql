-- Add Deal via Google Places, slice A (foundation).
--
-- Two new deal columns + one new lead_source value. place_id / lat / lng /
-- address / industry / lead_source already exist from earlier work.
--
--   parent_deal_id   a confirmed second LOCATION of an existing merchant points
--                    at the first record, so Insights can roll sites up to a
--                    merchant. Both remain independent deals. (FR-ADD-CRT-05)
--   place_synced_at  when the cached Places fields were last refreshed, drives
--                    the permitted refresh cycle. (FR-ADD-PLC-04)
--   lead_source 'places'  a distinct value for Places-resolved creation, kept
--                    separate from Path-discovered ('path') and manual entry so
--                    the lead-source report can compare rep-directed search
--                    against system discovery. (D-11 / FR-ADD-CRT-04)

alter table deals add column if not exists parent_deal_id uuid references deals(id) on delete set null;
alter table deals add column if not exists place_synced_at timestamptz;

create index if not exists deals_parent_deal_id_idx on deals (parent_deal_id) where parent_deal_id is not null;

comment on column deals.parent_deal_id is 'Second-location sibling link to the first record of a multi-location merchant (Add Deal via Places). Independent deal otherwise.';
comment on column deals.place_synced_at is 'When the cached Google Places fields were last refreshed (drives the permitted refresh cycle).';

-- Add 'places' to the canonical lead_source set (LS-1 constraint).
alter table deals drop constraint if exists deals_lead_source_check;
alter table deals add constraint deals_lead_source_check check (lead_source in (
  'path', 'partner_referral', 'assigned', 'import',
  'places',
  'self_sourced_canvass', 'customer_referral', 'event_association', 'inbound', 'other', 'unknown'
));
