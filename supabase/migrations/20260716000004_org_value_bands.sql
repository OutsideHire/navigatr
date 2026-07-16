-- Configurable Activity-to-Win deal-value bands (PRD §3.3.A).
-- Two org-level thresholds (cents) define three bands: < low, low..high,
-- > high. NULL = use the app defaults (< $25K / $25-100K / > $100K). Written
-- via an admin-only SECURITY DEFINER RPC because organizations is select-only
-- from the client (mirrors update_org_profession). Idempotent / safe to re-run.

alter table organizations
  add column if not exists aw_value_band_low_cents  int,
  add column if not exists aw_value_band_high_cents int;

-- Admin/manager-only setter. Pass both NULL to reset to defaults; otherwise
-- both must be provided with 0 <= low < high.
create or replace function update_org_value_bands(p_low_cents int, p_high_cents int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_role   user_role;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role
    into v_org_id, v_role
    from profiles p
   where p.id = auth.uid();
  if v_role not in ('manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  -- Both NULL = reset to app defaults.
  if p_low_cents is null and p_high_cents is null then
    update organizations
       set aw_value_band_low_cents = null, aw_value_band_high_cents = null
     where id = v_org_id;
    return;
  end if;

  -- Both-or-neither, and a strictly increasing, non-negative pair.
  if p_low_cents is null or p_high_cents is null
     or p_low_cents < 0 or p_high_cents <= p_low_cents then
    raise exception 'invalid_bands';
  end if;

  update organizations
     set aw_value_band_low_cents = p_low_cents,
         aw_value_band_high_cents = p_high_cents
   where id = v_org_id;
end $$;

grant execute on function update_org_value_bands(int, int) to authenticated;
