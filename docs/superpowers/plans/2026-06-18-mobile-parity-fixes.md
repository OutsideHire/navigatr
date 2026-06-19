# Desktop ↔ mobile parity fixes — implementation plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Close the four real desktop/mobile parity gaps (admin nav on mobile; Pipeline search/filter/sort on mobile; Partners search on mobile; admin Team table → cards on mobile).

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-mobile-parity-fixes-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/mobile-parity/apps/app`. Each task is independent; ship together. jsdom doesn't apply media queries, so tests assert both trees render + are wired (responsive visibility confirmed later in a live pass).

---

### Task 1: Admin Team + Insights in the mobile avatar menu
**Files:** `src/components/layout/TopBar.tsx` (+ its test if present, else add coverage in `AppLayout.test.tsx` or a new `TopBar.test.tsx`).
- READ `TopBar.tsx` (`AvatarMenu` component + its `desktop` prop) and `SidebarNav.tsx` (the `isManagerOrAdmin` derivation via `useProfile`, and the Team/Insights items: `to`, label, icon).
- In `AvatarMenu`: derive `isManagerOrAdmin` (via `useProfile`, matching SidebarNav). When `!desktop && isManagerOrAdmin`, render an "Admin" group (`DropdownMenuSeparator` + `DropdownMenuLabel "Admin"`) with two `DropdownMenuItem`s: "Team" → `navigate("/admin/agents")`, "Insights" → `navigate("/admin/insights")` (reuse SidebarNav's icons). Do NOT show them when `desktop` (sidebar already has them).
- TDD: test that a manager (mock `useProfile` role="manager") sees Team + Insights in the mobile avatar menu and selecting navigates; a rep (role="rep") does not; the desktop instance does not render them. Mirror existing TopBar/AppLayout test mocks (auth, profile, router).
- Commit: `fix(nav): expose Team + Insights in the mobile avatar menu for managers`.

### Task 2: Pipeline Search + Filter + Sort on mobile
**Files:** `src/features/pipeline/pages/PipelinePage.tsx` (+ `PipelinePage.test.tsx`).
- READ `PageHeader` in `PipelinePage.tsx` — the `hidden … sm:flex` desktop action row holding the search `Input`, `PipelineFilterPopover`, the Sort `Select`, `ViewToggle`, and Add button.
- Add a **mobile control row** rendered `sm:hidden` (below the header, above the chips) containing: a full-width search `Input` (same `search`/`onSearchChange` props already threaded into `PageHeader`), the `PipelineFilterPopover` (`filters`/`onFiltersChange`), and the Sort `Select` (`sortKey`/`onSortChange`) — arrange `flex flex-col gap-2` with filter+sort in a `flex gap-2` sub-row. Keep the existing desktop `sm:flex` row unchanged. Do NOT add `ViewToggle` to mobile (Kanban is desktop-only). Reuse the exact same control components/props already in the desktop row (the page already passes all needed props to `PageHeader`).
- TDD: assert the mobile search input + filter trigger + sort control render (they'll be in the DOM alongside the desktop ones — query by role and assert ≥1, or scope to the mobile row by a test id/class); assert typing the mobile search still narrows the rendered deals (wiring intact). Keep existing PipelinePage tests green (they may now match multiple search inputs — adjust queries to `getAllBy`/scope as needed).
- Commit: `fix(pipeline): expose search, filter, and sort on the mobile pipeline list`.

### Task 3: Partners Search on mobile
**Files:** `src/features/partners/pages/PartnersPage.tsx` (+ test).
- READ the `hidden … sm:flex` action row (search `Input` + the stub Filter/Sort buttons + Add).
- Add a `sm:hidden` mobile search `Input` row bound to the existing `searchInput`/`setSearchInput` (+ debounce already in place). Do NOT surface the stub Filter/Sort on mobile.
- TDD: a search input is reachable outside the desktop row and typing narrows the partner list. Keep existing tests green (adjust to `getAllBy` if two inputs now match).
- Commit: `fix(partners): expose partner search on mobile`.

### Task 4: Admin Team table → cards on mobile
**Files:** `src/features/admin/pages/AgentsPage.tsx` (+ test; optional `AgentCard` extraction).
- READ `AgentsPage.tsx` — the agents `<table>` (columns + the row actions: view/reassign/revoke or links) and the data/sort source.
- Wrap the existing table in `hidden md:block`. Add a `md:hidden` card list: map the same agents to cards showing name, email, status + role badges, open deals / pipeline $ / win rate, and the same row actions/links. Both read the same data + sort. Optionally extract `AgentCard`.
- TDD: with mocked agents, the card list renders each agent's name + key fields + the action(s); the table also renders (both trees present in jsdom). Keep existing AgentsPage tests green (queries may now match twice — scope or `getAllBy`).
- Commit: `fix(admin): mobile card layout for the agents team table`.

---

### Final
After all four: `pnpm typecheck && pnpm test` (full) → clean/green. Then finishing-a-development-branch (merge + push). No migration/dep change.

## Notes for the implementer
- Reuse existing control components verbatim (PipelineFilterPopover, Select, Input, DropdownMenuItem) — no new primitives.
- Existing tests across these pages may break only because a control now appears twice (desktop + mobile DOM). Fix by scoping queries (`within`, a row `data-testid`) or `getAllBy…`, NOT by removing the desktop instance.
- Keep all desktop behavior identical — these fixes ADD mobile surfaces, they don't change desktop.
