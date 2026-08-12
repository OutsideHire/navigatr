-- Restores the one legitimate rep-facing write to `profiles` that
-- 20260812000001_profiles_write_lockdown.sql closes.
--
-- WHY THIS EXISTS: the lockdown revokes UPDATE on profiles from `authenticated`
-- and drops the UPDATE policy, deliberately fail-closed, because the root cause
-- of the escalation hole was that newly added columns default to writable. That
-- was safe when the lockdown was written on 2026-07-30: nothing in apps/app/src
-- updated profiles.
--
-- It stopped being safe on 2026-08-08, when 20260808000006 added
-- `primary_calendar_provider` and the settings Integrations tab began writing it
-- directly (IntegrationsTab.tsx, PrimaryCalendarControl). Applying the lockdown
-- without this migration silently breaks the rep primary-calendar picker: the
-- PATCH is refused and the rep cannot choose which calendar navigatr writes to.
--
-- The fix follows the pattern every other profiles write already uses: a narrow
-- SECURITY DEFINER function that can change exactly one column on exactly the
-- caller's own row. That keeps the fail-closed default intact, so the next
-- column added to profiles is still unwritable until someone deliberately opens
-- it, which is the property the lockdown exists to create.

create or replace function public.set_primary_calendar_provider(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Mirrors the CHECK constraint on the column (20260808000006). Validated here
  -- as well so a bad argument fails with a named error the client can handle
  -- rather than a raw constraint violation.
  if p_provider is not null and p_provider not in ('google', 'microsoft') then
    raise exception 'invalid_calendar_provider';
  end if;

  -- `where id = auth.uid()` is the whole authorization story: a caller can only
  -- ever reach their own row, and only this column.
  update public.profiles
     set primary_calendar_provider = p_provider
   where id = auth.uid();
end;
$$;

revoke all on function public.set_primary_calendar_provider(text) from public;
revoke all on function public.set_primary_calendar_provider(text) from anon;
grant execute on function public.set_primary_calendar_provider(text) to authenticated;
