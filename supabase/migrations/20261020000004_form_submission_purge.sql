-- 20261020000004_form_submission_purge.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-93, 94). A daily job erases the personal
-- details on public form submissions that were declined at triage at least the
-- org's retention period ago (declined_retention_days, default 90), and on
-- submissions still untriaged that long after they arrived. The company name,
-- the decline reason, dates and link ids stay. Each erased submission gets a
-- 'purge' audit row (no IP). Converted submissions (attributed, accepted,
-- merged) were already cleared at triage (20261020000002).
--
-- A sibling of purge_declined_referrals with its own job, so that function and
-- its test stay as they are. Pure SQL, called by pg_cron directly.

alter table portal_audit_log
  add column if not exists submission_id uuid references referral_form_submissions(id) on delete set null;

create index if not exists referral_form_submissions_purge_candidates_idx
  on referral_form_submissions (org_id)
  where purged_at is null and (outcome = 'declined' or triaged_at is null);

create or replace function public.purge_form_submissions(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n   integer;
begin
  -- One run at a time. The UPDATE row locks also serialize against a triage
  -- RPC, which re-checks purged_at after its own FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended('purge_form_submissions', 0));

  with erased as (
    update referral_form_submissions s
       set contact_name          = null,
           contact_email         = null,
           contact_phone         = null,
           notes                 = null,
           referred_by_text      = null,
           referrer_email        = null,
           consent_text_snapshot = null,
           submitter_ip          = null,
           decline_note          = null,
           purged_at             = v_now
      from organizations o
     where o.id = s.org_id
       and s.purged_at is null
       and (
         (s.outcome = 'declined'
          and s.triaged_at <= v_now - make_interval(days => o.declined_retention_days))
         or (s.triaged_at is null
             and s.submitted_at <= v_now - make_interval(days => o.declined_retention_days))
       )
    returning s.id, s.org_id
  ),
  audited as (
    insert into portal_audit_log (org_id, action, submission_id)
    select e.org_id, 'purge'::portal_audit_action, e.id from erased e
    returning 1
  )
  select count(*)::integer into v_n from audited;

  return v_n;
end $$;

revoke execute on function public.purge_form_submissions(timestamptz) from public, anon, authenticated;
grant  execute on function public.purge_form_submissions(timestamptz) to service_role;

-- Daily at 06:20 UTC, five minutes after purge-declined-referrals. Idempotent.
create extension if not exists pg_cron;

select cron.unschedule('purge-form-submissions')
where exists (select 1 from cron.job where jobname = 'purge-form-submissions');

select cron.schedule(
  'purge-form-submissions',
  '20 6 * * *',
  $$ select public.purge_form_submissions(now()) $$
);
