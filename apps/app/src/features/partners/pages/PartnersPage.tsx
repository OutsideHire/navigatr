/**
 * Partners list view — Session 19.
 *
 * Mirrors the Pipeline list pattern: header with subhead + actions,
 * filter chips, sorted card list. Tap a partner → detail at
 * /partners/:partnerId.
 *
 * Sprint 1: client-side mock. The list reads MOCK_PARTNERS, cross-
 * references MOCK_DEALS for attributed revenue, sorts by the
 * selected order. Add Partner sheet appends to the in-memory array.
 *
 * TODO Sprint 2: replace MOCK_PARTNERS with PartnersService.list and
 * the attribution computation with a server-side aggregation.
 */

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  FormField,
  Input,
} from "@/components/navigatr";

import {
  STATUS_BADGE_KIND,
  STATUS_LABEL,
  TYPE_LABEL,
  formatRelativeLastTouch,
  type Partner,
  type PartnerStatus,
} from "../mockData";
import { formatMoney } from "@/features/pipeline/mockData";
import { AddPartnerSheet } from "../components/AddPartnerSheet";
import { usePartners } from "../hooks/usePartners";
import { useDeals } from "@/features/pipeline/hooks/useDeals";

type StatusFilter = "all" | PartnerStatus;
const STATUS_FILTERS: StatusFilter[] = ["all", "active", "cooling", "inactive"];

function statusFilterLabel(f: StatusFilter): string {
  return f === "all" ? "All" : STATUS_LABEL[f];
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Pre-compute revenue-by-partner from live data. Built once per
 *  partners + deals snapshot, not per card render. Replaces the prior
 *  pattern that walked MOCK_DEALS on every render — when this page
 *  scales to hundreds of partners + deals, the per-render cost was
 *  real (~N×M lookups per sort comparison). */
function useRevenueByPartner(
  partners: ReadonlyArray<Partner>,
  deals: ReadonlyArray<{ id: string; valueCents: number }>,
): Map<string, number> {
  return React.useMemo(() => {
    const dealById = new Map(deals.map((d) => [d.id, d]));
    const revenueById = new Map<string, number>();
    for (const p of partners) {
      let sum = 0;
      for (const id of p.attributedDealIds) {
        const d = dealById.get(id);
        if (d) sum += d.valueCents;
      }
      revenueById.set(p.id, sum);
    }
    return revenueById;
  }, [partners, deals]);
}

function PartnerCard({ partner, revenue }: { partner: Partner; revenue: number }) {
  const navigate = useNavigate();
  const referrals = partner.attributedDealIds.length;

  return (
    <Card
      padding="md"
      onClick={() => navigate(`/partners/${partner.id}`)}
      className="transition-shadow hover:shadow-card-hover"
    >
      <div className="flex items-start gap-3">
        <Avatar alt={partner.name} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-body-strong text-text-default">{partner.name}</p>
              <p className="truncate text-caption text-text-muted">
                {TYPE_LABEL[partner.type]} · {partner.company}
              </p>
            </div>
            <Badge kind={STATUS_BADGE_KIND[partner.status]}>
              {STATUS_LABEL[partner.status]}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden />
              <span className="tabular-nums text-text-default">{referrals}</span>{" "}
              {referrals === 1 ? "referral" : "referrals"}
            </span>
            {revenue > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="tabular-nums text-text-default">{formatMoney(revenue)}</span>{" "}
                attributed
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              Last touch:{" "}
              <span className="tabular-nums text-text-default">
                {formatRelativeLastTouch(partner.lastTouch)}
              </span>
            </span>
            {partner.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden />
                {partner.city}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-text-subtle" aria-hidden />
      </div>
    </Card>
  );
}

type SortMode = "revenue" | "name" | "last-touch";

export function PartnersPage() {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const debouncedSearch = useDebounced(searchInput, 300);
  const [sortMode] = React.useState<SortMode>("revenue");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Live data — useCreatePartner invalidates the partners cache on
  // success, so newly added partners surface without a refreshKey hack.
  const { data: partners = [] } = usePartners();
  const { data: deals = [] } = useDeals();

  // Single shared lookup map — every "what's their revenue" question
  // resolves with one O(1) lookup instead of rebuilding per render.
  const revenueByPartner = useRevenueByPartner(partners, deals);
  const getRevenue = React.useCallback(
    (p: Partner) => revenueByPartner.get(p.id) ?? 0,
    [revenueByPartner],
  );

  // Deep link: /partners?action=add auto-opens the sheet (called from
  // the empty Dashboard's "Add your first partner" setup card).
  React.useEffect(() => {
    if (searchParams.get("action") === "add") {
      setSheetOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filtered = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const base = partners.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (q && !`${p.name} ${p.company}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...base];
    if (sortMode === "revenue") {
      sorted.sort((a, b) => {
        const diff = getRevenue(b) - getRevenue(a);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sortMode === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => {
        if (!a.lastTouch && !b.lastTouch) return a.name.localeCompare(b.name);
        if (!a.lastTouch) return 1;
        if (!b.lastTouch) return -1;
        return b.lastTouch.localeCompare(a.lastTouch);
      });
    }
    return sorted;
  }, [partners, statusFilter, debouncedSearch, sortMode, getRevenue]);

  const counts = React.useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: partners.length,
      active: 0,
      cooling: 0,
      inactive: 0,
    };
    for (const p of partners) c[p.status]++;
    return c;
  }, [partners]);

  const totalAttributed = React.useMemo(() => {
    let sum = 0;
    for (const v of revenueByPartner.values()) sum += v;
    return sum;
  }, [revenueByPartner]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Partners</h1>
            <p className="text-body-md text-text-muted">
              {partners.length} {partners.length === 1 ? "partner" : "partners"}
              {totalAttributed > 0 && (
                <>
                  {" "}
                  · <span className="tabular-nums">{formatMoney(totalAttributed)}</span> attributed
                </>
              )}
            </p>
          </div>

          {/* Mobile FAB */}
          <Button
            variant="primary"
            size="md"
            leadingIcon={Plus}
            onClick={() => setSheetOpen(true)}
            className="fixed bottom-24 right-4 z-30 shadow-card-hover sm:hidden"
            aria-label="Add partner"
          >
            Add partner
          </Button>

          {/* Desktop action row */}
          <div className="hidden items-center gap-2 sm:flex">
            <div className="w-64">
              <FormField htmlFor="partner-search" label="Search partners" showLabel={false}>
                <Input
                  id="partner-search"
                  type="search"
                  placeholder="Search partners..."
                  leadingIcon={Search}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
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
              {sortMode === "revenue"
                ? "Sort: Revenue"
                : sortMode === "name"
                  ? "Sort: Name"
                  : "Sort: Last touch"}
            </Button>
            <Button
              variant="primary"
              size="md"
              leadingIcon={Plus}
              onClick={() => setSheetOpen(true)}
            >
              Add partner
            </Button>
          </div>
        </header>

        {/* Status chips */}
        <div
          className={cn(
            "flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory",
            "md:flex-wrap md:overflow-x-visible md:pb-0",
            "[&::-webkit-scrollbar]:hidden",
            "[-ms-overflow-style:none] [scrollbar-width:none]",
          )}
        >
          {STATUS_FILTERS.map((f) => (
            <div key={f} className="snap-start">
              <Chip
                active={statusFilter === f}
                count={counts[f]}
                onClick={() => setStatusFilter(f)}
              >
                {statusFilterLabel(f)}
              </Chip>
            </div>
          ))}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          partners.length === 0 ? (
            <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
                <Users className="h-6 w-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-body-strong text-text-default">No partners yet</p>
                <p className="text-caption text-text-muted">
                  Add your first CPA, banker, attorney, or other referral source.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Plus}
                onClick={() => setSheetOpen(true)}
              >
                Add partner
              </Button>
            </Card>
          ) : (
            <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
                <Users className="h-6 w-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-body-strong text-text-default">No partners match</p>
                <p className="text-caption text-text-muted">Try a different filter or search.</p>
              </div>
              {statusFilter !== "all" && (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={ArrowRight}
                  onClick={() => setStatusFilter("all")}
                >
                  Show all
                </Button>
              )}
            </Card>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((p) => (
              <PartnerCard key={p.id} partner={p} revenue={getRevenue(p)} />
            ))}
          </div>
        )}
      </div>

      <AddPartnerSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onAdded={() => {
          // useCreatePartner invalidates the partners cache on success;
          // the list re-fetches automatically. The callback exists so
          // the parent could navigate or focus — currently a no-op.
        }}
      />
    </div>
  );
}

export default PartnersPage;
