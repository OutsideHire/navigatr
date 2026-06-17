# Explicit-commit Log drop-in sheet (2026-06-17)

## Problem

The Log drop-in sheet (`DropInSheet`) currently **auto-saves on tile tap**: tapping a
disposition immediately commits the visit, creates the deal (for follow-up outcomes),
and advances to the next stop. There is no review step. Two problems:

1. A mis-tap logs the wrong outcome and advances before the rep can correct it.
2. Reps can't compose a note *and then* choose the outcome — the tap fires first.

Separately, the **voice note** (Phase 1, audio-only) shipped but isn't ready for field
use; it should read as "coming soon" rather than appear live.

This reworks the sheet to an **explicit-commit** model: pick an outcome, optionally add a
note, then tap **Log Stop** to commit. The voice note becomes a disabled placeholder.

## Decisions (locked in brainstorming)

- **Tile tap selects only.** Tapping a disposition highlights it (`selected`); it does not
  commit and does not advance. Re-tapping the same tile keeps it selected (no deselect, to
  avoid an empty-outcome footgun).
- **New `Log Stop` footer button** commits. Disabled until a disposition is selected; for
  Follow-Up Requested, also disabled until a date is set.
- **After Log Stop: close + advance** to the next pending stop — identical downstream
  behavior to today (`logVisit`, deal/activity creation for follow-up outcomes, `onLogged`).
  Only the *trigger* changes (button instead of tile tap).
- **Follow-Up Requested folds into Log Stop.** Selecting it still reveals the inline date
  picker (default +7, min = today), but its separate "Set follow-up & next" button is
  removed. The single footer Log Stop button commits with the chosen date.
- **Voice note → disabled "Coming soon" placeholder.** Keep `useVoiceRecorder`,
  `VoiceNoteRecorder`, and `uploadVoiceNote` in the repo untouched; just don't render/wire
  them here. Remove all voice-note logic from this sheet's `commit()`. Phase 2 re-wires.
- **Header copy** changes from "Tap an outcome — auto-saves and advances to the next stop."
  to "Pick an outcome, add a note, then log the stop."

## Architecture

Single file: `apps/app/src/features/path/components/DropInSheet.tsx`. No new components,
hooks, or mutations. No data-model change. The sheet's internal interaction model changes;
its props (`merchant`, `open`, `onOpenChange`, `onLogged`) are unchanged.

### A. Tile tap → select only

`handleSelect(key)` becomes:

```ts
const handleSelect = (key: Disposition) => setSelected(key);
```

The previous `if (key !== "followup_requested") void commit(key)` branch is deleted.

### B. `commit()` loses all voice-note logic

`commit(disposition, customDateStr?)` keeps its structure (savingRef guard → `logVisit` →
follow-up branch creates deal + logs activity → else toast → `onLogged` → close), with the
voice-note pieces removed:

- Delete `hasRecording`, the `window.confirm` discard dialog, the `uploadVoiceNote` call,
  and the `voiceNoteUrl` local.
- `logActivity.mutateAsync({ ..., voiceNoteUrl: null })`.

The `recorder = useVoiceRecorder()` line and `recorder.reset()` in the open effect are
removed (the hook is no longer used in this file).

### C. Voice note placeholder

Replace the `<VoiceNoteRecorder .../>` render with a static, non-interactive block styled to
match the existing recorder shell: a label "Voice note", a disabled button "Record a voice
note" (mic icon, `disabled`, muted styling, `aria-disabled`), and a "Coming soon" caption/
badge. No state, no handlers.

### D. Follow-Up date picker

Keep the `selected === "followup_requested"` block that renders the date `Input` (default
`customDate = plusDaysISODate(7)`, `min={todayISO()}`). **Remove** the inline
"Set follow-up & next" `Button` inside it — the footer Log Stop button now commits.

### E. Footer

```tsx
<div className="flex gap-2 pt-4">
  <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
    Cancel
  </Button>
  <Button
    variant="primary"
    className="flex-1"
    disabled={!selected || (selected === "followup_requested" && !customDate) || saving}
    loading={saving}
    onClick={() => selected && void commit(selected, selected === "followup_requested" ? customDate : undefined)}
  >
    Log Stop
  </Button>
</div>
```

## Data flow

Pick tile → `setSelected`. (If Follow-Up Requested → date picker appears.) Optionally type a
note. Tap **Log Stop** → `commit(selected, date?)` → `logVisit` always; for follow-up
outcomes create deal + log `drop_in` activity (`voiceNoteUrl: null`) + `markDealCreated`;
else success toast → `onLogged(disposition)` → `onOpenChange(false)`. Running mode advances
to the next pending stop on `onLogged`, exactly as today.

## Error handling / edge cases

- **No disposition selected** → Log Stop disabled; no commit possible.
- **Follow-Up Requested, no date** → Log Stop disabled until a date is chosen.
- **Double-submit** → existing `savingRef` synchronous guard + `saving`-disabled button.
- **Deal/activity partial failure** → unchanged: visit is saved, `dealCreated` stays false,
  toast warns; summary won't over-count.
- **Cancel / close** → no commit; form resets on next open (existing open effect, minus the
  `recorder.reset()` line).
- **Voice placeholder** → inert; cannot record, cannot focus-trap, no submit impact.

## Testing

Update `DropInSheet.test.tsx`:

- Tapping a disposition tile selects it but does **not** call `logVisit`/`createDeal` and
  does **not** call `onLogged` (no auto-commit).
- Log Stop is disabled with no selection; enabled after selecting a terminal disposition.
- Selecting a terminal disposition + Log Stop → `logVisit` called, no deal, `onLogged` +
  close fire.
- Selecting a follow-up disposition + Log Stop → `createDeal` + `logActivity` called with
  `voiceNoteUrl: null`, `onLogged` fires.
- Follow-Up Requested: Log Stop disabled until a date is present; committing passes the
  chosen date through to the follow-up date.
- The "Coming soon" voice placeholder renders and its button is disabled.
- Remove/replace tests asserting tap-to-auto-save or the "Set follow-up & next" button.

## Out of scope

Voice note Phase 2 (re-wiring the placeholder); transcription; the Take-photo feature;
changing disposition tiles/tiers/intervals; deal-creation rules; the End-route flow.
