# Activities Type Filter — Design

**Goal:** Make activity-type filtering available across the whole Activities page via one shared
control above the tabs, instead of only on the History tab.

## Problem

Type-filter chips (All / Calls / Emails / Drop-ins / Appointments) exist today, but only render
inside the **History** tab. The page opens on **Today**, so a rep sees no type filter at all unless
they navigate to History. Today and Upcoming (the follow-up-task views) can't be narrowed by type.

## Design

Lift the existing `typeFilter` state to drive all three tabs from one chip row placed **above the tab
bar** (between `UnloggedCallsSection` and `Tabs.Root`). One selection applies everywhere and persists
across tab switches (single source of truth).

### Filtering per tab
- **Today / Upcoming** — these are derived follow-up tasks (`DerivedTask`). Add a `visibleTasks` memo:
  `typeFilter === "all" ? tasks : tasks.filter((t) => t.fromActivity.type === typeFilter)`. The
  existing `overdue/today/upcoming` grouping memo consumes `visibleTasks` instead of `tasks`, so
  groups narrow and empty groups drop out naturally.
- **History** — already filters `activities` by `type` (unchanged), driven by the same `typeFilter`.

### Tab counts recompute under the filter
The counts in the tab triggers reflect the filtered set so the control feels connected:
- `todayCount = overdue.length + today.length` (already derived from the grouped tasks → automatically
  filtered once grouping uses `visibleTasks`).
- `upcomingCount = upcoming.length` (same).
- `historyCount = history.length` (change from `activities.length` to the filtered list length).

### Chips show no counts
The filter chips drop their per-type `count` prop. Rationale: above the tabs, a single number can't
honestly represent three different views (e.g. "Calls 40" total-logged vs. only 2 call follow-ups
visible on Today). The per-tab trigger counts carry the numbers instead. The `typeCounts` memo is
removed (its only consumer was the chips).

### Empty states under an active filter
When a tab's filtered set is empty **and** a type filter is active, show a distinct
`FilteredEmptyCard` ("No {Calls} activities here." + a "Clear filter" tertiary button calling
`setTypeFilter("all")`) instead of the natural empty card (EmptyTodayCard / EmptyUpcomingCard /
EmptyHistoryCard), which would misleadingly say "all caught up." When `typeFilter === "all"`, the
existing empty cards render as before.

## Components / changes (all in `ActivitiesPage.tsx`)
- New `visibleTasks` memo; grouping memo switches `tasks` → `visibleTasks`.
- `historyCount` → `history.length`.
- Remove the `typeCounts` memo; move the chip row above `Tabs.Root`; drop `count` from each `Chip`;
  add `aria-label="Filter by activity type"` on the row.
- Remove the old chip row from inside the History `Tabs.Content`.
- New `FilteredEmptyCard` component; each tab's empty branch chooses filtered-empty vs. natural-empty.

## Testing (`ActivitiesPage.test.tsx`, or a focused new test)
- Selecting "Calls" from the above-tabs filter narrows the **Today** list to call-sourced tasks, and
  the "Today" tab-trigger count updates to match.
- The selection persists when switching Today → History (same filtered type applied).
- A filter that matches nothing on the active tab renders the "Clear filter" empty state; clicking it
  restores `all` and the full list.
- History still filters by type (regression guard for the relocated control).
- Use the jsdom pointer/scrollIntoView polyfills if the test drives Radix Tabs interactions.

## Risks
- **Task type semantics** — a Today/Upcoming task's type is its *source activity's* type
  (`fromActivity.type`), i.e. "follow-ups from calls." This is the natural reading and matches how
  the task was generated; documented so it isn't mistaken for a bug.
- Low blast radius — pure presentational/state relocation; no data-layer or RPC change.
