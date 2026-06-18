# Pipeline advanced Filter + Sort (2026-06-18)

Makes the Pipeline list's Filter and Sort controls real (they're Sprint-2 toast stubs today).
All client-side over the already-loaded deals — no query/schema change. The stage-chip filter
and search already work and are unchanged.

## Decisions (locked in brainstorming)

- **Filters:** Min value, Min probability, Follow-up status. (No industry → no query change.)
- **Sort:** Last activity (default), Value (high→low), Probability (high→low), Next follow-up
  (soonest, no-follow-up last).
- **State is in-memory** (resets on reload) — consistent with the existing stage-chip + search
  filters.
- **Desktop/tablet only** — Filter & Sort live in the existing `sm:flex` action row; mobile
  keeps the stage chips + search.
- Both the list and the Kanban board consume the same `filtered` array, so filters narrow and
  sort orders the list AND within each Kanban column automatically.

## Architecture

### A. `lib/sortDeals.ts` (pure, tested)
```ts
export type DealSortKey = "last_activity" | "value" | "probability" | "followup";
export const DEAL_SORT_LABEL: Record<DealSortKey, string>; // for the Select + button label
export function sortDeals(deals: Deal[], key: DealSortKey): Deal[]; // returns a new array
```
- `last_activity`: `lastActivity` (ISO) descending — most recent first.
- `value`: `valueCents` descending.
- `probability`: `probability` descending.
- `followup`: `nextFollowup` ascending (soonest first); deals with `nextFollowup === null` sort
  **last**. Stable for ties.

### B. `lib/filterDeals.ts` (pure, tested)
```ts
export interface DealFilters {
  minValueCents: number | null;
  minProbability: number | null;   // 0..100
  followUp: "any" | "has" | "none";
}
export const EMPTY_DEAL_FILTERS: DealFilters; // { minValueCents: null, minProbability: null, followUp: "any" }
export function applyDealFilters(deals: Deal[], f: DealFilters): Deal[];
export function activeFilterCount(f: DealFilters): number; // non-default criteria, for the badge
```
- `minValueCents`: keep `valueCents >= minValueCents` when set.
- `minProbability`: keep `probability >= minProbability` when set.
- `followUp`: `"has"` → `nextFollowup != null`; `"none"` → `nextFollowup == null`; `"any"` → all.
- `activeFilterCount`: counts `minValueCents != null` + `minProbability != null` +
  `followUp !== "any"`.

### C. `components/PipelineFilterPopover.tsx`
A Radix **Popover** (`@radix-ui/react-popover`, added as a dep) anchored to the existing
"Filter" button. Props `{ filters: DealFilters; onChange: (f: DealFilters) => void }`. Panel:
- **Min value** — a numeric `Input` (prefix "$", in thousands or dollars; store as cents). Blank
  → null.
- **Min probability** — navigatr `Select`: Any / 25%+ / 50%+ / 75%+ (Any → null).
- **Follow-up** — navigatr `Select` (or segmented): Any / Has follow-up / None.
- **Clear** — a text button resetting to `EMPTY_DEAL_FILTERS` (disabled when already empty).
The trigger is the existing **Filter** button; render a small **count badge** (from
`activeFilterCount`) on it when > 0.

### D. `components/PipelineSortMenu.tsx` (or inline)
The existing navigatr `Select` with the four `DealSortKey` options; the button/label reads
`Sort: {DEAL_SORT_LABEL[key]}`. Replaces the stub button.

### E. `PipelinePage.tsx` wiring
- Add state: `const [filters, setFilters] = React.useState(EMPTY_DEAL_FILTERS)` and
  `const [sortKey, setSortKey] = React.useState<DealSortKey>("last_activity")`.
- Extend the existing `filtered` memo: after the current stage + search + owner filtering, run
  `applyDealFilters(..., filters)` then `sortDeals(..., sortKey)`. Add `filters` + `sortKey` to
  the memo deps. The result still flows to both the list and `<KanbanBoard deals={filtered}>`.
- Replace the two stub buttons in `PageHeader` with `<PipelineFilterPopover>` (Filter, with
  badge) and the sort `Select`. Thread `filters/onChange` + `sortKey/onChange` from the page
  into `PageHeader`.

## Data flow

`useDeals` (unchanged) → existing stage/search/owner filter → `applyDealFilters(filters)` →
`sortDeals(sortKey)` → `filtered` → list rows + Kanban columns. KPI strip + subhead still
compute from the broader `deals`/owner set (unchanged) — the advanced filters scope the visible
cards, not the KPI headline (matches how the stage chip works today).

## Error handling / edge cases

- **All filters default:** `applyDealFilters` returns the input set; badge hidden.
- **No deals match:** the existing `EmptyState` renders (it already keys off `filtered.length`).
- **Blank/garbage min-value input:** parse → null (treated as no filter); clamp negatives to 0.
- **`nextFollowup` null in the followup sort:** sorted last (not first).
- **Kanban view:** advanced filters still apply (value/prob/followup are stage-independent);
  sort orders cards within each column. The stage-chip filter stays hidden in Kanban as today.

## Testing

- `sortDeals`: each key orders correctly; `followup` puts nulls last; returns a new array
  (input not mutated); stable on ties.
- `filterDeals`: each criterion in isolation + combined; `"has"`/`"none"`/`"any"`;
  `activeFilterCount` for empty vs each active criterion; `EMPTY_DEAL_FILTERS` is a no-op.
- `PipelineFilterPopover`: opens; changing a control calls `onChange` with the right shape;
  Clear resets; badge reflects `activeFilterCount` (assert via the trigger/count).
- `PipelinePage`: a filter (e.g. min probability) reduces the rendered cards; a sort reorders
  them; existing stage-chip/search/empty/owner/view-toggle tests stay green.

## Out of scope

Persisting filter/sort (URL/localStorage); a mobile Filter/Sort entry (desktop/tablet only);
industry / lead-source filters (industry needs a query change; lead source is uniform in the
data); server-side filtering; multi-select stage in the advanced panel (stage chips cover it).
