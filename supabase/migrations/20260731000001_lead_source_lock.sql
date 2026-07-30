-- LS-4: server-side enforcement of the "first touch, set once, then locked"
-- lead-source rule.
--
-- The rule (mirrors isLeadSourceEditable() in the app): a deal's lead_source is
-- written once at creation and locked thereafter, EXCEPT while it is still the
-- unset/catch-all state ('unknown' or 'other') — a rep may correct those. All
-- committed sources (path, partner_referral, assigned, import,
-- self_sourced_canvass, customer_referral, event_association, inbound) are
-- immutable once set.
--
-- Until now this was enforced only in the browser (EditDealSheet hides the field
-- once locked and gates submission). A direct PostgREST/API update could still
-- rewrite a locked source. This trigger makes the invariant authoritative at the
-- database, independent of the client. lead_source_note stays freely editable —
-- only the source value itself is locked.
--
-- INSERT is unaffected (creation is where the source is set). The trigger fires
-- BEFORE UPDATE and only when lead_source actually changes, so unrelated edits
-- (stage moves, value/contact/note updates) that carry the unchanged value
-- through PostgREST are no-ops here.

create or replace function public.enforce_lead_source_lock()
returns trigger
language plpgsql as $$
begin
  -- Only care when lead_source is actually changing.
  if new.lead_source is distinct from old.lead_source then
    -- Editable only from the unset/catch-all states; anything else is locked.
    if old.lead_source is not null
       and old.lead_source not in ('unknown', 'other') then
      raise exception
        'lead_source is locked once set (deal %: cannot change % to %)',
        old.id, old.lead_source, new.lead_source
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists deals_lead_source_lock on public.deals;
create trigger deals_lead_source_lock
  before update on public.deals
  for each row execute function public.enforce_lead_source_lock();
