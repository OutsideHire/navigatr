-- Demo data reset (single account, flag-gated). Wipes the caller's working
-- data and reseeds a curated fixture. Gated by the 'demo_reset' org feature
-- flag so it can only ever affect an org that has been explicitly opted in.
-- Idempotent by nature (delete-then-insert). Apply via the Supabase SQL editor.

create or replace function reset_demo_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id  uuid;
  v_role    user_role;
  v_owner   uuid := auth.uid();
begin
  -- Gate
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;
  select p.org_id, p.role into v_org_id, v_role from profiles p where p.id = v_owner;
  if v_role <> 'admin' then
    raise exception 'not_authorized';
  end if;
  if not exists (
    select 1 from org_features
    where org_id = v_org_id and feature_key = 'demo_reset' and enabled
  ) then
    raise exception 'demo_reset_not_enabled';
  end if;

  -- Triggers off for this txn: we set every column (incl. Activity-to-Win
  -- snapshot cols + stage history) explicitly in the reseed (later task), and
  -- we delete child tables by hand. SET LOCAL auto-reverts at commit.
  -- NOTE: in replica mode ON DELETE CASCADE does NOT fire, so deletes MUST be
  -- child-first and explicit.
  set local session_replication_role = replica;

  -- Wipe (child-first; only this org)
  -- coverage_signal references deals(id) on delete cascade; that cascade
  -- does not fire in replica mode, so it must be cleared before deals.
  delete from coverage_signal        where org_id = v_org_id;
  delete from activities              where org_id = v_org_id;
  delete from deal_stage_history      where org_id = v_org_id;
  delete from partner_deals           where org_id = v_org_id;
  delete from scheduled_appointments  where org_id = v_org_id;
  delete from deal_notes              where org_id = v_org_id;
  delete from deal_files              where org_id = v_org_id;
  delete from deal_contacts           where org_id = v_org_id;
  delete from partner_activities      where org_id = v_org_id;
  delete from partner_notes           where org_id = v_org_id;
  delete from path_stops              where path_id in (select id from paths where user_id = v_owner);
  delete from deals                   where org_id = v_org_id;
  delete from partners                where org_id = v_org_id;
  delete from paths                   where user_id = v_owner;
  -- NOTE: `prospects` intentionally NOT wiped here — it is a platform-shared
  -- geospatial cache (see 20260531000001_path_prospect_store.sql), not
  -- org-scoped data. It has no org_id column and is shared read-only across
  -- every tenant, so it is out of scope for a single-org demo reset.

  -- Reseed (later task fills this in)

end $$;

grant execute on function reset_demo_data() to authenticated;
