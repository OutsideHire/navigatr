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
-- Scope note: this migration tightens SELECT (the read exposure). The child
-- write policies (insert/update/delete) and partner_deals (which needs its own
-- partner-vs-deal visibility analysis) are a separate follow-up.

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
