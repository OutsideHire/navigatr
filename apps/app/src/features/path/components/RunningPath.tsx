import * as React from "react";
import { ChevronDown, ChevronUp, List, Loader2, Map as MapIcon, Navigation, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { useTodayPath, type TodayStop } from "../hooks/useTodayPath";
import { useGeolocation } from "../hooks/useGeolocation";
import { routeStats } from "../lib/routeStats";
import { directionsUrl } from "../lib/directionsUrl";
import { merchantFromStop } from "../lib/merchantFromStop";
import { DropInSheet } from "./DropInSheet";
import { EndRouteSheet } from "./EndRouteSheet";
import { PathSummary } from "./PathSummary";
import { DayStopsMap } from "./DayStopsMap";
import { TieredStopList, type TieredStopRow } from "./TieredStopList";
import { LogActivitySheet } from "@/features/activities/components/LogActivitySheet";
import { AppointmentOutcomeSheet } from "@/features/appointments/components/AppointmentOutcomeSheet";
import { usePathMutations } from "../hooks/usePathMutations";
import { useDrivingSequence } from "../hooks/useDrivingSequence";
import { useLogStopDwell, type StopDwellType } from "../hooks/useLogStopDwell";
import type { DrivingCard, DrivingCardKind } from "../lib/drivingSequence";
import type { OrderedStop, StopKind, StopTier } from "../lib/todaysPath";
import { todayISO } from "../lib/today";
import { type Disposition } from "@/lib/followUpScheduling";
import type { Merchant, MerchantCategory } from "../mockData";

export interface RunningPathProps {
  origin: { lat: number; lng: number };
  onViewPipeline: () => void;
  onExit: () => void;
  /** Open the "find near me" discovery surface (PathPage's enterDiscover). */
  onFindNearby: () => void;
}

/** Map a driving-card kind onto the OrderedStop kind/tier the shared list + map
 *  components consume, so the "what remains" section speaks the same vocabulary
 *  as the landing. Owed cards read as past_due; nearby stays nearby; meetings
 *  stay appointment. The run map's aging COLOR comes from the card's band
 *  position (carried onto the OrderedStop below), not from this tier (v2.2 B 4.6). */
function cardStopKind(kind: DrivingCardKind): StopKind {
  return kind === "appointment" ? "appointment" : kind === "external" ? "external" : "flexible";
}
function cardStopTier(kind: DrivingCardKind): StopTier {
  if (kind === "appointment" || kind === "external") return "appointment";
  return kind === "owed" ? "past_due" : "nearby";
}

/** Normalize a driving-card kind onto the two dwell buckets the estimates use
 *  (v2.2 B 4.3.2): scheduled meetings (appointment / external) accumulate as
 *  "appointment"; owed / nearby / due drop-ins accumulate as "discovery". Keeps
 *  measured appointment and drop-in dwell separate so each estimate can later be
 *  replaced with its own measured per-rep average. */
function kindToStopType(kind: DrivingCardKind): StopDwellType {
  return kind === "appointment" || kind === "external" ? "appointment" : "discovery";
}

type PathSummaryStats = {
  visitedCount: number;
  skippedCount: number;
  totalStops: number;
  routeMeters: number;
  dispositions: Disposition[];
  dealsCreated: number;
};

/**
 * Compute the six PathSummary stat fields from the current stop list. When
 * `countPendingAsSkipped` is true, pending stops are folded into `skippedCount`
 * (the route-complete snapshot rule); otherwise only status==="skipped" counts.
 */
function computePathSummaryStats(
  stops: TodayStop[],
  origin: { lat: number; lng: number },
  visited: number,
  total: number,
  { countPendingAsSkipped }: { countPendingAsSkipped: boolean },
): PathSummaryStats {
  const skipped = stops.filter((s) => s.status === "skipped").length;
  const pending = countPendingAsSkipped
    ? stops.filter((s) => s.status === "pending").length
    : 0;
  return {
    visitedCount: visited,
    skippedCount: skipped + pending,
    totalStops: total,
    routeMeters: routeStats(origin, stops.map((s) => ({ lat: s.lat, lng: s.lng }))).totalRouteMeters,
    dispositions: stops.map((s) => s.disposition).filter((d): d is Disposition => d != null),
    dealsCreated: stops.filter((s) => s.dealCreated).length,
  };
}

/** Build the Merchant shape DropInSheet needs for a "nearby" card. A nearby
 *  card is a native path_stop, so the persisted snapshot (with its category and
 *  phone) is the source of truth. Reuse merchantFromStop while we still hold it,
 *  falling back to the card's own fields if the stop has already left the list. */
function nearbyMerchant(card: DrivingCard, stops: TodayStop[]): Merchant {
  const stop = stops.find((s) => s.merchantId === card.merchantId);
  if (stop) return merchantFromStop(stop);
  return {
    id: card.merchantId ?? card.id,
    name: card.name,
    category: "other" as MerchantCategory,
    address: card.address ?? "",
    lat: card.lat ?? 0,
    lng: card.lng ?? 0,
    phone: "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    primaryType: null,
  };
}

/**
 * RunningPath (FR-PATH-UX-06/07/09). The in-field Driving screen: the WHOLE day
 * presented ONE stop at a time as a single-card carousel over
 * `useDrivingSequence` (appointments, owed drop-ins, due-today, and native
 * nearby, in the app's composed order). Each card shows the business, its
 * arrival and drive estimates, the reason it is on the route, and exactly three
 * actions (I'm here / Navigate / Skip for now) plus a "Who's near me right now"
 * escape hatch into discovery.
 *
 * "I'm here" opens the outcome flow appropriate to the card's kind (appointment
 * outcome, owed drop-in against the existing deal, or a create-deal drop-in for
 * a nearby prospect); an external calendar meeting has no navigatr outcome, so
 * its action reads "Mark done" and simply resolves the card.
 *
 * Advancement is deterministic and does NOT depend on refetch timing: a
 * successful log (or a skip / mark-done) adds the card id to a LOCAL `resolved`
 * set, so the card leaves `visibleCards` immediately and the clamp shows the
 * next stop. This is uniform across every kind, fixing the case where owed
 * cards linger and appointment cards never left the carousel.
 *
 * Both the status row and the stop card state ONE authoritative day count
 * (A10 / 3.4): `dayTotal` = the number of stops in today's FULL ordered roster
 * (the driving-sequence `cards` before the local resolved-filter, held stable
 * across a refetch that drops a resolved card). Completions and skips STAY in
 * that total; they read as progress (`completedCount`) and as the current
 * stop's 1-based `position`, never as a shrinking denominator.
 *
 * The top bar carries a reversible Pause (2.5): Pause swaps to Resume in place
 * with no confirmation and keeps the day; Resume re-derives the run's `now` so
 * arrival estimates recompute from the current time. End route opens the
 * EndRouteSheet confirmation (carry / complete / clear).
 */
export function RunningPath({ origin, onViewPipeline, onExit, onFindNearby }: RunningPathProps) {
  const { stops, clear, pathId, pendingCount } = useTodayPath();
  const { carryToTomorrow, finalizeCurrentPath } = usePathMutations();
  const queryClient = useQueryClient();
  const { logStopDwell } = useLogStopDwell();

  // Real per-stop dwell (v2.2 B 4.3.2). Invisible, best-effort analytics: the
  // arrival timestamp is stamped by card id when the rep taps "I'm here", and
  // consumed on close-out to log the measured minutes against the stop type.
  // A ref (not state) so stamping never re-renders the run.
  const arrivedAtRef = React.useRef<Map<string, string>>(new Map());
  const captureDwell = React.useCallback(
    (cardId: string, kind: DrivingCardKind, dealId: string | null) => {
      const arrivedAt = arrivedAtRef.current.get(cardId);
      // No arrival stamped (logged without "I'm here"): nothing measured, so do
      // not fabricate a dwell. Otherwise log and clear the stamp.
      if (!arrivedAt) return;
      arrivedAtRef.current.delete(cardId);
      // Fire-and-forget; the hook is already best-effort, and the .catch here
      // guarantees a rejected promise can never bubble into the run flow.
      logStopDwell({
        stopType: kindToStopType(kind),
        dealId,
        arrivedAt,
        closedAt: new Date().toISOString(),
      }).catch(() => {});
    },
    [logStopDwell],
  );

  // The arrival clock's basis. Captured once on mount, then RE-DERIVED on Resume
  // (a paused hour is a lost hour, Path v2.2 2.5): moving `nowIso` forward re-runs
  // useDrivingSequence so every arrival estimate recomputes from the current time.
  const [nowIso, setNowIso] = React.useState(() => new Date().toISOString());
  const stableOrigin = React.useMemo(() => ({ lat: origin.lat, lng: origin.lng }), [origin.lat, origin.lng]);
  const { cards, isLoading } = useDrivingSequence(todayISO(), stableOrigin, nowIso);

  // Live rep position for the run map (Path v2.2 3.3): a continuous watch so the
  // "You" marker tracks the rep as they drive. Falls back to the passed origin
  // until the first fix (or if geolocation is unavailable).
  const live = useGeolocation({ watch: true });
  const livePosition = live.coords ?? origin;

  const [index, setIndex] = React.useState(0);
  const [endOpen, setEndOpen] = React.useState(false);
  const [completed, setCompleted] = React.useState<PathSummaryStats | null>(null);
  // Pause is reversible (no confirmation): the day is not discarded, the card
  // stays visible, and the status row swaps Pause -> Resume in place (2.5).
  const [paused, setPaused] = React.useState(false);
  // The "what remains" section (A7/3.3): collapsed by default, expands to a
  // List | Map of the upcoming stops, and AUTO-COLLAPSES on any resolution.
  const [expanded, setExpanded] = React.useState(false);
  const [remainingView, setRemainingView] = React.useState<"list" | "map">("list");
  // Cards the rep has resolved this session (logged, skipped, or marked done).
  // Drives advancement locally so the carousel never waits on a refetch.
  const [resolved, setResolved] = React.useState<ReadonlySet<string>>(() => new Set());
  const resolve = React.useCallback((id: string) => {
    setResolved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Any state change (arrive / skip / complete) returns the rep to the card:
    // this is the single chokepoint every resolution funnels through (A7/3.3).
    setExpanded(false);
  }, []);

  const handlePause = React.useCallback(() => setPaused(true), []);
  const handleResume = React.useCallback(() => {
    setPaused(false);
    // Re-derive the run's "now" so arrival estimates recompute from the current
    // time. TODO(Ticket B): remaining CAPACITY (the stop cap) should also be
    // recomputed against the shortened remaining window; that budget math is not
    // available in the run surface yet, so only the arrival basis moves here.
    setNowIso(new Date().toISOString());
  }, []);
  // Open outcome-sheet state, keyed by card kind. Only one is ever open.
  const [apptSheet, setApptSheet] = React.useState<{ id: string; appointmentId: string; dealId: string; name: string } | null>(null);
  const [owedCard, setOwedCard] = React.useState<{ id: string; dealId: string } | null>(null);
  const [nearby, setNearby] = React.useState<{ id: string; merchant: Merchant } | null>(null);

  const visibleCards = React.useMemo(
    () => cards.filter((c) => !resolved.has(c.id)),
    [cards, resolved],
  );

  // Persisted-native counts, used ONLY by the end-of-route PathSummary snapshot
  // (which reports the persisted path_stops). NOT the run status row — see the
  // authoritative day count below.
  const total = stops.length;
  const visited = stops.filter((s) => s.status === "visited").length;

  // ONE authoritative day count (A10 / 3.4). Both the status row and the stop
  // card state the SAME total = the number of stops in today's FULL ordered
  // roster (appointments + past-due + due-today + nearby), which is the
  // driving-sequence `cards` list BEFORE the local resolved-filter. Completions
  // and skips STAY in that total: the denominator moves only when a stop is
  // added or removed, never as stops resolve; resolutions read as PROGRESS.
  //
  // `dayTotal` is held stable across a resolve even when a background refetch
  // drops the just-resolved card from `cards`: a resolved id no longer present
  // in the live list is added back, so the denominator never shrinks on a
  // completion. `completedCount` is the number of stops resolved this session.
  const completedCount = resolved.size;
  const liveIds = React.useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const droppedResolved = React.useMemo(
    () => [...resolved].filter((id) => !liveIds.has(id)).length,
    [resolved, liveIds],
  );
  const dayTotal = cards.length + droppedResolved;

  // Keep the index in range as cards resolve out of the carousel or the
  // sequence first populates.
  React.useEffect(() => {
    if (index > visibleCards.length - 1) setIndex(Math.max(0, visibleCards.length - 1));
  }, [visibleCards.length, index]);

  const handleEndRoute = () => {
    // End route is only reachable while the run is showing (visibleCards > 0; a
    // fully-resolved day auto-renders the summary above and has no End route
    // button). So there is always a live day to end — open the options sheet.
    // Do NOT gate on the SAVED-stop count (pendingCount): an appointment /
    // follow-up-only day has zero saved merchant stops but a real day to end, and
    // the old `pendingCount() === 0` gate skipped the sheet and dumped the rep
    // back to the day screen instead of offering complete / carry / clear.
    setEndOpen(true);
  };
  const handleCarry = async () => {
    if (!pathId) return;
    try {
      await carryToTomorrow.mutateAsync({ pathId, pathDate: todayISO() });
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't carry the stops to tomorrow. Please try again.");
    }
  };
  const handleComplete = async () => {
    if (!pathId) return;
    const snapshot = computePathSummaryStats(stops, origin, visited, total, { countPendingAsSkipped: true });
    try {
      await finalizeCurrentPath.mutateAsync(pathId);
      setEndOpen(false);
      setCompleted(snapshot);
    } catch {
      toast.error("Couldn't mark the route complete. Please try again.");
    }
  };
  const handleClearRestart = async () => {
    if (!window.confirm("Clear today's path and start over?")) return;
    try {
      await clear();
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't clear the path. Please try again.");
    }
  };

  // The route was explicitly finalized (End route then Mark complete): show the
  // report snapshot. Takes precedence over the live sequence.
  if (completed) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <PathSummary
          {...completed}
          onViewPipeline={onViewPipeline}
          onNewPath={() => { void clear(); onExit(); }}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
        <p className="text-caption text-text-muted">Loading your day...</p>
      </div>
    );
  }

  // Nothing left on the whole day: the done report (all tiers resolved).
  if (visibleCards.length === 0) {
    const stats = computePathSummaryStats(stops, origin, visited, total, { countPendingAsSkipped: false });
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <PathSummary
          {...stats}
          onViewPipeline={onViewPipeline}
          onNewPath={() => { void clear(); onExit(); }}
        />
      </div>
    );
  }

  const clampedIndex = Math.min(index, visibleCards.length - 1);
  const card = visibleCards[clampedIndex]!;
  // 1-based position of the current stop within the WHOLE day (resolved +
  // remaining): resolved stops always precede the current window, so it is the
  // completed count plus the offset into what remains. Reads 1 of 4, 2 of 4, …
  // against the fixed `dayTotal`.
  const position = completedCount + clampedIndex + 1;
  const hasCoords = card.lat != null && card.lng != null;
  const isExternal = card.kind === "external";

  const handleImHere = () => {
    // Stamp the arrival moment for this card (v2.2 B 4.3.2). "Navigate then I'm
    // here" still lands here on the "I'm here" tap, which is the arrival. The
    // matching close-out (the outcome sheet's success) reads and clears it.
    arrivedAtRef.current.set(card.id, new Date().toISOString());
    switch (card.kind) {
      case "appointment":
        if (card.appointmentId && card.dealId) {
          setApptSheet({ id: card.id, appointmentId: card.appointmentId, dealId: card.dealId, name: card.name });
        } else {
          resolve(card.id);
        }
        break;
      case "owed":
        if (card.dealId) setOwedCard({ id: card.id, dealId: card.dealId });
        else resolve(card.id);
        break;
      case "nearby":
        setNearby({ id: card.id, merchant: nearbyMerchant(card, stops) });
        break;
      case "external":
        // No navigatr outcome to record: "Mark done" just resolves the card.
        resolve(card.id);
        break;
    }
  };

  const skip = () => {
    // TODO(Robert): wire task snooze (FR-PATH-DROP-08). A snooze mutation exists
    // (useTaskMutations.snoozeTask), but it needs the task's band dates
    // (earliest/target/latest/snoozeCount) which the DrivingCard does not carry,
    // so it is not reusable from here yet. Resolve locally (advance) only; the
    // underlying task is never deleted.
    resolve(card.id);
  };

  // "What remains" = the still-unresolved stops AFTER the current card, drawn
  // from the SAME driving carousel the card comes from so the card and this
  // section always agree (A7/3.3). List + map both render this set; the map also
  // gets the live rep position.
  const remainingCards = visibleCards.slice(clampedIndex + 1);
  const remainingRows: TieredStopRow[] = remainingCards.map((c, i) => ({
    key: c.id,
    tier: cardStopTier(c.kind),
    external: c.kind === "external",
    name: c.name,
    index: i + 1,
    label: c.label,
    reason: c.reason,
    detail: c.address ?? undefined,
    timeLabel: c.kind === "appointment" || c.kind === "external" ? c.arriveLabel : undefined,
  }));
  const remainingStops: OrderedStop[] = remainingCards.map((c) => ({
    id: c.id,
    kind: cardStopKind(c.kind),
    tier: cardStopTier(c.kind),
    name: c.name,
    dealId: c.dealId,
    lat: c.lat,
    lng: c.lng,
    startAt: null,
    endAt: null,
    ageDays: null,
    // v2.2 B 4.6: the run map colors aging from the band, so carry the card's
    // band position onto the OrderedStop the map builds pins from.
    bandPosition: c.bandPosition,
  }));

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between rounded-radius-md bg-surface-sunken px-4 py-2.5">
        <span className="text-body-md font-medium text-text-default">
          <span
            className={cn(
              "mr-2 inline-block h-2 w-2 rounded-radius-full align-middle",
              paused ? "bg-status-warning" : "bg-status-success",
            )}
            aria-hidden
          />
          {paused ? "Path paused" : "Path active"} · {completedCount}/{dayTotal} stops
        </span>
        {/* Pause / End route stay one level above the card (2.5). Pause is
            reversible (no confirm) and swaps to Resume in the same position;
            End route carries the EndRouteSheet confirmation. */}
        <div className="flex items-center gap-2">
          {paused ? (
            <Button variant="primary" size="sm" leadingIcon={Play} onClick={handleResume}>Resume</Button>
          ) : (
            <Button variant="secondary" size="sm" leadingIcon={Pause} onClick={handlePause}>Pause</Button>
          )}
          <Button variant="tertiary" size="sm" onClick={handleEndRoute}>End route</Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-radius-md border border-border-default p-4">
        <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
          Stop {position} of {dayTotal}
        </span>

        <div className="flex flex-col gap-1">
          <h2 className="text-heading-md text-text-default">{card.name}</h2>
          {card.address && <p className="truncate text-body-md text-text-muted">{card.address}</p>}
        </div>

        {/* Arrival and drive estimates, side by side. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5 rounded-radius-md bg-surface-sunken px-3 py-2">
            <span className="text-caption font-medium uppercase tracking-wide text-text-muted">Arrival</span>
            <span className="text-body-strong text-text-default">{card.arriveLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-radius-md bg-surface-sunken px-3 py-2">
            <span className="text-caption font-medium uppercase tracking-wide text-text-muted">Drive</span>
            <span className="text-body-strong text-text-default">{card.driveMinLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {/* Left-rail category label (v2.2 B 4.5) + the detail-only sentence
              (4.5.1). The sentence can be empty (an appointment with no contact);
              the arrival card above already carries the appointment time. */}
          <span className="text-caption font-medium text-text-muted">{card.label}</span>
          {card.reason && <p className="text-body-md text-text-default">{card.reason}</p>}
          {card.lastVisit && <p className="text-caption text-text-muted">{card.lastVisit}</p>}
        </div>

        {/* Exactly three actions. */}
        <div className="flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={handleImHere}>
            {isExternal ? "Mark done" : "I'm here"}
          </Button>
          <div className="flex gap-2">
            {hasCoords && (
              <a
                href={directionsUrl(card.lat as number, card.lng as number)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-radius-md border border-border-default px-3 py-2 text-body-md text-text-default hover:bg-surface-sunken"
              >
                <Navigation className="h-4 w-4" aria-hidden /> Navigate
              </a>
            )}
            <Button variant="secondary" className="flex-1" onClick={skip}>Skip for now</Button>
          </div>
        </div>

        <button
          type="button"
          onClick={onFindNearby}
          className="self-start text-body-md font-medium text-brand-primary hover:underline"
        >
          Who's near me right now
        </button>
      </div>

      {/* "What remains" (A7/3.3): a single collapsed row beneath the permanent
          card. Tapping expands into a List | Map of the upcoming stops (the map
          carries the live rep position). Nothing is hidden behind a tab; any
          resolution auto-collapses this back to the card (see `resolve`). The
          current stop is already the card, so this counts only the stops after
          it — on the last stop the section simply isn't shown. */}
      {remainingCards.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between gap-2 rounded-radius-md border border-border-default px-4 py-2.5 text-left text-body-md font-medium text-text-default transition-colors hover:bg-surface-sunken"
          >
            <span>
              {remainingCards.length} stop{remainingCards.length === 1 ? "" : "s"} remaining
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            )}
          </button>

          {expanded && (
            <div className="flex flex-col gap-3">
              {/* List | Map segmented toggle, mirroring the landing (A5). Both
                  views stay mounted while expanded (the inactive one is
                  CSS-hidden) so the MapLibre instance is retained across flips. */}
              <div
                role="tablist"
                aria-label="Remaining stops view"
                className="flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5"
              >
                {([["list", "List", List], ["map", "Map", MapIcon]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={remainingView === key}
                    onClick={() => setRemainingView(key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-radius-sm px-4 py-1.5 text-caption font-medium transition-colors",
                      remainingView === key
                        ? "bg-surface-default text-text-default shadow-sm"
                        : "text-text-muted hover:text-text-default",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>

              {/* LIST view — the upcoming stops, same source as the card. */}
              <div className={cn(remainingView === "map" && "hidden")}>
                <TieredStopList rows={remainingRows} />
              </div>

              {/* MAP view — the upcoming stops plus the rep's LIVE position. */}
              <div className={cn("h-[50vh] min-h-[320px]", remainingView === "list" && "hidden")}>
                <DayStopsMap
                  stops={remainingStops}
                  origin={livePosition}
                  onStopClick={() => {}}
                  active={remainingView === "map"}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <EndRouteSheet
        open={endOpen}
        onOpenChange={setEndOpen}
        pendingCount={pendingCount()}
        busy={carryToTomorrow.isPending || finalizeCurrentPath.isPending}
        onComplete={handleComplete}
        onCarry={handleCarry}
        onClear={handleClearRestart}
      />

      {/* Outcome sheets, reused verbatim from the Stops tab / pipeline. On a
          successful log we resolve the card locally so it leaves the carousel
          immediately; the sheets fire their own confirmation toasts. */}
      {apptSheet && (
        <AppointmentOutcomeSheet
          open
          onOpenChange={(o) => { if (!o) setApptSheet(null); }}
          appointmentId={apptSheet.appointmentId}
          dealId={apptSheet.dealId}
          merchantName={apptSheet.name}
          hasFutureAppointment={false}
          onRecorded={() => {
            captureDwell(apptSheet.id, "appointment", apptSheet.dealId);
            resolve(apptSheet.id);
          }}
        />
      )}
      {owedCard && (
        <LogActivitySheet
          open
          onOpenChange={(o) => { if (!o) setOwedCard(null); }}
          dealId={owedCard.dealId}
          defaultType="drop_in"
          onLogged={() => {
            captureDwell(owedCard.id, "owed", owedCard.dealId);
            resolve(owedCard.id);
            // Belt and suspenders: also invalidate the owed / due-today reads so
            // the other surfaces (Stops tab) drop the resolved stop too.
            void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
            void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
          }}
        />
      )}
      <DropInSheet
        merchant={nearby?.merchant ?? null}
        open={nearby != null}
        onOpenChange={(o) => { if (!o) setNearby(null); }}
        onLogged={() => {
          if (nearby) {
            captureDwell(nearby.id, "nearby", null);
            resolve(nearby.id);
          }
        }}
      />
    </div>
  );
}
