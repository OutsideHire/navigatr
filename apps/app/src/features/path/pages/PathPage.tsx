/**
 * Path Discovery — Session 16.
 *
 * "Find merchants near me." Mobile-first because reps live in this
 * view in the field. Map + ranked list of nearby merchants + filter
 * chips. Tapping a merchant opens a detail sheet with quick actions.
 *
 * Layout:
 *   Mobile: a Map/List toggle (Apple Maps pattern would be a draggable
 *           bottom sheet, but a tab toggle is simpler and works on
 *           every browser without gesture handling). Filters always
 *           visible above the active view.
 *   Desktop (md+): map on the left (60%), list on the right (40%),
 *           filters at top spanning both.
 *
 * Distance math: haversine from rep position. We sort the rendered
 * list and color-code pins by status. Selecting an item flies the
 * map to that pin and opens the detail sheet — works from both list
 * and map sides.
 *
 * Geolocation: useGeolocation falls back to downtown Austin if the
 * user denies or it times out, so the map always renders.
 *
 * Sprint 2: replace MOCK_MERCHANTS with Places.searchNearby calls
 * passing the ICP filter + radius. Replace the "Add to today's path"
 * stub with a real Path queue (Session 17).
 */

import * as React from "react";
import { List, Loader2, LocateFixed, Map as MapIcon, Route as RouteIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Chip } from "@/components/navigatr";

import {
  MOCK_MERCHANTS,
  STATUS_LABEL,
  type Merchant,
  type MerchantStatus,
} from "../mockData";
import { useGeolocation } from "../hooks/useGeolocation";
import { haversineMeters, nearestNeighborOrder } from "@/lib/distance";
import { MerchantMap } from "../components/MerchantMap";
import { MerchantList, type MerchantWithDistance } from "../components/MerchantList";
import { MerchantDetailSheet } from "../components/MerchantDetailSheet";
import { PathPlanSheet } from "../components/PathPlanSheet";
import { usePathQueue } from "../hooks/usePathQueue";

type StatusFilter = "all" | MerchantStatus;
const STATUS_FILTERS: StatusFilter[] = ["all", "untouched", "prospect", "active", "won", "cooled"];

function chipLabel(f: StatusFilter): string {
  return f === "all" ? "All" : STATUS_LABEL[f];
}

type ViewMode = "map" | "list";

export function PathPage() {
  const geo = useGeolocation();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>("map"); // mobile toggle
  const [planOpen, setPlanOpen] = React.useState(false);

  // Path queue selectors. queueStops is the persisted list of stops;
  // we resolve those IDs to Merchant records below and compute the
  // visit order via nearestNeighborOrder against the rep's position.
  const queueStops = usePathQueue((s) => s.stops);

  // Compute distances + sort by proximity once per geo change.
  const merchantsWithDistance: MerchantWithDistance[] = React.useMemo(() => {
    const enriched = MOCK_MERCHANTS.map((m) => ({
      ...m,
      distanceMeters: haversineMeters({ lat: geo.lat, lng: geo.lng }, { lat: m.lat, lng: m.lng }),
    }));
    return enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [geo.lat, geo.lng]);

  const filtered = React.useMemo(
    () =>
      statusFilter === "all"
        ? merchantsWithDistance
        : merchantsWithDistance.filter((m) => m.status === statusFilter),
    [merchantsWithDistance, statusFilter],
  );

  // Filter chip counts — computed once over the full set.
  const counts = React.useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: merchantsWithDistance.length,
      untouched: 0,
      prospect: 0,
      active: 0,
      won: 0,
      cooled: 0,
    };
    for (const m of merchantsWithDistance) c[m.status]++;
    return c;
  }, [merchantsWithDistance]);

  const selectedMerchant: Merchant | null = selectedId
    ? merchantsWithDistance.find((m) => m.id === selectedId) ?? null
    : null;
  const selectedDistance = selectedMerchant
    ? merchantsWithDistance.find((m) => m.id === selectedMerchant.id)?.distanceMeters
    : undefined;

  const handleSelect = (m: Merchant) => {
    setSelectedId(m.id);
    setSheetOpen(true);
  };

  // Resolve the queued IDs to full Merchant records, then run
  // nearest-neighbor against the rep's position to get the optimal
  // visit order. This is the same order that drives the map polyline
  // and PathPlanSheet's stop list — they stay in sync via this single
  // computation.
  const queuedMerchants: Merchant[] = React.useMemo(() => {
    const byId = new Map(MOCK_MERCHANTS.map((m) => [m.id, m]));
    return queueStops
      .map((s) => byId.get(s.merchantId))
      .filter((m): m is Merchant => Boolean(m));
  }, [queueStops]);

  const orderedQueue: Merchant[] = React.useMemo(() => {
    if (queuedMerchants.length === 0) return [];
    const idxOrder = nearestNeighborOrder(
      { lat: geo.lat, lng: geo.lng },
      queuedMerchants.map((m) => ({ lat: m.lat, lng: m.lng })),
    );
    return idxOrder.map((i) => queuedMerchants[i]!);
  }, [queuedMerchants, geo.lat, geo.lng]);

  // Route path = origin → each stop in order. Used by the map polyline.
  const routePath = React.useMemo(() => {
    if (orderedQueue.length === 0) return undefined;
    return [
      { lat: geo.lat, lng: geo.lng },
      ...orderedQueue.map((m) => ({ lat: m.lat, lng: m.lng })),
    ];
  }, [orderedQueue, geo.lat, geo.lng]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Path</h1>
          <p className="text-body-md text-text-muted">
            {filtered.length} {filtered.length === 1 ? "merchant" : "merchants"} nearby ·{" "}
            {geo.source === "gps" ? "from your location" : "using default location"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={geo.loading ? Loader2 : LocateFixed}
            onClick={geo.retry}
            loading={geo.loading}
          >
            {geo.source === "gps" ? "Re-center" : "Use my location"}
          </Button>
          {/* Path queue CTA — always visible. Shows count badge when
              there are queued stops. Empty state opens the sheet too
              so the user can see the "no stops yet" explanation. */}
          <Button
            variant={queueStops.length > 0 ? "primary" : "tertiary"}
            size="sm"
            leadingIcon={RouteIcon}
            onClick={() => setPlanOpen(true)}
          >
            Today&apos;s path
            {queueStops.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-radius-full bg-text-inverse/20 px-1.5 text-caption font-semibold tabular-nums">
                {queueStops.length}
              </span>
            )}
          </Button>
        </div>
      </header>

      {/* Filter chips */}
      <div
        className={cn(
          "mt-4 flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory",
          "md:flex-wrap md:overflow-x-visible md:pb-0",
          "[&::-webkit-scrollbar]:hidden",
          "[-ms-overflow-style:none] [scrollbar-width:none]",
        )}
      >
        {STATUS_FILTERS.map((f) => (
          <div key={f} className="snap-start">
            <Chip active={statusFilter === f} count={counts[f]} onClick={() => setStatusFilter(f)}>
              {chipLabel(f)}
            </Chip>
          </div>
        ))}
      </div>

      {/* Mobile view toggle */}
      <div className="mt-3 flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5 md:hidden">
        <button
          type="button"
          onClick={() => setView("map")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-radius-sm px-3 py-1.5 text-caption font-medium transition-colors",
            view === "map" ? "bg-surface-default text-text-default shadow-sm" : "text-text-muted hover:text-text-default",
          )}
        >
          <MapIcon className="h-3.5 w-3.5" aria-hidden /> Map
        </button>
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-radius-sm px-3 py-1.5 text-caption font-medium transition-colors",
            view === "list" ? "bg-surface-default text-text-default shadow-sm" : "text-text-muted hover:text-text-default",
          )}
        >
          <List className="h-3.5 w-3.5" aria-hidden /> List ({filtered.length})
        </button>
      </div>

      {/* Body — mobile single pane, desktop split */}
      <div className="mt-3 grid min-h-0 flex-1 gap-4 md:grid-cols-[1.4fr_1fr]">
        {/* Map */}
        <div className={cn("min-h-[320px]", view === "list" && "hidden md:block")}>
          <MerchantMap
            position={{ lat: geo.lat, lng: geo.lng }}
            merchants={filtered}
            focusedMerchantId={selectedId}
            onMerchantClick={handleSelect}
            routePath={routePath}
          />
        </div>
        {/* List */}
        <div className={cn("min-h-0 overflow-y-auto", view === "map" && "hidden md:block")}>
          <MerchantList
            merchants={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
            // Only show the empty-state CTA when a status filter is active —
            // otherwise the empty state means "no data at all", not "your
            // filter is too tight" and the reset CTA would be misleading.
            onResetFilters={statusFilter !== "all" ? () => setStatusFilter("all") : undefined}
          />
        </div>
      </div>

      <MerchantDetailSheet
        merchant={selectedMerchant}
        distanceMeters={selectedDistance}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      <PathPlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        origin={{ lat: geo.lat, lng: geo.lng }}
        allMerchants={MOCK_MERCHANTS}
        orderedStops={orderedQueue}
      />
    </div>
  );
}

export default PathPage;
