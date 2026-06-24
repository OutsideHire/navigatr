# Mark route complete — End-route option + Path-complete report (2026-06-24)

## Problem

The Paths "End route" flow (`EndRouteSheet`, opened from `RunningPath` when stops are still
pending) offers **Carry to tomorrow** / **Clear & start over** / **Cancel** — but no way to
**finalize the route now and see the result**. The "Path complete" report (`PathSummary`)
already exists, but only renders when every stop is resolved (`RunningPath`'s `allDone` branch).
So a rep who is done for the day with stops still pending can't mark the route complete or view
the completion report.

This adds a **"Mark route complete"** action to the End-route flow that finalizes the current
path and shows the existing `PathSummary` report.

## Decisions (locked in brainstorming)

- **Pending stops are auto-skipped** on mark-complete (reuses the existing `finalizeSingle`
  mutation; matches how the lazy carryover finalizes unfinished paths via `finalizeOlderThan`).
  The report counts them as **Skipped**; completion % = visited / total.
- **Persist** the path as `completed` (what `finalizeSingle` already does).
- After marking complete, the rep **stays on the `PathSummary` report** (does NOT exit); they
  leave via the report's existing View-pipeline / New-path actions.
- **"Mark route complete" is the primary** button in the sheet; Carry secondary; Clear
  tertiary/danger; Cancel ghost.
- Web + mobile: `EndRouteSheet` and `PathSummary` are already responsive — no layout work.

## Architecture

### A. `usePathMutations` — expose `finalizeSingle`
`finalizeSingle(pathId)` already exists (skips the path's pending stops, then sets the path
`status = 'completed'`). Ensure it is **returned from the hook** and that callers can `await` it;
if it isn't already a `useMutation`/exposed function, expose it as an async function (or a
mutation) and invalidate the path query keys on success (the same `invalidate` the other
mutations use), so `useTodayPath`/previous-path/paths refresh.

### B. `EndRouteSheet` — add the action
Add prop `onComplete: () => void`. Render a new **"Mark route complete"** `Button`
(variant `primary`, disabled/`loading` while `busy`) as the first action, then **Carry N to
tomorrow** (secondary), **Clear & start over** (tertiary), **Cancel** (secondary/ghost). Update
the body copy to mention finishing now (e.g. "Mark this route complete, carry the remaining
{N} to tomorrow, or clear and start over."). `busy` already disables all actions.

### C. `RunningPath` — wire + display the report
- Pull `finalizeSingle` from `usePathMutations` alongside `carryToTomorrow`.
- Add local state `const [completed, setCompleted] = React.useState<PathSummaryStats | null>(null)`
  where `PathSummaryStats` is the prop bundle `PathSummary` needs (`visitedCount`,
  `skippedCount`, `totalStops`, `routeMeters`, `dispositions`, `dealsCreated`).
- `handleComplete`:
  1. Guard `!pathId`.
  2. Compute a **snapshot** from the current `stops`, counting still-pending as skipped:
     `visitedCount = visited`, `skippedCount = skipped + pending`, `totalStops = total`,
     `routeMeters = routeStats(origin, stops…).totalRouteMeters`,
     `dispositions = visited stops' dispositions`, `dealsCreated = stops with dealCreated`.
  3. `await finalizeSingle(pathId)`; on success `setCompleted(snapshot)` and close the sheet
     (do NOT call `onExit`). On throw → `toast.error(...)`, keep the sheet open (mirror
     `handleCarry`'s error handling).
- Render: when `completed` is non-null, render `<PathSummary {...completed} onViewPipeline
  onNewPath={() => { void clear(); onExit(); }} />` (in the same wrapper the `allDone` branch
  uses). The snapshot makes the report robust even if `useTodayPath` drops the now-`completed`
  path on refetch. The existing `allDone` → `PathSummary` branch is unchanged (covers the
  natural all-resolved case).
- Status-bar "End route" button → `handleEndRoute` unchanged (opens the sheet when pending > 0).
- Pass `onComplete={handleComplete}` and keep `busy` reflecting in-flight finalize
  (`finalizeSingle` pending) in addition to `carryToTomorrow.isPending`.

## Data flow

End route (pending > 0) → sheet → **Mark route complete** → snapshot computed → `finalizeSingle`
(skip pending + path completed) → `setCompleted(snapshot)` + close sheet → `PathSummary` renders
from the snapshot → rep taps View pipeline or New path to leave. Other sheet actions
(carry/clear/cancel) unchanged.

## Error handling / edge cases

- **Finalize failure** → toast, sheet stays open, no report shown, path unchanged (retryable).
- **No pending stops** → `handleEndRoute` already exits without opening the sheet (the all-done
  `PathSummary` already shows), so "Mark complete" is only reachable with pending stops.
- **Double-submit** → `busy` disables all sheet actions while finalize is in flight.
- **`useTodayPath` drops the completed path on refetch** → the local snapshot still drives the
  report, so it renders regardless.

## Testing

- `EndRouteSheet`: the "Mark route complete" button renders and calls `onComplete`; it (and the
  others) are disabled while `busy`.
- `RunningPath`: choosing Mark complete calls `finalizeSingle` with the path id, then renders
  `PathSummary` with pending counted in the Skipped total and does **NOT** call `onExit`;
  finalize-failure toasts and keeps the sheet open (no report). The existing
  carry/clear/cancel and all-done tests stay green.
- `usePathMutations`: `finalizeSingle` skips pending stops and marks the path completed
  (permissive supabase mock, like the other mutation tests); is exposed from the hook.

## Out of scope

Changing Carry / Clear / Cancel; the natural all-done auto-summary (unchanged); deal/disposition
logic; a distinct DB status beyond `completed`; reopening a completed path.
