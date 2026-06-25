# Dashboard Date Range — Design

**Goal:** Replace the Dashboard's stub "Last 30 days" / "Filter" buttons with a real date-range
selector that re-scopes the *flow* KPIs, while *stock* KPIs stay current and are labelled as such.

## Problem

`PageHeading` ([DashboardPage.tsx:153-170](apps/app/src/features/dashboard/pages/DashboardPage.tsx))
has two stub buttons — "Last 30 days" → `toast("Custom date ranges land in Sprint 2")` and "Filter" →
`toast("Dashboard filters land in Sprint 2")` — and the heading date is the hardcoded `MOCK.date.display`.
`useDashboardData()` takes no params and computes every metric over the full dataset, so there is no
time-windowing to switch on.

## Key design decision: flow vs. stock

A date range has unambiguous meaning only for **flow** metrics (things that accumulate over a period).
Applying it to **stock** metrics (snapshots of *now*, like current open pipeline) would be misleading.
So the range re-scopes flow metrics; stock metrics stay current and carry a small "Current" marker.

**Flow — re-scoped by the range:**
- `totalActivities` — activities whose `occurredAt` is in the window.
- `activitiesToWin` (the hero) — activities-in-window ÷ deals-won-in-window. "Won in window" =
  `deal.stage === "won" && updatedAt in window` (same `updatedAt` won-date proxy the monthly chart
  already uses; its caveat is documented on the field).
- `persistenceIndex[0]` "touches before win" — mirrors `activitiesToWin`, so it follows automatically.

**Stock — unchanged, marked "Current":** `kpis` (open/weighted pipeline, active count, all-time won
count/revenue/win-rate), `byStage`, `topPartners`, `conversionFunnel`, `todaysSnapshot`,
`monthlyPerformance` (already its own trailing-4-month window), `leadSources`.

## Architecture

### `dateRange.ts` (new, pure + tested)
- `export type RangeKey = "7d" | "30d" | "90d" | "all";`
- `export interface DateRange { fromIso: string | null; toIso: string; }` — `fromIso === null` means all-time.
- `export const RANGE_OPTIONS: { key: RangeKey; label: string }[]` —
  `7d`→"Last 7 days", `30d`→"Last 30 days", `90d`→"Last 90 days", `all`→"All time".
- `export function resolveRange(key: RangeKey, now: Date): DateRange` — `toIso = now.toISOString()`;
  `fromIso = key === "all" ? null : (now - N days).toISOString()`.
- `export function withinRange(iso: string, range: DateRange): boolean` — `iso <= toIso && (fromIso === null || iso >= fromIso)`. Lexicographic ISO compare is safe for UTC ISO strings.

### `useDashboardData(range: DateRange)`
- New required `range` param. Flow memos gain `range` in their deps and filter via `withinRange`:
  - `activitiesInRange = activities.filter(a => withinRange(a.occurredAt, range))` → drives
    `totalActivities` and `activitiesToWin`.
  - `wonInRange = deals.filter(d => d.stage === "won" && withinRange(d.updatedAt, range)).length` →
    the denominator for `activitiesToWin.ratio` and `wonDealsCount` (a range-scoped count, distinct
    from `kpis.wonDealsCount` which stays all-time for the stock KPI cards).
- Stock memos are untouched (no `range` in deps).
- `DashboardData` is unchanged in shape; only the values of the flow fields now respect `range`.

### `DashboardPage.tsx`
- Owns `const [rangeKey, setRangeKey] = React.useState<RangeKey>("30d");`
- `const range = React.useMemo(() => resolveRange(rangeKey, new Date()), [rangeKey]);` passed to
  `useDashboardData(range)`.
- `PageHeading` receives `rangeKey` + `onRangeChange`; the "Last 30 days" button becomes a
  `DropdownMenu` over `RANGE_OPTIONS` (active one checked), trigger label = the active option's label.
- Remove the "Filter" button entirely.
- Replace `MOCK.date.display` in the subtitle with the active range label (e.g. "Card processing
  pipeline · Last 30 days"). The literal "today" date is dropped — the range now describes the scope.
- Flow sections (hero, persistence) need no marker (they reflect the range). Stock section headers
  get a subtle "Current" caption/badge so it's honest the range doesn't move them. Apply this to the
  pipeline-KPI area, by-stage, top-partners, conversion-funnel, today's-snapshot, lead-sources,
  monthly-performance headers. Use a single small shared element (e.g. a `<span>` with muted caption
  styling) rather than restyling each card.

## Testing

- `dateRange.test.ts` — `resolveRange` (each key: correct `fromIso` offset, `all` → null) and
  `withinRange` (inside, on each boundary, outside, all-time always true). Pass a fixed `now`.
- `useDashboardData` test — seed activities/deals across two windows (mock the four source hooks);
  assert `totalActivities` and `activitiesToWin` change with `range`, and a stock metric
  (`kpis.pipelineValueCents`, `byStage`) does **not**.
- `DashboardPage` (or PageHeading) test — the range dropdown renders the four options, no "Filter"
  button is present, and selecting "Last 7 days" updates the trigger label.

## Risks

- **Mixed semantics confusion** — mitigated by the "Current" markers on stock sections.
- **`updatedAt` as won-date proxy** — imperfect (a note-edit on an old won deal re-bumps it), but it's
  the existing convention (monthly chart uses it); documented, not introduced here.
- **`new Date()` in render** — `resolveRange` is memoised on `rangeKey`, so `now` is captured per
  selection, not per render; acceptable (the dashboard isn't open across day boundaries in practice).
