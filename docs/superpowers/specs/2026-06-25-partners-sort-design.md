# Partners Sort UI — Design

**Goal:** Make the Partners list Sort button functional by exposing the three sort modes that are already implemented.

## Problem

`PartnersPage` already sorts its list by `sortMode` (`"revenue" | "name" | "last-touch"`), and the full
sort logic for all three modes lives in the `filtered` memo
([PartnersPage.tsx:192-206](apps/app/src/features/partners/pages/PartnersPage.tsx)). But `sortMode`
is declared `const [sortMode] = useState("revenue")` with **no setter**, locking it to revenue, and the
Sort button is a `toast("Sort options land in Sprint 2")` stub. The feature is 95% built; only the
control is missing.

## Scope

- Add the `setSortMode` setter.
- Replace the stub Sort button with a Radix `DropdownMenu` listing the three modes, the active one
  checked. Mirrors the Snooze dropdown shipped on ActivitiesPage.
- Out of scope: the separate "Advanced filters" (`SlidersHorizontal`) button — different feature.

## Design

`PartnersPage.tsx`:
- `const [sortMode, setSortMode] = React.useState<SortMode>("revenue");`
- A small `SORT_OPTIONS` array pairs each `SortMode` with a label:
  `[{ mode: "revenue", label: "Revenue" }, { mode: "name", label: "Name" }, { mode: "last-touch", label: "Last touch" }]`.
- Replace the stub `<Button onClick={toast(...)}>` with a `DropdownMenu` (from `@/components/ui/dropdown-menu`)
  whose trigger keeps the current "Sort: {label}" text + `ChevronDown`, and whose items map over
  `SORT_OPTIONS`, calling `setSortMode(opt.mode)` and showing a `Check` icon on the active mode.
- The existing `filtered` memo already reacts to `sortMode` — no logic change.

Keep the trigger label derivation DRY by deriving it from `SORT_OPTIONS` instead of the current nested
ternary.

## Testing

`PartnersPage` test additions (or a new focused test): render the page, open the Sort dropdown, click
"Name", assert the rendered partner rows reorder into alphabetical order (and that the trigger label
updates to "Sort: Name"). Use the jsdom pointer-capture / scrollIntoView polyfills (mirror
AgentsPage.test.tsx) since Radix dropdowns need them.

## Risks

None material — the sort logic is already tested-by-existence (it runs today, locked to revenue). This
only unlocks the other two modes via UI.
