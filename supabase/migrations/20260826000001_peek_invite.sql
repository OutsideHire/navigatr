-- A2 (rep first-run): let the accept-invite screen show WHO invited the rep,
-- WHICH org, and their ROLE before they sign in, so the highest-trust moment
-- isn't a context-free signup form.
--
-- peek_invite reads MINIMAL invite metadata by its unguessable per-agent token.
-- It returns exactly one row for a live token (not accepted, not revoked, not
-- expired) and NOTHING otherwise. SECURITY DEFINER so the not-yet-authenticated
-- invitee (anon role) can read just the invite whose token they hold; it never
-- exposes anything beyond org name, role, inviter name, and the invitee's own
-- email/name, and only for a valid token, so a token-holder learns nothing they
-- weren't already sent.
create or replace function public.peek_invite(p_token text)
returns table (
  org_name text,
  role_level role_level,
  inviter_name text,
  invitee_email text,
  invitee_full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select o.name,
         oi.role_level,
         p.full_name,
         oi.email,
         oi.full_name
    from org_invites oi
    join organizations o on o.id = oi.org_id
    left join profiles p on p.id = oi.invited_by
   where oi.token = p_token
     and oi.accepted_at is null
     and oi.revoked_at is null
     and oi.expires_at > now();
$$;

revoke all on function public.peek_invite(text) from public;
grant execute on function public.peek_invite(text) to anon, authenticated;
