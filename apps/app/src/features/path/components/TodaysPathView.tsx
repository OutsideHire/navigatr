/**
 * TodaysPathView (SP-B2). The on-screen landing that renders the auto-built
 * "Today's Path" proposal.
 *
 * This is the primary Path landing when the rep has an origin and no active
 * path: a reviewable day assembled by `useTodaysPath` (SP-B1) from the pure
 * `assembleTodaysPath` (SP-A). It is RENDER + LOCAL-REVIEW only; it never
 * routes, sorts, or gates (that all lives in the assembler). The rep can:
 *   - see the proposal in run order, each stop showing one plain reason line
 *     (no tier chips, scores, or overdue ages); appointment times sit beside
 *     the name, and a "Why this order?" explainer describes the ordering;
 *   - REMOVE a flexible stop from the plan (local, pre-start);
 *   - "Add more nearby" to open the Find-near-me discovery;
 *   - the single hero action reads "Start driving", which hands the remaining
 *     FLEXIBLE stops back up to PathPage's existing create+start mechanism
 *     (appointments are calendar anchors shown in the plan, never created as
 *     merchant stops). An empty day instead shows "Build my day".
 *
 * The overflow candidates that did not fit are NO LONGER shown as a "Won't fit
 * today" list (v2.2 A4): the `overflow` prop still flows in and remains the
 * ranked pool the one-tap "Add more stops" control folds from (and Ticket B's
 * fill pool), it simply does not render its own visible section anymore.
 */
import * as React from "react";
import { ArrowRight, CalendarClock, ExternalLink, List, Loader2, Map as MapIcon, MapPin, MapPinOff, Navigation, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import type { OrderedStop, FlexibleStop } from "../lib/todaysPath";
import type { OwedVisitNoCoords } from "../lib/owedVisits";
import type { TodaysPathStatus } from "../hooks/useTodaysPath";
import { tierAccent } from "../lib/tierStyles";
import { reasonLine, stopLabel } from "../lib/reasonLine";
import { agingReasonTextClass, agingStateFromBand } from "../lib/agingState";
import { capacitySentence, fullDaySentence } from "../lib/dayCapacity";
import { fillToCapacity } from "../lib/fillToCapacity";
import { DayStopsMap } from "./DayStopsMap";

/** Below this many open minutes, no further stop can fit (a stop needs at least
 *  a minimum dwell). At/above it, capacity is stated; below it, the day is full. */
const MIN_STOP_MIN = 20;

/** Single build-time global flag (v2.2 A3): the "Add more nearby" entry point on
 *  the landing renders ONLY when VITE_PATH_ADD_NEARBY === "true". Default
 *  (unset / anything else) hides it. It was briefly turned on for beta review,
 *  then hidden again at Robert's request: the feature works, but the layout and
 *  workflow need more polish, so it stays off until we revisit it in production.
 *  Re-enable without a code change by setting the env var to "true". This gates
 *  ONLY that one link. The "+" overflow menu, "Build my day", and every shared
 *  handler (onAddNearby/enterDiscover, useMerchants, the discover view) are
 *  untouched. The env read lives here, in one place; PathPage threads it as a
 *  prop. */
export const ADD_NEARBY_ENABLED = import.meta.env.VITE_PATH_ADD_NEARBY === "true";

interface TodaysPathViewProps {
  /** Ordered run list (appointments interleaved with flexible stops) from useTodaysPath. */
  proposal: OrderedStop[];
  /** Flexible candidates that did not fit; displayed read-only for carry-over (SP-D). */
  overflow: FlexibleStop[];
  /** Owed drop-ins whose deal has no coordinates yet: shown in a "No location
   *  yet" group so they never silently vanish, but never routed. */
  noLocation: OwedVisitNoCoords[];
  /** Assembler is still gathering its tiers. */
  isLoading: boolean;
  /** Non-"ok" statuses drive a non-blocking notice (needs_reconnect). */
  status: TodaysPathStatus;
  /** Start a path from the remaining flexible stops (appointments excluded). */
  onStart: (flexibleStops: OrderedStop[]) => void;
  /** Open the Find-near-me discovery to add more nearby stops. */
  onAddNearby: () => void;
  /** Open a deal (used by the "No location yet" rows so the rep can add an
   *  address). Navigates to the deal in the pipeline. */
  onOpenDeal: (dealId: string) => void;
  /** True while the create+start round-trip is in flight. */
  isStarting?: boolean;
  /** Budget minutes still open, for the capacity sentence (FR-PATH-UX-10). */
  remainingMin: number;
  /** Working-window close hour (0..24), for the full-day sentence. */
  windowEndHour: number;
  /** Rep origin, for the one-tap incremental insert (FR-PATH-UX-11). */
  origin: { lat: number; lng: number };
  /** Whether the demoted "Add more nearby" entry point renders (v2.2 A3).
   *  Defaults to the build-time VITE_PATH_ADD_NEARBY flag; threaded as a prop so
   *  it can be toggled in tests. This gates ONLY that one link. */
  showAddNearby?: boolean;
}

/** Local-tz clock time, e.g. "10:30 AM". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TodaysPathView({
  proposal,
  overflow,
  noLocation,
  isLoading,
  status,
  onStart,
  onAddNearby,
  onOpenDeal,
  isStarting = false,
  remainingMin,
  windowEndHour,
  origin,
  showAddNearby = ADD_NEARBY_ENABLED,
}: TodaysPathViewProps) {
  // Local, pre-start removals: the rep can drop a flexible stop from the plan
  // before starting. Keyed by stop id; appointments can't be removed (they're
  // calendar anchors). Filtering here keeps useTodaysPath's assembler output
  // untouched. This is a view-only override.
  const [removed, setRemoved] = React.useState<ReadonlySet<string>>(() => new Set());

  // One-tap fill to remaining capacity (v2.2 B 4.4): a single tap folds pool
  // candidates onto the END of the day, closest-to-the-last-stop first, until
  // the remaining budget cannot hold the closest remaining candidate (or the
  // pool is drained), NOT one stop per tap. It appends in place: the placed
  // stops are never re-sequenced and the optimizer never re-runs.
  // `workingProposal` is the assembler's proposal plus any appended fills;
  // `poolCursor` walks the ranked fill pool. `filledStops` records the stops
  // THIS session's fills appended (for the notice count; batch Undo attribution
  // is B-T7). `budgetLeft` is the LOCAL remaining budget: it starts from the
  // assembler's `remainingMin` prop and DEPLETES on each fill, so repeated taps
  // draw down one shared budget instead of each re-spending the full amount.
  // All four reset whenever a real refetch delivers a fresh `proposal`, so local
  // fills never fight incoming data.
  const [workingProposal, setWorkingProposal] = React.useState<OrderedStop[]>(proposal);
  const [poolCursor, setPoolCursor] = React.useState(0);
  const [filledStops, setFilledStops] = React.useState<OrderedStop[]>([]);
  const [budgetLeft, setBudgetLeft] = React.useState(remainingMin);
  // Local dismissal of the fill-notice panel (v2.2 A9). Reset on a fresh
  // proposal so a new day's fills re-announce.
  const [fillNoticeDismissed, setFillNoticeDismissed] = React.useState(false);
  // Captured once, so the fill stays deterministic across taps (fillToCapacity
  // takes `now` as a param; no Date.now() read mid-interaction).
  const [now] = React.useState(() => new Date().toISOString());
  // List | Map segmented view (v2.2 A5 / 3.2). List is the DEFAULT. Both views
  // render the SAME stop set (`visibleProposal`); toggling only switches which
  // container is shown (client state, no re-fetch). The map instance is retained
  // across toggles — both containers stay mounted and the inactive one is
  // CSS-hidden — so MapLibre never re-initializes.
  const [dayView, setDayView] = React.useState<"list" | "map">("list");

  React.useEffect(() => {
    setWorkingProposal(proposal);
    setPoolCursor(0);
    setFilledStops([]);
    setBudgetLeft(remainingMin);
    setFillNoticeDismissed(false);
    // `remainingMin` is intentionally excluded: budgetLeft resets on a fresh
    // proposal (a real refetch), not on every prop tick. The refetch that moves
    // remainingMin also delivers a new proposal, so this fires together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const visibleProposal = React.useMemo(
    () => workingProposal.filter((s) => !(s.kind === "flexible" && removed.has(s.id))),
    [workingProposal, removed],
  );
  // The map can only pin stops that carry coordinates. Same set + order as the
  // list, minus any coordinate-less stops (they live in the "No location yet"
  // group, which is list-only).
  const mapStops = React.useMemo(
    () =>
      visibleProposal.filter(
        (s) => s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng),
      ),
    [visibleProposal],
  );
  // A map pin tap mirrors the list: for a stop backed by a deal, open the deal
  // (parity with the row's Open-deal action). A stop with no dealId (a discovery
  // / nearby fill) has no deal to open yet — a detail sheet is deferred to a
  // later cross-reference pass (Section 6), so it is a deliberate no-op here.
  const handleStopClick = React.useCallback(
    (id: string) => {
      const stop = visibleProposal.find((s) => s.id === id);
      if (stop?.dealId) onOpenDeal(stop.dealId);
    },
    [visibleProposal, onOpenDeal],
  );
  // Ids already placed (assembler + any inserted) so an inserted candidate does
  // not also linger in the "won't fit" list.
  const placedIds = React.useMemo(
    () => new Set(workingProposal.map((s) => s.id)),
    [workingProposal],
  );
  const visibleOverflow = React.useMemo(
    () => overflow.filter((s) => !removed.has(s.id) && !placedIds.has(s.id)),
    [overflow, removed, placedIds],
  );
  // Whether there is still a ranked candidate to try folding in. The budget gate
  // (budgetLeft < MIN_STOP_MIN) is applied at the control alongside this.
  // TODO(B 4.1): live Places refill when the retained pool is exhausted, with
  // cost logging (never per interaction). Until then, an exhausted pool leaves
  // the control disabled (below), not hidden.
  const canAddStop = poolCursor < overflow.length;

  const handleAddStop = React.useCallback(() => {
    // One tap fills the REMAINING CAPACITY (v2.2 B 4.4): append pool candidates
    // closest-to-the-last-stop first until the budget cannot hold the closest
    // remaining one (or the pool drains). No re-sequencing, no optimizer re-run.
    // The LOCAL budgetLeft (not the static prop) is spent, so a follow-up tap
    // draws down the same budget instead of re-spending the full amount.
    const res = fillToCapacity(workingProposal, overflow, poolCursor, {
      // No dwellMin: fillToCapacity derives per-kind dwell (15 for a fill).
      origin,
      remainingMin: budgetLeft,
      now,
    });
    if (res.added.length > 0) {
      setWorkingProposal(res.proposal);
      // TODO(B-T7): batch Undo attribution reverses exactly THIS fill's `added`.
      setFilledStops((prev) => [...prev, ...res.added]);
    }
    setPoolCursor(res.poolCursor);
    setBudgetLeft(res.remainingMin);
  }, [overflow, poolCursor, workingProposal, origin, budgetLeft, now]);
  const flexibleStops = React.useMemo(
    () => visibleProposal.filter((s) => s.kind === "flexible"),
    [visibleProposal],
  );
  // How many stops THIS session's fills appended and are still on the day (a
  // filled stop the rep then removed no longer counts), plus whether the day has
  // any committed stop (appointment/owed/due) at all. On a truly empty day the
  // "Build my day" button owns the messaging, so the count line is suppressed.
  // Drives the fill-notice count off `added` (v2.2 B 4.4); the batch Undo
  // attribution is finished in B-T7.
  const nearbyFillCount = React.useMemo(() => {
    const visibleIds = new Set(visibleProposal.map((s) => s.id));
    return filledStops.filter((s) => visibleIds.has(s.id)).length;
  }, [filledStops, visibleProposal]);
  const hasCommitment = React.useMemo(
    () => visibleProposal.some((s) => s.tier !== "nearby"),
    [visibleProposal],
  );

  const handleRemove = React.useCallback((id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Ids of the still-attributable filled stops: appended by THIS session's fills
  // and still on the day (not individually removed via the existing Trash). This
  // drives BOTH the notice count (via nearbyFillCount, same set) and the per-row
  // fill marker, so the marker shows exactly while the notice does and clears the
  // instant the last filled stop is dropped or the batch is undone (v2.2 4.7.1).
  const fillMarkerIds = React.useMemo(() => {
    const visibleIds = new Set(visibleProposal.map((s) => s.id));
    return new Set(filledStops.filter((s) => visibleIds.has(s.id)).map((s) => s.id));
  }, [filledStops, visibleProposal]);

  // Batch Undo of the fill (v2.2 4.7 / 4.7.1): reverse the ENTIRE fill the notice
  // reports. Remove every still-attributable filled stop (in filledStops and not
  // already individually dropped) from workingProposal; a stop the rep already
  // removed one-by-one is NOT resurrected (it is already gone). Reset filledStops
  // so the notice clears, and restore budgetLeft to the pre-fill budget
  // (remainingMin) + poolCursor to 0 so the reversed candidates are available for
  // a fresh fill.
  const handleUndoFill = React.useCallback(() => {
    const reverse = new Set(
      filledStops.filter((s) => !removed.has(s.id)).map((s) => s.id),
    );
    if (reverse.size > 0) {
      setWorkingProposal((prev) => prev.filter((s) => !reverse.has(s.id)));
    }
    setFilledStops([]);
    setBudgetLeft(remainingMin);
    setPoolCursor(0);
  }, [filledStops, removed, remainingMin]);

  const wrap = "mt-6 flex flex-col gap-4 self-stretch md:mx-auto md:w-full md:max-w-2xl";

  if (isLoading) {
    return (
      <div className={wrap}>
        <div className="mt-6 flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
          <p className="text-caption text-text-muted">Building today&apos;s path…</p>
        </div>
      </div>
    );
  }

  // The routable day (proposal + overflow). The no-location group is separate:
  // it renders whenever there are coordinate-less owed drop-ins, even when there
  // is no routable day, so a truly caught-up rep still sees what they owe.
  const hasRoutable = visibleProposal.length > 0 || visibleOverflow.length > 0;
  const empty = !hasRoutable && noLocation.length === 0;

  return (
    <div className={wrap}>
      {/* needs_reconnect is non-blocking: the plan still renders from whatever
          tiers resolved; the calendar tier is simply absent. */}
      {status === "needs_reconnect" && (
        <div className="flex items-center gap-2 rounded-radius-md border border-status-warning/40 bg-status-warning-bg px-3 py-2">
          <RefreshCw className="h-4 w-4 shrink-0 text-status-warning" aria-hidden />
          <p className="text-caption text-text-default">
            Reconnect your calendar to include today&apos;s meetings in the plan.
          </p>
        </div>
      )}

      {/* The landing title + day subhead now live in the page header ("Your day",
          v2.2 A6), so this view no longer repeats a heading — it goes straight to
          the plan (or the caught-up empty card). */}
      {empty ? (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <MapPin className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">You&apos;re all caught up</p>
            <p className="text-body-md text-text-muted">
              No follow-ups owed or due today, and no appointments on the calendar. Find
              some nearby businesses to prospect.
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddNearby}>
            Build my day
          </Button>
        </Card>
      ) : (
        <>
          {hasRoutable && (
          <>
          {/* List | Map segmented toggle (v2.2 A5 / 3.2), styled like the Run |
              Stops tablist. List is the default. Both views render the same day
              (`visibleProposal`); toggling only flips which container is shown. */}
          <div
            role="tablist"
            aria-label="Day view"
            className="flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5"
          >
            {([["list", "List", List], ["map", "Map", MapIcon]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={dayView === key}
                onClick={() => setDayView(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-radius-sm px-4 py-1.5 text-caption font-medium transition-colors",
                  dayView === key
                    ? "bg-surface-default text-text-default shadow-sm"
                    : "text-text-muted hover:text-text-default",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {/* LIST view: the stop list, the add-stops control, and the fill
              notice. CSS-hidden (not unmounted) when Map is active. The add-stops
              control + fill notice are list-only for this release (3.2). */}
          <div
            data-testid="day-list-wrapper"
            className={cn("flex flex-col gap-4", dayView === "map" && "hidden")}
          >
          {/* The proposal, in run order, each stop showing its plain reason line. */}
          <ol className="flex flex-col gap-1.5">
            {visibleProposal.map((stop, i) => (
              <ProposalRow
                key={`${stop.kind}-${stop.id}`}
                stop={stop}
                index={i}
                isFill={fillMarkerIds.has(stop.id)}
                onRemove={stop.kind === "flexible" ? () => handleRemove(stop.id) : undefined}
                onOpenDeal={onOpenDeal}
              />
            ))}
          </ol>

          {/* Add-stops control (v2.2 A8): a single full-width DASHED open-slot
              row, directly beneath the last stop row and above the fill notice.
              It is a SECONDARY optional action, so it stays transparent with no
              elevation; the only FILLED button on the screen is "Start driving".
              It still folds the next ranked overflow candidate into its gap via
              handleAddStop (behavior unchanged). When no capacity remains OR no
              candidate is left it is rendered DISABLED (never hidden), and the
              capacity string is replaced by the static full-day sentence. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleAddStop}
              disabled={!canAddStop || budgetLeft < MIN_STOP_MIN}
              className={cn(
                "flex w-full items-center gap-2 rounded-radius-md border border-dashed border-border-default bg-transparent px-3 py-3 text-left",
                "transition-colors hover:border-border-strong hover:bg-surface-sunken/40 active:bg-surface-sunken",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-default disabled:hover:bg-transparent",
              )}
            >
              <Plus className="h-4 w-4 shrink-0 text-text-default" aria-hidden />
              <span className="text-body-strong text-text-default">Add more stops</span>
              {/* Capacity string: advisory, same line, muted + smaller (not part
                  of the label). Full-day sentence when nothing more fits. */}
              <span className="ml-auto shrink-0 text-caption text-text-subtle">
                {budgetLeft < MIN_STOP_MIN
                  ? fullDaySentence(windowEndHour)
                  : capacitySentence(budgetLeft)}
              </span>
            </button>

            {/* "Add more nearby" opens Find-near-me. Demoted to a small secondary
                text link (v2.2 A8), and flag-gated behind VITE_PATH_ADD_NEARBY
                (v2.2 A3): hidden by default, rendered only when the flag is on.
                onAddNearby stays wired (Build my day still uses it). */}
            {showAddNearby && (
              <button
                type="button"
                onClick={onAddNearby}
                className="self-start rounded-radius-sm text-caption font-medium text-brand-primary transition-colors hover:text-brand-primary-pressed hover:underline focus-visible:outline-none focus-visible:underline"
              >
                Add more nearby
              </button>
            )}
          </div>

          {/* Fill notice (v2.2 A9): a tinted inline PANEL (not a toast, in
              content flow) reporting how many nearby stops were auto-added into
              open time. Uses an info tint (never the warm/amber aging range),
              carries an Undo and a Dismiss affordance, and sits beneath the
              add-stops control and above Start. Suppressed on an empty day
              (handled by "Build my day"), when nothing was auto-filled, or once
              locally dismissed. */}
          {hasCommitment && nearbyFillCount > 0 && !fillNoticeDismissed && (
            <div className="flex items-start gap-3 rounded-radius-md border border-status-info/30 bg-status-info-bg px-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-md text-text-default">
                  Added {nearbyFillCount} {nearbyFillCount === 1 ? "stop" : "stops"} to your day.
                </p>
                <button
                  type="button"
                  onClick={handleUndoFill}
                  className="self-start rounded-radius-sm text-caption font-medium text-brand-primary transition-colors hover:text-brand-primary-pressed hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  Undo
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFillNoticeDismissed(true)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-text-muted transition-colors hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
          </div>

          {/* MAP view: the same day's stops on DayStopsMap. Kept ALWAYS MOUNTED
              (only CSS-hidden when List is active) so the MapLibre instance and
              its GL context survive toggles and never re-initialize. The wrapper
              carries a real height so the map is not zero-size when shown, and
              `active` tells the map to resize on the hidden -> shown transition. */}
          <div
            data-testid="day-map-wrapper"
            className={cn("h-[60vh] min-h-[360px]", dayView === "list" && "hidden")}
          >
            <DayStopsMap
              stops={mapStops}
              origin={origin}
              onStopClick={handleStopClick}
              active={dayView === "map"}
            />
          </div>
          </>
          )}

          {/* No location yet: owed drop-ins on deals without coordinates. They
              are surfaced (never dropped) but are NOT routable, so they sit
              outside the plan with a plain caption and an Open-deal action so the
              rep can add an address and let a later geocode step route them. */}
          {noLocation.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col">
                <span className="text-caption font-medium text-text-muted">No location yet</span>
                <span className="text-caption text-text-subtle">
                  Add an address so these can join your route
                </span>
              </div>
              {noLocation.map((s) => (
                <div
                  key={s.taskId}
                  className="flex items-center gap-3 rounded-radius-md border border-dashed border-border-default bg-surface-sunken/40 p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
                    <MapPinOff className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-body-strong text-text-default">{s.name}</p>
                    <p className="mt-0.5 text-caption text-text-muted">
                      Add an address to put this on your route.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={ExternalLink}
                    onClick={() => onOpenDeal(s.dealId)}
                  >
                    Open deal
                  </Button>
                </div>
              ))}
            </div>
          )}

          {hasRoutable && (
          <>
          {/* Hero Start: the rep's single most important daily action, now at the
              BOTTOM of the content flow (after the plan, add-stops, and any
              overflow / no-location groups) so the rep reviews the day first,
              then starts. It stays in normal document flow and scrolls with the
              page (not pinned/sticky). Rendered whenever the day has ANY stop
              (visibleProposal), so an appointment-only day can still start the
              driving view (which drives the appointments live). onStart still
              receives only the FLEXIBLE stops — appointments are calendar
              anchors, never created as merchant stops — so the flexible array may
              be empty on an appointment-only day. The subline counts the whole
              drivable day. */}
          {visibleProposal.length > 0 && (
            <button
              type="button"
              onClick={() => onStart(flexibleStops)}
              disabled={isStarting}
              aria-label={`Start driving, ${visibleProposal.length} stop${visibleProposal.length === 1 ? "" : "s"}`}
              className={cn(
                "group flex w-full items-center gap-3 rounded-radius-lg px-4 py-3.5 text-left",
                "bg-brand-primary text-brand-primary-foreground shadow-sm",
                "transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                "disabled:cursor-not-allowed disabled:opacity-70",
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary-foreground/20">
                {isStarting ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Navigation className="h-5 w-5" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-lg font-semibold leading-tight">Start driving</span>
                <span className="text-caption text-brand-primary-foreground/75">
                  {visibleProposal.length} stop{visibleProposal.length === 1 ? "" : "s"} to run
                </span>
              </span>
              <ArrowRight
                className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          )}

          {/* One-sentence rationale for the order, on demand (FR-PATH-UX-14),
              sitting directly beneath the Start button. */}
          <details className="text-caption text-text-subtle">
            <summary className="cursor-pointer select-none">Why this order?</summary>
            <p className="mt-1 text-text-muted">
              Appointments go where they are booked. Everything else is ordered by how long it has been,
              unless a place is well out of your way.
            </p>
          </details>
          </>
          )}
        </>
      )}
    </div>
  );
}

// ─── ProposalRow ──────────────────────────────────────────────────────

function ProposalRow({
  stop,
  index,
  isFill = false,
  onRemove,
  onOpenDeal,
}: {
  stop: OrderedStop;
  index: number;
  /** True while this row was auto-added by a fill AND the fill notice still
   *  refers to it (v2.2 4.7.1): renders an unobtrusive "Added" marker + a
   *  dashed-accent left treatment so the rep can see what the notice reverses.
   *  Cleared the moment the stop is dropped or the batch is undone. */
  isFill?: boolean;
  onRemove?: () => void;
  /** Open the appointment's deal from the landing. */
  onOpenDeal?: (dealId: string) => void;
}) {
  const accent = tierAccent(stop.tier);
  const isAppointment = stop.tier === "appointment";
  // Appointments with a linked deal get an "Open deal" action so the rep can
  // reach the deal straight from the landing (external calendar meetings carry
  // no dealId, so they show nothing). Flexible rows keep the remove control.
  const appointmentDealId = isAppointment ? stop.dealId : null;

  // Left-rail label (the category) + the detail-only sentence beneath the name
  // (v2.2 B 4.5 / 4.5.1). The sentence NEVER repeats the category word and may
  // be empty (an appointment with no contact) - the row still renders its name.
  const rstop = {
    kind: stop.kind,
    tier: stop.tier,
    startAt: stop.startAt,
    ageDays: stop.ageDays,
    datePromisedToday: stop.datePromised ?? false,
    hasPriorActivity: stop.tier !== "nearby",
  };
  const label = stopLabel(rstop);
  const reason = reasonLine(rstop);

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-radius-md border p-3",
        isAppointment ? accent.border : "border-border-subtle bg-surface-default",
        // Fill marker (v2.2 4.7.1): a subtle dashed-accent left treatment while
        // the notice still attributes this row to the fill. Unobtrusive, cleared
        // on drop/Undo. Does not override the appointment accent.
        isFill && !isAppointment && "border-l-2 border-l-brand-primary border-dashed bg-brand-primary/5",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
          accent.icon,
        )}
        aria-label={`stop ${index + 1}`}
      >
        {isAppointment ? <CalendarClock className="h-3.5 w-3.5" aria-hidden /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-body-strong text-text-default">{stop.name}</p>
          {isAppointment && stop.startAt && (
            <span className="shrink-0 text-caption tabular-nums text-accent-violet">
              {fmtTime(stop.startAt)}
            </span>
          )}
        </div>
        {/* Left-rail category label (v2.2 B 4.5): a small muted category word.
            Neutral for now; aging COLOUR is B-T6, never encoded in the label. */}
        <span className="mt-0.5 flex items-center gap-1.5 text-caption font-medium text-text-muted">
          {label}
          {/* Fill marker (v2.2 4.7.1): a small unobtrusive "Added" chip present
              only while the notice attributes this row to the fill. */}
          {isFill && !isAppointment && (
            <span
              data-testid={`fill-marker-${stop.id}`}
              className="inline-flex items-center rounded-radius-full bg-brand-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-brand-primary"
            >
              Added
            </span>
          )}
        </span>
        {/* Detail-only sentence (v2.2 B 4.5.1). Rendered only when non-empty so
            an appointment with no contact does not leave a blank line, and the
            row never collapses (the name above always renders). */}
        {reason && (
          // v2.2 B 4.6: aging COLOR from the band (neutral/warm/hot), not the old
          // `past_due && ageDays > 0` boolean. Color encodes aging only.
          <p className={cn("mt-0.5 text-caption", agingReasonTextClass(agingStateFromBand(stop.bandPosition)))}>
            {reason}
          </p>
        )}
      </div>

      {onRemove && (
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          leadingIcon={Trash2}
          aria-label={`Remove ${stop.name}`}
          onClick={onRemove}
        />
      )}

      {appointmentDealId && onOpenDeal && (
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={ExternalLink}
          aria-label={`Open deal for ${stop.name}`}
          onClick={() => onOpenDeal(appointmentDealId)}
        >
          Open deal
        </Button>
      )}
    </li>
  );
}
