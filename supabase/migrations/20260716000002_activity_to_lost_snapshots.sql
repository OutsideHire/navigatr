-- Activity-to-Win: Compare-to-Lost data foundation (PRD §3.3.A, slice 5b).
-- Mirrors the won snapshot (migration 20260716000001) for the terminal 'lost'
-- stage so the report can compare won vs lost activity + timing. Reuses the
-- existing activity_count_* columns (a deal closes once, won XOR lost) and
-- adds a lost close timestamp + time-to-lost timings. Backfills existing
-- lost deals. Business days = weekends-only, matching the won side.

-- ── 1. Lost snapshot columns on deals (all nullable; snapshot-on-close) ──
-- Idempotent: prod may already carry closed_lost_at (schema drift / partial
-- prior run), so guard every add + the index so the whole script re-runs clean.
alter table deals add column if not exists closed_lost_at             timestamptz;
alter table deals add column if not exists time_to_lost_business_days int;
alter table deals add column if not exists time_to_lost_calendar_days int;

-- Aggregations read lost deals by closed_lost_at within a window.
create index if not exists deals_closed_lost_at_idx on deals (org_id, closed_lost_at)
  where closed_lost_at is not null;

-- ── 2. Snapshot-on-close for lost (set once; reopen/reclose safe) ──
-- Parallels deal_snapshot_on_won. activity_count_* are stamped only when not
-- already set, so a deal that was won and later moved to lost keeps its
-- won-time counts; a deal closing straight to lost gets its counts here.
create or replace function deal_snapshot_on_lost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_close timestamptz;
begin
  if new.stage = 'lost' and new.closed_lost_at is null
     and (tg_op = 'INSERT' or old.stage is distinct from 'lost') then
    v_close := now();
    new.closed_lost_at := v_close;
    if new.activity_count_total is null then
      new.activity_count_call        := (select count(*) from activities a where a.deal_id = new.id and a.type='call'        and a.occurred_at <= v_close);
      new.activity_count_email       := (select count(*) from activities a where a.deal_id = new.id and a.type='email'       and a.occurred_at <= v_close);
      new.activity_count_dropin      := (select count(*) from activities a where a.deal_id = new.id and a.type='drop_in'     and a.occurred_at <= v_close);
      new.activity_count_appointment := (select count(*) from activities a where a.deal_id = new.id and a.type='appointment' and a.occurred_at <= v_close);
      new.activity_count_total       := coalesce(new.activity_count_call,0) + coalesce(new.activity_count_email,0)
                                      + coalesce(new.activity_count_dropin,0) + coalesce(new.activity_count_appointment,0);
    end if;
    if new.first_activity_at is not null then
      new.time_to_lost_calendar_days := greatest(0, (v_close::date - new.first_activity_at::date));
      new.time_to_lost_business_days := business_days_between(new.first_activity_at, v_close);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists deal_snapshot_on_lost_trg on deals;
create trigger deal_snapshot_on_lost_trg
  before insert or update of stage on deals
  for each row execute function deal_snapshot_on_lost();

-- ── 3. Backfill closed_lost_at (earliest lost transition) + snapshot ──
-- Preserve each deal's real updated_at through the backfill (the
-- deals_set_updated_at BEFORE-UPDATE trigger would otherwise collapse the
-- pipeline's updated_at-desc sort). Disable it for the backfill only.
alter table deals disable trigger deals_set_updated_at;

update deals d set closed_lost_at = l.first_lost
from (
  select deal_id, min(transitioned_at) as first_lost
  from deal_stage_history where to_stage = 'lost' group by deal_id
) l
where d.id = l.deal_id and d.closed_lost_at is null;

-- Activity counts for lost deals that were never won (won backfill already
-- stamped won deals; leave those untouched via the activity_count_total guard).
update deals d set
  activity_count_call        = (select count(*) from activities a where a.deal_id=d.id and a.type='call'        and a.occurred_at <= d.closed_lost_at),
  activity_count_email       = (select count(*) from activities a where a.deal_id=d.id and a.type='email'       and a.occurred_at <= d.closed_lost_at),
  activity_count_dropin      = (select count(*) from activities a where a.deal_id=d.id and a.type='drop_in'     and a.occurred_at <= d.closed_lost_at),
  activity_count_appointment = (select count(*) from activities a where a.deal_id=d.id and a.type='appointment' and a.occurred_at <= d.closed_lost_at),
  activity_count_total       = (select count(*) from activities a where a.deal_id=d.id and a.occurred_at <= d.closed_lost_at)
where d.closed_lost_at is not null and d.activity_count_total is null;

update deals d set
  time_to_lost_calendar_days = case when d.first_activity_at is not null then greatest(0, d.closed_lost_at::date - d.first_activity_at::date) else null end,
  time_to_lost_business_days = case when d.first_activity_at is not null then business_days_between(d.first_activity_at, d.closed_lost_at) else null end
where d.closed_lost_at is not null;

-- Re-enable the updated_at trigger now the backfill is done.
alter table deals enable trigger deals_set_updated_at;
