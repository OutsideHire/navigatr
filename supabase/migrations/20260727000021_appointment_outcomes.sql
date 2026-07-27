-- 20260727000021_appointment_outcomes.sql
-- Appointment outcome capture (addendum 3.3.B.12): record which of the nine
-- outcomes a rep logged for a scheduled appointment, the note, and when. Marking
-- an outcome also flips status to 'completed' (the first writer of that value).
-- Idempotent (safe to paste-run more than once).
alter table scheduled_appointments add column if not exists outcome text;
alter table scheduled_appointments add column if not exists outcome_notes text;
alter table scheduled_appointments add column if not exists outcome_at timestamptz;

alter table scheduled_appointments drop constraint if exists scheduled_appointments_outcome_check;
alter table scheduled_appointments add constraint scheduled_appointments_outcome_check
  check (outcome is null or outcome in (
    'appt_presented_awaiting','appt_statements_collected','appt_verbal_commitment',
    'appt_no_show','appt_rescheduled','appt_application_signed','appt_dm_unavailable',
    'appt_cancelled_by_merchant','appt_not_interested'
  ));

-- Serves the rep "awaiting outcome" nudge and the manager awaiting-outcome count:
-- appointments whose end time has passed with no outcome recorded yet.
create index if not exists scheduled_appointments_awaiting_idx
  on scheduled_appointments (owner_id, end_at)
  where status = 'scheduled' and outcome is null;
