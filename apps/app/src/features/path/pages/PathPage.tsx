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
 * Location: usePathOrigin resolves the working location — a GPS fix, a manual
 * city/ZIP search (session-only), or none. With no origin the page shows a
 * loading spinner or an empty state; manual search is available in all states.
 *
 * Sprint 2: replace MOCK_MERCHANTS with Places.searchNearby calls
 * passing the ICP filter + radius. Replace the "Add to today's path"
 * stub with a real Path queue (Session 17).
 */

import * as React from "react";
import { List, Loader2, LocateFixed, Lock, Map as MapIcon, MapPinOff, Route as RouteIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Card, Chip } from "@/components/navigatr";

import {
  CATEGORY_LABEL,
  type Merchant,
  type MerchantCategory,
} from "../mockData";
import { usePathOrigin } from "../hooks/usePathOrigin";
import { LocationSearch } from "../components/LocationSearch";
import { haversineMeters, nearestNeighborOrder } from "@/lib/distance";
import { MerchantMap } from "../components/MerchantMap";
import { MerchantList, type MerchantWithDistance } from "../components/MerchantList";
import { MerchantDetailSheet } from "../components/MerchantDetailSheet";
import { PathPlanSheet } from "../components/PathPlanSheet";
import { CreatePathWizard } from "../components/CreatePathWizard";
import { usePathQueue } from "../hooks/usePathQueue";
import { useTodayPath } from "../hooks/useTodayPath";
import { planQueueMigration } from "../lib/migrateLocalQueue";
import { useMerchants } from "../hooks/useMerchants";
import { sortMerchants, type PathSortMode } from "../lib/sortMerchants";

// Phase 2: discovered prospects are all cold leads, so the old deal-lifecycle
// status chips (prospect/active/won/cooled) don't apply. Filter by business
// CATEGORY instead — "show me only restaurants near me today".
type CategoryFilter = "all" | MerchantCategory;

function chipLabel(f: CategoryFilter): string {
  return f === "all" ? "All" : CATEGORY_LABEL[f];
}

type ViewMode = "map" | "list";

// Radius options (miles → meters). The selected radius drives the INGEST:
// useMerchants(origin, { radiusM }) fetches + caches that whole area from Google
// (tiled across geohash cells; the Edge MAX_CELLS bounds a cold 15mi fill).
// Default is 5mi; reps working a wider territory pick 10/15mi.
const RADIUS_OPTIONS: Array<{ label: string; meters: number }> = [
  { label: "5 mi", meters: 8047 },
  { label: "10 mi", meters: 16093 },
  { label: "15 mi", meters: 24140 },
];
const DEFAULT_DISPLAY_RADIUS_M = 8047; // 5 mi
const MAX_DISPLAY_RADIUS_M = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1]!.meters; // 15 mi

// Default list ordering for the browse page (= "Find near me"): popularity, per
// the Path v2 spec. The route preview (Slice 2) defaults to opportunity.
const DEFAULT_SORT_MODE: PathSortMode = "popularity";

export function PathPage() {
  const {
    origin,
    originSource,
    originLabel,
    geoStatus,
    searching,
    searchError,
    searchLocation,
    useMyLocation,
  } = usePathOrigin();
  const [displayRadiusM, setDisplayRadiusM] = React.useState<number>(DEFAULT_DISPLAY_RADIUS_M);
  // Industry scope the wizard drives. Empty → useMerchants defaults to Tier 1.
  const [ingestIndustries, setIngestIndustries] = React.useState<MerchantCategory[]>([]);
  const {
    merchants: liveMerchants,
    isLoading: merchantsLoading,
    isError: merchantsError,
    refetch: refetchMerchants,
  } = useMerchants(origin, { radiusM: displayRadiusM, industries: ingestIndustries, includeChains: true });
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>("all");
  const [sortMode, setSortMode] = React.useState<PathSortMode>(DEFAULT_SORT_MODE);
  const [hideChains, setHideChains] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>("list"); // default to list until merchants are geocoded
  const [planOpen, setPlanOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  // Server-backed today's path. queueStops keeps the same name so all
  // downstream route math, badge counts, etc. keep working unchanged.
  const todayPath = useTodayPath();
  const queueStops = todayPath.stops;

  // One-time migration: an existing local queue -> today's server path. Runs once
  // per device when merchants are loaded (snapshots need their display fields).
  const migratedRef = React.useRef(false);
  React.useEffect(() => {
    if (migratedRef.current) return;
    const local = usePathQueue.getState().stops;
    if (local.length === 0 || liveMerchants.length === 0) return;
    migratedRef.current = true;
    const byId = new Map(liveMerchants.map((m) => [m.id, m]));
    const { snapshots } = planQueueMigration(local, byId);
    void (async () => {
      for (const snap of snapshots) await todayPath.add(snap);
      usePathQueue.getState().clear();
    })();
  }, [liveMerchants, todayPath]);

  // Are any merchants geocoded? If none have coords, the map degrades
  // to a "no map yet" state and we suppress distance math (Infinity
  // distances would dominate the sort).
  const anyGeocoded = React.useMemo(
    () => liveMerchants.some((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)),
    [liveMerchants],
  );

  // Compute distances + sort. Un-geocoded merchants get Infinity so they
  // bucket to the bottom of a mixed list. When NOTHING is geocoded, we
  // skip the distance work entirely and sort by most-recent-activity.
  const merchantsWithDistance: MerchantWithDistance[] = React.useMemo(() => {
    if (!anyGeocoded) {
      // No coordinates anywhere → sort by last activity desc, surface
      // never-touched at the bottom (most useful prioritization for
      // "who do I owe a touch to next?").
      return liveMerchants
        .map((m) => ({ ...m, distanceMeters: Number.POSITIVE_INFINITY }))
        .sort((a, b) => {
          if (!a.lastActivity && !b.lastActivity) return 0;
          if (!a.lastActivity) return 1;
          if (!b.lastActivity) return -1;
          return b.lastActivity.localeCompare(a.lastActivity);
        });
    }
    const enriched = liveMerchants.map((m) => ({
      ...m,
      distanceMeters:
        origin && Number.isFinite(m.lat) && Number.isFinite(m.lng)
          ? haversineMeters(origin, { lat: m.lat, lng: m.lng })
          : Number.POSITIVE_INFINITY,
    }));
    return enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [liveMerchants, anyGeocoded, origin]);

  // Radius gate. The chosen radius (5/10/15 mi) already drives the ingest, so
  // the server returned only rows within it — this client gate is now a
  // SECONDARY trim: it catches the haversine-vs-ST_DWithin boundary fuzz and is
  // the layer the category chips + counts + list all read from. Only applies
  // when we have coordinates to measure — when nothing is geocoded, distances
  // are Infinity and a radius gate would wipe the whole list, so we pass
  // everything through and let the activity-sorted view stand.
  const withinRadius = React.useMemo<MerchantWithDistance[]>(() => {
    if (!anyGeocoded) return merchantsWithDistance;
    return merchantsWithDistance.filter((m) => m.distanceMeters <= displayRadiusM);
  }, [merchantsWithDistance, anyGeocoded, displayRadiusM]);

  const filtered = React.useMemo(
    () =>
      categoryFilter === "all"
        ? withinRadius
        : withinRadius.filter((m) => m.category === categoryFilter),
    [withinRadius, categoryFilter],
  );

  // Final display order: category-filtered set ordered by the chosen sort mode.
  // merchantsWithDistance is already distance-sorted, so it's the stable tiebreak.
  const sorted = React.useMemo(() => {
    const base = hideChains ? filtered.filter((m) => !m.isChain) : filtered;
    return sortMerchants(base, sortMode);
  }, [filtered, sortMode, hideChains]);

  // Per-category counts over the radius-filtered set. Only categories actually
  // present within the chosen radius get a chip — no empty "Healthcare (0)"
  // noise, and counts move when the rep tightens/loosens the radius.
  const categoryCounts = React.useMemo(() => {
    const c = new Map<MerchantCategory, number>();
    for (const m of withinRadius) {
      c.set(m.category, (c.get(m.category) ?? 0) + 1);
    }
    return c;
  }, [withinRadius]);

  // Chip list: "All" first, then present categories ordered by count desc.
  const categoryFilters = React.useMemo<CategoryFilter[]>(() => {
    const present = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);
    return ["all", ...present];
  }, [categoryCounts]);

  const chipCount = (f: CategoryFilter): number =>
    f === "all" ? withinRadius.length : categoryCounts.get(f) ?? 0;

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
    const byId = new Map(liveMerchants.map((m) => [m.id, m]));
    return queueStops
      .map((s) => byId.get(s.merchantId))
      .filter((m): m is Merchant => Boolean(m));
  }, [queueStops, liveMerchants]);

  const orderedQueue: Merchant[] = React.useMemo(() => {
    if (queuedMerchants.length === 0) return [];
    // Nearest-neighbor only makes sense for geocoded stops; without
    // coords we preserve insertion order so the rep sees what they
    // added in the order they added it.
    const geocoded = queuedMerchants.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
    if (geocoded.length === 0 || !origin) return queuedMerchants;
    const idxOrder = nearestNeighborOrder(
      origin,
      geocoded.map((m) => ({ lat: m.lat, lng: m.lng })),
    );
    return idxOrder.map((i) => geocoded[i]!);
  }, [queuedMerchants, origin]);

  // Route path = origin → each stop in order. Used by the map polyline.
  // Only drawn if every stop is geocoded — partial routes are confusing.
  const routePath = React.useMemo(() => {
    if (orderedQueue.length === 0 || !origin) return undefined;
    if (!orderedQueue.every((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))) return undefined;
    return [
      origin,
      ...orderedQueue.map((m) => ({ lat: m.lat, lng: m.lng })),
    ];
  }, [orderedQueue, origin]);

  // Start a fresh path from the wizard: clear the existing server path, build
  // snapshots from the merchant records, write them, close the wizard, and open
  // the plan sheet so the rep sees their route immediately.
  const handleStartPath = React.useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(liveMerchants.map((m) => [m.id, m]));
      const snapshots = orderedIds
        .map((id) => byId.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({
          prospectId: m.id, name: m.name, address: m.address ?? null,
          lat: m.lat, lng: m.lng, category: m.category, primaryType: null,
        }));
      await todayPath.clear();
      for (const snap of snapshots) await todayPath.add(snap);
      setCreateOpen(false);
      setPlanOpen(true);
    },
    [liveMerchants, todayPath],
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Path</h1>
          <p className="text-body-md text-text-muted">
            {sorted.length} {sorted.length === 1 ? "merchant" : "merchants"}
            {anyGeocoded
              ? ` nearby · ${originSource === "manual" ? originLabel : "from your location"}`
              : " · sorted by recent activity"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={RouteIcon}
            onClick={() => setCreateOpen(true)}
            disabled={!anyGeocoded}
          >
            Create path
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={geoStatus === "loading" ? Loader2 : LocateFixed}
            onClick={useMyLocation}
            loading={geoStatus === "loading"}
          >
            {originSource === "gps" ? "Re-center" : "Use my location"}
          </Button>
          {/* Path queue CTA — always visible. Shows count badge when
              there are queued stops. Empty state opens the sheet too
              so the user can see the "no stops yet" explanation. */}
          <Button
            variant={queueStops.length > 0 ? "primary" : "tertiary"}
            size="sm"
            leadingIcon={RouteIcon}
            onClick={() => setPlanOpen(true)}
            disabled={!origin}
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

      {/* Location bar — always available so a traveling rep can re-center on a
          city even with a valid GPS fix. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 self-start">
        {originLabel && (
          <span className="text-caption text-text-muted">
            Showing: <span className="font-medium text-text-default">{originLabel}</span>
          </span>
        )}
        {/* LocationSearch focuses once, the first time autoFocus is true (one-shot),
            so landing on the empty state focuses the search but it never re-steals focus. */}
        <LocationSearch onSearch={searchLocation} searching={searching} error={searchError} autoFocus={!origin} />
        {originSource === "manual" && (
          <Button variant="tertiary" size="sm" leadingIcon={LocateFixed} onClick={useMyLocation}>
            Use my location
          </Button>
        )}
      </div>

      {/* Filter chips */}
      <div
        className={cn(
          "mt-4 flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory",
          "md:flex-wrap md:overflow-x-visible md:pb-0",
          "[&::-webkit-scrollbar]:hidden",
          "[-ms-overflow-style:none] [scrollbar-width:none]",
        )}
      >
        {categoryFilters.map((f) => (
          <div key={f} className="snap-start">
            <Chip active={categoryFilter === f} count={chipCount(f)} onClick={() => setCategoryFilter(f)}>
              {chipLabel(f)}
            </Chip>
          </div>
        ))}
      </div>

      {/* Radius control — filters the loaded list by distance. Only useful
          once we have coordinates to measure against, so it mirrors the map's
          geocoded gate. Labels in miles to match the list's distance display. */}
      {anyGeocoded && (
        <div className="mt-3 flex items-center gap-2 self-start">
          <span className="text-caption font-medium text-text-muted">Within</span>
          <div className="flex gap-1 rounded-radius-md bg-surface-sunken p-0.5">
            {RADIUS_OPTIONS.map((opt) => (
              <button
                key={opt.meters}
                type="button"
                onClick={() => setDisplayRadiusM(opt.meters)}
                aria-pressed={displayRadiusM === opt.meters}
                className={cn(
                  "inline-flex items-center rounded-radius-sm px-3 py-1.5 text-caption font-medium tabular-nums transition-colors",
                  displayRadiusM === opt.meters
                    ? "bg-surface-default text-text-default shadow-sm"
                    : "text-text-muted hover:text-text-default",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {anyGeocoded && (
        <div className="mt-2 flex items-center gap-2 self-start">
          <span className="text-caption font-medium text-text-muted">Sort</span>
          <div
            role="group"
            aria-label="Sort merchants"
            className="flex gap-1 rounded-radius-md bg-surface-sunken p-0.5"
          >
            {([
              { label: "Popular", mode: "popularity" },
              { label: "Nearest", mode: "distance" },
              { label: "Opportunity", mode: "opportunity" },
            ] as Array<{ label: string; mode: PathSortMode }>).map((opt) => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => setSortMode(opt.mode)}
                aria-pressed={sortMode === opt.mode}
                className={cn(
                  "inline-flex items-center rounded-radius-sm px-3 py-1.5 text-caption font-medium transition-colors",
                  sortMode === opt.mode
                    ? "bg-surface-default text-text-default shadow-sm"
                    : "text-text-muted hover:text-text-default",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {anyGeocoded && (
        <label className="mt-2 flex items-center gap-2 self-start text-caption text-text-muted">
          <input
            type="checkbox"
            checked={hideChains}
            onChange={(e) => setHideChains(e.target.checked)}
            className="h-4 w-4 rounded border-border-default"
          />
          Hide chains
        </label>
      )}

      {/* Mobile view toggle — only shown when the map has something to render */}
      {anyGeocoded && (
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
          <List className="h-3.5 w-3.5" aria-hidden /> List ({sorted.length})
        </button>
      </div>
      )}

      {/* Body — mobile single pane, desktop split. When nothing is
          geocoded yet, drop to a list-only single column with a banner
          explaining the missing map. When the rep has zero deals at
          all, the merchant list itself renders its empty state. */}
      {!origin && geoStatus === "loading" ? (
        <div className="mt-6 flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
          <p className="text-caption text-text-muted">Finding your location…</p>
        </div>
      ) : !origin ? (
        <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <MapPinOff className="h-6 w-6" aria-hidden />
          </span>
          {geoStatus === "denied" ? (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-heading-sm text-text-default">Location is blocked for this site</p>
                <p className="text-body-md text-text-muted">
                  Find prospects by searching a city or ZIP above, or turn your location back on:
                </p>
              </div>
              {/* Steps shown inline (not collapsed) — a blocked rep who needs their
                  real location must see the fix without hunting for a disclosure. */}
              <div className="mt-1 w-full max-w-md rounded-radius-md border border-border-default bg-surface-sunken/50 p-4 text-left">
                <p className="flex items-center gap-2 text-body-strong text-text-default">
                  <Lock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                  Re-enable location
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-body-sm text-text-muted">
                  <li>Click the site-info icon (a lock or sliders) in your browser&apos;s address bar.</li>
                  <li>Set Location to &ldquo;Allow.&rdquo; This page updates on its own in most browsers — otherwise reload.</li>
                </ol>
              </div>
            </>
          ) : (
            // Any non-denied null-origin state (unavailable / timeout): a retry can
            // genuinely help, so offer "Try again" alongside the search.
            <>
              <div className="flex flex-col gap-1">
                <p className="text-heading-sm text-text-default">We couldn&apos;t get your location</p>
                <p className="text-body-md text-text-muted">
                  Try again, or search a city or ZIP above to find prospects.
                </p>
              </div>
              <Button variant="secondary" size="sm" leadingIcon={LocateFixed} onClick={useMyLocation}>
                Try again
              </Button>
            </>
          )}
        </Card>
      ) : merchantsLoading ? (
        <div className="mt-6 flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
          <p className="text-caption text-text-muted">Discovering businesses nearby…</p>
        </div>
      ) : merchantsError ? (
        <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-warning-bg text-status-warning">
            <MapPinOff className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">Couldn&apos;t load prospects</p>
            <p className="text-body-md text-text-muted">
              Something went wrong reaching the discovery service. Try again in a moment.
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={LocateFixed} onClick={refetchMerchants}>
            Retry
          </Button>
        </Card>
      ) : liveMerchants.length === 0 ? (
        <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <RouteIcon className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">No prospects nearby</p>
            <p className="text-body-md text-text-muted">
              We didn&apos;t find any in-profile businesses within range of{" "}
              {originSource === "manual" ? originLabel : "your location"}. Try a wider radius,
              a different area, or search another city above.
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={LocateFixed} onClick={useMyLocation}>
            {originSource === "gps" ? "Re-center" : "Use my location"}
          </Button>
        </Card>
      ) : (
      <div className={cn(
        "mt-3 grid min-h-0 flex-1 gap-4",
        anyGeocoded && "md:grid-cols-[1.4fr_1fr]",
      )}>
        {/* Map — only when at least one merchant is geocoded. */}
        {anyGeocoded ? (
          <div className={cn("min-h-[320px]", view === "list" && "hidden md:block")}>
            <MerchantMap
              position={origin}
              merchants={sorted.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))}
              focusedMerchantId={selectedId}
              onMerchantClick={handleSelect}
              routePath={routePath}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-radius-md border border-dashed border-border-default bg-surface-sunken/40 p-3 md:hidden">
            <MapPinOff className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <p className="text-caption text-text-muted">
              Map view appears once prospects with map coordinates load.
            </p>
          </div>
        )}
        {/* List */}
        <div className={cn(
          "min-h-0 overflow-y-auto",
          anyGeocoded && view === "map" && "hidden md:block",
        )}>
          <MerchantList
            merchants={sorted}
            selectedId={selectedId}
            onSelect={handleSelect}
            // Show the empty-state CTA when a category OR a tighter-than-max
            // radius is hiding rows — resetting both is what un-hides them.
            // (When the whole discovery came back empty, PathPage renders the
            // "No prospects nearby" card above instead, so we never get here.)
            onResetFilters={
              categoryFilter !== "all" || displayRadiusM < MAX_DISPLAY_RADIUS_M
                ? () => {
                    setCategoryFilter("all");
                    setDisplayRadiusM(MAX_DISPLAY_RADIUS_M);
                  }
                : undefined
            }
          />
        </div>
      </div>
      )}

      <MerchantDetailSheet
        merchant={selectedMerchant}
        distanceMeters={selectedDistance}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      <PathPlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        origin={origin ?? { lat: 0, lng: 0 }}
        allMerchants={liveMerchants}
        orderedStops={orderedQueue}
      />

      <CreatePathWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        origin={origin ?? { lat: 0, lng: 0 }}
        merchants={withinRadius}
        radiusM={displayRadiusM}
        onRadiusChange={setDisplayRadiusM}
        onIndustriesChange={setIngestIndustries}
        onStart={handleStartPath}
      />
    </div>
  );
}

export default PathPage;
