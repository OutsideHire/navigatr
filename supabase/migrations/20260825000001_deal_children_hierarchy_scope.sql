-- 20260825000001_deal_children_hierarchy_scope.sql
--
-- Scope the deal CHILD tables to the parent deal's hierarchy visibility.
--
-- The parent `deals` SELECT is hierarchy-gated (public.user_can_see_owner on
-- the owner's role_path; see 20260529000001 + 20260820000003), but the child
-- tables deal_notes / deal_contacts / deal_files / deal_stage_history still had
-- an org-wide SELECT (org_id = user_org_id()). So a rep could read notes,
-- contact PII (name/email/phone), files, and stage history for deals OUTSIDE
-- their assigned scope, even though the deal itself was hidden. That undercuts
-- the Roles & Permissions hierarchy.
--
-- Fix: gate each child's SELECT on the parent deal being visible, mirroring the
-- activities policy ("if you can see the deal, you see its children"). Org
-- isolation (user_org_id) is unchanged -- this only narrows WITHIN a tenant,
-- never across tenants. Self / subtree / admin keep full access via
-- user_can_see_owner. The deal-files storage blobs get the same gate so the
-- actual files follow their deal's visibility, not just the metadata rows.
--
-- Scope note: this migration tightens SELECT (the read exposure) AND the child
-- write policies (below), because the two are a pair: the org-wide duplicate-
-- check RPCs (find_place_duplicate_candidates / find_active_duplicate_deal) stay
-- org-wide by design so the whole org dedups against itself, and they hand a rep
-- an out-of-scope deal's id. With org-wide child writes, that id was enough to
-- INSERT/UPDATE/DELETE that deal's notes/contacts/files (even while unable to
-- read them). Gating writes on the same deal-visibility predicate closes that.
-- Still out of scope: partner_deals (needs its own partner-vs-deal analysis).

-- deal_contacts (contact PII: name / email / phone) -------------------------
drop policy if exists deal_contacts_select on deal_contacts;
create policy deal_contacts_select on deal_contacts for select using (
  org_id = public.user_org_id()
  and exists (
    select 1 from deals d
    where d.id = deal_contacts.deal_id and public.user_can_see_owner(d.owner_id)
  )
);

-- deal_notes ----------------------------------------------------------------
drop policy if exists deal_notes_select on deal_notes;
create policy deal_notes_select on deal_notes for select using (
  org_id = public.user_org_id()
  and exists (
    select 1 from deals d
    where d.id = deal_notes.deal_id and public.user_can_see_owner(d.owner_id)
  )
);

-- deal_files (metadata rows) ------------------------------------------------
drop policy if exists deal_files_select on deal_files;
create policy deal_files_select on deal_files for select using (
  org_id = public.user_org_id()
  and exists (
    select 1 from deals d
    where d.id = deal_files.deal_id and public.user_can_see_owner(d.owner_id)
  )
);

-- deal_stage_history --------------------------------------------------------
drop policy if exists deal_stage_history_select on deal_stage_history;
create policy deal_stage_history_select on deal_stage_history for select using (
  org_id = public.user_org_id()
  and exists (
    select 1 from deals d
    where d.id = deal_stage_history.deal_id and public.user_can_see_owner(d.owner_id)
  )
);

-- deal-files storage blobs: same visibility as the parent deal. The deal id is
-- the first path segment (storage.foldername(name))[1]. Unchanged: org scoping
-- + bucket. Added: user_can_see_owner on the deal's owner.
drop policy if exists "deal_files_obj_select" on storage.objects;
create policy "deal_files_obj_select" on storage.objects for select using (
  bucket_id = 'deal-files'
  and exists (
    select 1 from deals d
    where d.id::text = (storage.foldername(name))[1]
      and d.org_id = public.user_org_id()
      and public.user_can_see_owner(d.owner_id)
  )
);

-- ── Writes: same "parent deal must be visible" gate ────────────────────────
-- Each policy keeps its existing author check (created_by / uploaded_by) and
-- adds the deal-visibility predicate, so a rep can only write to children of a
-- deal they can actually see.

-- deal_contacts (previously any org member could edit/delete any contact)
drop policy if exists deal_contacts_insert on deal_contacts;
create policy deal_contacts_insert on deal_contacts for insert with check (
  org_id = public.user_org_id() and created_by = auth.uid()
  and exists (select 1 from deals d where d.id = deal_contacts.deal_id and public.user_can_see_owner(d.owner_id))
);
drop policy if exists deal_contacts_update on deal_contacts;
create policy deal_contacts_update on deal_contacts for update using (
  org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = deal_contacts.deal_id and public.user_can_see_owner(d.owner_id))
) with check (
  org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = deal_contacts.deal_id and public.user_can_see_owner(d.owner_id))
);
drop policy if exists deal_contacts_delete on deal_contacts;
create policy deal_contacts_delete on deal_contacts for delete using (
  org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = deal_contacts.deal_id and public.user_can_see_owner(d.owner_id))
);

-- deal_notes (insert + delete; no update policy exists)
drop policy if exists deal_notes_insert on deal_notes;
create policy deal_notes_insert on deal_notes for insert with check (
  org_id = public.user_org_id() and created_by = auth.uid()
  and exists (select 1 from deals d where d.id = deal_notes.deal_id and public.user_can_see_owner(d.owner_id))
);
drop policy if exists deal_notes_delete on deal_notes;
create policy deal_notes_delete on deal_notes for delete using (
  org_id = public.user_org_id() and created_by = auth.uid()
  and exists (select 1 from deals d where d.id = deal_notes.deal_id and public.user_can_see_owner(d.owner_id))
);

-- deal_files (insert + delete; no update policy exists)
drop policy if exists deal_files_insert on deal_files;
create policy deal_files_insert on deal_files for insert with check (
  org_id = public.user_org_id() and uploaded_by = auth.uid()
  and exists (select 1 from deals d where d.id = deal_files.deal_id and public.user_can_see_owner(d.owner_id))
);
drop policy if exists deal_files_delete on deal_files;
create policy deal_files_delete on deal_files for delete using (
  org_id = public.user_org_id()
  and exists (select 1 from deals d where d.id = deal_files.deal_id and public.user_can_see_owner(d.owner_id))
);

-- deal-files storage blobs: gate the actual upload/delete on the deal too.
drop policy if exists "deal_files_obj_insert" on storage.objects;
create policy "deal_files_obj_insert" on storage.objects for insert with check (
  bucket_id = 'deal-files'
  and exists (select 1 from deals d
    where d.id::text = (storage.foldername(name))[1]
      and d.org_id = public.user_org_id()
      and public.user_can_see_owner(d.owner_id))
);
drop policy if exists "deal_files_obj_delete" on storage.objects;
create policy "deal_files_obj_delete" on storage.objects for delete using (
  bucket_id = 'deal-files'
  and exists (select 1 from deals d
    where d.id::text = (storage.foldername(name))[1]
      and d.org_id = public.user_org_id()
      and public.user_can_see_owner(d.owner_id))
);
