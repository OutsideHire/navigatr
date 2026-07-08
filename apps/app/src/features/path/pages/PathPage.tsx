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
 *
 * Path v3: view state machine — entry (no path) / active (path exists) /
 * discover (add stops). No-origin states render above the switch.
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { List, ListChecks, Loader2, LocateFixed, Lock, Map as MapIcon, MapPinned, MapPinOff, Navigation, Route as RouteIcon, Settings } from "lucide-react";

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
import { CreatePathWizard } from "../components/CreatePathWizard";
import { PlanPathWizard } from "./PlanPathWizard";
import { PathEntry } from "../components/PathEntry";
import { UpcomingPaths } from "../components/UpcomingPaths";
import { PathSettings } from "../components/PathSettings";
import { ActivePathView } from "../components/ActivePathView";
import { RunningPath } from "../components/RunningPath";
import { ResumePathCard } from "../components/ResumePathCard";
import { usePathQueue } from "../hooks/usePathQueue";
import { useTodayPath } from "../hooks/useTodayPath";
import { usePreviousUnfinishedPath } from "../hooks/usePreviousUnfinishedPath";
import { usePathMutations } from "../hooks/usePathMutations";
import { pathLanding } from "../lib/pathTypes";
import { toast } from "sonner";
import { planQueueMigration } from "../lib/migrateLocalQueue";
import { useMerchants } from "../hooks/useMerchants";
import { sortMerchants, type PathSortMode } from "../lib/sortMerchants";
import { useCalendarEvents } from "../hooks/useCalendarEvents";
import { useGeolocation } from "../hooks/useGeolocation";
import { computeFreeWindows } from "../lib/freeWindows";
import { annotateRunSchedule } from "../lib/runSchedule";

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
  const navigate = useNavigate();
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
  // Industry scope the wizard drives. `ingestAllIndustries` overrides the list
  // (fetch every bucket); otherwise the selected categories scope the ingest.
  const [ingestIndustries, setIngestIndustries] = React.useState<MerchantCategory[]>([]);
  const [ingestAllIndustries, setIngestAllIndustries] = React.useState(false);
  // Results count — how many nearby businesses the discovery fetch returns/shows
  // (the pool size, NOT the stop cap). Default 25, clamped to [1, 50] in the hook.
  const [discoverLimit, setDiscoverLimit] = React.useState(25);
  const {
    merchants: liveMerchants,
    isLoading: merchantsLoading,
    isError: merchantsError,
    refetch: refetchMerchants,
  } = useMerchants(origin, { radiusM: displayRadiusM, industries: ingestIndustries, allIndustries: ingestAllIndustries, includeChains: true, limit: discoverLimit });
  // Create a Path pulls its OWN chain-free discovery: the wizard's candidatePool
  // excludes chains, so if Create read the chains-included browse fetch above, the
  // usable pool would be `limit` minus however many chains happened to rank in —
  // the rep would ask for 25 and get fewer stops. Fetching chain-free here means
  // `limit` non-chain results, so the results count = usable stops. The browse
  // fetch above keeps chains (it badges them in the discover map/list).
  const { merchants: createMerchants } = useMerchants(origin, { radiusM: displayRadiusM, industries: ingestIndustries, allIndustries: ingestAllIndustries, includeChains: false, limit: discoverLimit });
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>("all");
  const [sortMode, setSortMode] = React.useState<PathSortMode>(DEFAULT_SORT_MODE);
  const [hideChains, setHideChains] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>("list"); // default to list until merchants are geocoded
  const [createOpen, setCreateOpen] = React.useState(false);

  // Calendar-Aware Path (Slice 1): ephemeral planning overlay. The wizard emits
  // its day time-window; we read the rep's calendar for that window and derive
  // the free gaps. Nothing here persists or touches the running path.
  const [calWindow, setCalWindow] = React.useState<{ start: string; end: string } | null>(null);
  const {
    waypoints: calWaypoints,
    timeBlocks: calTimeBlocks,
    status: calStatus,
    refetch: refetchCalendar,
  } = useCalendarEvents(calWindow);
  const calFreeWindows = React.useMemo(
    () =>
      calWindow
        ? computeFreeWindows(
            calWindow.start,
            calWindow.end,
            [...calWaypoints, ...calTimeBlocks].map((e) => ({ start: e.start, end: e.end })),
          )
        : [],
    [calWindow, calWaypoints, calTimeBlocks],
  );
  const [planOpen, setPlanOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // Path-first view state machine:
  //   "entry"    — no active path, show two-card prompt (create / plan)
  //   "path"     — a path with stops: the two-tab (Run | Stops) surface when it's
  //                in progress/completed (started_at set), or the Stops overview
  //                when it's Planned (started_at null — legacy or not-yet-started).
  //   "discover" — add-stops mode: map+list discovery, demoted from default
  const [pathView, setPathView] = React.useState<"entry" | "path" | "discover">("entry");
  // Which tab of the two-tab active-path surface is showing. TRANSIENT UI state —
  // deliberately NOT persisted across reload/return: re-entry always re-derives
  // Run @ first pending (resume-in-place). Within a session a manual switch to
  // Stops sticks until the rep leaves the Path tab.
  const [activeTab, setActiveTab] = React.useState<"run" | "stops">("run");

  // Server-backed today's path. queueStops keeps the same name so all
  // downstream route math, badge counts, etc. keep working unchanged.
  const todayPath = useTodayPath();
  const queueStops = todayPath.stops;
  const startedAt = todayPath.startedAt;
  const hasPending = queueStops.some((s) => s.status === "pending");
  const prevUnfinished = usePreviousUnfinishedPath();
  const { continuePreviousPath, closePreviousPath } = usePathMutations();

  // Route-around optimizer (Slice 2): a live, meeting-aware overlay for the
  // RUNNING path. This is independent of the planning `calWindow` above — we
  // always read TODAY's calendar so the Run tab can surface the current stop's
  // ETA and warn when it will overrun the next fixed meeting. Purely additive +
  // non-blocking: `runOverlay` stays null (nothing new renders, the running
  // card looks exactly as before) unless the calendar is connected ("ok"),
  // there is at least one meeting/time-block today, a pending stop remains, and
  // we have a start location. The overlay's current stop is the first pending
  // stop — the same one RunningPath seeks to on entry.
  const runTodayWindow = React.useMemo(() => {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString() };
  }, []);
  // Gate the read: only fire `read_calendar_events` for a STARTED path that
  // still has pending stops — the only state where the overlay can render.
  // `useCalendarEvents(null)` is a no-op (its query is `enabled` only when the
  // window is set), so a fresh/planned/finished path never touches the calendar.
  const runWindow = startedAt && hasPending ? runTodayWindow : null;
  const {
    waypoints: runWaypoints,
    timeBlocks: runTimeBlocks,
    status: runCalStatus,
  } = useCalendarEvents(runWindow);
  const runGeo = useGeolocation();
  const runOverlay = React.useMemo(() => {
    const pending = queueStops.filter((s) => s.status === "pending");
    const startLoc = runGeo.coords ?? origin;
    if (runCalStatus !== "ok" || pending.length === 0 || !startLoc) {
      return null;
    }
    const result = annotateRunSchedule({
      now: new Date().toISOString(),
      startLoc,
      stops: pending.map((s) => ({ id: s.merchantId, name: s.name, lat: s.lat, lng: s.lng })),
      waypoints: runWaypoints.map((w) => ({
        id: w.id,
        title: w.title,
        start: w.start,
        end: w.end,
        lat: w.lat,
        lng: w.lng,
      })),
      timeBlocks: runTimeBlocks.map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end })),
    });
    // Guard on the POST-drop result: annotateRunSchedule drops meetings that
    // already ended, so an afternoon rep whose only meeting is over ends up with
    // zero FUTURE meetings — no overlay (matches spec). This subsumes both the
    // "no meetings at all" and "all meetings already ended" cases, so the raw
    // runWaypoints/runTimeBlocks emptiness check is no longer needed.
    if (result.meetings.length === 0) return null;
    const current = result.stops[0];
    if (!current) return null;
    const nextMeeting = result.meetings.find((m) => m.id === current.nextMeetingId) ?? null;
    const stopsUntil = current.nextMeetingId
      ? result.stops.filter((s) => s.nextMeetingId === current.nextMeetingId).length
      : 0;
    return {
      arrive: current.arrive,
      dwellMin: 20,
      currentStopName: pending[0].name,
      nextMeeting: nextMeeting
        ? { title: nextMeeting.title, start: nextMeeting.start, located: nextMeeting.located }
        : null,
      stopsUntilNextMeeting: stopsUntil,
      fits: current.fitsBeforeNextMeeting,
    };
  }, [queueStops, runWaypoints, runTimeBlocks, runCalStatus, runGeo.coords, origin]);

  // Lifecycle landing rule (design's lifecycle table). Derives where the rep
  // lands from started_at + pending stops, uniformly across tab switch, reopen,
  // and full reload. Never override an explicit "discover" — the rep is in the
  // middle of adding stops and we shouldn't yank them back.
  const landing = pathLanding({ startedAt, hasPendingStops: hasPending });
  React.useEffect(() => {
    setPathView((v) => {
      if (v === "discover") return v;
      if (queueStops.length === 0) return "entry";
      // Stops exist:
      //  - startedAt null (Planned / legacy) → the overview ("path" w/ Stops), no
      //    auto-jump into a run.
      //  - startedAt set → the two-tab surface (also "path"); the tab is derived
      //    below.
      return "path";
    });
  }, [queueStops.length, startedAt]);

  // Resume-in-place: whenever we're on the path surface for a STARTED path, the
  // default tab is Run (RunningPath seeks the first pending stop itself; Summary
  // when complete). This effect only sets the default on entry to the surface and
  // when the lifecycle materially changes — a manual switch to Stops (setActiveTab)
  // is not clobbered because we key it on startedAt + landing, not every render.
  React.useEffect(() => {
    if (startedAt) setActiveTab("run");
  }, [startedAt, pathView === "path"]);

  // Handlers for transitioning between views.
  const enterDiscover = React.useCallback(() => setPathView("discover"), []);
  // Leave discover → "entry"; the queueStops sync effect immediately upgrades to
  // "path" when stops exist. Avoids a stale queueStops.length read right after
  // an async add.
  const handleDoneDiscovering = React.useCallback(() => setPathView("entry"), []);

  // Continue the unfinished path into today: reparent its pending stops; the
  // stops-sync effect then moves us to the active home once they land.
  const handleContinuePrevious = React.useCallback(async () => {
    if (continuePreviousPath.isPending) return;
    const prev = prevUnfinished.data;
    if (!prev) return;
    try {
      await continuePreviousPath.mutateAsync({ prevPathId: prev.pathId, prevPathDate: prev.pathDate });
    } catch {
      toast.error("Couldn't continue the path. Please try again.");
    }
  }, [prevUnfinished.data, continuePreviousPath]);

  // Starting fresh (Create / Plan) or an explicit Close finalizes any unfinished
  // path so the resume card doesn't reappear every empty morning. Fire-and-forget
  // — the detection query refreshes on success and the card disappears.
  const finalizePrevious = React.useCallback(() => {
    const prev = prevUnfinished.data;
    if (prev) closePreviousPath.mutate({ prevPathId: prev.pathId, prevPathDate: prev.pathDate });
  }, [prevUnfinished.data, closePreviousPath]);

  const handleCreate = React.useCallback(() => { if (!closePreviousPath.isPending) finalizePrevious(); setCreateOpen(true); }, [finalizePrevious, closePreviousPath.isPending]);
  // "Plan a Path" opens the stepped slide-out wizard (mode → search → results →
  // review → schedule → saved). The in-page map/list discover view is still
  // reachable via "Add stops" on an active path (ActivePathView.onAddStops).
  const handlePlan = React.useCallback(() => { if (!closePreviousPath.isPending) finalizePrevious(); setPlanOpen(true); }, [finalizePrevious, closePreviousPath.isPending]);

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

  // Same distance-annotate + radius gate as withinRadius, but over the chain-free
  // createMerchants set — this is what the Create wizard curates from, so the
  // results count maps to usable (non-chain) stops.
  const createWithinRadius = React.useMemo<MerchantWithDistance[]>(() => {
    const anyGeo = createMerchants.some((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
    const enriched = createMerchants.map((m) => ({
      ...m,
      distanceMeters:
        origin && Number.isFinite(m.lat) && Number.isFinite(m.lng)
          ? haversineMeters(origin, { lat: m.lat, lng: m.lng })
          : Number.POSITIVE_INFINITY,
    }));
    const sorted = enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return anyGeo ? sorted.filter((m) => m.distanceMeters <= displayRadiusM) : sorted;
  }, [createMerchants, origin, displayRadiusM]);

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

  // Build straight from the path's own stop snapshots — never join liveMerchants
  // (a path's stops may not be in the current browse window). Downstream consumers
  // (nearestNeighborOrder, routePath) use lat/lng/name/category; the
  // other Merchant fields aren't read for a queued stop, so a snapshot-shaped object
  // cast to Merchant is sufficient here.
  const queuedMerchants: Merchant[] = React.useMemo(
    () => queueStops.map((s) => ({
      id: s.merchantId, name: s.name, address: s.address ?? "", lat: s.lat, lng: s.lng,
      category: s.category as MerchantCategory,
    }) as Merchant),
    [queueStops],
  );

  const orderedQueue: Merchant[] = React.useMemo(() => {
    // Only the discover-branch map consumes the ordered queue / routePath.
    // Skip the O(n²) nearest-neighbor pass in every other view (entry/active/
    // running) where ActivePathView/RunningPath compute their own route.
    if (pathView !== "discover") return [];
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
  }, [pathView, queuedMerchants, origin]);

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
  // snapshots from the merchant records, write them, and close the wizard. The
  // stops-sync effect then moves the view to the active home on its own.
  const handleStartPath = React.useCallback(
    async (orderedIds: string[]) => {
      // Resolve against createMerchants — the same chain-free set the wizard
      // selected from. A non-chain stop can rank into createMerchants without
      // being in the chains-included liveMerchants (chains took nearer slots), so
      // resolving via liveMerchants would silently drop it.
      const byId = new Map(createMerchants.map((m) => [m.id, m]));
      const snapshots = orderedIds
        .map((id) => byId.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({
          prospectId: m.id, name: m.name, address: m.address ?? null,
          phone: m.phone ?? null, lat: m.lat, lng: m.lng, category: m.category, primaryType: m.primaryType ?? null,
        }));
      // Persist the whole route in two round-trips (clear + one batched addMany),
      // not a per-stop loop — otherwise the wizard close below is gated behind ~2N
      // sequential writes and the slide-out lingers for many seconds on a full
      // route. Close only on success; surface a toast (don't silently trap the
      // panel) if the write fails.
      try {
        await todayPath.clear();
        // { start: true } stamps started_at = now() so the page lands the rep
        // straight in the Run tab at stop 1 (Create a Path auto-start).
        await todayPath.addMany(snapshots, { start: true });
        setCreateOpen(false);
        // A selected stop can fall out of createMerchants if the rep tightened the
        // radius/category filter mid-wizard. Those IDs are dropped above — tell
        // the rep how many, rather than silently starting a shorter path.
        const dropped = orderedIds.length - snapshots.length;
        if (dropped > 0) {
          toast(`${dropped} stop${dropped === 1 ? "" : "s"} couldn't be added — they may be outside your current radius.`);
        }
      } catch {
        toast.error("Couldn't start the path. Please try again.");
      }
    },
    [createMerchants, todayPath],
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
          {pathView !== "path" && (
            <>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={MapPinned}
                onClick={() => setPlanOpen(true)}
              >
                Plan ahead
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={RouteIcon}
                onClick={() => setCreateOpen(true)}
                disabled={!anyGeocoded}
              >
                Create path
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={geoStatus === "loading" ? Loader2 : LocateFixed}
            onClick={useMyLocation}
            loading={geoStatus === "loading"}
          >
            {originSource === "gps" ? "Re-center" : "Use my location"}
          </Button>
          {/* Path settings — manage default industries. Visible in every
              pathView (entry / active / discover) since it lives in the
              always-rendered header action group. */}
          <Button
            variant="tertiary"
            size="sm"
            iconOnly
            leadingIcon={Settings}
            aria-label="Path settings"
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </header>

      {/* Location bar — shown only while there is NO origin yet (first load, or
          GPS blocked/unavailable) so the rep can search a city/ZIP to get unstuck;
          the no-origin cards below point here ("search a city or ZIP above").
          Hidden once an origin is set — manual city re-center is disabled for now;
          the header "Re-center" button still re-acquires GPS. */}
      {!origin && (
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
      )}

      {/* Body — structured as:
          1. No-origin states (loading / blocked / unavailable): always shown regardless
             of pathView so a rep without a location still sees the right empty state.
          2. Origin set → switch on pathView:
             - "entry":    two-card prompt (create / plan a path)
             - "path":     the active path — two-tab Run | Stops surface when
                           started (started_at set), else the Stops overview
             - "discover": filter controls + map+list discovery ladder
          Filter chips, radius/sort/hideChains controls are discovery-only and live
          exclusively inside the "discover" branch. Header + location bar are always above. */}

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
      ) : pathView === "entry" ? (
        <>
          {prevUnfinished.data && (
            <ResumePathCard
              pathDate={prevUnfinished.data.pathDate}
              pendingCount={prevUnfinished.data.pendingCount}
              onContinue={handleContinuePrevious}
              onClose={finalizePrevious}
              disabled={continuePreviousPath.isPending || closePreviousPath.isPending}
            />
          )}
          <PathEntry onCreate={handleCreate} onPlan={handlePlan} />
          {/* Upcoming (future-dated planned) paths — launch navigates to /path,
              where the today-path/discover flow takes over. */}
          <UpcomingPaths onLaunch={() => navigate("/path")} />
        </>
      ) : pathView === "path" ? (
        landing === "entry" ? (
          /* Planned / legacy (started_at null): the Stops overview only — no
             auto-run. "Start route" stamps started_at and flips to the Run tab
             (same landing as Create's auto-start). */
          <>
            <ActivePathView
              origin={origin}
              onAddStops={enterDiscover}
              onStartRoute={() => { void todayPath.start(); setActiveTab("run"); }}
            />
            <UpcomingPaths onLaunch={() => navigate("/path")} />
          </>
        ) : (
          /* In progress / completed (started_at set): the two-tab Run | Stops
             surface. Default tab is Run (resume-in-place); a manual switch to
             Stops sticks until the rep leaves the Path tab. */
          <>
            <div
              role="tablist"
              aria-label="Path view"
              className="mt-3 flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5"
            >
              {([["run", "Run", Navigation], ["stops", "Stops", ListChecks]] as const).map(
                ([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === key}
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-radius-sm px-4 py-1.5 text-caption font-medium transition-colors",
                      activeTab === key
                        ? "bg-surface-default text-text-default shadow-sm"
                        : "text-text-muted hover:text-text-default",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ),
              )}
            </div>
            {activeTab === "run" ? (
              <RunningPath
                origin={origin}
                onPause={() => setActiveTab("stops")}
                onViewPipeline={() => navigate("/pipeline")}
                onExit={() => setPathView("entry")}
                runOverlay={runOverlay}
              />
            ) : (
              <>
                <ActivePathView origin={origin} onAddStops={enterDiscover} onStartRoute={() => setActiveTab("run")} />
                <UpcomingPaths onLaunch={() => navigate("/path")} />
              </>
            )}
          </>
        )
      ) : (
        /* pathView === "discover": filter controls + map+list discovery ladder */
        <>
          <Button
            variant="tertiary"
            size="sm"
            onClick={handleDoneDiscovering}
            className="mt-3 self-start"
          >
            {queueStops.length > 0 ? "Back to path" : "Done"}
          </Button>

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

          {/* Discovery body — mobile single pane, desktop split. When nothing is
              geocoded yet, drop to a list-only single column with a banner
              explaining the missing map. When the rep has zero deals at
              all, the merchant list itself renders its empty state. */}
          {merchantsLoading ? (
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
        </>
      )}

      <MerchantDetailSheet
        merchant={selectedMerchant}
        distanceMeters={selectedDistance}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      <CreatePathWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        origin={origin ?? { lat: 0, lng: 0 }}
        merchants={createWithinRadius}
        radiusM={displayRadiusM}
        onRadiusChange={setDisplayRadiusM}
        resultsCount={discoverLimit}
        onResultsCountChange={setDiscoverLimit}
        onIndustriesChange={setIngestIndustries}
        onAllIndustriesChange={setIngestAllIndustries}
        onStart={handleStartPath}
        onWindowChange={setCalWindow}
        calendarWaypoints={calWaypoints}
        calendarTimeBlocks={calTimeBlocks}
        calendarFreeWindows={calFreeWindows}
        calendarStatus={calStatus}
        onRefreshCalendar={refetchCalendar}
      />

      <PlanPathWizard
        open={planOpen}
        onOpenChange={setPlanOpen}
        onSaved={() => setPathView("entry")}
      />

      <PathSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default PathPage;
