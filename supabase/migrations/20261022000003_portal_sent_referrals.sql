-- 20261022000003_portal_sent_referrals.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-76, 77, 78, 80).
--
-- 1. referral_partner_notes: what a partner writes back on a referral sent to
--    them. Its own record, never an activity (Ryan ruling: activities.logged_by
--    is an internal user and feeds the activity reports). Internal users read
--    it under RLS when they can see the referral; only portal_post_partner_note
--    writes it. portal_user_id becomes null if the identity row is ever deleted;
--    the 2A erase deletes the notes outright (20261022000005).
-- 2. "Sent to you" reads for portal_api, service role only, pinned to the
--    session's (org, partner) like every 1B read, OUTBOUND rows only. A partner
--    sees: company, the contact snapshot (name, email, phone), the partner
--    label (portal_api maps status), the sent date, the sender's name and
--    business email, the rep's note ONLY when partner_note_visible, and their
--    own notes. Never the stage, a value, an internal note or another partner.
--    Only rows shared from this release on (shared_with_partner_at, Ryan ruling
--    Q1). A removed link disappears (Ryan ruling Q3): remove_referral_link (and
--    withdraw_referral) set status 'withdrawn', a status the deal-stage trigger
--    never produces (referral_status_for_stage only yields accepted, working,
--    won, lost), so status <> 'withdrawn' hides removals and nothing else.
--    Notes on a removed link stay, internal only. Only withdrawn outbound rows
--    are ever purged, so a purged row is never shown either.
-- 3. portal_post_partner_note: only on that partner's shared, not removed,
--    unpurged outbound referrals, 1..1000 characters, 20 per portal user per hour, audited, and
--    the sender (else the deal owner, else administrators) is emailed.

-- 1. Notes -------------------------------------------------------------------------------
create table referral_partner_notes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  referral_id    uuid not null references referrals(id) on delete cascade,
  portal_user_id uuid references portal_users(id) on delete set null,
  body           text not null check (body = btrim(body, E' \t\r\n') and char_length(body) between 1 and 1000),
  created_at     timestamptz not null default now()
);
create index referral_partner_notes_referral_idx on referral_partner_notes (referral_id, created_at desc);
create index referral_partner_notes_portal_user_idx on referral_partner_notes (portal_user_id) where portal_user_id is not null;

alter table referral_partner_notes enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_partner_notes from anon;
revoke all on referral_partner_notes from authenticated;
grant select on referral_partner_notes to authenticated;

-- RLS on referrals applies inside the subquery, so this inherits referrals_select.
create policy referral_partner_notes_select on referral_partner_notes for select to authenticated using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_partner_notes.referral_id)
);

-- 2. Reads ------------------------------------------------------------------------------------
create or replace function public.portal_list_sent_referrals(p_org uuid, p_partner uuid, p_since timestamptz)
returns table (
  id uuid, ref text, company_name text, status referral_status,
  sent_at timestamptz, last_activity_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select r.id,
         public._portal_referral_ref(r.id),
         r.company_name,
         r.status,
         r.submitted_at,
         greatest(r.submitted_at, coalesce(h.last_at, r.submitted_at), coalesce(n.last_at, r.submitted_at)) as last_activity_at
    from referrals r
    join organizations o on o.id = r.org_id
    left join lateral (
      select max(x.created_at) as last_at from referral_status_history x where x.referral_id = r.id
    ) h on true
    left join lateral (
      select max(x.created_at) as last_at from referral_partner_notes x where x.referral_id = r.id
    ) n on true
   where r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'outbound'
     and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
     and o.portal_enabled and not o.is_disabled
     and (p_since is null or r.submitted_at >= p_since)
   order by last_activity_at desc, r.id
   limit 500
$$;

create or replace function public.portal_get_sent_referral(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_ip text
)
returns table (
  id uuid, ref text, company_name text, contact_name text, contact_email text,
  contact_phone text, rep_note text, status referral_status, sent_at timestamptz,
  rep_name text, rep_email text, details_removed boolean, can_post_note boolean
)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  if not exists (
    select 1 from referrals r
     where r.id = p_referral and r.org_id = p_org and r.partner_id = p_partner
       and r.direction = 'outbound'
       and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
  ) then
    return;
  end if;

  if not exists (
    select 1 from portal_audit_log a
     where a.portal_user_id = p_portal_user and a.action = 'view_referral'
       and a.referral_id = p_referral and a.created_at > now() - interval '1 hour'
  ) then
    perform public._portal_audit_referral(p_org, p_portal_user, 'view_referral', p_referral, p_ip);
  end if;

  return query
    select r.id,
           public._portal_referral_ref(r.id),
           r.company_name,
           case when r.purged_at is null then r.contact_name end,
           case when r.purged_at is null then r.contact_email end,
           case when r.purged_at is null then r.contact_phone end,
           case when r.partner_note_visible and r.purged_at is null then nullif(btrim(r.notes), '') end,
           r.status,
           r.submitted_at,
           pr.full_name,
           pr.email,
           (r.purged_at is not null),
           (r.purged_at is null)
      from referrals r
      left join profiles pr on pr.id = r.submitted_by_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
     where r.id = p_referral;
end $$;

create or replace function public.portal_partner_notes(p_org uuid, p_partner uuid, p_referral uuid)
returns table (id uuid, body text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select n.id, n.body, n.created_at
    from referral_partner_notes n
    join referrals r on r.id = n.referral_id
   where n.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'outbound'
     and r.shared_with_partner_at is not null and r.status <> 'withdrawn'
   order by n.created_at desc, n.id
   limit 100
$$;

-- 3. Note-back ------------------------------------------------------------------------------
-- The sender while active in the org; else the deal owner while active; else
-- (null target) every active administrator.
create or replace function public._portal_enqueue_partner_note(p_referral referrals, p_note uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner  uuid;
  v_target uuid;
  v_path   text;
begin
  select d.owner_id into v_owner from deals d where d.id = p_referral.deal_id;
  v_target := case
    when exists (select 1 from profiles x where x.id = p_referral.submitted_by_user_id
                  and x.org_id = p_referral.org_id and x.deactivated_at is null)
      then p_referral.submitted_by_user_id
    when exists (select 1 from profiles x where x.id = v_owner
                  and x.org_id = p_referral.org_id and x.deactivated_at is null)
      then v_owner
    else null
  end;
  v_path := case when p_referral.deal_id is not null
                 then '/pipeline/' || p_referral.deal_id::text
                 else '/partners/' || p_referral.partner_id::text end;
  insert into portal_email_outbox (org_id, kind, referral_id, recipient_user_id, payload, dedupe_key)
  select p_referral.org_id, 'internal_partner_note', p_referral.id, rcp.user_id,
         jsonb_build_object('appUrlPath', v_path,
                            'companyNames', jsonb_build_array(p_referral.company_name),
                            'count', 1),
         'internal_partner_note:' || p_note::text || ':' || rcp.user_id::text
    from public._portal_review_recipients(p_referral.org_id, v_target) rcp
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning '_portal_enqueue_partner_note skipped: % %', SQLSTATE, SQLERRM;
end $$;

create or replace function public.portal_post_partner_note(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_referral uuid, p_body text, p_ip text
)
returns table (id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  r      referrals;
  v_id   uuid;
  v_at   timestamptz;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into r
    from referrals x
   where x.id = p_referral and x.org_id = p_org and x.partner_id = p_partner
     and x.direction = 'outbound' and x.purged_at is null
     and x.shared_with_partner_at is not null and x.status <> 'withdrawn'
     for update;
  if r.id is null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  -- Field rule mirrors validateNoteBody in _shared/portalSentApi.ts.
  if v_body = '' or char_length(v_body) > 1000 then
    raise exception 'invalid_input:body' using errcode = '22023';
  end if;

  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_note:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'note'
         and a.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into referral_partner_notes (org_id, referral_id, portal_user_id, body)
  values (r.org_id, r.id, p_portal_user, v_body)
  returning referral_partner_notes.id, referral_partner_notes.created_at into v_id, v_at;

  perform public._portal_audit_referral(p_org, p_portal_user, 'note', r.id, p_ip);
  perform public._portal_enqueue_partner_note(r, v_id);

  return query select v_id, v_body, v_at;
end $$;

-- Privileges -----------------------------------------------------------------------------------
revoke execute on function public.portal_list_sent_referrals(uuid, uuid, timestamptz)              from public, anon, authenticated;
revoke execute on function public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)           from public, anon, authenticated;
revoke execute on function public.portal_partner_notes(uuid, uuid, uuid)                            from public, anon, authenticated;
revoke execute on function public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)     from public, anon, authenticated;
revoke execute on function public._portal_enqueue_partner_note(referrals, uuid)                     from public, anon, authenticated, service_role;
grant  execute on function public.portal_list_sent_referrals(uuid, uuid, timestamptz)              to service_role;
grant  execute on function public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)           to service_role;
grant  execute on function public.portal_partner_notes(uuid, uuid, uuid)                            to service_role;
grant  execute on function public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)     to service_role;
