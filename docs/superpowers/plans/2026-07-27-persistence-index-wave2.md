# Persistence Index Wave 2 (Appointment Outcomes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Give appointments an outcome-capture step (nine outcomes) that logs a touch, sets a follow-up, and advances the stage for two outcomes, plus a rep nudge and a manager awaiting-outcome count. Add a `submitted` deal stage.

**Design authority:** `docs/superpowers/specs/2026-07-27-persistence-index-wave2-appointment-outcomes-design.md` and PRD Addendum 3.3.B section 3.3.B.12.

**Tech Stack:** Supabase (SQL editor migrations), React + TS, vitest.

---

### Task W2a-1: Add the `submitted` deal stage (enum + all stage-aware surfaces)

**Files:**
- Create: `supabase/migrations/20260727000020_deal_stage_submitted.sql`
- Modify: `apps/app/src/features/pipeline/mockData.ts` (+ its test)
- Modify: `apps/app/src/features/pipeline/components/KanbanBoard.tsx`
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`
- Modify: the design-system Badge kinds if a `stage-submitted` BadgeKind is needed
- Audit: `EditDealSheet.tsx`, `AddDealSheet.tsx`, `PipelinePage.tsx`, `team_leaderboard` RPC, unified activity report, funnel

- [ ] **Step 1: Migration.** `supabase/migrations/20260727000020_deal_stage_submitted.sql`:
```sql
-- 20260727000020_deal_stage_submitted.sql
-- Adds a 'submitted' deal stage between 'proposal' and 'won' for the appointment
-- outcome "Application signed" (addendum 3.3.B.12). Idempotent. Postgres places
-- new enum values via BEFORE; ordering only matters for enum sort, not the app
-- (the app orders stages explicitly via STAGE_ORDER / STAGES arrays).
alter type deal_stage add value if not exists 'submitted' before 'won';
```
NOTE: `alter type ... add value` cannot run inside a transaction block in some clients; run this migration on its own (do not bundle other statements). If `before 'won'` is rejected by the target Postgres, fall back to `add value if not exists 'submitted'` (appended) since the app controls display order.

- [ ] **Step 2: Failing tests + client plumbing.** In `mockData.ts`:
  - Add `"submitted"` to the `DealStage` union (after `"proposal"`).
  - Add a `submitted` entry to EVERY `Record<DealStage, ...>` map: `STAGE_DEFAULT_PROBABILITY` (use 85), `STAGE_BADGE_KIND`, `STAGE_BAND_COLOR`, `STAGE_TONE`, `STAGE_LABEL` ("Submitted"), `STAGE_NEXT_VERB` ("Follow up"), `STAGE_CHIP_COUNTS`. Give it a distinct-but-existing color token (reuse proposal's violet family or the closest existing token; do not invent a new design token). If `STAGE_BADGE_KIND` needs a `"stage-submitted"` value, add that BadgeKind to the Badge component's kind union + styles, mirroring `stage-proposal`.
  - Grep the file for any other `Record<DealStage,` or stage-exhaustive switch and add `submitted`.
  Update `mockData`'s test if it asserts the maps' completeness. Write a test asserting `STAGE_LABEL.submitted === "Submitted"` and that every stage map has a `submitted` key.

- [ ] **Step 3: Stage-order arrays.** Add `"submitted"` between `"proposal"` and `"won"` in:
  - `KanbanBoard.tsx:23` `STAGES`
  - `DealDetailPage.tsx:442` `STAGE_ORDER`
  Confirm the Kanban board renders a Submitted column and the deal-detail stage stepper includes it.

- [ ] **Step 4: Audit the other referencers.** Check `EditDealSheet.tsx`, `AddDealSheet.tsx` (stage dropdowns; if they map over `STAGE_LABEL`/a list they pick it up automatically, else add), `PipelinePage.tsx` (`countByStage`/chips), and any report that enumerates stages. Add `submitted` wherever a stage list is hardcoded. Run typecheck to catch any non-exhaustive `Record<DealStage,...>`.

- [ ] **Step 5: DB report audit.** Read `team_leaderboard` (in `20260524000002_deal_stage_lost.sql`) and any RPC/report that references specific stages; the `submitted` value is additive (an open, non-won, non-lost stage) so most `stage = 'won'`/`stage = 'lost'` predicates are unaffected. Note in the migration header if any RPC needs a follow-up (do NOT rewrite RPCs unless a predicate would misclassify submitted; it should count as an open deal, which the default does).

- [ ] **Step 6: Run + PASS**: `pnpm --filter app test` + `pnpm --filter app typecheck` (typecheck will flag any missed `Record<DealStage,...>`).

- [ ] **Step 7: Commit**
```bash
git add -f supabase/migrations/20260727000020_deal_stage_submitted.sql
git add apps/app/src/features/pipeline apps/app/src/components/navigatr
git commit -m "feat(pipeline): add 'submitted' deal stage (enum + all stage-aware surfaces)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task W2a-2: Nine appointment outcomes + appointment disposition set

**Files:**
- Modify: `apps/app/src/lib/followUpScheduling.ts` (+ test)
- Modify: `apps/app/src/features/activities/lib/dispositionSets.ts` (or wherever `DISPOSITIONS_BY_TYPE` lives) (+ test)

- [ ] **Step 1: Read** `followUpScheduling.ts` (the `Disposition` union, `DISPOSITIONS` map, `calculateFollowUpDate`, `schedulesFollowUp`) and `DISPOSITIONS_BY_TYPE`.

- [ ] **Step 2: Failing tests.** Assert each new outcome's `businessDays`, that `schedulesFollowUp` is true for the scheduling ones and false for `appt_not_interested`, and that `DISPOSITIONS_BY_TYPE.appointment` has the 5 primary + 4 secondary keys in order.

- [ ] **Step 3: Implement.** Add nine `Disposition` keys (prefix `appt_` to avoid colliding with existing call/drop-in dispositions) to the union + `DISPOSITIONS` with `businessDays` and a label:
  - `appt_presented_awaiting` 3, `appt_statements_collected` 1, `appt_verbal_commitment` 1, `appt_no_show` 2, `appt_rescheduled` (see note), `appt_application_signed` 2, `appt_dm_unavailable` 2, `appt_cancelled_by_merchant` 3, `appt_not_interested` null.
  - `appt_rescheduled`: give it `businessDays: 2` as the DEFAULT (the "no future appointment" fallback). The conditional zero-when-a-future-appointment-exists is applied at capture time in W2b-2 (the capture path overrides to no follow-up when a future appointment exists), not in the static map. Document this in a comment.
  - Give `DISPOSITIONS_BY_TYPE.appointment` its own `{ primary: [...5], all: [...9] }` lists in the spec's order (primary: presented_awaiting, statements_collected, verbal_commitment, no_show, rescheduled; secondary appended: application_signed, dm_unavailable, cancelled_by_merchant, not_interested).
  - Export a helper describing the stage effect per outcome, e.g. `APPOINTMENT_STAGE_EFFECT: Partial<Record<Disposition, DealStage>>` = `{ appt_verbal_commitment: "proposal", appt_application_signed: "submitted" }`, plus a marker for `appt_not_interested` being terminal. (Used by W2b-2.)

- [ ] **Step 4: Run + PASS** (`pnpm --filter app test -- followUpScheduling dispositionSets`), typecheck.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/lib/followUpScheduling.ts apps/app/src/features/activities/lib/dispositionSets.ts apps/app/src/lib/followUpScheduling.test.ts apps/app/src/features/activities/lib/dispositionSets.test.ts
git commit -m "feat(appointments): nine appointment outcomes + follow-up intervals + stage-effect map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task W2b-1: scheduled_appointments outcome columns migration

**Files:**
- Create: `supabase/migrations/20260727000021_appointment_outcomes.sql`

- [ ] **Step 1: Migration.**
```sql
-- 20260727000021_appointment_outcomes.sql
-- Appointment outcome capture (addendum 3.3.B.12): record which of the nine
-- outcomes a rep logged for a scheduled appointment, the note, and when. Marking
-- an outcome also flips status to 'completed' (the first writer of that value).
alter table scheduled_appointments add column if not exists outcome text;
alter table scheduled_appointments add column if not exists outcome_notes text;
alter table scheduled_appointments add column if not exists outcome_at timestamptz;
alter table scheduled_appointments drop constraint if exists scheduled_appointments_outcome_check;
alter table scheduled_appointments add constraint scheduled_appointments_outcome_check
  check (outcome is null or outcome in (
    'appt_presented_awaiting','appt_statements_collected','appt_verbal_commitment',
    'appt_no_show','appt_rescheduled','appt_application_signed','appt_dm_unavailable',
    'appt_cancelled_by_merchant','appt_not_interested'
  ));
create index if not exists scheduled_appointments_awaiting_idx
  on scheduled_appointments (owner_id, end_at)
  where status = 'scheduled' and outcome is null;
```

- [ ] **Step 2: Commit**
```bash
git add -f supabase/migrations/20260727000021_appointment_outcomes.sql
git commit -m "feat(appointments): outcome columns + awaiting-outcome index on scheduled_appointments

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task W2b-2: Appointment-outcome capture flow

**Files:**
- Create: `apps/app/src/features/appointments/hooks/useRecordAppointmentOutcome.ts` (+ test)
- Create: `apps/app/src/features/appointments/components/AppointmentOutcomeSheet.tsx` (+ test)
- Reference: `DropInSheet.tsx` (orchestration pattern), `useLogActivity`, `useUpdateDeal`, `useFollowupSync`, `calculateFollowUpDate`, `APPOINTMENT_STAGE_EFFECT`, `useCancelAppointment` (the appointment-mutation hook pattern)

- [ ] **Step 1: `useRecordAppointmentOutcome` hook** (mutation). Input `{ appointmentId, dealId, outcome, notes, hasFutureAppointment }`. Steps:
  1. followUpDate = for `appt_rescheduled` with `hasFutureAppointment` true -> null (no follow-up); else `calculateFollowUpDate(outcome)`.
  2. Insert an `activities` row via the same path `useLogActivity` uses: `{ dealId, type: 'appointment', disposition: outcome, outcomeNotes: notes, followUpDate, voiceNoteUrl: null }`.
  3. Update `scheduled_appointments`: `outcome`, `outcome_notes = notes`, `outcome_at = now()`, `status = 'completed'` (by appointmentId).
  4. Stage effect: if `APPOINTMENT_STAGE_EFFECT[outcome]` is set, `useUpdateDeal` to that stage BUT only advance forward (never downgrade; never to `won`). For `appt_not_interested` with the do-not-contact control on, set stage `lost`.
  5. Fire-and-forget `syncFollowup(dealId)`.
  Invalidate the appointments + deals + activities queries. Write tests mocking supabase mirroring `useCancelAppointment`/`useLogActivity` test style: asserts the activity insert payload, the appointment update payload (outcome + status completed), and the stage update for verbal/application-signed and not-interested+DNC.

- [ ] **Step 2: `AppointmentOutcomeSheet` component.** A Radix Dialog mirroring `DropInSheet`: shows the 9 outcomes (5 primary one-tap + "More" revealing 4 secondary) from `DISPOSITIONS_BY_TYPE.appointment`, a notes field (reuse `NotesFieldWithMic`), and for `appt_not_interested` a "do not contact" checkbox. On submit calls `useRecordAppointmentOutcome`. Non-blocking (dismissable). Tests: renders primary tiles, reveals secondary via More, submitting an outcome calls the hook with the right args, the DNC checkbox only shows for Not-interested.

- [ ] **Step 3: Run + PASS** (`pnpm --filter app test -- useRecordAppointmentOutcome AppointmentOutcomeSheet`), typecheck.

- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/appointments
git commit -m "feat(appointments): record-outcome hook + capture sheet (touch + follow-up + stage effect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task W2c: Pending-outcome nudge on the Activities page

**Files:**
- Create: `apps/app/src/features/appointments/lib/awaitingOutcome.ts` (+ test) - pure matcher
- Create: `apps/app/src/features/appointments/hooks/useAppointmentsAwaitingOutcome.ts` (+ test)
- Create: `apps/app/src/features/appointments/components/AppointmentsAwaitingOutcome.tsx` (+ test)
- Modify: `apps/app/src/features/activities/pages/ActivitiesPage.tsx` (render the card near `UnloggedCallsSection`)
- Reference: `computeUnloggedDials` / `useUnloggedDials` / `UnloggedCallsSection` (mirror exactly)

- [ ] **Step 1: Pure matcher** `computeAwaitingOutcome(appointments, now)`: return appointments where `end_at < now`, `status === 'scheduled'`, `outcome == null`, sorted by `end_at` asc. Tests: past-with-no-outcome included; future excluded; cancelled/completed excluded; outcome-set excluded.

- [ ] **Step 2: Hook** `useAppointmentsAwaitingOutcome`: query the rep's own `scheduled_appointments` (RLS-scoped) needing `id, deal_id, title, start_at, end_at, status, outcome`, run the matcher with `now`, join deal/company names (mirror how `useUnloggedDials` joins). Errors -> empty.

- [ ] **Step 3: Card** `AppointmentsAwaitingOutcome`: renders nothing when empty (mirror `UnloggedCallsSection`); else a `Card` listing each with a "Log outcome" button opening `AppointmentOutcomeSheet` for that appointment (pass appointmentId, dealId, and whether a future appointment exists on the deal for the Rescheduled conditional). Tests: empty -> nothing; populated -> list + button opens sheet.

- [ ] **Step 4: Wire into `ActivitiesPage`** next to `UnloggedCallsSection`.

- [ ] **Step 5: Run + PASS** + typecheck.

- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/appointments apps/app/src/features/activities/pages/ActivitiesPage.tsx
git commit -m "feat(appointments): pending-outcome nudge card on the activities page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task W2d: Manager awaiting-outcome count

**Files:**
- Create: `supabase/migrations/20260727000022_appointments_awaiting_rollup.sql` (a `security definer` RPC counting awaiting-outcome appointments per visible rep, mirroring `coverage_rollup`)
- Create: `apps/app/src/features/appointments/hooks/useAppointmentsAwaitingRollup.ts` (+ test)
- Create/Modify: a small manager card (mirror `TeamCoverageCard`) or add to an existing team surface; render on the manager team/agents page.
- Reference: `20260625000001_coverage_rollup.sql`, `useCoverageRollup.ts`, `TeamCoverageCard.tsx`

- [ ] **Step 1: RPC** `appointments_awaiting_rollup()`: `security definer`, checks `user_role() in ('manager','admin')` (fail closed), returns per visible rep (`user_can_see_owner`) a count of `scheduled_appointments` with `end_at < now()`, `status = 'scheduled'`, `outcome is null`, scoped `org_id = user_org_id()`. Mirror `coverage_rollup`'s authz.

- [ ] **Step 2: Hook + card.** `useAppointmentsAwaitingRollup` (rpc read, errors -> empty). A card listing reps with a nonzero awaiting count (or a single total). Manager/admin only. Tests for the hook mapping + the card render.

- [ ] **Step 3: Commit** (migration force-added; hook/card/tests).

---

### Task W2e: Full suite + typecheck + push + deploy handoff

- [ ] `pnpm --filter app test` green; `pnpm --filter app typecheck` clean.
- [ ] `git push origin HEAD:main`.
- [ ] Deploy handoff to the user: run the three migrations in the SQL editor in order (`20260727000020` submitted stage [run alone, ALTER TYPE], `20260727000021` outcome columns, `20260727000022` awaiting rollup RPC). No edge-function change. Note the `submitted` stage appears in the pipeline board + deal stage stepper immediately after deploy.

---

## Self-review checklist (controller, before dispatch)
- `submitted` added to EVERY `Record<DealStage,...>` (typecheck enforces exhaustiveness) + the two stage-order arrays + Badge kind. ✓
- Appointment outcome keys are consistent across: `DISPOSITIONS`/`DISPOSITIONS_BY_TYPE` (W2a-2), the migration check constraint (W2b-1), and `APPOINTMENT_STAGE_EFFECT` (W2a-2). Cross-check the nine keys match exactly. ✓
- `appt_rescheduled` static interval is 2; the zero-when-future-appointment override is applied in the capture hook (W2b-2), not the static map. ✓
- Stage effect never sets `won`; only advances forward. ✓
- Nudge mirrors the unlogged-calls pattern; matcher is pure + tested. ✓
