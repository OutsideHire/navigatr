# Pipeline Kanban view redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the desktop Kanban board to the Figma — 5 columns, company+value+probability-bar cards, "{count} · {$total}" headers, and "+ Add to {stage}" buttons — no drag-and-drop (deferred to sub-project 3).

**Architecture:** Rework `KanbanBoard.tsx` (5 columns, redesigned card via `STAGE_TONE`, add-button with optional `onAddToStage`); add an optional `defaultStage` to `AddDealSheet`; wire both in `PipelinePage`.

**Tech Stack:** React + TS, Tailwind (navigatr tokens), Vitest + Testing Library, `STAGE_TONE` (on main).

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-pipeline-kanban-redesign-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/pipeline-kanban/apps/app`.

---

### Task 1: `KanbanBoard` redesign (TDD)

**Files:**
- Modify: `apps/app/src/features/pipeline/components/KanbanBoard.tsx`
- Modify: `apps/app/src/features/pipeline/components/KanbanBoard.test.tsx`

- [ ] **Step 1: Replace the test file** `apps/app/src/features/pipeline/components/KanbanBoard.test.tsx` with:

```tsx
// Kanban grouping + redesigned card. 5 active columns (no Lost), each card shows
// company + value + a probability bar, and a "+ Add to {stage}" footer button.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "./KanbanBoard";
import type { Deal } from "../mockData";

function deal(id: string, stage: Deal["stage"], valueCents: number, company = `Co-${id}`): Deal {
  return {
    id, companyName: company, contactName: "X", phone: "+12025550100", email: "x@x.x",
    valueCents, stage, probability: 50, lastActivity: "2026-05-18T12:00:00Z", nextFollowup: null,
    address: null, employeeCountRange: "1-10", leadSource: "", updatedAt: "2026-05-18T12:00:00Z",
    owner_id: null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

function renderBoard(deals: Deal[], onAddToStage?: (s: Deal["stage"]) => void) {
  return render(<MemoryRouter><KanbanBoard deals={deals} onAddToStage={onAddToStage} /></MemoryRouter>);
}

describe("KanbanBoard", () => {
  it("renders the 5 active stage columns and NOT a Lost column", () => {
    renderBoard([deal("a", "new", 100_00)]);
    for (const label of ["New", "Contacted", "Qualified", "Proposal", "Won"]) {
      expect(screen.getByLabelText(`${label} stage`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Lost stage")).toBeNull();
  });

  it("buckets each deal into the correct stage column", () => {
    renderBoard([
      deal("a", "new", 100_00, "Acme"),
      deal("b", "qualified", 200_00, "Beta"),
      deal("c", "won", 300_00, "Gamma"),
    ]);
    expect(within(screen.getByLabelText("New stage")).getByText("Acme")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Qualified stage")).getByText("Beta")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Won stage")).getByText("Gamma")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Qualified stage")).queryByText("Acme")).toBeNull();
  });

  it("shows each column's count and total", () => {
    renderBoard([deal("a", "new", 5_00), deal("b", "new", 10_00)]);
    const newCol = screen.getByLabelText("New stage");
    expect(within(newCol).getByText(/\$15/)).toBeInTheDocument();
    expect(within(newCol).getByText(/^2 ·/)).toBeInTheDocument();
  });

  it("renders a probability bar on each card", () => {
    renderBoard([deal("a", "new", 100_00)]);
    const newCol = screen.getByLabelText("New stage");
    const bar = within(newCol).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders 'No deals' in an empty column", () => {
    renderBoard([deal("a", "new", 100_00)]);
    expect(within(screen.getByLabelText("Won stage")).getByText(/no deals/i)).toBeInTheDocument();
  });

  it("each deal card is a clickable button", () => {
    renderBoard([deal("a", "new", 100_00, "Acme")]);
    expect(within(screen.getByLabelText("New stage")).getByText("Acme").closest("button")).not.toBeNull();
  });

  it("'+ Add to {stage}' calls onAddToStage with that stage", () => {
    const onAdd = vi.fn();
    renderBoard([deal("a", "new", 100_00)], onAdd);
    fireEvent.click(within(screen.getByLabelText("Qualified stage")).getByRole("button", { name: /add to qualified/i }));
    expect(onAdd).toHaveBeenCalledWith("qualified");
  });

  it("omits the add button when onAddToStage is not provided", () => {
    renderBoard([deal("a", "new", 100_00)]);
    expect(screen.queryByRole("button", { name: /add to/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter app test KanbanBoard` → expect FAIL (no `onAddToStage`, no progressbar, Lost still present, header format).

- [ ] **Step 3: Replace `KanbanBoard.tsx`** with:

```tsx
/**
 * KanbanBoard — desktop-only stage-grouped pipeline view.
 *
 * Five columns (New → Won; Lost is off the active board). Each column header
 * shows the uppercase stage label + "{count} · {$total}", then compact cards
 * (company + value + a stage-colored probability bar), and a "+ Add to {stage}"
 * footer button (when onAddToStage is wired). Cards click through to
 * /pipeline/:id. Drag-and-drop is a later sub-project (it pairs with the
 * FR-PIPE-07 stage-update modal). Mobile never sees this — gated behind lg.
 */
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  STAGE_LABEL,
  STAGE_TONE,
  type Deal,
  type DealStage,
} from "../mockData";

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "won"];

function KanbanCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const pct = Math.max(0, Math.min(100, deal.probability));
  return (
    <button
      type="button"
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      className={cn(
        "flex w-full flex-col gap-2 rounded-radius-md bg-surface-default p-3 text-left ring-1 ring-border-subtle",
        "transition hover:ring-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      <span className="truncate text-body-strong text-text-default">{deal.companyName}</span>
      <span className="text-body-strong tabular-nums text-text-default">{formatMoney(deal.valueCents)}</span>
      <span
        className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Win probability"
      >
        <span className={cn("block h-full rounded-radius-full", STAGE_TONE[deal.stage].barFill)} style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

function Column({
  stage, deals, onAddToStage,
}: { stage: DealStage; deals: Deal[]; onAddToStage?: (s: DealStage) => void }) {
  const totalCents = deals.reduce((sum, d) => sum + d.valueCents, 0);
  return (
    <section
      aria-label={`${STAGE_LABEL[stage]} stage`}
      className="flex min-w-0 flex-col gap-3 rounded-radius-md bg-surface-sunken p-3"
    >
      <header className="flex flex-col gap-0.5 px-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-text-muted">
          {STAGE_LABEL[stage]}
        </span>
        <span className="text-caption tabular-nums text-text-muted">
          {deals.length} · {formatMoney(totalCents)}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {deals.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-text-subtle">No deals</p>
        ) : (
          deals.map((d) => <KanbanCard key={d.id} deal={d} />)
        )}
      </div>

      {onAddToStage && (
        <button
          type="button"
          onClick={() => onAddToStage(stage)}
          className="inline-flex items-center justify-center gap-1.5 rounded-radius-md px-2 py-2 text-caption font-medium text-brand-primary hover:bg-surface-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add to {STAGE_LABEL[stage]}
        </button>
      )}
    </section>
  );
}

export function KanbanBoard({
  deals, onAddToStage,
}: { deals: Deal[]; onAddToStage?: (stage: DealStage) => void }) {
  const byStage: Record<DealStage, Deal[]> = {
    new: [], contacted: [], qualified: [], proposal: [], won: [], lost: [],
  };
  for (const d of deals) byStage[d.stage]?.push(d);

  return (
    <div role="list" className="grid grid-cols-5 gap-3">
      {STAGES.map((s) => (
        <div key={s}>
          <Column stage={s} deals={byStage[s]} onAddToStage={onAddToStage} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run** `pnpm --filter app test KanbanBoard` → expect PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter app typecheck` → clean.
```bash
git add apps/app/src/features/pipeline/components/KanbanBoard.tsx apps/app/src/features/pipeline/components/KanbanBoard.test.tsx
git commit -m "feat(pipeline): Kanban to Figma — 5 columns, probability-bar cards, add-to-stage buttons"
```

---

### Task 2: `AddDealSheet` defaultStage + `PipelinePage` wiring

**Files:**
- Modify: `apps/app/src/features/pipeline/components/AddDealSheet.tsx`
- Modify: `apps/app/src/features/pipeline/pages/PipelinePage.tsx`

- [ ] **Step 1: Add `defaultStage` to `AddDealSheet`**

Read `AddDealSheet.tsx` first to see how it initializes/resets the react-hook-form. Then:
- Extend the props: `export interface AddDealSheetProps { open: boolean; onOpenChange: (open: boolean) => void; defaultStage?: DealStage; }` and destructure `defaultStage` in the component signature.
- Seed the form's `stage` from `defaultStage ?? "new"` — change the `defaultValues` `stage: "new" as DealStage` to `stage: (defaultStage ?? "new") as DealStage`.
- **Ensure it applies on open:** if the component resets the form when `open` becomes true (look for a `reset(...)` in an effect or a `key` remount), include `stage: defaultStage ?? "new"` in that reset payload so opening with a new `defaultStage` reflects it. If there is no open-reset, add `defaultStage` to the existing `useForm` `defaultValues` only (RHF reads defaultValues on mount; the sheet content typically remounts via the Dialog). Match the file's existing pattern — do not introduce a new reset mechanism.
- The probability auto-by-stage logic already keys off the `stage` field, so a preset stage yields the correct default probability with no extra work.

Import `DealStage` if not already imported in that file.

- [ ] **Step 2: Wire `PipelinePage`**

In `apps/app/src/features/pipeline/pages/PipelinePage.tsx`:
- Add state: `const [addStage, setAddStage] = React.useState<DealStage | undefined>(undefined);` (DealStage is already imported there).
- Pass to the board: `<KanbanBoard deals={filtered} onAddToStage={(s) => { setAddStage(s); setSheetOpen(true); }} />` (the desktop `lg:block` usage).
- Pass to the sheet: `<AddDealSheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setAddStage(undefined); }} defaultStage={addStage} />`.
- Leave the existing FAB / "Add deal" buttons as-is — they open with `addStage` undefined → stage "new".

- [ ] **Step 3: Typecheck + full suite**

Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: clean; all green (KanbanBoard + AddDealSheet + PipelinePage + the rest). If `AddDealSheet` has an existing test, ensure it still passes; if it has a test harness, add one asserting `defaultStage="qualified"` seeds the stage select to Qualified.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/pipeline/components/AddDealSheet.tsx apps/app/src/features/pipeline/pages/PipelinePage.tsx
git commit -m "feat(pipeline): '+ Add to {stage}' opens Add Deal preset to that stage"
```

---

## Notes for the implementer

- `STAGE_TONE` is exported from `mockData.ts` (already on main from sub-project 1).
- Keep `byStage` typed as `Record<DealStage, Deal[]>` (include the `lost: []` bucket) so a
  stray `lost` deal doesn't throw on `.push`; it simply won't render (only 5 columns map).
- Do NOT add drag-and-drop. Do NOT touch the List view or Deal Detail.
- Preserve the parent's `lg`-gating of the kanban view and the mobile list fallback.
- For `AddDealSheet`, read the file before editing and match its existing form-reset idiom;
  the only behavior change is the initial stage.
