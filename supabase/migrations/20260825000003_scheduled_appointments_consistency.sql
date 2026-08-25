-- 20260825000003_scheduled_appointments_consistency.sql
--
-- Close a cross-org / cross-hierarchy hole in scheduled_appointments. Its
-- INSERT/UPDATE policies checked only owner_id = auth.uid(); org_id and deal_id
-- were client-supplied and unvalidated. So a rep could book an appointment
-- attaching ANOTHER deal's id (a foreign org's, or an out-of-subtree peer's),
-- and sync_appointment -- which runs with the service-role key -- would then
-- read that deal's attendee/contact emails (loadAttendeeEmails) and push them
-- onto the attacker's own calendar. A service-role read of data the caller
-- can't see.
--
-- Fix, mirroring activities (trigger forces org_id from the parent deal; the
-- RLS with-check then requires that org_id = the caller's org):
--   1. A BEFORE INSERT/UPDATE trigger overwrites org_id with the deal's org_id,
--      so the client can't spoof it (raises if the deal doesn't exist).
--   2. INSERT/UPDATE with-check requires org_id = user_org_id() (cross-ORG
--      isolation, holds even for admins since org_id is now the deal's) AND
--      the deal be visible via user_can_see_owner (within-org hierarchy). So a
--      rep can only attach a deal they can actually see.
-- SELECT is unchanged (owner sees own; managers/admins see the org, for
-- coaching). This only tightens who can WRITE an appointment to which deal.

create or replace function public.scheduled_appointments_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_deal_org uuid;
begin
  select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
  if v_deal_org is null then
    raise exception 'appointment references non-existent deal';
  end if;
  -- Authoritative: never trust a client-passed org_id.
  new.org_id := v_deal_org;
  return new;
end $$;

drop trigger if exists scheduled_appointments_enforce_org_consistency_trg on scheduled_appointments;
create trigger scheduled_appointments_enforce_org_consistency_trg
  before insert or update on scheduled_appointments
  for each row execute function public.scheduled_appointments_enforce_org_consistency();

-- INSERT: own row, org forced from the deal must equal the caller's org, and
-- the deal must be visible to the caller.
drop policy if exists scheduled_appointments_insert on scheduled_appointments;
create policy scheduled_appointments_insert on scheduled_appointments for insert with check (
  owner_id = auth.uid()
  and org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = scheduled_appointments.deal_id and public.user_can_see_owner(d.owner_id))
);

-- UPDATE: same gate, so a row can't be re-pointed at a deal the caller can't
-- see (the trigger re-forces org_id from the new deal_id on update too).
drop policy if exists scheduled_appointments_update on scheduled_appointments;
create policy scheduled_appointments_update on scheduled_appointments for update using (
  owner_id = auth.uid()
  and org_id = public.user_org_id()
) with check (
  owner_id = auth.uid()
  and org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = scheduled_appointments.deal_id and public.user_can_see_owner(d.owner_id))
);
