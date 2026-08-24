-- 20260820000009_email_capture_data_model.sql
--
-- Automatic Email Activity Capture (PRD addendum), Phase 1 Slice 1: the data
-- model. Outlook-first, poll-based. NOTHING writes to these tables yet; the
-- ingest + connect edge functions (later slices, service-role) populate them,
-- and the feature stays dark until per-tenant enablement.
--
-- METADATA ONLY (PRD D-02): no bodies, previews, attachment files, filenames,
-- or inline images are ever stored. `has_attachments` is a boolean only (the
-- Q-03 spike confirmed Mail.ReadBasic exposes hasAttachments, not a count).
--
-- Auto-captured sent email becomes an activities row (later slice) with
-- type='email', capture_source='automatic', direction='outbound',
-- source_class='integration'. These tables hold the email-specific detail,
-- the unmatched queue, and per-rep connection health.
--
-- RLS fails closed: reads are limited to the sending rep + admins (there is no
-- manager/peer email surface in beta). All writes are reserved to the
-- service-role edge functions (they bypass RLS); UPDATE/DELETE are revoked from
-- authenticated, except the unmatched queue which a rep resolves themselves.

-- ---------------------------------------------------------------------------
-- 1. email_activity — captured metadata for a MATCHED sent email
-- ---------------------------------------------------------------------------
create table if not exists email_activity (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  -- The activity this email was written as (one-to-one). Cascade so it dies
  -- with the activity.
  activity_id         uuid not null unique references activities(id) on delete cascade,
  sender_user_id      uuid not null references profiles(id) on delete restrict,
  provider            text not null check (provider in ('outlook', 'gmail')),
  provider_message_id text not null,
  -- Message-ID header + conversation id, for thread-level dedup.
  internet_message_id text,
  thread_id           text,
  -- To/CC addresses only (BCC out of scope). Metadata, not content.
  recipients          jsonb not null default '[]'::jsonb,
  sent_at             timestamptz not null,
  subject             text,
  has_attachments     boolean not null default false,
  deep_link_url       text,
  -- Match result. matched_deal_id is the "account" in this app.
  matched_deal_id     uuid references deals(id) on delete set null,
  match_confidence    numeric,
  match_method        text,
  created_at          timestamptz not null default now(),
  -- One captured row per provider message (idempotent re-polls).
  unique (provider, provider_message_id)
);

create index email_activity_org_sent_idx    on email_activity (org_id, sent_at desc);
create index email_activity_sender_idx      on email_activity (sender_user_id, sent_at desc);
create index email_activity_deal_idx        on email_activity (matched_deal_id);

alter table email_activity enable row level security;

drop policy if exists email_activity_select on email_activity;
create policy email_activity_select on email_activity for select
  using (
    org_id = public.user_org_id()
    and (public.caller_is_admin() or sender_user_id = auth.uid())
  );

revoke insert, update, delete on email_activity from authenticated;

-- ---------------------------------------------------------------------------
-- 2. email_unmatched_queue — sends with no confident match (manual assign)
-- ---------------------------------------------------------------------------
create table if not exists email_unmatched_queue (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  sender_user_id      uuid not null references profiles(id) on delete restrict,
  provider            text not null check (provider in ('outlook', 'gmail')),
  provider_message_id text not null,
  internet_message_id text,
  thread_id           text,
  recipients          jsonb not null default '[]'::jsonb,
  sent_at             timestamptz not null,
  subject             text,
  has_attachments     boolean not null default false,
  deep_link_url       text,
  status              text not null default 'pending'
                        check (status in ('pending', 'assigned', 'dismissed')),
  assigned_deal_id    uuid references deals(id) on delete set null,
  -- Retention: unmatched sends are not kept beyond the queue window (PRD §11).
  expires_at          timestamptz not null default (now() + interval '30 days'),
  created_at          timestamptz not null default now(),
  unique (provider, provider_message_id)
);

create index email_unmatched_queue_sender_idx  on email_unmatched_queue (sender_user_id, status, sent_at desc);
create index email_unmatched_queue_org_idx     on email_unmatched_queue (org_id, status);
create index email_unmatched_queue_expires_idx on email_unmatched_queue (expires_at);

alter table email_unmatched_queue enable row level security;

drop policy if exists email_unmatched_queue_select on email_unmatched_queue;
create policy email_unmatched_queue_select on email_unmatched_queue for select
  using (
    org_id = public.user_org_id()
    and (public.caller_is_admin() or sender_user_id = auth.uid())
  );

-- The sending rep resolves their own queue (assign/dismiss); admins can too.
-- Insert stays service-role only.
drop policy if exists email_unmatched_queue_update on email_unmatched_queue;
create policy email_unmatched_queue_update on email_unmatched_queue for update
  using (
    org_id = public.user_org_id()
    and (public.caller_is_admin() or sender_user_id = auth.uid())
  )
  with check (
    org_id = public.user_org_id()
    and (public.caller_is_admin() or sender_user_id = auth.uid())
  );

revoke insert, delete on email_unmatched_queue from authenticated;

-- ---------------------------------------------------------------------------
-- 3. email_connection — per-rep provider connection + poll health
-- ---------------------------------------------------------------------------
create table if not exists email_connection (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  provider           text not null check (provider in ('outlook', 'gmail')),
  -- Capture starts at connect; no historical backfill (UI states this).
  capture_start_date timestamptz not null default now(),
  last_poll_at       timestamptz,
  -- Graph delta cursor for the Sent Items delta query.
  delta_token        text,
  health             text not null default 'ok'
                       check (health in ('ok', 'needs_reauth', 'error')),
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, provider)
);

create index email_connection_org_idx on email_connection (org_id, health);

alter table email_connection enable row level security;

-- The rep sees their own connection; admins see the org's (connection-health
-- view). Writes are service-role only (the connect + poll functions).
drop policy if exists email_connection_select on email_connection;
create policy email_connection_select on email_connection for select
  using (
    org_id = public.user_org_id()
    and (public.caller_is_admin() or user_id = auth.uid())
  );

revoke insert, update, delete on email_connection from authenticated;
