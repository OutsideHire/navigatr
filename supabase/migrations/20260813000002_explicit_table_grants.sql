-- Make table privileges explicit, and take `anon` out of the picture entirely.
--
-- WHY THIS EXISTS (determinism). Until now this repo contained no GRANT
-- statements at all. Every table was reachable only because of Supabase's stock
-- default privileges, which are a property of the Postgres IMAGE rather than of
-- anything we wrote down. Those defaults changed between images: CLI 2.98.2
-- ships postgres 17.6.1.121 and grants broadly; 2.113.0 ships 17.6.1.158 and
-- grants far less. Building the same 111 migrations on the two images produces
-- databases where different tables are readable, which CI proved on 2026-08-12
-- when four RLS tests failed with "permission denied" on the newer image while
-- passing locally.
--
-- Two consequences that this migration closes:
--   * a staging project created on a newer CLI would have NO table access and
--     look catastrophically broken while production was fine;
--   * after any future platform upgrade, a NEW table added by a later migration
--     would silently not be readable by the app, and the symptom would be a
--     feature that quietly returns nothing.
--
-- WHY `anon` IS REVOKED (defence in depth). `anon` is the role for logged-out
-- requests made with the publishable key that ships in the browser bundle. It
-- held DELETE, INSERT, SELECT, UPDATE and TRUNCATE on 33 of 34 tables, with RLS
-- as the ONLY thing between the public internet and every row.
--
-- That is the documented Supabase model, not a misconfiguration. But it is also
-- exactly how business_holidays became world-writable: it was the one table
-- created without RLS (fixed 2026-08-12 in 20260812000002), and because `anon`
-- had full DML there was no second line of defence. Revoking `anon` means the
-- next table someone forgets to enable RLS on is invisible to the public rather
-- than editable by it.
--
-- Verified before writing this: nothing needs `anon` table access. No frontend
-- route queries a table before login; all 11 edge functions that build a client
-- with the anon key pass the caller's Authorization header, so they execute as
-- `authenticated`; and the invite and org-creation paths go through SECURITY
-- DEFINER functions, which need EXECUTE on the function rather than grants on
-- the tables. The business_holidays fix already revoked `anon` on one table on
-- 2026-08-12 with no breakage.

-- ---------------------------------------------------------------------------
-- 1. Existing tables: grant the four privileges PostgREST can actually use.
--
-- Deliberately NOT granting TRUNCATE, TRIGGER or REFERENCES, which the stock
-- defaults included. PostgREST exposes only SELECT/INSERT/UPDATE/DELETE, so
-- those three are unusable by an API client. TRUNCATE is worth calling out: it
-- is NOT subject to row-level security, so it is the one privilege where RLS
-- would not have saved us had it been reachable.
-- ---------------------------------------------------------------------------
-- The REVOKE is not redundant with the GRANT. On an image whose stock defaults
-- already granted everything, granting four privileges leaves the other three
-- in place, so the database would still differ from one built on an image with
-- no stock grants. Stating both makes the end state identical either way, which
-- is the entire point.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tablename);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Re-apply the two deliberate tightenings from 2026-08-12, which the blanket
--    grant above would otherwise have undone. Both are security fixes and both
--    must survive this migration.
-- ---------------------------------------------------------------------------

-- 20260812000001: UPDATE on profiles is revoked so newly added columns are not
-- writable by default. That default being writable was the self-escalation
-- hole (role_level, role_path, manager_id, deactivated_at). Every legitimate
-- profile write goes through a SECURITY DEFINER function.
revoke update on public.profiles from authenticated;

-- 20260812000002: business_holidays is a global, non-tenant-scoped calendar
-- read by business_days_between for every org. Read-only to authenticated;
-- writes are service-role and migration only.
revoke insert, update, delete on public.business_holidays from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Future tables. Without this, section 1 fixes today and nothing else: the
--    next migration to create a table would fall back to whatever the image's
--    defaults happen to be, which is the problem this migration exists to end.
--
--    ALTER DEFAULT PRIVILEGES applies to objects created by the current role,
--    which is the role migrations run as, so this covers tables created by
--    future migrations.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  revoke all on tables from anon;
