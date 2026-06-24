# Activity Logging Coverage — SP1: Snapshot + computation framework (2026-06-24)

Second sub-project of the Activity Logging Coverage roadmap
(`docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`). Builds on SP0
(`coverage_signal` table + click-to-call dial capture + the `computeUnloggedDials` matcher shipped).

SP1 is the **backend computation framework**: a nightly job persists a per-rep daily
`coverage_snapshot` (call channel only for now), with a composite coverage value, a confidence
level, and org-configurable bands/minimums. It introduces the project's first **scheduling
primitive** (pg_cron + pg_net → Edge function), which Persistence Index and Activity-to-Win will
later reuse. **No new UI** — the coverage % and all its framing (confidence label, band color,
"estimated" prefix, trend chart, methodology link) land together in SP2.

## Problem

SP0 surfaces *which* calls went unlogged (a live nudge) but persists nothing trendable and shows
no coverage rate. SP2's coverage widget + trend chart need a **daily time series** of coverage
per rep. SP1 produces that series. It also establishes the nightly-job + snapshot-table pattern
the rest of the §3.3 metrics suite depends on.

## Decisions (locked in brainstorming)

- **Job mechanism: a scheduled Edge function (Deno) over pure, unit-tested `_shared/coverage` TS.**
  The Edge function does I/O (read `coverage_signal` + `activities`, upsert `coverage_snapshot`);
  the formula / confidence / band logic is pure tested TS — matching the existing
  `discover_prospects` + `_shared/*.test.ts` pattern and keeping logic testable (no DB-integration
  harness here). Chosen over pg_cron-plpgsql, whose logic the vitest/Deno suites can't exercise.
- **Backend-only.** No frontend changes; the % is computed + persisted but only displayed in SP2,
  together with its honesty framing. (A single-channel, tap-based, low-confidence % shown without
  that framing would invite the over-interpretation the PRD warns against.)
- **Scheduling trigger: pg_cron + pg_net.** A nightly `cron.schedule` does an `http_post` to the
  function URL with the service-role key — self-contained in Supabase, no external dependency, and
  *is* the reusable nightly-metrics primitive. (Rejected: GitHub Actions cron — adds an external
  system + CI secret.)
- **Forward-compat snapshot columns.** `coverage_snapshot` carries the full per-channel column set
  (call/visit/meeting/email coverage + count) now, all nullable except the call fields, so SP3–5
  add channels without a table migration each.
- **Snapshot scores are manager-visible** (PRD §3.3.C.10), unlike SP0's rep-only raw signals: RLS
  lets a rep read their own snapshots and a manager/admin read their hierarchy subtree's, reusing
  the existing `public.user_can_see_owner(uuid)` helper. Raw `coverage_signal` stays rep-only.
- **org/role model:** `organizations` + `public.user_org_id()` / `public.user_role()` /
  `public.user_can_see_owner()` (the codebase's model), not the PRD's `tenant`.

## Architecture

### A. Scheduler + runner

**New Edge function `supabase/functions/compute_coverage_snapshots/index.ts`** (Deno), structured
like `discover_prospects` (`index.ts` + `deno.json` + `fixtures.ts`). It:
1. Creates a **service-role** Supabase client (`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`) — it
   computes across all reps and writes snapshots, bypassing RLS.
2. Computes the run date (UTC) → `snapshot_date`; window = trailing 30 days
   (`window_start_date = snapshot_date − 30d`, `window_end_date = snapshot_date`).
3. For each org: loads `organizations.coverage_config` (falling back to code defaults).
4. Finds reps with ≥1 dial signal in the window (reps with no detection get **no** snapshot —
   PRD §3.3.C.13 "no channels active → cannot estimate").
5. For each such rep: fetches their windowed dials (`coverage_signal`, `channel='phone'`,
   `signal_type='dial'`) + their Call activities (`activities`, `logged_by=rep`, `type='call'`,
   `occurred_at >= window_start`), runs the pure `_shared/coverage` functions, and **upserts**
   `coverage_snapshot` on the `(user_id, snapshot_date)` unique key (re-runs overwrite the day —
   idempotent).
6. Returns a summary `{ orgs, reps, snapshots_written }` (also useful for the fixtures test).

**Scheduling (pg_cron + pg_net), applied as a migration:** enable the `pg_cron` and `pg_net`
extensions, then `cron.schedule('coverage-snapshots-nightly', '<nightly UTC cron expr>', $$ select
net.http_post(url := <function url>, headers := jsonb_build_object('Authorization', 'Bearer ' ||
<service-role key>, 'Content-Type','application/json'), body := '{}'::jsonb) $$)`. **No secret is
committed:** the service-role key (and function URL) are read from **Supabase Vault**
(`vault.decrypted_secrets`) inside the cron command, and the secrets are stored in Vault by the
user at apply time (hand-applied, with authorization). The committed migration references the Vault
secret *names*, never the values. This cron→edge-function invoke is the reusable nightly-metrics
primitive.

### B. Data model

**New table `coverage_snapshot`** (PRD §3.3.C.14):
```
id                uuid pk default gen_random_uuid()
org_id            uuid not null references organizations(id) on delete cascade
user_id           uuid not null references profiles(id) on delete cascade
snapshot_date     date not null
composite_coverage numeric not null            -- 0..1
confidence_level  text not null                -- 'high'|'medium'|'low'|'insufficient'
call_coverage     numeric                      -- 0..1, null if channel inactive
call_event_count  int    not null default 0
visit_coverage    numeric  / visit_event_count    int   -- nullable forward-compat (SP5)
meeting_coverage  numeric  / meeting_event_count  int   -- nullable forward-compat (SP3)
email_coverage    numeric  / email_event_count    int   -- nullable forward-compat (SP4)
active_channels   text[] not null default '{}'  -- e.g. {'phone'}
window_start_date date not null
window_end_date   date not null
created_at        timestamptz not null default now()
unique (user_id, snapshot_date)
```
- Index `(user_id, snapshot_date desc)` for SP2's trend read; `(org_id, snapshot_date)` for rollups.
- **Org-consistency trigger** (mirrors `activities`): overwrite `org_id` from the rep's profile/org.
  (The writer is service-role, but the trigger keeps the column authoritative.)
- **RLS:** enable. `select using (user_id = auth.uid() OR public.user_can_see_owner(user_id))` —
  rep sees own, manager/admin see their subtree. No client insert/update/delete (only the
  service-role job writes; service role bypasses RLS).

**`organizations.coverage_config jsonb not null default '{}'::jsonb`** —
`{ enabled_channels?, band_thresholds?, minimum_event_counts?, label_overrides? }`. Code supplies
defaults when keys are absent: bands `{excellent:0.90, good:0.75, adequate:0.60, poor:0.40}`
(below `poor` ⇒ unreliable), min event counts `{call:20, visit:5, meeting:5, email:20}`,
`enabled_channels` default `['phone']` for SP1.

### C. Computation — pure, tested `supabase/functions/_shared/coverage/`

All inputs are plain data (windowed dials + calls + config); all outputs derived — no I/O, fully
unit-testable (Deno test, like `_shared/icpFilter.test.ts`).

- **`matchCounts.ts` — `countCallDials(dials, calls, now, graceMs) → { totalDials, matchedDials }`.**
  Same 4h-grace rule as SP0: a dial counts toward `totalDials` only if past the grace
  (`now − detectedAt ≥ graceMs`); it's `matched` if a Call activity exists for the same deal within
  `[detectedAt, detectedAt + graceMs]`. (Conceptually parallels the frontend `computeUnloggedDials`;
  kept as its own Deno-side module since the Edge runtime can't import from `apps/app`.)
- **`score.ts`:**
  - `callCoverage(matched, total) → total === 0 ? null : matched / total`.
  - `composite(channels) → Σ(coverage × eventCount) / Σ(eventCount)` over channels with non-null
    coverage (volume-weighted; one channel ⇒ that channel's coverage). Returns `null` if no active
    channel.
  - `confidence(activeChannelCount, perChannelCounts, config) → 'high'|'medium'|'low'|'insufficient'`
    per PRD §3.3.C.9: ≥3 active ⇒ high; 2 ⇒ medium; 1 ⇒ low; any channel below its min event count
    pulls it down; no active channel (or all below min) ⇒ insufficient. (SP1: 1 channel ⇒ `low`,
    or `insufficient` when `call_event_count < min.call`.)
  - `band(composite, thresholds) → 'excellent'|'good'|'adequate'|'poor'|'unreliable'`. Pure mapping
    shipped here for reuse; **not stored** on the snapshot (band is a display concern derived in SP2
    from the stored `composite_coverage` + the org's thresholds).

### D. Data flow

pg_cron (nightly) → `net.http_post` → `compute_coverage_snapshots` → per org load config → per rep
with dials: fetch windowed dials+calls → `countCallDials` → `callCoverage` → `composite` →
`confidence` → upsert `coverage_snapshot(user_id, snapshot_date, …)`. SP2 reads the latest /
trailing snapshots for display.

## Error handling / edge cases

- **Rep with dials but all matched** → `call_coverage = 1.0`, snapshot written (good coverage).
- **Rep with 0 dials in window** → skipped (no snapshot; "cannot estimate").
- **`total_dials` below `min.call`** → snapshot still written, but `confidence = 'insufficient'`.
- **Re-run same day** → upsert overwrites that `(user_id, snapshot_date)` row (idempotent).
- **One rep's computation throws** → caught + logged in the function; the run continues for other
  reps (one bad rep never fails the whole nightly job). The summary reports failures.
- **Function invoked but a transient DB error** → non-2xx; pg_cron's next night retries (daily
  cadence is the retry). No partial-day half-writes beyond per-rep upserts, which are idempotent.
- **`coverage_config` missing/malformed keys** → code defaults fill the gaps (never throws on config).

## Testing

- **`_shared/coverage/matchCounts.test.ts`** — counts: matched-in-grace, unmatched-past-grace,
  within-grace excluded, call outside window doesn't match, different-deal, boundary timestamps
  (exactly grace / exactly window edge), zero dials → `{0,0}`.
- **`_shared/coverage/score.test.ts`** — `callCoverage` (incl. divide-by-zero → null);
  `composite` volume-weighting + single-channel + no-active → null; `confidence` each tier incl.
  below-min ⇒ insufficient and the 1-channel ⇒ low case; `band` each threshold incl. exact
  boundaries + config-override + below-poor ⇒ unreliable.
- **`compute_coverage_snapshots`** — a `fixtures.ts`-driven test (mirroring `discover_prospects`)
  feeding canned dials/calls/config through the function's core to assert the upsert payloads
  (per-rep `composite/confidence/call_coverage/call_event_count/active_channels/window_*`), the
  skip-rep-with-no-dials case, and that a single rep throwing doesn't abort the batch.
- **Migration (table + RLS + cron)** — hand-applied + verified live (no vitest DB harness): table
  + columns + unique + indexes exist; RLS rep-own + manager-subtree read; pg_cron job registered.

## Out of scope (SP2+)

The coverage % display, dedicated widget, credibility badge, red-band warning, **trend chart**, the
frontend read hook, the `band`-on-display wiring, hierarchy **aggregate** snapshots
(`coverage_aggregate_snapshot`), and the calendar/email/location channels (SP3–5). No change to
SP0's nudge.
