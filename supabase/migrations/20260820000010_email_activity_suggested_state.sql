-- 20260820000010_email_activity_suggested_state.sql
--
-- Automatic Email Activity Capture, Phase 1 (D-07): matched sent emails are
-- SUGGESTED first and only become an activity when the rep confirms them (one
-- tap). Silent auto-log is a later, per-tenant setting once precision is proven.
--
-- So a captured/matched email now exists BEFORE any activity: email_activity
-- gains a lifecycle status and its activity_id becomes nullable (null while
-- suggested; set when confirmed). Unmatched sends still go to
-- email_unmatched_queue; this only changes the matched path.

-- A suggestion has no activity yet.
alter table email_activity alter column activity_id drop not null;

-- Lifecycle: suggested -> confirmed (rep accepted; activity_id then set) or
-- dismissed (rep rejected). Default suggested; the confirm/dismiss transition
-- ships with the Slice 5 surface (a SECURITY DEFINER RPC), so no client
-- UPDATE policy is added here -- writes stay service-role/RPC only.
alter table email_activity
  add column if not exists status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'dismissed'));

-- "My email suggestions" list (rep-facing, Slice 5).
create index if not exists email_activity_sender_status_idx
  on email_activity (sender_user_id, status, sent_at desc);

comment on column email_activity.status is
  'suggested = matched, awaiting rep confirm (activity_id null); confirmed = rep accepted (activity_id set); dismissed = rep rejected.';
