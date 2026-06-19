# Desktop ↔ mobile parity fixes (2026-06-18)

Fixes the four real parity gaps found in the parity audit (the rest of the app is parity-clean
or intentionally adapted). One branch, four independent fixes.

## Fix 1 — Admin Team + Insights reachable on mobile

**Gap:** `SidebarNav` (desktop) shows Team (`/admin/agents`) + Insights (`/admin/insights`) for
managers/admins; mobile `BottomNav` has no admin entries, so those features are URL-only on a phone.

**Design:** the `BottomNav` (5 fixed main tabs) has no room, so add the two admin destinations to
the **TopBar `AvatarMenu`** — which already renders on mobile (Profile / Settings / theme / Sign
out). Show them **only on mobile** (`AvatarMenu` has a `desktop` prop; render the admin group when
`!desktop`) since desktop already has them in the sidebar, and **only for managers/admins**
(`profile.data?.role === "manager" || "admin"`, the same predicate `SidebarNav` uses via
`useProfile`). Add a `DropdownMenuLabel`/group "Admin" with "Team" → `/admin/agents` and "Insights"
→ `/admin/insights` (navigate on select). Icons: reuse whatever SidebarNav uses for those items.

## Fix 2 — Pipeline list: Search + Filter + Sort on mobile

**Gap:** all three live in the `hidden … sm:flex` desktop action row; mobile gets only stage chips.

**Design:** make the controls available at all widths. Add a **mobile control row** (visible below
`sm`, `sm:hidden`) under the header containing: a full-width search `Input` (bound to the same
`searchInput` state) + the existing `PipelineFilterPopover` + the Sort `Select` (in a
`flex flex-col gap-2` / inline arrangement). Keep the existing desktop `sm:flex` row as-is. The
**ViewToggle stays desktop-only** (Kanban is desktop-only by design). The Add-deal FAB (mobile) /
button (desktop) is unchanged. Net: mobile reps can search, filter, and sort.

## Fix 3 — Partners list: Search on mobile

**Gap:** the partner search `Input` is in the `hidden … sm:flex` row; mobile loses search (status
chips still work; Filter/Sort there are no-op Sprint-2 stubs, so leave those desktop-only).

**Design:** add a `sm:hidden` mobile search `Input` row (bound to the existing `searchInput` state),
mirroring Fix 2's pattern. Do NOT surface the stub Filter/Sort on mobile (they're non-functional).

## Fix 4 — Admin Team table → cards on mobile

**Gap:** `AgentsPage` renders an 11-column table that only horizontal-scrolls on mobile.

**Design:** render the existing `<table>` at `md+` (`hidden md:block` wrapper) and a **card list**
below `md` (`md:hidden`): one card per agent showing the scan-critical fields (name, email, status +
role badges, open deals / pipeline $ / win rate) and the same row actions (the existing
view/reassign/revoke affordances). Both views read the same agents data + sort; only presentation
differs. No data/query change.

## Architecture / files

- **Fix 1:** `src/components/layout/TopBar.tsx` (`AvatarMenu`) — add role-gated mobile-only admin
  items; pull role via `useProfile` (as `SidebarNav` does).
- **Fix 2:** `src/features/pipeline/pages/PipelinePage.tsx` (`PageHeader`) — add the mobile control
  row; reuse `PipelineFilterPopover`, the Sort `Select`, and the search `Input`.
- **Fix 3:** `src/features/partners/pages/PartnersPage.tsx` — add the mobile search `Input` row.
- **Fix 4:** `src/features/admin/pages/AgentsPage.tsx` — add the `md:hidden` card list; gate the
  table `hidden md:block`. Consider extracting an `AgentCard` for the mobile rows.

## Testing

- **Fix 1:** `TopBar`/`AvatarMenu` test — a manager sees Team + Insights items in the mobile avatar
  menu (selecting navigates); a non-manager does not; the desktop instance (`desktop` prop) does not
  duplicate them.
- **Fix 2:** `PipelinePage` test — the search input, filter control, and sort control are present
  in the mobile control row (query the `sm:hidden` row / by role); changing them still filters/sorts
  `visible` (the existing wiring). (jsdom doesn't apply media queries, so assert the controls render
  and are wired — both rows exist in the DOM; that's acceptable and noted.)
- **Fix 3:** `PartnersPage` test — a search input is rendered outside the desktop-only row and is
  bound to the same filter (typing narrows the list).
- **Fix 4:** `AgentsPage` test — both the table and the card list render the agents (jsdom renders
  both since media queries don't apply); each agent's name + key fields + actions appear in the card
  list.

Note: because jsdom does not evaluate CSS media queries, tests assert that the mobile and desktop
trees both render their content and are wired correctly; true responsive visibility is confirmed in
the recommended live Playwright visual pass.

## Out of scope

Wiring search to a real backend query (still client-side filter as today); building the Partners
Filter/Sort stubs; redesigning BottomNav; the live visual pass itself (separate, needs the user's
authed session).
