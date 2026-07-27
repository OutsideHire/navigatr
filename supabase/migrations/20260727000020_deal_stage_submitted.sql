-- 20260727000020_deal_stage_submitted.sql
-- Adds a 'submitted' deal stage (merchant "application submitted") for the
-- appointment outcome "Application signed" (addendum 3.3.B.12). The app controls
-- display order via its STAGE_ORDER / STAGES arrays; this positions the enum
-- value for natural sort only. Run this migration on its own (ALTER TYPE ADD
-- VALUE cannot run inside a transaction with dependent statements in some clients).
alter type deal_stage add value if not exists 'submitted' before 'won';
