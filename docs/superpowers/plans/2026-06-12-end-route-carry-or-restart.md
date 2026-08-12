# End Route — Carry to Tomorrow or Start Over — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add an "End route" action in running mode that, when stops are still pending, prompts the rep to **carry the remaining stops to tomorrow** or **clear & start over**.

**Architecture:** A forward-dated `carryToTomorrow` mutation (mirrors `continuePreviousPath`), an `addDaysISO` date helper, a small `EndRouteSheet` confirm dialog, and an "End route" button wired into `RunningPath`. No `PathPage` changes (RunningPath uses `useTodayPath` + `usePathMutations` directly; existing `onExit` lands on entry).

**Tech Stack:** React + TS, Radix Dialog, TanStack Query + supabase-js, Vitest + Testing Library, navigatr `Button`.

---

## Conventions

- **Branch:** `feat/end-route-prompt` off `main` (worktree or in-place — no parallel agents).
- Tests: `pnpm --filter app test <path>` from repo root. Gate: `cd apps/app && pnpm typecheck && pnpm test`. "kaboom from Bomb" stderr is an expected fixture.
- Commit trailer: blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Git from repo root, one Bash call.
- Spec: `docs/superpowers/specs/2026-06-12-end-route-carry-or-restart-design.md`.

## Verified building blocks (current `main`)

- `lib/today.ts`: `todayISO()` + `formatPathDate()` (parse at `${iso}T00:00:00`). Pure leaf module.
- `usePathMutations`: imports `todayISO` from `../lib/today` + `PREVIOUS_UNFINISHED_QUERY_KEY`; has `invalidate()` (refreshes paths/active/previous keys); `continuePreviousPath` (the mirror — upsert today, fetch pending by `path_id`+`status=pending` ordered by position, bulk `update({path_id}).in("id", pendingIds)`, mark old `completed`). Returns its mutations object.
- `useTodayPath()` returns `{ pathId, isLoading, stops, add, addMany, remove, setStatus, logVisit, markDealCreated, clear, has, isComplete, pendingCount }` — `pendingCount` is a **function** `() => number`; `pathId: string | null`.
- `RunningPath` (`components/RunningPath.tsx`): props `{ origin, onPause, onViewPipeline, onExit }`; `const { stops, setStatus, clear } = useTodayPath();`; status bar `<div class="flex items-center justify-between …"> … <Button leadingIcon={Pause} onClick={onPause}>Pause</Button></div>`; `allDone` branch renders `PathSummary`; renders `<DropInSheet … />` near the end. Uses `toast` from sonner.
- `DropInSheet` shell pattern: `import * as Dialog from "@radix-ui/react-dialog"`; bottom-sheet `Dialog.Content` classes; `Dialog.Title`, `Dialog.Close`.
- navigatr `Button` variants used in path: `primary`, `secondary`, `tertiary` (no `danger` variant — use `tertiary` + a `window.confirm` for the destructive clear).

## File structure

- **Modify** `apps/app/src/features/path/lib/today.ts` (+test) — add `addDaysISO`.
- **Modify** `apps/app/src/features/path/hooks/usePathMutations.ts` (+test) — add `carryToTomorrow`.
- **Create** `apps/app/src/features/path/components/EndRouteSheet.tsx` (+test) — the confirm dialog.
- **Modify** `apps/app/src/features/path/components/RunningPath.tsx` (+test) — End route button + sheet + handlers.

---

## Task 1: `addDaysISO` date helper

**Files:** `apps/app/src/features/path/lib/today.ts` (+ `today.test.ts`).

- [ ] **Step 1: Add the failing test** to `today.test.ts`:
```ts
import { addDaysISO } from "./today";
describe("addDaysISO", () => {
  it("adds a calendar day", () => {
    expect(addDaysISO("2026-06-12", 1)).toBe("2026-06-13");
  });
  it("rolls over month and year boundaries", () => {
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});
```
Run `pnpm --filter app test src/features/path/lib/today.test.ts` → FAIL.

- [ ] **Step 2: Implement** in `today.ts` (after `todayISO`):
```ts
/** yyyy-mm-dd `days` after `iso` (calendar days). Parses at local midnight so a
 *  DST shift can't roll the date. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
```
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/lib/today.ts apps/app/src/features/path/lib/today.test.ts
git commit -m "$(printf 'feat(path): addDaysISO date helper\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `carryToTomorrow` mutation

**Files:** `apps/app/src/features/path/hooks/usePathMutations.ts` (+ `usePathMutations.test.tsx`).

- [ ] **Step 1: Add the failing test** to `usePathMutations.test.tsx` (reuse the file's permissive call-recorder mock; `vi.mock("../lib/today", ...)` already stubs `todayISO` — extend it to also stub `addDaysISO`). Add to that mock factory: `addDaysISO: (iso: string) => "2026-06-13"` (so tomorrow is deterministic), keeping the existing `todayISO`/`formatPathDate` stubs. Then:
```ts
describe("carryToTomorrow", () => {
  it("upserts tomorrow's path, reparents today's pending stops, marks today completed", async () => {
    pendingStops = [{ id: "ps1" }, { id: "ps2" }];
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.carryToTomorrow.mutateAsync({ pathId: "today-1", pathDate: "2026-06-12" });
    });
    // upserts a path (tomorrow)
    expect(calls.some((c) => c.table === "paths" && c.op === "upsert"
      && (c.payload as { path_date?: string }).path_date === "2026-06-13")).toBe(true);
    // bulk reparent of the two pending stops
    expect(calls.some((c) => c.table === "path_stops" && c.op === "update"
      && (c.payload as { path_id?: string }).path_id === "today-1"
      && c.filters.some(([col]) => col === "id"))).toBe(true);
    // today's path marked completed
    expect(calls.some((c) => c.table === "paths" && c.op === "update"
      && (c.payload as { status?: string }).status === "completed"
      && c.filters.some(([col, v]) => col === "id" && v === "today-1"))).toBe(true);
  });
});
```
> NOTE: the recorder mock returns `{ id: "today-1" }` from `.single()` for upserts (the same canned id the existing `continuePreviousPath` test relies on), so the reparent target id in the assertion is `"today-1"`. If the file's mock returns a different canned single-id, match it.

Run `pnpm --filter app test src/features/path/hooks/usePathMutations.test.tsx` → FAIL.

- [ ] **Step 2: Implement.** In `usePathMutations.ts`, extend the `../lib/today` import to include `addDaysISO`:
```ts
import { todayISO, addDaysISO } from "../lib/today";
```
Add the mutation (next to `continuePreviousPath`, above the `return`):
```ts
  const carryToTomorrow = useMutation({
    mutationFn: async (input: { pathId: string; pathDate: string }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const tomorrow = addDaysISO(input.pathDate, 1);
      const { data: toRow, error: e0 } = await supabase
        .from("paths")
        .upsert(
          { user_id: userId, path_date: tomorrow, origin_label: null, origin_lat: null, origin_lng: null },
          { onConflict: "user_id,path_date" },
        )
        .select("id").single();
      if (e0) throw e0;
      const toId = (toRow as unknown as { id: string }).id;
      const { data: pend, error: e1 } = await supabase
        .from("path_stops").select("id")
        .eq("path_id", input.pathId).eq("status", "pending")
        .order("position", { ascending: true });
      if (e1) throw e1;
      const pendingIds = ((pend ?? []) as { id: string }[]).map((r) => r.id);
      // Reparent today's pending stops onto tomorrow's (normally empty) path.
      // Same precondition as continuePreviousPath: no (path_id, prospect_id)
      // collision since tomorrow's path is typically empty.
      if (pendingIds.length > 0) {
        const { error } = await supabase.from("path_stops").update({ path_id: toId }).in("id", pendingIds);
        if (error) throw error;
      }
      const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", input.pathId);
      if (e2) throw e2;
    },
    onSuccess: invalidate,
  });
```
Add `carryToTomorrow` to the returned object.
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/hooks/usePathMutations.ts apps/app/src/features/path/hooks/usePathMutations.test.tsx
git commit -m "$(printf 'feat(path): carryToTomorrow mutation (reparent pending forward + finalize today)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `EndRouteSheet` confirm dialog

**Files:** Create `apps/app/src/features/path/components/EndRouteSheet.tsx` (+ `.test.tsx`).

- [ ] **Step 1: Write the failing test** `EndRouteSheet.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EndRouteSheet } from "./EndRouteSheet";

const base = { open: true, onOpenChange: vi.fn(), pendingCount: 6, onCarry: vi.fn(), onClear: vi.fn() };

describe("EndRouteSheet", () => {
  it("shows the pending count and fires Carry / Clear", () => {
    const onCarry = vi.fn();
    const onClear = vi.fn();
    render(<EndRouteSheet {...base} onCarry={onCarry} onClear={onClear} />);
    expect(screen.getByText(/6 stops left/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /carry 6 to tomorrow/i }));
    expect(onCarry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /clear & start over/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
  it("Cancel closes the sheet", () => {
    const onOpenChange = vi.fn();
    render(<EndRouteSheet {...base} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("disables the actions while busy", () => {
    render(<EndRouteSheet {...base} busy />);
    expect(screen.getByRole("button", { name: /carry 6 to tomorrow/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /clear & start over/i })).toBeDisabled();
  });
  it("singularizes one stop", () => {
    render(<EndRouteSheet {...base} pendingCount={1} />);
    expect(screen.getByText(/1 stop left/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /carry 1 to tomorrow/i })).toBeInTheDocument();
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `EndRouteSheet.tsx`**
```tsx
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/navigatr";

interface EndRouteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stops still pending on the route. */
  pendingCount: number;
  /** A carry/clear action is in flight — disable the buttons. */
  busy?: boolean;
  /** Carry the pending stops to tomorrow. */
  onCarry: () => void;
  /** Clear today's path and start over. */
  onClear: () => void;
}

/**
 * EndRouteSheet — shown from RunningPath's "End route" when stops remain. Lets the
 * rep carry the remaining stops to tomorrow or clear the path and start over.
 */
export function EndRouteSheet({ open, onOpenChange, pendingCount, busy, onCarry, onClear }: EndRouteSheetProps) {
  const noun = pendingCount === 1 ? "stop" : "stops";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              End route · {pendingCount} {noun} left
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <p className="text-body-md text-text-muted">
            Carry the remaining {noun} to tomorrow, or clear this path and start over.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" disabled={busy} loading={busy} onClick={onCarry}>
              Carry {pendingCount} to tomorrow
            </Button>
            <Button variant="tertiary" disabled={busy} onClick={onClear}>
              Clear &amp; start over
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
> VERIFY `Button` `loading`/`disabled` props + the variant names against `DropInSheet.tsx`. If `loading` isn't a Button prop, drop it (keep `disabled`).
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/components/EndRouteSheet.tsx apps/app/src/features/path/components/EndRouteSheet.test.tsx
git commit -m "$(printf 'feat(path): EndRouteSheet confirm dialog (carry / clear / cancel)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Wire End route into `RunningPath`

**Files:** `apps/app/src/features/path/components/RunningPath.tsx` (+ `RunningPath.test.tsx`).

- [ ] **Step 1: Extend `RunningPath.test.tsx`.** READ it first for its `useTodayPath` mock. Ensure that mock exposes `pathId` (e.g. `"today-1"`), `pendingCount` (a fn), `clear` (a spy), and `setStatus`. Add a `usePathMutations` mock + an `EndRouteSheet` mock (stub it to expose its callbacks, OR render the real one and target its buttons). Recommended — mock the sheet to a lightweight stub so the test targets wiring:
```tsx
const carryMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({ carryToTomorrow: { mutateAsync: carryMutate, isPending: false } }),
}));
vi.mock("./EndRouteSheet", () => ({
  EndRouteSheet: (p: { open: boolean; pendingCount: number; onCarry: () => void; onClear: () => void }) =>
    p.open ? (
      <div data-testid="end-sheet">
        <span>{p.pendingCount} pending</span>
        <button onClick={p.onCarry}>carry</button>
        <button onClick={p.onClear}>clear</button>
      </div>
    ) : null,
}));
```
Add tests (the `useTodayPath` mock must return some pending stops + `pendingCount: () => N` + `pathId: "today-1"`):
```tsx
it("End route with pending stops opens the sheet", () => {
  // mock: stops has pending, pendingCount() = 2, pathId "today-1"
  render(<RunningPath {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
});
it("Carry to tomorrow calls carryToTomorrow then exits", async () => {
  carryMutate.mockResolvedValueOnce(undefined);
  render(<RunningPath {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  await act(async () => { fireEvent.click(screen.getByText("carry")); });
  expect(carryMutate).toHaveBeenCalledWith({ pathId: "today-1", pathDate: expect.any(String) });
  expect(onExit).toHaveBeenCalled();
});
it("Clear & start over (confirmed) clears + exits", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<RunningPath {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  await act(async () => { fireEvent.click(screen.getByText("clear")); });
  expect(clearSpy).toHaveBeenCalled();
  expect(onExit).toHaveBeenCalled();
});
it("End route with no pending stops exits without the sheet", () => {
  // mock: pendingCount() = 0
  render(<RunningPath {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
  expect(onExit).toHaveBeenCalled();
});
```
(Adapt to the test file's existing mock/spy names — `clearSpy`, `onExit`, the props builder. The "no pending" case needs the `allDone` branch NOT to short-circuit — i.e. give it stops where some are pending=false but total>0 and pendingCount 0 means allDone shows PathSummary; to test the no-pending End-route safety path cleanly, you may instead assert it via the handler with a stops set that has a pending=false but isn't allDone — if that's awkward, drop this case and rely on the handler guard being obvious. Keep the three meaningful cases.)
Run → FAIL.

- [ ] **Step 2: Edit `RunningPath.tsx`.**
  - Imports: add `import { usePathMutations } from "../hooks/usePathMutations";`, `import { EndRouteSheet } from "./EndRouteSheet";`, `import { todayISO } from "../lib/today";`. (Keep the `Pause` lucide import; optionally add a `Flag`/`CircleStop` icon for End route, or leave it text-only.)
  - Destructure more from `useTodayPath`: `const { stops, setStatus, clear, pathId, pendingCount } = useTodayPath();`
  - `const { carryToTomorrow } = usePathMutations();`
  - State: `const [endOpen, setEndOpen] = React.useState(false);`
  - Handlers (near `skip`):
```ts
  const handleEndRoute = () => {
    if (pendingCount() === 0) { onExit(); return; }
    setEndOpen(true);
  };
  const handleCarry = async () => {
    if (!pathId) return;
    try {
      await carryToTomorrow.mutateAsync({ pathId, pathDate: todayISO() });
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't carry the stops to tomorrow — please try again.");
    }
  };
  const handleClearRestart = () => {
    if (!window.confirm("Clear today's path and start over?")) return;
    void clear();
    setEndOpen(false);
    onExit();
  };
```
  - Status bar: add the End route button next to Pause (wrap the two in a flex group):
```tsx
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" leadingIcon={Pause} onClick={onPause}>Pause</Button>
          <Button variant="tertiary" size="sm" onClick={handleEndRoute}>End route</Button>
        </div>
```
  - Render the sheet (next to the existing `<DropInSheet … />`):
```tsx
      <EndRouteSheet
        open={endOpen}
        onOpenChange={setEndOpen}
        pendingCount={pendingCount()}
        busy={carryToTomorrow.isPending}
        onCarry={handleCarry}
        onClear={handleClearRestart}
      />
```
  (The `allDone` branch returns early before this render, so End route only shows while stops are pending — consistent with the spec; the `pendingCount() === 0` guard in `handleEndRoute` is a belt-and-suspenders safety.)

- [ ] **Step 3: Run → PASS** (`RunningPath.test.tsx`). Typecheck. Then full suite `pnpm test`.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/components/RunningPath.tsx apps/app/src/features/path/components/RunningPath.test.tsx
git commit -m "$(printf 'feat(path): End route in running mode — carry to tomorrow or start over\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Ship

- [ ] **Step 1: Full gate** — `cd apps/app && pnpm typecheck && pnpm test` (all green).
- [ ] **Step 2: Manual smoke (after merge+push).** Start a path → Start route → with stops pending, tap **End route** → sheet shows "End route · N stops left"; **Carry N to tomorrow** → lands on entry, today's path finalized; next calendar day, those stops are the active path. From a fresh run, **Clear & start over** → confirm → entry, path gone. **Cancel** stays in the route. **Pause** still just returns to the list.
- [ ] **Step 3: Finish the branch** (superpowers:finishing-a-development-branch → merge + push).

---

## Self-Review

**Spec coverage:** End route button in running mode (separate from Pause) → Task 4 ✅. Prompt with Carry / Clear / Cancel → Task 3 + Task 4 ✅. Carry = next calendar day, reparent pending, finalize today → Task 1 (`addDaysISO`) + Task 2 (`carryToTomorrow`) ✅. Clear = existing `clear()` with confirm → Task 4 ✅. No-pending → no prompt, exit → Task 4 (`handleEndRoute` guard) ✅. Carry failure → toast, don't exit → Task 4 (`handleCarry` catch) ✅. Double-submit guard (`isPending`) → Task 3 (`busy`) + Task 4 ✅. Only pending stops carry → Task 2 (`status='pending'` filter) ✅. No PathPage change ✅.

**Placeholder scan:** None — full code each step. The one soft note is the "no-pending" RunningPath test (flagged as droppable if the `allDone` branch makes it awkward) — the handler guard itself is concrete.

**Type consistency:** `addDaysISO(iso, days): string` defined Task 1, used Task 2. `carryToTomorrow.mutateAsync({ pathId, pathDate })` signature consistent Task 2 ↔ Task 4 call. `EndRouteSheet` props `{ open, onOpenChange, pendingCount, busy?, onCarry, onClear }` consistent Task 3 ↔ Task 4 usage. `useTodayPath` `pendingCount` used as a **function** (`pendingCount()`) in Task 4, matching the hook. `pathId` nullable → guarded in `handleCarry`.
