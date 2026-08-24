-- 20260820000011_email_suggestion_confirm.sql
--
-- Automatic Email Activity Capture, Phase 1 Slice 5a: the one-tap confirm/dismiss
-- transition for a suggested email (D-07). A rep confirming a suggestion is what
-- turns it into a real activity; nothing auto-creates activities without this.
--
-- Both are SECURITY DEFINER (email_activity has no client write policy) and are
-- gated to the SENDER (auth.uid() = sender_user_id), so a rep can only act on
-- their own suggestions. Confirm is idempotent: re-confirming an already-
-- confirmed suggestion returns its existing activity id.

-- Confirm: create the activity + link it, flip status to 'confirmed'.
create or replace function public.confirm_email_suggestion(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v email_activity%rowtype;
  v_activity_id uuid;
begin
  select * into v from email_activity where id = p_id;
  if not found then raise exception 'email suggestion not found'; end if;
  if v.sender_user_id <> auth.uid() then raise exception 'forbidden'; end if;

  -- Idempotent: already confirmed -> return the activity we created before.
  if v.status = 'confirmed' and v.activity_id is not null then
    return v.activity_id;
  end if;
  if v.status <> 'suggested' then raise exception 'not a pending suggestion'; end if;
  if v.matched_deal_id is null then raise exception 'suggestion has no matched deal'; end if;

  -- Auto-captured email activity. disposition 'sent_information' is the neutral
  -- default for a captured send (outcome unknown); capture_source 'automatic'
  -- flags it in reports and excludes it from Persistence scoring in beta.
  insert into activities (org_id, deal_id, logged_by, type, disposition, direction, capture_source, occurred_at, outcome_notes)
  values (v.org_id, v.matched_deal_id, v.sender_user_id, 'email', 'sent_information', 'outbound', 'automatic',
          coalesce(v.sent_at, now()), coalesce(v.subject, ''))
  returning id into v_activity_id;

  update email_activity set activity_id = v_activity_id, status = 'confirmed' where id = p_id;
  return v_activity_id;
end $$;

grant execute on function public.confirm_email_suggestion(uuid) to authenticated;

-- Dismiss: reject a suggestion (no activity created).
create or replace function public.dismiss_email_suggestion(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v email_activity%rowtype;
begin
  select * into v from email_activity where id = p_id;
  if not found then raise exception 'email suggestion not found'; end if;
  if v.sender_user_id <> auth.uid() then raise exception 'forbidden'; end if;
  if v.status = 'suggested' then
    update email_activity set status = 'dismissed' where id = p_id;
  end if;
  -- already confirmed/dismissed -> no-op (idempotent)
end $$;

grant execute on function public.dismiss_email_suggestion(uuid) to authenticated;
