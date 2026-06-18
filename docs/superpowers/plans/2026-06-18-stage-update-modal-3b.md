# FR-PIPE-07 stage-update modal + Kanban DnD — slice 3b plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** A `StageUpdateModal` (probability + optional outcome note) on every non-lost stage change, wired from the Deal Detail hero, the Quick-actions "Mark as lost", and Kanban drag-and-drop.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-stage-update-modal-3b-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/stage-modal/apps/app`. Tasks are ordered to keep typecheck/tests green per commit.

---

### Task 1: `appendStageNote` helper + `StageUpdateModal` (TDD)

**Files:** create `lib/stageNote.ts` (+ test), `components/StageUpdateModal.tsx` (+ test); modify `mockData.ts` to export `STAGE_DEFAULT_PROBABILITY`.

- [ ] **Step 1: Export the default-probability map.** In `apps/app/src/features/pipeline/mockData.ts`, the internal `const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number>` exists (~line 93) — add `export` to it.

- [ ] **Step 2: `lib/stageNote.ts` test** — create `apps/app/src/features/pipeline/lib/stageNote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appendStageNote } from "./stageNote";

describe("appendStageNote", () => {
  it("returns existing unchanged when the note is empty", () => {
    expect(appendStageNote("old", "new", "contacted", "", "Jun 18")).toBe("old");
    expect(appendStageNote("old", "new", "contacted", "   ", "Jun 18")).toBe("old");
  });
  it("prepends a prefixed line when a note is given", () => {
    expect(appendStageNote("old notes", "new", "contacted", "Left a vm", "Jun 18"))
      .toBe("[New→Contacted · Jun 18] Left a vm\n\nold notes");
  });
  it("handles null/undefined existing notes", () => {
    expect(appendStageNote(null, "qualified", "proposal", "Sent quote", "Jun 18"))
      .toBe("[Qualified→Proposal · Jun 18] Sent quote\n\n");
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter app test stageNote` → FAIL.

- [ ] **Step 4: Create `apps/app/src/features/pipeline/lib/stageNote.ts`:**

```ts
import { STAGE_LABEL, type DealStage } from "../mockData";

/** Prepend a stage-transition note line to a deal's freeform notes. Returns the
 *  existing notes unchanged when `note` is blank. Newest entry on top. */
export function appendStageNote(
  existing: string | null | undefined,
  from: DealStage,
  to: DealStage,
  note: string,
  dateLabel: string,
): string {
  const trimmed = note.trim();
  if (!trimmed) return existing ?? "";
  const line = `[${STAGE_LABEL[from]}→${STAGE_LABEL[to]} · ${dateLabel}] ${trimmed}`;
  return `${line}\n\n${existing ?? ""}`;
}
```

- [ ] **Step 5: Run** `pnpm --filter app test stageNote` → PASS.

- [ ] **Step 6: `StageUpdateModal` test** — create `apps/app/src/features/pipeline/components/StageUpdateModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageUpdateModal } from "./StageUpdateModal";
import { MOCK_DEALS, type Deal } from "../mockData";

function deal(over: Partial<Deal> = {}): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("StageUpdateModal", () => {
  it("renders the target stage title and its default probability", () => {
    render(<StageUpdateModal open deal={deal({ companyName: "Acme", stage: "new" })} toStage="contacted" onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/move acme to contacted/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/probability/i)).toHaveValue(40); // STAGE_DEFAULT_PROBABILITY.contacted
  });
  it("confirm passes the (possibly edited) probability + note", () => {
    const onConfirm = vi.fn();
    render(<StageUpdateModal open deal={deal({ stage: "new" })} toStage="qualified" onOpenChange={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/probability/i), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/note|what changed/i), { target: { value: "Demo booked" } });
    fireEvent.click(screen.getByRole("button", { name: /move to qualified/i }));
    expect(onConfirm).toHaveBeenCalledWith(70, "Demo booked");
  });
  it("renders nothing when deal or toStage is null", () => {
    const { container } = render(<StageUpdateModal open deal={null} toStage={null} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("disables confirm while busy", () => {
    render(<StageUpdateModal open busy deal={deal({ stage: "new" })} toStage="contacted" onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /move to contacted/i })).toBeDisabled();
  });
});
```

- [ ] **Step 7: Run** `pnpm --filter app test StageUpdateModal` → FAIL.

- [ ] **Step 8: Create `apps/app/src/features/pipeline/components/StageUpdateModal.tsx`:**

```tsx
/**
 * StageUpdateModal — FR-PIPE-07. Opens on every non-lost stage change (Deal
 * Detail hero or Kanban drag-drop). Shows the target stage's default probability
 * (editable) + an optional outcome note. Confirm hands (probability, note) up;
 * the caller persists stage + probability and appends the note to deal.notes.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button, Input, NotesFieldWithMic } from "@/components/navigatr";
import { STAGE_DEFAULT_PROBABILITY, STAGE_LABEL, type Deal, type DealStage } from "../mockData";

export interface StageUpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  toStage: DealStage | null;
  busy?: boolean;
  onConfirm: (probability: number, note: string) => void;
}

export function StageUpdateModal({ open, onOpenChange, deal, toStage, busy, onConfirm }: StageUpdateModalProps) {
  const [prob, setProb] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open && toStage) {
      setProb(String(STAGE_DEFAULT_PROBABILITY[toStage]));
      setNote("");
    }
  }, [open, toStage]);

  if (!deal || !toStage) return null;

  const clamped = Math.max(0, Math.min(100, parseInt(prob, 10) || 0));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              Move {deal.companyName} to {STAGE_LABEL[toStage]}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Probability (%)</span>
            <Input
              type="number" inputMode="numeric" min={0} max={100}
              aria-label="Probability"
              value={prob}
              onChange={(e) => setProb(e.target.value)}
            />
          </label>

          <NotesFieldWithMic value={note} onChange={setNote} placeholder="What changed? (optional)" aria-label="Outcome note" />

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={busy} loading={busy} onClick={() => onConfirm(clamped, note.trim())}>
              Move to {STAGE_LABEL[toStage]}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default StageUpdateModal;
```
Note: if `NotesFieldWithMic` doesn't forward `aria-label`, change the test's note query to match its actual label/placeholder (the placeholder "What changed?" is queryable via `getByPlaceholderText` — adjust the test selector accordingly rather than the component).

- [ ] **Step 9: Run** `pnpm --filter app test StageUpdateModal` → PASS. `pnpm --filter app typecheck` → clean.

- [ ] **Step 10: Commit:**
```bash
git add apps/app/src/features/pipeline/lib/stageNote.ts apps/app/src/features/pipeline/lib/stageNote.test.ts apps/app/src/features/pipeline/components/StageUpdateModal.tsx apps/app/src/features/pipeline/components/StageUpdateModal.test.tsx apps/app/src/features/pipeline/mockData.ts
git commit -m "feat(pipeline): StageUpdateModal + appendStageNote helper (FR-PIPE-07 core)"
```

---

### Task 2: Wire Deal Detail hero + Quick-actions "Mark as lost"

**Files:** modify `pages/DealDetailPage.tsx` (StagePicker + page-level lost flow + QuickActionsCard wiring).

READ `DealDetailPage.tsx` first. Then:

- [ ] **Step 1:** Import `StageUpdateModal` and `appendStageNote`; import `formatShortDate` (already imported) for the date label.

- [ ] **Step 2: StagePicker — open the modal for non-lost changes.** In `StagePicker.handleChange`, replace the direct non-lost `update.mutateAsync` branch with: `setPendingStage(next); setStageModalOpen(true); setEditing(false);`. Keep the `next === deal.stage` no-op and the `lost` → LostReasonModal branch. Add local state `pendingStage: DealStage | null`, `stageModalOpen: boolean`. Render `<StageUpdateModal open={stageModalOpen} onOpenChange={setStageModalOpen} deal={deal} toStage={pendingStage} busy={update.isPending} onConfirm={handleStageConfirm} />`. Implement:
```tsx
const handleStageConfirm = async (probability: number, note: string) => {
  if (!pendingStage) return;
  try {
    await update.mutateAsync({
      id: deal.id,
      patch: {
        stage: pendingStage,
        probability,
        notes: appendStageNote(deal.notes, deal.stage, pendingStage, note, formatShortDate(new Date().toISOString())),
      },
    });
    toast.success(`Moved to ${STAGE_LABEL[pendingStage]}`);
    setStageModalOpen(false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't update stage");
  }
};
```
(`deal.notes` may not be on the `Deal` type yet — if typecheck flags it, pass `(deal as { notes?: string }).notes` or add `notes?: string` to the Deal type in mockData. Check and do the minimal correct thing; the DB column exists.)

- [ ] **Step 3: Page-level "Mark as lost".** Lift a lost flow to the page so `QuickActionsCard` can trigger it: in `DealDetailPage`, add `const [lostOpen, setLostOpen] = React.useState(false)` + a `handleLostSubmit` that calls `useUpdateDeal().mutateAsync({ id: deal.id, patch: { stage: "lost", lostReasonCategory, lostReasonNotes } })` (mirror StagePicker's existing `handleLostSubmit`). Pass `onMarkLost={() => setLostOpen(true)}` to `<QuickActionsCard onMarkLost={...} />`. Render a page-level `<LostReasonModal open={lostOpen} onOpenChange={setLostOpen} onSubmit={handleLostSubmit} />`. (The hero StagePicker keeps its own lost modal for the inline picker path; that's acceptable — they don't conflict since only one opens at a time. If you prefer a single modal, lift StagePicker's lost handling up too, but that's optional.)

- [ ] **Step 4: Typecheck + full suite + commit.**
Run: `pnpm --filter app typecheck && pnpm --filter app test` → clean/green. Update/extend the DealDetail tests so selecting a non-lost stage opens the StageUpdateModal (and confirm triggers update) if the harness allows; keep regression green.
```bash
git add apps/app/src/features/pipeline/pages/DealDetailPage.tsx apps/app/src/features/pipeline/mockData.ts
git commit -m "feat(pipeline): hero stage change opens StageUpdateModal; Quick-actions Mark as lost wired"
```

---

### Task 3: Kanban drag-and-drop → StageUpdateModal

**Files:** modify `components/KanbanBoard.tsx`, `pages/PipelinePage.tsx`.

- [ ] **Step 1: KanbanBoard DnD.**
- `KanbanCard`: add `draggable`, `onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}`, and a `dragging:opacity` style is optional. It stays a clickable button.
- `Column`: add `onDragOver={(e) => e.preventDefault()}` and `onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) onDropDeal?.(id, stage); }}`. Add a `data-drop-target` highlight class while dragging if easy (optional).
- `KanbanBoard` + `Column` props: add `onDropDeal?: (dealId: string, stage: DealStage) => void`, thread through.

- [ ] **Step 2: PipelinePage wiring.** Add page-level `pendingDrop: { deal: Deal; toStage: DealStage } | null` state + `useUpdateDeal`. Pass to the desktop `<KanbanBoard … onDropDeal={(id, stage) => { const d = (deals ?? []).find(x => x.id === id); if (d && d.stage !== stage) setPendingDrop({ deal: d, toStage: stage }); }} />`. Render a page-level `<StageUpdateModal open={!!pendingDrop} onOpenChange={(o) => !o && setPendingDrop(null)} deal={pendingDrop?.deal ?? null} toStage={pendingDrop?.toStage ?? null} busy={update.isPending} onConfirm={handleDropConfirm} />` where `handleDropConfirm(prob, note)` calls `update.mutateAsync({ id: pendingDrop.deal.id, patch: { stage: pendingDrop.toStage, probability: prob, notes: appendStageNote(pendingDrop.deal.notes, pendingDrop.deal.stage, pendingDrop.toStage, note, formatShortDate(...)) } })` then `setPendingDrop(null)`; toast on success/error. Import `appendStageNote`, `formatShortDate`, `useUpdateDeal`, `StageUpdateModal`.

- [ ] **Step 3: KanbanBoard test** — add: a card has `draggable`; firing `dragStart` on a card then `drop` on a different column (with a `dataTransfer` stub) calls `onDropDeal(dealId, thatStage)`; drop on the same column does not call it. Use a `dataTransfer` mock: `{ setData: vi.fn(), getData: () => "a" }` passed via `fireEvent.drop(col, { dataTransfer })`.

- [ ] **Step 4: Typecheck + full suite + commit.**
```bash
git add apps/app/src/features/pipeline/components/KanbanBoard.tsx apps/app/src/features/pipeline/components/KanbanBoard.test.tsx apps/app/src/features/pipeline/pages/PipelinePage.tsx
git commit -m "feat(pipeline): Kanban drag-and-drop opens StageUpdateModal on drop"
```

---

## Notes for the implementer

- No new npm dependency — use native HTML5 DnD.
- The outcome note is OPTIONAL; `appendStageNote` no-ops on blank.
- `deal.notes`: the DB has the column; if the frontend `Deal` type lacks `notes`, add `notes?: string` to it in `mockData.ts` and surface it in `useDeals` SELECT only if needed for display — for writing, `useUpdateDeal` already accepts `notes`.
- Lost transitions never use StageUpdateModal — they use LostReasonModal.
- Keep all existing behavior green (StagePicker lost path, regression tests, Kanban 8 tests).
