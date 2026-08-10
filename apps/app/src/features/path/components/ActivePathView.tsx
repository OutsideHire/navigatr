/**
 * ActivePathView - THE single Today's-path home (no modal).
 *
 * This view is the rich home surface for the rep's current day's path. As of
 * SP-C2 the Stops tab renders EVERY tier of the day as ONE ordered, tiered,
 * actionable list (via the shared `TieredStopList`), in place of the old
 * fragmented layout (a separate owed-stops sibling above a meetings block above
 * the native route rows). The single list is ordered:
 *   1. Appointments + located external meetings (from `useMeetingStops`), each
 *      with its clock time. Appointments open the deal and (once past) log an
 *      outcome via the reused `AppointmentOutcomeSheet`; external meetings
 *      navigate + toggle a local "done".
 *   2. Past-due owed drop-ins (`useOwedVisits`, the strictly-before-today
 *      slice), each with its overdue age.
 *   3. Due-today drop-ins (`useDueTodayVisits`).
 *   4. Native nearby stops (the persisted `path_stops` from `useTodayPath`),
 *      with their existing visited / skip / remove / reopen actions.
 *
 * Owed / due-today stops are EXISTING deals, so their actions are "Open deal"
 * (navigate to the deal) + "Log drop-in" (the reused `LogActivitySheet` keyed
 * by the deal id) - never the create-deal DropInSheet path. They are rendered
 * LIVE from their hooks and never persisted as path_stops (SP-C1).
 *
 * A light progress header, the Start-route hero, an Add stops / Clear path
 * footer, and the route map bracket the list. When every native stop is
 * resolved the list swaps for the end-of-path PathSummary.
 */
import * as React from "react";
import { ArrowRight, Check, CircleDashed, Map as MapIcon, Navigation, Plus, SkipForward, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { formatDistance, haversineMeters } from "@/lib/distance";
import type { Disposition } from "@/lib/followUpScheduling";
import { labelForCategory } from "../mockData";
import { useTodayPath, todayISO } from "../hooks/useTodayPath";
import { useLiveDayTiers } from "../hooks/useLiveDayTiers";
import { reasonLine } from "../lib/reasonLine";
import { routeStats, formatEta } from "../lib/routeStats";
import { MerchantMap } from "./MerchantMap";
import { PathSummary } from "./PathSummary";
import { TieredStopList, type TieredStopRow } from "./TieredStopList";
import type { StopStatus } from "../lib/pathTypes";

interface ActivePathViewProps {
  /** Rep position - route math + map center. */
  origin: { lat: number; lng: number };
  /** Open the discovery / "add stops" view. */
  onAddStops: () => void;
  /** Enter running mode (turn-by-turn route). */
  onStartRoute: () => void;
}

/** Native-stop status badge - the status-colored circle the old StopRow drew,
 *  passed to TieredStopList as a full badge override so the nearby tier keeps
 *  its number / check / skip treatment. */
function NativeBadge({ status, index }: { status: StopStatus; index: number }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
        status === "pending" && "bg-brand-primary text-brand-primary-foreground",
        status === "visited" && "bg-status-success text-text-inverse",
        status === "skipped" && "bg-surface-sunken text-text-muted",
      )}
      aria-label={`stop ${index + 1}, ${status}`}
    >
      {status === "visited" ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : status === "skipped" ? (
        <SkipForward className="h-3.5 w-3.5" aria-hidden />
      ) : (
        index + 1
      )}
    </span>
  );
}

export function ActivePathView({ origin, onAddStops, onStartRoute }: ActivePathViewProps) {
  const { stops, setStatus, remove, clear, isComplete } = useTodayPath();
  const pathDate = todayISO();
  // The day's LIVE tiers (appointments + past-due + due-today) and their reused
  // action sheets, shared verbatim with the guided Run view via useLiveDayTiers
  // so both surfaces read ONE source of truth. Native nearby rows are appended
  // after these below.
  const { rows: liveRows, sheets: liveSheets } = useLiveDayTiers(pathDate);
  const navigate = useNavigate();

  // Show/Hide map (Path QA R4). Default HIDDEN so mobile leads with the day's
  // list and the map never eats the small screen. Desktop always shows the map
  // (the `md:block` gate on the map pane wins there); the toggle is `md:hidden`.
  const [mapVisible, setMapVisible] = React.useState(false);

  const stats = React.useMemo(
    () => routeStats(origin, stops.map((s) => ({ lat: s.lat, lng: s.lng }))),
    [origin, stops],
  );
  const routePath =
    stops.length > 0 ? [origin, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))] : undefined;

  const visited = stops.filter((s) => s.status === "visited").length;
  const skipped = stops.filter((s) => s.status === "skipped").length;
  const pending = stops.filter((s) => s.status === "pending").length;
  const complete = isComplete();

  // Leg distances: cursor starts at origin; each stop's leg is the hop from the
  // previous point, then the cursor advances to that stop.
  const legs = React.useMemo(() => {
    let cursor = origin;
    return stops.map((s) => {
      const d = haversineMeters(cursor, { lat: s.lat, lng: s.lng });
      cursor = { lat: s.lat, lng: s.lng };
      return d;
    });
  }, [stops, origin]);

  // The one ordered, tiered list: the shared LIVE tiers (appointments, past-due,
  // due-today) from useLiveDayTiers, then the native nearby route stops. The
  // native rows keep the Stops-tab-only visited / skip / remove / reopen actions
  // and their leg lines; the live rows carry their own actions from the hook.
  const nativeRows = React.useMemo<TieredStopRow[]>(() => {
    return stops.map((s, i) => {
      const resolved = s.status !== "pending";
      return {
        key: `native-${s.merchantId}`,
        tier: "nearby",
        name: s.name,
        reason: reasonLine({
          kind: "flexible",
          tier: "nearby",
          startAt: null,
          ageDays: null,
          datePromisedToday: false,
          hasPriorActivity: false,
        }),
        strikethrough: resolved,
        dimmed: resolved,
        badge: <NativeBadge status={s.status} index={i} />,
        detail: (
          <>
            <span className="block truncate">
              {labelForCategory(s.category)}
              {s.address ? ` · ${s.address}` : ""}
            </span>
            <span className="mt-1 block text-text-subtle tabular-nums">
              {i === 0 ? "From start" : "From prev stop"}: {formatDistance(legs[i] ?? 0)}
            </span>
          </>
        ),
        actions:
          s.status === "pending" ? (
            <>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Check}
                onClick={() => {
                  setStatus(s.merchantId, "visited");
                  toast.success(`Marked ${s.name} as visited`);
                }}
              >
                Mark visited
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={SkipForward}
                onClick={() => {
                  setStatus(s.merchantId, "skipped");
                  toast(`Skipped ${s.name}`);
                }}
              >
                Skip
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => {
                  remove(s.merchantId);
                  toast(`Removed ${s.name} from path`);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              variant="tertiary"
              size="sm"
              leadingIcon={CircleDashed}
              onClick={() => setStatus(s.merchantId, "pending")}
            >
              Reopen
            </Button>
          ),
      };
    });
  }, [stops, legs, setStatus, remove]);

  const rows = React.useMemo<TieredStopRow[]>(
    () => [...liveRows, ...nativeRows],
    [liveRows, nativeRows],
  );

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-heading-md text-text-default">Today&apos;s path</h2>
          <span className="text-caption tabular-nums text-text-muted">
            {visited}/{stats.stopCount} visited · {formatDistance(stats.totalRouteMeters)} · {formatEta(stats.etaMinutes)}
          </span>
        </div>

        {/* Show/Hide map toggle (Path QA R4). Mobile-only; the map pane below
            defaults hidden and is always shown on desktop via `md:block`. */}
        <button
          type="button"
          onClick={() => setMapVisible((v) => !v)}
          aria-pressed={mapVisible}
          className={cn(
            "inline-flex items-center gap-1.5 self-start rounded-radius-md bg-surface-sunken px-3 py-1.5 text-caption font-medium text-text-default transition-colors hover:bg-surface-sunken/80 md:hidden",
          )}
        >
          <MapIcon className="h-3.5 w-3.5" aria-hidden />
          {mapVisible ? "Hide map" : "Show map"}
        </button>

        {complete ? (
          <PathSummary
            visitedCount={visited}
            skippedCount={skipped}
            totalStops={stops.length}
            routeMeters={stats.totalRouteMeters}
            dispositions={stops
              .map((s) => s.disposition)
              .filter((d): d is Disposition => d != null)}
            dealsCreated={stops.filter((s) => s.dealCreated).length}
            onViewPipeline={() => navigate("/pipeline")}
            onNewPath={() => {
              void clear();
            }}
          />
        ) : (
          <>
            {/* Hero CTA - the rep's single most important daily action. Full-width,
                saturated brand fill, icon chip + forward arrow so it reads as
                "launch", not just another button. The header already carries
                distance/ETA, so the subline stays action-framed ("stops to go")
                rather than repeating those metrics. */}
            {pending > 0 && (
              <button
                type="button"
                onClick={onStartRoute}
                aria-label={`Start route - ${pending} stop${pending === 1 ? "" : "s"} to go`}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-radius-lg px-4 py-3.5 text-left",
                  "bg-brand-primary text-brand-primary-foreground shadow-sm",
                  "transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary-foreground/20">
                  <Navigation className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-lg font-semibold leading-tight">Start route</span>
                  <span className="text-caption text-brand-primary-foreground/75">
                    {pending} stop{pending === 1 ? "" : "s"} to go
                  </span>
                </span>
                <ArrowRight
                  className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            )}

            {/* The one ordered, tiered, actionable list (SP-C2). */}
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              <TieredStopList rows={rows} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddStops}>
                Add stops
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => {
                  if (window.confirm("Clear the whole path?")) void clear();
                }}
              >
                Clear path
              </Button>
            </div>
          </>
        )}
      </div>

      <div className={cn("min-h-[280px]", mapVisible ? "block" : "hidden", "md:block")}>
        <MerchantMap position={origin} merchants={[]} routePath={routePath} />
      </div>

      {/* The reused AppointmentOutcomeSheet + LogActivitySheet, owned by the
          shared useLiveDayTiers hook so the Stops tab and the Run view wire the
          identical logging flows. */}
      {liveSheets}
    </div>
  );
}
