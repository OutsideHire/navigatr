-- 20260618000001_partner_deal_direction.sql
-- FR-PIPE-09: distinguish inbound (partner referred a deal to us) from outbound
-- (we referred a deal to a partner). Default 'inbound' keeps existing links intact.
-- HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260618000001_partner_deal_direction.sql
alter table partner_deals
  add column if not exists direction text not null default 'inbound'
  check (direction in ('inbound', 'outbound'));
