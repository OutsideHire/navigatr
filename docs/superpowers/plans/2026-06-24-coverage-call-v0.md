# Activity Logging Coverage — SP0: Call-coverage v0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn click-to-call taps into "you started this call but never logged it" nudges on the Activities page — capture dial signals, match them to logged Call activities in TS, and surface the unmatched ones with a one-tap "Log outcome" action.

**Architecture:** New `coverage_signal` table (rep-only RLS) records a dial signal per click-to-call tap at deal-context call sites. A pure TS function matches dials to the rep's Call activities within a 4h grace window; a hook runs it on read; an Activities-page section lists the unmatched dials and opens the existing `LogActivitySheet` prefilled to `call`.

**Tech Stack:** Supabase Postgres + RLS, React + TypeScript, TanStack Query, Radix Dialog, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-24-coverage-call-v0-design.md`
**Roadmap:** `docs/superpowers/roadmaps/2026-06-24-activity-logging-coverage-roadmap.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/coverage-v0/apps/app`.

---

### Task 1: `coverage_signal` migration (table + org trigger + RLS)

**Files:**
- Create: `supabase/migrations/20260624000002_coverage_signal.sql`

This is a DB migration — no vitest unit test (the repo has no DB-integration harness; the RLS/insert path is exercised indirectly by the hook tests in later tasks and confirmed in the live pass). Write it carefully, mirroring `supabase/migrations/20260519000002_activities.sql` exactly (org-consistency trigger + `public.user_org_id()` policy style).

- [ ] **Step 1: Write the migration**

```sql
-- coverage_signal: detected activity signals for Activity Logging Coverage
-- (PRD §3.3.C). SP0 writes only phone/dial signals (one per click-to-call
-- tap at a deal-context call site). Rep-only visibility: a rep sees ONLY
-- their own signals — managers get aggregates in a later sub-project, never
-- raw signals (PRD §3.3.C.11). matched_activity_id / matched_at exist for
-- the SP1 matching job and are unused in v0 (matching is computed on read).

create table coverage_signal (
  id                  uuid primary key default gen_random_uuid(),

  -- Tenancy. Denormalized org_id (mirrors deals.org_id) enforced by the
  -- consistency trigger below — same pattern as activities.
  org_id              uuid not null references organizations(id) on delete cascade,

  -- The rep the signal belongs to. profiles.id = auth uid (same as
  -- activities.logged_by). on delete restrict preserves attribution.
  user_id             uuid not null references profiles(id) on delete restrict,

  channel             text not null,        -- 'phone' in v0
  signal_type         text not null,        -- 'dial' in v0
  deal_id             uuid not null references deals(id) on delete cascade,
  detected_at         timestamptz not null default now(),
  source_metadata     jsonb not null default '{}'::jsonb,   -- { phone_number }

  -- SP1 forward-compat (unused in v0).
  matched_activity_id uuid references activities(id) on delete set null,
  matched_at          timestamptz,

  created_at          timestamptz not null default now()
);

create index coverage_signal_user_detected_idx on coverage_signal (user_id, detected_at desc);
create index coverage_signal_deal_idx           on coverage_signal (deal_id);

-- Org consistency: overwrite org_id from the parent deal so a malformed
-- client payload cannot escape RLS isolation (mirrors activities).
create or replace function coverage_signal_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_deal_org uuid;
begin
  select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
  if v_deal_org is null then
    raise exception 'coverage_signal references non-existent deal';
  end if;
  new.org_id := v_deal_org;
  return new;
end $$;

create trigger coverage_signal_enforce_org_consistency_trg
  before insert or update of deal_id, org_id on coverage_signal
  for each row execute function coverage_signal_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- RLS — rep-only. A rep inserts + selects only their own signals. No
-- update/delete from the client (signals are immutable). No manager/admin
-- read path: unmatched signals are rep-private (PRD §3.3.C.11).
-- ---------------------------------------------------------------------------
alter table coverage_signal enable row level security;

create policy coverage_signal_select on coverage_signal for select
  using (user_id = auth.uid());

create policy coverage_signal_insert on coverage_signal for insert
  with check (org_id = public.user_org_id() and user_id = auth.uid());
```

- [ ] **Step 2: Sanity-check the SQL parses** (no local DB apply required here; it is hand-applied with the user's authorization at ship time).

Run: `grep -c "create policy" supabase/migrations/20260624000002_coverage_signal.sql`
Expected: `2`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260624000002_coverage_signal.sql
git commit -m "feat(coverage): coverage_signal table (rep-only RLS) for dial signals"
```

---

### Task 2: `computeUnloggedDials` pure matching function (TDD)

**Files:**
- Create: `apps/app/src/features/activities/lib/unloggedDials.ts`
- Test: `apps/app/src/features/activities/lib/unloggedDials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeUnloggedDials, CALL_GRACE_MS } from "./unloggedDials";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("computeUnloggedDials", () => {
  it("excludes a dial that has a Call activity within the 4h grace window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(5 * HOUR) }]; // 1h after the dial
    expect(computeUnloggedDials(dials, calls, now)).toEqual([]);
  });

  it("includes an unmatched dial that is past the grace window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    expect(computeUnloggedDials(dials, [], now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(6 * HOUR), dialCount: 1 },
    ]);
  });

  it("excludes a dial still within the grace window (pending)", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(1 * HOUR) }];
    expect(computeUnloggedDials(dials, [], now)).toEqual([]);
  });

  it("does NOT match a Call activity outside the 4h window", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(10 * HOUR) }];
    const calls = [{ dealId: "d1", occurredAt: ago(2 * HOUR) }]; // 8h after the dial
    expect(computeUnloggedDials(dials, calls, now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(10 * HOUR), dialCount: 1 },
    ]);
  });

  it("does not match a Call activity for a different deal", () => {
    const dials = [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
    const calls = [{ dealId: "d2", occurredAt: ago(5 * HOUR) }];
    expect(computeUnloggedDials(dials, calls, now)).toHaveLength(1);
  });

  it("collapses multiple unmatched dials to one row per deal with a count + latest time", () => {
    const dials = [
      { dealId: "d1", detectedAt: ago(8 * HOUR) },
      { dealId: "d1", detectedAt: ago(6 * HOUR) },
    ];
    expect(computeUnloggedDials(dials, [], now)).toEqual([
      { dealId: "d1", lastDetectedAt: ago(6 * HOUR), dialCount: 2 },
    ]);
  });

  it("exports the 4h grace constant", () => {
    expect(CALL_GRACE_MS).toBe(4 * HOUR);
  });
});
```

- [ ] **Step 2: Run** `pnpm test unloggedDials` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/**
 * Pure matching for SP0 call-coverage: which click-to-call dials were never
 * logged as a Call activity within the grace window. Runs on read (no job).
 * navigatr's activities.disposition is NOT NULL, so the existence of a
 * type='call' activity for the deal IS the "logged" marker.
 */

/** PRD §3.3.C.4 call-grace window. A dial younger than this is "pending". */
export const CALL_GRACE_MS = 4 * 60 * 60 * 1000;

export interface DialSignal {
  dealId: string;
  /** ISO timestamp of the tap. */
  detectedAt: string;
}

export interface CallActivity {
  dealId: string;
  /** ISO timestamp the call occurred. */
  occurredAt: string;
}

export interface UnloggedDial {
  dealId: string;
  /** Most recent unlogged dial to this deal (ISO). */
  lastDetectedAt: string;
  /** How many unlogged dials to this deal. */
  dialCount: number;
}

export function computeUnloggedDials(
  dials: DialSignal[],
  callActivities: CallActivity[],
  now: Date,
): UnloggedDial[] {
  const nowMs = now.getTime();

  const unlogged = dials.filter((d) => {
    const detectedMs = new Date(d.detectedAt).getTime();
    // Still within the grace window — the rep may yet log it.
    if (nowMs - detectedMs < CALL_GRACE_MS) return false;
    // Logged when a Call activity exists for the deal within [dial, dial+4h].
    const matched = callActivities.some((a) => {
      if (a.dealId !== d.dealId) return false;
      const occurredMs = new Date(a.occurredAt).getTime();
      return occurredMs >= detectedMs && occurredMs <= detectedMs + CALL_GRACE_MS;
    });
    return !matched;
  });

  // Dedup → one row per deal (latest dial + count).
  const byDeal = new Map<string, UnloggedDial>();
  for (const d of unlogged) {
    const existing = byDeal.get(d.dealId);
    if (!existing) {
      byDeal.set(d.dealId, { dealId: d.dealId, lastDetectedAt: d.detectedAt, dialCount: 1 });
      continue;
    }
    existing.dialCount += 1;
    if (new Date(d.detectedAt).getTime() > new Date(existing.lastDetectedAt).getTime()) {
      existing.lastDetectedAt = d.detectedAt;
    }
  }
  return [...byDeal.values()];
}
```

- [ ] **Step 4: Run** `pnpm test unloggedDials` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/activities/lib/unloggedDials.ts apps/app/src/features/activities/lib/unloggedDials.test.ts
git commit -m "feat(coverage): pure computeUnloggedDials matching (4h grace, per-deal dedup)"
```

---

### Task 3: `useRecordDial` hook (TDD)

**Files:**
- Create: `apps/app/src/features/activities/hooks/useRecordDial.ts`
- Test: `apps/app/src/features/activities/hooks/useRecordDial.test.tsx`

Mirrors `useLogActivity` (auth + profile derivation, supabase insert). Best-effort: missing session/profile → skip silently; never throw to the UI in a way that blocks the call.

- [ ] **Step 1: Write the failing test** (mirror `useLogActivity.test.tsx` mocks)

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRecordDial } from "./useRecordDial";

const insertMock = vi.fn(() => Promise.resolve({ error: null }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}));

let authUserId: string | undefined;
let profileOrgId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: profileOrgId ? { org_id: profileOrgId } : null }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  insertMock.mockClear();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useRecordDial", () => {
  it("inserts a phone/dial coverage_signal with the deal id + phone number", async () => {
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith({
      org_id: "org-1",
      user_id: "user-1",
      channel: "phone",
      signal_type: "dial",
      deal_id: "deal-1",
      source_metadata: { phone_number: "+15551234567" },
    });
  });

  it("skips the insert when there is no session", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(insertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm test useRecordDial` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * useRecordDial — writes one phone/dial coverage_signal per click-to-call tap.
 *
 * Best-effort + fire-and-forget: callers use `mutate` (not mutateAsync) and
 * never await it, so a failed insert never blocks the tel: launch. With no
 * session/profile the insert is skipped silently. RLS with-check enforces
 * org_id = user_org_id() and user_id = auth.uid(); the org-consistency
 * trigger overwrites org_id from the deal server-side.
 */

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";

export interface RecordDialInput {
  dealId: string;
  phoneNumber: string;
}

export function useRecordDial() {
  const userId = useAuth((s) => s.user?.id);
  const profile = useProfile();

  return useMutation({
    mutationFn: async (input: RecordDialInput): Promise<void> => {
      // Best-effort: no session/profile → skip silently (don't block the call).
      if (!userId || !profile.data?.org_id) return;
      const { error } = await supabase.from("coverage_signal").insert({
        org_id: profile.data.org_id,
        user_id: userId,
        channel: "phone",
        signal_type: "dial",
        deal_id: input.dealId,
        source_metadata: { phone_number: input.phoneNumber },
      });
      if (error) throw error;
    },
  });
}
```

- [ ] **Step 4: Run** `pnpm test useRecordDial` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/activities/hooks/useRecordDial.ts apps/app/src/features/activities/hooks/useRecordDial.test.tsx
git commit -m "feat(coverage): useRecordDial — best-effort dial-signal capture"
```

---

### Task 4: `DealCallButton` wrapper (TDD)

**Files:**
- Create: `apps/app/src/features/activities/components/DealCallButton.tsx`
- Test: `apps/app/src/features/activities/components/DealCallButton.test.tsx`

A thin wrapper around `PhoneWithClickToCall` that records a dial then launches the call. Centralizes `useRecordDial` in ONE tested unit so the call sites stay trivial. Providing `onCallClick` suppresses the component's built-in `tel:` launch, so the wrapper launches it.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DealCallButton } from "./DealCallButton";

const recordDialMock = vi.fn();
vi.mock("../hooks/useRecordDial", () => ({
  useRecordDial: () => ({ mutate: recordDialMock }),
}));

const assignMock = vi.fn();

function wrap(ui: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  recordDialMock.mockClear();
  assignMock.mockClear();
  Object.defineProperty(window, "location", {
    value: { assign: assignMock },
    writable: true,
  });
});

describe("DealCallButton", () => {
  it("records the dial and launches the call when tapped", () => {
    wrap(<DealCallButton dealId="deal-1" phoneNumber="+15551234567" />);
    fireEvent.click(screen.getByRole("button", { name: /call/i }));
    expect(recordDialMock).toHaveBeenCalledWith({ dealId: "deal-1", phoneNumber: "+15551234567" });
    expect(assignMock).toHaveBeenCalledWith("tel:+15551234567");
  });
});
```

(If the call button's accessible name differs, inspect `PhoneWithClickToCall` and match it — it renders a `Button` with a `Phone` icon; the test queries by role `button`. If multiple buttons render, scope to the one with the phone label/aria.)

- [ ] **Step 2: Run** `pnpm test DealCallButton` → FAIL.

- [ ] **Step 3: Implement**

```tsx
/**
 * DealCallButton — click-to-call for a deal that also records a dial signal
 * for Activity Logging Coverage (SP0). Wraps the presentational
 * PhoneWithClickToCall: on tap it fires useRecordDial (best-effort) then
 * launches the tel: call itself (passing onCallClick suppresses the
 * component's built-in launch). The dial is always attributed to the deal,
 * even when dialing a specific contact's number.
 */

import { PhoneWithClickToCall, type PhoneSize } from "@/components/navigatr";
import { useRecordDial } from "../hooks/useRecordDial";

export interface DealCallButtonProps {
  dealId: string;
  phoneNumber: string;
  size?: PhoneSize;
}

export function DealCallButton({ dealId, phoneNumber, size = "sm" }: DealCallButtonProps) {
  const { mutate: recordDial } = useRecordDial();
  return (
    <PhoneWithClickToCall
      phoneNumber={phoneNumber}
      size={size}
      onCallClick={(num) => {
        recordDial({ dealId, phoneNumber: num });
        if (typeof window !== "undefined") window.location.assign(`tel:${num}`);
      }}
    />
  );
}
```

Confirm `PhoneSize` is exported from `@/components/navigatr` (it is exported from `PhoneWithClickToCall.tsx`; if the barrel `index.ts` doesn't re-export it, add `export type { PhoneSize } from "./PhoneWithClickToCall";` to `apps/app/src/components/navigatr/index.ts`).

- [ ] **Step 4: Run** `pnpm test DealCallButton` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/activities/components/DealCallButton.tsx apps/app/src/features/activities/components/DealCallButton.test.tsx apps/app/src/components/navigatr/index.ts
git commit -m "feat(coverage): DealCallButton — click-to-call that records a dial signal"
```

---

### Task 5: Swap `DealCallButton` into the deal-context call sites

**Files:**
- Modify: `apps/app/src/features/pipeline/components/DealCard.tsx:57`
- Modify: `apps/app/src/features/pipeline/components/ContactsTab.tsx:98,176`
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx:361`
- Modify: `apps/app/src/features/pipeline/components/DealCard.test.tsx` (provider wrapper)

Replace each deal-context `<PhoneWithClickToCall .../>` with `<DealCallButton dealId=... phoneNumber=... />`. Do NOT touch the Path `MerchantDetailSheet` or `PartnerDetailPage` usages (out of scope).

- [ ] **Step 1: DealCard.tsx** — replace the import + the usage.

Change the import line (currently `import { CardWithStatusBand, PhoneWithClickToCall } from "@/components/navigatr";`) to drop `PhoneWithClickToCall` if it's now unused, and add:
```tsx
import { DealCallButton } from "@/features/activities/components/DealCallButton";
```
Replace line ~57:
```tsx
          <DealCallButton dealId={deal.id} phoneNumber={deal.phone} size="sm" />
```

- [ ] **Step 2: ContactsTab.tsx** — add `import { DealCallButton } from "@/features/activities/components/DealCallButton";`. Replace the deal-level usage (~98):
```tsx
            <DealCallButton dealId={deal.id} phoneNumber={deal.phone} size="sm" />
```
and the per-contact usage (~176) — the dial is still attributed to the deal:
```tsx
                    <DealCallButton dealId={deal.id} phoneNumber={contact.phone} size="sm" />
```
Drop the now-unused `PhoneWithClickToCall` from the `@/components/navigatr` import if nothing else in the file uses it (let typecheck guide).

- [ ] **Step 3: DealDetailPage.tsx** — add `import { DealCallButton } from "@/features/activities/components/DealCallButton";`. Replace line ~361:
```tsx
          <DealCallButton dealId={deal.id} phoneNumber={deal.phone} size="sm" />
```
Drop `PhoneWithClickToCall` from the navigatr import if unused.

- [ ] **Step 4: Fix `DealCard.test.tsx`.** `DealCard` now mounts `useRecordDial` (→ `useMutation` + `useProfile`), so it needs a `QueryClientProvider` and the auth/profile mocks. READ the test; wrap its renders and add the mocks:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// at top, alongside other vi.mock calls:
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));
```
Wrap each `render(...)` so `DealCard` has a query client, e.g. a local helper:
```tsx
const renderCard = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
```
and replace the test's `render(<DealCard .../>)` calls with `renderCard(<DealCard .../>)`. Keep all existing assertions. (If `DealCard.test` already wraps a router/providers, add the QueryClientProvider inside that wrapper instead.)

- [ ] **Step 5: Run** `pnpm test DealCard && pnpm typecheck` → green/clean. Then `pnpm test` (full) to confirm ContactsTab/DealDetailPage tests still pass (they render inside pages that already provide a query client; if any fail solely because a second/again-rendered control appears or a provider is missing, scope/wrap minimally — do NOT change call behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/pipeline/components/DealCard.tsx apps/app/src/features/pipeline/components/DealCard.test.tsx apps/app/src/features/pipeline/components/ContactsTab.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "feat(coverage): record dial signals from deal-context click-to-call sites"
```

---

### Task 6: `LogActivitySheet` — `defaultType` prop (TDD)

**Files:**
- Modify: `apps/app/src/features/activities/components/LogActivitySheet.tsx:452-472`
- Test: `apps/app/src/features/activities/components/LogActivitySheet.test.tsx`

Lets the nudge open the sheet straight onto the Call form (skipping the type picker).

- [ ] **Step 1: Add a failing test** to `LogActivitySheet.test.tsx`:

```tsx
it("opens directly on the form when defaultType is set", () => {
  render(<LogActivitySheet open onOpenChange={vi.fn()} dealId="deal-1" defaultType="call" />);
  // The type-picker title is "What did you do?"; the form title is "Log activity".
  expect(screen.getByText(/log activity/i)).toBeInTheDocument();
  expect(screen.queryByText(/what did you do\?/i)).not.toBeInTheDocument();
});
```
(Confirm the picker/form title strings against the file: picker title `"What did you do?"`, form title `"Log activity"`. Match whatever the file actually renders.)

- [ ] **Step 2: Run** `pnpm test LogActivitySheet` → FAIL.

- [ ] **Step 3: Implement.** Add `defaultType` to the props + seed/reset the `type` state with it:

In `LogActivitySheetProps`:
```tsx
  /** Open straight onto this type's form, skipping the picker. */
  defaultType?: ActivityType;
```
In the component signature add `defaultType`, and change the state + reset effect:
```tsx
  const [type, setType] = React.useState<ActivityType | null>(defaultType ?? null);

  // Reset on close so reopening starts where the caller asked (picker or a type).
  React.useEffect(() => {
    if (!open) setType(defaultType ?? null);
  }, [open, defaultType]);
```

- [ ] **Step 4: Run** `pnpm test LogActivitySheet` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/activities/components/LogActivitySheet.tsx apps/app/src/features/activities/components/LogActivitySheet.test.tsx
git commit -m "feat(activities): LogActivitySheet defaultType to skip the type picker"
```

---

### Task 7: `useUnloggedDials` hook (TDD)

**Files:**
- Create: `apps/app/src/features/activities/hooks/useUnloggedDials.ts`
- Test: `apps/app/src/features/activities/hooks/useUnloggedDials.test.tsx`

Fetches the rep's own dials + own Call activities (RLS-scoped), runs `computeUnloggedDials`, and joins deal company names from the `useDeals` cache.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUnloggedDials } from "./useUnloggedDials";

const HOUR = 60 * 60 * 1000;
const oldDial = new Date(Date.now() - 6 * HOUR).toISOString();

// supabase.from(table) → a thenable query builder returning canned rows.
const dialRows = [{ deal_id: "d1", detected_at: oldDial }];
const callRows: Array<{ deal_id: string; occurred_at: string }> = [];
function builder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
  return b;
}
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => builder(t === "coverage_signal" ? dialRows : callRows) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [{ id: "d1", companyName: "Acme Co" }] }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { callRows.length = 0; });

describe("useUnloggedDials", () => {
  it("returns unmatched dials joined with the deal company name", async () => {
    const { result } = renderHook(() => useUnloggedDials(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { dealId: "d1", companyName: "Acme Co", lastDetectedAt: oldDial, dialCount: 1 },
    ]);
  });

  it("returns empty when there are no dials", async () => {
    dialRows.length = 0;
    const { result } = renderHook(() => useUnloggedDials(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    dialRows.push({ deal_id: "d1", detected_at: oldDial }); // restore for other tests
  });
});
```

- [ ] **Step 2: Run** `pnpm test useUnloggedDials` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * useUnloggedDials — the rep's click-to-call dials that were never logged as a
 * Call activity within the 4h grace (SP0 nudge source). Fetches the rep's own
 * dials (coverage_signal, RLS-scoped) + own Call activities, matches them with
 * computeUnloggedDials (pure), and joins deal company names from useDeals.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { computeUnloggedDials } from "../lib/unloggedDials";

export interface UnloggedDialView {
  dealId: string;
  companyName: string;
  lastDetectedAt: string;
  dialCount: number;
}

export const UNLOGGED_DIALS_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "unlogged-dials", userId ?? "anon"] as const;

export function useUnloggedDials() {
  const userId = useAuth((s) => s.user?.id);
  const deals = useDeals();

  return useQuery({
    queryKey: UNLOGGED_DIALS_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<UnloggedDialView[]> => {
      // Own dials (RLS restricts to user_id = auth.uid()), oldest first.
      const { data: dialRows, error: dialErr } = await supabase
        .from("coverage_signal")
        .select("deal_id, detected_at")
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .order("detected_at", { ascending: true });
      if (dialErr) throw dialErr;
      const dials = (dialRows ?? []).map((r) => ({ dealId: r.deal_id, detectedAt: r.detected_at }));
      if (dials.length === 0) return [];

      // Own Call activities since the oldest dial.
      const { data: callRows, error: callErr } = await supabase
        .from("activities")
        .select("deal_id, occurred_at")
        .eq("logged_by", userId)
        .eq("type", "call")
        .gte("occurred_at", dials[0].detectedAt);
      if (callErr) throw callErr;
      const calls = (callRows ?? []).map((r) => ({ dealId: r.deal_id, occurredAt: r.occurred_at }));

      const unlogged = computeUnloggedDials(dials, calls, new Date());
      const nameOf = new Map((deals.data ?? []).map((d) => [d.id, d.companyName]));
      return unlogged.map((u) => ({
        dealId: u.dealId,
        companyName: nameOf.get(u.dealId) ?? "Unknown deal",
        lastDetectedAt: u.lastDetectedAt,
        dialCount: u.dialCount,
      }));
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Run** `pnpm test useUnloggedDials` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/activities/hooks/useUnloggedDials.ts apps/app/src/features/activities/hooks/useUnloggedDials.test.tsx
git commit -m "feat(coverage): useUnloggedDials — rep's unmatched dials joined to deals"
```

---

### Task 8: `UnloggedCallsSection` + render on the Activities page (TDD)

**Files:**
- Create: `apps/app/src/features/activities/components/UnloggedCallsSection.tsx`
- Test: `apps/app/src/features/activities/components/UnloggedCallsSection.test.tsx`
- Modify: `apps/app/src/features/activities/pages/ActivitiesPage.tsx` (render the section above the tabs)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnloggedCallsSection } from "./UnloggedCallsSection";

let dials: Array<{ dealId: string; companyName: string; lastDetectedAt: string; dialCount: number }>;
vi.mock("../hooks/useUnloggedDials", () => ({
  useUnloggedDials: () => ({ data: dials }),
}));
// Stub the heavy sheet so the section test stays focused.
vi.mock("./LogActivitySheet", () => ({
  LogActivitySheet: (p: { open: boolean; dealId: string; defaultType?: string }) =>
    p.open ? <div data-testid="log-sheet">{`${p.dealId}:${p.defaultType}`}</div> : null,
}));

beforeEach(() => {
  dials = [
    { dealId: "d1", companyName: "Acme Co", lastDetectedAt: new Date().toISOString(), dialCount: 2 },
  ];
});

describe("UnloggedCallsSection", () => {
  it("lists each unlogged-call deal with a Log outcome action", () => {
    render(<UnloggedCallsSection />);
    expect(screen.getByText(/unlogged calls \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log outcome/i })).toBeInTheDocument();
  });

  it("opens LogActivitySheet prefilled to call for the tapped deal", () => {
    render(<UnloggedCallsSection />);
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    expect(screen.getByTestId("log-sheet")).toHaveTextContent("d1:call");
  });

  it("renders nothing when there are no unlogged calls", () => {
    dials = [];
    const { container } = render(<UnloggedCallsSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run** `pnpm test UnloggedCallsSection` → FAIL.

- [ ] **Step 3: Implement**

```tsx
/**
 * UnloggedCallsSection — SP0 nudge on the Activities page. Lists the rep's
 * click-to-call dials that were never logged (one row per deal) with a
 * one-tap action to log the outcome via the existing LogActivitySheet,
 * prefilled to the Call form. Data-quality framing, not compliance
 * (PRD §3.3.C.11). Renders nothing when there is nothing to nudge.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { useUnloggedDials, UNLOGGED_DIALS_QUERY_KEY } from "../hooks/useUnloggedDials";
import { LogActivitySheet } from "./LogActivitySheet";

/** Short relative time, e.g. "3h ago" / "2d ago" / "just now". */
function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function UnloggedCallsSection() {
  const { data: dials = [] } = useUnloggedDials();
  const [logDealId, setLogDealId] = React.useState<string | null>(null);
  const userId = useAuth((s) => s.user?.id);
  const queryClient = useQueryClient();

  if (dials.length === 0) return null;

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-accent-teal" aria-hidden />
        <h2 className="text-heading-sm text-text-default">Unlogged calls ({dials.length})</h2>
      </div>
      <p className="text-body-sm text-text-muted">
        You started these calls but haven&apos;t logged an outcome yet.
      </p>
      <ul className="flex flex-col gap-2">
        {dials.map((d) => (
          <li
            key={d.dealId}
            className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-label text-text-default">{d.companyName}</p>
              <p className="text-body-sm text-text-muted">
                Call started {relativeTime(d.lastDetectedAt)} · not logged
                {d.dialCount > 1 ? ` (${d.dialCount} calls)` : ""}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setLogDealId(d.dealId)}>
              Log outcome
            </Button>
          </li>
        ))}
      </ul>

      {logDealId && (
        <LogActivitySheet
          open
          onOpenChange={(o) => { if (!o) setLogDealId(null); }}
          dealId={logDealId}
          defaultType="call"
          onLogged={() => {
            setLogDealId(null);
            void queryClient.invalidateQueries({ queryKey: UNLOGGED_DIALS_QUERY_KEY(userId) });
          }}
        />
      )}
    </Card>
  );
}
```

(Confirm `Card`/`Button` accept the `className`/`variant`/`size` props as used elsewhere in `features/activities`; match the existing usage in `ActivitiesPage.tsx`. If `Button` has no `size="sm"`, drop it.)

- [ ] **Step 4: Run** `pnpm test UnloggedCallsSection` → PASS.

- [ ] **Step 5: Render on the Activities page.** In `ActivitiesPage.tsx`, import the section and render it just before the `<Tabs.Root>` element:
```tsx
import { UnloggedCallsSection } from "../components/UnloggedCallsSection";
```
```tsx
        <UnloggedCallsSection />
        {/* existing <Tabs.Root> … */}
```
(Place it inside the page's main content container, above the tabs, so it shows regardless of the active tab. READ the render tree to insert at the right spot.)

- [ ] **Step 6: Run** `pnpm typecheck && pnpm test` (full) → clean, all green. The existing `ActivitiesPage` tests must stay green — the section returns `null` when `useUnloggedDials` has no data; if a page test's supabase mock doesn't stub `coverage_signal`, the query errors and the section still renders nothing (data defaults to `[]`). If a page test breaks because the new query throws unhandled, give that test's supabase mock a `coverage_signal` → `[]` branch (do not weaken existing assertions).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/activities/components/UnloggedCallsSection.tsx apps/app/src/features/activities/components/UnloggedCallsSection.test.tsx apps/app/src/features/activities/pages/ActivitiesPage.tsx
git commit -m "feat(coverage): Unlogged calls nudge on the Activities page"
```

---

### Final

After all tasks: `pnpm typecheck && pnpm test` (full) → clean/green. Then finishing-a-development-branch.

**Shipping note:** the `coverage_signal` migration (Task 1) is **hand-applied to production with the user's explicit authorization** (repo convention — DB migrations are not auto-pushed). Flag it at ship time; the frontend is inert until the table exists (the `useUnloggedDials` query errors → the section renders nothing), so the frontend can deploy before or after the migration without breaking the page.

## Notes for the implementer
- DRY: `DealCallButton` is the single place `useRecordDial` is wired; call sites just use it.
- YAGNI: no coverage %, bands, confidence, snapshots, dashboard widget, or other channels — all later sub-projects.
- Best-effort capture: dial recording must never block the `tel:` launch.
- Matching is the pure `computeUnloggedDials` — keep all matching logic there (testable), not in SQL or hooks.
- Privacy: `coverage_signal` is rep-only by RLS; do not add a manager/org read path in v0.
- The 4h grace lives once in `CALL_GRACE_MS`; never hardcode `4 * …` elsewhere.
