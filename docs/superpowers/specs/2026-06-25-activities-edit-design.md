# Edit Activities from the Activities Page — Design

**Goal:** Let users edit an existing activity directly from the Activities page History tab,
reusing the edit sheet that already powers the deal timeline.

## Problem

Editing activities already works *from inside a deal* — `EditActivitySheet` (full field edit +
manager/admin-gated delete) is wired into `DealDetailPage`'s timeline, and `useUpdateActivity` /
`useDeleteActivity` already invalidate the activity-log, per-deal, and deals caches so changes
reflect everywhere. The only gap: the **Activities page** has no edit affordance — History rows just
navigate to the deal (`onOpenDeal`). So a rep browsing their activity log can't edit a record there.

## Scope

- Wire the existing `EditActivitySheet` into the Activities page **History** rows.
- History rows only (Today/Upcoming are follow-up-task rows with Log/Snooze — out of scope).
- Tap a History row → open the edit sheet (replaces the current tap → deal navigation).
- No change to `EditActivitySheet`, `useUpdateActivity`, or `useDeleteActivity` — pure wiring.
- Delete stays as the sheet already implements it (manager/admin-only, two-tap confirm). Reps see
  edit only.

## Design (all in `ActivitiesPage.tsx`)

- Import `EditActivitySheet`.
- New state: `const [editingActivity, setEditingActivity] = React.useState<Activity | null>(null);`
- `HistoryRow` prop change: replace `onOpenDeal: (id: string) => void` with
  `onEdit: (a: Activity) => void`. The row `<button>`'s `onClick` calls `onEdit(activity)`. Add
  `aria-label={`Edit ${TYPE_LABEL[activity.type]} activity`}` for clarity.
- In the History list render, pass `onEdit={setEditingActivity}` instead of the navigate callback.
- Render the sheet near the LogActivitySheet (mirroring `DealDetailPage`):
  ```tsx
  {editingActivity && (
    <EditActivitySheet
      open={!!editingActivity}
      onOpenChange={(open) => !open && setEditingActivity(null)}
      activity={editingActivity}
    />
  )}
  ```
- `navigate` stays imported (still used by `EmptyHistoryCard`'s "Go to Pipeline").

## Data flow / reflection

No new plumbing. On save, `useUpdateActivity.onSuccess` invalidates `ACTIVITIES_QUERY_KEY`,
`ACTIVITIES_ORG_QUERY_KEY`, and `DEALS_QUERY_KEY` — so the History list, the deal timeline, and the
deals list all refresh. The `activities_sync_deal_denorm` trigger keeps `deals.last_activity_at` /
`next_followup_at` correct.

## Testing (`ActivitiesPage.test.tsx`)

- Tapping a History row opens the edit sheet prefilled with that activity (assert a field shows the
  activity's value, e.g. its notes/disposition in the sheet).
- The History type filter (shipped previously) still works alongside the edit wiring (regression).
- Use the existing jsdom pointer/scrollIntoView polyfills already in the test file.

## Risks

- **Dropped deal navigation from History rows** — accepted: matches the deal-timeline interaction;
  the deal is reachable from Pipeline. Low impact.
- **Reused sheet brings delete** — intentional and gated (manager/admin + confirm); reps unaffected.
