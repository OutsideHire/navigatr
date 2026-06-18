# Pipeline Kanban view redesign (2026-06-18)

Sub-project 2 of 3 in the Pipeline redesign. Figma: `navigatr v1`, Kanban desktop frame
`326:6` (parent `324:2`). Sub-project 1 (List view) shipped; sub-project 3 (Deal Detail +
FR-PIPE-07/08/09) is next.

## Problem

The desktop `KanbanBoard` diverges from the new Figma: it shows 6 columns (incl. Lost),
band+contact cards, and no per-column add action. This brings it to fidelity. **Drag-and-drop
is explicitly out of scope here** — it lands in sub-project 3 paired with the FR-PIPE-07
stage-update modal (a drag-drop stage change must trigger that modal per the PRD). This
sub-project is a visual/structural redesign only.

## Decisions (locked in brainstorming)

- **5 columns:** New, Contacted, Qualified, Proposal, Won. Drop the Lost column (Figma omits
  it; `STAGE_CHIP_COUNTS.lost` is 0 — Lost is not part of the active board).
- **Card:** company name (bold) + value (bold) + a **stage-colored probability bar** (bare
  bar, no label/percent text — matches Figma). No left band, no contact/last-activity line.
  Whole card stays clickable → `/pipeline/:id`.
- **Column header:** uppercase `STAGE_LABEL` + `{count} · {$total}` (e.g. "NEW · 12 · $58K").
- **"+ Add to {stage}"** button at each column's footer → opens the Add Deal sheet with that
  stage preselected.
- **No drag-and-drop** in this sub-project.

## Architecture

### A. `KanbanBoard.tsx` (rework)
- `STAGES` becomes the 5 active stages (no `lost`); remove the `opacity-75` lost wrapper and
  the 6-col grid → `grid-cols-5`.
- `KanbanCard`: render company + value + a bare probability bar. The bar is a
  `bg-surface-sunken` track with a `STAGE_TONE[deal.stage].barFill` fill at
  `width: {clamp(probability)}%`, `role="progressbar"` + aria values. Remove the contact +
  last-activity line and the left band. Keep it a clickable `button` → navigate.
- `Column` footer: a full-width ghost **"+ Add to {STAGE_LABEL[stage]}"** button that calls a
  new optional prop `onAddToStage?.(stage)`. When the prop is absent the button is omitted
  (keeps the component self-contained / testable without wiring).
- New prop on `KanbanBoard`: `onAddToStage?: (stage: DealStage) => void`, threaded to each
  `Column`.
- Reuse `STAGE_TONE` (now on main) for the bar fill; drop the local `STAGE_DOT_CLASS` if the
  header dot is removed (Figma header has no dot — uppercase label only). Keep the header
  clean: label + counts, no dot.

### B. `AddDealSheet.tsx` (small additive change)
- Add optional prop `defaultStage?: DealStage`. Use it to seed the form's initial
  `stage` (replace the hardcoded `stage: "new"` default with `defaultStage ?? "new"`).
  Everything else unchanged. The probability auto-by-stage logic already keys off the stage
  field, so a preset stage yields the right default probability.

### C. `PipelinePage.tsx` (wiring)
- Add `const [addStage, setAddStage] = React.useState<DealStage | undefined>(undefined);`
- Pass `onAddToStage={(s) => { setAddStage(s); setSheetOpen(true); }}` to `<KanbanBoard>`.
- Pass `defaultStage={addStage}` to `<AddDealSheet>`.
- The existing FAB / "Add deal" buttons open the sheet with `addStage` undefined → stage
  defaults to "new" (unchanged behavior). Reset `addStage` to undefined when the sheet
  closes so a later plain "Add deal" doesn't inherit a stale stage.

## Data flow

`useDeals` → `PipelinePage` filters → `KanbanBoard` buckets by stage into 5 columns →
`KanbanCard` renders. "+ Add to {stage}" → `onAddToStage(stage)` → opens `AddDealSheet` with
`defaultStage`. No schema/query/mutation change (deal creation already exists via
`useCreateDeal` inside `AddDealSheet`).

## Error handling / edge cases

- **A deal with stage `lost`** (rare; not produced by the active flow) simply isn't bucketed
  into any of the 5 columns — it won't render on the board. Acceptable (matches Figma; Lost
  is off the active board). The List view still shows it.
- **probability 0/100:** bar empty/full; aria reflects it.
- **Empty column:** keep the existing "No deals" placeholder above the add button.
- **Sheet close:** reset `addStage` so the next plain Add opens at "new".

## Testing

**Update `KanbanBoard.test.tsx`:**
- Renders exactly the 5 active stage columns (New/Contacted/Qualified/Proposal/Won); no Lost
  column.
- Buckets deals into the right column; card shows company + value; a `progressbar` is present
  with the deal's `aria-valuenow`.
- "No deals" placeholder still renders in an empty column.
- Card is a clickable button (drill-in) — keep the existing assertion.
- With an `onAddToStage` spy, clicking a column's "+ Add to {stage}" calls it with that
  stage; with no prop, the add button is absent.

**`AddDealSheet`:** add/adjust a test that passing `defaultStage="qualified"` seeds the stage
field to Qualified (and its default probability), if the sheet has a test harness; otherwise
cover via the PipelinePage integration.

**`PipelinePage.test.tsx`:** (kanban is desktop-only/`lg`) — assert that the board path
renders; a focused test that `onAddToStage` opens the sheet may be deferred if the jsdom
width gating makes it brittle — prefer testing the `KanbanBoard` callback in isolation.

## Out of scope

Drag-and-drop (sub-project 3 with FR-PIPE-07); the Lost column; Deal Detail; any
schema/mutation change; mobile (kanban is desktop-only, mobile uses the list view).
