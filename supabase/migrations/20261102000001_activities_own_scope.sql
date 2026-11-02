-- Activities Bundle 1 (PRD addendum 6.12.C, FR-ACT-26..32): lock what one rep
-- can read or change of another rep's work, at the database, not the screen.
--
-- 1. task SELECT becomes owner-only (Robert, 2026-11-02: "no one should be able
--    to read another person's tasks directly", personal to-dos included, no
--    manager or administrator exception). task_select was `org_id` alone since
--    20260806000001, so any member could read every task in the org through the
--    API; only the app's `.eq("owner_id", ...)` hid them. Every app read of task
--    already filters by owner, and the one cross-owner write
--    (cancel_contact_tasks_for_deal) is security definer, so nothing legitimate
--    loses a row. task_update is already owner-only (20260928000002); task has
--    no delete policy, so deletes stay denied.
--
-- 2. A partner touch can be edited or deleted only by whoever logged it, or by a
--    manager/administrator who can see the partner. This mirrors activities_update
--    and activities_delete. Before, anyone who could see the partner (its owner
--    included) could rewrite or delete a colleague's touch on it.
--
-- 3. Who logged an activity or a partner touch can no longer be changed by an
--    app user. RLS WITH CHECK cannot compare old and new values, so a trigger
--    refuses the change when the statement runs as an API role. Security definer
--    code (the demo reset re-homes seeded activities to their deal owner) runs as
--    the function owner and is unaffected.
--
-- Deal records are untouched on purpose: activities_select still follows the
-- deal, so a rep keeps seeing every activity on her own deal, whoever logged it.
-- "Own activity only" is the Activities History tab, applied by its query.

-- 1. task: read your own tasks only.
drop policy if exists task_select on task;
create policy task_select on task for select
  using (
    org_id = public.user_org_id()
    and owner_id = auth.uid()
  );

-- 2. partner_activities: edit or delete your own touch, or as a manager/admin
--    over the partner.
drop policy if exists partner_activities_update on partner_activities;
create policy partner_activities_update on partner_activities for update
  using (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
    and (
      logged_by = auth.uid()
      or public.user_role() in ('manager', 'admin')
    )
  )
  with check (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
  );

drop policy if exists partner_activities_delete on partner_activities;
create policy partner_activities_delete on partner_activities for delete
  using (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
    and (
      logged_by = auth.uid()
      or public.user_role() in ('manager', 'admin')
    )
  );

-- 3. logged_by is fixed once written, for API callers.
create or replace function public.freeze_logged_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.logged_by is distinct from old.logged_by
     and current_user in ('authenticated', 'anon') then
    raise exception 'logged_by_immutable'
      using errcode = '42501',
            hint = 'Who logged an activity cannot be changed.';
  end if;
  return new;
end $$;

revoke all on function public.freeze_logged_by() from public;
revoke all on function public.freeze_logged_by() from anon;
revoke all on function public.freeze_logged_by() from authenticated;

drop trigger if exists activities_freeze_logged_by on activities;
create trigger activities_freeze_logged_by
  before update of logged_by on activities
  for each row execute function public.freeze_logged_by();

drop trigger if exists partner_activities_freeze_logged_by on partner_activities;
create trigger partner_activities_freeze_logged_by
  before update of logged_by on partner_activities
  for each row execute function public.freeze_logged_by();
