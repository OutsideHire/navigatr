# Persistence Index Wave 2: Appointment Outcome Capture (Design Spec)

**Date:** 2026-07-27
**Status:** Approved (addendum is design authority; proceeding to plan + build)
**Design authority:** PRD Addendum 3.3.B section 3.3.B.12 (`~/Downloads/navigatr-persistence-index-addendum.pdf`). Grounded against the codebase investigation in this session.

---

## 1. Goal

Give appointments an outcome-capture step so they generate follow-up obligations and touches, closing the gap where appointment-heavy reps under-generate Follow-Up Discipline volume (addendum's highest-priority decision, D-01). When a scheduled appointment's end time passes, a non-blocking nudge lets the rep record one of nine outcomes; that records the outcome, marks the appointment complete, logs an appointment activity (a touch), sets a follow-up date, and for two outcomes advances the deal stage.

## 2. Locked decisions

- **Stage advancement (user, 2026-07-27): add a new `submitted` deal stage.** Application signed advances the deal to `submitted`; Verbal commitment advances to `proposal`. Neither sets `won` (closed-won stays a separate action). New stage order: new, contacted, qualified, proposal, **submitted**, won, lost.
- **Appointment type ordering (§2.7): DEFERRED.** We do not store an appointment type (In person / Callback / Signing) today, and it only affects button ordering. Beta uses a fixed primary-row order; the type field + type-based ordering is a later enhancement.
- **Nudge location:** the Activities page, alongside the existing unlogged-calls nudge (same pattern, same place reps already look).
- **Talk to Text:** reuse the existing `NotesFieldWithMic` UI affordance (already in the log-activity modal). Actual speech-to-text wiring remains out of scope (unbuilt everywhere).

## 3. Outcome set (nine, closed)

Extend `apps/app/src/lib/followUpScheduling.ts` `DISPOSITIONS` with nine appointment outcomes and give `DISPOSITIONS_BY_TYPE.appointment` its own primary/all lists. Intervals in business days:

| Outcome | Tier | Follow-up | Stage effect |
|---|---|---|---|
| Presented awaiting decision | primary | 3 | none |
| Statements collected | primary | 1 | none |
| Verbal commitment | primary | 1 | advance to `proposal` |
| No show | primary | 2 | none |
| Rescheduled on the spot | primary | conditional (0 if a future appointment exists on the deal, else 2) | none |
| Application signed | secondary | 2 | advance to `submitted` |
| Decision maker not available | secondary | 2 | none |
| Cancelled by merchant | secondary | 3 | none |
| Not interested | secondary | none (terminal) | optional "do not contact" control |

No "Other" outcome; the set is closed. "Do not contact" is a control inside the Not-interested capture, not a tenth outcome (§2.3.2). For beta, the do-not-contact control sets the deal to `lost` (mirrors the call `do_not_contact` terminal handling); refine later if Robert wants a distinct flag.

## 4. Data model

Migration on `scheduled_appointments`:
- `outcome text` (nullable; one of the nine outcome keys) + a check constraint listing them.
- `outcome_notes text` (nullable; the rep's note at capture).
- `outcome_at timestamptz` (nullable; when the outcome was recorded).
- `status` gains its first `'completed'` writer (set when an outcome is recorded).

New `submitted` deal stage: `alter type deal_stage add value 'submitted'` positioned after `proposal` (two-phase migration like `lost`, plus updating every stage-aware map and any dependent function). Client `DealStage` union + all `STAGE_*` maps in `apps/app/src/features/pipeline/mockData.ts` (label, order, default probability, badge/band/tone, chip counts) get a `submitted` entry ordered between `proposal` and `won`. Audit stage-enumerating reports (pipeline board columns, funnel, `team_leaderboard`, unified activity report) for the new value.

## 5. Capture flow

A new appointment-outcome capture sheet (mirror `DropInSheet` + reuse the `LogActivitySheet` shell where practical): opened from the pending-outcome nudge for a specific `scheduled_appointments` row. On submit of an outcome:
1. Compute the follow-up date via `calculateFollowUpDate(outcome)` (conditional for Rescheduled on the spot: 0 if a future appointment exists on the deal, else 2-day; FR-APPT-OUT-04).
2. Create an `activities` row `type = 'appointment'`, `disposition = <outcome>`, `follow_up_date`, notes = outcome_notes. This is the touch and the follow-up (the deal-denorm trigger updates `next_followup_at`).
3. Update the `scheduled_appointments` row: `outcome`, `outcome_notes`, `outcome_at = now`, `status = 'completed'`.
4. Stage effect: Verbal commitment -> `proposal`, Application signed -> `submitted` (via `useUpdateDeal`, only advancing forward, never to `won`). Not-interested + do-not-contact -> `lost`.
5. Fire-and-forget `syncFollowup(dealId)` to reconcile the follow-up calendar event (as the drop-in path does).

## 6. Pending-outcome nudge

Mirror the unlogged-calls pattern (`computeUnloggedDials` / `useUnloggedDials` / `UnloggedCallsSection`):
- Pure matcher: given the rep's `scheduled_appointments`, an appointment is "awaiting outcome" when `end_at < now`, `status = 'scheduled'`, and `outcome is null`.
- Hook: query the rep's own appointments (RLS-scoped), run the matcher, join deal/company names.
- Card (`AppointmentsAwaitingOutcome`): renders nothing when empty; else a list with a "Log outcome" button per appointment that opens the capture sheet. Placed on the Activities page next to the unlogged-calls card. Non-blocking, persists until resolved (§2.4).

## 7. Manager awaiting-outcome count

Surface a per-rep and/or team count of appointments awaiting outcome (`end_at < now`, `status = 'scheduled'`, `outcome is null`) for managers. Prefer a small rollup card mirroring `TeamCoverageCard` / `useCoverageRollup` (a `security definer` RPC that counts per visible rep), or add a column to `team_leaderboard`. FR-APPT-OUT-06.

## 8. Non-goals / deferred (flagged)

- **Appointment type field + type-based ordering (§2.7).**
- **Unresolved-appointment-counts-as-a-touch for Touch Cadence (§2.6 / FR-APPT-OUT-05):** counting an occurred-but-unresolved appointment in Touch Cadence requires the parity-guarded scoring (client + server `_shared`) to read `scheduled_appointments`, a meaningful coupling. Deferred for beta: once the rep logs the outcome (which the nudge drives), it becomes a normal appointment-activity touch. Revisit if Robert wants the unresolved case counted before logging.
- **Tenant stage-mapping config (§2.8):** no per-tenant stage mapping exists; beta uses the fixed enum with the identity mapping above. Tenant-configurable mapping + follow-up-interval tuning + label aliasing (§2.9) are later.
- **Actual Talk-to-Text dictation** (Web Speech wiring).
- **`won` from an appointment outcome:** never (FR-APPT-OUT-07); closed-won stays merchant-boarding only.

## 9. Slices

- **W2a:** `submitted` stage (enum migration + all `STAGE_*` plumbing + report audit) + the nine appointment outcomes in `followUpScheduling.ts` + `DISPOSITIONS_BY_TYPE.appointment` primary/all lists. Pure + config, testable.
- **W2b:** `scheduled_appointments` outcome columns migration + the capture flow (sheet + write outcome/status + create appointment activity + follow-up + stage effect).
- **W2c:** pending-outcome matcher + hook + `AppointmentsAwaitingOutcome` card on the Activities page.
- **W2d:** manager awaiting-outcome count (RPC + card, or leaderboard column).

## 10. Testing

- Pure: the nine outcomes' intervals; Rescheduled conditional; `schedulesFollowUp` for the set; stage-effect mapping (Verbal -> proposal, Application signed -> submitted, Not-interested+DNC -> lost); the awaiting-outcome matcher (end passed, scheduled, no outcome).
- Component: the capture sheet writes the outcome + activity + stage; the nudge card renders/opens; manager count.
- Migrations verified in the SQL editor; the `submitted` enum value across stage-aware surfaces.
- Full `pnpm --filter app test` + `typecheck` green.

## 11. Deploy

Migrations (the `submitted` enum value is a two-phase ALTER TYPE; the `scheduled_appointments` outcome columns) pasted into the Supabase SQL editor; the manager-count RPC if added. Frontend to main. No edge-function change (this feature is client + DB, not the nightly job), though the re-engagement "appointment that occurred qualifies as contact" already holds since a logged appointment activity is a touch.
