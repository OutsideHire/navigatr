# Activity Logging Coverage — SP2a: Rep coverage widget (2026-06-24)

First half of SP2 (display layer) of the Activity Logging Coverage roadmap
(`docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`). SP2 was split:
**SP2a = the rep-facing coverage widget** (this spec); **SP2b = the cross-cutting credibility
badge + red-band warning on other widgets, plus hierarchy aggregates** (later cycle).

SP2a is where the coverage % finally surfaces to reps. It is a **single new dashboard card** that
reads the rep's own `coverage_snapshot` (shipped + live in SP1). No backend changes.

## Decisions (locked in brainstorming)

- **Scope: the dedicated rep widget only.** The credibility badge + red-band warning on *other*
  dashboard widgets are cross-cutting and **deferred** — at launch (one tap-based channel, mostly
  `low`/`insufficient` confidence, near-zero data) annotating the whole dashboard amber/red would
  mislead more than inform. They land once coverage is multi-channel / trustworthy (SP2b+).
- **Layout: Stat-forward (compact).** Big % colored by band + a band pill, a one-line channel
  summary, a compact trend sparkline, and a "How is this calculated?" link. One grid slot.
- **Empty/insufficient = always-show, instructional.** The widget is always on the dashboard
  (PRD FR-DASH-LC-01); with no/low data it shows a teaching state, not a hidden/blank card.
- **Placement: the populated dashboard's right-column section grid, high up (near Persistence
  Index)** — it's a data-quality stat, kept compact, one slot. Not in the gradient hero / KPI row.
- **Trend sparkline reuses the existing DIY flex-bar idiom** (no chart library — consistent with
  MonthlyPerformance / ConversionFunnel).
- **Band/threshold math is reused from `_shared/coverage`, not reinvented**; only the
  band→Tailwind-token/label mapping is a new frontend helper.

## Architecture

### A. Data hook — `useCoverageSnapshots`

New `apps/app/src/features/coverage/hooks/useCoverageSnapshots.ts` — TanStack Query reading the
rep's own snapshots (RLS already scopes to `user_id = auth.uid()` + manager-subtree; a rep sees
their own):

```ts
supabase.from("coverage_snapshot")
  .select("snapshot_date, composite_coverage, confidence_level, call_coverage, call_event_count, active_channels")
  .order("snapshot_date", { ascending: false })
  .limit(30)
```

Returns `{ latest: CoverageSnapshot | null, series: CoverageSnapshot[] }` (latest = newest row;
series = chronological for the sparkline). Mirrors `useDeals`/`useActivities` (queryKey
`["coverage","snapshots", userId]`, `enabled: Boolean(userId)`, `staleTime: 30_000`). Empty result
→ `{ latest: null, series: [] }`.

### B. Shared-logic reuse + the frontend presentation helper

- **Reuse** `band()` and `resolveCoverageConfig()`/`DEFAULT_COVERAGE_CONFIG` from
  `supabase/functions/_shared/coverage/score.ts` + `config.ts`, imported by deep relative path
  (precedent: `useMerchants` imports `industryTaxonomy`). **Add those two files to
  `apps/app/tsconfig.app.json`'s `include` array** (the existing entry lists
  `industryTaxonomy.ts` the same way) so the app typechecks them.
- The widget derives the **band** from `latest.composite_coverage` via
  `band(composite, DEFAULT_COVERAGE_CONFIG.bandThresholds)`. **SP2a uses the default thresholds**
  (no org has `coverage_config` overrides yet — `resolveCoverageConfig('{}')` ≡ defaults — and
  there's no admin UI to set them); honoring per-org overrides is deferred to when that config UI
  exists. Documented simplification, currently exactly equivalent.
- **New frontend helper** `apps/app/src/features/coverage/lib/bandPresentation.ts` (pure,
  unit-tested):
  - `bandPresentation(band): { label: string; tokenClass: string }` — maps
    `excellent`/`good` → `status-success`, `adequate`/`poor` → `status-warning`,
    `unreliable` → `status-danger`, with labels "Excellent"/"Good"/"Adequate"/"Poor"/"Unreliable".
  - `confidenceLabel(level): string | null` — `low`/`insufficient` → `"Estimated · low confidence"`;
    `medium` → `"Estimated"`; `high` → `null` (no qualifier). (Token mapping is a frontend concern;
    the threshold math stays shared.)

### C. Widget component — `CoverageWidget`

`apps/app/src/features/coverage/components/CoverageWidget.tsx`, rendered in `DashboardPage`'s
populated right-column grid. Three states from the hook:

1. **No / insufficient** (`latest == null` OR `confidence_level === 'insufficient'`): a `Card`
   titled "Logging coverage" with a "No data yet" pill, the teaching line — *"Make calls with
   tap-to-call and log the outcome — once you have a few, we'll show how much of your calling is
   captured."* — and the "How is this calculated?" link. No %.
2. **Thin data** (`confidence_level ∈ {low, medium}` with a non-null composite): the band-colored
   `composite_coverage` %, the band pill, the `confidenceLabel` qualifier
   ("Estimated · low confidence"), the channel summary, the sparkline.
3. **Solid data** (`confidence_level === 'high'`): same as thin, no qualifier.

Common elements (states 2–3):
- **Headline:** `Math.round(composite_coverage*100)%` in `bandPresentation().tokenClass` text color +
  the band pill (token bg).
- **Channel summary:** one line — `Phone · {call_event_count} calls · {round(call_coverage*call_event_count)} logged`.
- **Trend sparkline:** flex-bar chart of `series` `composite_coverage` over the trailing 30
  snapshots, bars colored by the latest band's token; renders only when `series.length >= 2`.
- **"How is this calculated?":** a Radix `Popover` (already used in the app) with plain-language
  methodology — active channels, the call rule ("a tap-to-call counts as logged when you log a
  Call activity within 4 hours"), and what the confidence level means. Help-not-warn framing;
  never "compliance"/"audit".

### D. Dashboard wiring

In `DashboardPage.tsx`'s `PopulatedDashboard`, render `<CoverageWidget />` as a section `Card` in
the right-column grid, positioned near the Persistence Index block. No change to the empty
(onboarding) dashboard. No other widget is touched (badges/warnings are SP2b).

## Data flow

Nightly SP1 job → `coverage_snapshot` rows → `useCoverageSnapshots` (rep's own, latest + 30-day
series) → `CoverageWidget` derives band via the shared `band()` + `bandPresentation`, picks the
state from `confidence_level`, renders the %/qualifier/channel-line/sparkline/popover.

## Error handling / edge cases

- **No snapshots / query error:** hook returns `{ latest: null, series: [] }` (treat error as
  no-data); widget shows the instructional empty state — never a broken card.
- **`insufficient` confidence with a present composite:** treated as the empty/instructional state
  (we don't show a number the PRD calls untrustworthy).
- **`call_coverage` null** (channel inactive): channel summary omits the percentage; shouldn't
  occur alongside a written snapshot (SP1 only writes when `totalDials > 0`).
- **<2 snapshots:** sparkline omitted (no misleading single-point trend).
- **Band thresholds:** default set; org overrides deferred (see B).

## Testing

- `useCoverageSnapshots`: returns latest + chronological series from mocked Supabase rows; empty →
  `{latest:null, series:[]}`; query error → no-data shape (no throw to the widget).
- `bandPresentation` / `confidenceLabel`: pure, exhaustive — every band → token+label, every
  confidence level → qualifier (incl. `high` → null), boundaries.
- `CoverageWidget`: renders the **instructional empty** state (no data AND `insufficient`); the
  **thin-data** state (band %, pill, "Estimated · low confidence", channel line); the **solid**
  state (no qualifier); the sparkline shows with ≥2 snapshots and is omitted with <2; the
  "How is this calculated?" popover opens. (jsdom — assert content + wiring.)

## Out of scope (SP2b / later)

The credibility badge + red-band inline warning on **other** dashboard widgets; the full
thresholds-overlay trend chart (the reference-line treatment from PRD Surface 1); hierarchy /
aggregate views + `coverage_aggregate_snapshot` + its RPC; per-org threshold-override honoring;
calendar/email/location channels. No change to SP0's nudge or SP1's job.
