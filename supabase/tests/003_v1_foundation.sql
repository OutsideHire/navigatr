-- Tests for migration 20260528000001_v1_foundation.
--
-- Run with service-role connection:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/003_v1_foundation.sql
--
-- Self-cleans via the wrapping transaction's rollback at the end. Each
-- `do $$` block raises on failure with a clear case label.

begin;

-- ---------------------------------------------------------------------------
-- Seed: a parent org and a child org pointing at it via parent_org_id.
-- ---------------------------------------------------------------------------
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000a1', 'MSP Parent',  'msp-parent',  'msp-parent-aaaa'),
  ('00000000-0000-0000-0000-0000000000a2', 'ISO Child A', 'iso-child-a', 'iso-child-a-bbbb'),
  ('00000000-0000-0000-0000-0000000000a3', 'ISO Child B', 'iso-child-b', 'iso-child-b-cccc');

update organizations set parent_org_id = '00000000-0000-0000-0000-0000000000a1'
  where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3');

-- ---------------------------------------------------------------------------
-- Case 1: parent_org_id self-reference works and the index is queryable.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from organizations
    where parent_org_id = '00000000-0000-0000-0000-0000000000a1';
  if n <> 2 then
    raise exception 'case1: expected 2 children, got %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: deleting parent sets child's parent_org_id to NULL (not cascade).
-- ---------------------------------------------------------------------------
do $$
declare v_parent uuid;
begin
  delete from organizations where id = '00000000-0000-0000-0000-0000000000a1';
  select parent_org_id into v_parent from organizations
    where id = '00000000-0000-0000-0000-0000000000a2';
  if v_parent is not null then
    raise exception 'case2: child parent_org_id should be NULL after parent delete, got %', v_parent;
  end if;
  -- Restore parent for downstream cases.
  insert into organizations (id, name, slug, invite_code)
    values ('00000000-0000-0000-0000-0000000000a1', 'MSP Parent', 'msp-parent', 'msp-parent-aaaa');
end $$;

-- ---------------------------------------------------------------------------
-- Case 3: ltree role_path supports ancestor queries (`<@`).
-- ---------------------------------------------------------------------------
-- Need a fake auth.users row first because profiles.id FKs into auth.users.
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at)
values
  ('20000000-0000-0000-0000-000000000001', 'cso@test.example',     'authenticated', 'authenticated', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'svp@test.example',     'authenticated', 'authenticated', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000003', 'rep@test.example',     'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, role_path) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'admin',   'CSO Carol',   'carol'::ltree),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'manager', 'SVP Sam',     'carol.sam'::ltree),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2', 'rep',     'Rep Riley',   'carol.sam.riley'::ltree);

do $$
declare n int;
begin
  -- "Every profile under carol" should be 3 (carol + sam + riley).
  select count(*) into n from profiles where role_path <@ 'carol'::ltree;
  if n <> 3 then
    raise exception 'case3a: expected 3 under carol, got %', n;
  end if;

  -- "Every profile strictly under sam" should be 1 (just riley).
  select count(*) into n from profiles where role_path <@ 'carol.sam'::ltree and role_path <> 'carol.sam'::ltree;
  if n <> 1 then
    raise exception 'case3b: expected 1 strict descendant of sam, got %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: provenance dedupe — same source+source_id in same org rejects.
-- ---------------------------------------------------------------------------
-- Need a deal to test against. Insert one manual and one synced.
insert into deals (
  id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone,
  value_cents, source, source_id
) values
  ('30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a2',
   '20000000-0000-0000-0000-000000000003',
   'Acme Co', 'Alice', 'alice@acme.example', '+15551234567',
   100000, 'salesforce', 'sf-001');

do $$
begin
  -- Same org + source + source_id should fail unique index.
  begin
    insert into deals (
      org_id, owner_id, company_name, contact_name, contact_email, contact_phone,
      value_cents, source, source_id
    ) values (
      '00000000-0000-0000-0000-0000000000a2',
      '20000000-0000-0000-0000-000000000003',
      'Acme Co Dup', 'Alice', 'alice@acme.example', '+15551234567',
      100000, 'salesforce', 'sf-001'
    );
    raise exception 'case4a: dedupe should have rejected duplicate source_id';
  exception when unique_violation then
    -- expected
    null;
  end;

  -- Manual entries (source_id IS NULL) can co-exist freely.
  insert into deals (
    org_id, owner_id, company_name, contact_name, contact_email, contact_phone,
    value_cents
  ) values
    ('00000000-0000-0000-0000-0000000000a2',
     '20000000-0000-0000-0000-000000000003',
     'Manual A', 'Bob', 'bob@a.example', '+15551112222', 50000),
    ('00000000-0000-0000-0000-0000000000a2',
     '20000000-0000-0000-0000-000000000003',
     'Manual B', 'Carol', 'carol@b.example', '+15553334444', 75000);
end $$;

-- ---------------------------------------------------------------------------
-- Case 5: oauth_connections unique (org_id, user_id, provider).
-- ---------------------------------------------------------------------------
do $$
begin
  insert into oauth_connections (org_id, user_id, provider, scopes)
    values ('00000000-0000-0000-0000-0000000000a2',
            '20000000-0000-0000-0000-000000000003',
            'google',
            array['gmail.send', 'calendar.read']);

  begin
    insert into oauth_connections (org_id, user_id, provider, scopes)
      values ('00000000-0000-0000-0000-0000000000a2',
              '20000000-0000-0000-0000-000000000003',
              'google',
              array['gmail.read']);
    raise exception 'case5: duplicate (org,user,provider) should have rejected';
  exception when unique_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Case 6: oauth_connections provider check constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into oauth_connections (org_id, user_id, provider)
      values ('00000000-0000-0000-0000-0000000000a2',
              '20000000-0000-0000-0000-000000000003',
              'pipedrive');
    raise exception 'case6: invalid provider should have rejected';
  exception when check_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Case 7: is_feature_enabled defaults closed; reads org_features when set.
-- ---------------------------------------------------------------------------
-- Run as a specific user via set-local jwt claim. set_config sets the GUC
-- request.jwt.claim.sub which auth.uid() resolves to.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000003';

do $$
begin
  if public.is_feature_enabled('salesforce_sync') then
    raise exception 'case7a: missing flag should default to false';
  end if;
end $$;

-- Enable for this org.
insert into org_features (org_id, feature_key, enabled)
  values ('00000000-0000-0000-0000-0000000000a2', 'salesforce_sync', true);

do $$
begin
  if not public.is_feature_enabled('salesforce_sync') then
    raise exception 'case7b: flag should be true after insert';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 8: sync_jobs status check constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into sync_jobs (org_id, kind, status)
      values ('00000000-0000-0000-0000-0000000000a2', 'contacts.pull', 'fnord');
    raise exception 'case8: invalid sync_jobs.status should have rejected';
  exception when check_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Case 9: user_actions append + index works (cheap smoke test).
-- ---------------------------------------------------------------------------
insert into user_actions (org_id, user_id, action_type, payload) values
  ('00000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-000000000003',
   'deal.created', jsonb_build_object('deal_id', '30000000-0000-0000-0000-000000000001'));

do $$
declare n int;
begin
  select count(*) into n from user_actions where org_id = '00000000-0000-0000-0000-0000000000a2';
  if n <> 1 then
    raise exception 'case9: expected 1 user_action, got %', n;
  end if;
end $$;

-- All cases passed.
rollback;
