-- 20260727000023_appointment_dispositions_enum.sql
-- The nine appointment outcomes (addendum 3.3.B.12) are written to
-- activities.disposition when an outcome is captured (via useLogActivity). That
-- column is the `disposition` Postgres enum, so the values must be added to it
-- (the scheduled_appointments.outcome check constraint in 20260727000021 gates a
-- DIFFERENT column and does not cover this). Mirrors how 20260601000002 added
-- the Path drop-in outcomes. Run standalone; ALTER TYPE ADD VALUE only adds the
-- values, it does not use them, so multiple adds in one file are safe.
alter type disposition add value if not exists 'appt_presented_awaiting';
alter type disposition add value if not exists 'appt_statements_collected';
alter type disposition add value if not exists 'appt_verbal_commitment';
alter type disposition add value if not exists 'appt_no_show';
alter type disposition add value if not exists 'appt_rescheduled';
alter type disposition add value if not exists 'appt_application_signed';
alter type disposition add value if not exists 'appt_dm_unavailable';
alter type disposition add value if not exists 'appt_cancelled_by_merchant';
alter type disposition add value if not exists 'appt_not_interested';
