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
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Columns,
  List,
  PackageOpen,
  Plus,
  Search,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  Chip,
  FormField,
  Input,
  Select,
} from "@/components/navigatr";

import { sortDeals, DEAL_SORT_LABEL, type DealSortKey } from "../lib/sortDeals";
import { applyDealFilters, EMPTY_DEAL_FILTERS, type DealFilters } from "../lib/filterDeals";
import { PipelineFilterPopover } from "../components/PipelineFilterPopover";

import { useDeals } from "../hooks/useDeals";
import {
  STAGE_CHIP_COUNTS,
  STAGE_LABEL,
  formatShortDate,
  type Deal,
  type DealStage,
} from "../mockData";
import { DealCard } from "../components/DealCard";
import { DealCardSkeleton } from "../components/DealCardSkeleton";
import { AddDealSheet } from "../components/AddDealSheet";
import { KanbanBoard } from "../components/KanbanBoard";
import { StageUpdateModal } from "../components/StageUpdateModal";
import { appendStageNote } from "../lib/stageNote";
import { useUpdateDeal } from "../hooks/useUpdateDeal";
import { useTerm, useTermCapitalized } from "@/features/profession/useTerm";

// ───────────────────────────────────────────────────────────────────────
// KPI math
// ───────────────────────────────────────────────────────────────────────

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
// Empty + loading states
// ───────────────────────────────────────────────────────────────────────

function EmptyState({ onAddDeal }: { onAddDeal: () => void }) {
  const deals = useTerm("deals");
  const deal = useTerm("deal");
  return (
    <Card padding="xl" shadow="sm" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <PackageOpen className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No {deals} match</p>
        <p className="text-caption text-text-muted">
          Try a different stage filter or add a new {deal}.
        </p>
      </div>
      <Button variant="primary" size="sm" leadingIcon={Plus} onClick={onAddDeal}>
        Add {deal}
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
  subhead,
  filters,
  onFiltersChange,
  sortKey,
  onSortChange,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  onAddDeal: () => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  subhead: string;
  filters: DealFilters;
  onFiltersChange: (f: DealFilters) => void;
  sortKey: DealSortKey;
  onSortChange: (k: DealSortKey) => void;
}) {
  // Profession-aware labels. Page title uses the capitalized form
  // (sentence-start); inline noun usage stays lowercase.
  const pipelineTitle = useTermCapitalized("pipeline");
  const dealsNoun = useTerm("deals");
  const dealNoun = useTerm("deal");
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">{pipelineTitle}</h1>
        <p className="text-body-md text-text-muted">{subhead}</p>
      </div>

      {/* Mobile FAB — fixed bottom-right above BottomNav. */}
      <Button
        variant="primary"
        size="md"
        leadingIcon={Plus}
        onClick={onAddDeal}
        className="fixed bottom-24 right-4 z-30 shadow-card-hover sm:hidden"
        aria-label={`Add ${dealNoun}`}
      >
        Add {dealNoun}
      </Button>

      {/* Desktop action row */}
      <div className="hidden items-center gap-2 sm:flex">
        <div className="w-64">
          <FormField htmlFor="pipeline-search" label={`Search ${dealsNoun}`} showLabel={false}>
            <Input
              id="pipeline-search"
              type="search"
              placeholder={`Search ${dealsNoun}...`}
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
        <PipelineFilterPopover filters={filters} onChange={onFiltersChange} />
        <Select
          aria-label="Sort deals"
          value={sortKey}
          onValueChange={(v) => onSortChange(v as DealSortKey)}
          options={(Object.keys(DEAL_SORT_LABEL) as DealSortKey[]).map((k) => ({ value: k, label: `Sort: ${DEAL_SORT_LABEL[k]}` }))}
        />
        <Button variant="primary" size="md" leadingIcon={Plus} onClick={onAddDeal}>
          Add {dealNoun}
        </Button>
      </div>
    </header>
  );
}

const KPI_DOT: Record<string, string> = {
  teal: "bg-accent-teal", violet: "bg-accent-violet", blue: "bg-accent-blue", success: "bg-status-success",
};

function KpiStrip({ deals, filtered }: { deals: Deal[] | undefined; filtered: boolean }) {
  const k = React.useMemo(() => computeKpis(deals), [deals]);
  const tiles = [
    { dot: "teal",    eyebrow: filtered ? "Pipeline (filtered)" : "Total pipeline", value: fmtMoneyShort(k.totalPipeline) },
    { dot: "violet",  eyebrow: "Weighted",       value: fmtMoneyShort(k.weighted) },
    { dot: "blue",    eyebrow: "Active deals",   value: String(k.activeDeals) },
    { dot: "success", eyebrow: "Won this month", value: fmtMoneyShort(k.wonThisMonth) },
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
  const [addStage, setAddStage] = React.useState<DealStage | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = usePersistedViewMode();
  const [filters, setFilters] = React.useState<DealFilters>(EMPTY_DEAL_FILTERS);
  const [sortKey, setSortKey] = React.useState<DealSortKey>("last_activity");

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
  const update = useUpdateDeal();
  const [pendingDrop, setPendingDrop] = React.useState<{ deal: Deal; toStage: DealStage } | null>(null);

  const onAddDeal = () => setSheetOpen(true);

  const handleDropConfirm = async (probability: number, note: string) => {
    if (!pendingDrop) return;
    const { deal: dd, toStage } = pendingDrop;
    try {
      await update.mutateAsync({
        id: dd.id,
        patch: { stage: toStage, probability, notes: appendStageNote(dd.notes, dd.stage, toStage, note, formatShortDate(new Date().toISOString())) },
      });
      toast.success(`Moved to ${STAGE_LABEL[toStage]}`);
      setPendingDrop(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update stage");
    }
  };

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

  const visible = React.useMemo(
    () => sortDeals(applyDealFilters(filtered, filters), sortKey),
    [filtered, filters, sortKey],
  );

  const headerKpis = React.useMemo(() => computeKpis(ownerFilter ? filtered : deals), [deals, filtered, ownerFilter]);
  const subhead = `${headerKpis.activeDeals} active deals · ${fmtMoneyShort(headerKpis.weighted)} weighted`;

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
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
          subhead={subhead}
          filters={filters}
          onFiltersChange={setFilters}
          sortKey={sortKey}
          onSortChange={setSortKey}
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
        ) : visible.length === 0 ? (
          <EmptyState onAddDeal={onAddDeal} />
        ) : viewMode === "kanban" ? (
          <>
            {/* Kanban only renders at lg+. Below that we fall back to
                the list view of the same filtered set so mobile + tablet
                users always see SOMETHING after toggling. */}
            <div className="hidden lg:block">
              <KanbanBoard
                deals={visible}
                onAddToStage={(s) => { setAddStage(s); setSheetOpen(true); }}
                onDropDeal={(id, stage) => {
                  const dd = (deals ?? []).find((x) => x.id === id);
                  if (dd && dd.stage !== stage) setPendingDrop({ deal: dd, toStage: stage });
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden">
              {visible.map((deal) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visible.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </div>

      <AddDealSheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setAddStage(undefined); }} defaultStage={addStage} />

      <StageUpdateModal
        open={!!pendingDrop}
        onOpenChange={(o) => { if (!o) setPendingDrop(null); }}
        deal={pendingDrop?.deal ?? null}
        toStage={pendingDrop?.toStage ?? null}
        busy={update.isPending}
        onConfirm={handleDropConfirm}
      />
    </div>
  );
}

export default PipelinePage;
