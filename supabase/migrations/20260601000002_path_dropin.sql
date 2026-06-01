-- 20260601000002_path_dropin.sql
--
-- Path v2 Slice 3: field drop-in logging.
--
-- 1) Extend the shared `disposition` enum with door-knock outcomes. Path is
--    literally field canvassing; the existing values are inside-sales flavored.
--    `not_interested` already exists, so it is NOT re-added. ADD VALUE IF NOT
--    EXISTS is idempotent (PG12+); new values aren't used in SQL in this file,
--    so running inside the migration transaction is safe.
-- 2) Relax deals.contact_email + value_cents to nullable: a drop-in creates a
--    deal from Places data only (no enrichment), so email + estimated value are
--    unknown at creation. The value_cents >= 0 CHECK still holds (passes on NULL).

alter type disposition add value if not exists 'met_dm';
alter type disposition add value if not exists 'gatekeeper';
alter type disposition add value if not exists 'left_collateral';
alter type disposition add value if not exists 'scheduled_callback';
alter type disposition add value if not exists 'not_in_office';
alter type disposition add value if not exists 'closed_locked';
alter type disposition add value if not exists 'do_not_contact';
alter type disposition add value if not exists 'out_of_business';
alter type disposition add value if not exists 'other';

alter table deals alter column contact_email drop not null;
alter table deals alter column value_cents  drop not null;
