# Activities by Sales Rep & Company — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, manager-only dashboard report that counts logged activities (calls/emails/visits/appts) by rep and, on expand, by company, with date filtering, sort-by-metric, a Grand Total, and CSV export.

**Architecture:** Pure aggregation functions over the existing `useActivitiesForOrg()` feed joined to `useDeals()` (attribution = deal owner). A thin hook composes them; a page component renders. Gated on the `viewTeamPage` capability. No new DB/migrations — reads existing RLS-scoped tables.

**Tech Stack:** React 18 + TS, TanStack Query, vitest + @testing-library/react, Tailwind design tokens, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-23-activities-by-rep-company-design.md`

**Reference shapes (already in repo — do not change):**
- `Activity` (`@/features/activities/mockData`): `{ id, dealId, type: "call"|"email"|"drop_in"|"appointment", occurredAt: string, loggedBy: string|null, ... }`.
- `useActivitiesForOrg()` (`@/features/activities/hooks/useActivities`): `useQuery` → `Activity[]`, RLS-scoped to org.
- `Deal` (`@/features/pipeline/mockData`): `{ id, companyName, owner_id: string|null, ... }`.
- `useDeals()` (`@/features/pipeline/hooks/useDeals`): `useQuery` → `Deal[]`, RLS-scoped.
- `dateRange` (`../lib/dateRange`): `type RangeKey`, `RANGE_OPTIONS`, `resolveRange(key, now)`, `withinRange(iso, range)`, `rangeLabel(key)`, `type DateRange`.
- `useOrgMemberNames(enabled)` (`../hooks/useOrgMemberNames`): `Map<ownerId, displayName>`.
- `profileCan(profile, "viewTeamPage")` (`@/features/auth/capabilities`): true for sales_manager and above; `useProfile().data` has `role_level`.

**Color mapping (design tokens):** Total → violet, Calls → blue, Emails → teal, Visits → orange, Appts → pink. (Classes: `text-accent-{violet,blue,teal,orange,pink}`, `bg-accent-{…}-20`.)

---

## Task 1: Pure aggregation library

**Files:**
- Create: `apps/app/src/features/dashboard/lib/repCompanyActivity.ts`
- Test: `apps/app/src/features/dashboard/lib/repCompanyActivity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { Activity } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import {
  attributeActivities,
  repCompanyAggregate,
  sortReps,
  emptyCounts,
} from "./repCompanyActivity";

const range = { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T00:00:00.000Z" };

function deal(id: string, owner_id: string | null, companyName: string): Deal {
  return { id, owner_id, companyName } as Deal;
}
function act(dealId: string, type: Activity["type"], occurredAt: string): Activity {
  return { id: `${dealId}-${type}-${occurredAt}`, dealId, type, occurredAt, loggedBy: null } as Activity;
}

describe("attributeActivities", () => {
  const deals = [deal("d1", "u1", "Acme"), deal("d2", "u1", "Beta"), deal("d3", "u2", "Acme")];

  it("joins each activity to its deal's owner and company, in-range only", () => {
    const acts = [
      act("d1", "call", "2026-03-01T00:00:00.000Z"),
      act("d2", "email", "2026-03-02T00:00:00.000Z"),
      act("d1", "call", "2020-01-01T00:00:00.000Z"), // out of range
    ];
    const rows = attributeActivities(acts, deals, range);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ownerId: "u1", companyName: "Acme", type: "call" });
  });

  it("skips activities whose deal is not visible", () => {
    const rows = attributeActivities([act("missing", "call", "2026-03-01T00:00:00.000Z")], deals, range);
    expect(rows).toHaveLength(0);
  });
});

describe("repCompanyAggregate", () => {
  it("groups rep → company → per-type counts and reconciles at every level", () => {
    const rows = [
      { ownerId: "u1", companyName: "Acme", type: "call" as const },
      { ownerId: "u1", companyName: "Acme", type: "email" as const },
      { ownerId: "u1", companyName: "Beta", type: "call" as const },
      { ownerId: "u2", companyName: "Acme", type: "drop_in" as const },
    ];
    const { reps, grandTotal } = repCompanyAggregate(rows);
    const u1 = reps.find((r) => r.ownerId === "u1")!;
    expect(u1.companyCount).toBe(2);
    expect(u1.counts.total).toBe(3);
    expect(u1.counts.call).toBe(2);
    // rep total equals sum of its companies
    const sumCos = u1.companies.reduce((s, c) => s + c.counts.total, 0);
    expect(sumCos).toBe(u1.counts.total);
    // grand total equals sum of reps
    expect(grandTotal.total).toBe(reps.reduce((s, r) => s + r.counts.total, 0));
    expect(grandTotal.total).toBe(4);
  });

  it("sorts a rep's companies by total desc", () => {
    const rows = [
      { ownerId: "u1", companyName: "Small", type: "call" as const },
      { ownerId: "u1", companyName: "Big", type: "call" as const },
      { ownerId: "u1", companyName: "Big", type: "email" as const },
    ];
    const { reps } = repCompanyAggregate(rows);
    expect(reps[0]!.companies.map((c) => c.companyName)).toEqual(["Big", "Small"]);
  });

  it("buckets null owner under an unassigned rep", () => {
    const { reps } = repCompanyAggregate([{ ownerId: null, companyName: "Acme", type: "call" as const }]);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.ownerId).toBeNull();
  });
});

describe("sortReps", () => {
  const nameOf = (id: string | null) => id ?? "Unassigned";
  it("sorts by the selected metric descending", () => {
    const { reps } = repCompanyAggregate([
      { ownerId: "u1", companyName: "A", type: "call" as const },
      { ownerId: "u2", companyName: "A", type: "call" as const },
      { ownerId: "u2", companyName: "A", type: "email" as const },
    ]);
    const byTotal = sortReps(reps, "total", nameOf);
    expect(byTotal[0]!.ownerId).toBe("u2");
    const byEmail = sortReps(reps, "email", nameOf);
    expect(byEmail[0]!.ownerId).toBe("u2");
  });
});

describe("emptyCounts", () => {
  it("is all zeros", () => {
    expect(emptyCounts()).toEqual({ call: 0, email: 0, drop_in: 0, appointment: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app test -- repCompanyActivity`
Expected: FAIL — module has no exports yet.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Activities by Sales Rep & Company — pure aggregation.
 *
 * Attributes each logged activity to the OWNER of its deal (book of business)
 * and the deal's company, filtered to a date window, then rolls up
 * rep → company → per-type counts. Reconciles by construction: a company's
 * counts sum from its activities, a rep's from its companies, and the grand
 * total from all reps. No data fetching. "Visits" = the drop_in type.
 */
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import { withinRange, type DateRange } from "./dateRange";

export const RCA_TYPES: readonly ActivityType[] = ["call", "email", "drop_in", "appointment"];
export type RcaCountKey = ActivityType | "total";
export type RcaCounts = Record<RcaCountKey, number>;

export function emptyCounts(): RcaCounts {
  return { call: 0, email: 0, drop_in: 0, appointment: 0, total: 0 };
}

export interface AttributedActivity {
  ownerId: string | null;
  companyName: string;
  type: ActivityType;
}

/**
 * Join activities to their deal's owner + company, keeping only those whose
 * occurredAt is in range. Activities whose deal isn't in `deals` (not visible
 * under RLS, or deleted) are skipped — they can't be attributed.
 */
export function attributeActivities(
  activities: Activity[],
  deals: Deal[],
  range: DateRange,
): AttributedActivity[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const out: AttributedActivity[] = [];
  for (const a of activities) {
    if (!withinRange(a.occurredAt, range)) continue;
    const deal = byId.get(a.dealId);
    if (!deal) continue;
    out.push({ ownerId: deal.owner_id, companyName: deal.companyName, type: a.type });
  }
  return out;
}

export interface CompanyActivity {
  companyName: string;
  counts: RcaCounts;
}
export interface RepActivity {
  ownerId: string | null;
  companyCount: number;
  counts: RcaCounts;
  companies: CompanyActivity[];
}
export interface RepCompanyAggregate {
  reps: RepActivity[];
  grandTotal: RcaCounts;
}

function bump(counts: RcaCounts, type: ActivityType): void {
  counts[type] += 1;
  counts.total += 1;
}

/**
 * Group attributed rows into reps → companies → counts. Companies within each
 * rep are sorted by total desc (ties: company name asc). Reps are returned in
 * insertion order; callers sort by the active metric via `sortReps`.
 */
export function repCompanyAggregate(rows: AttributedActivity[]): RepCompanyAggregate {
  const repMap = new Map<string, RepActivity>();
  const grandTotal = emptyCounts();

  for (const r of rows) {
    const key = r.ownerId ?? "__unassigned__";
    let rep = repMap.get(key);
    if (!rep) {
      rep = { ownerId: r.ownerId, companyCount: 0, counts: emptyCounts(), companies: [] };
      repMap.set(key, rep);
    }
    let company = rep.companies.find((c) => c.companyName === r.companyName);
    if (!company) {
      company = { companyName: r.companyName, counts: emptyCounts() };
      rep.companies.push(company);
    }
    bump(company.counts, r.type);
    bump(rep.counts, r.type);
    bump(grandTotal, r.type);
  }

  for (const rep of repMap.values()) {
    rep.companyCount = rep.companies.length;
    rep.companies.sort(
      (a, b) => b.counts.total - a.counts.total || a.companyName.localeCompare(b.companyName),
    );
  }

  return { reps: [...repMap.values()], grandTotal };
}

/**
 * A new array of reps sorted by the selected metric (desc). Ties break by
 * total desc, then display name asc (via `nameOf`) so order is stable. Never
 * mutates the input.
 */
export function sortReps(
  reps: RepActivity[],
  metric: RcaCountKey,
  nameOf: (ownerId: string | null) => string,
): RepActivity[] {
  return [...reps].sort(
    (a, b) =>
      b.counts[metric] - a.counts[metric] ||
      b.counts.total - a.counts.total ||
      nameOf(a.ownerId).localeCompare(nameOf(b.ownerId)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app test -- repCompanyActivity`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/dashboard/lib/repCompanyActivity.ts apps/app/src/features/dashboard/lib/repCompanyActivity.test.ts
git commit -m "feat(report): rep-and-company activity aggregation (pure)"
```

---

## Task 2: CSV builder

**Files:**
- Create: `apps/app/src/features/dashboard/lib/repCompanyCsv.ts`
- Test: `apps/app/src/features/dashboard/lib/repCompanyCsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { repCompanyCsv } from "./repCompanyCsv";
import { repCompanyAggregate } from "./repCompanyActivity";

describe("repCompanyCsv", () => {
  const { reps, grandTotal } = repCompanyAggregate([
    { ownerId: "u1", companyName: "Acme", type: "call" },
    { ownerId: "u1", companyName: "Acme", type: "email" },
    { ownerId: "u1", companyName: "Beta, Inc", type: "call" },
  ]);
  const nameOf = (id: string | null) => (id === "u1" ? "Dana W" : "Unassigned");

  it("emits a header, one row per rep×company, and a grand total row", () => {
    const csv = repCompanyCsv(reps, nameOf, grandTotal);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Rep,Company,Calls,Emails,Visits,Appointments,Total");
    expect(lines).toContain("Dana W,Acme,1,1,0,0,2");
    expect(lines[lines.length - 1]).toBe("Grand total,,2,1,0,0,3");
  });

  it("quotes cells containing commas", () => {
    const csv = repCompanyCsv(reps, nameOf, grandTotal);
    expect(csv).toContain('Dana W,"Beta, Inc",1,0,0,0,1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app test -- repCompanyCsv`
Expected: FAIL — no module.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * CSV export for the Activities by Sales Rep & Company report. One flat file:
 * a row per rep×company, then a Grand Total row. Pure string builder so it is
 * unit-tested; the component wraps the result in a Blob download.
 */
import type { RepActivity, RcaCounts } from "./repCompanyActivity";

const HEADER = ["Rep", "Company", "Calls", "Emails", "Visits", "Appointments", "Total"];

/** RFC-4180-ish: quote a cell only if it contains a comma, quote, or newline. */
export function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(cells: (string | number)[]): string {
  return cells.map((c) => (typeof c === "number" ? String(c) : escapeCsvCell(c))).join(",");
}

export function repCompanyCsv(
  reps: RepActivity[],
  nameOf: (ownerId: string | null) => string,
  grandTotal: RcaCounts,
): string {
  const lines = [HEADER.join(",")];
  for (const rep of reps) {
    const name = nameOf(rep.ownerId);
    for (const c of rep.companies) {
      lines.push(
        row([name, c.companyName, c.counts.call, c.counts.email, c.counts.drop_in, c.counts.appointment, c.counts.total]),
      );
    }
  }
  lines.push(
    row(["Grand total", "", grandTotal.call, grandTotal.email, grandTotal.drop_in, grandTotal.appointment, grandTotal.total]),
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app test -- repCompanyCsv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/dashboard/lib/repCompanyCsv.ts apps/app/src/features/dashboard/lib/repCompanyCsv.test.ts
git commit -m "feat(report): CSV builder for rep-and-company activity report"
```

---

## Task 3: Data hook

**Files:**
- Create: `apps/app/src/features/dashboard/hooks/useRepCompanyActivity.ts`
- Test: `apps/app/src/features/dashboard/hooks/useRepCompanyActivity.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRepCompanyActivity } from "./useRepCompanyActivity";
import { resolveRange } from "../lib/dateRange";

vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivitiesForOrg: () => ({
    data: [
      { id: "a1", dealId: "d1", type: "call", occurredAt: "2026-03-01T00:00:00.000Z", loggedBy: "u1" },
      { id: "a2", dealId: "d1", type: "email", occurredAt: "2026-03-02T00:00:00.000Z", loggedBy: "u1" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [{ id: "d1", owner_id: "u1", companyName: "Acme" }], isLoading: false }),
}));
vi.mock("../hooks/useOrgMemberNames", () => ({
  useOrgMemberNames: () => new Map([["u1", "Dana W"]]),
}));

describe("useRepCompanyActivity", () => {
  it("aggregates activities joined to their deal owner + company", () => {
    const range = resolveRange("all", new Date("2026-06-01T00:00:00.000Z"));
    const { result } = renderHook(() => useRepCompanyActivity(range));
    expect(result.current.reps).toHaveLength(1);
    expect(result.current.reps[0]!.counts.total).toBe(2);
    expect(result.current.nameOf("u1")).toBe("Dana W");
    expect(result.current.grandTotal.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app test -- useRepCompanyActivity`
Expected: FAIL — no module.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * useRepCompanyActivity — the Activities by Sales Rep & Company aggregate for
 * the current viewer. Composes the org activity feed with the RLS-scoped deals
 * (for owner + company) and member names, then delegates to the pure
 * aggregation. Managers see their team automatically via RLS on both feeds.
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import {
  attributeActivities,
  repCompanyAggregate,
  type RepCompanyAggregate,
} from "../lib/repCompanyActivity";
import type { DateRange } from "../lib/dateRange";

export interface UseRepCompanyActivityResult extends RepCompanyAggregate {
  nameOf: (ownerId: string | null) => string;
  isLoading: boolean;
}

export function useRepCompanyActivity(range: DateRange): UseRepCompanyActivityResult {
  const activitiesQ = useActivitiesForOrg();
  const dealsQ = useDeals();
  const names = useOrgMemberNames(true);

  const agg = React.useMemo(
    () => repCompanyAggregate(attributeActivities(activitiesQ.data ?? [], dealsQ.data ?? [], range)),
    [activitiesQ.data, dealsQ.data, range],
  );

  const nameOf = React.useCallback(
    (ownerId: string | null) => (ownerId ? names.get(ownerId) ?? "Unknown rep" : "Unassigned"),
    [names],
  );

  return { ...agg, nameOf, isLoading: activitiesQ.isLoading || dealsQ.isLoading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app test -- useRepCompanyActivity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/dashboard/hooks/useRepCompanyActivity.ts apps/app/src/features/dashboard/hooks/useRepCompanyActivity.test.tsx
git commit -m "feat(report): useRepCompanyActivity data hook"
```

---

## Task 4: Report page component

**Files:**
- Create: `apps/app/src/features/dashboard/pages/ActivitiesByRepCompanyReport.tsx`
- Test: `apps/app/src/features/dashboard/pages/ActivitiesByRepCompanyReport.test.tsx`

Notes: mirror the range-dropdown pattern from `DashboardPage.PageHeading`. Type
color/icon metadata lives in one `TYPE_META` map. Tip dismissal uses
`localStorage` key `rca:tipDismissed`. Export builds a Blob and clicks a
temporary anchor.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivitiesByRepCompanyReport } from "./ActivitiesByRepCompanyReport";
import type { RepActivity } from "../lib/repCompanyActivity";

const reps: RepActivity[] = [
  { ownerId: "u1", companyCount: 1, counts: { call: 10, email: 2, drop_in: 0, appointment: 0, total: 12 },
    companies: [{ companyName: "Acme", counts: { call: 10, email: 2, drop_in: 0, appointment: 0, total: 12 } }] },
  { ownerId: "u2", companyCount: 1, counts: { call: 1, email: 9, drop_in: 0, appointment: 0, total: 10 },
    companies: [{ companyName: "Beta", counts: { call: 1, email: 9, drop_in: 0, appointment: 0, total: 10 } }] },
];
const grandTotal = { call: 11, email: 11, drop_in: 0, appointment: 0, total: 22 };

let mockProfile: { role_level: string } | null = { role_level: "sales_manager" };
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: mockProfile }) }));
vi.mock("../hooks/useRepCompanyActivity", () => ({
  useRepCompanyActivity: () => ({
    reps, grandTotal, isLoading: false,
    nameOf: (id: string | null) => (id === "u1" ? "Dana W" : id === "u2" ? "Marcus B" : "Unassigned"),
  }),
}));

function renderReport() {
  return render(<MemoryRouter><ActivitiesByRepCompanyReport /></MemoryRouter>);
}

describe("ActivitiesByRepCompanyReport", () => {
  beforeEach(() => { mockProfile = { role_level: "sales_manager" }; localStorage.clear(); });

  it("lists reps ranked by total by default (Dana first)", () => {
    renderReport();
    const rows = screen.getAllByTestId("rep-row");
    expect(within(rows[0]!).getByText("Dana W")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Marcus B")).toBeInTheDocument();
  });

  it("re-sorts when an activity card is clicked (Emails puts Marcus first)", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: /Emails/i }));
    const cards = screen.getAllByTestId("rep-row");
    expect(within(cards[0]!).getByText("Marcus B")).toBeInTheDocument();
  });

  it("expands a rep to show the company table with a subtotal", () => {
    renderReport();
    fireEvent.click(screen.getByTestId("rep-row-u1"));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
  });

  it("dismisses the tip and persists the choice", () => {
    renderReport();
    expect(screen.getByText(/Tip:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss tip/i }));
    expect(screen.queryByText(/Tip:/)).not.toBeInTheDocument();
    expect(localStorage.getItem("rca:tipDismissed")).toBe("1");
  });

  it("shows a not-available message for reps", () => {
    mockProfile = { role_level: "sales_professional" };
    renderReport();
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText("Dana W")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app test -- ActivitiesByRepCompanyReport`
Expected: FAIL — no component.

- [ ] **Step 3: Write the implementation**

```tsx
/**
 * Activities by Sales Rep & Company — standalone manager report.
 * Counts logged activity by rep (book of business), expandable to per-company
 * breakdowns, with a metric sort, date filter, Grand Total, and CSV export.
 * Gated to viewTeamPage (managers and above).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, BarChart3, Phone, Mail, Users, CalendarDays,
  ChevronDown, ChevronRight, Check, Clock4, Download, type LucideIcon,
} from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useProfile } from "@/features/auth/useProfile";
import { profileCan } from "@/features/auth/capabilities";
import {
  RANGE_OPTIONS, rangeLabel, resolveRange, type RangeKey,
} from "../lib/dateRange";
import { sortReps, type RcaCountKey, type RepActivity } from "../lib/repCompanyActivity";
import { repCompanyCsv } from "../lib/repCompanyCsv";
import { useRepCompanyActivity } from "../hooks/useRepCompanyActivity";

const TIP_KEY = "rca:tipDismissed";

interface TypeMeta { key: RcaCountKey; label: string; icon: LucideIcon; text: string; bg: string; }
const TYPE_META: TypeMeta[] = [
  { key: "total", label: "Total", icon: BarChart3, text: "text-accent-violet", bg: "bg-accent-violet-20" },
  { key: "call", label: "Calls", icon: Phone, text: "text-accent-blue", bg: "bg-accent-blue-20" },
  { key: "email", label: "Emails", icon: Mail, text: "text-accent-teal", bg: "bg-accent-teal-20" },
  { key: "drop_in", label: "Visits", icon: Users, text: "text-accent-orange", bg: "bg-accent-orange-20" },
  { key: "appointment", label: "Appts", icon: CalendarDays, text: "text-accent-pink", bg: "bg-accent-pink-20" },
];

const RANK_BADGE = [
  "bg-accent-orange-20 text-accent-orange",
  "bg-surface-sunken text-text-muted",
  "bg-status-danger-bg text-status-danger",
  "bg-accent-violet-20 text-accent-violet",
];

function RepRow({
  rep, rank, nameOf, expanded, onToggle,
}: {
  rep: RepActivity; rank: number; nameOf: (id: string | null) => string;
  expanded: boolean; onToggle: () => void;
}) {
  return (
    <Card padding="none" shadow="sm">
      <button
        type="button"
        data-testid={`rep-row-${rep.ownerId ?? "unassigned"}`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold", RANK_BADGE[Math.min(rank - 1, 3)])}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-body-strong text-text-default">{nameOf(rep.ownerId)}</div>
          <div className="text-caption text-text-muted">
            {rep.companyCount} {rep.companyCount === 1 ? "company" : "companies"} · {rep.counts.total} total activities
          </div>
        </div>
        <div className="hidden gap-4 sm:flex">
          {TYPE_META.slice(1).map((t) => (
            <span key={t.key} className={cn("inline-flex items-center gap-1 text-caption tabular-nums", t.text)}>
              <t.icon className="h-3.5 w-3.5" aria-hidden /> {rep.counts[t.key]}
            </span>
          ))}
        </div>
        {expanded ? <ChevronDown className="h-5 w-5 shrink-0 text-text-subtle" /> : <ChevronRight className="h-5 w-5 shrink-0 text-text-subtle" />}
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-border px-4 py-3">
          <table className="w-full min-w-[520px] text-caption">
            <thead>
              <tr className="text-text-muted">
                <th className="py-1 text-left font-normal">Company</th>
                <th className="py-1 text-right font-normal">Calls</th>
                <th className="py-1 text-right font-normal">Emails</th>
                <th className="py-1 text-right font-normal">Visits</th>
                <th className="py-1 text-right font-normal">Appointments</th>
                <th className="py-1 text-right font-medium text-text-default">Total</th>
              </tr>
            </thead>
            <tbody className="text-text-default tabular-nums">
              {rep.companies.map((c) => (
                <tr key={c.companyName}>
                  <td className="py-1 text-left text-text-muted">{c.companyName}</td>
                  <td className="py-1 text-right">{c.counts.call}</td>
                  <td className="py-1 text-right">{c.counts.email}</td>
                  <td className="py-1 text-right">{c.counts.drop_in}</td>
                  <td className="py-1 text-right">{c.counts.appointment}</td>
                  <td className="py-1 text-right font-medium">{c.counts.total}</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1.5 text-left font-medium">Subtotal</td>
                <td className="py-1.5 text-right">{rep.counts.call}</td>
                <td className="py-1.5 text-right">{rep.counts.email}</td>
                <td className="py-1.5 text-right">{rep.counts.drop_in}</td>
                <td className="py-1.5 text-right">{rep.counts.appointment}</td>
                <td className="py-1.5 text-right font-medium">{rep.counts.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ActivitiesByRepCompanyReport() {
  const navigate = useNavigate();
  const profile = useProfile().data;
  const allowed = profileCan(profile, "viewTeamPage");

  const [rangeKey, setRangeKey] = React.useState<RangeKey>("90d");
  const range = React.useMemo(() => resolveRange(rangeKey, new Date()), [rangeKey]);
  const [metric, setMetric] = React.useState<RcaCountKey>("total");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [tipDismissed, setTipDismissed] = React.useState<boolean>(
    () => localStorage.getItem(TIP_KEY) === "1",
  );

  const { reps, grandTotal, nameOf, isLoading } = useRepCompanyActivity(range);
  const sorted = React.useMemo(() => sortReps(reps, metric, nameOf), [reps, metric, nameOf]);

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <h1 className="text-heading-md text-text-default">Report not available</h1>
        <p className="mt-2 text-body-md text-text-muted">
          This report is available to sales managers and above.
        </p>
        <Button variant="tertiary" size="md" className="mt-4" leadingIcon={ArrowLeft} onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const dismissTip = () => { localStorage.setItem(TIP_KEY, "1"); setTipDismissed(true); };

  const exportCsv = () => {
    const csv = repCompanyCsv(sorted, nameOf, grandTotal);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activities-by-rep-company-${rangeKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <button type="button" onClick={() => navigate("/dashboard")} className="mb-3 inline-flex items-center gap-1 text-caption text-text-muted hover:text-text-default">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-heading-lg text-text-default">Activities by sales rep and company</h1>
          <p className="text-body-md text-text-muted">Total activity breakdown for each representative · {rangeLabel(rangeKey)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="tertiary" size="sm" leadingIcon={Download} onClick={exportCsv}>Export CSV</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="tertiary" size="sm" leadingIcon={Clock4} trailingIcon={ChevronDown}>{rangeLabel(rangeKey)}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {RANGE_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.key} onSelect={() => setRangeKey(opt.key)}>
                  <Check className={cn("mr-2 h-4 w-4", opt.key === rangeKey ? "opacity-100" : "opacity-0")} />
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TYPE_META.map((t) => {
          const active = metric === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setMetric(t.key)}
              className={cn(
                "rounded-radius-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                active ? cn("border-brand-primary", t.bg) : "border-border bg-surface-default hover:bg-surface-sunken",
              )}
            >
              <span className={cn("inline-flex items-center gap-1 text-caption", t.text)}>
                <t.icon className="h-4 w-4" aria-hidden /> {t.label}
              </span>
              <div className="mt-1 text-heading-sm tabular-nums text-text-default">{grandTotal[t.key]}</div>
            </button>
          );
        })}
      </div>

      {!tipDismissed && (
        <div className="mt-4 flex items-start gap-2 rounded-radius-md bg-accent-blue-20 px-3 py-2 text-caption text-accent-blue">
          <span className="flex-1"><span className="font-semibold">Tip:</span> click an activity card above to sort by that metric. Click a rep to expand their company breakdown.</span>
          <button type="button" aria-label="dismiss tip" onClick={dismissTip} className="shrink-0 font-medium underline-offset-2 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {isLoading && <p className="text-body-sm text-text-muted">Loading…</p>}
        {!isLoading && sorted.length === 0 && (
          <Card padding="lg" shadow="sm"><p className="text-body-sm text-text-muted">No activity logged in this period.</p></Card>
        )}
        {sorted.map((rep, i) => (
          <div key={rep.ownerId ?? "unassigned"} data-testid="rep-row">
            <RepRow
              rep={rep}
              rank={i + 1}
              nameOf={nameOf}
              expanded={expanded.has(rep.ownerId ?? "unassigned")}
              onToggle={() => toggle(rep.ownerId ?? "unassigned")}
            />
          </div>
        ))}
      </div>

      {!isLoading && sorted.length > 0 && (
        <div className="mt-5 rounded-radius-md border border-accent-blue bg-accent-blue-20 p-4">
          <div className="mb-3 text-body-strong text-accent-blue">Grand total · all representatives</div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            {TYPE_META.map((t) => (
              <div key={t.key}>
                <div className={cn("text-heading-md tabular-nums", t.text)}>{grandTotal[t.key]}</div>
                <div className="text-caption text-text-muted">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivitiesByRepCompanyReport;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app test -- ActivitiesByRepCompanyReport`
Expected: PASS. If `Button`/`Card` prop names differ from other pages, match the existing usage in `DashboardPage.tsx` (e.g. `leadingIcon`, `trailingIcon`, `variant`, `padding`, `shadow`) — they are already used there.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/dashboard/pages/ActivitiesByRepCompanyReport.tsx apps/app/src/features/dashboard/pages/ActivitiesByRepCompanyReport.test.tsx
git commit -m "feat(report): Activities by Sales Rep & Company report page"
```

---

## Task 5: Route + gated dashboard entry

**Files:**
- Modify: `apps/app/src/App.tsx` (lazy import + `<Route>`)
- Modify: `apps/app/src/features/dashboard/pages/DashboardPage.tsx` (`AdditionalReports`)
- Test: `apps/app/src/features/dashboard/pages/DashboardPage.entry.test.tsx` (extend if present; else add assertions inline)

- [ ] **Step 1: Add the lazy import + route in `App.tsx`**

Near the other dashboard lazy imports (~line 61):

```tsx
const ActivitiesByRepCompanyReport = lazy(() =>
  import("@/features/dashboard/pages/ActivitiesByRepCompanyReport").then((m) => ({
    default: m.ActivitiesByRepCompanyReport,
  })),
);
```

Near the other dashboard routes (~line 252, same wrapper/guards as `/dashboard/activity-to-win`):

```tsx
<Route path="/dashboard/activities-by-rep" element={<ActivitiesByRepCompanyReport />} />
```

- [ ] **Step 2: Add the gated entry row in `DashboardPage.tsx`**

`AdditionalReports` currently renders one `ListRow`. Import the gate at the top of the file (reuse existing imports — `useProfile` and `profileCan` are already imported). Inside `AdditionalReports`, compute the gate and conditionally render a second row:

```tsx
export function AdditionalReports() {
  const navigate = useNavigate();
  const profile = useProfile().data;
  const showRepCompany = profileCan(profile, "viewTeamPage");
  return (
    <Card padding="none" shadow="sm">
      <div className="px-6 pt-5">
        <h2 className="text-heading-sm text-text-default">Additional reports</h2>
      </div>
      <div className="mt-2 flex flex-col">
        <ListRow
          onClick={() => navigate("/dashboard/activity-to-win")}
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-radius-md bg-accent-violet-20 text-accent-violet">
              <FileBarChart className="h-4 w-4" />
            </span>
          }
          title="Activities Report"
          subtitle="Closed Won deals - activity analysis"
          trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
          divider={showRepCompany}
        />
        {showRepCompany && (
          <ListRow
            onClick={() => navigate("/dashboard/activities-by-rep")}
            leading={
              <span className="flex h-9 w-9 items-center justify-center rounded-radius-md bg-accent-blue-20 text-accent-blue">
                <Users className="h-4 w-4" />
              </span>
            }
            title="Activities by Sales Rep & Company"
            subtitle="Team activity volume by rep, drill into companies"
            trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
          />
        )}
      </div>
    </Card>
  );
}
```

(`Users` is already imported in `DashboardPage.tsx`. If `ListRow` has no
`divider` prop, drop that line — check its usage elsewhere in the file, where
`divider={i < rows.length - 1}` is already used, so the prop exists.)

- [ ] **Step 3: Write/extend the entry test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdditionalReports } from "./DashboardPage";

let role: string = "sales_manager";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role_level: role } }) }));

describe("AdditionalReports rep-and-company entry", () => {
  it("shows the entry for managers", () => {
    role = "sales_manager";
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    expect(screen.getByText("Activities by Sales Rep & Company")).toBeInTheDocument();
  });
  it("hides the entry for reps", () => {
    role = "sales_professional";
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    expect(screen.queryByText("Activities by Sales Rep & Company")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter app test -- DashboardPage`
Expected: PASS (new + existing dashboard tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/App.tsx apps/app/src/features/dashboard/pages/DashboardPage.tsx apps/app/src/features/dashboard/pages/DashboardPage.entry.test.tsx
git commit -m "feat(report): route + manager-gated dashboard entry for rep-and-company report"
```

---

## Task 6: Full suite + typecheck

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter app typecheck`
Expected: clean (no errors).

- [ ] **Step 2: Full test suite**

Run: `pnpm --filter app test`
Expected: all pass, including the four new files; no previously-passing test breaks.

- [ ] **Step 3: Manual smoke (optional, via Vercel preview)**

As a manager: dashboard → Additional reports → "Activities by Sales Rep & Company" → sort by a card, expand a rep, change the range, export CSV. As a rep: entry absent; visiting the URL shows "Report not available".

- [ ] **Step 4: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(report): typecheck + suite green for rep-and-company report"
```
