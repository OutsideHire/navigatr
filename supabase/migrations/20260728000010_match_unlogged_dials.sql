-- 20260728000010_match_unlogged_dials.sql
-- Explicitly link a rep's unlogged call dials to the call activity they just
-- logged via the Unlogged Calls nudge. coverage_signal is insert-only to the
-- client (no UPDATE policy), so this security-definer RPC performs the stamp.
-- Idempotent (create or replace). Returns the number of dials matched.
create or replace function match_unlogged_dials(p_deal_id uuid, p_activity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- Defense in depth: the activity must be the caller's own and belong to the
  -- named deal, so a caller cannot stamp arbitrary dials with someone else's
  -- activity id.
  if not exists (
    select 1 from activities a
    where a.id = p_activity_id
      and a.logged_by = auth.uid()
      and a.deal_id = p_deal_id
  ) then
    raise exception 'activity not found for caller and deal';
  end if;

  update coverage_signal
     set matched_activity_id = p_activity_id,
         matched_at = now()
   where user_id = auth.uid()
     and deal_id = p_deal_id
     and matched_activity_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function match_unlogged_dials(uuid, uuid) to authenticated;
