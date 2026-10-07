-- Tests for 20261007000002: a linked referral's status follows its deal's stage.
-- Self-cleans via ROLLBACK.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e3', 'Referral Sync', 'ref-sync', 'ref-sync-a1');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e3000000-0000-0000-0000-000000000001', 'rep@rs.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('e3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'rep', 'sales_professional', 'Rep', 'rep@rs.example', 'rep'::ltree);
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e3a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'P', 'P CPA', 'cpa');
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('e3d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'Linked Co',    'C', 'c@rs.example', '+15550003001', 100),
  ('e3d00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'Withdrawn Co', 'C', 'w@rs.example', '+15550003002', 100);
insert into referrals (id, org_id, partner_id, company_name, deal_id, status) values
  ('e3b00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3a00000-0000-0000-0000-000000000001', 'Linked Co',    'e3d00000-0000-0000-0000-000000000001', 'accepted'),
  ('e3b00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e3', 'e3a00000-0000-0000-0000-000000000001', 'Withdrawn Co', 'e3d00000-0000-0000-0000-000000000002', 'withdrawn');

create or replace function _t_status(p uuid) returns text language sql as $$
  select status::text from referrals where id = p
$$;

do $$ begin
  update deals set stage = 'contacted' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'working' then raise exception 'contacted should make the referral working'; end if;

  update deals set stage = 'won' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'won' then raise exception 'won deal should make the referral won'; end if;

  update deals set stage = 'lost' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'lost' then raise exception 'lost deal should make the referral lost'; end if;

  -- Reopen.
  update deals set stage = 'qualified' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'working' then raise exception 'reopened deal should move the referral back to working'; end if;

  -- Withdrawn and declined are never touched.
  update deals set stage = 'won' where id = 'e3d00000-0000-0000-0000-000000000002';
  if _t_status('e3b00000-0000-0000-0000-000000000002') <> 'withdrawn' then raise exception 'withdrawn referral must not follow the deal'; end if;
end $$;

-- History: insert + 4 transitions, the transitions all attributed to system.
do $$ declare n int; s int; begin
  select count(*), count(*) filter (where actor_type = 'system') into n, s
    from referral_status_history where referral_id = 'e3b00000-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'expected 5 history rows, got %', n; end if;
  if s <> 5 then raise exception 'expected all rows system-attributed, got %', s; end if;
end $$;

-- A non-stage update does not write history.
do $$ declare n int; begin
  update deals set value_cents = 999 where id = 'e3d00000-0000-0000-0000-000000000001';
  select count(*) into n from referral_status_history where referral_id = 'e3b00000-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'value change must not add history, got %', n; end if;
end $$;

rollback;
