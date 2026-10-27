-- Tests for 20261028000004_employee_count_range (FR-PORT-35, Q10).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/072_employee_count_range.sql
-- Self-cleans via ROLLBACK. Runs as postgres.
--
-- The submit, attribute and accept paths are covered in 042, 044, 058 and 060.
-- This file checks the columns and their CHECKs, and that no deal still holds
-- one of the old Add Deal picker values the migration remapped.

begin;

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'referrals' and column_name = 'employee_count_range') then
    raise exception 'referrals.employee_count_range should exist';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'referral_form_submissions' and column_name = 'employee_count_range') then
    raise exception 'referral_form_submissions.employee_count_range should exist';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referrals_employee_count_range_check')
     or not exists (select 1 from pg_constraint where conname = 'referral_form_submissions_employee_count_range_check') then
    raise exception 'both employee_count_range CHECKs should exist';
  end if;
end $$;

-- Each CHECK names the four buckets (042 and 058 show it refusing other values).
do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'referrals_employee_count_range_check'))
     not like '%1-10%11-50%51-200%201+%' then
    raise exception 'referrals CHECK should list the four buckets, got %',
      pg_get_constraintdef((select oid from pg_constraint where conname = 'referrals_employee_count_range_check'));
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'referral_form_submissions_employee_count_range_check'))
     not like '%1-10%11-50%51-200%201+%' then
    raise exception 'referral_form_submissions CHECK should list the four buckets';
  end if;
end $$;

-- Decision 8: the migration moved every deal off the old picker values.
do $$ begin
  if exists (select 1 from deals where employee_count_range in ('1-9', '10-49', '50-249', '250+')) then
    raise exception 'deals still hold old employee-count values: %',
      (select string_agg(distinct employee_count_range, ', ') from deals
        where employee_count_range in ('1-9', '10-49', '50-249', '250+'));
  end if;
end $$;

rollback;
