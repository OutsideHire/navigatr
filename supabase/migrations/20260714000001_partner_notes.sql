-- partner_notes: append-only memo feed on a partner. Distinct from
-- partner_activities: a NOTE here is NOT contact — it must not move
-- partners.last_touch_at / next_followup_at. So, unlike partner_activities,
-- this table has NO sync-to-partner trigger. It is also append-only: there
-- is no UPDATE policy (notes are never edited, only added or deleted).
--
-- Tenancy + org-consistency mirror partner_activities exactly.

create table partner_notes (
  id          uuid primary key default gen_random_uuid(),

  -- Tenancy. Denorm org_id mirrors partner.org_id; trigger enforces.
  org_id      uuid not null references organizations(id) on delete cascade,
  partner_id  uuid not null references partners(id)      on delete cascade,

  -- Author. on delete restrict so the note's attribution survives a rep
  -- leaving; managers can still delete the note via the delete policy.
  created_by  uuid not null references profiles(id) on delete restrict,

  -- The note text. Non-empty, bounded.
  body        text not null check (char_length(body) between 1 and 4000),

  created_at  timestamptz not null default now()
);

-- Per-partner feed (most common access pattern) + org-wide feed.
create index partner_notes_partner_at_idx on partner_notes (partner_id, created_at desc);
create index partner_notes_org_at_idx     on partner_notes (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Org-consistency trigger — authoritative org_id is partners.org_id.
-- Same hazard/shape as partner_activities_enforce_org_consistency.
-- ---------------------------------------------------------------------------
create or replace function partner_notes_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_partner_org uuid;
begin
  select p.org_id into v_partner_org from partners p where p.id = new.partner_id;
  if v_partner_org is null then
    raise exception 'partner_notes references non-existent partner';
  end if;
  new.org_id := v_partner_org;
  return new;
end $$;

create trigger partner_notes_enforce_org_consistency_trg
  before insert or update of partner_id, org_id on partner_notes
  for each row execute function partner_notes_enforce_org_consistency();

-- NOTE: intentionally NO sync trigger to partners. Adding a note is not a
-- touch; last_touch_at / next_followup_at must stay driven solely by
-- partner_activities.

-- ---------------------------------------------------------------------------
-- RLS. Select/insert mirror partner_activities. Delete allows the author OR
-- a manager/admin. NO update policy → editing an existing note is denied.
-- ---------------------------------------------------------------------------
alter table partner_notes enable row level security;

create policy partner_notes_select on partner_notes for select
  using (org_id = public.user_org_id());

create policy partner_notes_insert on partner_notes for insert
  with check (
    org_id     = public.user_org_id()
    and created_by = auth.uid()
  );

create policy partner_notes_delete on partner_notes for delete
  using (
    org_id = public.user_org_id()
    and (
      public.user_role() in ('manager', 'admin')
      or created_by = auth.uid()
    )
  );
