# Explicit-commit Log drop-in sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `DropInSheet` so tapping a disposition only *selects* it; an explicit "Log Stop" footer button commits, and the voice note becomes a disabled "Coming soon" placeholder.

**Architecture:** Single-file change to `apps/app/src/features/path/components/DropInSheet.tsx` and its test. No new components/hooks/mutations, no data-model change. Props unchanged. Tap → `setSelected`; commit moves to a footer button that also absorbs the Follow-Up Requested confirm. Voice-note recorder/upload imports are dropped from this file (the modules stay in the repo for Phase 2); `voiceNoteUrl: null` flows to follow-up activities.

**Tech Stack:** React + TypeScript, Radix Dialog, Vitest + Testing Library, sonner, navigatr design tokens.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-17-explicit-commit-dropin-design.md`

---

## File Structure

- **Modify:** `apps/app/src/features/path/components/DropInSheet.tsx` — the only source change.
- **Modify:** `apps/app/src/features/path/components/DropInSheet.test.tsx` — rewritten for explicit-commit behavior; voice-recording mocks/tests removed.

Run all commands from the worktree app dir: `cd /Users/ryanmeo/navigatr/.claude/worktrees/dropin-commit/apps/app`.

---

### Task 1: Explicit-commit DropInSheet (TDD: rewrite tests red, then implement green)

**Files:**
- Modify: `apps/app/src/features/path/components/DropInSheet.test.tsx`
- Modify: `apps/app/src/features/path/components/DropInSheet.tsx`

- [ ] **Step 1: Replace the test file with the explicit-commit suite**

Overwrite `apps/app/src/features/path/components/DropInSheet.test.tsx` entirely with:

```tsx
// Tests for DropInSheet (explicit-commit redesign):
//   - Tapping a tile SELECTS it; nothing commits until "Log Stop".
//   - Log Stop disabled until a disposition is selected.
//   - Terminal disposition → logVisit only, no deal; follow-up → deal + activity
//     (voiceNoteUrl: null). Follow-Up Requested commits with the chosen date.
//   - Voice note is a disabled "Coming soon" placeholder.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────
const createDealMutateAsync = vi.fn().mockResolvedValue({ id: "deal-1" });
const logActivityMutateAsync = vi.fn().mockResolvedValue({ id: "act-1" });

vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
}));

vi.mock("@/features/activities/hooks/useLogActivity", () => ({
  useLogActivity: () => ({ mutateAsync: logActivityMutateAsync }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const logVisit = vi.fn();
const markDealCreated = vi.fn();
// Mutable so individual tests can seed the stop snapshot (e.g. dealCreated:true).
let stops: Array<{ merchantId: string; dealCreated: boolean }> = [];
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ logVisit, markDealCreated, stops }),
}));

const { DropInSheet } = await import("./DropInSheet");
import { toast } from "sonner";
import type { Merchant } from "../mockData";

const merchant: Merchant = {
  id: "m-1",
  name: "Bluewater",
  category: "food_beverage",
  address: "123 Main St",
  lat: 40,
  lng: -74,
  phone: "+15551234567",
  employeeCountRange: "1-10",
  status: "untouched",
  lastActivity: null,
};

const onOpenChange = vi.fn();

function renderSheet(extra: Partial<React.ComponentProps<typeof DropInSheet>> = {}) {
  return render(
    <DropInSheet merchant={merchant} open onOpenChange={onOpenChange} {...extra} />,
  );
}

const logStopBtn = () => screen.getByRole("button", { name: /log stop/i });

describe("DropInSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDealMutateAsync.mockResolvedValue({ id: "deal-1" });
    logActivityMutateAsync.mockResolvedValue({ id: "act-1" });
    logVisit.mockClear();
    markDealCreated.mockClear();
    onOpenChange.mockClear();
    stops = [];
  });

  it("renders the 10 tiles, a Log Stop button, and no Save/contact-name field", () => {
    renderSheet();
    expect(screen.getByText("Statement Secured")).toBeInTheDocument();
    expect(screen.getByText("Highest urgency. 1 day.")).toBeInTheDocument();
    expect(screen.getByText("Wrong Person")).toBeInTheDocument();
    expect(logStopBtn()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
  });

  it("renders a disabled 'Coming soon' voice-note placeholder", () => {
    renderSheet();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record a voice note/i })).toBeDisabled();
  });

  it("tapping a tile selects it but does NOT commit", () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Statement Secured"));
    expect(logVisit).not.toHaveBeenCalled();
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Log Stop is disabled with no selection and enabled after selecting", () => {
    renderSheet();
    expect(logStopBtn()).toBeDisabled();
    fireEvent.click(screen.getByText("Not Interested"));
    expect(logStopBtn()).toBeEnabled();
  });

  it("terminal disposition + Log Stop logs the visit only, then closes", async () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Not Interested"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested");
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("not_interested");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("follow-up disposition + Log Stop creates deal + activity (voiceNoteUrl null)", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured");
    expect(createDealMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contactName: "Bluewater", leadSource: "path_dropin" }),
    );
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "drop_in",
        disposition: "statement_secured",
        followUpDate: expect.any(String),
        voiceNoteUrl: null,
      }),
    );
    expect(markDealCreated).toHaveBeenCalledWith("m-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Follow-Up Requested: date picker shows; Log Stop commits with the chosen date", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Follow-Up Requested"));
    const dateInput = screen.getByLabelText(/follow-up date/i);
    fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "followup_requested");
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "followup_requested",
        followUpDate: expect.stringContaining("2026-06-20"),
        voiceNoteUrl: null,
      }),
    );
  });

  it("Follow-Up Requested: Log Stop is disabled when the date is cleared", () => {
    renderSheet();
    fireEvent.click(screen.getByText("Follow-Up Requested"));
    fireEvent.change(screen.getByLabelText(/follow-up date/i), { target: { value: "" } });
    expect(logStopBtn()).toBeDisabled();
  });

  it("skips deal creation when the stop already has a deal", async () => {
    stops = [{ merchantId: "m-1", dealCreated: true }];
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    await waitFor(() => expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured"));
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
  });

  it("guards against double-submit: rapid Log Stop clicks log the visit once", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    const btn = logStopBtn();
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
    expect(logVisit).toHaveBeenCalledTimes(1);
  });

  it("on activity-write failure: error toast, no markDealCreated, still closes + onLogged", async () => {
    logActivityMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(toast.error).toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("statement_secured");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the suite to confirm it fails against the current component**

Run: `pnpm --filter app test DropInSheet`
Expected: FAIL — current component auto-saves on tap (no Log Stop button), so e.g. "tapping a tile selects it but does NOT commit" and "renders … a Log Stop button" fail.

- [ ] **Step 3: Replace the component with the explicit-commit implementation**

Overwrite `apps/app/src/features/path/components/DropInSheet.tsx` entirely with:

```tsx
/**
 * DropInSheet — log a field drop-in for a path stop.
 *
 * Explicit-commit: tapping a disposition tile only *selects* it. Nothing is
 * saved until the rep taps "Log Stop" in the footer. On commit:
 *   - always: record the disposition on the queue stop (useTodayPath.logVisit).
 *   - follow-up outcomes (schedulesFollowUp === true): also create a Pipeline
 *     deal (company = business name, contact = business name) and log a
 *     `drop_in` activity whose disposition auto-schedules the follow-up.
 *   - terminal outcomes: log the visit only — no deal.
 *
 * Follow-Up Requested reveals an inline date picker (default +7 calendar days,
 * min = today); the footer "Log Stop" button commits with the chosen date.
 *
 * Voice note: disabled "Coming soon" placeholder. The recorder hook/component
 * and upload helper remain in the repo, unused here, for Phase 2 re-wiring.
 *
 * Places-only: no employee count, estimated value, or email captured.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Mic, X } from "lucide-react";
import { toast } from "sonner";

import { Button, Input, NotesFieldWithMic, DispositionTile } from "@/components/navigatr";
import {
  DISPOSITIONS,
  calculateFollowUpDate,
  schedulesFollowUp,
  type Disposition,
} from "@/lib/followUpScheduling";
import type { Merchant } from "../mockData";
import { useTodayPath } from "../hooks/useTodayPath";
import { PATH_DISPOSITION_KEYS } from "../lib/pathDispositions";
import { todayISO } from "../lib/today";
import { useCreateDeal } from "@/features/pipeline/hooks/useCreateDeal";
import { useLogActivity } from "@/features/activities/hooks/useLogActivity";

/** Default follow-up date for the inline picker: today + N calendar days, yyyy-mm-dd. */
function plusDaysISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface DropInSheetProps {
  merchant: Merchant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful commit, with the chosen disposition. Lets running
   *  mode advance to the next stop once a visit is logged. */
  onLogged?: (disposition: Disposition) => void;
}

export function DropInSheet({ merchant, open, onOpenChange, onLogged }: DropInSheetProps) {
  const todayPath = useTodayPath();
  const logVisit = todayPath.logVisit;
  const markDealCreated = todayPath.markDealCreated;
  // Already-created deals must not be duplicated when a stop is re-logged.
  const alreadyDealCreated = merchant
    ? todayPath.stops.find((s) => s.merchantId === merchant.id)?.dealCreated ?? false
    : false;
  const createDeal = useCreateDeal();
  const logActivity = useLogActivity();

  const [selected, setSelected] = React.useState<Disposition | null>(null);
  const [notes, setNotes] = React.useState("");
  const [customDate, setCustomDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against double-submit: `saving` state is a stale closure
  // within a single tick, so a fast double-tap can fire commit() twice and
  // create two deals before React re-renders. The ref flips immediately.
  const savingRef = React.useRef(false);

  // Reset the form each time the sheet opens for a (possibly new) merchant.
  React.useEffect(() => {
    if (open) {
      setSelected(null);
      setNotes("");
      setCustomDate(plusDaysISODate(7));
      setSaving(false);
      savingRef.current = false;
    }
  }, [open, merchant?.id]);

  if (!merchant) return null;

  const commit = async (disposition: Disposition, customDateStr?: string) => {
    if (!merchant || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    // Always record the disposition on the queue stop.
    await logVisit(merchant.id, disposition);

    if (schedulesFollowUp(disposition) && !alreadyDealCreated) {
      try {
        const followUpDate = customDateStr
          ? new Date(`${customDateStr}T00:00:00Z`).toISOString()
          : calculateFollowUpDate(disposition);
        const { id: dealId } = await createDeal.mutateAsync({
          companyName: merchant.name,
          address: merchant.address,
          industry: merchant.category,
          contactName: merchant.name,
          contactPhone: merchant.phone ?? "",
          stage: "new",
          probability: 20,
          leadSource: "path_dropin",
          notes: notes.trim() || undefined,
        });
        await logActivity.mutateAsync({
          dealId,
          type: "drop_in",
          disposition,
          outcomeNotes: notes.trim(),
          followUpDate,
          voiceNoteUrl: null,
        });
        // Both mutations succeeded — only now is a deal truly created.
        await markDealCreated(merchant.id);
        toast.success(`Deal created for ${merchant.name}`);
        // Known accepted edge: if createDeal succeeds but logActivity throws, an
        // orphan deal exists with no drop-in activity / follow-up. We don't roll
        // back; the visit is recorded and dealCreated stays false, so the summary
        // won't over-count.
      } catch {
        toast.error("Couldn't finish logging — the visit was saved but the deal/follow-up may not have been.");
      }
    } else {
      toast.success(`Visit logged: ${DISPOSITIONS[disposition].label}`);
    }
    setSaving(false);
    savingRef.current = false;
    onLogged?.(disposition);
    onOpenChange(false);
  };

  const handleLog = () => {
    if (!selected) return;
    void commit(selected, selected === "followup_requested" ? customDate : undefined);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="pb-3">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-heading-sm text-text-default">
                Log drop-in · {merchant.name}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <p className="mt-1 text-caption text-text-muted">
              Pick an outcome, add a note, then log the stop.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {/* Voice note — Coming soon (disabled placeholder; Phase 2 re-wires). */}
            <div className="rounded-radius-md border border-border-default p-4 opacity-60">
              <div className="flex items-center justify-between">
                <span className="text-caption font-medium text-text-muted">Voice note</span>
                <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-muted">
                  Coming soon
                </span>
              </div>
              <button
                type="button"
                disabled
                aria-disabled
                className="mt-2 inline-flex cursor-not-allowed items-center gap-2 rounded-radius-md bg-surface-sunken px-4 py-2 text-body-md font-medium text-text-muted"
              >
                <Mic className="h-4 w-4" aria-hidden /> Record a voice note
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={DISPOSITIONS[key].label}
                  description={DISPOSITIONS[key].rationale}
                  selected={selected === key}
                  onClick={() => setSelected(key)}
                />
              ))}
            </div>

            {selected === "followup_requested" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Follow-up date</span>
                <Input
                  type="date"
                  value={customDate}
                  min={todayISO()}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </label>
            )}

            <NotesFieldWithMic
              value={notes}
              onChange={setNotes}
              placeholder="What happened on this visit?"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!selected || (selected === "followup_requested" && !customDate) || saving}
              loading={saving}
              onClick={handleLog}
            >
              Log Stop
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DropInSheet;
```

- [ ] **Step 4: Run the suite to confirm it passes**

Run: `pnpm --filter app test DropInSheet`
Expected: PASS — all DropInSheet tests green.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: typecheck clean (no unused-import errors from the dropped `useVoiceRecorder`/`VoiceNoteRecorder`/`uploadVoiceNote`/`useAuth` references); full suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/path/components/DropInSheet.tsx \
        apps/app/src/features/path/components/DropInSheet.test.tsx
git commit -m "feat(path): explicit-commit Log drop-in (tap selects, Log Stop commits; voice note coming soon)"
```

---

## Notes for the implementer

- **Do not** delete `useVoiceRecorder.ts`, `VoiceNoteRecorder.tsx`, or `voiceNoteStorage.ts` — they stay in the repo for Phase 2. Only this sheet stops importing them.
- The `Mic` icon comes from `lucide-react` (already a dependency; `X` imports from it today).
- `DispositionTile`, `Button`, `Input`, `NotesFieldWithMic` are re-exported from `@/components/navigatr` (unchanged).
- The follow-up date default is +7 days, so on selecting Follow-Up Requested the Log Stop button is immediately enabled; it only disables if the rep clears the date.
- Keep the `savingRef` synchronous double-submit guard exactly as-is.
