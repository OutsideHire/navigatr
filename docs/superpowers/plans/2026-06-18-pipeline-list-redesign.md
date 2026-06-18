# Pipeline List view redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the Pipeline list screen to fidelity with the Figma — a stage-pill/colored-bar deal card in a 2-column desktop grid, a computed header subhead, and a restyled KPI strip — while preserving all existing behavior.

**Architecture:** Extract the deal card into `components/DealCard.tsx` driven by a new `STAGE_TONE` color map; rework `PipelinePage` for the 2-column grid, computed subhead, and Figma KPI cards via an extracted `computeKpis` pure function. No hook/schema/query change.

**Tech Stack:** React + TypeScript, Tailwind (navigatr tokens), Vitest + Testing Library, `PhoneWithClickToCall` (libphonenumber-js), `CardWithStatusBand`.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-pipeline-list-redesign-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/pipeline-list/apps/app`.

---

## Confirmed facts (from the codebase)

- `Deal` exposes: `companyName, contactName, phone, email, valueCents, stage, probability, leadSource, lastActivity, nextFollowup, id` (`features/pipeline/mockData.ts`).
- Maps in `mockData.ts`: `STAGE_BAND_COLOR` (stage→BandColor), `STAGE_LABEL`, `STAGE_NEXT_VERB`, `STAGE_CHIP_COUNTS`, `STAGE_DEFAULT_PROBABILITY`, `HEADER_SUBHEAD` (static string, to be replaced by a computed subhead).
- `formatMoney`, `formatRelative`, `formatShortDate` are exported from `mockData.ts`.
- `BandColor` + `bandColorClass` (`components/navigatr/CardWithStatusBand.tsx`): `bg-status-info|warning|danger|success`, `bg-accent-teal|violet|orange|blue|pink`, `bg-brand-primary`.
- Soft bg tokens exist: `bg-status-{info,warning,danger,success}-bg`, `bg-accent-{teal,violet,...}-20`; text tokens `text-status-{info,...}`, `text-accent-{teal,...}`.
- `PhoneWithClickToCall` props: `{ phoneNumber: string; size?: "sm"|"md"|"lg" }` — renders the formatted number + a call icon-button.
- `CardWithStatusBand` props: `{ bandColor: BandColor; onClick?; contentPadding?; "aria-label"? }`.
- There is **no** `PipelinePage.test.tsx` yet (only DealDetailPage tests in `pages/`). Nothing to keep green there; add fresh coverage.

---

### Task 1: `STAGE_TONE` map + `DealCard` component (TDD)

**Files:**
- Modify: `apps/app/src/features/pipeline/mockData.ts` (add `STAGE_TONE`)
- Create: `apps/app/src/features/pipeline/components/DealCard.tsx`
- Create: `apps/app/src/features/pipeline/components/DealCard.test.tsx`

- [ ] **Step 1: Add `STAGE_TONE` to `mockData.ts`**

Append after the existing `STAGE_BAND_COLOR` export (it already imports `BandColor`):

```ts
/** Per-stage tones: the left band color, the solid probability-bar fill, and
 *  the soft pill background + text. One source of truth so a card renders
 *  mono-stage-colored (band + pill + bar agree). */
export interface StageTone {
  band: BandColor;
  barFill: string;
  pillBg: string;
  pillText: string;
}
export const STAGE_TONE: Record<DealStage, StageTone> = {
  new:       { band: "info",    barFill: "bg-status-info",    pillBg: "bg-status-info-bg",    pillText: "text-status-info" },
  contacted: { band: "warning", barFill: "bg-status-warning", pillBg: "bg-status-warning-bg", pillText: "text-status-warning" },
  qualified: { band: "teal",    barFill: "bg-accent-teal",    pillBg: "bg-accent-teal-20",    pillText: "text-accent-teal" },
  proposal:  { band: "violet",  barFill: "bg-accent-violet",  pillBg: "bg-accent-violet-20",  pillText: "text-accent-violet" },
  won:       { band: "success", barFill: "bg-status-success", pillBg: "bg-status-success-bg", pillText: "text-status-success" },
  lost:      { band: "danger",  barFill: "bg-status-danger",  pillBg: "bg-status-danger-bg",  pillText: "text-status-danger" },
};
```

- [ ] **Step 2: Write the failing test**

Create `apps/app/src/features/pipeline/components/DealCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DealCard } from "./DealCard";
import { MOCK_DEALS, type Deal } from "../mockData";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

function deal(over: Partial<Deal> = {}): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

function renderCard(d: Deal) {
  render(<MemoryRouter><DealCard deal={d} /></MemoryRouter>);
}

beforeEach(() => navigate.mockClear());

describe("DealCard", () => {
  it("renders company, value, stage pill, contact, and probability", () => {
    renderCard(deal({ companyName: "Acme Corporation", stage: "qualified", probability: 75, contactName: "John Smith" }));
    expect(screen.getByText("Acme Corporation")).toBeInTheDocument();
    expect(screen.getByText("Qualified")).toBeInTheDocument();          // stage pill
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText(/PROBABILITY · 75%/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("renders an email mailto link when email is present", () => {
    renderCard(deal({ email: "john@acme.com" }));
    const mail = screen.getByRole("link", { name: /john@acme\.com/i });
    expect(mail).toHaveAttribute("href", "mailto:john@acme.com");
  });

  it("omits the email link when email is empty", () => {
    renderCard(deal({ email: "" }));
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("footer shows the next-step verb plus date when a follow-up is set", () => {
    renderCard(deal({ stage: "contacted", nextFollowup: "2026-04-28" }));
    expect(screen.getByText(/Call back/i)).toBeInTheDocument();   // STAGE_NEXT_VERB.contacted
    expect(screen.getByText(/Next:/i)).toBeInTheDocument();
  });

  it("footer shows the verb only when no follow-up date is set", () => {
    renderCard(deal({ stage: "new", nextFollowup: null }));
    expect(screen.getByText(/Reach out/i)).toBeInTheDocument();   // STAGE_NEXT_VERB.new
  });

  it("clicking the card navigates to the deal detail", () => {
    renderCard(deal({ id: "d-123", companyName: "Acme Corporation" }));
    fireEvent.click(screen.getByText("Acme Corporation"));
    expect(navigate).toHaveBeenCalledWith("/pipeline/d-123");
  });

  it("clicking the email link does NOT navigate into the card", () => {
    renderCard(deal({ id: "d-123", email: "john@acme.com" }));
    fireEvent.click(screen.getByRole("link", { name: /john@acme\.com/i }));
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter app test DealCard`
Expected: FAIL — `Failed to resolve import "./DealCard"`.

- [ ] **Step 4: Create the component**

Create `apps/app/src/features/pipeline/components/DealCard.tsx`:

```tsx
/**
 * DealCard — Pipeline list card (Figma `navigatr v1` 324:63 / desktop List 325:4).
 *
 * Mono-stage-colored: the 4px left band, the stage pill, and the probability
 * bar all use STAGE_TONE[stage]. Reuses PhoneWithClickToCall for the formatted
 * number + call button; email is a mailto link. Footer is the hybrid form —
 * "Last activity: <date>" ↔ "Next: <verb> · <date>" — pairing the Figma date
 * with the existing STAGE_NEXT_VERB so the next step reads as an instruction.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";

import { cn } from "@/lib/utils";
import { CardWithStatusBand, PhoneWithClickToCall } from "@/components/navigatr";
import {
  formatMoney,
  formatRelative,
  formatShortDate,
  STAGE_LABEL,
  STAGE_NEXT_VERB,
  STAGE_TONE,
  type Deal,
} from "../mockData";

export function DealCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const tone = STAGE_TONE[deal.stage];
  const verb = STAGE_NEXT_VERB[deal.stage];
  const pct = Math.max(0, Math.min(100, deal.probability));

  return (
    <CardWithStatusBand
      bandColor={tone.band}
      contentPadding="md"
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      aria-label={`${deal.companyName}, ${formatMoney(deal.valueCents)}, ${STAGE_LABEL[deal.stage]}`}
    >
      <div className="flex flex-col gap-3">
        {/* Top: company + contact ↔ value + stage pill */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-body-strong text-text-default">{deal.companyName}</p>
            <p className="truncate text-body-sm text-text-muted">{deal.contactName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-heading-sm tabular-nums text-text-default">
              {formatMoney(deal.valueCents)}
            </span>
            <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-medium", tone.pillBg, tone.pillText)}>
              {STAGE_LABEL[deal.stage]}
            </span>
          </div>
        </div>

        {/* Contact row: tap-to-call number + button, then email */}
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <PhoneWithClickToCall phoneNumber={deal.phone} size="sm" />
          {deal.email && (
            <a
              href={`mailto:${deal.email}`}
              className="inline-flex min-w-0 items-center gap-1.5 text-body-sm text-text-muted hover:text-text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-radius-sm"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{deal.email}</span>
            </a>
          )}
        </div>

        {/* Probability label + colored bar */}
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
            Probability · {pct}%
          </span>
          <div
            className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Win probability"
          >
            <div className={cn("h-full rounded-radius-full", tone.barFill)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Footer: last activity ↔ next step (hybrid verb + date) */}
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-caption text-text-muted">
          <span className="truncate">
            Last activity: <span className="tabular-nums">{formatRelative(deal.lastActivity)}</span>
          </span>
          <span className="shrink-0 text-text-default">
            Next: <span className="font-medium">{verb}</span>
            {deal.nextFollowup && (
              <span className="text-text-muted"> · <span className="tabular-nums">{formatShortDate(deal.nextFollowup)}</span></span>
            )}
          </span>
        </div>
      </div>
    </CardWithStatusBand>
  );
}

export default DealCard;
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter app test DealCard`
Expected: PASS (7 tests). If `formatRelative(deal.lastActivity)` or a mock field shape causes a failure, adjust the test's `deal()` overrides (not the component) to supply valid values.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter app typecheck`
Expected: clean.

```bash
git add apps/app/src/features/pipeline/mockData.ts apps/app/src/features/pipeline/components/DealCard.tsx apps/app/src/features/pipeline/components/DealCard.test.tsx
git commit -m "feat(pipeline): STAGE_TONE map + redesigned DealCard (stage pill, probability bar, hybrid footer)"
```

---

### Task 2: `PipelinePage` — 2-col grid, computed subhead, KPI restyle

**Files:**
- Modify: `apps/app/src/features/pipeline/pages/PipelinePage.tsx`
- Create: `apps/app/src/features/pipeline/pages/PipelinePage.test.tsx`

- [ ] **Step 1: Extract a `computeKpis` pure function + write its test**

Create `apps/app/src/features/pipeline/pages/PipelinePage.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { computeKpis, PipelinePage } from "./PipelinePage";
import type { Deal } from "../mockData";
import { MOCK_DEALS } from "../mockData";

vi.mock("../hooks/useDeals", () => ({
  useDeals: () => ({ data: MOCK_DEALS, isLoading: false }),
}));
// Profession term hooks → identity-ish labels so assertions are stable.
vi.mock("@/features/profession/useTerm", () => ({
  useTerm: (k: string) => k,
  useTermCapitalized: (k: string) => k.charAt(0).toUpperCase() + k.slice(1),
}));

function d(over: Partial<Deal>): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

describe("computeKpis", () => {
  it("sums open-stage pipeline + weighted and counts active deals", () => {
    const deals = [
      d({ id: "a", stage: "new", valueCents: 100_00, probability: 20 }),
      d({ id: "b", stage: "qualified", valueCents: 200_00, probability: 50 }),
      d({ id: "c", stage: "won", valueCents: 999_00, probability: 100 }),
    ];
    const k = computeKpis(deals);
    expect(k.activeDeals).toBe(2);                 // won excluded from active
    expect(k.totalPipeline).toBe(300_00);          // 100 + 200
    expect(k.weighted).toBe(100_00 * 0.2 + 200_00 * 0.5); // 20_00 + 100_00
  });

  it("returns zeros for an empty list", () => {
    expect(computeKpis([])).toEqual(
      expect.objectContaining({ totalPipeline: 0, weighted: 0, activeDeals: 0 }),
    );
  });
});

describe("PipelinePage", () => {
  function renderPage() {
    render(<MemoryRouter><PipelinePage /></MemoryRouter>);
  }

  it("renders a computed header subhead with active deals + weighted", () => {
    renderPage();
    // e.g. "47 active deals · $98K weighted" — assert the shape, not exact $.
    expect(screen.getByText(/active deals ·/i)).toBeInTheDocument();
    expect(screen.getByText(/weighted/i)).toBeInTheDocument();
  });

  it("renders the four KPI tiles", () => {
    renderPage();
    expect(screen.getByText(/total pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/weighted/i)).toBeInTheDocument();
    expect(screen.getByText(/active deals/i)).toBeInTheDocument();
    expect(screen.getByText(/won this month/i)).toBeInTheDocument();
  });

  it("renders deal cards for the loaded deals", () => {
    renderPage();
    expect(screen.getByText(MOCK_DEALS[0].companyName)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter app test PipelinePage`
Expected: FAIL — `computeKpis` is not exported yet.

- [ ] **Step 3: Edit `PipelinePage.tsx` — export `computeKpis`, restyle, grid, subhead**

(a) Add an exported pure function near the top (after imports), capturing the existing
KPI math currently inlined in `KpiStrip`:

```tsx
export interface PipelineKpis {
  totalPipeline: number;
  weighted: number;
  activeDeals: number;
  wonThisMonth: number;
  wonDealsThisMonth: number;
}

/** Open-stage pipeline + weighted value + active count, and won-this-month.
 *  Won/lost are excluded from the open pipeline; won deals closed in the
 *  current calendar month feed the "won this month" tile. */
export function computeKpis(deals: Deal[] | undefined): PipelineKpis {
  const zero = { totalPipeline: 0, weighted: 0, activeDeals: 0, wonThisMonth: 0, wonDealsThisMonth: 0 };
  if (!deals || deals.length === 0) return zero;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const k = { ...zero };
  for (const dDeal of deals) {
    if (dDeal.stage === "won" || dDeal.stage === "lost") {
      if (dDeal.stage === "won" && new Date(dDeal.updatedAt) >= monthStart) {
        k.wonThisMonth += dDeal.valueCents;
        k.wonDealsThisMonth += 1;
      }
    } else {
      k.totalPipeline += dDeal.valueCents;
      k.weighted += Math.round(dDeal.valueCents * (dDeal.probability / 100));
      k.activeDeals += 1;
    }
  }
  return k;
}

/** $1,234,000 → "$1.2M"; $98,000 → "$98K". */
function fmtMoneyShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars)}`;
}
```

(b) Replace the `KpiStrip` component body so it consumes `computeKpis` + `fmtMoneyShort`
and renders Figma-style tiles (colored dot + uppercase eyebrow + large value, no subtitle):

```tsx
const KPI_DOT: Record<string, string> = {
  teal: "bg-accent-teal", violet: "bg-accent-violet", blue: "bg-accent-blue", success: "bg-status-success",
};

function KpiStrip({ deals, filtered }: { deals: Deal[] | undefined; filtered: boolean }) {
  const k = React.useMemo(() => computeKpis(deals), [deals]);
  const tiles = [
    { dot: "teal",    eyebrow: filtered ? "Pipeline (filtered)" : "Total pipeline", value: fmtMoneyShort(k.totalPipeline) },
    { dot: "violet",  eyebrow: "Weighted",        value: fmtMoneyShort(k.weighted) },
    { dot: "blue",    eyebrow: "Active deals",    value: String(k.activeDeals) },
    { dot: "success", eyebrow: "Won this month",  value: fmtMoneyShort(k.wonThisMonth) },
  ];
  return (
    <div className="hidden gap-4 md:grid md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.eyebrow} className="flex flex-col gap-2 rounded-radius-md border border-border-subtle bg-surface-default p-4">
          <span className="inline-flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-text-muted">
            <span className={cn("h-2 w-2 rounded-radius-full", KPI_DOT[t.dot])} aria-hidden />
            {t.eyebrow}
          </span>
          <span className="text-heading-lg tabular-nums text-text-default">{t.value}</span>
        </div>
      ))}
    </div>
  );
}
```

(c) In `PageHeader`, replace the static subhead line
`<p className="text-body-md text-text-muted">{HEADER_SUBHEAD}</p>` with a computed prop.
Change `PageHeader`'s signature to accept `subhead: string` and render `{subhead}`. Then in
`PipelinePage`, compute and pass it:

```tsx
// inside PipelinePage, after `const { data: deals, isLoading } = useDeals();`
const headerKpis = React.useMemo(() => computeKpis(ownerFilter ? filtered : deals), [deals, filtered, ownerFilter]);
const subhead = `${headerKpis.activeDeals} active deals · ${fmtMoneyShort(headerKpis.weighted)} weighted`;
```

and pass `subhead={subhead}` into `<PageHeader … />`. (Move the `filtered`/`deals` memo above
this if needed so `filtered` is defined first — it already is, declared before the return.)

Remove the now-unused `HEADER_SUBHEAD` import.

(d) Replace the inline `DealCard` definition + the now-unused `ProbabilityDots` and
`formatPhoneForDisplay` helpers with an import:

```tsx
import { DealCard } from "../components/DealCard";
```
Delete the inline `function DealCard(...) {...}`, `function ProbabilityDots(...) {...}`, and
`function formatPhoneForDisplay(...) {...}` from this file. Remove now-unused icon imports
(`ArrowRight`, `Phone`) and the `STAGE_BAND_COLOR`, `STAGE_NEXT_VERB`, `formatShortDate`,
`formatRelative` imports IF they are no longer referenced in `PipelinePage` after the
deletion (keep any still used). Keep `formatMoney` only if still used; otherwise drop it.
Let typecheck guide which imports to remove.

(e) Switch both list render paths to a **2-column grid** on desktop. Replace the two
`<div className="flex flex-col gap-3">` blocks that map `filtered` to `DealCard` (the
kanban-fallback-below-lg one and the list-view one) with:

```tsx
<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
  {filtered.map((deal) => (
    <DealCard key={deal.id} deal={deal} />
  ))}
</div>
```

(The `lg:hidden` kanban-fallback wrapper keeps its `lg:hidden`; only its inner container
changes to the grid. The pure list-view path uses the grid directly.)

- [ ] **Step 4: Run the page tests**

Run: `pnpm --filter app test PipelinePage`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: typecheck clean (no unused imports left behind); all tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/pipeline/pages/PipelinePage.tsx apps/app/src/features/pipeline/pages/PipelinePage.test.tsx
git commit -m "feat(pipeline): List view to Figma — 2-col grid, computed subhead, restyled KPI tiles"
```

---

## Notes for the implementer

- `Deal.updatedAt` is used by `computeKpis` (won-this-month) — it exists on the type (the
  original `KpiStrip` referenced `d.updatedAt`). Keep that field reference.
- Do NOT change `useDeals`, the schema, or query logic. Filters stay in-memory.
- Preserve every existing `PipelinePage` behavior: owner-filter banner, search + debounce,
  `usePersistedViewMode` toggle, deep-link `?action=add`, `StageChips`, `EmptyState`,
  `LoadingList`, profession-term labels.
- The KPI tile and subhead share `computeKpis` — do not duplicate the math.
- After deletions, run typecheck and remove exactly the imports it flags as unused; don't
  guess.
