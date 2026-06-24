# Activity Logging Coverage — SP0: Call-coverage v0 (2026-06-24)

First sub-project of the Activity Logging Coverage roadmap
(`docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`). Implements the
**call channel as a discipline nudge** — no coverage percentage yet (deferred to SP1, which adds
the snapshot/confidence/band framework).

## Problem

PRD §3.3.C wants the platform to detect a rep's activity through independent channels and surface
where logged activity is missing. The only signal available today without new infrastructure is a
**click-to-call tap**. SP0 captures those taps, matches them to logged+dispositioned Call
activities, and surfaces the **unmatched** ones with a one-tap action to log them — turning the
existing click-to-call affordance into a "you started this call but never logged the outcome"
nudge.

A tap is a *proxy* for a dial, not a guaranteed connected call, so SP0 deliberately shows **no
coverage percentage** — only the actionable list. This is the honest, in-channel-discipline
framing the PRD endorses (§3.3.C.4: "coverage within detected channels").

## Decisions (locked in brainstorming)

- **Shape: discipline nudge only, no %.** The % (with bands/confidence/trend) waits for SP1.
- **Placement: a section on the Activities page** ("Unlogged calls (N)"), not the dashboard.
- **Detection: instrument the existing `PhoneWithClickToCall.onCallClick` at deal-context call
  sites only** (`DealCard`, `DealDetailPage`, `ContactsTab`). Path/Partner call sites are out of
  scope for v0 (not deal-scoped).
- **Matching runs on read** (a SQL view/RPC), not via a nightly job (jobs are SP1).
- **Privacy: rep-only signals.** RLS restricts `coverage_signal` reads to `user_id = auth.uid()`.
  No manager/admin read path in v0 (PRD §3.3.C.11 — reps see their own unmatched signals;
  managers get aggregates only, in a later SP).
- **Org/role model:** use `org_id` + `user_org_id()` (the codebase's model), not the PRD's `tenant`.

## Architecture

### A. Data model — new table `coverage_signal`

```
coverage_signal:
  id                  uuid primary key default gen_random_uuid()
  org_id              uuid not null references organizations(id) on delete cascade
  user_id             uuid not null references profiles(id) on delete restrict  -- mirrors activities.logged_by; profiles.id = auth uid
  channel             text not null            -- 'phone' (only channel in v0)
  signal_type         text not null            -- 'dial'
  deal_id             uuid not null references deals(id) on delete cascade
  detected_at         timestamptz not null default now()
  source_metadata     jsonb not null default '{}'::jsonb   -- { phone_number }
  matched_activity_id uuid null references activities(id) on delete set null  -- SP1 forward-compat (unused in v0)
  matched_at          timestamptz null         -- SP1 forward-compat (unused in v0)
  created_at          timestamptz not null default now()
```

- Indexes: `(user_id, detected_at)` for the read path; `(deal_id)`.
- **Org-consistency trigger** mirroring `activities`: overwrite `org_id` from the parent deal so a
  malformed client payload is neutralized server-side.
- **RLS** (enable on the table):
  - `insert with check`: `org_id = user_org_id() AND user_id = auth.uid()`.
  - `select using`: `user_id = auth.uid()`. (No manager/admin/org-wide read — rep-only.)
  - No update/delete policy in v0 (signals are immutable from the client).
- The `matched_activity_id` / `matched_at` columns exist for SP1's matching job but are **not
  written in v0**; the nudge computes matches live (see C).
- **`user_id` = the auth uid** (mirrors `activities.logged_by → profiles(id)`, which the codebase
  already equates to `auth.uid()` via the activities with-check policy).

### B. Detection — `useRecordDial` + call-site wiring

- New hook `features/activities/hooks/useRecordDial.ts`: a TanStack mutation that inserts one
  `coverage_signal` row `{ channel:'phone', signal_type:'dial', deal_id, source_metadata:{ phone_number } }`
  (org_id from `useProfile`, user_id from `useAuth`, like `useLogActivity`). It is **fire-and-forget**
  for the UX — a failed insert must NOT block the call.
- At each deal-context call site, pass
  `onCallClick={(num) => { void recordDial({ dealId, phoneNumber: num }); window.location.assign(\`tel:${num}\`); }}`.
  Providing `onCallClick` suppresses the component's built-in `tel:` launch, so the handler must
  launch the call itself (matching the component's own default behavior). A tiny shared helper
  (e.g. `dialAndRecord(recordDial, dealId)`) keeps the three call sites DRY.
- `PhoneWithClickToCall` stays a pure presentational atom — no data hook is added to it.
- **Scope:** only `DealCard`, `DealDetailPage`, `ContactsTab` (pipeline, deal-scoped). Not Path
  `MerchantDetailSheet` or `PartnerDetailPage`.

### C. Matching + read path — a pure TS function

Matching runs **on read, client-side**, as a pure unit-tested function — mirroring the existing
`useDashboardData` client-side-aggregation pattern, and chosen over a SQL view because the repo's
test stack (vitest + mocked Supabase, no DB-integration harness) cannot exercise SQL logic.

- **Pure function** `computeUnloggedDials(dials, callActivities, now): UnloggedDial[]` in
  `features/activities/lib/unloggedDials.ts`:
  - A dial is **logged** when a Call activity exists for the same `deal_id` within the grace
    window: a `callActivities` entry with `dealId === dial.dealId` and `occurredAt` in
    `[detected_at, detected_at + 4h]`. (navigatr's `activities.disposition` is `NOT NULL`, so the
    mere existence of a Call activity *is* the "logged" marker — there is no
    logged-without-disposition state. `callActivities` is already the rep's own, type='call' set.)
  - A dial is **surfaced** when it is unlogged AND past the **4h grace**
    (`detected_at < now − 4h`). Dials within the grace are "pending" and excluded.
  - **Dedup:** return **one row per deal** — the most recent unlogged dial for that deal — so
    repeated taps collapse to a single actionable item. Shape:
    `{ dealId: string; lastDetectedAt: string; dialCount: number }`.
  - The **4h grace** is a single exported constant `CALL_GRACE_MS` (PRD §3.3.C.4); not duplicated.
- **Hook** `useUnloggedDials()` (see D) fetches the inputs RLS-scoped to the rep and runs the
  function:
  - dials: `coverage_signal` where `user_id = auth.uid()`, `channel='phone'`, `signal_type='dial'`
    (RLS already restricts to own rows). Bounded to the rep's own dials.
  - callActivities: the rep's own Call activities — `activities` where `logged_by = auth.uid()`,
    `type='call'`, `occurred_at >= (oldest dial's detected_at)`. Bounded.

### D. UI — "Unlogged calls" section on the Activities page

- New component `features/activities/components/UnloggedCallsSection.tsx` rendered near the top of
  `ActivitiesPage` (above the Today/Upcoming/History tabs, so it is visible regardless of tab).
- New hook `features/activities/hooks/useUnloggedDials.ts` fetches the rep's dials + Call
  activities (per C), runs `computeUnloggedDials`, and joins deal display data (company name) by
  reusing the `useDeals` cache rather than re-fetching.
- Each row: deal/company name + "Call started {relative time} · not logged" + a **"Log outcome"**
  button.
- "Log outcome" opens the existing `LogActivitySheet` **prefilled** with `dealId` and `type='call'`
  (the rep picks the disposition). On successful log, invalidate the unlogged-dials query so the
  row drops off (now matched).
- **Empty state:** the whole section is hidden when N = 0 (no "all clear" card — it just isn't there).
- **Copy (help-not-warn, PRD §3.3.C.11):** heading "Unlogged calls", body framing like "You
  started these calls but haven't logged an outcome yet." Never "compliance," "audit," or
  "out of compliance."

## Data flow

Rep taps call on a deal → `recordDial` inserts a `phone/dial` `coverage_signal` + `tel:` launches →
(rep makes the call) → if the rep logs a Call activity within 4h, the dial is matched and never
surfaces → if not, after 4h the dial appears in "Unlogged calls" → rep taps "Log outcome" →
prefilled `LogActivitySheet` → logging the Call activity matches the dial → row drops off.

## Error handling / edge cases

- **Dial insert fails:** swallow (toast-free or a quiet console) — never block the `tel:` launch.
  Coverage is best-effort; a dropped signal just means that dial isn't tracked.
- **Dial within the 4h grace:** not surfaced (pending).
- **Repeated taps to one deal:** collapsed to one row (read-layer dedup).
- **Deal deleted after the dial:** `on delete cascade` removes the signal; nothing to surface.
- **Call site without a deal id** (Path/Partner): not instrumented in v0 — no signal created.
- **Logging via the normal flow (not the nudge):** still matches — matching is by deal+rep+window,
  not by going through the nudge.

## Testing

- **Migration/RLS:** a rep selects only their own signals; another user's signals are not visible;
  insert with-check enforces `user_id = auth.uid()`; the org-consistency trigger overwrites `org_id`.
- **`useRecordDial`:** inserts a `phone/dial` signal carrying the deal id + phone number; the call
  still launches when the insert rejects (fire-and-forget).
- **`computeUnloggedDials` (pure fn):** dial + a Call activity for that deal within 4h → excluded;
  dial with no matching call, past grace → included; dial within grace → excluded; a Call activity
  *outside* the 4h window → does NOT match (still included); multiple dials to one deal → one row
  with `dialCount` = count and `lastDetectedAt` = most recent.
- **`UnloggedCallsSection`:** renders a row per unmatched deal with company name + relative time;
  "Log outcome" opens `LogActivitySheet` prefilled with the deal + `type='call'`; section hidden
  when none; logging invalidates and removes the row.

## Out of scope (later sub-projects)

Coverage percentage, score bands, confidence levels, `coverage_snapshot`/nightly jobs (SP1); the
dedicated dashboard widget, credibility badge on other metrics, red-band warning, trend chart,
hierarchy aggregation + `coverage_aggregate_snapshot`, manager views (SP2); calendar, email, and
location/GPS channels (SP3–5); writing `matched_activity_id`/`matched_at` via a job;
non-deal-scoped call sites (Path/Partner).
