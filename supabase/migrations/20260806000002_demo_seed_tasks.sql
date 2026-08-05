-- 20260806000002_demo_seed_tasks.sql
-- Demo data: generate open task rows from the seeded activities so the
-- Activities screen (Today/Upcoming) and the notification bell have real tasks
-- to show after a demo reset. SP1. Additive: adds _seed_demo_extra4, called by
-- the reset wrapper after _seed_demo_extra3. Runs in replica mode.
--
-- Re-runnable: the base wipe does not know about the new `task` table, so we
-- clear the org's tasks here first. Mirrors the T1 backfill: one open task per
-- activity whose follow_up_date is unmet (no later activity on the same deal),
-- on a still-open deal, band collapsed to the follow-up date.

create or replace function _seed_demo_extra4(p_org uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  set local session_replication_role = replica;

  delete from task where org_id = p_org;

  insert into task (org_id, owner_id, type, title, deal_id, status,
                    earliest_at, target_at, latest_at, original_target_at,
                    date_source, source_activity_id, source_outcome, created_at)
  select a.org_id, a.logged_by, a.type::text::task_type,
         coalesce(d.company_name, 'Follow-up'),
         a.deal_id, 'open',
         a.follow_up_date, a.follow_up_date, a.follow_up_date, a.follow_up_date,
         'interval', a.id, a.disposition::text, now()
  from activities a
  join deals d on d.id = a.deal_id
  where a.org_id = p_org
    and a.follow_up_date is not null
    and d.stage not in ('won','lost')
    and not exists (
      select 1 from activities later
      where later.deal_id = a.deal_id and later.occurred_at > a.occurred_at
    );
end $$;

revoke all on function _seed_demo_extra4(uuid, uuid) from public;

-- Re-wrap: base → hierarchy → extra → extra2 → extra3 → extra4.
create or replace function reset_demo_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_role   user_role;
  v_owner  uuid := auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  select p.org_id, p.role into v_org_id, v_role from profiles p where p.id = v_owner;
  if v_role <> 'admin' then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from org_features
    where org_id = v_org_id and feature_key = 'demo_reset' and enabled
  ) then
    raise exception 'demo_reset_not_enabled';
  end if;

  perform reset_demo_data_base();
  perform _seed_demo_hierarchy(v_org_id, v_owner);
  perform _seed_demo_extra(v_org_id, v_owner);
  perform _seed_demo_extra2(v_org_id, v_owner);
  perform _seed_demo_extra3(v_org_id, v_owner);
  perform _seed_demo_extra4(v_org_id, v_owner);
end $$;
grant execute on function reset_demo_data() to authenticated;
