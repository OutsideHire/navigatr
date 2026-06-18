# FR-PIPE-08 qualification read/edit — slice 3c plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Read `deals.profession_data` back into the frontend and render/edit Merchant Services qualification on the Deal Detail Qualification tab.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-qualification-3c-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/qualification/apps/app`.

---

### Task 1: Data layer + `readMerchantQualification` (TDD)

**Files:** modify `mockData.ts`, `hooks/useDeals.ts`, `hooks/useUpdateDeal.ts` (+ its test); create `lib/merchantQualification.ts` (+ test).

- [ ] **Step 1: `Deal` type + read path.**
  - In `apps/app/src/features/pipeline/mockData.ts`: add `professionData?: Record<string, unknown> | null;` to the `Deal` interface (near the end, after `notes`). If there is a `DealRow`/row type used by `toDeal`, add `profession_data?: Record<string, unknown> | null` to it; in `toDeal`, map `professionData: row.profession_data ?? null`. (If `toDeal` lives in `useDeals.ts`, do it there.)
  - In `apps/app/src/features/pipeline/hooks/useDeals.ts`: add `profession_data` to the `.select("...")` column string (append `+ ", profession_data"` or include it in the list). Ensure the row→Deal mapper carries it (per above).

- [ ] **Step 2: `useUpdateDeal` — accept `professionData`.**
  In `apps/app/src/features/pipeline/hooks/useUpdateDeal.ts`: add `professionData?: Record<string, unknown>;` to the `patch` type, and in `toSnakeCase` add `if (patch.professionData !== undefined) out.profession_data = patch.professionData;`.

- [ ] **Step 3: extend `useUpdateDeal` test** (`useUpdateDeal.test.tsx`): add a case asserting a patch with `professionData: { profession: "merchant_services", annualVolume: 500000 }` results in the supabase update payload containing `profession_data` with that object. Match the file's existing mock-assertion style.

- [ ] **Step 4: `lib/merchantQualification.ts` test** — create `apps/app/src/features/pipeline/lib/merchantQualification.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readMerchantQualification } from "./merchantQualification";

describe("readMerchantQualification", () => {
  it("parses a merchant_services profession_data blob", () => {
    const q = readMerchantQualification({
      profession: "merchant_services", annualVolume: 500000, acceptanceMethods: ["card_present", "ecommerce"],
      currentProcessor: "Square", currentEffectiveRate: 2.6, posTerminal: "Clover", avgTicketSize: 45,
    });
    expect(q).not.toBeNull();
    expect(q!.annualVolume).toBe(500000);
    expect(q!.acceptanceMethods).toEqual(["card_present", "ecommerce"]);
    expect(q!.currentProcessor).toBe("Square");
    expect(q!.currentEffectiveRate).toBe(2.6);
  });
  it("returns null for non-merchant or missing profession", () => {
    expect(readMerchantQualification({ profession: "payroll" })).toBeNull();
    expect(readMerchantQualification(null)).toBeNull();
    expect(readMerchantQualification(undefined)).toBeNull();
  });
  it("tolerates partial/garbage fields", () => {
    const q = readMerchantQualification({ profession: "merchant_services", annualVolume: "oops", acceptanceMethods: "nope" });
    expect(q).not.toBeNull();
    expect(q!.annualVolume).toBeUndefined();
    expect(q!.acceptanceMethods).toEqual([]);
  });
});
```

- [ ] **Step 5: Run** `pnpm --filter app test merchantQualification` → FAIL.

- [ ] **Step 6: Create `apps/app/src/features/pipeline/lib/merchantQualification.ts`:**
```ts
/** Merchant Services qualification (FR-PIPE-08), parsed defensively out of the
 *  deals.profession_data JSONB. Returns null unless profession === "merchant_services". */
export const ACCEPTANCE_METHOD_LABELS: Record<string, string> = {
  card_present: "Card present",
  card_not_present: "Card not present",
  ecommerce: "E-commerce",
  mobile: "Mobile",
  in_app: "In-app",
};

export interface MerchantQualification {
  annualVolume?: number;
  acceptanceMethods: string[];
  currentProcessor?: string;
  currentEffectiveRate?: number;
  posTerminal?: string;
  avgTicketSize?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function readMerchantQualification(
  data: Record<string, unknown> | null | undefined,
): MerchantQualification | null {
  if (!data || data.profession !== "merchant_services") return null;
  return {
    annualVolume: num(data.annualVolume),
    acceptanceMethods: Array.isArray(data.acceptanceMethods)
      ? (data.acceptanceMethods.filter((m) => typeof m === "string") as string[])
      : [],
    currentProcessor: str(data.currentProcessor),
    currentEffectiveRate: num(data.currentEffectiveRate),
    posTerminal: str(data.posTerminal),
    avgTicketSize: num(data.avgTicketSize),
  };
}
```

- [ ] **Step 7: Run** `pnpm --filter app test merchantQualification` → PASS. Then `pnpm --filter app typecheck && pnpm --filter app test` → clean/green.

- [ ] **Step 8: Commit:**
```bash
git add apps/app/src/features/pipeline/mockData.ts apps/app/src/features/pipeline/hooks/useDeals.ts apps/app/src/features/pipeline/hooks/useUpdateDeal.ts apps/app/src/features/pipeline/hooks/useUpdateDeal.test.tsx apps/app/src/features/pipeline/lib/merchantQualification.ts apps/app/src/features/pipeline/lib/merchantQualification.test.ts
git commit -m "feat(pipeline): read/write deals.profession_data + readMerchantQualification (FR-PIPE-08 data)"
```

---

### Task 2: `QualificationTab` read view

**Files:** create `components/QualificationTab.tsx` (+ test); modify `pages/DealDetailPage.tsx` to use it.

- [ ] **Step 1: test** — create `apps/app/src/features/pipeline/components/QualificationTab.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualificationTab } from "./QualificationTab";
import { MOCK_DEALS, type Deal } from "../mockData";

function deal(over: Partial<Deal> = {}): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("QualificationTab", () => {
  it("renders merchant fields when profession_data is present", () => {
    render(<QualificationTab onEdit={vi.fn()} deal={deal({ professionData: {
      profession: "merchant_services", annualVolume: 500000, acceptanceMethods: ["card_present"],
      currentProcessor: "Square", currentEffectiveRate: 2.6, posTerminal: "Clover", avgTicketSize: 45,
    } })} />);
    expect(screen.getByText(/current processor/i)).toBeInTheDocument();
    expect(screen.getByText("Square")).toBeInTheDocument();
    expect(screen.getByText(/card present/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit qualification/i })).toBeInTheDocument();
  });
  it("renders an empty state when there is no qualification", () => {
    render(<QualificationTab onEdit={vi.fn()} deal={deal({ professionData: null })} />);
    expect(screen.getByText(/no qualification captured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit qualification/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: implement `QualificationTab.tsx`:**
A `Card` (from `@/components/navigatr`). Compute `const q = readMerchantQualification(deal.professionData)`. If `q`, render labelled rows: "Annual volume" (`$` + `toLocaleString`, or "—"), "Acceptance methods" (chips via `ACCEPTANCE_METHOD_LABELS`, or "—"), "Current processor", "Current effective rate" (`%`), "POS / terminal", "Avg ticket size" (`$`). Each value falls back to "—". If `!q`, render an empty-state line "No qualification captured yet." Always render an "Edit qualification" `Button` (`onClick={onEdit}`). Props `{ deal: Deal; onEdit: () => void }`. Import `readMerchantQualification`, `ACCEPTANCE_METHOD_LABELS`.

- [ ] **Step 4: wire into `DealDetailPage.tsx`.** READ the file. Replace the inline `QualificationTab` (the JSON-dump version, ~line 480-528) AND its usage `<QualificationTab deal={deal} />` with the imported component, passing `onEdit={() => setQualOpen(true)}`. Add page state `const [qualOpen, setQualOpen] = React.useState(false)` and render `<QualificationEditSheet open={qualOpen} onOpenChange={setQualOpen} deal={deal} />` near the other sheets. (QualificationEditSheet is built in Task 3 — for THIS task, import it only after Task 3 exists; to keep Task 2 self-contained and green, you MAY stub the sheet import by deferring the `<QualificationEditSheet>` render + `qualOpen` wiring to Task 3. Acceptable: in Task 2, just wire `onEdit` to a no-op `() => {}` or a `toast`, and Task 3 swaps in the real sheet.) Remove the now-unused inline JSON QualificationTab + any now-unused imports.

- [ ] **Step 5:** `pnpm --filter app typecheck && pnpm --filter app test` → green. Commit:
```bash
git add apps/app/src/features/pipeline/components/QualificationTab.tsx apps/app/src/features/pipeline/components/QualificationTab.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "feat(pipeline): real Qualification tab read view (FR-PIPE-08)"
```

---

### Task 3: `QualificationEditSheet`

**Files:** create `components/QualificationEditSheet.tsx` (+ test); wire into `DealDetailPage.tsx`.

- [ ] **Step 1: implement `QualificationEditSheet.tsx`** — Radix dialog (mirror `StageUpdateModal`/`AddDealSheet` shell). Props `{ open; onOpenChange; deal: Deal }`. On open, seed six controlled fields from `readMerchantQualification(deal.professionData)` (numbers → string inputs; acceptanceMethods → checkbox set). Fields: Annual volume (`$`, number), Acceptance methods (checkboxes over `ACCEPTANCE_METHOD_LABELS` keys), Current processor (text), Current effective rate (`%`, number), POS/terminal (text), Avg ticket size (`$`, number). Footer Cancel + Save. Save → `useUpdateDeal().mutateAsync({ id: deal.id, patch: { professionData: { profession: "merchant_services", annualVolume, acceptanceMethods, currentProcessor, currentEffectiveRate, posTerminal, avgTicketSize } } })` (omit undefined numbers), toast success, close; disable Save while `isPending`; toast.error + keep open on failure.

- [ ] **Step 2: test** `QualificationEditSheet.test.tsx` — mock `../hooks/useUpdateDeal` with a `mutateAsync` spy; render open with a deal having existing merchant data; assert a field seeds (e.g. processor input value); change processor + click Save; assert `mutateAsync` called with `expect.objectContaining({ id, patch: expect.objectContaining({ professionData: expect.objectContaining({ profession: "merchant_services", currentProcessor: <new> }) }) })`. (Wrap in any providers the other sheet tests use.)

- [ ] **Step 3: wire into `DealDetailPage.tsx`** — import `QualificationEditSheet`, render `<QualificationEditSheet open={qualOpen} onOpenChange={setQualOpen} deal={deal} />`, and point the Qualification tab's `onEdit` at `() => setQualOpen(true)` (replacing the Task-2 placeholder).

- [ ] **Step 4:** `pnpm --filter app typecheck && pnpm --filter app test` → green. Commit:
```bash
git add apps/app/src/features/pipeline/components/QualificationEditSheet.tsx apps/app/src/features/pipeline/components/QualificationEditSheet.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "feat(pipeline): edit Merchant Services qualification (FR-PIPE-08)"
```

---

## Notes for the implementer

- No DB migration — `profession_data` exists. SELECT addition + update mapping only.
- Only the merchant branch is built; non-merchant profession_data shows the empty state.
- Keep all existing tests green (the old inline JSON QualificationTab test, if any, gets
  replaced by the new component test).
- Reuse `useUpdateDeal` for persistence (now accepting `professionData`).
