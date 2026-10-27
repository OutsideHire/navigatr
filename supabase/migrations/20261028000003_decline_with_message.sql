-- 20261028000003_decline_with_message.sql
--
-- Partner Portal audit fix (FR-PORT-65, Robert's answer Q8): when a rep
-- declines a referral they can write an optional message the partner sees.
-- The decline reason and the internal note stay internal, as before.
--
-- decline_referral_with_message wraps decline_referral (unchanged):
--   1. it sets the transaction-local setting navigatr.decline_message, so the
--      status-email trigger adds `message` to the Not Moving Forward payload;
--   2. it publishes the message as a referral update (the partner's referral
--      page already lists those) with navigatr.skip_update_email = 'on', so the
--      update trigger does not send a second email.
-- Both settings are cleared right after use so nothing leaks into later
-- statements in the same transaction.

-- 1. The wrapper (authenticated) -----------------------------------------------
create or replace function public.decline_referral_with_message(
  p_referral_id uuid, p_reason referral_decline_reason, p_note text, p_partner_message text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_msg text := btrim(coalesce(p_partner_message, ''), E' \t\r\n');
begin
  if char_length(v_msg) > 1000 then
    raise exception 'partner_message_too_long' using errcode = '22023';
  end if;

  perform set_config('navigatr.decline_message', v_msg, true);
  perform public.decline_referral(p_referral_id, p_reason, p_note);
  perform set_config('navigatr.decline_message', '', true);

  -- A blank message is a plain decline. publish_referral_update re-checks the
  -- caller's rights and refuses an outbound or purged referral.
  if v_msg <> '' then
    perform set_config('navigatr.skip_update_email', 'on', true);
    perform public.publish_referral_update(p_referral_id, v_msg);
    perform set_config('navigatr.skip_update_email', '', true);
  end if;
end $$;

revoke execute on function public.decline_referral_with_message(uuid, referral_decline_reason, text, text) from public, anon, authenticated;
grant  execute on function public.decline_referral_with_message(uuid, referral_decline_reason, text, text) to authenticated;

-- 2. Status email: carry the message on a decline ---------------------------------
-- Latest definition from 20261016000005 (decline key per transition), plus the
-- message. It is added to the row this transition just queued, and only when
-- the wrapper set it, so a plain decline keeps the ten-key payload.
create or replace function public.referrals_enqueue_status_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_msg   text := nullif(current_setting('navigatr.decline_message', true), '');
  v_kind  text;
  v_key   text;
begin
  begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'accepted'  then 'partner_accepted'
    when 'won'       then 'partner_closed_won'
    when 'lost'      then 'partner_not_moving_forward'
    when 'declined'  then 'partner_not_moving_forward'
    -- The partner already knows when they withdrew it themselves.
    when 'withdrawn' then case when v_actor = 'partner' then null else 'partner_withdrawn' end
    else null
  end;
  if v_kind is not null then
    v_key := v_kind || ':' || new.id::text || ':' || new.status::text;
    if new.status = 'declined' then
      v_key := v_key || ':' || (
        select count(*) from referral_status_history h
         where h.referral_id = new.id and h.to_status = 'declined')::text;
    end if;
    perform public._portal_enqueue_partner(new, v_kind, v_key, null);
    if new.status = 'declined' and v_msg is not null then
      update portal_email_outbox
         set payload = payload || jsonb_build_object('message', v_msg)
       where dedupe_key = v_key and referral_id = new.id and kind = v_kind
         and sent_at is null and dropped_at is null and failed_at is null;
    end if;
  end if;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

revoke execute on function public.referrals_enqueue_status_email() from public, anon, authenticated, service_role;

-- 3. Update email: skip the one the decline already carries ------------------------
-- Latest definition from 20261014000003, plus the skip.
create or replace function public.referral_updates_enqueue_email()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r referrals;
begin
  if current_setting('navigatr.skip_update_email', true) = 'on' then
    return new;
  end if;
  begin
    select * into r from referrals where id = new.referral_id;
    if r.id is not null then
      perform public._portal_enqueue_partner(
        r, 'partner_update', 'partner_update:' || r.id::text || ':' || new.id::text, new.body);
    end if;
  exception when others then
    raise warning '% skipped: % %', TG_NAME, SQLSTATE, SQLERRM;
  end;
  return new;
end $$;

revoke execute on function public.referral_updates_enqueue_email() from public, anon, authenticated, service_role;
