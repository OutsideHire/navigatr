-- 20260806000001_task_object.sql
-- SP1 foundation. Creates the first-class task object, amends activities, and
-- backfills open tasks from existing unmet follow-up dates. Does NOT touch
-- persistence scoring: Follow-Up Discipline keeps reading activities.follow_up_date
-- exactly as before (score-stability contract, see the SP1 design spec).

create type task_type as enum ('call','email','drop_in','appointment','todo');
create type task_status as enum ('open','completed','cancelled');
create type task_date_source as enum ('interval','asserted','sla');

create table task (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  owner_id            uuid not null references profiles(id)      on delete cascade,
  type                task_type not null,
  title               text not null,
  deal_id             uuid references deals(id) on delete cascade,
  status              task_status not null default 'open',
  earliest_at         date not null,
  target_at           date not null,
  latest_at           date not null,
  original_target_at  date not null,
  date_source         task_date_source not null default 'interval',
  start_at            timestamptz,
  reminder_at         timestamptz,
  priority            text,
  repeat_rule         text,
  source_activity_id  uuid references activities(id) on delete set null,
  source_outcome      text,
  snooze_count        integer not null default 0,
  exclude_from_path   boolean not null default false,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- deal_id required for every type except todo (internal work).
  constraint task_deal_required check (type = 'todo' or deal_id is not null)
);

create index task_org_owner_status_target_idx on task (org_id, owner_id, status, target_at);
create index task_deal_open_idx on task (deal_id) where status = 'open';

create trigger task_set_updated_at before update on task
  for each row execute function set_updated_at();

alter table task enable row level security;
create policy task_select on task for select
  using (org_id = public.user_org_id());
create policy task_insert on task for insert
  with check (org_id = public.user_org_id() and owner_id = auth.uid());
create policy task_update on task for update
  using (org_id = public.user_org_id());

-- Activity amendments
alter type activity_type add value if not exists 'todo';
alter table activities add column if not exists closed_task_id uuid references task(id) on delete set null;

-- Backfill: one open task per activity whose follow_up_date is unmet (no later
-- activity on the same deal). Mirrors the current supersession rule so the
-- Activities screen shows exactly what deriveTasks() shows today. All three band
-- dates collapse to follow_up_date (a safe collapsed band); tasks created after
-- this migration get real bands from taskBands.ts.
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
where a.follow_up_date is not null
  and not exists (
    select 1 from activities later
    where later.deal_id = a.deal_id and later.occurred_at > a.occurred_at
  );
