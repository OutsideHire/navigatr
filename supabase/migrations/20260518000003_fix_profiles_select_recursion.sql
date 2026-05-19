-- The profiles_select policy queries profiles in its USING clause:
--
--   using (
--     id = auth.uid()
--     or org_id = (select p.org_id from profiles p where p.id = auth.uid())
--   )
--
-- The subquery re-triggers the same policy → infinite recursion. Postgres
-- aborts and PostgREST returns HTTP 500 on every read, which the frontend
-- amplifies into a redirect loop (ProtectedRoute sees no profile, bounces
-- to /auth/callback, which re-queries, which 500s again).
--
-- Fix: call public.user_org_id() instead. It's SECURITY DEFINER owned by
-- a role that bypasses RLS, so the inner select does NOT recurse through
-- the policy.

drop policy if exists profiles_select on profiles;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or org_id = public.user_org_id()
  );

-- Same hazard on the UPDATE policy's with-check.
drop policy if exists profiles_update on profiles;

create policy profiles_update on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and org_id = public.user_org_id()
    and role   = public.user_role()
  );
