-- 20260727000010_deals_owner_changed_at.sql
-- Interim reassignment guard for Persistence Index re-engagement (addendum 3.7):
-- a last-owner-change timestamp so a deal reassigned within the trailing 30 days
-- can be excluded from the re-engagement denominator. Backfilled to created_at.
alter table deals add column if not exists owner_changed_at timestamptz;
update deals set owner_changed_at = created_at where owner_changed_at is null;
alter table deals alter column owner_changed_at set default now();

create or replace function deals_touch_owner_changed_at()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    new.owner_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists deals_owner_changed_at_trg on deals;
create trigger deals_owner_changed_at_trg
  before update on deals
  for each row execute function deals_touch_owner_changed_at();
