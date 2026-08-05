-- 20260807000001_outcome_sets.sql
-- SP2: dedicated Call + Email outcome sets + record-state flags.
--
-- Adds the new call/email disposition enum values (the headline being no_answer
-- + voicemail, which the platform could not record) and the four record-state
-- flags on deals. Existing values (gatekeeper, wrong_number, not_interested) are
-- reused; closed_lost stays in the enum for history but leaves the call/email
-- grids in the client.
--
-- NOTE: `alter type ... add value` cannot run in the same transaction that then
-- uses the value. The Supabase SQL editor runs these as separate statements, so
-- this is fine to paste as one script. IF NOT EXISTS makes it idempotent.

-- Call set additions
alter type disposition add value if not exists 'no_answer';
alter type disposition add value if not exists 'voicemail';
alter type disposition add value if not exists 'callback';
alter type disposition add value if not exists 'verbal_commitment';
alter type disposition add value if not exists 'send_info';
alter type disposition add value if not exists 'pending_decision';
alter type disposition add value if not exists 'bad_number';
alter type disposition add value if not exists 'do_not_call';

-- Email set
alter type disposition add value if not exists 'sent_pricing';
alter type disposition add value if not exists 'sent_application';
alter type disposition add value if not exists 'reply_received';
alter type disposition add value if not exists 'no_reply';
alter type disposition add value if not exists 'introduction_sent';
alter type disposition add value if not exists 'sent_information';
alter type disposition add value if not exists 'declined_by_email';
alter type disposition add value if not exists 'bad_address';
alter type disposition add value if not exists 'unsubscribed';

-- Record-state flags (default false). A deal maps 1:1 to a business, so
-- do_not_call is effectively org-wide suppression.
alter table deals add column if not exists contact_phone_invalid boolean not null default false;
alter table deals add column if not exists contact_email_invalid boolean not null default false;
alter table deals add column if not exists do_not_call            boolean not null default false;
alter table deals add column if not exists email_opt_out          boolean not null default false;
