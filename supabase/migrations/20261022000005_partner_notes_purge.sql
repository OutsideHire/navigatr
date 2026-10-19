-- 20261022000005_partner_notes_purge.sql
--
-- Partner Portal Phase 2B-3 (FR-PORT-91..95, NFR-PORT-09). The 2A erase
-- functions learn about this phase's personal text:
--   purge_declined_referrals  deletes the partner's notes on purged referrals
--                             (the referral_updates precedent) and nulls the
--                             rep's note in queued "sent to you" payloads.
--   portal_purge_user         deletes that portal user's notes, clears the
--                             unsubscribe token and digest week, and nulls the
--                             token in that user's queued payloads.
-- Both bodies are otherwise identical to 20261016000002 and 20261016000007.

create or replace function public.purge_declined_referrals(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_ids uuid[];
begin
  -- One run at a time.
  perform pg_advisory_xact_lock(hashtextextended('purge_declined_referrals', 0));

  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_ids
    from referrals r
    join organizations o on o.id = r.org_id
   where r.purged_at is null
     and r.status in ('declined','withdrawn')
     and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
         <= v_now - make_interval(days => o.declined_retention_days);

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Status is not in the SET list, so no history row and no status email.
  -- The candidate set was read without row locks, so the UPDATE re-checks the
  -- purge predicate: a referral reinstated (or already purged) since the
  -- SELECT is skipped. Every later statement runs on the rows actually erased.
  with erased as (
    update referrals r
       set contact_name          = null,
           contact_email         = null,
           contact_phone         = null,
           address               = null,
           notes                 = '',
           consent_text_snapshot = null,
           decline_note          = null,
           place_id              = null,
           purged_at             = v_now
      from organizations o
     where r.id = any(v_ids)
       and o.id = r.org_id
       and r.purged_at is null
       and r.status in ('declined','withdrawn')
       and coalesce(public._referral_status_since(r.id, r.status), r.updated_at)
           <= v_now - make_interval(days => o.declined_retention_days)
    returning r.id
  )
  select coalesce(array_agg(e.id), '{}'::uuid[]) into v_ids from erased e;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  delete from referral_updates u where u.referral_id = any(v_ids);
  -- 2B-3: the partner's own notes on a referral sent to them.
  delete from referral_partner_notes n where n.referral_id = any(v_ids);

  -- Privacy erase of otherwise immutable history: the decline note (copied here
  -- by the status trigger) is personal text. Rows are kept; only note is nulled.
  update referral_status_history h
     set note = null
   where h.referral_id = any(v_ids) and h.note is not null;

  update portal_email_outbox o
     set dropped_at = v_now, last_error = 'purged'
   where o.referral_id = any(v_ids)
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;

  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{updateBody}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'updateBody'
     and o.payload->>'updateBody' is not null;

  -- 2B-3: the rep's note for the partner rides "sent to you" payloads.
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{note}', 'null'::jsonb)
   where o.referral_id = any(v_ids)
     and o.payload ? 'note'
     and o.payload->>'note' is not null;

  -- Earlier audit rows for these referrals must not keep a partner IP.
  update portal_audit_log a
     set ip = null
   where a.referral_id = any(v_ids) and a.ip is not null;

  insert into portal_audit_log (org_id, action, referral_id)
  select r.org_id, 'purge'::portal_audit_action, r.id
    from referrals r
   where r.id = any(v_ids);

  return cardinality(v_ids);
end $$;

create or replace function public.portal_purge_user(p_partner_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.user_org_id();
  v_user portal_users;
begin
  if v_org is null or not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_user from portal_users u
   where u.partner_id = p_partner_id and u.org_id = v_org
     for update;
  if v_user.id is null then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;

  update portal_users
     set status                   = 'revoked',
         email                    = 'purged+' || v_user.id::text || '@invalid',
         terms_ip                 = null,
         notification_prefs       = '{}'::jsonb,
         digest_unsubscribe_token = null,
         digest_week              = null,
         updated_at               = now()
   where id = v_user.id;

  update portal_sessions s
     set revoked_at = coalesce(s.revoked_at, now()), ip = null, user_agent = null
   where s.portal_user_id = v_user.id;
  update portal_tokens t
     set revoked_at = coalesce(t.revoked_at, now()), ip = null
   where t.portal_user_id = v_user.id;
  update portal_audit_log a
     set ip = null
   where a.portal_user_id = v_user.id and a.ip is not null;
  update portal_email_outbox o
     set dropped_at = now(), last_error = 'purged'
   where o.portal_user_id = v_user.id
     and o.sent_at is null and o.dropped_at is null and o.failed_at is null;
  -- The partner's name must not outlive the erase in any payload (sent or not).
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{partnerName}', 'null'::jsonb)
   where o.portal_user_id = v_user.id and o.payload ? 'partnerName';
  -- 2B-3: nor the unsubscribe token.
  update portal_email_outbox o
     set payload = jsonb_set(o.payload, '{unsubscribeToken}', 'null'::jsonb)
   where o.portal_user_id = v_user.id and o.payload ? 'unsubscribeToken';
  -- Profile edits carried the partner's name and phone; keep the audit rows, drop the values.
  update partner_profile_changes c
     set old_value = null, new_value = null
   where c.partner_id = p_partner_id and c.org_id = v_org;
  -- 2B-3: what they wrote back on referrals sent to them.
  delete from referral_partner_notes n where n.portal_user_id = v_user.id;

  perform public._portal_audit(v_org, v_user.id, 'purge', null, auth.uid());
end $$;

-- create or replace keeps grants; restated so this file reads on its own.
revoke execute on function public.purge_declined_referrals(timestamptz) from public, anon, authenticated;
grant  execute on function public.purge_declined_referrals(timestamptz) to service_role;
revoke execute on function public.portal_purge_user(uuid)               from public, anon;
grant  execute on function public.portal_purge_user(uuid)               to authenticated;
