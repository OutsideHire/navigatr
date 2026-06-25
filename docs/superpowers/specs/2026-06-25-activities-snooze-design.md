# Activities snooze (2026-06-25)

> Built autonomously under `/loop` while the user was away. Design decisions are the obvious
> defaults for a low-risk, frontend-only feature; the **merge is held** for the user's review.

## Problem

On the Activities page, each Today/Upcoming task row has a **Snooze** button that just
`toast("Snooze lands in sprint 2")`. A task is a *view* of an activity's `followUpDate` (a task
exists per activity with a non-null `followUpDate`, due on that date). "Snooze" should push the
task to later.

## Decision (obvious default — frontend-only, no migration)

- **Snooze = push the source activity's `follow_up_date` forward**, reusing the existing
  `useUpdateActivity` mutation (`patch: { followUpDate }` → snake-cased to `follow_up_date`, a DATE).
  No new column, no migration.
- **Options:** a small menu on the Snooze button — **Tomorrow** (+1 day), **In 3 days** (+3),
  **Next week** (+7) — computed from *today* (UTC date), not the current due date (a rep snoozing
  an overdue task means "deal with it in N days from now", which is the useful semantic).
- After a successful patch, the task re-derives to the new due date (drops off Today / moves in
  Upcoming) on cache invalidation (`useUpdateActivity` already invalidates the activities + deals
  caches). Toast `"Snoozed to {date}"`.

## Architecture

- **`features/activities/lib/snoozeDate.ts`** (pure, tested) — `snoozeDate(option, now): string`
  where `option ∈ "tomorrow"|"3days"|"week"` → ISO date (YYYY-MM-DD) = `now + {1|3|7}` days (UTC).
  Plus `SNOOZE_OPTIONS` (the ordered list with labels) for the menu.
- **ActivitiesPage task row** — replace the stub Snooze `Button` with a Radix `DropdownMenu`
  (already used elsewhere) of `SNOOZE_OPTIONS`; on select, call
  `useUpdateActivity().mutate({ id: task.fromActivity.id, dealId: task.deal.id, patch: { followUpDate: snoozeDate(opt, new Date()) } })` with success/error toasts. (The page already has `useUpdateActivity` available or imports it alongside the other activity hooks.)

## Testing

- `snoozeDate` — pure: each option yields today+1/3/7 as a YYYY-MM-DD string; boundary (month end).
- ActivitiesPage / task row — the Snooze menu renders the 3 options; selecting one calls
  `useUpdateActivity.mutate` with the right `{id, dealId, patch.followUpDate}`; success toasts.
  Keep existing Activities tests green (mock `useUpdateActivity`).

## Out of scope

A dedicated snooze/`snoozed_until` column or snooze history; custom date picker; snoozing from
anywhere other than the task rows; backend changes (none — reuses `useUpdateActivity`).
