/**
 * Path Discovery — Session 16.
 *
 * "Find merchants near me." Mobile-first because reps live in this
 * view in the field. Map + ranked list of nearby merchants + filter
 * chips. Tapping a merchant opens a detail sheet with quick actions.
 *
 * Layout:
 *   Mobile: list-first, with a Show/Hide map toggle (the map defaults
 *           hidden so it never eats the small screen). Filters always
 *           visible above the list.
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
import { Loader2, LocateFixed, Lock, Map as MapIcon, MapPinned, MapPinOff, Navigation, Plus, Route as RouteIcon, Settings } from "lucide-react";

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
import { TodaysPathView, ADD_NEARBY_ENABLED } from "../components/TodaysPathView";
import { PathOverflowSheet } from "../components/PathOverflowSheet";
import { UpcomingPaths } from "../components/UpcomingPaths";
import { PathSettings } from "../components/PathSettings";
import { RunningPath } from "../components/RunningPath";
import { ResumePathCard } from "../components/ResumePathCard";
import { usePathQueue } from "../hooks/usePathQueue";
import { useTodayPath } from "../hooks/useTodayPath";
import { usePreviousUnfinishedPath } from "../hooks/usePreviousUnfinishedPath";
import { usePathMutations } from "../hooks/usePathMutations";
import { toast } from "sonner";
import { planQueueMigration } from "../lib/migrateLocalQueue";
import { useMerchants } from "../hooks/useMerchants";
import { discoveryShortfallHint } from "../lib/discoveryHint";
import { sortMerchants, type PathSortMode } from "../lib/sortMerchants";
import { daySubhead } from "../lib/daySubhead";
import { useCalendarEvents } from "../hooks/useCalendarEvents";
import { computeFreeWindows } from "../lib/freeWindows";
import { pickNextMeeting, fitsBeforeMeeting } from "../lib/discoverFit";
import { DiscoverMeetingBanner } from "../components/DiscoverMeetingBanner";
import { useQueryClient } from "@tanstack/react-query";
import { useOwedVisits } from "../hooks/useOwedVisits";
import { useTodaysPath } from "../hooks/useTodaysPath";
import { useBackfillOwedCoords } from "../hooks/useBackfillOwedCoords";
import type { OrderedStop } from "../lib/todaysPath";
import { OwedVisitsList, type OwedVisitRow } from "../components/OwedVisitsList";
import type { OwedVisit } from "../lib/owedVisits";
import { useTaskMutations } from "@/features/activities/hooks/useTaskMutations";
import { usePathPreferences } from "../hooks/usePathPreferences";
import { selectedCategories } from "../lib/industrySelection";

// Phase 2: discovered prospects are all cold leads, so the old deal-lifecycle
// status chips (prospect/active/won/cooled) don't apply. Filter by business
// CATEGORY instead — "show me only restaurants near me today".
type CategoryFilter = "all" | MerchantCategory;

function chipLabel(f: CategoryFilter): string {
  return f === "all" ? "All" : CATEGORY_LABEL[f];
}

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
  // Seed the discover ingest from the rep's effective default industries so the
  // first browse fetch scopes to relevant buckets, not an empty set. Runs ONCE,
  // the first time the preference query resolves (guarded by a ref) so a later
  // refetch OR a rep's in-session edit via the CreatePathWizard
  // (onIndustriesChange / onAllIndustriesChange) is never clobbered. Note
  // `usePathPreferences` substitutes a recommended set when the rep has saved
  // nothing, so `selectedCategories` is effectively always non-empty here: a
  // no-saved rep is seeded to the recommended industries (relevant defaults),
  // not raw "all". The all-industries branch is a defensive fallback only.
  const { data: pathPrefs } = usePathPreferences();
  const industriesSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (industriesSeededRef.current || !pathPrefs) return;
    industriesSeededRef.current = true;
    const seed = selectedCategories(pathPrefs);
    if (seed.length > 0) {
      setIngestIndustries(seed);
      setIngestAllIndustries(false);
    } else {
      // Unreachable in practice (see note above); fall back to all industries.
      setIngestAllIndustries(true);
    }
  }, [pathPrefs]);
  // Results count — how many nearby businesses the discovery fetch returns/shows
  // (the pool size, NOT the stop cap). Default 25, clamped to [1, 50] in the hook.
  const [discoverLimit, setDiscoverLimit] = React.useState(25);
  const {
    merchants: liveMerchants,
    isLoading: merchantsLoading,
    isError: merchantsError,
    refetch: refetchMerchants,
  } = useMerchants(origin, { radiusM: displayRadiusM, industries: ingestIndustries, allIndustries: ingestAllIndustries, includeChains: false, limit: discoverLimit });
  // Chains are excluded from ALL Path discovery (this browse fetch, Create
  // below, and Plan), org-wide, with no toggle: chain locations can't make local
  // buying decisions, so they are never surfaced. Create keeps its own fetch so
  // its fillToLimit auto-widen runs only while the wizard is open, not on every
  // Path page load.
  const [createOpen, setCreateOpen] = React.useState(false);
  const {
    merchants: createMerchants,
    hidden: createHidden,
    effectiveRadiusM: createEffectiveRadiusM,
    requestedRadiusM: createRequestedRadiusM,
    requestedLimit: createRequestedLimit,
  } = useMerchants(origin, { radiusM: displayRadiusM, industries: ingestIndustries, allIndustries: ingestAllIndustries, includeChains: false, limit: discoverLimit, fillToLimit: createOpen });
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>("all");
  const [sortMode, setSortMode] = React.useState<PathSortMode>(DEFAULT_SORT_MODE);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Show/Hide map (Path QA R4). Default HIDDEN so mobile leads with the list and
  // the map never eats the small screen. Desktop always shows the map regardless
  // of this state (the toggle and this flag only govern mobile) — see the
  // `md:block` gate on the map pane and the `md:hidden` gate on the toggle.
  const [mapVisible, setMapVisible] = React.useState(false);

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
  //   "path"     — a path with stops: the card-first active-RUN surface when it's
  //                in progress/completed (started_at set), or the Stops overview
  //                when it's Planned (started_at null — legacy or not-yet-started).
  //   "discover" — add-stops mode: map+list discovery, demoted from default
  const [pathView, setPathView] = React.useState<"entry" | "path" | "discover">("entry");

  // Server-backed today's path. queueStops keeps the same name so all
  // downstream route math, badge counts, etc. keep working unchanged.
  const todayPath = useTodayPath();
  const queueStops = todayPath.stops;
  const startedAt = todayPath.startedAt;
  const hasPending = queueStops.some((s) => s.status === "pending");
  const prevUnfinished = usePreviousUnfinishedPath();
  const { continuePreviousPath, closePreviousPath } = usePathMutations();

  // Auto-built Today's Path (SP-B1/B2): the prioritized proposal the entry
  // landing renders as its primary content. THIN: the assembler owns all
  // ordering/selection; here we only read it and hand its flexible stops to the
  // same create+start mechanism `handleStartPath` uses.
  const todaysPath = useTodaysPath(origin);

  // Lazy geocode: owed drop-ins that surfaced in "No location yet" BUT carry a
  // street address get geocoded once (per dealId, per session) and their lat/lng
  // stamped, so they graduate into the routed path on the next read. Only stubs
  // with an address are eligible.
  const noLocationWithAddress = React.useMemo(
    () => todaysPath.noLocation.filter((s) => Boolean(s.address && s.address.trim())),
    [todaysPath.noLocation],
  );
  useBackfillOwedCoords(noLocationWithAddress);

  // TODAY's calendar, read live for the discover view's meeting-aware banner +
  // drop-in fit flags (below). Independent of the planning `calWindow` above.
  // The running Driving screen now composes its own day view via
  // useDrivingSequence inside RunningPath, so PathPage no longer computes a
  // separate run overlay here.
  const runTodayWindow = React.useMemo(() => {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString() };
  }, []);
  // Gate the read: fire `read_calendar_events` for a STARTED path that still
  // has pending stops (the run overlay) OR whenever the discover view is active
  // (the meeting-aware banner + fit flags). Both reads use the SAME today window,
  // so TanStack dedupes them to one cached fetch. `useCalendarEvents(null)` is a
  // no-op (its query is `enabled` only when the window is set), so entry / planned
  // / finished paths that never open discover still never touch the calendar.
  const calNeeded = pathView === "discover" || pathView === "path" || (startedAt && hasPending);
  const runWindow = calNeeded ? runTodayWindow : null;
  const {
    waypoints: runWaypoints,
    timeBlocks: runTimeBlocks,
    status: runCalStatus,
  } = useCalendarEvents(runWindow);

  // Never override an explicit "discover" — the rep is in the middle of adding
  // stops and we shouldn't yank them back.
  React.useEffect(() => {
    setPathView((v) => {
      if (v === "discover") return v;
      if (queueStops.length === 0) {
        // No persisted merchant stops. Normally the entry landing. BUT an
        // appointment-only (or live-tier-only) day has nothing to persist yet is
        // still a real day the rep can run — the driving view reads appointments
        // / owed / due-today live (useDrivingSequence). So once such a day has
        // been explicitly started (started_at stamped by handleStartTodaysPath,
        // which also sets pathView "path"), keep the current view rather than
        // yanking the rep back to the landing.
        return startedAt ? v : "entry";
      }
      // Stops exist → the card-first run surface ("path" → RunningPath). Whether
      // or not started_at is stamped, RunningPath composes the ordered day live,
      // so a not-yet-started path and a running one share the same surface.
      return "path";
    });
  }, [queueStops.length, startedAt]);

  // Handlers for transitioning between views.
  const enterDiscover = React.useCallback(() => setPathView("discover"), []);
  // Leave discover → go straight to the right view from the CURRENT stop count:
  // "path" when the rep has stops (the ones they just added already landed in the
  // cache), else "entry". Routing through "entry" and leaning on the queueStops
  // sync effect to upgrade to "path" left the rep stranded on the entry/proposal
  // view whenever the add had already settled before they tapped Next — that
  // effect only re-runs when queueStops.length / startedAt change, not on the view
  // switch, so it never fired (Path QA R4: added stops missing until a refresh).
  // If the add is still in flight (length still 0), we land on "entry" and the
  // sync effect upgrades to "path" the moment the stops arrive.
  const handleDoneDiscovering = React.useCallback(
    () => setPathView(queueStops.length > 0 ? "path" : "entry"),
    [queueStops.length],
  );

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

  // "Plan a new area" opens the stepped slide-out wizard (mode → search → results →
  // review → schedule → saved). The in-page map/list discover view is still
  // reachable via "Find nearby" on the run surface (RunningPath.onFindNearby).
  const handlePlan = React.useCallback(() => { if (!closePreviousPath.isPending) finalizePrevious(); setPlanOpen(true); }, [finalizePrevious, closePreviousPath.isPending]);

  // Header "+" overflow (FR-PATH-UX-12): the rarely-used actions ("Add more stops
  // today", "Plan a new area", "Who's near me right now") live in a sheet so they
  // stop competing with the daily action on the "Your day" landing.
  const [overflowOpen, setOverflowOpen] = React.useState(false);

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

  // Owed visits (SP3 Class D): the drop-in follow-ups the rep owes today, routed
  // as a distinct group above cold discovery. Only queried while discovering
  // (the hook is disabled on an empty pathDate), so entry/active/finished paths
  // never touch it. `todayDate` is the rep's LOCAL calendar day — Path plans
  // "today", and a due task opens by local date, not UTC.
  const todayDate = React.useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const { owed: owedVisits } = useOwedVisits(
    pathView === "discover" || pathView === "path" ? todayDate : "",
  );

  // Discovery dedup: an owed visit is an existing active deal, which pipeline
  // de-dup already hides from discovery — but guard anyway so a due account can
  // never appear both as an owed visit and as a cold prospect. Radius-independent
  // (dedup by identity, not proximity).
  const owedPlaceIds = React.useMemo(
    () => new Set(owedVisits.map((v) => v.placeId).filter((p): p is string => p != null)),
    [owedVisits],
  );

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
    // Dedup against owed visits first (identity), then apply the distance gate.
    const deduped = merchantsWithDistance.filter((m) => !(m.placeId && owedPlaceIds.has(m.placeId)));
    if (!anyGeocoded) return deduped;
    return deduped.filter((m) => m.distanceMeters <= displayRadiusM);
  }, [merchantsWithDistance, anyGeocoded, displayRadiusM, owedPlaceIds]);

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
    // Gate to the EFFECTIVE radius, which equals displayRadiusM unless auto-widen
    // grew the search to fill the requested count. Using displayRadiusM here would
    // throw the widened stops away before they reach the wizard.
    return anyGeo ? sorted.filter((m) => m.distanceMeters <= createEffectiveRadiusM) : sorted;
  }, [createMerchants, origin, createEffectiveRadiusM]);

  // Shortfall/widen explanation for the Create wizard: "Showing N of M ...".
  const createHint = React.useMemo(
    () =>
      discoveryShortfallHint({
        shown: createWithinRadius.length,
        requested: createRequestedLimit,
        requestedRadiusM: createRequestedRadiusM,
        effectiveRadiusM: createEffectiveRadiusM,
        hidden: createHidden,
      }),
    [
      createWithinRadius.length,
      createRequestedLimit,
      createRequestedRadiusM,
      createEffectiveRadiusM,
      createHidden,
    ],
  );

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
    // Chains are already excluded at the discovery fetch (includeChains: false),
    // so no client-side chain filter is needed here.
    return sortMerchants(filtered, sortMode);
  }, [filtered, sortMode]);

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
    // running) where RunningPath computes its own route.
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

  // Meeting-aware discover (F3): the rep's next fixed meeting today, if any, and
  // the set of nearby merchants a drop-in couldn't finish before it. Null / empty
  // unless the discover view is active, the calendar is connected ("ok"), there's
  // an origin, and pickNextMeeting finds a still-future meeting today — so with no
  // calendar / no upcoming meeting / a different view, nothing new renders. The
  // fit set is computed over `sorted` — the SAME array the list below renders —
  // so every flagged id maps to a visible row.
  const discoverNextMeeting = React.useMemo(() => {
    if (pathView !== "discover" || runCalStatus !== "ok" || !origin) return null;
    return pickNextMeeting(new Date().toISOString(), runWaypoints, runTimeBlocks);
  }, [pathView, runCalStatus, origin, runWaypoints, runTimeBlocks]);

  // Annotate each owed visit with its distance + next-meeting fit, then gate to
  // the same display radius the cold list uses. Filter-EXEMPT of the category
  // chips (work you already owe isn't "a restaurant near me"), but radius-gated
  // so a due account two counties over doesn't crowd the group. Urgency order
  // comes from the hook and survives the distance filter.
  const owedRows = React.useMemo<OwedVisitRow[]>(() => {
    if (pathView !== "discover" || !origin || owedVisits.length === 0) return [];
    const now = new Date().toISOString();
    return owedVisits
      .map((v) => ({
        ...v,
        distanceMeters: haversineMeters(origin, { lat: v.lat, lng: v.lng }),
        fits: discoverNextMeeting
          ? fitsBeforeMeeting(now, origin, { lat: v.lat, lng: v.lng }, discoverNextMeeting)
          : true,
      }))
      .filter((v) => v.distanceMeters <= displayRadiusM);
  }, [pathView, origin, owedVisits, discoverNextMeeting, displayRadiusM]);

  const handleOwedSelect = React.useCallback(
    (v: OwedVisit) => navigate(`/pipeline/${v.dealId}`),
    [navigate],
  );

  // Snooze a spilled owed visit one business day forward. Reuses the Task snooze
  // (band shifts, original_target_at untouched, so the score is unaffected) and
  // refreshes the owed list so the row leaves "Couldn't fit today".
  const { snoozeTask } = useTaskMutations();
  const queryClient = useQueryClient();
  const handleOwedSnooze = React.useCallback(
    (v: OwedVisit) => {
      snoozeTask.mutate(
        {
          task: { id: v.taskId, earliestAt: v.earliestAt, targetAt: v.targetAt, latestAt: v.latestAt, snoozeCount: v.snoozeCount },
          businessDays: 1,
        },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
            toast.success("Snoozed to tomorrow");
          },
          onError: () => toast.error("Couldn't snooze this visit"),
        },
      );
    },
    [snoozeTask, queryClient],
  );

  const discoverUnfit = React.useMemo(() => {
    if (!discoverNextMeeting || !origin) return { ids: new Set<string>(), label: "" };
    const now = new Date().toISOString();
    const ids = new Set(
      sorted
        .filter(
          (m) =>
            Number.isFinite(m.lat) &&
            Number.isFinite(m.lng) &&
            !fitsBeforeMeeting(now, origin, { lat: m.lat, lng: m.lng }, discoverNextMeeting),
        )
        .map((m) => m.id),
    );
    const label = "won't fit before " + new Date(discoverNextMeeting.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { ids, label };
  }, [discoverNextMeeting, origin, sorted]);

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

  // One-tap Start from discover (Path QA C3): launch the run straight from the
  // stops the rep has queued in discover, skipping the review wizard. REUSES
  // handleStartPath (its clear() + addMany(..., { start: true }) core) rather than
  // duplicating the create+start logic — we only hand it the queued stops' ids,
  // exactly as the CreatePathWizard's onStart does with its ordered selection.
  const handleStartFromDiscover = React.useCallback(() => {
    if (queueStops.length === 0) return;
    void handleStartPath(queueStops.map((s) => s.merchantId));
  }, [queueStops, handleStartPath]);

  // Start the auto-built Today's Path from its FLEXIBLE stops. Appointments are
  // calendar anchors shown in the plan but never created as merchant stops (they
  // already come from the calendar). This REUSES the exact create+start mechanism
  // handleStartPath uses (clear() then addMany(..., { start: true }) through
  // usePathMutations) rather than inventing a parallel path-create. The only
  // difference is the snapshot source: flexible OrderedStops (owed / due-today /
  // nearby) instead of wizard-selected merchant ids. Nearby stops are enriched
  // from the loaded browse set when present; owed / due-today deals carry no
  // merchant record, so they fall back to the ordered-stop fields.
  const [startingTodaysPath, setStartingTodaysPath] = React.useState(false);
  const handleStartTodaysPath = React.useCallback(
    async (flexibleStops: OrderedStop[]) => {
      if (startingTodaysPath) return;
      const byId = new Map(liveMerchants.map((m) => [m.id, m]));
      // Only the "nearby" tier is persisted as path_stops here. A nearby stop's
      // id IS a real prospects.id, which satisfies path_stops.prospect_id's NOT
      // NULL FK. past_due / due_today stops carry a TASK id (see useTodaysPath),
      // which is NOT a prospects row, so routing them through addStops' single
      // batched upsert would fail the whole insert on a real DB. Those live tiers
      // are DEALS/tasks rendered live in the run by SP-C2/C3 (useOwedVisits /
      // useDueTodayVisits, which carry dealId/placeId), never persisted here.
      const snapshots = flexibleStops
        .filter((s) => s.kind === "flexible" && s.tier === "nearby" && s.lat != null && s.lng != null)
        .map((s) => {
          const m = byId.get(s.id);
          return {
            prospectId: s.id,
            name: s.name,
            address: m?.address ?? null,
            phone: m?.phone ?? null,
            lat: s.lat as number,
            lng: s.lng as number,
            category: (m?.category ?? "other") as MerchantCategory,
            primaryType: m?.primaryType ?? null,
          };
        });
      // A day with owed / due-today work OR appointments but no nearby stop has
      // nothing to persist as a path_stop, yet it is still a meaningful day: the
      // driving view reads appointments / owed / due-today live (useDrivingSequence),
      // so it does not need persisted merchant stops. Stamp started_at (via
      // start()) and flip to the running surface rather than blocking the rep with
      // a false "nothing to start". The hero Start only renders when the day has at
      // least one stop, so reaching here always means there is something to drive.
      if (snapshots.length === 0) {
        setStartingTodaysPath(true);
        try {
          finalizePrevious();
          await todayPath.start();
          // No queueStops to trigger the view-transition effect, so drive the
          // view directly to the running surface (the effect preserves it once
          // started_at is stamped).
          setPathView("path");
        } catch {
          toast.error("Couldn't start the path. Please try again.");
        } finally {
          setStartingTodaysPath(false);
        }
        return;
      }
      setStartingTodaysPath(true);
      try {
        await todayPath.clear();
        await todayPath.addMany(snapshots, { start: true });
        finalizePrevious();
      } catch {
        toast.error("Couldn't start the path. Please try again.");
      } finally {
        setStartingTodaysPath(false);
      }
    },
    [startingTodaysPath, liveMerchants, todayPath, finalizePrevious],
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {/* Header title + subhead. The ENTRY landing reads "Your day" with a
            four-state day subhead (v2.2 A6). Every other view (active run,
            discover) keeps the "Path" title and the "{N} merchants nearby"
            count. Discover additionally gets one quiet muted line clarifying
            those are nearby businesses, not stops on the day — the vocabulary
            rule's only count-difference explainer. */}
        <div className="flex flex-col gap-1">
          {pathView === "entry" ? (
            <>
              <h1 className="text-heading-lg text-text-default">Your day</h1>
              <p className="text-body-md text-text-muted">
                {/* One authoritative day count (A10 / 3.4): the landing states
                    the day's FULL ordered roster = the assembler's proposal
                    length (appointments + owed + due-today + nearby). This is
                    the same day-roster concept the run screen counts (there via
                    useDrivingSequence's dayTotal), expressed here pre-start.
                    started=false because the landing is always the pre-run
                    review; the underway "Next at" state is rendered on the run
                    screen. */}
                {daySubhead({
                  stopCount: todaysPath.proposal.length,
                  startsAt: todaysPath.startsAt,
                  started: false,
                  notYetOpen: todaysPath.dayNotYetOpen,
                })}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-heading-lg text-text-default">Path</h1>
              {/* The "{N} merchants nearby" count is a DISCOVER-view fact (how many
                  browse results are near the rep). It is meaningless on the active
                  run, where RunningPath owns its own status line ("Path active ·
                  N/M stops"), so it is shown on discover only. The "Path" title
                  stays on both. */}
              {pathView === "discover" && (
                <>
                  <p className="text-body-md text-text-muted">
                    {sorted.length} {sorted.length === 1 ? "merchant" : "merchants"}
                    {anyGeocoded
                      ? ` nearby · ${originSource === "manual" ? originLabel : "from your location"}`
                      : " · sorted by recent activity"}
                  </p>
                  <p className="text-caption text-text-subtle">
                    These are businesses near you, not stops on your day.
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Start-a-path actions + the location control live in the header ONLY
              on the browse/discover view. On the entry landing the Today's Path
              proposal owns the daily action, and the rarely-used flows live in the
              "+" overflow sheet, so we hide these there; on an active run
              (pathView "path") they stay hidden too. */}
          {pathView === "discover" && (
            <>
              {/* "Plan a new area" is the rarely-used secondary action here. On
                  mobile the discover header is crowded, so hide it below md (it
                  stays on desktop, and is also reachable from the entry-view "+"
                  overflow). Primary "Start a path" + the location control + the
                  settings gear stay visible on every breakpoint. */}
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={MapPinned}
                onClick={() => setPlanOpen(true)}
                className="hidden md:inline-flex"
              >
                Plan a new area
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={RouteIcon}
                onClick={() => setCreateOpen(true)}
                disabled={!anyGeocoded}
              >
                Start a path
              </Button>
            </>
          )}
          {/* Re-center re-acquires GPS for the browse/discover map. The active run
              (pathView "path") follows the rep's live position on its own, so the
              button is redundant there; show it on discover only. */}
          {pathView === "discover" && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={geoStatus === "loading" ? Loader2 : LocateFixed}
              onClick={useMyLocation}
              loading={geoStatus === "loading"}
            >
              {originSource === "gps" ? "Re-center" : "Use my location"}
            </Button>
          )}
          {/* "+" overflow (the rarely-used Path actions). Surfaced on the "Your
              day" landing only, where it replaces the demoted secondary buttons;
              on discover the header already exposes those actions, and on an active
              run they don't belong. */}
          {pathView === "entry" && (
            <Button
              variant="tertiary"
              size="sm"
              iconOnly
              leadingIcon={Plus}
              aria-label="More Path actions"
              onClick={() => setOverflowOpen(true)}
            />
          )}
          {/* Path settings — manage default industries + end of day. Those govern
              BUILDING/finding a day, so they belong on the "Your day" landing and
              the discover view, not on the active run (pathView "path"), where the
              day is already set and RunningPath owns the surface. */}
          {pathView !== "path" && (
            <Button
              variant="tertiary"
              size="sm"
              iconOnly
              leadingIcon={Settings}
              aria-label="Path settings"
              onClick={() => setSettingsOpen(true)}
            />
          )}
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
             - "path":     the active path — the card-first RunningPath
                           (current-stop card + an expandable list/map of what
                           remains, no tabs). One surface for planned, running,
                           and appointment-only days alike.
             - "discover": filter controls + map+list discovery ladder
          Filter chips, radius/sort controls are discovery-only and live
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
        // Own scroll region within the fixed-height shell: a long proposal +
        // "Won't fit today" + no-location list must scroll HERE, not overflow the
        // box and paint over the AppLayout footer below it (the "footer in the
        // middle of the page" bug). Mirrors the discover view's scroll wrapper.
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {prevUnfinished.data && (
            <ResumePathCard
              pathDate={prevUnfinished.data.pathDate}
              pendingCount={prevUnfinished.data.pendingCount}
              onContinue={handleContinuePrevious}
              onClose={finalizePrevious}
              disabled={continuePreviousPath.isPending || closePreviousPath.isPending}
            />
          )}
          {/* Primary landing: the auto-built, reviewable Today's Path proposal.
              The daily action lives here; the rarely-used build-it-yourself flows
              (plan a new area / who's near me) now live in the header "+" overflow,
              so the proposal is the only thing competing for attention. */}
          <TodaysPathView
            proposal={todaysPath.proposal}
            overflow={todaysPath.overflow}
            noLocation={todaysPath.noLocation}
            isLoading={todaysPath.isLoading}
            status={todaysPath.status}
            onStart={handleStartTodaysPath}
            onAddNearby={enterDiscover}
            onOpenDeal={(dealId) => navigate(`/pipeline/${dealId}`)}
            isStarting={startingTodaysPath}
            remainingMin={todaysPath.remainingMin}
            windowEndHour={todaysPath.windowEndHour}
            origin={origin}
            showAddNearby={ADD_NEARBY_ENABLED}
          />
          {/* Upcoming (future-dated planned) paths — launch navigates to /path,
              where the today-path/discover flow takes over. */}
          <UpcomingPaths onLaunch={() => navigate("/path")} />
        </div>
      ) : pathView === "path" ? (
        /* Any path with stops, and any explicitly-started appointment / follow-up
           day: the single card-first run surface (v2.2 A7). There is no separate
           "planned Stops overview" screen — RunningPath composes its own ordered
           day (appointments + past-due + due-today + native stops) via
           useDrivingSequence, so it renders a not-yet-started path and an
           appointment-only day alike. No Run|Stops tabs: RunningPath owns the
           permanent stop card plus a "what remains" expandable (List | Map). */
        <RunningPath
          origin={origin}
          onViewPipeline={() => navigate("/pipeline")}
          onExit={() => setPathView("entry")}
          onFindNearby={enterDiscover}
        />
      ) : (
        /* pathView === "discover": filter controls + map+list discovery ladder */
        <>
          {/* Meeting-aware header — renders only when the calendar is connected and
              there's a still-upcoming fixed meeting today; otherwise nothing shows
              (no empty spacer). Placed above the filters so it stays visible in both
              the map and list mobile panes (it's context for the whole discover
              surface). */}
          {discoverNextMeeting && (
            <div className="mt-3">
              <DiscoverMeetingBanner meeting={discoverNextMeeting} now={new Date().toISOString()} />
            </div>
          )}

          {/* Owed visits (SP3 Class D) — the drop-in follow-ups due today, above
              cold discovery. Filter-exempt, radius-gated, hidden when none in
              range. Tapping opens the deal to log the visit. */}
          <OwedVisitsList
            visits={owedRows}
            unfitLabel={discoverUnfit.label}
            onSelect={handleOwedSelect}
            onSnooze={handleOwedSnooze}
          />

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

          {/* Show/Hide map toggle (Path QA R4). Mobile-only (`md:hidden`); the map
              defaults HIDDEN so the list leads on a small screen. Desktop keeps
              the two-pane map always visible via the `md:block` gate below. */}
          {anyGeocoded && (
          <button
            type="button"
            onClick={() => setMapVisible((v) => !v)}
            aria-pressed={mapVisible}
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 self-start rounded-radius-md bg-surface-sunken px-3 py-1.5 text-caption font-medium text-text-default transition-colors hover:bg-surface-sunken/80 md:hidden",
            )}
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden />
            {mapVisible ? "Hide map" : "Show map"}
          </button>
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
            {/* Map — only when at least one merchant is geocoded. On mobile the
                map is gated by the Show/Hide toggle (default hidden); `md:block`
                keeps the desktop two-pane map always visible. */}
            {anyGeocoded ? (
              <div className={cn("min-h-[320px]", mapVisible ? "block" : "hidden", "md:block")}>
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
            {/* List — always visible; on mobile it leads and takes the full
                width whenever the map is hidden (its grid cell collapses). */}
            <div className="min-h-0 overflow-y-auto">
              <MerchantList
                merchants={sorted}
                selectedId={selectedId}
                onSelect={handleSelect}
                // Meeting-aware fit flags: ids of merchants a drop-in couldn't
                // finish before the next meeting, computed over this SAME `sorted`
                // array (see discoverUnfit). Empty when no upcoming meeting.
                unfitIds={discoverUnfit.ids}
                unfitLabel={discoverUnfit.label}
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

          {/* Discover action bar (Path QA C3/C4). Pinned to the bottom of the
              fixed-height page column as a sticky footer so the primary "Start
              path" one-tap launch and the secondary back action stay thumb-
              reachable on short phone screens (the list pane above scrolls
              independently). shrink-0 + mt-auto keep it below the flex-1 body;
              the negative margins let the solid bar span the full width against
              the page's own horizontal padding. Harmless on desktop, where the
              column rarely overflows. */}
          <div
            data-testid="discover-action-bar"
            className={cn(
              "sticky bottom-0 z-10 mt-auto flex shrink-0 items-center gap-2",
              "-mx-4 border-t border-border-default bg-surface-default/95 px-4 py-3 backdrop-blur",
              "sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
            )}
          >
            {queueStops.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Navigation}
                onClick={handleStartFromDiscover}
              >
                Start path
              </Button>
            )}
            <Button variant="tertiary" size="sm" onClick={handleDoneDiscovering}>
              {queueStops.length > 0 ? "Next" : "Done"}
            </Button>
          </div>
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
        discoveryHint={createHint}
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

      <PathOverflowSheet
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        onAddMoreStops={enterDiscover}
        onPlanNewArea={handlePlan}
        onFindNearby={enterDiscover}
      />
    </div>
  );
}

export default PathPage;
