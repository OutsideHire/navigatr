-- 20260618000002_deal_notes_files.sql
-- Deal notes feed + file attachments. HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260618000002_deal_notes_files.sql
create table deal_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  deal_id    uuid not null references deals(id) on delete cascade,
  body       text not null,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index deal_notes_deal_idx on deal_notes (deal_id, created_at desc);
create or replace function deal_notes_set_org() returns trigger language plpgsql as $$
begin select org_id into new.org_id from deals where id = new.deal_id; return new; end $$;
create trigger deal_notes_set_org_trg before insert or update of deal_id on deal_notes
  for each row execute function deal_notes_set_org();
alter table deal_notes enable row level security;
create policy deal_notes_select on deal_notes for select using (org_id = public.user_org_id());
create policy deal_notes_insert on deal_notes for insert
  with check (org_id = public.user_org_id() and created_by = auth.uid());
create policy deal_notes_delete on deal_notes for delete
  using (org_id = public.user_org_id() and created_by = auth.uid());

create table deal_files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  deal_id      uuid not null references deals(id) on delete cascade,
  path         text not null,
  name         text not null,
  size_bytes   bigint not null,
  content_type text,
  uploaded_by  uuid not null references profiles(id) on delete restrict,
  created_at   timestamptz not null default now()
);
create index deal_files_deal_idx on deal_files (deal_id, created_at desc);
create or replace function deal_files_set_org() returns trigger language plpgsql as $$
begin select org_id into new.org_id from deals where id = new.deal_id; return new; end $$;
create trigger deal_files_set_org_trg before insert or update of deal_id on deal_files
  for each row execute function deal_files_set_org();
alter table deal_files enable row level security;
create policy deal_files_select on deal_files for select using (org_id = public.user_org_id());
create policy deal_files_insert on deal_files for insert
  with check (org_id = public.user_org_id() and uploaded_by = auth.uid());
create policy deal_files_delete on deal_files for delete using (org_id = public.user_org_id());

insert into storage.buckets (id, name, public) values ('deal-files', 'deal-files', false)
  on conflict (id) do nothing;
create policy "deal_files_obj_select" on storage.objects for select using (
  bucket_id = 'deal-files' and exists (
    select 1 from deals d where d.id::text = (storage.foldername(name))[1] and d.org_id = public.user_org_id()));
create policy "deal_files_obj_insert" on storage.objects for insert with check (
  bucket_id = 'deal-files' and exists (
    select 1 from deals d where d.id::text = (storage.foldername(name))[1] and d.org_id = public.user_org_id()));
create policy "deal_files_obj_delete" on storage.objects for delete using (
  bucket_id = 'deal-files' and exists (
    select 1 from deals d where d.id::text = (storage.foldername(name))[1] and d.org_id = public.user_org_id()));
