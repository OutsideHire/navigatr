# Activity Logging Coverage — SP1: Snapshot + computation framework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A nightly Edge function persists a per-rep daily `coverage_snapshot` (call channel), with composite coverage, confidence, and org-configurable bands/minimums — all computation in pure unit-tested `_shared/coverage` TS, triggered by pg_cron + pg_net.

**Architecture:** New `coverage_snapshot` table + `organizations.coverage_config`. Pure `_shared/coverage` modules (config/matchCounts/score/buildSnapshot/runSnapshots) hold all logic and are vitest-tested via the existing `../../supabase/functions/_shared/**` include. A thin Deno `compute_coverage_snapshots/index.ts` injects a real service-role data layer into the pure `runSnapshots` orchestrator. A pg_cron job `http_post`s the function nightly (auth from Supabase Vault).

**Tech Stack:** Supabase Postgres + RLS + pg_cron + pg_net + Vault, Deno Edge Functions, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-coverage-snapshot-sp1-design.md`
**Roadmap:** `docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/coverage-sp1/apps/app`. The `_shared/coverage` tests are picked up by `pnpm --filter app test` (the vitest `include` already globs `../../supabase/functions/_shared/**/*.test.ts`).

---

### Task 1: `coverage_snapshot` table + `organizations.coverage_config` migration

**Files:**
- Create: `supabase/migrations/20260624000003_coverage_snapshot.sql`

DB migration — no vitest (hand-applied with the user's authorization at ship). Mirror the org-consistency-trigger + RLS style of `supabase/migrations/20260519000002_activities.sql`; reuse `public.user_can_see_owner(uuid)` (from `20260529000001_role_hierarchy_rls.sql`) for manager-subtree reads.

- [ ] **Step 1: Write the migration**

```sql
-- coverage_snapshot: per-rep, per-day Activity Logging Coverage snapshot
-- (PRD §3.3.C.14). SP1 fills the call channel only; visit/meeting/email
-- columns are nullable forward-compat for SP3-5. Unlike rep-only
-- coverage_signal, snapshot SCORES are manager-visible (PRD §3.3.C.10).
-- Written exclusively by the service-role nightly job (bypasses RLS).

create table coverage_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  snapshot_date       date not null,

  composite_coverage  numeric not null,            -- 0..1
  confidence_level    text not null,               -- 'high'|'medium'|'low'|'insufficient'

  call_coverage       numeric,                     -- 0..1, null if channel inactive
  call_event_count    int not null default 0,
  visit_coverage      numeric,                     -- nullable forward-compat (SP5)
  visit_event_count   int,
  meeting_coverage    numeric,                     -- nullable forward-compat (SP3)
  meeting_event_count int,
  email_coverage      numeric,                     -- nullable forward-compat (SP4)
  email_event_count   int,

  active_channels     text[] not null default '{}',
  window_start_date   date not null,
  window_end_date     date not null,
  created_at          timestamptz not null default now(),

  unique (user_id, snapshot_date)
);

create index coverage_snapshot_user_date_idx on coverage_snapshot (user_id, snapshot_date desc);
create index coverage_snapshot_org_date_idx  on coverage_snapshot (org_id, snapshot_date);

-- Org consistency: pull org_id from the rep's profile (the job sets it, but
-- keep the column authoritative — mirrors the activities pattern).
create or replace function coverage_snapshot_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_org uuid;
begin
  select p.org_id into v_org from profiles p where p.id = new.user_id;
  if v_org is null then
    raise exception 'coverage_snapshot references a user with no org';
  end if;
  new.org_id := v_org;
  return new;
end $$;

create trigger coverage_snapshot_enforce_org_consistency_trg
  before insert or update of user_id, org_id on coverage_snapshot
  for each row execute function coverage_snapshot_enforce_org_consistency();

-- RLS: rep reads own; manager/admin read their hierarchy subtree (scores are
-- manager-visible). No client writes — only the service-role job writes.
alter table coverage_snapshot enable row level security;

create policy coverage_snapshot_select on coverage_snapshot for select
  using (user_id = auth.uid() or public.user_can_see_owner(user_id));

-- Per-org coverage configuration (bands, minimums, enabled channels, label
-- overrides). Code supplies defaults when keys are absent.
alter table organizations
  add column if not exists coverage_config jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Verify structurally.** Run: `grep -c "create policy" supabase/migrations/20260624000003_coverage_snapshot.sql` → expect `1`. Confirm `public.user_can_see_owner` exists: `grep -rn "function public.user_can_see_owner" supabase/migrations/` → 1 hit.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260624000003_coverage_snapshot.sql
git commit -m "feat(coverage): coverage_snapshot table + organizations.coverage_config"
```

---

### Task 2: `_shared/coverage/config.ts` — types, defaults, config resolution (TDD)

**Files:**
- Create: `supabase/functions/_shared/coverage/config.ts`
- Test: `supabase/functions/_shared/coverage/config.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_COVERAGE_CONFIG, CALL_GRACE_MS, resolveCoverageConfig } from "./config";

describe("resolveCoverageConfig", () => {
  it("returns the defaults for empty / non-object input", () => {
    expect(resolveCoverageConfig(null)).toEqual(DEFAULT_COVERAGE_CONFIG);
    expect(resolveCoverageConfig({})).toEqual(DEFAULT_COVERAGE_CONFIG);
  });

  it("deep-merges provided keys over the defaults", () => {
    const merged = resolveCoverageConfig({
      bandThresholds: { good: 0.8 },
      minimumEventCounts: { call: 10 },
      enabledChannels: ["phone", "email"],
    });
    expect(merged.bandThresholds).toEqual({ excellent: 0.9, good: 0.8, adequate: 0.6, poor: 0.4 });
    expect(merged.minimumEventCounts.call).toBe(10);
    expect(merged.minimumEventCounts.email).toBe(20); // default preserved
    expect(merged.enabledChannels).toEqual(["phone", "email"]);
  });

  it("ignores malformed keys rather than throwing", () => {
    expect(resolveCoverageConfig({ bandThresholds: "nope", minimumEventCounts: 5 })).toEqual(
      DEFAULT_COVERAGE_CONFIG,
    );
  });

  it("exposes the 4h grace constant", () => {
    expect(CALL_GRACE_MS).toBe(4 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run** `pnpm test coverage/config` → FAIL.

- [ ] **Step 3: Implement** `config.ts`:
```ts
/**
 * Activity Logging Coverage — shared config + types (SP1). Pure, dependency-free
 * so vitest runs it via the _shared include. CALL_GRACE_MS mirrors the
 * frontend's lib/unloggedDials.ts (the Deno runtime can't import from apps/app).
 */

/** PRD §3.3.C.4 call-grace window. */
export const CALL_GRACE_MS = 4 * 60 * 60 * 1000;

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";
export type Band = "excellent" | "good" | "adequate" | "poor" | "unreliable";
export type ChannelKey = "call" | "visit" | "meeting" | "email";

export interface CoverageConfig {
  enabledChannels: string[];
  bandThresholds: { excellent: number; good: number; adequate: number; poor: number };
  minimumEventCounts: Record<ChannelKey, number>;
}

export const DEFAULT_COVERAGE_CONFIG: CoverageConfig = {
  enabledChannels: ["phone"],
  bandThresholds: { excellent: 0.9, good: 0.75, adequate: 0.6, poor: 0.4 },
  minimumEventCounts: { call: 20, visit: 5, meeting: 5, email: 20 },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge an org's raw coverage_config jsonb over the code defaults. Never throws. */
export function resolveCoverageConfig(raw: unknown): CoverageConfig {
  if (!isObj(raw)) return DEFAULT_COVERAGE_CONFIG;
  const d = DEFAULT_COVERAGE_CONFIG;
  const bt = isObj(raw.bandThresholds) ? raw.bandThresholds : {};
  const me = isObj(raw.minimumEventCounts) ? raw.minimumEventCounts : {};
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  return {
    enabledChannels: Array.isArray(raw.enabledChannels)
      ? (raw.enabledChannels as string[])
      : d.enabledChannels,
    bandThresholds: {
      excellent: num(bt.excellent, d.bandThresholds.excellent),
      good: num(bt.good, d.bandThresholds.good),
      adequate: num(bt.adequate, d.bandThresholds.adequate),
      poor: num(bt.poor, d.bandThresholds.poor),
    },
    minimumEventCounts: {
      call: num(me.call, d.minimumEventCounts.call),
      visit: num(me.visit, d.minimumEventCounts.visit),
      meeting: num(me.meeting, d.minimumEventCounts.meeting),
      email: num(me.email, d.minimumEventCounts.email),
    },
  };
}
```

- [ ] **Step 4: Run** `pnpm test coverage/config` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/coverage/config.ts supabase/functions/_shared/coverage/config.test.ts
git commit -m "feat(coverage): SP1 shared config — types, defaults, resolveCoverageConfig"
```

---

### Task 3: `_shared/coverage/matchCounts.ts` — dial↔call counts (TDD)

**Files:**
- Create: `supabase/functions/_shared/coverage/matchCounts.ts`
- Test: `supabase/functions/_shared/coverage/matchCounts.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { countCallDials } from "./matchCounts";
import { CALL_GRACE_MS } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("countCallDials", () => {
  it("counts a past-grace dial as total, matched if a call falls in the window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }];
    expect(countCallDials(dials, calls, now)).toEqual({ totalDials: 1, matchedDials: 1 });
  });
  it("counts an unmatched past-grace dial as total but not matched", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(6 * HOUR) }], [], now)).toEqual({
      totalDials: 1, matchedDials: 0,
    });
  });
  it("excludes a dial still within the grace window from totals", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(1 * HOUR) }], [], now)).toEqual({
      totalDials: 0, matchedDials: 0,
    });
  });
  it("does not match a call outside the 4h window or for another deal", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(10 * HOUR) }];
    expect(countCallDials(dials, [{ dealId: "d1", occurredAt: ago(2 * HOUR) }], now))
      .toEqual({ totalDials: 1, matchedDials: 0 }); // 8h after dial
    expect(countCallDials(dials, [{ dealId: "d2", occurredAt: ago(9 * HOUR) }], now))
      .toEqual({ totalDials: 1, matchedDials: 0 });
  });
  it("matches at the exact window edges", () => {
    const detectedAt = ago(6 * HOUR);
    const upper = new Date(new Date(detectedAt).getTime() + CALL_GRACE_MS).toISOString();
    expect(countCallDials([{ dealId: "d1", detectedAt }], [{ dealId: "d1", occurredAt: detectedAt }], now).matchedDials).toBe(1);
    expect(countCallDials([{ dealId: "d1", detectedAt }], [{ dealId: "d1", occurredAt: upper }], now).matchedDials).toBe(1);
  });
  it("treats a dial exactly at grace age as counted (not pending)", () => {
    expect(countCallDials([{ dealId: "d1", detectedAt: ago(CALL_GRACE_MS) }], [], now).totalDials).toBe(1);
  });
  it("returns zeros for no dials", () => {
    expect(countCallDials([], [], now)).toEqual({ totalDials: 0, matchedDials: 0 });
  });
});
```

- [ ] **Step 2: Run** `pnpm test coverage/matchCounts` → FAIL.

- [ ] **Step 3: Implement** `matchCounts.ts`:
```ts
/**
 * SP1 call-coverage counting: how many click-to-call dials (past the 4h grace,
 * within the caller-supplied window) were logged as a Call activity. Same rule
 * as the frontend lib/unloggedDials.ts, returning counts instead of rows.
 * Pure + dependency-free (vitest-tested via the _shared include).
 */
import { CALL_GRACE_MS } from "./config.ts";

export interface DialSignal {
  dealId: string;
  detectedAt: string; // ISO
}
export interface CallActivity {
  dealId: string;
  occurredAt: string; // ISO
}

export function countCallDials(
  dials: DialSignal[],
  calls: CallActivity[],
  now: Date,
  graceMs: number = CALL_GRACE_MS,
): { totalDials: number; matchedDials: number } {
  const nowMs = now.getTime();
  let totalDials = 0;
  let matchedDials = 0;
  for (const d of dials) {
    const detectedMs = new Date(d.detectedAt).getTime();
    if (nowMs - detectedMs < graceMs) continue; // pending — not yet gradeable
    totalDials += 1;
    const matched = calls.some((a) => {
      if (a.dealId !== d.dealId) return false;
      const occurredMs = new Date(a.occurredAt).getTime();
      return occurredMs >= detectedMs && occurredMs <= detectedMs + graceMs;
    });
    if (matched) matchedDials += 1;
  }
  return { totalDials, matchedDials };
}
```

- [ ] **Step 4: Run** `pnpm test coverage/matchCounts` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/coverage/matchCounts.ts supabase/functions/_shared/coverage/matchCounts.test.ts
git commit -m "feat(coverage): SP1 countCallDials — windowed dial/call counts"
```

---

### Task 4: `_shared/coverage/score.ts` — coverage / composite / confidence / band (TDD)

**Files:**
- Create: `supabase/functions/_shared/coverage/score.ts`
- Test: `supabase/functions/_shared/coverage/score.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { callCoverage, composite, confidence, band } from "./score";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

describe("callCoverage", () => {
  it("is matched / total", () => expect(callCoverage(3, 4)).toBe(0.75));
  it("is null when total is 0", () => expect(callCoverage(0, 0)).toBeNull());
});

describe("composite", () => {
  it("is the single channel's coverage when only one is active", () => {
    expect(composite([{ coverage: 0.6, eventCount: 200 }])).toBe(0.6);
  });
  it("volume-weights across channels and ignores null-coverage ones", () => {
    expect(composite([
      { coverage: 0.8, eventCount: 200 },
      { coverage: 0.3, eventCount: 5 },
      { coverage: null, eventCount: 0 },
    ])).toBeCloseTo((0.8 * 200 + 0.3 * 5) / 205, 6);
  });
  it("is null when no channel is active", () => expect(composite([])).toBeNull());
});

describe("confidence", () => {
  const cfg = DEFAULT_COVERAGE_CONFIG; // min call = 20
  it("is insufficient with no active channels", () => {
    expect(confidence([], cfg)).toBe("insufficient");
  });
  it("is low with one active channel at/above its minimum", () => {
    expect(confidence([{ channel: "call", eventCount: 20 }], cfg)).toBe("low");
  });
  it("is insufficient when the only channel is below its minimum", () => {
    expect(confidence([{ channel: "call", eventCount: 19 }], cfg)).toBe("insufficient");
  });
  it("is medium with two active channels above minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 30 },
    ], cfg)).toBe("medium");
  });
  it("is high with three active channels above minimum", () => {
    expect(confidence([
      { channel: "call", eventCount: 30 },
      { channel: "email", eventCount: 30 },
      { channel: "meeting", eventCount: 30 },
    ], cfg)).toBe("high");
  });
});

describe("band", () => {
  const t = DEFAULT_COVERAGE_CONFIG.bandThresholds;
  it("maps each tier incl. exact boundaries", () => {
    expect(band(0.95, t)).toBe("excellent");
    expect(band(0.90, t)).toBe("excellent");
    expect(band(0.89, t)).toBe("good");
    expect(band(0.75, t)).toBe("good");
    expect(band(0.60, t)).toBe("adequate");
    expect(band(0.40, t)).toBe("poor");
    expect(band(0.39, t)).toBe("unreliable");
  });
});
```

- [ ] **Step 2: Run** `pnpm test coverage/score` → FAIL.

- [ ] **Step 3: Implement** `score.ts`:
```ts
/**
 * SP1 coverage scoring (PRD §3.3.C.8/9). Pure functions over counts + config.
 */
import type { Band, ChannelKey, ConfidenceLevel, CoverageConfig } from "./config.ts";

export function callCoverage(matched: number, total: number): number | null {
  return total === 0 ? null : matched / total;
}

export interface ChannelStat {
  coverage: number | null;
  eventCount: number;
}

/** Volume-weighted mean across channels with a non-null coverage. Null if none. */
export function composite(channels: ChannelStat[]): number | null {
  const active = channels.filter((c) => c.coverage !== null && c.eventCount > 0);
  const totalEvents = active.reduce((s, c) => s + c.eventCount, 0);
  if (totalEvents === 0) return null;
  const weighted = active.reduce((s, c) => s + (c.coverage as number) * c.eventCount, 0);
  return weighted / totalEvents;
}

export interface ActiveChannel {
  channel: ChannelKey;
  eventCount: number;
}

/**
 * PRD §3.3.C.9. ≥3 active ⇒ high, 2 ⇒ medium, 1 ⇒ low; a channel below its
 * minimum event count demotes one level; no active channel (or all below
 * minimum) ⇒ insufficient.
 */
export function confidence(active: ActiveChannel[], config: CoverageConfig): ConfidenceLevel {
  if (active.length === 0) return "insufficient";
  const belowMin = active.filter((c) => c.eventCount < config.minimumEventCounts[c.channel]);
  if (belowMin.length === active.length) return "insufficient"; // every active channel too sparse
  let level: ConfidenceLevel = active.length >= 3 ? "high" : active.length === 2 ? "medium" : "low";
  if (belowMin.length > 0) {
    if (level === "high") level = "medium";
    else if (level === "medium") level = "low";
  }
  return level;
}

export function band(value: number, t: CoverageConfig["bandThresholds"]): Band {
  if (value >= t.excellent) return "excellent";
  if (value >= t.good) return "good";
  if (value >= t.adequate) return "adequate";
  if (value >= t.poor) return "poor";
  return "unreliable";
}
```

- [ ] **Step 4: Run** `pnpm test coverage/score` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/coverage/score.ts supabase/functions/_shared/coverage/score.test.ts
git commit -m "feat(coverage): SP1 scoring — callCoverage/composite/confidence/band"
```

---

### Task 5: `_shared/coverage/buildSnapshot.ts` — per-rep row builder (TDD)

**Files:**
- Create: `supabase/functions/_shared/coverage/buildSnapshot.ts`
- Test: `supabase/functions/_shared/coverage/buildSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { buildSnapshotRow } from "./buildSnapshot";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const win = { snapshotDate: "2026-06-24", windowStartDate: "2026-05-25", windowEndDate: "2026-06-24" };

describe("buildSnapshotRow", () => {
  it("builds a call-channel snapshot row from dials + calls", () => {
    const dials = [
      { dealId: "d1", detectedAt: ago(6 * HOUR) }, // matched
      { dealId: "d2", detectedAt: ago(6 * HOUR) }, // unmatched
    ];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }];
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win,
      dials, calls, config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row).toEqual({
      org_id: "org-1", user_id: "u1", snapshot_date: "2026-06-24",
      composite_coverage: 0.5, confidence_level: "insufficient", // 2 dials < min 20
      call_coverage: 0.5, call_event_count: 2,
      active_channels: ["phone"],
      window_start_date: "2026-05-25", window_end_date: "2026-06-24",
    });
  });

  it("returns null when there are no gradeable (past-grace) dials", () => {
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win,
      dials: [{ dealId: "d1", detectedAt: ago(1 * HOUR) }], // still pending
      calls: [], config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row).toBeNull();
  });

  it("reports low confidence once call volume meets the minimum", () => {
    const dials = Array.from({ length: 20 }, (_, i) => ({ dealId: `d${i}`, detectedAt: ago(6 * HOUR) }));
    const row = buildSnapshotRow({
      orgId: "org-1", userId: "u1", ...win, dials, calls: [], config: DEFAULT_COVERAGE_CONFIG, now,
    });
    expect(row?.confidence_level).toBe("low");
    expect(row?.composite_coverage).toBe(0); // none matched
    expect(row?.call_event_count).toBe(20);
  });
});
```

- [ ] **Step 2: Run** `pnpm test coverage/buildSnapshot` → FAIL.

- [ ] **Step 3: Implement** `buildSnapshot.ts`:
```ts
/**
 * SP1 per-rep snapshot row builder. Pure: composes countCallDials + scoring
 * into the coverage_snapshot insert payload. Returns null when the rep has no
 * gradeable (past-grace) dials in the window — those reps get no snapshot.
 */
import { type CallActivity, countCallDials, type DialSignal } from "./matchCounts.ts";
import { callCoverage, composite, confidence } from "./score.ts";
import type { ConfidenceLevel, CoverageConfig } from "./config.ts";

export interface BuildSnapshotInput {
  orgId: string;
  userId: string;
  snapshotDate: string;
  windowStartDate: string;
  windowEndDate: string;
  dials: DialSignal[];
  calls: CallActivity[];
  config: CoverageConfig;
  now: Date;
}

export interface CoverageSnapshotRow {
  org_id: string;
  user_id: string;
  snapshot_date: string;
  composite_coverage: number;
  confidence_level: ConfidenceLevel;
  call_coverage: number | null;
  call_event_count: number;
  active_channels: string[];
  window_start_date: string;
  window_end_date: string;
}

export function buildSnapshotRow(input: BuildSnapshotInput): CoverageSnapshotRow | null {
  const { totalDials, matchedDials } = countCallDials(input.dials, input.calls, input.now);
  if (totalDials === 0) return null; // nothing gradeable → no snapshot

  const cc = callCoverage(matchedDials, totalDials);
  const comp = composite([{ coverage: cc, eventCount: totalDials }]);
  const conf = confidence([{ channel: "call", eventCount: totalDials }], input.config);

  return {
    org_id: input.orgId,
    user_id: input.userId,
    snapshot_date: input.snapshotDate,
    composite_coverage: comp as number, // non-null: totalDials > 0
    confidence_level: conf,
    call_coverage: cc,
    call_event_count: totalDials,
    active_channels: ["phone"],
    window_start_date: input.windowStartDate,
    window_end_date: input.windowEndDate,
  };
}
```

- [ ] **Step 4: Run** `pnpm test coverage/buildSnapshot` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/coverage/buildSnapshot.ts supabase/functions/_shared/coverage/buildSnapshot.test.ts
git commit -m "feat(coverage): SP1 buildSnapshotRow — per-rep snapshot payload"
```

---

### Task 6: `_shared/coverage/runSnapshots.ts` — orchestration over injected deps (TDD)

**Files:**
- Create: `supabase/functions/_shared/coverage/runSnapshots.ts`
- Test: `supabase/functions/_shared/coverage/runSnapshots.test.ts`

Pure orchestrator with an injected data layer (`SnapshotDeps`) so the batch logic — date/window math, skip-no-dials, one-rep-throwing-doesn't-abort — is fully testable; the Deno `index.ts` (Task 7) supplies the real Supabase implementation.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, vi } from "vitest";
import { runSnapshots, type SnapshotDeps } from "./runSnapshots";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

function deps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    listOrgs: vi.fn(async () => [{ id: "org-1", config: DEFAULT_COVERAGE_CONFIG }]),
    listRepIdsWithDials: vi.fn(async () => ["u1"]),
    fetchRepDials: vi.fn(async () => [{ dealId: "d1", detectedAt: ago(6 * HOUR) }]),
    fetchRepCalls: vi.fn(async () => [{ dealId: "d1", occurredAt: ago(5 * HOUR) }]),
    upsertSnapshot: vi.fn(async () => {}),
    log: vi.fn(),
    ...over,
  };
}

describe("runSnapshots", () => {
  it("upserts one snapshot per gradeable rep and reports a summary", async () => {
    const d = deps();
    const summary = await runSnapshots(d, now);
    expect(d.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect((d.upsertSnapshot as any).mock.calls[0][0]).toMatchObject({
      user_id: "u1", snapshot_date: "2026-06-24", call_coverage: 1, call_event_count: 1,
      window_start_date: "2026-05-25", window_end_date: "2026-06-24",
    });
    expect(summary).toEqual({ orgs: 1, reps: 1, snapshots: 1, failures: 0 });
  });

  it("skips a rep with no gradeable dials (no upsert)", async () => {
    const d = deps({ fetchRepDials: vi.fn(async () => [{ dealId: "d1", detectedAt: ago(1 * HOUR) }]) });
    const summary = await runSnapshots(d, now);
    expect(d.upsertSnapshot).not.toHaveBeenCalled();
    expect(summary).toEqual({ orgs: 1, reps: 1, snapshots: 0, failures: 0 });
  });

  it("counts a failing rep without aborting the batch", async () => {
    const d = deps({
      listRepIdsWithDials: vi.fn(async () => ["u1", "u2"]),
      fetchRepDials: vi.fn(async (uid: string) => {
        if (uid === "u1") throw new Error("boom");
        return [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
      }),
    });
    const summary = await runSnapshots(d, now);
    expect(summary).toEqual({ orgs: 1, reps: 2, snapshots: 1, failures: 1 });
    expect(d.upsertSnapshot).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run** `pnpm test coverage/runSnapshots` → FAIL.

- [ ] **Step 3: Implement** `runSnapshots.ts`:
```ts
/**
 * SP1 nightly orchestrator. Pure over an injected data layer so the batch
 * logic is unit-tested; the Deno Edge function supplies a Supabase-backed
 * SnapshotDeps. Window = trailing 30 days ending on the run date (UTC).
 */
import { buildSnapshotRow, type CoverageSnapshotRow } from "./buildSnapshot.ts";
import type { CallActivity, DialSignal } from "./matchCounts.ts";
import type { CoverageConfig } from "./config.ts";

const WINDOW_DAYS = 30;

export interface SnapshotDeps {
  listOrgs(): Promise<{ id: string; config: CoverageConfig }[]>;
  listRepIdsWithDials(orgId: string, windowStartDate: string): Promise<string[]>;
  fetchRepDials(userId: string, windowStartDate: string): Promise<DialSignal[]>;
  fetchRepCalls(userId: string, windowStartDate: string): Promise<CallActivity[]>;
  upsertSnapshot(row: CoverageSnapshotRow): Promise<void>;
  log(message: string): void;
}

export interface RunSummary {
  orgs: number;
  reps: number;
  snapshots: number;
  failures: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runSnapshots(deps: SnapshotDeps, now: Date): Promise<RunSummary> {
  const snapshotDate = isoDate(now);
  const windowEndDate = snapshotDate;
  const windowStartDate = isoDate(new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const summary: RunSummary = { orgs: 0, reps: 0, snapshots: 0, failures: 0 };
  const orgs = await deps.listOrgs();
  for (const org of orgs) {
    summary.orgs += 1;
    const repIds = await deps.listRepIdsWithDials(org.id, windowStartDate);
    for (const userId of repIds) {
      summary.reps += 1;
      try {
        const [dials, calls] = await Promise.all([
          deps.fetchRepDials(userId, windowStartDate),
          deps.fetchRepCalls(userId, windowStartDate),
        ]);
        const row = buildSnapshotRow({
          orgId: org.id, userId, snapshotDate, windowStartDate, windowEndDate,
          dials, calls, config: org.config, now,
        });
        if (row) {
          await deps.upsertSnapshot(row);
          summary.snapshots += 1;
        }
      } catch (err) {
        summary.failures += 1;
        deps.log(`coverage snapshot failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run** `pnpm test coverage/runSnapshots` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/coverage/runSnapshots.ts supabase/functions/_shared/coverage/runSnapshots.test.ts
git commit -m "feat(coverage): SP1 runSnapshots orchestrator (injected deps, batch-safe)"
```

---

### Task 7: `compute_coverage_snapshots` Edge function (Deno wiring)

**Files:**
- Create: `supabase/functions/compute_coverage_snapshots/deno.json`
- Create: `supabase/functions/compute_coverage_snapshots/index.ts`

Deno I/O wrapper — implements `SnapshotDeps` with a service-role Supabase client and runs `runSnapshots`. NOT vitest-tested (esm.sh imports + `Deno.serve`); its logic lives in the already-tested `_shared/coverage` modules. Mirror `discover_prospects` structure.

- [ ] **Step 1: Create** `deno.json`:
```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Create** `index.ts`:
```ts
/**
 * compute_coverage_snapshots — nightly Activity Logging Coverage snapshot job
 * (SP1). Invoked by pg_cron via pg_net. Uses the service-role key to read every
 * rep's dials + calls and upsert coverage_snapshot (bypassing RLS). All logic
 * is in the unit-tested _shared/coverage modules; this file is just I/O.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCoverageConfig } from "../_shared/coverage/config.ts";
import { runSnapshots, type SnapshotDeps } from "../_shared/coverage/runSnapshots.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function makeDeps(db: SupabaseClient): SnapshotDeps {
  return {
    async listOrgs() {
      const { data, error } = await db.from("organizations").select("id, coverage_config");
      if (error) throw error;
      return (data ?? []).map((o) => ({ id: o.id as string, config: resolveCoverageConfig(o.coverage_config) }));
    },
    async listRepIdsWithDials(orgId, windowStartDate) {
      const { data, error } = await db
        .from("coverage_signal")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .gte("detected_at", windowStartDate);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.user_id as string))];
    },
    async fetchRepDials(userId, windowStartDate) {
      const { data, error } = await db
        .from("coverage_signal")
        .select("deal_id, detected_at")
        .eq("user_id", userId)
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .gte("detected_at", windowStartDate);
      if (error) throw error;
      return (data ?? []).map((r) => ({ dealId: r.deal_id as string, detectedAt: r.detected_at as string }));
    },
    async fetchRepCalls(userId, windowStartDate) {
      const { data, error } = await db
        .from("activities")
        .select("deal_id, occurred_at")
        .eq("logged_by", userId)
        .eq("type", "call")
        .gte("occurred_at", windowStartDate);
      if (error) throw error;
      return (data ?? []).map((r) => ({ dealId: r.deal_id as string, occurredAt: r.occurred_at as string }));
    },
    async upsertSnapshot(row) {
      const { error } = await db.from("coverage_snapshot").upsert(row, { onConflict: "user_id,snapshot_date" });
      if (error) throw error;
    },
    log(message) {
      console.log(message);
    },
  };
}

Deno.serve(async () => {
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const summary = await runSnapshots(makeDeps(db), new Date());
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 3: Typecheck the worktree** `pnpm typecheck` (apps/app) → clean (Deno files aren't in the app tsconfig; this just confirms nothing else broke). Sanity-check the function imports resolve by eye against `discover_prospects/index.ts` conventions.

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/compute_coverage_snapshots/
git commit -m "feat(coverage): compute_coverage_snapshots edge function (service-role nightly job)"
```

Deployment (function deploy + secrets) happens at ship time with the user's authorization — NOT in this task.

---

### Task 8: Nightly schedule migration (pg_cron + pg_net + Vault)

**Files:**
- Create: `supabase/migrations/20260624000004_coverage_snapshot_cron.sql`

DB migration — hand-applied with the user's authorization. No secret is committed: the function URL + service-role key are read from Supabase Vault at run time; the user stores those Vault secrets at apply time.

- [ ] **Step 1: Write the migration**
```sql
-- Nightly Activity Logging Coverage snapshot schedule (SP1). pg_cron triggers
-- the compute_coverage_snapshots Edge function via pg_net once a day. Auth +
-- URL come from Supabase Vault (secrets 'coverage_fn_url' and
-- 'coverage_service_role_key' are created by an operator at apply time) — no
-- secret is stored in this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'coverage-snapshots-nightly',
  '15 7 * * *',  -- 07:15 UTC daily (after low-traffic hours; adjust per ops)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Verify structurally.** Run: `grep -c "cron.schedule\|create extension" supabase/migrations/20260624000004_coverage_snapshot_cron.sql` → expect `3`. Confirm no literal key/URL is present: `grep -iE "https://|eyJ|service_role_key.*=.*'" supabase/migrations/20260624000004_coverage_snapshot_cron.sql` → no secret literals (only the Vault `name =` lookups).

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260624000004_coverage_snapshot_cron.sql
git commit -m "feat(coverage): nightly pg_cron schedule for coverage snapshots (Vault-auth)"
```

---

### Final

After all tasks: `pnpm typecheck && pnpm test` (full) → clean/green (the new `_shared/coverage/*.test.ts` run under the existing include). Then finishing-a-development-branch.

**Shipping sequence (all with the user's explicit authorization, in order):**
1. Apply migrations `20260624000003` (table/config) — `supabase db query --linked -f …`, then `supabase migration repair --status applied 20260624000003`.
2. Deploy the function: `supabase functions deploy compute_coverage_snapshots` (service-role key is already a platform secret; confirm `SUPABASE_SERVICE_ROLE_KEY` is available to the function).
3. Create the Vault secrets `coverage_fn_url` (the deployed function URL) + `coverage_service_role_key`.
4. Apply `20260624000004` (cron) + `migration repair --status applied 20260624000004`.
5. Smoke-test: invoke the function once manually and verify `coverage_snapshot` rows appear; check the cron is registered (`select * from cron.job`).

The frontend is unaffected (no UI in SP1).

## Notes for the implementer
- All matching/scoring logic lives in pure `_shared/coverage` modules (vitest-tested via the existing include); the Edge `index.ts` is I/O-only.
- DRY: `countCallDials` parallels the frontend `computeUnloggedDials` but is intentionally a separate Deno-side module (the Edge runtime can't import from `apps/app`). Keep the 4h grace single-sourced **within** the Deno side via `config.ts`'s `CALL_GRACE_MS`.
- YAGNI: no display, no read hook, no aggregate snapshots, no other channels — those are SP2+.
- `composite_coverage` is NOT NULL; that's safe because `buildSnapshotRow` returns `null` (skip) whenever `totalDials === 0`, so a written row always has a real composite.
- Idempotent: the upsert key is `(user_id, snapshot_date)`; re-running the job the same day overwrites.
