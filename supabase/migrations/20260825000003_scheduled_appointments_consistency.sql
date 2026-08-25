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
-- Fix, mirroring activities EXACTLY (activities_enforce_org_consistency +
-- activities_insert/update):
--   1. A BEFORE INSERT/UPDATE-OF-(deal_id, org_id) trigger overwrites org_id
--      with the deal's org_id, so the client can't spoof it. The function is
--      SECURITY INVOKER, so its `select ... from deals` is itself RLS-gated
--      (deals_select = org_id = user_org_id() AND user_can_see_owner): a deal
--      the caller can't see returns zero rows -> raises. That is what enforces
--      both cross-org and within-org hierarchy visibility at write time.
--   2. INSERT/UPDATE with-check requires org_id = user_org_id() (org isolation,
--      holds even for admins since org_id is now the deal's).
--
-- Deliberately scoped `update OF deal_id, org_id` (not every update) and the
-- UPDATE with-check is org-only (no user_can_see_owner re-check): otherwise a
-- rep couldn't cancel / record the outcome on their OWN existing appointment
-- once its deal was reassigned outside their subtree (a routine action) --
-- every status-only update would re-run the now-failing deal lookup and raise.
-- Re-pointing deal_id to an unseen deal IS still blocked, because THAT update
-- changes deal_id, so the trigger fires and its RLS-gated lookup raises.
--
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
  before insert or update of deal_id, org_id on scheduled_appointments
  for each row execute function public.scheduled_appointments_enforce_org_consistency();

-- INSERT: own row; org (forced from the deal by the trigger) must equal the
-- caller's org. Deal visibility is enforced by the trigger's RLS-gated lookup.
drop policy if exists scheduled_appointments_insert on scheduled_appointments;
create policy scheduled_appointments_insert on scheduled_appointments for insert with check (
  owner_id = auth.uid()
  and org_id = public.user_org_id()
);

-- UPDATE: own row, staying in the caller's org. Re-pointing deal_id to an
-- unseen deal is blocked by the trigger (it fires on deal_id change); a
-- status/outcome-only update on an owned row is NOT re-gated on deal
-- visibility, so it survives a later deal reassignment.
drop policy if exists scheduled_appointments_update on scheduled_appointments;
create policy scheduled_appointments_update on scheduled_appointments for update using (
  owner_id = auth.uid()
) with check (
  owner_id = auth.uid()
  and org_id = public.user_org_id()
);
