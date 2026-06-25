# Org Invite-Code Rotation — Design

**Goal:** Let an org admin regenerate the org's shared join code, instantly invalidating the old join link.

## Problem

`organizations.invite_code` is a single org-wide code embedded in the self-serve join link
(`/signup?code=<invite_code>`). It is set once at org creation and can never change. If that
link leaks — a forwarded email, a screenshot, an ex-employee — there is no way to cut off access
short of disabling the entire org. Rotation lets an admin mint a fresh code and break the old link.

## Scope

In scope:
- A `rotate_invite_code` RPC (admin-only) that replaces `organizations.invite_code` with a fresh
  unique code and returns the new value.
- A "Regenerate" control + confirm dialog on the live `settings-hub/tabs/OrganizationTab.tsx`,
  visible to admins only.
- A `useRotateInviteCode` mutation hook that calls the RPC and refreshes the org query.

Explicitly out of scope (decided during brainstorming):
- **Email invites** — already shipped on the Agents page (`admin_bulk_invite` + `send_invite_email`).
  The "Email invites instead →" breadcrumb lived only in the dead, unrouted `SettingsPage.tsx`.
- **Link expiry / TTL** — the schema has no expiry concept; adding one is a separate, larger change.
  Rotation alone (issue new, invalidate old) covers the security need. YAGNI.
- **Per-agent `org_invites` tokens** — a separate invite system, unaffected by rotation.

## Backend

New migration: `supabase/migrations/20260625000003_rotate_invite_code.sql`

```sql
create or replace function rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_code   text;
  v_n      int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid();

  -- Admin-only. coalesce guards a NULL role (deactivated / profile-less caller),
  -- which would otherwise make the comparison NULL instead of TRUE.
  if v_org_id is null or coalesce(v_caller::text, '') <> 'admin' then
    raise exception 'forbidden';
  end if;

  -- Fresh 8-char base36-ish code, same generator as create_organization.
  -- Retry on the (astronomically unlikely) collision.
  for v_n in 1..8 loop
    v_code := lower(substring(encode(gen_random_bytes(8), 'hex') from 1 for 8));
    exit when not exists (select 1 from organizations o where o.invite_code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'invite_code_collision'
      using hint = 'Try again.';
  end if;

  update organizations set invite_code = v_code where id = v_org_id;
  return v_code;
end;
$$;

revoke all on function rotate_invite_code() from public;
grant execute on function rotate_invite_code() to authenticated;
```

Authz mirrors `update_org_branding` but is **admin-only** (not manager+admin): rotating the
join link locks out everyone holding the old link, so it is restricted to admins, matching the
member-role-management decision. The old code stops working the instant the row updates because
`claim_invite_code` matches `organizations.invite_code = p_code` exactly.

Applied to prod by hand with the user's authorization (`supabase db query --linked -f <file>`
then `supabase migration repair --status applied 20260625000003`), then smoke-tested.

## Frontend

### Hook — `apps/app/src/features/admin/hooks/useRotateInviteCode.ts`

Mirrors `useSetMemberRole`. Calls `supabase.rpc("rotate_invite_code")`, returns the new code,
and on success invalidates the `["organization"]` query so the displayed link updates.

```ts
export function useRotateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("rotate_invite_code");
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
}
```

Invalidating by the `["organization"]` prefix (not the precise `ORGANIZATION_QUERY_KEY`) avoids
threading `userId`/`orgId` into the hook; TanStack matches by prefix.

### UI — `OrganizationTab.tsx`

- Add a strict admin check: `const canRotate = profile.data?.role === "admin";`
  **Do not reuse the existing `isAdmin`** — it is `role === "manager" || role === "admin"`
  (a misnomer covering managers too). Rotation is admins only.
- When `canRotate`, render a "Regenerate" ghost/text button next to Copy.
- Click opens a confirm `Dialog`:
  > **Regenerate invite link?**
  > This breaks the current link. Anyone you've already shared it with will need the new one.
  > Per-agent email invites are not affected.
  >
  > [Cancel] [Regenerate link]
- On confirm: call the mutation; on success toast "Invite link regenerated" (the input updates
  via query invalidation); on error toast "Couldn't regenerate the link. Try again."
- Disable the confirm button while the mutation is pending.

## Testing

- `useRotateInviteCode.test.tsx` — mirror `useSetMemberRole.test.tsx`: asserts the RPC is called
  with the right name, returns the new code, and invalidates `["organization"]` on success;
  asserts the error path rejects. (Use the `vi.hoisted` spy pattern for the supabase mock.)
- `OrganizationTab.test.tsx` — the Regenerate button is hidden for reps and managers, shown for
  admins; clicking opens the dialog; confirming calls the mutation. (Mirror AgentsPage.test.tsx
  jsdom polyfills if the dialog needs pointer-capture/scrollIntoView.)
- RPC authz branches (not_authenticated / forbidden for non-admin / success for admin) verified
  via the post-apply prod smoke test.

## Risks

- **Lockout is the intended behavior**, but it is destructive to outstanding links — hence the
  admin-only gate + explicit confirm dialog. No undo (the old code is overwritten); acceptable
  because a fresh rotation can always be issued and per-agent invites are unaffected.
