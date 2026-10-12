-- 20261014000001_referral_updates.sql
--
-- Partner Portal Phase 1C (spec 5.7, FR-PORT-74): "Share update with partner".
-- A rep writes a short update on a referral; the partner sees it on their
-- referral page and gets it by email (20261014000003). This is the ONLY text
-- path from the app to the portal (spec 6): portal_api reads nothing else a rep
-- typed.
--
-- Writes: only publish_referral_update (SECURITY DEFINER, re-checks rights).
-- Internal reads: RLS, visible when the referral is visible.
-- Portal reads: portal_referral_updates, service role only, pinned to the
-- session's (org, partner).

create table referral_updates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  referral_id    uuid not null references referrals(id) on delete cascade,
  author_user_id uuid references profiles(id) on delete set null,
  body           text not null check (body = btrim(body, E' \t\r\n') and char_length(body) between 1 and 1000),
  published_at   timestamptz not null default now()
);
create index referral_updates_referral_idx on referral_updates (referral_id, published_at desc);

alter table referral_updates enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_updates from anon;
revoke all on referral_updates from authenticated;
grant select on referral_updates to authenticated;

-- RLS on referrals applies inside the subquery, so this inherits referrals_select.
create policy referral_updates_select on referral_updates for select to authenticated using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_updates.referral_id)
);

-- Publish (authenticated). Allowed for anyone who can triage the referral or can
-- see its deal; both imply referrals_select, so the caller can always read what
-- they published. A referral the caller's org does not own, an outbound one, or
-- a purged one looks missing.
create or replace function public.publish_referral_update(p_referral_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.user_org_id();
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  r      referrals;
  v_id   uuid;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into r from referrals where id = p_referral_id;
  if r.id is null or r.org_id <> v_org or r.direction <> 'inbound' or r.purged_at is not null then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  if not (
    public.can_triage_referral(r.assigned_user_id)
    or (r.deal_id is not null and exists (
          select 1 from deals d where d.id = r.deal_id and public.user_can_see_owner(d.owner_id)))
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'update_required' using errcode = '22023';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'update_too_long' using errcode = '22023';
  end if;

  insert into referral_updates (org_id, referral_id, author_user_id, body)
  values (r.org_id, r.id, auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end $$;

-- Portal read (service role). Newest first. The author's name only while they
-- are active in this org; otherwise the portal shows the ISO name.
create or replace function public.portal_referral_updates(p_org uuid, p_partner uuid, p_referral uuid)
returns table (body text, published_at timestamptz, author_name text)
language sql stable security definer set search_path = public, extensions as $$
  select u.body, u.published_at, pr.full_name
    from referral_updates u
    join referrals r on r.id = u.referral_id
    left join profiles pr on pr.id = u.author_user_id and pr.org_id = r.org_id and pr.deactivated_at is null
   where u.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound' and r.purged_at is null
   order by u.published_at desc, u.id
   limit 100
$$;

revoke execute on function public.publish_referral_update(uuid, text)          from public, anon;
grant  execute on function public.publish_referral_update(uuid, text)          to authenticated;
revoke execute on function public.portal_referral_updates(uuid, uuid, uuid)    from public, anon, authenticated;
grant  execute on function public.portal_referral_updates(uuid, uuid, uuid)    to service_role;
