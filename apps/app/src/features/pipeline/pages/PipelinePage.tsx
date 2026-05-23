/**
 * Pipeline — list view (Session 13).
 *
 * Source: Figma `navigatr v1` Pipeline master frame:
 *   - mobile  360 × HUG
 *   - desktop 1280 × HUG
 *
 * The most-used screen after Dashboard. Field reps live here, so the
 * deal card is dense: company + value + stage badge, contact + phone +
 * email + headcount, probability bar, last-activity / next-followup
 * dates. Tap-to-call works directly from the card via
 * PhoneWithClickToCall.
 *
 * Sprint 1: client-only with mock data. TanStack Query wraps a 300 ms
 * delayed fetch so the loading skeleton actually renders. Sprint 2
 * swaps the query function for the generated SDK
 * (Deals.listDeals) and adds server-side filter/sort.
 *
 * Gradient discipline (DESIGN.md): no gradient on this page — the
 * Activities-to-Win KPI on the Dashboard is the one gradient surface
 * in the entire app.
 */

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  Columns,
  List,
  PackageOpen,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  CardWithStatusBand,
  Chip,
  FormField,
  Input,
  KpiCard,
} from "@/components/navigatr";

import { useDeals } from "../hooks/useDeals";
import {
  formatMoney,
  formatRelative,
  formatShortDate,
  HEADER_SUBHEAD,
  STAGE_BAND_COLOR,
  STAGE_NEXT_VERB,
  STAGE_CHIP_COUNTS,
  STAGE_LABEL,
  type Deal,
  type DealStage,
} from "../mockData";
import { DealCardSkeleton } from "../components/DealCardSkeleton";
import { AddDealSheet } from "../components/AddDealSheet";
import { KanbanBoard } from "../components/KanbanBoard";

// ───────────────────────────────────────────────────────────────────────
// Filter / search state
// ───────────────────────────────────────────────────────────────────────

type StageFilter = "all" | DealStage;
const STAGE_FILTERS: StageFilter[] = ["all", "new", "contacted", "qualified", "proposal", "won"];

type ViewMode = "kanban" | "list";
const VIEW_MODE_KEY = "navigatr:pipeline:viewMode";

/** Persisted view-mode preference. Kanban is the desktop default; list is
 *  the only sensible mobile layout, so the parent gates kanban behind lg. */
function usePersistedViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return "kanban";
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === "list" ? "list" : "kanban";
  });
  const update = React.useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // localStorage can throw in private-mode Safari. UI keeps working
      // with in-memory state; the preference just doesn't persist.
    }
  }, []);
  return [mode, update];
}

function chipLabel(f: StageFilter): string {
  return f === "all" ? "All" : STAGE_LABEL[f];
}

/** Tiny debounce — 300 ms for search input. No external dep. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ───────────────────────────────────────────────────────────────────────
// Deal card
// ───────────────────────────────────────────────────────────────────────

/** Probability rendered as 5 dots filled left-to-right (20% per dot).
 *  Replaces the prior 1px progress bar — that read as an empty input. */
function ProbabilityDots({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value / 20)));
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-radius-full",
            i < filled ? "bg-brand-primary" : "bg-surface-sunken",
          )}
        />
      ))}
    </span>
  );
}

/** Format E.164 → "(202) 555-0199". Tolerates already-formatted strings
 *  and short / non-US numbers by falling back to the raw value. */
function formatPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  // Strip leading "1" country code if present.
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return e164;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function DealCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const nextVerb = STAGE_NEXT_VERB[deal.stage];

  return (
    <CardWithStatusBand
      bandColor={STAGE_BAND_COLOR[deal.stage]}
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      contentPadding="md"
      aria-label={`${deal.companyName}, ${formatMoney(deal.valueCents)}, next: ${nextVerb}`}
    >
      <div className="flex flex-col gap-3">
        {/* Row 1: company ↔ value. Stage band on the left already encodes
            the stage — no badge needed, freeing the right column for the
            scan-critical $value. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-body-strong text-text-default">
            {deal.companyName}
          </p>
          <span className="shrink-0 text-heading-sm tabular-nums text-text-default">
            {formatMoney(deal.valueCents)}
          </span>
        </div>

        {/* Row 2: tappable contact-and-phone pill (the primary action
            anywhere in the card except "drill in") ↔ probability dots+%. */}
        <div className="flex items-center justify-between gap-3">
          <a
            href={`tel:${deal.phone}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex min-w-0 items-center gap-2 rounded-radius-sm px-2 py-1 -mx-2",
              "text-body-sm text-text-default",
              "transition-colors hover:bg-surface-sunken",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
            )}
            aria-label={`Call ${deal.contactName} at ${formatPhoneForDisplay(deal.phone)}`}
          >
            <Phone
              className="h-3.5 w-3.5 shrink-0 text-text-muted"
              aria-hidden
            />
            <span className="truncate font-medium">{deal.contactName}</span>
            <span className="text-text-subtle">·</span>
            <span className="truncate tabular-nums text-text-muted">
              {formatPhoneForDisplay(deal.phone)}
            </span>
          </a>
          <span className="inline-flex shrink-0 items-center gap-2 text-caption text-text-muted">
            <ProbabilityDots value={deal.probability} />
            <span className="tabular-nums text-text-default">{deal.probability}%</span>
          </span>
        </div>

        {/* Action zone — hairline-separated. Promotes the next action
            from "data" (a date) to "instruction" (verb + date). The
            arrow + verb is the single most important thing on this
            card; "last touched" demotes to grey-on-grey. */}
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-body-sm text-text-default">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
            <span className="truncate font-medium">{nextVerb}</span>
            {deal.nextFollowup && (
              <span className="truncate text-text-muted">
                · <span className="tabular-nums">{formatShortDate(deal.nextFollowup)}</span>
              </span>
            )}
          </span>
          <span className="shrink-0 text-caption text-text-subtle">
            Last touched <span className="tabular-nums">{formatRelative(deal.lastActivity)}</span>
          </span>
        </div>
      </div>
    </CardWithStatusBand>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Empty + loading states
// ───────────────────────────────────────────────────────────────────────

function EmptyState({ onAddDeal }: { onAddDeal: () => void }) {
  return (
    <Card padding="xl" shadow="sm" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <PackageOpen className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No deals match</p>
        <p className="text-caption text-text-muted">
          Try a different stage filter or add a new deal.
        </p>
      </div>
      <Button variant="primary" size="sm" leadingIcon={Plus} onClick={onAddDeal}>
        Add deal
      </Button>
    </Card>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }, (_, i) => (
        <DealCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Page sections
// ───────────────────────────────────────────────────────────────────────

function PageHeader({
  search,
  onSearchChange,
  onAddDeal,
  viewMode,
  onViewModeChange,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  onAddDeal: () => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">Pipeline</h1>
        <p className="text-body-md text-text-muted">{HEADER_SUBHEAD}</p>
      </div>

      {/* Mobile FAB — fixed bottom-right above BottomNav. */}
      <Button
        variant="primary"
        size="md"
        leadingIcon={Plus}
        onClick={onAddDeal}
        className="fixed bottom-24 right-4 z-30 shadow-card-hover sm:hidden"
        aria-label="Add deal"
      >
        Add deal
      </Button>

      {/* Desktop action row */}
      <div className="hidden items-center gap-2 sm:flex">
        <div className="w-64">
          <FormField htmlFor="pipeline-search" label="Search deals" showLabel={false}>
            <Input
              id="pipeline-search"
              type="search"
              placeholder="Search deals..."
              leadingIcon={Search}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </FormField>
        </div>
        {/* Kanban/List toggle — gated to lg because kanban needs the
            5-column horizontal width. Below lg the action row collapses
            its action items but the toggle hides; users on tablet-width
            see the list view (which is also the mobile pattern). */}
        <div className="hidden lg:block">
          <ViewToggle mode={viewMode} onChange={onViewModeChange} />
        </div>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={SlidersHorizontal}
          onClick={() => toast("Advanced filters land in Sprint 2")}
        >
          Filter
        </Button>
        <Button
          variant="tertiary"
          size="md"
          trailingIcon={ChevronDown}
          onClick={() => toast("Sort options land in Sprint 2")}
        >
          {/* TODO Sprint 2: real sort dropdown. */}
          Sort: Last activity
        </Button>
        <Button variant="primary" size="md" leadingIcon={Plus} onClick={onAddDeal}>
          Add deal
        </Button>
      </div>
    </header>
  );
}

interface KpiStripProps {
  deals: Deal[] | undefined;
  /** When true, KPIs are filtered to an agent subset. */
  filtered: boolean;
}

function KpiStrip({ deals, filtered }: KpiStripProps) {
  const kpi = React.useMemo(() => {
    if (!deals || deals.length === 0) {
      return { totalPipeline: 0, weighted: 0, activeDeals: 0, wonThisMonth: 0, wonDealsThisMonth: 0 };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalPipeline = 0;
    let weighted = 0;
    let activeDeals = 0;
    let wonThisMonth = 0;
    let wonDealsThisMonth = 0;

    for (const d of deals) {
      if (d.stage === "won" || d.stage === "lost") {
        // Count won deals closed this calendar month
        if (d.stage === "won") {
          const updatedAt = new Date(d.updatedAt);
          if (updatedAt >= monthStart) {
            wonThisMonth += d.valueCents;
            wonDealsThisMonth += 1;
          }
        }
      } else {
        totalPipeline += d.valueCents;
        weighted += Math.round(d.valueCents * (d.probability / 100));
        activeDeals += 1;
      }
    }

    return { totalPipeline, weighted, activeDeals, wonThisMonth, wonDealsThisMonth };
  }, [deals]);

  function fmt(cents: number): string {
    const dollars = cents / 100;
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
    if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
    return `$${Math.round(dollars)}`;
  }

  const wonSubtitle = kpi.wonDealsThisMonth === 0
    ? "this month"
    : `${kpi.wonDealsThisMonth} ${kpi.wonDealsThisMonth === 1 ? "deal" : "deals"}`;

  return (
    <div className="hidden gap-4 md:grid md:grid-cols-4">
      <KpiCard
        eyebrow={filtered ? "PIPELINE (FILTERED)" : "TOTAL PIPELINE"}
        value={fmt(kpi.totalPipeline)}
        subtitle="open stages"
        accent="teal"
        size="standard"
      />
      <KpiCard
        eyebrow="WEIGHTED"
        value={fmt(kpi.weighted)}
        subtitle="probability·value"
        accent="violet"
        size="standard"
      />
      <KpiCard
        eyebrow="ACTIVE DEALS"
        value={String(kpi.activeDeals)}
        subtitle="across stages"
        accent="blue"
        size="standard"
      />
      <KpiCard
        eyebrow="WON THIS MONTH"
        value={fmt(kpi.wonThisMonth)}
        subtitle={wonSubtitle}
        accent="orange"
        size="standard"
      />
    </div>
  );
}

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  // Segmented control — desktop only. Reuses the existing border/surface
  // tokens; no new design primitives. Tabbed roles for screen readers.
  return (
    <div
      role="tablist"
      aria-label="Pipeline view mode"
      className="inline-flex h-10 items-center gap-1 rounded-radius-md border border-border-subtle bg-surface-sunken p-1"
    >
      {(["kanban", "list"] as const).map((m) => {
        const Icon = m === "kanban" ? Columns : List;
        const isActive = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(m)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-radius-sm px-3 text-body-sm",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
              isActive
                ? "bg-surface-default text-text-default shadow-card-default"
                : "text-text-muted hover:text-text-default",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {m === "kanban" ? "Kanban" : "List"}
          </button>
        );
      })}
    </div>
  );
}

function StageChips({
  active,
  onChange,
}: {
  active: StageFilter;
  onChange: (next: StageFilter) => void;
}) {
  return (
    <div
      className={cn(
        // Mobile: horizontal scroll with snap. Desktop: wrapping flex.
        "flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory",
        "md:flex-wrap md:overflow-x-visible md:pb-0",
        "[&::-webkit-scrollbar]:hidden",
        "[-ms-overflow-style:none] [scrollbar-width:none]",
      )}
    >
      {STAGE_FILTERS.map((f) => (
        <div key={f} className="snap-start">
          <Chip
            active={active === f}
            count={STAGE_CHIP_COUNTS[f]}
            onClick={() => onChange(f)}
          >
            {chipLabel(f)}
          </Chip>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────

export function PipelinePage() {
  const [stageFilter, setStageFilter] = React.useState<StageFilter>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const debouncedSearch = useDebounced(searchInput, 300);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = usePersistedViewMode();

  // Deep-link: /pipeline?action=add auto-opens the Add Deal sheet. We
  // strip the param after opening so a back-nav doesn't re-fire it.
  React.useEffect(() => {
    if (searchParams.get("action") === "add") {
      setSheetOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ?owner=<id> filter — set by the admin portal when drilling into one
  // agent's pipeline. A banner is shown at the top with a "Clear filter" link.
  const ownerFilter = searchParams.get("owner");

  // Reads from Supabase via RLS — server scopes to the user's org_id.
  // Stage/search filters still applied in-memory below; dataset is small
  // enough that round-tripping per chip click would be wasteful.
  const { data: deals, isLoading } = useDeals();

  const onAddDeal = () => setSheetOpen(true);

  const filtered = React.useMemo(() => {
    if (!deals) return [];
    const q = debouncedSearch.trim().toLowerCase();
    return deals.filter((d) => {
      if (ownerFilter && d.owner_id !== ownerFilter) return false;
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (q && !d.companyName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deals, stageFilter, debouncedSearch, ownerFilter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        {ownerFilter && (
          <div className="flex items-center justify-between rounded-radius-md border border-border-subtle bg-surface-sunken px-4 py-2.5 text-body-sm text-text-muted">
            <span>Viewing one agent&rsquo;s pipeline.</span>
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("owner");
                setSearchParams(next, { replace: true });
              }}
              className="text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              Clear filter
            </button>
          </div>
        )}

        <PageHeader
          search={searchInput}
          onSearchChange={setSearchInput}
          onAddDeal={onAddDeal}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        <KpiStrip deals={ownerFilter ? filtered : deals} filtered={Boolean(ownerFilter)} />

        {/* Stage chips: when kanban is the active view AND we're at lg+,
            the columns ARE the stages, so the chip filter is redundant.
            Hide it then. Below lg we always render list view, so chips
            stay. */}
        <div className={cn(viewMode === "kanban" && "lg:hidden")}>
          <StageChips active={stageFilter} onChange={setStageFilter} />
        </div>

        {isLoading ? (
          <LoadingList />
        ) : filtered.length === 0 ? (
          <EmptyState onAddDeal={onAddDeal} />
        ) : viewMode === "kanban" ? (
          <>
            {/* Kanban only renders at lg+. Below that we fall back to
                the list view of the same filtered set so mobile + tablet
                users always see SOMETHING after toggling. */}
            <div className="hidden lg:block">
              <KanbanBoard deals={filtered} />
            </div>
            <div className="flex flex-col gap-3 lg:hidden">
              {filtered.map((deal) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </div>

      <AddDealSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

export default PipelinePage;
