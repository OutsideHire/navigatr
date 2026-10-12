-- 20261014000002_portal_email_outbox.sql
--
-- Partner Portal Phase 1C (spec 5.8, brief E1/E4/E5): one outbox for every
-- portal-related email. Rows are written only by SQL (the enqueue triggers in
-- 20261014000003 and enqueue_portal_nudges in 20261014000004) and drained by
-- the portal_notify edge function every 2 minutes.
--
-- A row never stores an email address. claim_portal_emails resolves the
-- recipient when the email is about to go out, so a partner suspended (or a rep
-- deactivated) after the row was queued gets nothing.
--
-- Service role only: anon and authenticated have no access to the table or the
-- functions.

create table portal_email_outbox (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  kind              text not null constraint portal_email_outbox_kind_check check (kind in (
                      'partner_received','partner_accepted','partner_not_moving_forward',
                      'partner_closed_won','partner_withdrawn','partner_update',
                      'internal_new_referral','internal_nudge')),
  referral_id       uuid references referrals(id) on delete cascade,
  portal_user_id    uuid references portal_users(id) on delete cascade,
  recipient_user_id uuid references profiles(id) on delete cascade,
  -- Allowlisted fields only (brief E1); built in SQL, re-validated in TS.
  payload           jsonb not null default '{}'::jsonb,
  dedupe_key        text not null constraint portal_email_outbox_dedupe_key_key unique,
  created_at        timestamptz not null default now(),
  attempts          integer not null default 0,
  last_attempt_at   timestamptz,
  last_error        text,
  sent_at           timestamptz,
  -- Deliberately not sent: email guard, recipient lost access, invalid payload.
  dropped_at        timestamptz,
  -- Gave up after 5 failed sends.
  failed_at         timestamptz,
  constraint portal_email_outbox_recipient_check check (
    case when kind like 'partner\_%'
         then portal_user_id is not null and recipient_user_id is null
         else recipient_user_id is not null and portal_user_id is null
    end)
);

create index portal_email_outbox_pending_idx on portal_email_outbox (created_at, id)
  where sent_at is null and dropped_at is null and failed_at is null;
create index portal_email_outbox_org_idx on portal_email_outbox (org_id, created_at);

alter table portal_email_outbox enable row level security;
revoke all on portal_email_outbox from anon;
revoke all on portal_email_outbox from authenticated;

-- Claim a batch. FOR UPDATE SKIP LOCKED lets two overlapping drains take
-- different rows; the attempts bump plus the backoff (2 minutes per attempt so
-- far) keeps a row from being picked again by the next run while its send is in
-- flight. Unreachable recipients are dropped in the same statement. Rows older
-- than 48 hours are dropped as stale and rows out of attempts are failed before
-- the claim, so nothing stays pending forever. p_limit is capped at 50.
create or replace function public.claim_portal_emails(p_limit integer)
returns table (
  id uuid, org_id uuid, kind text, referral_id uuid, payload jsonb, recipient text, attempts integer
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
begin
  -- Stale: never send an email that sat unsent for more than 48 hours.
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'stale'
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.created_at < now() - interval '48 hours'
        for update skip locked);

  -- Exhausted: all 5 attempts used without a settle, so give up for good.
  update portal_email_outbox o
     set failed_at = now()
   where o.id in (
     select s.id from portal_email_outbox s
      where s.sent_at is null and s.dropped_at is null and s.failed_at is null
        and s.attempts >= 5
        for update skip locked);

  return query
  with picked as (
    select o.id
      from portal_email_outbox o
     where o.sent_at is null and o.dropped_at is null and o.failed_at is null
       and o.attempts < 5
       and (o.last_attempt_at is null
            or o.last_attempt_at <= now() - make_interval(mins => 2 * o.attempts))
     order by o.created_at, o.id
     limit v_limit
       for update skip locked
  ),
  resolved as (
    select o.id,
           case when o.portal_user_id is not null then pu.email else pr.email end as email,
           case when o.portal_user_id is not null
                then coalesce(pu.status = 'active' and org.portal_enabled and not org.is_disabled, false)
                else coalesce(pr.deactivated_at is null and pr.org_id = o.org_id
                              and pr.email is not null and not org.is_disabled, false)
           end as live
      from portal_email_outbox o
      join picked k on k.id = o.id
      join organizations org on org.id = o.org_id
      left join portal_users pu on pu.id = o.portal_user_id and pu.org_id = o.org_id
      left join profiles pr on pr.id = o.recipient_user_id
  ),
  dropped as (
    update portal_email_outbox o
       set dropped_at = now(), last_error = 'recipient_inactive'
      from resolved r
     where r.id = o.id and not r.live
    returning o.id
  ),
  claimed as (
    update portal_email_outbox o
       set attempts = o.attempts + 1, last_attempt_at = now()
      from resolved r
     where r.id = o.id and r.live
    returning o.id, o.org_id, o.kind, o.referral_id, o.payload, r.email, o.attempts
  )
  select c.id, c.org_id, c.kind, c.referral_id, c.payload, c.email, c.attempts from claimed c;
end $$;

-- Settle a claimed row. Only an unsettled row changes, so a late or repeated
-- mark never flips a sent, dropped or failed row.
create or replace function public.mark_portal_email(p_id uuid, p_outcome text, p_error text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_outcome = 'sent' then
    update portal_email_outbox o
       set sent_at = now(), last_error = null
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  elsif p_outcome = 'dropped' then
    update portal_email_outbox o
       set dropped_at = now(), last_error = coalesce(v_error, 'dropped')
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  elsif p_outcome = 'failed' then
    update portal_email_outbox o
       set last_error = coalesce(v_error, 'send_failed'),
           failed_at  = case when o.attempts >= 5 then now() else null end
     where o.id = p_id and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  else
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
end $$;

revoke execute on function public.claim_portal_emails(integer)          from public, anon, authenticated;
revoke execute on function public.mark_portal_email(uuid, text, text)   from public, anon, authenticated;
grant  execute on function public.claim_portal_emails(integer)          to service_role;
grant  execute on function public.mark_portal_email(uuid, text, text)   to service_role;
