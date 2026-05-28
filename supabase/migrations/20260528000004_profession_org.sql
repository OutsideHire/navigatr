-- 20260528000004_profession_org.sql
--
-- Per-org profession + optional per-org override of terminology and field
-- visibility. Layers on top of the per-user profession that currently lives
-- in auth.users.raw_user_meta_data — does NOT replace it. The existing
-- per-user profession remains the runtime default for legacy users; the
-- org-level value takes priority for new code paths that read via the
-- useTerm / useFieldVisible hooks landing in this PR.
--
-- Why org-level + user-level both:
--   1. PRD §3.3 calls for profession to drive UI at the org level — every
--      rep in a merchant-services ISO sees the same terminology, regardless
--      of what their personal profile said three years ago.
--   2. Migrating every existing user_metadata.profession to a profile
--      column + every component to read from it is a separate refactor.
--      This migration unblocks new feature work today without that lift.
--   3. Per-user profession stays useful as a fallback for orgs that
--      haven't set theirs yet.
--
-- Values stored as text (not an enum) so v1.1 can add new professions
-- without another migration. The frontend's TypeScript types stay the
-- source of truth for "what's valid"; bad values would surface in the UI
-- as missing terminology, not a database error.

-- ---------------------------------------------------------------------------
-- organizations.profession (nullable)
-- ---------------------------------------------------------------------------
-- NULL = inherit from per-user, same as today.
alter table organizations
  add column profession text;

-- Cheap index for "show me every org in profession X" admin queries.
-- Partial: orgs without a profession set are ~100% of the legacy fleet
-- on day one of this migration, no value in indexing those rows.
create index organizations_profession_idx
  on organizations (profession)
  where profession is not null;

-- ---------------------------------------------------------------------------
-- org_profession_config: optional per-org override of the baked-in defaults
-- ---------------------------------------------------------------------------
-- Most orgs will never have a row here. The frontend's TypeScript terminology
-- map (apps/app/src/features/profession/terminology.ts) carries the defaults.
-- An org gets a row only when their admin wants to customize a term ("we say
-- 'policy' not 'deal'") or hide a field ("we don't track annual_volume").
--
-- terminology shape: { "<term_key>": "<localized_label>" }
--   Keys come from the TermKey union in TypeScript. We don't constrain at
--   the DB layer because adding a new term key shouldn't require a migration.
--
-- hidden_fields: array of field names the form layer should not render.
-- pipeline_stages: optional override of the default stage list.
--
-- All defaults are non-null so the frontend can spread them safely without
-- coalesce gymnastics.
create table org_profession_config (
  org_id           uuid primary key references organizations(id) on delete cascade,
  terminology      jsonb   not null default '{}'::jsonb,
  hidden_fields    text[]  not null default '{}',
  pipeline_stages  text[]  not null default '{}',
  updated_at       timestamptz not null default now()
);

create trigger org_profession_config_set_updated_at
  before update on org_profession_config
  for each row execute function set_updated_at();

alter table org_profession_config enable row level security;

-- Everyone in the org reads their config (UI needs it on every render).
-- Writes go through the admin-only RPC below.
create policy org_profession_config_select on org_profession_config for select
  using (org_id = public.user_org_id());

-- ---------------------------------------------------------------------------
-- update_org_profession: admin-only setter for the simple case
-- ---------------------------------------------------------------------------
-- For just changing the profession (no terminology overrides). The richer
-- update_org_profession_config RPC below handles the override case. Keeping
-- the two separate so the common "switch from payroll to merchant_services"
-- flow doesn't need to know about the config row.
--
-- Validation: profession must be one of the values the frontend knows about,
-- enforced via a regex on the parameter (avoids a separate enum migration
-- when v1.1 adds a new profession).
create or replace function update_org_profession(p_profession text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_role   user_role;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role
    into v_org_id, v_role
    from profiles p
   where p.id = auth.uid();
  if v_role not in ('manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  -- NULL = explicit clear (fall back to per-user). Empty string treated
  -- the same way to keep the form-binding side simple.
  if p_profession is null or p_profession = '' then
    update organizations set profession = null where id = v_org_id;
    return null;
  end if;

  -- Whitelist matches the TypeScript Profession union as of this migration.
  -- Adding a new profession in v1.1 requires updating this regex AND the
  -- frontend's terminology map; the regex catch is the louder failure.
  if p_profession not in ('payroll', 'merchant_services', 'treasury_management') then
    raise exception 'invalid_profession';
  end if;

  update organizations set profession = p_profession where id = v_org_id;
  return p_profession;
end $$;

grant execute on function update_org_profession(text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_org_profession_config: admin-only override knobs
-- ---------------------------------------------------------------------------
-- Patch semantics matching update_org_branding: nullable params = "don't
-- change this field." Upserts via on-conflict so callers don't need to
-- know whether the row exists.
create or replace function update_org_profession_config(
  p_terminology      jsonb default null,
  p_hidden_fields    text[] default null,
  p_pipeline_stages  text[] default null
)
returns org_profession_config
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id  uuid;
  v_role    user_role;
  v_result  org_profession_config;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select p.org_id, p.role into v_org_id, v_role
    from profiles p where p.id = auth.uid();
  if v_role not in ('manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  insert into org_profession_config (
    org_id, terminology, hidden_fields, pipeline_stages
  ) values (
    v_org_id,
    coalesce(p_terminology, '{}'::jsonb),
    coalesce(p_hidden_fields, '{}'::text[]),
    coalesce(p_pipeline_stages, '{}'::text[])
  )
  on conflict (org_id) do update
    set terminology      = coalesce(p_terminology,     org_profession_config.terminology),
        hidden_fields    = coalesce(p_hidden_fields,   org_profession_config.hidden_fields),
        pipeline_stages  = coalesce(p_pipeline_stages, org_profession_config.pipeline_stages),
        updated_at       = now()
  returning * into v_result;

  return v_result;
end $$;

grant execute on function update_org_profession_config(jsonb, text[], text[]) to authenticated;
