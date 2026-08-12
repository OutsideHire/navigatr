# Mark route complete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "Mark route complete" action to the End-route flow that finalizes the current path (auto-skipping pending stops, marking it `completed`) and shows the existing `PathSummary` "Path complete" report in place.

**Architecture:** Expose the existing `finalizeSingle` as a `finalizeCurrentPath` mutation from `usePathMutations`; add a primary "Mark route complete" button to `EndRouteSheet`; in `RunningPath`, capture a stats snapshot, finalize, and render `PathSummary` from the snapshot (robust to the path being dropped on refetch).

**Tech Stack:** React + TypeScript, TanStack Query, Supabase, Radix Dialog, Vitest + Testing Library.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-24-mark-route-complete-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/mark-complete/apps/app`.

---

### Task 1: Expose `finalizeCurrentPath` from `usePathMutations` (TDD)

**Files:** `apps/app/src/features/path/hooks/usePathMutations.ts` (+ `usePathMutations.test.tsx`).

Context: `finalizeSingle(pathId)` already exists (line ~143) and does exactly the right DB work — `update path_stops set status='skipped' where path_id=? and status='pending'`, then `update paths set status='completed' where id=?`. It is NOT in the hook's returned object. Wrap it as a mutation so callers get `mutateAsync` + `isPending` and the standard `invalidate`.

- [ ] **Step 1: Write the failing test** in `usePathMutations.test.tsx` (mirror the existing mutation tests' permissive supabase mock + `renderHook`/wrapper in that file). Assert that calling `finalizeCurrentPath.mutateAsync(pathId)`:
  - issues an update to `path_stops` setting `status: "skipped"` filtered by `path_id` = the id and `status = "pending"`, and
  - issues an update to `paths` setting `status: "completed"` filtered by `id` = the path id.
  (Match the assertion style the file already uses for `carryToTomorrow`/`continuePreviousPath` — e.g. asserting the `.from("path_stops")`/`.from("paths")` + `.update(...)` calls on the mock.)

- [ ] **Step 2: Run** `pnpm test usePathMutations` → FAIL (`finalizeCurrentPath` undefined).

- [ ] **Step 3: Implement.** In `usePathMutations.ts`, after the `carryToTomorrow` mutation definition and before the `return { ... }`, add:
```ts
  // Finalize THIS path now: skip its pending stops + mark it completed. Wraps the
  // finalizeSingle helper so the End-route "Mark route complete" action gets
  // mutateAsync + isPending + the shared cache invalidation.
  const finalizeCurrentPath = useMutation({
    mutationFn: (pathId: string) => finalizeSingle(pathId),
    onSuccess: invalidate,
  });
```
Then add `finalizeCurrentPath` to the returned object (append to the existing `return { … }` on line ~230):
```ts
  return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated, deletePath, continuePreviousPath, carryToTomorrow, closePreviousPath, finalizeCurrentPath };
```

- [ ] **Step 4: Run** `pnpm test usePathMutations` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/path/hooks/usePathMutations.ts apps/app/src/features/path/hooks/usePathMutations.test.tsx
git commit -m "feat(path): expose finalizeCurrentPath mutation (skip pending + mark completed)"
```

---

### Task 2: `EndRouteSheet` — add "Mark route complete" (TDD)

**Files:** `apps/app/src/features/path/components/EndRouteSheet.tsx` (+ `EndRouteSheet.test.tsx`).

- [ ] **Step 1: Update the test** `EndRouteSheet.test.tsx`. The file builds props inline per test; add an `onComplete` spy to each render and a new test:
```tsx
it("Mark route complete fires onComplete", () => {
  const onComplete = vi.fn();
  render(
    <EndRouteSheet open onOpenChange={vi.fn()} pendingCount={3}
      onComplete={onComplete} onCarry={vi.fn()} onClear={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /mark route complete/i }));
  expect(onComplete).toHaveBeenCalled();
});
it("busy disables Mark route complete", () => {
  render(
    <EndRouteSheet open onOpenChange={vi.fn()} pendingCount={3} busy
      onComplete={vi.fn()} onCarry={vi.fn()} onClear={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: /mark route complete/i })).toBeDisabled();
});
```
Also add `onComplete={vi.fn()}` to the existing carry/clear/cancel test renders so they still compile.

- [ ] **Step 2: Run** `pnpm test EndRouteSheet` → FAIL.

- [ ] **Step 3: Implement.** In `EndRouteSheet.tsx`, add the prop and the button (Mark complete = primary; Carry demoted to secondary):
  - Add to `EndRouteSheetProps`: `/** Finalize this path now (skip pending) + show the report. */ onComplete: () => void;`
  - Destructure `onComplete` in the component signature.
  - Update the body copy paragraph to:
    `Mark this route complete, carry the remaining {noun} to tomorrow, or clear this path and start over.`
  - Replace the action buttons block with (Mark complete first/primary, Carry secondary, Clear tertiary, Cancel ghost):
```tsx
          <div className="flex flex-col gap-2">
            <Button variant="primary" disabled={busy} loading={busy} onClick={onComplete}>
              Mark route complete
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCarry}>
              Carry {pendingCount} to tomorrow
            </Button>
            <Button variant="tertiary" disabled={busy} onClick={onClear}>
              Clear &amp; start over
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
```
  (Note: `busy` reflects any in-flight finalize/carry; it disables all actions and shows the spinner on the primary. That's acceptable — only one action runs at a time.)

- [ ] **Step 4: Run** `pnpm test EndRouteSheet` → PASS. `pnpm typecheck` → clean (it'll flag `RunningPath` still not passing `onComplete` — that's fixed in Task 3; if typecheck must be clean at this commit, note it and proceed, Task 3 resolves it. To keep this commit self-consistent, you MAY do Task 3's EndRouteSheet-render edit here; otherwise expect one transient TS error on the RunningPath call site until Task 3.)

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/path/components/EndRouteSheet.tsx apps/app/src/features/path/components/EndRouteSheet.test.tsx
git commit -m "feat(path): add Mark route complete action to EndRouteSheet"
```

---

### Task 3: `RunningPath` — wire finalize + render the report (TDD)

**Files:** `apps/app/src/features/path/components/RunningPath.tsx` (+ `RunningPath.test.tsx`).

- [ ] **Step 1: Update `RunningPath.test.tsx`.** It already mocks `useTodayPath`, `usePathMutations` (currently `{ carryToTomorrow: { mutateAsync, isPending } }`), an `EndRouteSheet` stub, a `PathSummary` stub, and `sonner`. Extend:
  - Add `finalizeCurrentPath: { mutateAsync: finalizeMutate, isPending: false }` to the `usePathMutations` mock (declare `const finalizeMutate = vi.fn()` and reset in `beforeEach`).
  - In the `EndRouteSheet` stub, add a button wired to `onComplete`: `<button onClick={p.onComplete}>mark-complete</button>` (and include `onComplete` in the stub's prop type).
  - Add tests:
```tsx
it("Mark route complete finalizes and shows the report without exiting", async () => {
  stops = [stop("A"), stop("B", { status: "visited" })];
  pendingCount = () => 1;
  pathId = "today-1";
  finalizeMutate.mockResolvedValueOnce(undefined);
  const onExitSpy = vi.fn();
  render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
  expect(finalizeMutate).toHaveBeenCalledWith("today-1");
  expect(screen.getByTestId("summary")).toBeInTheDocument();  // PathSummary stub
  expect(onExitSpy).not.toHaveBeenCalled();
});
it("Mark complete failure toasts and keeps the sheet open (no report)", async () => {
  stops = [stop("A")];
  pendingCount = () => 1;
  pathId = "today-1";
  finalizeMutate.mockRejectedValueOnce(new Error("boom"));
  const onExitSpy = vi.fn();
  const { toast } = await import("sonner");
  render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
  fireEvent.click(screen.getByRole("button", { name: /end route/i }));
  await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
  expect(toast.error).toHaveBeenCalled();
  expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
  expect(onExitSpy).not.toHaveBeenCalled();
});
```
  (Use the file's existing `stop()` helper, `ORIGIN`, and the `PathSummary` stub's testid — confirm the stub's testid is `summary`; if it differs, match it. The `PathSummary` stub must render whenever the real one would.)

- [ ] **Step 2: Run** `pnpm test RunningPath` → FAIL.

- [ ] **Step 3: Implement in `RunningPath.tsx`.**
  (a) Pull `finalizeCurrentPath`: change the mutations line to
  `const { carryToTomorrow, finalizeCurrentPath } = usePathMutations();`
  (b) Add completed-snapshot state (near the other `React.useState` calls):
```tsx
  const [completed, setCompleted] = React.useState<{
    visitedCount: number; skippedCount: number; totalStops: number;
    routeMeters: number; dispositions: Disposition[]; dealsCreated: number;
  } | null>(null);
```
  (c) Add the handler (next to `handleCarry`):
```tsx
  const handleComplete = async () => {
    if (!pathId) return;
    const pending = stops.filter((s) => s.status === "pending").length;
    const snapshot = {
      visitedCount: visited,
      skippedCount: stops.filter((s) => s.status === "skipped").length + pending,
      totalStops: total,
      routeMeters: routeStats(origin, stops.map((s) => ({ lat: s.lat, lng: s.lng }))).totalRouteMeters,
      dispositions: stops.map((s) => s.disposition).filter((d): d is Disposition => d != null),
      dealsCreated: stops.filter((s) => s.dealCreated).length,
    };
    try {
      await finalizeCurrentPath.mutateAsync(pathId);
      setEndOpen(false);
      setCompleted(snapshot);
    } catch {
      toast.error("Couldn't mark the route complete — please try again.");
    }
  };
```
  (d) Render the report from the snapshot — add this **immediately before** the existing `if (allDone) {` block:
```tsx
  if (completed) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <PathSummary
          {...completed}
          onViewPipeline={onViewPipeline}
          onNewPath={() => { void clear(); onExit(); }}
        />
      </div>
    );
  }
```
  (e) Update the `<EndRouteSheet …>` render: add `onComplete={handleComplete}` and widen `busy`:
```tsx
        busy={carryToTomorrow.isPending || finalizeCurrentPath.isPending}
        onComplete={handleComplete}
```
  (`visited`, `total`, `stops`, `origin`, `routeStats`, `Disposition`, `toast`, `PathSummary` are all already in scope/imported in this file.)

- [ ] **Step 4: Run** `pnpm test RunningPath` → PASS.

- [ ] **Step 5: Full gate** `pnpm typecheck && pnpm test` → clean, all green.

- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/path/components/RunningPath.tsx apps/app/src/features/path/components/RunningPath.test.tsx
git commit -m "feat(path): Mark route complete finalizes + shows the Path-complete report"
```

---

## Notes for the implementer
- `finalizeCurrentPath.mutateAsync(pathId)` takes the **path id string** (positional), not an object.
- The report is rendered from a **snapshot captured before finalize**, so it survives `useTodayPath` dropping the now-completed path on refetch. Pending stops are counted in `skippedCount`.
- Do NOT call `onExit` on mark-complete — the rep stays on the report and leaves via View pipeline / New path.
- Don't touch the carry/clear/cancel handlers or the natural `allDone` → `PathSummary` branch.
- If Task 2's commit leaves a transient typecheck error at the `RunningPath` `<EndRouteSheet>` call site (missing `onComplete`), that's resolved in Task 3; the full gate at Task 3 Step 5 must be clean.
