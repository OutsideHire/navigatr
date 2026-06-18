# Deal Detail "Notes & Files" tab (2026-06-18)

Sub-project B of the Deal Detail placeholder tabs (Contacts shipped). Fills the "Notes &
Files" `PlaceholderTab` with a server-backed timestamped **notes feed** and **file
attachments**. Server-backed + RLS, consistent with the app; migration + bucket are
hand-applied.

## Decisions (baked — driven via /loop)

- **Notes** = a new `deal_notes` table (append-only feed: create / list / delete-own; **no
  edit**), separate from the deal's existing single freeform `notes` field (which stays as the
  deal description / stage-note sink).
- **Files** = a new `deal_files` table + a **private `deal-files` storage bucket**; storage
  access is scoped to **org members of the deal** (folder `[1]` = `deal_id`, joined to `deals`
  for the org check). Client validation: **max 10MB**, allowlist (images, `application/pdf`,
  common Office types, `text/csv`, `text/plain`).
- `org_id` on both tables is **trigger-derived from the parent deal** (like `deal_contacts`),
  so the client never sends it.

## Architecture

### A. Migration `supabase/migrations/20260618000002_deal_notes_files.sql` (hand-applied)
Two tables (each: `id`, `org_id`, `deal_id` FK→deals on delete cascade, `created_by`/
`uploaded_by` FK→profiles, `created_at`), a shared org-deriving trigger per table, RLS, and the
private bucket + storage policies.

```sql
-- deal_notes -------------------------------------------------------------
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
  using (org_id = public.user_org_id() and created_by = auth.uid());  -- delete own only

-- deal_files -------------------------------------------------------------
create table deal_files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  deal_id      uuid not null references deals(id) on delete cascade,
  path         text not null,            -- storage object path in 'deal-files'
  name         text not null,            -- original filename (display + download)
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

-- private bucket + storage RLS (org-of-the-deal via folder[1] = deal_id) --
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
```

### B. `lib/dealFileStorage.ts` (mirror `voiceNoteStorage.ts`)
```ts
const BUCKET = "deal-files";
export async function uploadDealFile(file: File, dealId: string): Promise<string>;  // path = `${dealId}/${crypto.randomUUID()}`
export async function signedUrlFor(path: string, expiresIn = 3600): Promise<string>;
export async function removeDealFile(path: string): Promise<void>;
```
Path intentionally omits the filename (avoids sanitization); original name lives in
`deal_files.name`. `uploadDealFile` passes `{ contentType: file.type }`.

### C. Hooks (`features/pipeline/hooks/`, mirror `useDealContacts`)
- Notes: `useDealNotes(dealId)` (list, `created_at desc`), `useCreateDealNote()` (`{dealId, body, created_by}`), `useDeleteDealNote()` (`{id, dealId}`). Key `["deal-notes", dealId]`.
- Files: `useDealFiles(dealId)` (list `deal_files` rows), `useUploadDealFile()` (validate → `uploadDealFile` → insert `deal_files` row `{deal_id, path, name, size_bytes, content_type, uploaded_by}`), `useDeleteDealFile()` (`removeDealFile(path)` → delete row). Key `["deal-files", dealId]`.

### D. Validation `lib/dealFileValidation.ts` (pure, tested)
`MAX_FILE_BYTES = 10*1024*1024`; `ALLOWED_TYPES` (image/*, application/pdf, Office MIME types, text/csv, text/plain); `validateFile(file): { ok: true } | { ok: false; reason: string }`.

### E. UI — `NotesAndFilesTab.tsx` (replaces the Notes & Files `PlaceholderTab`), props `{ deal }`
- **Notes** section: a composer (`NotesFieldWithMic` + "Add note" button, disabled when blank) above a reverse-chronological feed of note cards (body, author display, relative time, delete on own notes via `window.confirm`). Empty state.
- **Files** section: an upload control (`<input type="file">` / button) that validates via `validateFile` (toast on reject) then `useUploadDealFile`; a list of files (name, formatted size, uploaded-by, date) with **Download** (open `signedUrlFor(path)`) and **Delete** (confirm). Loading + empty states.

### F. Wiring
`DealDetailPage`: replace the Notes & Files `PlaceholderTab` with `<NotesAndFilesTab deal={deal} />`.

## Data flow

`DealDetailPage` → `NotesAndFilesTab(deal)` → `useDealNotes(deal.id)` + `useDealFiles(deal.id)`.
Create note → insert (org_id trigger-derived) → invalidate notes key. Upload file → validate →
storage upload → `deal_files` insert → invalidate files key. Download → signed URL. Delete →
remove + delete row (files) / delete row (notes) → invalidate.

## Error handling / edge cases

- **Blank note** → Add disabled; DB `not null` backstops.
- **Oversize / disallowed file** → `validateFile` rejects with a toast; no upload.
- **Upload partial failure** (storage ok, row insert fails) → toast; best-effort `removeDealFile`
  to avoid an orphan object (documented; not transactional).
- **Delete own-only for notes** (RLS); files deletable by any org member.
- **Org isolation** — trigger + RLS + storage policies; can't attach to another org's deal.
- **Signed URL** short-lived (1h); regenerated per download click.

## Testing

- `dealFileValidation`: accepts an allowed small file; rejects oversize; rejects disallowed type.
- `dealFileStorage`: `uploadDealFile` uploads under `${dealId}/...` and returns the path;
  `signedUrlFor` returns the signed URL; `removeDealFile` calls remove (mocked supabase storage).
- Hook tests (mocked supabase, mirror `useDealContacts.test.tsx`): notes list/create/delete +
  invalidation; files list/upload(validate+insert)/delete + invalidation.
- `NotesAndFilesTab`: composer adds a note (calls create); note feed + empty state render; file
  list renders; selecting an oversize/bad file shows the reject toast (no upload); download/delete
  wired. Use the Radix/jsdom polyfills as needed.
- `DealDetailPage`: the Notes & Files tab renders the composer/sections (not "Coming in sprint 2").

## Out of scope

Editing notes (append-only); file previews/thumbnails; drag-and-drop upload (a plain picker is
fine); virus scanning; per-file permissions beyond org; versioning. Partner-referral depth,
quick-action integrations, and other Pipeline threads are separate.
