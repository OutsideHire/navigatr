-- Activity-to-Win data foundation (PRD §3.3.A.9, FR-METRIC-AW-01..05,10).
-- Snapshot per-won-deal activity counts + timings at the moment of Closed
-- Won, immutable thereafter. Backfills existing deals. Business days =
-- weekends-only (holiday calendar is a later slice).

-- ── 1. Business-day counter (weekends-only; half-open [start, end) in days) ──
create or replace function business_days_between(a timestamptz, b timestamptz)
returns int language sql stable as $$   -- STABLE, not IMMUTABLE: timestamptz::date reads session TimeZone
  select coalesce(count(*)::int, 0)
  from generate_series(a::date, b::date - 1, interval '1 day') g
  where extract(isodow from g) < 6;   -- Mon..Fri
$$;

-- ── 2. Snapshot columns on deals (all nullable; snapshot-on-close) ──
alter table deals
  add column closed_won_at              timestamptz,
  add column first_activity_at          timestamptz,
  add column first_call_at              timestamptz,
  add column first_email_at             timestamptz,
  add column first_dropin_at            timestamptz,
  add column first_appointment_at       timestamptz,
  add column activity_count_total       int,
  add column activity_count_call        int,
  add column activity_count_email       int,
  add column activity_count_dropin      int,
  add column activity_count_appointment int,
  add column time_to_win_business_days  int,
  add column time_to_win_calendar_days  int;

-- Aggregations read won deals by closed_won_at within a window.
create index deals_closed_won_at_idx on deals (org_id, closed_won_at)
  where closed_won_at is not null;

-- ── 3. write_source on the stage-transition log (PRD stage_transition) ──
alter table deal_stage_history add column write_source text not null default 'ui';

-- Re-declare the history triggers to stamp write_source. A future Miles /
-- import path can `select set_config('app.write_source','miles',true)` before
-- the write; absent that, it defaults to 'ui'.
create or replace function deal_stage_history_record_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_by, write_source)
  values (new.org_id, new.id, null, new.stage, auth.uid(),
          coalesce(nullif(current_setting('app.write_source', true), ''), 'ui'));
  return new;
end $$;

create or replace function deal_stage_history_record_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_by, write_source)
    values (new.org_id, new.id, old.stage, new.stage, auth.uid(),
            coalesce(nullif(current_setting('app.write_source', true), ''), 'ui'));
  end if;
  return new;
end $$;

-- ── 4. Extend the deal denorm sync to also maintain first_*_at ──
-- Recompute (min per type + overall) alongside the existing last_activity_at /
-- next_followup_at. A full recompute (not incremental) keeps DELETE/move
-- correct, matching the existing function's approach.
create or replace function activities_sync_deal_denorm()
returns trigger language plpgsql as $$
declare
  v_deal_id       uuid;
  v_last_activity timestamptz;
  v_next_followup timestamptz;
begin
  if tg_op = 'DELETE' then v_deal_id := old.deal_id; else v_deal_id := new.deal_id; end if;

  select max(a.occurred_at) into v_last_activity from activities a where a.deal_id = v_deal_id;
  select (a.follow_up_date::timestamptz) into v_next_followup
  from activities a where a.deal_id = v_deal_id order by a.occurred_at desc limit 1;

  update deals d set
    last_activity_at     = v_last_activity,
    next_followup_at     = v_next_followup,
    first_activity_at    = (select min(a.occurred_at) from activities a where a.deal_id = v_deal_id),
    first_call_at        = (select min(a.occurred_at) from activities a where a.deal_id = v_deal_id and a.type = 'call'),
    first_email_at       = (select min(a.occurred_at) from activities a where a.deal_id = v_deal_id and a.type = 'email'),
    first_dropin_at      = (select min(a.occurred_at) from activities a where a.deal_id = v_deal_id and a.type = 'drop_in'),
    first_appointment_at = (select min(a.occurred_at) from activities a where a.deal_id = v_deal_id and a.type = 'appointment')
  where d.id = v_deal_id;

  if tg_op = 'UPDATE' and old.deal_id is distinct from new.deal_id then
    select max(a.occurred_at) into v_last_activity from activities a where a.deal_id = old.deal_id;
    select (a.follow_up_date::timestamptz) into v_next_followup
    from activities a where a.deal_id = old.deal_id order by a.occurred_at desc limit 1;
    update deals d set
      last_activity_at     = v_last_activity,
      next_followup_at     = v_next_followup,
      first_activity_at    = (select min(a.occurred_at) from activities a where a.deal_id = old.deal_id),
      first_call_at        = (select min(a.occurred_at) from activities a where a.deal_id = old.deal_id and a.type = 'call'),
      first_email_at       = (select min(a.occurred_at) from activities a where a.deal_id = old.deal_id and a.type = 'email'),
      first_dropin_at      = (select min(a.occurred_at) from activities a where a.deal_id = old.deal_id and a.type = 'drop_in'),
      first_appointment_at = (select min(a.occurred_at) from activities a where a.deal_id = old.deal_id and a.type = 'appointment')
    where d.id = old.deal_id;
  end if;

  return null;
end $$;
-- Trigger definition unchanged (activities_sync_deal_denorm_trg already fires
-- after insert/update/delete on activities); re-declaring the function is enough.

-- ── 5. Snapshot-on-close (set once; reopen/reclose safe) ──
create or replace function deal_snapshot_on_won()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_close timestamptz;
begin
  if new.stage = 'won' and new.closed_won_at is null
     and (tg_op = 'INSERT' or old.stage is distinct from 'won') then
    v_close := now();
    new.closed_won_at := v_close;
    new.activity_count_call        := (select count(*) from activities a where a.deal_id = new.id and a.type='call'        and a.occurred_at <= v_close);
    new.activity_count_email       := (select count(*) from activities a where a.deal_id = new.id and a.type='email'       and a.occurred_at <= v_close);
    new.activity_count_dropin      := (select count(*) from activities a where a.deal_id = new.id and a.type='drop_in'     and a.occurred_at <= v_close);
    new.activity_count_appointment := (select count(*) from activities a where a.deal_id = new.id and a.type='appointment' and a.occurred_at <= v_close);
    new.activity_count_total       := coalesce(new.activity_count_call,0) + coalesce(new.activity_count_email,0)
                                    + coalesce(new.activity_count_dropin,0) + coalesce(new.activity_count_appointment,0);
    if new.first_activity_at is not null then
      new.time_to_win_calendar_days := greatest(0, (v_close::date - new.first_activity_at::date));
      new.time_to_win_business_days := business_days_between(new.first_activity_at, v_close);
    end if;
  end if;
  return new;
end $$;

create trigger deal_snapshot_on_won_trg
  before insert or update of stage on deals
  for each row execute function deal_snapshot_on_won();

-- ── 6. Backfill first_*_at for every existing deal (must precede §7) ──
-- Preserve each deal's real updated_at through the backfill: the
-- deals_set_updated_at BEFORE-UPDATE trigger fires on any update and would
-- otherwise stamp every touched row to the migration time, collapsing the
-- pipeline's updated_at-desc default sort into one cluster (irreversible).
-- Disable it for the backfill only, then re-enable (§7 end).
alter table deals disable trigger deals_set_updated_at;

update deals d set
  first_activity_at    = s.f_all,
  first_call_at        = s.f_call,
  first_email_at       = s.f_email,
  first_dropin_at      = s.f_dropin,
  first_appointment_at = s.f_appt
from (
  select deal_id,
    min(occurred_at)                                     as f_all,
    min(occurred_at) filter (where type = 'call')        as f_call,
    min(occurred_at) filter (where type = 'email')       as f_email,
    min(occurred_at) filter (where type = 'drop_in')     as f_dropin,
    min(occurred_at) filter (where type = 'appointment') as f_appt
  from activities group by deal_id
) s
where d.id = s.deal_id;

-- ── 7. Backfill closed_won_at (earliest won transition) + snapshot ──
update deals d set closed_won_at = w.first_won
from (
  select deal_id, min(transitioned_at) as first_won
  from deal_stage_history where to_stage = 'won' group by deal_id
) w
where d.id = w.deal_id and d.closed_won_at is null;

update deals d set
  activity_count_call        = (select count(*) from activities a where a.deal_id=d.id and a.type='call'        and a.occurred_at <= d.closed_won_at),
  activity_count_email       = (select count(*) from activities a where a.deal_id=d.id and a.type='email'       and a.occurred_at <= d.closed_won_at),
  activity_count_dropin      = (select count(*) from activities a where a.deal_id=d.id and a.type='drop_in'     and a.occurred_at <= d.closed_won_at),
  activity_count_appointment = (select count(*) from activities a where a.deal_id=d.id and a.type='appointment' and a.occurred_at <= d.closed_won_at),
  activity_count_total       = (select count(*) from activities a where a.deal_id=d.id and a.occurred_at <= d.closed_won_at),
  time_to_win_calendar_days  = case when d.first_activity_at is not null then greatest(0, d.closed_won_at::date - d.first_activity_at::date) else null end,
  time_to_win_business_days  = case when d.first_activity_at is not null then business_days_between(d.first_activity_at, d.closed_won_at) else null end
where d.closed_won_at is not null;

-- Re-enable the updated_at trigger now the backfill is done.
alter table deals enable trigger deals_set_updated_at;
