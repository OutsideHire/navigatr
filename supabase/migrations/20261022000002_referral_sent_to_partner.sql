-- 20261022000002_referral_sent_to_partner.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-76, FR-PORT-79).
--
-- 1. referrals.partner_note_visible: true only when a rep wrote the note FOR
--    the partner (send_referral_to_partner with a note). Every existing row,
--    the backfill from partner_deals, refer_deal_to_partner and inbound
--    referrals keep false: their notes were never meant for a partner.
--    referrals.shared_with_partner_at (Ryan ruling Q1): set by both send RPCs
--    from this release on. Rows linked before it (including the partner_deals
--    backfill) stay null and are never shown to a partner, emailed, noted or
--    counted in a digest.
-- 2. Outbox kinds for this phase. partner_digest is the one partner email with
--    no referral (a weekly summary), so the recipient rule gains a branch.
-- 3. "<ISO> sent you a referral": queued by the two outbound RPCs (not by a
--    trigger, so the flag is set before the payload is built and the demo
--    partner_deals mirror never emails anyone). Only for a partner with ACTIVE
--    portal access while the portal is on. Status changes on outbound
--    referrals send nothing (_portal_enqueue_partner skips them, unchanged).

-- 1. Flag -------------------------------------------------------------------------
alter table referrals add column if not exists partner_note_visible boolean not null default false;
alter table referrals add column if not exists shared_with_partner_at timestamptz;

-- 2. Outbox kinds and the recipient rule --------------------------------------------
alter table portal_email_outbox drop constraint portal_email_outbox_kind_check;
alter table portal_email_outbox add constraint portal_email_outbox_kind_check check (kind in (
  'partner_received','partner_accepted','partner_not_moving_forward',
  'partner_closed_won','partner_withdrawn','partner_update',
  'internal_new_referral','internal_nudge','internal_reinstate_available',
  'internal_new_submission',
  'partner_referral_sent','partner_digest','internal_partner_note'));

alter table portal_email_outbox drop constraint portal_email_outbox_recipient_check;
alter table portal_email_outbox add constraint portal_email_outbox_recipient_check check (
  case when kind = 'partner_digest'
       then portal_user_id is not null and recipient_user_id is null and referral_id is null
       when kind like 'partner\_%'
       then portal_user_id is not null and recipient_user_id is null and referral_id is not null
       else recipient_user_id is not null and portal_user_id is null
  end);

-- 3. The partner email ----------------------------------------------------------------
-- Exactly eight keys, always present. The rep is the SENDER (submitted_by_user_id),
-- while active in this org. The note only when the rep wrote it for the partner.
create or replace function public._portal_referral_sent_payload(p_referral uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
           'slug',        o.slug,
           'orgName',     o.name,
           'partnerName', p.name,
           'companyName', r.company_name,
           'ref',         public._portal_referral_ref(r.id),
           'repName',     pr.full_name,
           'repEmail',    pr.email,
           'note',        case when r.partner_note_visible then nullif(btrim(r.notes), '') end)
    from referrals r
    join organizations o on o.id = r.org_id
    join partners p on p.id = r.partner_id
    left join profiles pr on pr.id = r.submitted_by_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where r.id = p_referral
$$;

-- Never blocks the RPC: the warning names the function and the error only.
create or replace function public._portal_enqueue_referral_sent(p_referral uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  r             referrals;
  v_portal_user uuid;
begin
  select * into r from referrals where id = p_referral;
  -- Only a referral shared from this release on, and not a removed link.
  if r.id is null or r.direction <> 'outbound' or r.purged_at is not null
     or r.shared_with_partner_at is null or r.status = 'withdrawn' then
    return;
  end if;
  select u.id into v_portal_user
    from portal_users u
    join organizations o on o.id = u.org_id
   where u.partner_id = r.partner_id and u.org_id = r.org_id
     and u.status = 'active' and o.portal_enabled and not o.is_disabled;
  if v_portal_user is null then
    return;
  end if;
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key)
  values (r.org_id, 'partner_referral_sent', r.id, v_portal_user,
          public._portal_referral_sent_payload(r.id), 'partner_referral_sent:' || r.id::text)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning '_portal_enqueue_referral_sent skipped: % %', SQLSTATE, SQLERRM;
end $$;

-- 4. The send RPCs ----------------------------------------------------------------------
-- SendReferralSheet (and, through useReferDeal, Partner Detail "Refer a deal"
-- with no note). The note is shown to the partner only when it is not blank.
-- A live outbound link to this partner from before this release (never shared:
-- the partner_deals backfill or an old "Refer a deal") is SHARED by a send
-- instead of refused: the rep is sending it now. A non-blank note replaces the
-- old note and is shown; a blank one leaves the old (internal) note hidden.
-- An already shared link is still already_linked.
create or replace function public.send_referral_to_partner(
  p_partner_id uuid, p_deal_id uuid, p_partner_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_partner_note, ''), E' \t\r\n');
  v_id   uuid;
begin
  if char_length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  begin
    v_id := public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', v_note);
  exception when unique_violation then
    -- _link_deal_to_partner raises already_linked only after its org, partner
    -- and deal visibility checks passed, so the caller may act on this link.
    update referrals r
       set shared_with_partner_at = now(),
           notes                  = case when v_note <> '' then v_note else r.notes end,
           partner_note_visible   = (v_note <> '')
     where r.org_id = public.user_org_id()
       and r.partner_id = p_partner_id and r.deal_id = p_deal_id
       and r.direction = 'outbound'
       and r.status not in ('declined', 'withdrawn')
       and r.shared_with_partner_at is null
    returning r.id into v_id;
    if v_id is null then
      raise exception 'already_linked' using errcode = '23505';
    end if;
    perform public._portal_enqueue_referral_sent(v_id);
    return v_id;
  end;
  update referrals
     set shared_with_partner_at = now(),
         partner_note_visible   = (v_note <> '')
   where id = v_id;
  perform public._portal_enqueue_referral_sent(v_id);
  return v_id;
end $$;

-- Same signature and grants as 20261007000003 (DB test 035 asserts them). Kept
-- for stale clients; it never makes a note visible, and now shares and emails.
create or replace function public.refer_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', p_note);
  update referrals set shared_with_partner_at = now() where id = v_id;
  perform public._portal_enqueue_referral_sent(v_id);
  return v_id;
end $$;

-- Privileges ----------------------------------------------------------------------------
revoke execute on function public._portal_referral_sent_payload(uuid)        from public, anon, authenticated, service_role;
revoke execute on function public._portal_enqueue_referral_sent(uuid)        from public, anon, authenticated, service_role;
revoke execute on function public.send_referral_to_partner(uuid, uuid, text) from public, anon;
grant  execute on function public.send_referral_to_partner(uuid, uuid, text) to authenticated;
revoke execute on function public.refer_deal_to_partner(uuid, uuid, text)    from public, anon;
grant  execute on function public.refer_deal_to_partner(uuid, uuid, text)    to authenticated;
