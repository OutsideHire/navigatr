# Plan a Path — Schedule + Reminders + Upcoming (SP3) — Design

**Goal:** Complete the 6-step wizard by adding the **Schedule** step (Step 5): pick a future date +
reminder time + name, save the path as a future-dated *planned* path, surface it in an **Upcoming
paths** list, and remind the rep in-app. Builds on SP2 (the shipped wizard) and the existing paths
model.

## Grounding
- `paths` already has `path_date date`, `status ('planned'|'completed')`, `unique(user_id, path_date)`.
  A future-dated planned path IS an "upcoming path" — no new status/table.
- `usePaths` fetches all paths by date desc (id, path_date, origin_label, origin_lat/lng, status,
  stop count).
- No push/notification infra. The header bell (`NotificationsBell`) is a **client-derived** view
  (`useFollowUpReminders` over cached activities/deals). SP3's path reminder mirrors that pattern —
  **in-app only**, no push (per decision).

## Migration — `supabase/migrations/20260701000001_path_schedule.sql`
Additive, nullable, no RLS/status change:
```sql
alter table paths add column if not exists name text;
alter table paths add column if not exists reminder_at timestamptz;
```
Hand-applied to prod with the user's authorization (`supabase db query --linked -f …` +
`migration repair`), then smoke-tested. No backfill needed (nullable).

## Data layer
- `usePathMutations.createPath`: accept optional `name` and `reminderAt` (ISO) alongside `date`;
  include them in the upsert `{ user_id, path_date, name, reminder_at, origin_* }`.
  `CreatePathInput` grows `name?: string | null; reminderAt?: string | null`.
- `usePaths` select: add `name, reminder_at`; expose on the row type.

## Wizard changes (SP2 → 6 steps)
- Insert `schedule` into `PLAN_STEPS` **between `review` and `saved`** → stepper auto-shows "of 6".
- **Move the save**: SP2 saves on the review Continue. SP3 changes review Continue to advance to
  `schedule` (no save yet); the **Schedule step's Continue performs the save** (createPath with the
  chosen date + name + reminder_at, then addStops), advancing to `saved`.
- **`PlanScheduleStep`** (`components/plan/PlanScheduleStep.tsx`):
  - Date quick-picks: Today / Tomorrow / Next week (next Monday) / Pick a date (date input). Default
    Tomorrow (Plan = "prep tomorrow's route").
  - Reminder time: a time input, default 08:30 local; combined with the chosen date →
    `reminder_at` (ISO, local-tz aware).
  - Name: auto-generated default `"{originLabel} · {Weekday Mon D}"` (e.g. "Edmond, OK · Tue Jul 2"),
    shown in an editable text field the rep can override.
  - Continue = save (see above). Guard: valid future-or-today date required.
- **`PlanSavedStep`** copy updates to reflect scheduling ("… is ready · launch it from Upcoming
  anytime") + "Reminder set for {date, time}" + "View upcoming" → the upcoming surface.

## Upcoming paths surface
- `UpcomingPaths` component (rendered on `PathPage`, e.g. under the entry state): lists planned paths
  with `path_date >= today` and `status = 'planned'` (from `usePaths`), showing name, date, reminder
  time, and stop count, plus a **Launch/Open** action (navigate to that path). Today's due paths are
  highlighted.
- The saved screen's "View upcoming" routes to `/path` and this surface.

## In-app reminder
- `usePathReminders` hook (mirrors `useFollowUpReminders`): derived over `usePaths` — planned paths
  that are **due** (`reminder_at <= now`, or `path_date === today` when no reminder_at) and not
  completed. Returns items with name/date for display.
- Fold path reminders into `NotificationsBell` alongside follow-ups (a labeled section or merged
  list); keep the change minimal and the existing follow-up items intact. Badge count includes due
  paths.

## Files
- Migration (above).
- `hooks/usePathMutations.ts` (createPath args), `hooks/usePaths.ts` (select + type),
  new `hooks/usePathReminders.ts`.
- `components/plan/PlanScheduleStep.tsx` (new) + `steps.ts` (insert `schedule`) +
  `pages/PlanPathWizard.tsx` (move save to schedule step, wire name/reminder/date state) +
  `components/plan/PlanSavedStep.tsx` (copy).
- `components/UpcomingPaths.tsx` (new) + `pages/PathPage.tsx` (render it).
- `components/layout/NotificationsBell.tsx` (fold in path reminders).

## Testing
- Migration smoke (post-apply): `paths` has `name`, `reminder_at`.
- `createPath` includes name + reminder_at in the upsert.
- `PlanScheduleStep`: date quick-picks set the date; default name derives from origin+date and is
  editable; reminder time composes reminder_at; Continue saves with the future date + name +
  reminder_at and advances to saved.
- Wizard integration: review → schedule → saved ("Step N of 6"); save uses the scheduled date.
- `usePathReminders`: due logic (reminder_at ≤ now / today) excludes completed + future-not-due.
- `UpcomingPaths`: lists future planned paths; launch navigates.
- `NotificationsBell`: due path appears; follow-up items still present; count includes both.

## Non-goals
Native/browser push notifications (needs web-push/FCM + service worker + subscriptions + scheduled
sender — a separate future SP). SP3 reminders are in-app only.

## Risks
- Moving the save from review→schedule: keep the review step's own state intact; only the Continue
  target changes. Ensure the wizard's save path (createPath+addStops) runs once, on schedule Continue.
- Bell merge: don't regress existing follow-up reminders — additive only.
- Prod migration is additive + nullable → safe; still requires user authorization to apply.
