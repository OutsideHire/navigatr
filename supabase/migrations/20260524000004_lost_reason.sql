-- 20260524000004_lost_reason.sql
--
-- "Why lost?" capture. Whenever a deal moves to stage='lost', we ask
-- the rep for a structured reason category plus optional free-text
-- notes. The category powers loss-reason rollups (next PR); the notes
-- give the manager qualitative context.
--
-- The new columns are nullable so historical lost deals (set to lost
-- before this column existed) stay valid. Client-side UX enforces the
-- category at the moment of transition to lost; a future check
-- constraint can enforce it server-side once the backlog is cleaned.

create type lost_reason_category as enum (
  'price',         -- price / budget
  'competitor',    -- chose a competitor
  'timing',        -- bad timing (budget cycle, planning, etc.)
  'no_decision',   -- prospect stalled, no closure
  'incumbent',     -- staying with current vendor
  'unqualified',   -- not really a fit / shouldn't have been in pipeline
  'other'          -- free-text notes capture the actual reason
);

alter table deals
  add column lost_reason_category lost_reason_category,
  add column lost_reason_notes    text;

-- index for "top loss reasons" rollups
create index deals_lost_reason_idx on deals (org_id, lost_reason_category)
  where lost_reason_category is not null;
