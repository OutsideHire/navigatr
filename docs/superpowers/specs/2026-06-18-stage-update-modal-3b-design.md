# FR-PIPE-07 stage-update modal + Kanban DnD — slice 3b (2026-06-18)

Slice 3b of sub-project 3. Implements FR-PIPE-07 ("stage updates must use a visual modal
that displays probability and prompts for an outcome note") and wires Kanban drag-and-drop +
the Deal Detail "Mark as lost" quick action to it. Sub-project-1/2 + slice 3a shipped.

## Decisions (locked in brainstorming)

- **Modal on every stage change** (non-lost). Changing stage from the Deal Detail hero, or by
  dropping a Kanban card into another column, opens a `StageUpdateModal` showing the target
  stage's default probability (editable) + an optional outcome note. Confirm persists
  stage + probability + (when a note is given) the note.
- **Lost keeps its own flow.** A change to `lost` still routes through the existing
  `LostReasonModal` (captures the lost reason). The Deal Detail "Mark as lost" quick action
  triggers that flow.
- **Outcome-note storage (no migration):** when a note is entered, append it to the deal's
  `notes` field as a prefixed line `"[{From}→{To} · {date}] {note}"` (newest on top), via
  `useUpdateDeal`'s existing `notes` field. `deal_stage_history` has no note column and we are
  not migrating it in this slice; the trigger still records the transition itself.
- **Kanban DnD:** native HTML5 drag-and-drop (no new dependency). Desktop-only (kanban is
  already `lg`-gated; HTML5 DnD's mobile/a11y gaps are acceptable because the accessible path
  — the hero stage picker — remains). Dropping a card on a different column opens the
  `StageUpdateModal` for that deal + target stage; dropping on its own column is a no-op.

## Architecture

### A. New `components/StageUpdateModal.tsx`
Radix Dialog. Props:
`{ open; onOpenChange; deal: Deal | null; toStage: DealStage | null; busy?: boolean;
   onConfirm: (probability: number, note: string) => void }`.
- Title: "Move {deal.companyName} to {STAGE_LABEL[toStage]}".
- Probability: a number input (0–100) defaulting to `STAGE_DEFAULT_PROBABILITY[toStage]`
  (export this map from `mockData` if not already exported — it exists internally).
- Outcome note: `NotesFieldWithMic` (optional), placeholder "What changed? (optional)".
- Footer: Cancel + "Move to {STAGE_LABEL[toStage]}" (primary, disabled while `busy`).
- On confirm → `onConfirm(probability, note.trim())`. Resets its local state on open.
- Renders nothing when `deal`/`toStage` is null.

### B. Note-append helper (shared, pure, tested)
Add to `mockData.ts` (or a small `lib/stageNote.ts`):
```ts
export function appendStageNote(existing: string | null | undefined, from: DealStage, to: DealStage, note: string, dateLabel: string): string
```
Returns `existing` unchanged when `note` is empty; otherwise prepends
`"[{From}→{To} · {dateLabel}] {note}\n\n" + (existing ?? "")`. Uses `STAGE_LABEL`.

### C. Deal Detail hero `StagePicker` (modify)
- Replace the direct-mutate path for non-lost transitions with: set `pendingStage` +
  open `StageUpdateModal`. Keep the lost path → `LostReasonModal` unchanged.
- On `StageUpdateModal` confirm: `useUpdateDeal.mutateAsync({ id, patch: { stage: pendingStage,
  probability, notes: appendStageNote(deal.notes, deal.stage, pendingStage, note, today) } })`,
  toast "Moved to {label}", close.
- Lift the lost flow so the page-level **Quick actions "Mark as lost"** can trigger it: expose
  an imperative entry (e.g. the page owns `lostModalOpen` + `handleLostSubmit`, passes a
  `onMarkLost` to `QuickActionsCard`, and renders `LostReasonModal` at page level). The hero
  picker's own lost handling can either reuse the page-level modal (preferred — single
  `LostReasonModal`) or keep its own; choose the single-source page-level approach to avoid
  two modals. Net: `QuickActionsCard` gets `onMarkLost`; "Mark as lost" becomes enabled.

### D. Kanban DnD (modify `KanbanBoard.tsx` + `PipelinePage.tsx`)
- `KanbanCard`: add `draggable`, `onDragStart` (set `dataTransfer` deal id), and a subtle
  dragging style. Keep it a clickable button for the non-drag path.
- `Column`: `onDragOver` (preventDefault to allow drop) + `onDrop` → call new prop
  `onDropDeal?(dealId, stage)`; add a drop-target highlight while dragging over.
- `KanbanBoard`: thread `onDropDeal?: (dealId: string, stage: DealStage) => void`.
- `PipelinePage`: pass `onDropDeal` that finds the deal, ignores same-stage drops, and opens a
  page-level `StageUpdateModal` (reuse the same component) for that deal + stage; confirm →
  `useUpdateDeal` with probability + appended note. (Dropping onto Won/any column → modal;
  there is no Lost column on the board, so the lost flow isn't reachable via DnD.)

## Data flow

Stage change (hero or DnD, non-lost) → StageUpdateModal → `useUpdateDeal({stage, probability,
notes})` → invalidates deals + stage history (existing). Lost → LostReasonModal → existing
lost patch. The `deal_stage_history` trigger records every transition server-side regardless.

## Error handling / edge cases

- **Same stage:** no modal, no-op.
- **Empty note:** allowed; `appendStageNote` returns notes unchanged.
- **probability out of range:** clamp 0–100 in the modal before confirm.
- **Mutation error:** toast; keep the modal open so the rep can retry (don't lose the note).
- **DnD drop outside a column / same column:** no-op.
- **Double-submit:** disable confirm while `busy` (mutation `isPending`).

## Testing

- `appendStageNote`: empty note → unchanged; non-empty → prefixed line prepended; null existing.
- `StageUpdateModal`: renders title + default probability for the target stage; Cancel closes
  without confirm; editing probability + note then confirm calls `onConfirm(prob, note)`;
  confirm disabled while `busy`.
- `StagePicker` (Deal Detail): selecting a non-lost stage opens StageUpdateModal (not an
  instant mutation); confirm calls `useUpdateDeal` with stage+probability; selecting lost still
  opens LostReasonModal.
- `QuickActionsCard`: "Mark as lost" enabled + fires `onMarkLost` (already covered) — assert it
  opens the lost modal at the page level (page test, or rely on the unit handler test).
- `KanbanBoard`: a card is `draggable`; firing `dragStart` then `drop` on a different column
  calls `onDropDeal(dealId, stage)`; drop on same column does not.

## Out of scope

FR-PIPE-08 qualification (3c); FR-PIPE-09 referral + migration (3d); a `deal_stage_history`
note-column migration (using notes-append instead); DnD on mobile / full keyboard DnD a11y
(hero picker is the accessible path); reordering within a column.
