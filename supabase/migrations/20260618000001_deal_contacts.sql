-- 20260618000001_deal_contacts.sql
-- Additional contacts per deal (the deal's primary contact stays on `deals`).
-- HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260618000001_deal_contacts.sql
create table deal_contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  deal_id     uuid not null references deals(id) on delete cascade,
  name        text not null,
  title       text,
  email       text,
  phone       text,
  role        text,
  note        text,
  created_by  uuid not null references profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index deal_contacts_deal_idx on deal_contacts (deal_id, created_at);

-- org_id is derived from the parent deal so the client never sends it and it can't drift.
create or replace function deal_contacts_set_org() returns trigger language plpgsql as $$
begin
  select org_id into new.org_id from deals where id = new.deal_id;
  return new;
end $$;
create trigger deal_contacts_set_org_trg
  before insert or update of deal_id on deal_contacts
  for each row execute function deal_contacts_set_org();

create trigger deal_contacts_set_updated_at
  before update on deal_contacts for each row execute function set_updated_at();

alter table deal_contacts enable row level security;
create policy deal_contacts_select on deal_contacts for select using (org_id = public.user_org_id());
create policy deal_contacts_insert on deal_contacts for insert
  with check (org_id = public.user_org_id() and created_by = auth.uid());
create policy deal_contacts_update on deal_contacts for update
  using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy deal_contacts_delete on deal_contacts for delete using (org_id = public.user_org_id());
