# Activity Logging Coverage (PRD §3.3.C) — Decomposition & Roadmap (2026-06-24)

PRD §3.3.C specifies a coverage **measurement/credibility layer**: detect a rep's activity
through independent channels (phone dials, GPS dwell, calendar events, email metadata), match
each detected signal to a logged activity, score the ratio per channel, compose into an overall
estimate with a confidence level, and surface it as dashboard widgets + a credibility badge on
every other metric — under a strict privacy boundary (reps see their own unmatched signals;
managers see only aggregates).

## Codebase grounding (2026-06-24)

- **Activities feature EXISTS** (`apps/app/src/features/activities/`): list (Today/Upcoming/History),
  log/edit/delete sheets, 4 activity types (call/email/drop_in/appointment), 17 dispositions,
  follow-up reminders. `activities` table (`org_id, deal_id, logged_by, type, disposition,
  duration_minutes, outcome_notes, occurred_at, follow_up_date, voice_note_url`) with triggers
  syncing `deals.last_activity_at` / `next_followup_at`.
- **Dashboard widget framework EXISTS** (`features/dashboard/`); metrics computed client-side at
  page load; no credibility/coverage indicator today.
- **Click-to-call**: `lib/phone.ts` (formatting) + `PhoneWithClickToCall.tsx` (tel: launch). No
  dial-event capture, no telephony SDK.
- **ABSENT**: calendar/email OAuth, background GPS/dwell, nightly-job + snapshot framework,
  `coverage_signal` / `coverage_snapshot` / `coverage_aggregate_snapshot` tables.
- Data model uses `org_id` + role hierarchy (rep/manager/admin), **not** the PRD's `tenant`.
  Aggregation/privacy tiers map onto org/role.

## Sub-projects (dependency-ordered)

| # | Sub-project | Ships | New infra | Depends on |
|---|---|---|---|---|
| **0** | **Call-coverage v0** | `coverage_signal` table; instrument click-to-call to emit a dial signal; match dials → dispositioned Call activities (4h rule); minimal call-logging widget + rep self-correction drill-down ("N calls without a disposition — tap to fix"); rep-only RLS | coverage_signal table only (reuses `PhoneWithClickToCall`, no telephony SDK) | existing Activities + dispositions |
| **1** | **Snapshot + computation framework** | nightly job, `coverage_snapshot`, composite formula (1 channel), confidence levels, `org.coverage_config` (bands/minimums) | scheduling framework (pg_cron / scheduled Edge fn) — reusable by Persistence Index & Activity-to-Win | SP0 |
| **2a** | **Rep coverage widget** | dedicated rep dashboard widget (composite %, band color, confidence, per-channel breakdown, "how calculated", compact trend sparkline) reading the rep's own `coverage_snapshot`; instructional empty state | — (frontend + read hook + shared band helper) | SP1 |
| **2b** | **Manager coverage rollup** (scoped) | on-read `coverage_rollup` RPC (per-rep latest snapshot, hierarchy-scoped) + `useCoverageRollup` + `teamCoverage` aggregate + `TeamCoverageCard` on the Team page. **Deferred out of 2b:** persisted `coverage_aggregate_snapshot` + nightly aggregate job (on-read instead), cross-cutting credibility badges + red-band warning, full thresholds-overlay trend chart | RPC only (no new table/job) | SP1 + SP2a |
| **3** | **Calendar channel** | OAuth connect + calendar sync → calendar signals → matching → into composite | Integrations/OAuth foundation (§6.9.2) | SP1 + Integrations |
| **4** | **Email channel** | OAuth email metadata read + contact matching → email signals | shares SP3 OAuth foundation | SP3 |
| **5** | **Location/visit channel** | background GPS + dwell detection + non-residential classification + opt-in/revocation | background-location infra + 3rd-party address classification | SP1 + mobile work |

**Privacy & Trust** is cross-cutting, not a separate project: rep-only-signal RLS boundary is set
in **SP0**; per-channel opt-in flows land with each channel (SP3–5); data-quality framing/copy
guidelines apply in **SP2**.

## Sequencing decision

**Chosen: A — vertical-slice first.** SP0 → SP1 → SP2 → channels (calendar → email → location).
Ships user value immediately (the un-dispositioned-call drill-down), proves the
detect→match→display pattern on the one channel buildable with existing data, and grows the data
model organically before committing to the framework abstractions.

Rejected: **B (framework-first)** — ships nothing user-visible for a long stretch, risks building
composite/aggregation abstractions before a concrete channel validates them.
Rejected: **C (integrations-first)** — front-loads the heaviest infra (OAuth) and defers the cheap win.

### Honesty caveat for SP0

"Detected dials" = click-to-call taps, so SP0 measures **in-channel discipline** (calls initiated
through the app), not absolute phone activity. The PRD explicitly endorses this framing
(§3.3.C.4: "coverage within detected channels"). SP0 copy must say so.

## Status

- [x] Decomposition + sequencing approved (2026-06-24)
- [x] **SP0 — Call-coverage v0** shipped to prod (unlogged-calls nudge on Activities page)
- [x] **SP1 — Snapshot + computation framework** shipped to prod (nightly Edge job, `coverage_snapshot`, pg_cron schedule; Vault auth configured + cron path verified end-to-end, HTTP 200)
- [x] **SP2a — Rep coverage widget** shipped to prod (dashboard CoverageWidget reading the rep's coverage_snapshot)
- [x] **SP2b — Manager coverage rollup** shipped to prod (on-read `coverage_rollup` RPC + `useCoverageRollup` + `teamCoverage` + `TeamCoverageCard` on the Team page; migration `20260625000001` applied). **Deferred to later cycles (gated on coverage being multi-channel/meaningful — still single tap-based channel, ~0 data):** the cross-cutting credibility badges + red-band warning, the full thresholds-overlay trend chart, and the persisted `coverage_aggregate_snapshot` + nightly aggregate job (on-read RPC suffices until historical team-trend charts are needed)
- [ ] SP3–5 (calendar / email / location channels — future cycles)
