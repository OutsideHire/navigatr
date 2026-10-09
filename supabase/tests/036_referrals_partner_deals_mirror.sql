-- Tests for 20261007000004: partner_deals rows mirror into referrals (this is what
-- the demo reseed relies on), deletes follow, and the app role can no longer write
-- partner_deals. The backfill uses the same SELECT as the mirror insert.
begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e5', 'Referral Mirror', 'ref-mirror', 'ref-mirror-a1');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e5000000-0000-0000-0000-000000000001', 'rep@rm.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('e5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'rep', 'sales_professional', 'Rep', 'rep@rm.example', 'rep'::ltree);
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e5a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'P', 'P CPA', 'cpa');
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage) values
  ('e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001', 'Won Co', 'C', 'c@rm.example', '+15550005001', 100, 'won');

insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
  ('e5a00000-0000-0000-0000-000000000001', 'e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001');

do $$ declare st text; src text; dir text; cn text; snap text; begin
  select status::text, source::text, direction, company_name, partner_company_snapshot
    into st, src, dir, cn, snap
    from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  if st <> 'won' or src <> 'rep_entered' or dir <> 'inbound' or cn <> 'Won Co' or snap <> 'P CPA' then
    raise exception 'mirror wrong: % % % % %', st, src, dir, cn, snap;
  end if;
end $$;

do $$ declare st text; n int; act text; begin
  delete from partner_deals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  select status::text into st from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  if st <> 'withdrawn' then raise exception 'delete should set status to withdrawn, got %', st; end if;
  select count(*) into n from referral_status_history where referral_id = (select id from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000001') and to_status = 'withdrawn' and actor_type = 'system';
  if n <> 1 then raise exception 'should have system history row to withdrawn'; end if;
end $$;

do $$ declare cn text; begin
  insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage) values
    ('e5d00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001', '   ', 'C2', 'c2@rm.example', '+15550005002', 100, 'submitted');
  insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
    ('e5a00000-0000-0000-0000-000000000001', 'e5d00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001');
  select company_name into cn from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000002';
  if cn <> 'Unnamed business' then raise exception 'whitespace company_name should map to "Unnamed business", got %', cn; end if;
end $$;

do $$ begin
  if not (select has_function_privilege('authenticated', 'public.partner_deals_mirror_to_referrals()', 'execute') = false) then
    raise exception 'authenticated should not have execute on mirror function';
  end if;
end $$;

do $$ begin
  perform set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
      ('e5a00000-0000-0000-0000-000000000001', 'e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001');
    raise exception 'app role insert into partner_deals should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
