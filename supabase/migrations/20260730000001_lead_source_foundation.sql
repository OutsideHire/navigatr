-- Lead Source foundation (LS-1)
-- Canonical lead_source taxonomy + a required-with-default column, an "Other"
-- note, and a source_path anchor for Path-originated deals. Backfills legacy
-- free-text values to the canonical set before locking the column down.
--
-- Applied by pasting into the Supabase SQL editor (see migration-apply-method).
-- MUST run before the LS-1 frontend deploys: the app now reads/writes
-- lead_source_note + source_path_id.

-- 1. New columns ------------------------------------------------------------
alter table deals add column if not exists lead_source_note text;
alter table deals add column if not exists source_path_id uuid references paths(id) on delete set null;

-- 2. Backfill legacy free-text lead_source -> canonical values ---------------
update deals set lead_source = case lower(coalesce(lead_source, ''))
  when 'path_dropin'          then 'path'
  when 'path_discovery'       then 'path'
  when 'path'                 then 'path'
  when 'partner_referral'     then 'partner_referral'
  when 'cold_outreach'        then 'self_sourced_canvass'
  when 'existing_client'      then 'customer_referral'
  when 'inbound'              then 'inbound'
  when 'other'                then 'other'
  -- pass-through for anything already canonical
  when 'self_sourced_canvass' then 'self_sourced_canvass'
  when 'customer_referral'    then 'customer_referral'
  when 'event_association'    then 'event_association'
  when 'assigned'             then 'assigned'
  when 'import'               then 'import'
  else 'unknown'
end;

-- 3. Required, defaulting to 'unknown' --------------------------------------
update deals set lead_source = 'unknown' where lead_source is null;
alter table deals alter column lead_source set default 'unknown';
alter table deals alter column lead_source set not null;

-- 4. Constrain to the canonical set -----------------------------------------
alter table deals drop constraint if exists deals_lead_source_check;
alter table deals add constraint deals_lead_source_check check (lead_source in (
  'path', 'partner_referral', 'assigned', 'import',
  'self_sourced_canvass', 'customer_referral', 'event_association', 'inbound', 'other', 'unknown'
));

create index if not exists deals_source_path_id_idx on deals (source_path_id) where source_path_id is not null;
