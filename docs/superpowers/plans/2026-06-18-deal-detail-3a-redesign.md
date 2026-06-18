# Deal Detail redesign slice 3a (visual) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restructure `DealDetailPage` to the Figma 2-column layout with a persistent right rail (Latest activity ×3, Quick actions, Related), adding the two new cards as a shell; defer the behaviors behind Quick actions to slices 3b/3d.

**Architecture:** Two new presentational components (`QuickActionsCard`, `RelatedCard`); `LatestActivityCard` shows up to 3; `DealDetailPage` wraps post-hero content in a `lg:grid-cols-3` with the tabs at `col-span-2` and the right rail at `col-span-1`.

**Tech Stack:** React + TS, Radix Tabs, Tailwind (navigatr tokens), Vitest + Testing Library.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-deal-detail-3a-redesign-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/deal-detail/apps/app`.

---

### Task 1: `QuickActionsCard` + `RelatedCard` (TDD)

**Files:**
- Create: `apps/app/src/features/pipeline/components/QuickActionsCard.tsx`
- Create: `apps/app/src/features/pipeline/components/QuickActionsCard.test.tsx`
- Create: `apps/app/src/features/pipeline/components/RelatedCard.tsx`
- Create: `apps/app/src/features/pipeline/components/RelatedCard.test.tsx`

- [ ] **Step 1: QuickActionsCard test** — create `QuickActionsCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickActionsCard } from "./QuickActionsCard";

describe("QuickActionsCard", () => {
  it("renders the four quick actions", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /send to crm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send as referral/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule appointment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark as lost/i })).toBeInTheDocument();
  });

  it("disables the not-yet-built actions", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /send to crm/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send as referral/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /schedule appointment/i })).toBeDisabled();
  });

  it("disables Mark as lost when no handler is provided", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /mark as lost/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter app test QuickActionsCard` → FAIL (no module).

- [ ] **Step 3: Create `QuickActionsCard.tsx`:**

```tsx
/**
 * QuickActionsCard — Deal Detail right-rail actions (Figma 328:4).
 *
 * Slice 3a renders the shell: Send to CRM / Send as referral / Schedule
 * appointment are disabled "Coming soon" (no integrations yet); Mark as lost is
 * wired in slice 3b (FR-PIPE-07) when stage changes are centralized — until a
 * handler is passed it stays disabled. Later slices flip individual actions live
 * by passing handlers.
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  onClick?: () => void;
  danger?: boolean;
}

function ActionButton({ action }: { action: QuickAction }) {
  const disabled = !action.onClick;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      onClick={action.onClick}
      className={cn(
        "w-full rounded-radius-md border border-border-default px-3 py-2 text-body-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
        disabled
          ? "cursor-not-allowed text-text-subtle"
          : action.danger
            ? "text-status-danger hover:bg-status-danger-bg"
            : "text-text-default hover:bg-surface-sunken",
      )}
    >
      {action.label}
    </button>
  );
}

export function QuickActionsCard({
  onSendReferral,
  onMarkLost,
}: {
  onSendReferral?: () => void;
  onMarkLost?: () => void;
}) {
  const actions: QuickAction[] = [
    { label: "Send to CRM" },                              // no integration (3a stub)
    { label: "Send as referral", onClick: onSendReferral }, // wired in 3d
    { label: "Schedule appointment" },                      // no scheduler (3a stub)
    { label: "Mark as lost", onClick: onMarkLost, danger: true }, // wired in 3b
  ];
  return (
    <Card padding="md" shadow="sm" className="flex flex-col gap-3">
      <h2 className="text-body-strong text-text-default">Quick actions</h2>
      <div className="flex flex-col gap-2">
        {actions.map((a) => <ActionButton key={a.label} action={a} />)}
      </div>
    </Card>
  );
}

export default QuickActionsCard;
```

- [ ] **Step 4: Run** `pnpm --filter app test QuickActionsCard` → PASS (3 tests).

- [ ] **Step 5: RelatedCard test** — create `RelatedCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RelatedCard } from "./RelatedCard";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

const dealsRef: { list: Deal[] } = { list: [] };
vi.mock("../hooks/useDeals", () => ({ useDeals: () => ({ data: dealsRef.list }) }));

function renderCard(deal: Deal, list: Deal[]) {
  dealsRef.list = list;
  render(<MemoryRouter><RelatedCard deal={deal} /></MemoryRouter>);
}

describe("RelatedCard", () => {
  it("shows other deals for the same company", () => {
    const a = d({ id: "a", companyName: "Acme" });
    const b = d({ id: "b", companyName: "Acme" });
    renderCard(a, [a, b]);
    expect(screen.getByText(/Acme.*other deals \(1\)/i)).toBeInTheDocument();
  });

  it("renders without crashing and shows the playbook row when there are no sibling deals", () => {
    const a = d({ id: "a", companyName: "Acme" });
    renderCard(a, [a]);
    expect(screen.getByText(/playbook/i)).toBeInTheDocument();
    expect(screen.queryByText(/other deals/i)).toBeNull();
  });
});
```

- [ ] **Step 6: Run** `pnpm --filter app test RelatedCard` → FAIL (no module).

- [ ] **Step 7: Create `RelatedCard.tsx`:**

```tsx
/**
 * RelatedCard — Deal Detail right-rail "Related" (Figma 328:4).
 *
 * Slice 3a shows real data where we have it: the deal's other deals for the same
 * company (from the shared useDeals cache). A "playbook" resource row is a static
 * "Coming soon" stub (no resources system yet). A referrer row is intentionally
 * omitted until inbound attribution is surfaced on the deal (later work).
 */
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { useDeals } from "../hooks/useDeals";
import type { Deal } from "../mockData";

export function RelatedCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const { data: deals } = useDeals();
  const others = (deals ?? []).filter((d) => d.companyName === deal.companyName && d.id !== deal.id);

  return (
    <Card padding="md" shadow="sm" className="flex flex-col gap-3">
      <h2 className="text-body-strong text-text-default">Related</h2>
      <div className="flex flex-col">
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/pipeline")}
            className="flex items-center justify-between gap-2 rounded-radius-sm py-2 text-left hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-medium text-text-default">
                {deal.companyName}&rsquo;s other deals ({others.length})
              </span>
              <span className="block text-caption text-text-muted">Pipeline</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          </button>
        )}
        <div className="flex items-center justify-between gap-2 py-2 opacity-60" title="Coming soon">
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-text-default">Playbook</span>
            <span className="block text-caption text-text-muted">Resource · Coming soon</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
        </div>
      </div>
    </Card>
  );
}

export default RelatedCard;
```

- [ ] **Step 8: Run** `pnpm --filter app test RelatedCard` → PASS. Then `pnpm --filter app typecheck` → clean.

- [ ] **Step 9: Commit:**
```bash
git add apps/app/src/features/pipeline/components/QuickActionsCard.tsx apps/app/src/features/pipeline/components/QuickActionsCard.test.tsx apps/app/src/features/pipeline/components/RelatedCard.tsx apps/app/src/features/pipeline/components/RelatedCard.test.tsx
git commit -m "feat(pipeline): Deal Detail right-rail QuickActionsCard + RelatedCard (shell)"
```

---

### Task 2: `DealDetailPage` 2-column layout + Latest-activity×3

**Files:**
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`

READ the file first. Make these precise changes:

- [ ] **Step 1: `LatestActivityCard` → up to 3 activities.**
Change its signature from `activity: Activity | undefined` to `activities: Activity[]`, and
render `activities.slice(0, 3)` as rows (reuse the existing row markup; map over the slice).
Keep the "View all →" button (`onViewAll`) and the empty state (when `activities.length === 0`).
Keep `onEdit`. Adjust the single-activity internals to a `.map`.

- [ ] **Step 2: Import the two new cards** at the top of the file:
```tsx
import { QuickActionsCard } from "../components/QuickActionsCard";
import { RelatedCard } from "../components/RelatedCard";
```

- [ ] **Step 3: Restructure the page return.** Replace the post-hero block — currently:
```tsx
      <div className="flex flex-col gap-4 lg:gap-6">
        <HeroCard ... />
        <Tabs.Root ...>
          <TabBar />
          <Tabs.Content value="overview" ...>
            <ContactInfoCard deal={deal} />
            <SourceCard deal={deal} />
            <PipelineProgressionCard deal={deal} />
            <LatestActivityCard activity={activities[0]} onViewAll={...} onEdit={setEditingActivity} />
          </Tabs.Content>
          ...other Tabs.Content...
        </Tabs.Root>
      </div>
```
with a hero on top, then a 2-col grid (tabs left, right rail right), and the Latest activity
moved into the right rail:
```tsx
      <div className="flex flex-col gap-4 lg:gap-6">
        <HeroCard
          deal={deal}
          onLogActivity={() => setSheetOpen(true)}
          onEdit={() => setEditOpen(true)}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          {/* Left: tabs + content */}
          <div className="lg:col-span-2">
            <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabBar />
              <Tabs.Content value="overview" className="mt-4 flex flex-col gap-4 focus-visible:outline-none">
                <ContactInfoCard deal={deal} />
                <SourceCard deal={deal} />
                <PipelineProgressionCard deal={deal} />
              </Tabs.Content>
              <Tabs.Content value="activity" className="mt-4 focus-visible:outline-none">
                <ActivityList activities={activities} onEdit={setEditingActivity} />
              </Tabs.Content>
              <Tabs.Content value="contacts" className="mt-4 focus-visible:outline-none">
                <PlaceholderTab title="Contacts" />
              </Tabs.Content>
              <Tabs.Content value="qualification" className="mt-4 focus-visible:outline-none">
                <QualificationTab deal={deal} />
              </Tabs.Content>
              <Tabs.Content value="notes" className="mt-4 focus-visible:outline-none">
                <PlaceholderTab title="Notes & Files" />
              </Tabs.Content>
            </Tabs.Root>
          </div>

          {/* Right rail: persistent across tabs */}
          <div className="flex flex-col gap-4 lg:col-span-1">
            <LatestActivityCard
              activities={activities}
              onViewAll={() => setTab("activity")}
              onEdit={setEditingActivity}
            />
            <QuickActionsCard />
            <RelatedCard deal={deal} />
          </div>
        </div>
      </div>
```
(The `LatestActivityCard` no longer appears inside the Overview tab — it's in the right rail.)

- [ ] **Step 4: Typecheck + full suite.**
Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: clean; all green. Fix the `LatestActivityCard` call sites / prop rename so nothing
references the old `activity` prop. The existing `DealDetailPage.regression-001.test.tsx` must
stay green (it checks not-found + hero render).

- [ ] **Step 5: Commit:**
```bash
git add apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "feat(pipeline): Deal Detail 2-column layout with persistent right rail (latest activity x3, quick actions, related)"
```

---

## Notes for the implementer

- 3a is visual only. Do NOT wire Send to CRM / Send as referral / Schedule appointment /
  Mark as lost to real behavior, and do NOT change the hero stage picker, qualification tab,
  or any mutation. The hero's existing stage picker remains the way to set stage (incl. Lost)
  until slice 3b.
- Preserve all existing behavior: hero, Edit, Log activity, activity timeline + edit,
  not-found, loading spinner.
- `Card` is from `@/components/navigatr` (already used in this file). `useDeals` is the shared
  list hook (no new fetch).
- Keep the mobile single-column behavior — the `lg:grid-cols-3` collapses to one column below
  `lg`, stacking the right rail under the tabs.
