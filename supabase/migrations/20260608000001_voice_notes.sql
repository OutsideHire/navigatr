-- 20260608000001_voice_notes.sql
-- Voice notes (Phase 1, audio-only): adds activities.voice_note_url + a PRIVATE
-- 'voice-notes' storage bucket with owner-folder RLS.
-- HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260608000001_voice_notes.sql
-- Owner-folder access means only the uploading rep can read/sign their own notes
-- (acceptable for Phase 1 "note to self"; org-wide playback is a Phase 2 concern).

alter table activities add column if not exists voice_note_url text;

insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

create policy "voice_notes_insert_own" on storage.objects for insert
  with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice_notes_select_own" on storage.objects for select
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice_notes_delete_own" on storage.objects for delete
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
