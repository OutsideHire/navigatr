-- 20260529000002_account_deletion.sql
--
-- GDPR "right to be forgotten" via ANONYMIZATION.
--
-- Why anonymization, not physical delete:
--   The user's profile is FK-referenced by deals.owner_id and
--   activities.logged_by, both with on-delete-restrict. A physical
--   DELETE would either fail (records exist) or orphan business
--   records the org legally needs to retain (pipeline history,
--   commission attribution, audit trail).
--
--   GDPR Article 17 accepts anonymization as a valid path: the data
--   subject's identifiable information is removed; the business
--   records persist but no longer link to a real person.
--
-- What this RPC does:
--   1. Generates a random suffix so multiple deletions don't collide
--      on the synthetic email.
--   2. Anonymizes profiles row:
--        full_name → "Deleted User"
--        email     → "deleted+<rand>@deleted.local"
--        deactivated_at → now()
--   3. Anonymizes auth.users.raw_user_meta_data → {}
--   4. Logs a user_actions event ('account.deleted') for audit.
--   5. Returns a small status object so the frontend can confirm.
--
-- What this RPC does NOT do:
--   - Sign the user out (frontend responsibility — call supabase.auth.signOut)
--   - Delete the auth.users row (Supabase Auth admin API only;
--     follow-up by ops if a hard delete is requested in writing)
--   - Cascade-delete deals/activities (anonymization preserves them)
--
-- Authz:
--   SECURITY DEFINER so the function can touch profiles + auth.users
--   regardless of the caller's RLS. Self-only: caller can only delete
--   their own account; no admin-can-delete-anyone path here (that
--   would be a different RPC with role checks).

create or replace function public.request_account_deletion()
returns table (
  status text,
  anonymized_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
  v_suffix  text;
  v_now     timestamptz := now();
begin
  -- Authz: must be signed in. The caller's identity comes from auth.uid()
  -- (the Supabase JWT subject). Service-role calls without a JWT context
  -- will hit this check and abort — no way to delete someone else.
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Capture the user's org for the audit event before we anonymize.
  select org_id into v_org_id from profiles where id = v_user_id;
  if v_org_id is null then
    -- No profile = nothing to anonymize. Still treat as success so the
    -- frontend's "delete account" flow doesn't get stuck.
    return query select 'no_profile'::text, v_now;
    return;
  end if;

  -- Random suffix prevents email collisions across multiple deletions
  -- and prevents anyone reverse-engineering the original from the
  -- anonymized value. encode(gen_random_bytes, 'hex') gives 16 hex chars.
  v_suffix := encode(extensions.gen_random_bytes(8), 'hex');

  -- Anonymize the profile. Note: deactivated_at was added by the admin
  -- portal migration; reusing it as the "no longer active" signal so
  -- existing RPCs and views that filter on deactivated_at already
  -- exclude this user.
  update profiles
     set full_name = 'Deleted User',
         email = 'deleted+' || v_suffix || '@deleted.local',
         deactivated_at = coalesce(deactivated_at, v_now),
         role_path = null  -- remove from hierarchy
   where id = v_user_id;

  -- Anonymize the auth.users metadata (the JWT may still hold the old
  -- name until the next refresh; the user's sign-out flow handles that).
  update auth.users
     set raw_user_meta_data = '{}'::jsonb
   where id = v_user_id;

  -- Audit trail. user_actions persists across the anonymization so we
  -- can prove a deletion request happened (which is itself a GDPR
  -- record-keeping requirement: who requested erasure and when).
  insert into user_actions (org_id, user_id, action_type, payload)
  values (
    v_org_id,
    v_user_id,
    'account.deleted',
    jsonb_build_object('anonymized_at', v_now, 'method', 'self_service_rpc')
  );

  return query select 'anonymized'::text, v_now;
end $$;

grant execute on function public.request_account_deletion() to authenticated;

-- Note on hard-delete path: if a regulator demands physical row deletion
-- (rare; anonymization usually satisfies), the ops team can run:
--   delete from auth.users where id = '<uuid>';
-- after manually reassigning any deals/activities owned by that user
-- to the org's "former employee" placeholder profile. That's a manual
-- two-step because deals.owner_id is on-delete-restrict.
