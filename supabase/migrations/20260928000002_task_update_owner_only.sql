-- Close the task write hole, and give its one legitimate exception a name.
--
-- WHY. task_update was `using (org_id = public.user_org_id())` and nothing
-- more. No owner predicate, and no WITH CHECK at all, so Postgres reused the
-- USING expression as the check: any member of an organization could complete,
-- snooze or cancel ANY task in it, and could rewrite owner_id to hand a task to
-- someone else. The table also has no updated_by column, so none of that left a
-- trace. When the Roles & Permissions bundles routed deals, activities and
-- partners through user_can_see_owner, task was missed entirely.
--
-- This is not theoretical. A production sweep on 2026-09-28 found 11 tasks
-- closed by someone other than their owner, including four belonging to one rep
-- at the beta ISO, all due the next day, closed the evening before. PRs #192
-- and #193 stopped the app from reaching that state; this stops the database
-- from allowing it, which is the part that actually matters: the UI is not a
-- security boundary and a raw PostgREST call ignores it.

drop policy if exists task_update on task;
create policy task_update on task for update
  using  (org_id = public.user_org_id() and owner_id = auth.uid())
  with check (org_id = public.user_org_id() and owner_id = auth.uid());
-- The WITH CHECK is stated explicitly rather than left to Postgres's reuse of
-- USING, because it carries a second job: with owner_id pinned on BOTH sides, a
-- rep can neither take a colleague's task nor push one of their own onto a
-- colleague. org_id on both sides keeps a task inside its tenant.

-- ---------------------------------------------------------------------------
-- The one legitimate cross-owner write, made explicit
-- ---------------------------------------------------------------------------
-- Do-not-call and email opt-out are properties of the MERCHANT, not of a rep.
-- When one rep records "do not call", every open call task on that deal has to
-- go, whoever owns it: leaving a colleague holding a task to ring a merchant
-- who just asked not to be rung is a compliance problem, not a tidiness one.
-- Nothing in the app filters tasks by these flags at read time, so the stale
-- task really would be worked.
--
-- Under the policy above the client can no longer do that, and it should not be
-- able to: a general "cancel anyone's task" capability is exactly what we just
-- removed. So the exception becomes one named, reviewable function instead.
--
-- What keeps this from being that general capability back again: it refuses
-- unless the deal is ALREADY flagged for the channel. Its authority is
-- conditional on a fact anyone can check, not on who is calling.
create or replace function public.cancel_contact_tasks_for_deal(
  p_deal_id uuid,
  p_channel text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.user_org_id();
  v_flagged boolean;
  v_count   int;
begin
  if v_org is null then
    raise exception 'not_authenticated';
  end if;
  if p_channel not in ('call', 'email') then
    raise exception 'unsupported_channel';
  end if;

  -- The deal must be in the CALLER'S org (so this cannot reach another tenant
  -- even though it runs as definer) and must already carry the flag.
  select case p_channel
           when 'call'  then d.do_not_call
           when 'email' then d.email_opt_out
         end
    into v_flagged
    from deals d
   where d.id = p_deal_id
     and d.org_id = v_org;

  if not coalesce(v_flagged, false) then
    raise exception 'deal_not_flagged';
  end if;

  update task
     set status = 'cancelled', cancelled_at = now()
   where deal_id = p_deal_id
     and org_id  = v_org
     and type    = p_channel::task_type
     and status  = 'open';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and `anon` is a member
-- of PUBLIC, so a definer function is callable over PostgREST by anyone unless
-- this is said out loud. (A 2026-09-28 isolation audit found most of this
-- repo's definer functions never say it.)
revoke all on function public.cancel_contact_tasks_for_deal(uuid, text) from public;
revoke all on function public.cancel_contact_tasks_for_deal(uuid, text) from anon;
grant execute on function public.cancel_contact_tasks_for_deal(uuid, text) to authenticated;
