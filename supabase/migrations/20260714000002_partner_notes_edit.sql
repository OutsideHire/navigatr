-- Allow a note's AUTHOR to edit its text, and track when a note was last
-- edited so the feed can show an "edited" marker. Follow-up to
-- 20260714000001_partner_notes.sql (which was append-only: add + delete).

-- 1) updated_at. Backfill existing rows to created_at so nothing reads as
--    "edited" retroactively, THEN make it not-null + default now(). (On a
--    fresh insert now() == created_at within the statement, so a new note is
--    not "edited".)
alter table partner_notes add column updated_at timestamptz;
update partner_notes set updated_at = created_at where updated_at is null;
alter table partner_notes
  alter column updated_at set not null,
  alter column updated_at set default now();

-- 2) Bump updated_at on every UPDATE. Reuse the shared trigger fn (defined in
--    20260519000001_deals.sql). Created AFTER the backfill above so the
--    backfill UPDATE doesn't fire it.
create trigger partner_notes_set_updated_at
  before update on partner_notes
  for each row execute function set_updated_at();

-- 3) Author-only UPDATE policy. Only the author can edit; with check keeps
--    created_by / org from being reassigned. (Managers/admins can still
--    delete via the existing delete policy, but cannot rewrite others' notes.)
create policy partner_notes_update on partner_notes for update
  using (
    org_id = public.user_org_id()
    and created_by = auth.uid()
  )
  with check (
    org_id = public.user_org_id()
    and created_by = auth.uid()
  );
