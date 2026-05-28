-- v1 foundation: schema scaffolding the entire PRD v1.0 build sits on top of.
-- Eight changes in one migration so they ship as an atomic unit — every one
-- of them is referenced by another, and a partial apply would leave the
-- database in a half-built state.
--
-- What's in here and why:
--   1. organizations.parent_org_id          → v2 ISO/MSP sub-tenancy forward-compat
--   2. profiles.role_path (ltree)           → 7-role hierarchy foundation (data only;
--                                              policy generator lands in a later migration)
--   3. deals/activities provenance          → so SF/HubSpot/Gmail synced rows can be
--                                              distinguished from manual entries and
--                                              de-duplicated against their source IDs
--   4. oauth_connections                    → one table for all 5 providers
--   5. sync_jobs                            → generic queue; adapter pattern populates it
--   6. user_actions                         → cheap forward-compat event log so v2 Miles
--                                              has training data from day one
--   7. org_branding                         → white-label settings per tenant
--   8. org_features                         → per-tenant feature flag table
--
-- Naming: keeps existing project convention (`org_id`, `organizations`). The
-- PRD calls these "tenants" but we're not renaming a working schema right now.
--
-- RLS: every new table is locked down with a select-only-your-org policy and
-- no insert/update/delete policies. Writes go through service-role Edge
-- Functions or admin RPCs — the rep client never writes directly.

-- ---------------------------------------------------------------------------
-- 1. organizations.parent_org_id
-- ---------------------------------------------------------------------------
-- Forward-compat for v2 ISO hierarchy (PRD §12.1.1 V1F-03). Nullable: every
-- v1 org has parent_org_id = NULL. When v2 lands and we onboard an MSP that
-- owns 5 ISOs, those ISO rows get parent_org_id = MSP's org id.
--
-- Self-referencing FK with on delete set null: deleting a parent doesn't
-- cascade and orphan every child (which would be catastrophic for a
-- multi-tenant CRM).
alter table organizations
  add column parent_org_id uuid references organizations(id) on delete set null;

create index organizations_parent_org_id_idx
  on organizations (parent_org_id)
  where parent_org_id is not null;

-- ---------------------------------------------------------------------------
-- 2. profiles.role_path (ltree)
-- ---------------------------------------------------------------------------
-- 7-role hierarchy: Admin → CSO → SVP → VP → Director → TerritoryManager →
-- SalesPro. ltree lets us answer "every rep under this VP at any depth" with
-- a single indexed `<@` query instead of recursive CTEs.
--
-- Existing user_role enum stays as-is for v1 RLS — we add role_path as a
-- parallel column. A later migration (the 7-role cutover) will (a) extend
-- the enum, (b) generate RLS policies against role_path, and (c) flip the
-- read path. By landing the column first we can backfill it incrementally.
--
-- Path format: lowercase, dot-separated label per level. Example for a rep
-- under VP "alex" under SVP "morgan" under CSO "pat":
--   'pat.morgan.alex.<rep-id-with-dashes-stripped>'
-- IDs at the leaf so ltree's <@ ancestor query works without label collisions.
create extension if not exists ltree;

alter table profiles
  add column role_path ltree;

create index profiles_role_path_gist_idx
  on profiles using gist (role_path);

-- ---------------------------------------------------------------------------
-- 3. Provenance fields on deals + activities
-- ---------------------------------------------------------------------------
-- Every record that can be synced from an external system needs to declare
-- where it came from. Without this, a Salesforce sync running nightly will
-- create duplicates the moment a rep also enters the same contact manually.
--
-- source: free-form lowercase identifier. 'manual' for rep entry; 'salesforce',
-- 'hubspot', 'gmail', 'outlook', 'google_calendar', 'outlook_calendar',
-- 'google_places' for integrations.
-- source_id: provider's stable ID for the record. NULL when source = 'manual'.
--
-- Unique index on (org_id, source, source_id) where source_id is not null:
-- prevents the same SF contact from being inserted twice into the same org,
-- but allows multiple manual records (where source_id is null).
alter table deals
  add column source    text not null default 'manual',
  add column source_id text;

create unique index deals_source_dedupe_idx
  on deals (org_id, source, source_id)
  where source_id is not null;

alter table activities
  add column source    text not null default 'manual',
  add column source_id text;

create unique index activities_source_dedupe_idx
  on activities (org_id, source, source_id)
  where source_id is not null;

-- ---------------------------------------------------------------------------
-- 4. oauth_connections
-- ---------------------------------------------------------------------------
-- One row per (org, user, provider). Tokens are NOT stored here — they go in
-- Supabase Vault, referenced by vault_secret_id. The client never reads this
-- table directly for tokens; Edge Functions resolve them server-side.
--
-- Why per-user, not per-org: Gmail / Outlook / Calendar are user-scoped (each
-- rep connects their own mailbox). Salesforce / HubSpot will typically also
-- be user-scoped at v1 (each rep connects their own seat); org-wide service
-- accounts are a v1.1 concern.
create table oauth_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id)      on delete cascade,
  provider        text not null check (provider in ('google','microsoft','salesforce','hubspot')),
  scopes          text[] not null default '{}',
  -- UUID pointer into Supabase Vault. The actual access_token / refresh_token
  -- are stored there, never in this row. NULL during the brief window between
  -- "user clicked Connect" and "OAuth callback completed".
  vault_secret_id uuid,
  status          text not null default 'pending' check (status in ('pending','active','expired','revoked','error')),
  last_error      text,
  connected_at    timestamptz,
  last_refreshed_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, user_id, provider)
);

create index oauth_connections_org_user_idx on oauth_connections (org_id, user_id);
create index oauth_connections_status_idx   on oauth_connections (status) where status in ('expired','error');

create trigger oauth_connections_set_updated_at
  before update on oauth_connections
  for each row execute function set_updated_at();

alter table oauth_connections enable row level security;

-- Reps see their own connections + admins see all org connections. No client-
-- side INSERT/UPDATE/DELETE — all writes go through Edge Functions (OAuth
-- callback handler, refresh worker, disconnect RPC) running as service role.
create policy oauth_connections_select on oauth_connections for select
  using (
    org_id = public.user_org_id()
    and (
      user_id = auth.uid()
      or public.user_role() in ('manager', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 5. sync_jobs
-- ---------------------------------------------------------------------------
-- Generic queue. Every integration's pull loop enqueues into this table;
-- a single Edge Function worker dequeues. Adapter pattern means the worker
-- dispatches on `kind` to the correct provider module.
--
-- payload jsonb: provider-specific. Salesforce contact pull payload looks
-- different from Gmail message pull payload — we don't normalize at the
-- queue layer.
create table sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  connection_id   uuid references oauth_connections(id) on delete cascade,
  kind            text not null,
  status          text not null default 'pending'
                  check (status in ('pending','running','succeeded','failed','dead')),
  payload         jsonb not null default '{}'::jsonb,
  attempts        int not null default 0,
  max_attempts    int not null default 5,
  last_error      text,
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- Worker dequeue query: "find pending jobs whose scheduled_for has passed,
-- oldest first." Partial index on status = 'pending' keeps it tiny even when
-- the table has millions of historical rows.
create index sync_jobs_pending_idx
  on sync_jobs (scheduled_for)
  where status = 'pending';

create index sync_jobs_org_status_idx on sync_jobs (org_id, status);

alter table sync_jobs enable row level security;

-- Admins can read their org's sync history (debugging stuck syncs).
-- No client-side writes — the worker runs as service role.
create policy sync_jobs_select on sync_jobs for select
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 6. user_actions (Miles forward-compat event log)
-- ---------------------------------------------------------------------------
-- Insurance against v2 Miles AI landing without training data. Every
-- meaningful user action (logged activity, stage change, deal created,
-- search performed) appends one row. Cheap now (single insert per action),
-- expensive to add later (we'd have to backfill from scratch).
--
-- Decision: emit from the frontend via an Edge Function endpoint, not via
-- per-table triggers. Triggers would couple every business write to event
-- shape changes; an explicit emit lets us version the schema independently.
create table user_actions (
  id           bigserial primary key,
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id)      on delete cascade,
  action_type  text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Time-series workload: append-heavy writes, range scans on read.
-- (org_id, created_at desc) covers "show me this org's last 1000 actions."
create index user_actions_org_time_idx on user_actions (org_id, created_at desc);
create index user_actions_user_time_idx on user_actions (user_id, created_at desc);
-- action_type filter is rare but cheap to add.
create index user_actions_action_type_idx on user_actions (action_type);

alter table user_actions enable row level security;

-- Admins read their org's stream. No one writes from the client — Edge
-- Function emits as service role after authenticating the caller.
create policy user_actions_select on user_actions for select
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 7. org_branding (white-label)
-- ---------------------------------------------------------------------------
-- One row per org. Optional — orgs without a row get the default navigatr
-- branding. logo_url points at a public Supabase Storage object; we don't
-- store the bytes here.
--
-- primary_color: 7-char hex including #. Validated at the form layer; we
-- don't constrain it in SQL because a future "named theme" picker may emit
-- non-hex values.
create table org_branding (
  org_id            uuid primary key references organizations(id) on delete cascade,
  logo_url          text,
  primary_color     text,
  product_name      text not null default 'navigatr',
  show_powered_by   boolean not null default true,
  -- Reserved for future theme tokens (secondary color, font, etc.) without
  -- requiring another migration per addition.
  extras            jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

create trigger org_branding_set_updated_at
  before update on org_branding
  for each row execute function set_updated_at();

alter table org_branding enable row level security;

-- Everyone in the org reads their branding (the app theme depends on it).
-- Writes are admin-only and go through an RPC — no direct client UPDATE.
create policy org_branding_select on org_branding for select
  using (org_id = public.user_org_id());

-- ---------------------------------------------------------------------------
-- 8. org_features (per-tenant feature flags)
-- ---------------------------------------------------------------------------
-- Composite key (org_id, feature_key). Absent row = feature disabled (default
-- closed). This lets us roll Salesforce sync, Partner Portal, profession
-- adaptation, etc. out per-org during staged ISO onboarding.
--
-- Why a table not a JSONB column on organizations: row-per-flag gives us
-- audit history per flag (who flipped it, when) once we add a trigger;
-- JSONB blobs are harder to query and audit.
create table org_features (
  org_id       uuid not null references organizations(id) on delete cascade,
  feature_key  text not null,
  enabled      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id),
  primary key (org_id, feature_key)
);

create trigger org_features_set_updated_at
  before update on org_features
  for each row execute function set_updated_at();

alter table org_features enable row level security;

-- Everyone in the org reads flags (UI gating depends on it). Writes go
-- through admin-only RPC.
create policy org_features_select on org_features for select
  using (org_id = public.user_org_id());

-- ---------------------------------------------------------------------------
-- Convenience helper: is_feature_enabled(feature_key)
-- ---------------------------------------------------------------------------
-- STABLE + SECURITY DEFINER so RLS policies on future tables can gate
-- visibility on a flag without exposing org_features structure.
-- Default closed: missing row = false.
create or replace function public.is_feature_enabled(p_feature_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select enabled from org_features
      where org_id = public.user_org_id()
        and feature_key = p_feature_key),
    false
  )
$$;

grant execute on function public.is_feature_enabled(text) to authenticated;
