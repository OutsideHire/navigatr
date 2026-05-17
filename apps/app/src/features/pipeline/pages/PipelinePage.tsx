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
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  Mail,
  PackageOpen,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardWithStatusBand,
  Chip,
  FormField,
  Input,
  KpiCard,
  PhoneWithClickToCall,
} from "@/components/navigatr";

import {
  fetchDealsMock,
  formatMoney,
  formatRelative,
  formatShortDate,
  HEADER_SUBHEAD,
  STAGE_BADGE_KIND,
  STAGE_BAND_COLOR,
  STAGE_CHIP_COUNTS,
  STAGE_LABEL,
  type Deal,
  type DealStage,
} from "../mockData";
import { DealCardSkeleton } from "../components/DealCardSkeleton";
import { AddDealSheet } from "../components/AddDealSheet";

// ───────────────────────────────────────────────────────────────────────
// Filter / search state
// ───────────────────────────────────────────────────────────────────────

type StageFilter = "all" | DealStage;
const STAGE_FILTERS: StageFilter[] = ["all", "new", "contacted", "qualified", "proposal", "won"];

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

function DealCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  return (
    <CardWithStatusBand
      bandColor={STAGE_BAND_COLOR[deal.stage]}
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      contentPadding="md"
    >
      <div className="flex flex-col gap-3">
        {/* Top row: company/contact ↔ value/badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-strong text-text-default">{deal.companyName}</p>
            <p className="truncate text-caption text-text-muted">{deal.contactName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-heading-sm tabular-nums text-text-default">
              {formatMoney(deal.valueCents)}
            </span>
            <Badge kind={STAGE_BADGE_KIND[deal.stage]}>
              {STAGE_LABEL[deal.stage]}
            </Badge>
          </div>
        </div>

        {/* Middle row: phone + email + headcount. flex-wrap so it stacks
            naturally on narrow widths. onClick on parent navigates; we
            stop propagation on the phone button so tel: still fires. */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <PhoneWithClickToCall phoneNumber={deal.phone} size="sm" />
          <span className="inline-flex min-w-0 items-center gap-1.5 text-body-sm text-text-muted">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{deal.email}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-body-sm text-text-muted">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {deal.employeeCountRange}
          </span>
        </div>

        {/* Probability label + bar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-caption text-text-muted">Probability</span>
            <span className="text-caption tabular-nums text-text-default">
              {deal.probability}%
            </span>
          </div>
          <div
            className="h-px w-full overflow-hidden rounded-radius-full bg-surface-sunken"
            // h-px in Tailwind = 1px tall, per spec.
          >
            <div
              className="h-full rounded-radius-full bg-brand-primary"
              style={{ width: `${deal.probability}%` }}
              aria-hidden
            />
          </div>
        </div>

        {/* Bottom row: last activity ↔ next follow-up */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-text-muted">
            Last activity: <span className="tabular-nums">{formatRelative(deal.lastActivity)}</span>
          </span>
          {deal.nextFollowup && (
            <span className="text-caption text-text-default">
              Next: <span className="tabular-nums">{formatShortDate(deal.nextFollowup)}</span>
            </span>
          )}
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
}: {
  search: string;
  onSearchChange: (s: string) => void;
  onAddDeal: () => void;
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

function KpiStrip() {
  return (
    <div className="hidden gap-4 md:grid md:grid-cols-4">
      <KpiCard eyebrow="TOTAL PIPELINE"  value="$163K" subtitle="annualized"   accent="teal"   size="standard" />
      <KpiCard eyebrow="WEIGHTED"        value="$98K"  subtitle="probability·value" accent="violet" size="standard" />
      <KpiCard eyebrow="ACTIVE DEALS"    value="47"    subtitle="across stages" accent="blue"   size="standard" />
      <KpiCard eyebrow="WON THIS MONTH"  value="$10K"  subtitle="3 deals"       accent="orange" size="standard" />
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

  // TODO Sprint 2: swap fetchDealsMock for the generated SDK
  // (Deals.listDeals) and pass stage + q as server-side params.
  const { data: deals, isLoading } = useQuery({
    queryKey: ["deals", "mock"],
    queryFn: fetchDealsMock,
  });

  const onAddDeal = () => setSheetOpen(true);

  const filtered = React.useMemo(() => {
    if (!deals) return [];
    const q = debouncedSearch.trim().toLowerCase();
    return deals.filter((d) => {
      if (stageFilter !== "all" && d.stage !== stageFilter) return false;
      if (q && !d.companyName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deals, stageFilter, debouncedSearch]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        <PageHeader
          search={searchInput}
          onSearchChange={setSearchInput}
          onAddDeal={onAddDeal}
        />

        <KpiStrip />

        <StageChips active={stageFilter} onChange={setStageFilter} />

        {/* Deal list */}
        {isLoading ? (
          <LoadingList />
        ) : filtered.length === 0 ? (
          <EmptyState onAddDeal={onAddDeal} />
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
