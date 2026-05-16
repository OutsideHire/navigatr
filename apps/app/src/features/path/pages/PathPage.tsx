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
import { List, Loader2, LocateFixed, Map as MapIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Chip } from "@/components/navigatr";

import {
  MOCK_MERCHANTS,
  STATUS_LABEL,
  type Merchant,
  type MerchantStatus,
} from "../mockData";
import { useGeolocation } from "../hooks/useGeolocation";
import { haversineMeters } from "@/lib/distance";
import { MerchantMap } from "../components/MerchantMap";
import { MerchantList, type MerchantWithDistance } from "../components/MerchantList";
import { MerchantDetailSheet } from "../components/MerchantDetailSheet";

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
          />
        </div>
        {/* List */}
        <div className={cn("min-h-0 overflow-y-auto", view === "map" && "hidden md:block")}>
          <MerchantList merchants={filtered} selectedId={selectedId} onSelect={handleSelect} />
        </div>
      </div>

      <MerchantDetailSheet
        merchant={selectedMerchant}
        distanceMeters={selectedDistance}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}

export default PathPage;
