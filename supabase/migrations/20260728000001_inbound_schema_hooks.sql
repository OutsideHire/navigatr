-- 20260728000001_inbound_schema_hooks.sql
--
-- Forward-compatibility only (addendum 5.1). No code reads or writes this
-- table yet; the inbound-capture feature (deferred) will populate it.
-- Defined now because schema hooks are cheap now and expensive to
-- retrofit. This migration is define-only: it adds a column with a safe
-- default, an enum, and a new table, none of which any current code path
-- selects, inserts, or updates.

-- ---------------------------------------------------------------------------
-- 1) source_class enum
-- ---------------------------------------------------------------------------
-- How a signal/activity was originated. Everything the product captures
-- today is manual (a rep tapping through the app). cpaas_detected covers
-- the future inbound-capture layer (call/text/email detected via a CPaaS
-- provider, e.g. Twilio). device_detected and integration are placeholder
-- siblings for other future capture paths (native call log, CRM/PBX
-- integration) so the enum doesn't need another migration for the next
-- obvious case. Populated nowhere yet.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'source_class') then
    create type source_class as enum ('manual', 'cpaas_detected', 'device_detected', 'integration');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) activities.direction
-- ---------------------------------------------------------------------------
-- Every activity captured today is rep-initiated (outbound). direction is
-- added now with a default so existing rows and existing inserts (which do
-- not set this column, e.g. useLogActivity) are unaffected. Inbound rows
-- will be populated later by the inbound-capture layer, not by this
-- migration.
alter table activities add column if not exists direction text not null default 'outbound';
alter table activities drop constraint if exists activities_direction_check;
alter table activities add constraint activities_direction_check
  check (direction in ('inbound', 'outbound'));

-- ---------------------------------------------------------------------------
-- 3) inbound_signal
-- ---------------------------------------------------------------------------
-- Forward-compat table mirroring coverage_signal's shape (see
-- 20260624000002_coverage_signal.sql): denormalized org_id enforced by a
-- trigger, rep-private RLS (select/insert only, keyed on user_id), no
-- update/delete. Unlike coverage_signal, deal_id is nullable here: an
-- inbound call/text/email can be detected before it is matched to any
-- deal (that matching is future work, same as coverage_signal's
-- matched_activity_id). Nothing inserts into this table yet.
create table if not exists inbound_signal (
  id               uuid primary key default gen_random_uuid(),

  -- Tenancy. Denormalized org_id, kept consistent by the trigger below.
  -- Nullable only until a deal_id is set (then the trigger fills it from
  -- the deal); a row with no deal_id must still be inserted with an
  -- explicit org_id, enforced by the with-check on the insert policy.
  org_id           uuid references organizations(id) on delete cascade,

  -- The rep the signal belongs to.
  user_id          uuid not null references profiles(id) on delete restrict,

  -- Optional link to a deal, once/if the inbound-capture layer can match
  -- one. Null means unmatched (e.g. inbound call from an unknown number).
  deal_id          uuid references deals(id) on delete cascade,

  signal_type      text not null check (signal_type in ('inbound_call', 'inbound_text', 'inbound_email')),
  source_class     source_class not null default 'cpaas_detected',
  detected_at      timestamptz not null default now(),
  source_metadata  jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now()
);

create index if not exists inbound_signal_user_detected_idx on inbound_signal (user_id, detected_at desc);
create index if not exists inbound_signal_deal_idx           on inbound_signal (deal_id);

-- Org consistency: when deal_id is set, overwrite org_id from the parent
-- deal so a malformed client payload cannot escape RLS isolation (mirrors
-- activities / coverage_signal). When deal_id is null there is no deal to
-- pull org_id from, so org_id is left as supplied by the caller and the
-- insert policy's with-check is what pins it to the caller's own org.
create or replace function inbound_signal_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_deal_org uuid;
begin
  if new.deal_id is not null then
    select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
    if v_deal_org is null then
      raise exception 'inbound_signal references non-existent deal';
    end if;
    new.org_id := v_deal_org;
  end if;
  return new;
end $$;

drop trigger if exists inbound_signal_enforce_org_consistency_trg on inbound_signal;
create trigger inbound_signal_enforce_org_consistency_trg
  before insert or update of deal_id, org_id on inbound_signal
  for each row execute function inbound_signal_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- RLS. rep-only, same pattern as coverage_signal: a rep inserts + selects
-- only their own signals. No update/delete from the client, no
-- manager/admin read path (unmatched signals are rep-private).
-- ---------------------------------------------------------------------------
alter table inbound_signal enable row level security;

drop policy if exists inbound_signal_select on inbound_signal;
create policy inbound_signal_select on inbound_signal for select
  using (user_id = auth.uid());

drop policy if exists inbound_signal_insert on inbound_signal;
create policy inbound_signal_insert on inbound_signal for insert
  with check (org_id = public.user_org_id() and user_id = auth.uid());
