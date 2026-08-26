-- Tests for migration 20260826000001_peek_invite.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/024_peek_invite.sql
--
-- Self-cleans via ROLLBACK. Verifies peek_invite returns minimal invite
-- metadata for a LIVE token and NOTHING for accepted / revoked / expired /
-- unknown tokens, and that anon + authenticated can execute it (it must work
-- before sign-in). Runs as the superuser test role; the function is SECURITY
-- DEFINER so the caller role does not change what it returns.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000ee', 'Peek Org', 'peek-org', 'peek-org-code');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('ee000000-0000-0000-0000-000000000001', 'ivy@peek.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('ee000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ee', 'admin', 'administrator', 'Inviter Ivy', 'ivy@peek.example', 'ivy'::ltree);

insert into org_invites (org_id, email, full_name, role, role_level, token, invited_by, expires_at, accepted_at, revoked_at) values
  ('00000000-0000-0000-0000-0000000000ee', 'newrep@peek.example', 'New Rep', 'rep', 'sales_professional', 'tok-valid',    'ee000000-0000-0000-0000-000000000001', now() + interval '14 days', null,  null),
  ('00000000-0000-0000-0000-0000000000ee', 'acc@peek.example',    'Acc',     'rep', 'sales_professional', 'tok-accepted', 'ee000000-0000-0000-0000-000000000001', now() + interval '14 days', now(), null),
  ('00000000-0000-0000-0000-0000000000ee', 'rev@peek.example',    'Rev',     'rep', 'sales_professional', 'tok-revoked',  'ee000000-0000-0000-0000-000000000001', now() + interval '14 days', null,  now()),
  ('00000000-0000-0000-0000-0000000000ee', 'exp@peek.example',    'Exp',     'rep', 'sales_professional', 'tok-expired',  'ee000000-0000-0000-0000-000000000001', now() - interval '1 day',   null,  null);

-- ── Live token returns exactly the minimal metadata. ──
do $$
declare r record; n int;
begin
  select count(*) into n from peek_invite('tok-valid');
  if n <> 1 then raise exception 'live token: expected 1 row, got %', n; end if;
  select * into r from peek_invite('tok-valid');
  if r.org_name <> 'Peek Org' then raise exception 'org_name wrong: %', r.org_name; end if;
  if r.role_level <> 'sales_professional' then raise exception 'role_level wrong: %', r.role_level; end if;
  if r.inviter_name <> 'Inviter Ivy' then raise exception 'inviter_name wrong: %', r.inviter_name; end if;
  if r.invitee_email <> 'newrep@peek.example' then raise exception 'invitee_email wrong: %', r.invitee_email; end if;
  if r.invitee_full_name <> 'New Rep' then raise exception 'invitee_full_name wrong: %', r.invitee_full_name; end if;
end $$;

-- ── Accepted / revoked / expired / unknown tokens return nothing. ──
do $$
declare n int;
begin
  select count(*) into n from peek_invite('tok-accepted'); if n <> 0 then raise exception 'accepted token must return nothing, got %', n; end if;
  select count(*) into n from peek_invite('tok-revoked');  if n <> 0 then raise exception 'revoked token must return nothing, got %', n; end if;
  select count(*) into n from peek_invite('tok-expired');  if n <> 0 then raise exception 'expired token must return nothing, got %', n; end if;
  select count(*) into n from peek_invite('tok-does-not-exist'); if n <> 0 then raise exception 'unknown token must return nothing, got %', n; end if;
end $$;

-- ── Callable before sign-in: anon + authenticated have EXECUTE. ──
do $$
begin
  if not has_function_privilege('anon', 'public.peek_invite(text)', 'EXECUTE') then
    raise exception 'anon must be able to execute peek_invite (called before sign-in)';
  end if;
  if not has_function_privilege('authenticated', 'public.peek_invite(text)', 'EXECUTE') then
    raise exception 'authenticated must be able to execute peek_invite';
  end if;
end $$;

rollback;
