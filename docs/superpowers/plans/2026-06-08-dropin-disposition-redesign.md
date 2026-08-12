# Drop-in Disposition Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Replace the Log-Drop-In disposition set with the 10-disposition outcome catalog from the screenshot (urgency tiers + follow-up intervals), switch the sheet to tap-to-auto-save-and-advance (no Save button, no contact field), and add an inline date picker for "Follow-Up Requested".

**Architecture:** Update the shared `DISPOSITIONS` catalog metadata + add a `schedulesFollowUp` helper; repoint `PATH_DISPOSITION_KEYS` to the 10 keys and make "creates a deal" == "schedules a follow-up"; rewrite `DropInSheet` to commit on tile tap (with a date-picker branch for `followup_requested`). `path_stops.disposition` is free-text → no DB migration.

**Tech Stack:** React + TS, Vitest + Testing Library, navigatr `DispositionTile`/`Input`/`Button`, `@/lib/followUpScheduling`.

---

## Conventions

- **Worktree/branch:** `feat/dropin-disposition-redesign` off `main`. Do NOT work on `main`.
- Tests: `pnpm --filter app test <path-relative-to-apps/app>` from repo root, or `cd <worktree>/apps/app && pnpm test <path>`. cwd persists between Bash calls; `pnpm install` at worktree root if node_modules missing.
- Gate: `cd apps/app && pnpm typecheck && pnpm test`. "kaboom from Bomb" stderr = expected fixture.
- Commit trailer: blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Git from the worktree root in one Bash call.
- Spec: `docs/superpowers/specs/2026-06-08-dropin-disposition-redesign-design.md` (gitignored, on disk).

## Verified current code (from recon)

- `@/lib/followUpScheduling.ts`: `Disposition` union (10 "core" keys + 9 legacy path keys); `DispositionSpec = { key, label, rationale, tier: "positive"|"neutral"|"negative"|"cool", businessDays: number|null }`; `DISPOSITIONS` record; `calculateFollowUpDate(disposition, from?=new Date()): string|null` (uses `addBusinessDays`, returns UTC-midnight ISO or null); `formatFollowUpDate`. Current 10-key specs (the ones we change):
  - `statement_secured` positive/1 · `positive_engagement` positive/3 · `connected_with_dm` positive/7 · `dm_unavailable` neutral/3 (label "Decision Maker Unavailable") · `followup_requested` neutral/null (label "Follow-up Requested") · `future_potential` **cool**/30 · `low_probability` cool/15 · `not_interested` negative/null · `wrong_number` **negative**/null (label "Wrong Number") · `closed_lost` negative/null.
- `features/path/lib/pathDispositions.ts`: `PATH_DISPOSITION_KEYS` (currently the legacy `met_dm…other` set) + `isEngagedDisposition(d)` (hardcoded `ENGAGED` set of 4). `DropInSheet` imports `isEngagedDisposition` from here.
- `DispositionTile` (`components/navigatr/DispositionTile.tsx`): props `{ tier, title, description?, selected?, dense? }`; `bandColor` maps positive→`bg-status-success`, neutral→`bg-status-warning`, negative→`bg-status-danger`, cool→`bg-text-subtle`. Default (non-dense) variant shows the colored left band + title + `description`. All 4 tiers styled.
- `DropInSheet.tsx`: state `selected/notes/contactName/saving/savingRef`; open-reset effect; `handleSave` (logVisit always; if `isEngagedDisposition && !alreadyDealCreated` → `createDeal` + `logActivity` + `markDealCreated`); tile grid uses `dense`; a Contact-name `<Input>`; footer `Cancel` + `Save`. `alreadyDealCreated` derives from the stop's `dealCreated`.
- `useCreateDeal` input: `{ companyName, address?, industry?, contactName, contactPhone, stage, probability, leadSource?, notes?, ... }`. `useLogActivity` input: `{ dealId, type, disposition, outcomeNotes?, followUpDate?: string|null }` (hook slices to DATE).
- Date input: native `<input type="date">` (navigatr `Input` forwards `type`). No custom picker. `todayISO()` exists in `features/path/lib/today.ts` (yyyy-mm-dd local).
- Other `DISPOSITIONS` consumers (will inherit the catalog change — run their tests): `features/activities/components/LogActivitySheet.tsx`, `EditActivitySheet.tsx`, `features/pipeline/pages/DealDetailPage.tsx`, `features/path/components/PathSummary.tsx`. Per the approved spec this shared update is intended (one source of truth).
- Tests: `lib/followUpScheduling.test.ts` (business-day math; "all 4 tiers exist"; engaged/terminal), `features/path/lib/pathDispositions.test.ts` (10 keys + 4 engaged), `features/path/components/DropInSheet.test.tsx` (mocks `useCreateDeal`/`useLogActivity`/`useTodayPath`/`sonner`; engaged + non-engaged + already-created + onLogged).

## File structure

- **Modify** `apps/app/src/lib/followUpScheduling.ts` (+`.test.ts`) — catalog metadata + `schedulesFollowUp`.
- **Modify** `apps/app/src/features/path/lib/pathDispositions.ts` (+`.test.ts`) — keys + `isEngagedDisposition`.
- **Modify** `apps/app/src/features/path/components/DropInSheet.tsx` (+`.test.tsx`) — tap-to-save, tiles w/ description, date picker, drop contact field + Save.

---

## Task 1: Disposition catalog + `schedulesFollowUp`

**Files:** `apps/app/src/lib/followUpScheduling.ts` (+ `followUpScheduling.test.ts`).

- [ ] **Step 1: Write/extend the failing test.** In `followUpScheduling.test.ts` add:
```ts
import { DISPOSITIONS, schedulesFollowUp, type Disposition } from "./followUpScheduling";

describe("disposition catalog (drop-in redesign)", () => {
  it("has the redesigned metadata for the 10 outcome dispositions", () => {
    expect(DISPOSITIONS.dm_unavailable.label).toBe("DM Unavailable");
    expect(DISPOSITIONS.followup_requested.label).toBe("Follow-Up Requested");
    expect(DISPOSITIONS.wrong_number.label).toBe("Wrong Person");
    expect(DISPOSITIONS.wrong_number.tier).toBe("cool");
    expect(DISPOSITIONS.future_potential.tier).toBe("neutral");
    expect(DISPOSITIONS.statement_secured.rationale).toBe("Highest urgency. 1 day.");
    expect(DISPOSITIONS.connected_with_dm.rationale).toBe("Relationship. 7 days.");
  });

  it("schedulesFollowUp is true for the 7 with a follow-up, false for the 3 terminal", () => {
    const yes: Disposition[] = ["statement_secured","positive_engagement","connected_with_dm","dm_unavailable","followup_requested","future_potential","low_probability"];
    const no: Disposition[] = ["wrong_number","not_interested","closed_lost"];
    for (const d of yes) expect(schedulesFollowUp(d)).toBe(true);
    for (const d of no) expect(schedulesFollowUp(d)).toBe(false);
  });
});
```
Run `pnpm --filter app test src/lib/followUpScheduling.test.ts` → FAIL (`schedulesFollowUp` undefined + label/tier mismatches).

- [ ] **Step 2: Update the 10 `DISPOSITIONS` entries** to exactly these field values (leave the 9 legacy path entries `met_dm…other` untouched; keep each entry's existing shape, only change the listed fields):
```
statement_secured:   label "Statement Secured",   rationale "Highest urgency. 1 day.", tier "positive", businessDays 1
positive_engagement: label "Positive Engagement", rationale "Warm. 3 days.",          tier "positive", businessDays 3
connected_with_dm:   label "Connected with DM",   rationale "Relationship. 7 days.",   tier "positive", businessDays 7
dm_unavailable:      label "DM Unavailable",      rationale "Retry. 3 days.",          tier "neutral",  businessDays 3
followup_requested:  label "Follow-Up Requested", rationale "Custom date.",            tier "neutral",  businessDays null
future_potential:    label "Future Potential",    rationale "Long cycle. 30 days.",    tier "neutral",  businessDays 30
low_probability:     label "Low Probability",     rationale "Cool. 15 days.",          tier "cool",     businessDays 15
wrong_number:        label "Wrong Person",         rationale "No follow-up.",           tier "cool",     businessDays null
not_interested:      label "Not Interested",      rationale "No follow-up.",           tier "negative", businessDays null
closed_lost:         label "Closed Lost",         rationale "No follow-up.",           tier "negative", businessDays null
```
(Net changes vs current: `dm_unavailable.label`, `followup_requested.label`, `future_potential.tier` cool→neutral, `wrong_number.label`+`tier` negative→cool, and all 10 rationales. businessDays already match.)

- [ ] **Step 3: Add the helper** (after `calculateFollowUpDate`):
```ts
/** True when this disposition schedules a follow-up (and thus creates a deal):
 *  any interval disposition, plus followup_requested whose date is rep-picked. */
export function schedulesFollowUp(d: Disposition): boolean {
  return DISPOSITIONS[d].businessDays != null || d === "followup_requested";
}
```

- [ ] **Step 4: Run → PASS.** Then run the FULL existing `followUpScheduling.test.ts`; if any assertion referenced the old `future_potential`/`wrong_number` tier or an old label/rationale, update it to the new values (business-day math is unchanged). `pnpm --filter app test src/lib/followUpScheduling.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/lib/followUpScheduling.ts apps/app/src/lib/followUpScheduling.test.ts
git commit -m "$(printf 'feat(dispositions): redesign the 10 outcome dispositions + schedulesFollowUp\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Repoint `PATH_DISPOSITION_KEYS` + deal rule

**Files:** `apps/app/src/features/path/lib/pathDispositions.ts` (+ `pathDispositions.test.ts`).

- [ ] **Step 1: Rewrite the test** `pathDispositions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "./pathDispositions";

describe("path dispositions", () => {
  it("lists the 10 redesigned dispositions in screenshot order", () => {
    expect(PATH_DISPOSITION_KEYS).toEqual([
      "statement_secured","positive_engagement","connected_with_dm",
      "dm_unavailable","followup_requested","future_potential",
      "low_probability","wrong_number","not_interested","closed_lost",
    ]);
  });
  it("treats any disposition that schedules a follow-up as engaged (creates a deal)", () => {
    for (const d of ["statement_secured","positive_engagement","connected_with_dm","dm_unavailable","followup_requested","future_potential","low_probability"] as const) {
      expect(isEngagedDisposition(d)).toBe(true);
    }
    for (const d of ["wrong_number","not_interested","closed_lost"] as const) {
      expect(isEngagedDisposition(d)).toBe(false);
    }
  });
});
```
Run → FAIL.

- [ ] **Step 2: Rewrite `pathDispositions.ts`**
```ts
import { schedulesFollowUp, type Disposition } from "@/lib/followUpScheduling";

/** Display order for the drop-in tile grid (matches the field-rep screenshot). */
export const PATH_DISPOSITION_KEYS: Disposition[] = [
  "statement_secured",
  "positive_engagement",
  "connected_with_dm",
  "dm_unavailable",
  "followup_requested",
  "future_potential",
  "low_probability",
  "wrong_number",
  "not_interested",
  "closed_lost",
];

/** True when this outcome should create a Pipeline deal + scheduled follow-up.
 *  Rule: any disposition that schedules a follow-up. (Kept under the original
 *  name so DropInSheet's import is unchanged.) */
export function isEngagedDisposition(d: Disposition): boolean {
  return schedulesFollowUp(d);
}
```
(`met_dm…other` stay valid in the `Disposition` union/catalog; they're just no longer in the picker.)

- [ ] **Step 3: Run → PASS.** Then `cd apps/app && pnpm typecheck`.

- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/lib/pathDispositions.ts apps/app/src/features/path/lib/pathDispositions.test.ts
git commit -m "$(printf 'feat(path): drop-in uses the 10 outcome dispositions; deal=schedules-follow-up\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: DropInSheet — tap-to-save, sub-label tiles, date picker, no contact/Save

**Files:** `apps/app/src/features/path/components/DropInSheet.tsx` (+ `DropInSheet.test.tsx`).

- [ ] **Step 1: Rewrite the test** `DropInSheet.test.tsx`. Keep the existing mock setup style (mock `../hooks/useCreateDeal`, `../hooks/useLogActivity`, `../hooks/useTodayPath`, `sonner`). READ the current test first to reuse its mock scaffolding (the `createDeal`/`logActivity`/`logVisit`/`markDealCreated` spies, the `useTodayPath` `stops`/`has` shape, a `merchant` fixture). New assertions:
```tsx
// merchant fixture: { id:"m1", name:"Bluewater", address:"1 A St", category:"food_beverage", phone:"+15125550100", ... }
it("renders the 10 redesigned tiles with their sub-labels", () => {
  renderSheet();
  expect(screen.getByText("Statement Secured")).toBeInTheDocument();
  expect(screen.getByText("Highest urgency. 1 day.")).toBeInTheDocument();
  expect(screen.getByText("Wrong Person")).toBeInTheDocument();
  // interaction-change guards:
  expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
});

it("tapping a follow-up disposition commits immediately: logVisit + deal + activity + advance", async () => {
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
  expect(logVisit).toHaveBeenCalledWith("m1", "statement_secured");
  expect(createDeal).toHaveBeenCalledWith(expect.objectContaining({ contactName: "Bluewater", leadSource: "path_dropin" }));
  expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "drop_in", disposition: "statement_secured", followUpDate: expect.any(String) }));
  expect(markDealCreated).toHaveBeenCalledWith("m1");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("tapping a terminal disposition logs the visit only, no deal", async () => {
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Not Interested")); });
  expect(logVisit).toHaveBeenCalledWith("m1", "not_interested");
  expect(createDeal).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("Follow-Up Requested reveals a date picker and does NOT commit until confirmed", async () => {
  renderSheet();
  fireEvent.click(screen.getByText("Follow-Up Requested"));
  expect(logVisit).not.toHaveBeenCalled();               // no immediate commit
  const dateInput = screen.getByLabelText(/follow-up date/i);
  fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /set follow-up/i })); });
  expect(logVisit).toHaveBeenCalledWith("m1", "followup_requested");
  expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
    disposition: "followup_requested",
    followUpDate: expect.stringContaining("2026-06-20"),
  }));
});
```
Run → FAIL.

- [ ] **Step 2: Rewrite `DropInSheet.tsx`.** Apply these changes to the current file:
  - Imports: add `schedulesFollowUp` + `calculateFollowUpDate` from `@/lib/followUpScheduling` (keep `DISPOSITIONS`); keep `isEngagedDisposition` import OR switch to `schedulesFollowUp` directly (use `schedulesFollowUp` in `commit`); import `todayISO` from `../lib/today`. Remove the `Input` import only if the contact field was its sole use — it's reused for the date input, so KEEP `Input`.
  - State: remove `contactName`. Add `const [customDate, setCustomDate] = React.useState("");`.
  - Open-reset effect: drop the `setContactName("")` line; add `setCustomDate(plusDaysISODate(7));` (see helper below).
  - Add module-scope helpers (top of file):
```ts
function plusDaysISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
```
  - Replace `handleSave` with `commit(disposition, customDateStr?)` + `handleSelect`:
```ts
  const commit = async (disposition: Disposition, customDateStr?: string) => {
    if (!merchant || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
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
          dealId, type: "drop_in", disposition,
          outcomeNotes: notes.trim(), followUpDate,
        });
        await markDealCreated(merchant.id);
        toast.success(`Deal created for ${merchant.name}`);
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

  const handleSelect = (key: Disposition) => {
    if (key === "followup_requested") {
      setSelected(key); // reveal the date picker; commit on confirm
    } else {
      void commit(key);
    }
  };
```
  - Tile grid: drop `dense`, add `description`, point `onClick` at `handleSelect`:
```tsx
            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={DISPOSITIONS[key].label}
                  description={DISPOSITIONS[key].rationale}
                  selected={selected === key}
                  onClick={() => handleSelect(key)}
                />
              ))}
            </div>
```
  - REMOVE the Contact-name `<label>…<Input/></label>` block entirely.
  - After the tile grid (before/after the notes field), add the conditional date picker:
```tsx
            {selected === "followup_requested" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Follow-up date</span>
                <Input
                  type="date"
                  value={customDate}
                  min={todayISO()}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
                <Button
                  variant="primary"
                  className="mt-1 self-start"
                  disabled={!customDate || saving}
                  loading={saving}
                  onClick={() => void commit("followup_requested", customDate)}
                >
                  Set follow-up & next
                </Button>
              </label>
            )}
```
  - Keep `NotesFieldWithMic`.
  - Footer: REMOVE the `Save` `<Button>`; keep only Cancel:
```tsx
          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
          </div>
```
  - (Optional, matches screenshot) under the Dialog.Title add a one-line caption: `<p className="text-caption text-text-muted">Tap an outcome — auto-saves and advances to the next stop.</p>`.

- [ ] **Step 3: Run → PASS.** `pnpm --filter app test src/features/path/components/DropInSheet.test.tsx`. Then `cd apps/app && pnpm typecheck`.

- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/components/DropInSheet.tsx apps/app/src/features/path/components/DropInSheet.test.tsx
git commit -m "$(printf 'feat(path): drop-in taps to auto-save; new tiles + inline follow-up date\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Ship

- [ ] **Step 1: Full gate** — `cd apps/app && pnpm typecheck && pnpm test`. The catalog change is shared, so the **activities** sheets (`LogActivitySheet`/`EditActivitySheet`) and `PathSummary`/`DealDetailPage` see the new labels/tiers. If any of their tests assert an old label (e.g. "Decision Maker Unavailable", "Wrong Number") or `future_potential`/`wrong_number` tier/color, update those assertions to the new values (this is the intended single-source-of-truth change). All green before proceeding.
- [ ] **Step 2: Manual smoke (after merge+push; hard-refresh for SW).** Open a path → running mode → Log drop-in: 10 new tiles with sub-labels + 4 colors; tap "Statement Secured" → saves + advances + a deal appears in Pipeline with a 1-business-day follow-up; tap "Not Interested" → advances, no deal; tap "Follow-Up Requested" → date picker (default +7) → "Set follow-up & next" → saves with that date; no Save button, no Contact-name field.
- [ ] **Step 3: Finish the branch** (superpowers:finishing-a-development-branch → merge + push).

---

## Self-Review

**Spec coverage:** 10-disposition catalog w/ labels/sub-labels/tiers/intervals → Task 1 ✅. Deal = schedules-follow-up → Task 1 (`schedulesFollowUp`) + Task 2 (`isEngagedDisposition`) ✅. Tap-to-auto-save + advance, no Save button → Task 3 ✅. Inline date picker for `followup_requested` → Task 3 ✅. Tiles show sub-labels (default variant) → Task 3 ✅. Drop contact field (`contactName: merchant.name`) → Task 3 ✅. Shared-catalog impact on pipeline/activities handled → Task 4 ✅. Legacy keys retained → Task 1/2 (untouched) ✅. No DB migration (free-text) ✅.

**Placeholder scan:** None — every step has concrete code/values. Task 1's catalog edits are given as exact target field values per key.

**Type consistency:** `schedulesFollowUp(d: Disposition): boolean` defined in Task 1, used in Task 2 (`isEngagedDisposition`) and Task 3 (`commit`). `isEngagedDisposition` kept as the name DropInSheet imports (Task 3 uses `schedulesFollowUp` directly in `commit`, so the import is optional — Task 3 imports `schedulesFollowUp`). `commit(disposition, customDateStr?)` signature consistent between definition and both call sites (`handleSelect` → `commit(key)`, date button → `commit("followup_requested", customDate)`). `createDeal`/`logActivity` field names match the verified mutation inputs. `todayISO` from `../lib/today`.
