/**
 * ActivePathView — THE single Today's-path home (no modal).
 *
 * This view is now the rich home surface for the rep's current day's path: a
 * light progress header, the ordered stops with per-stop status badges, leg
 * distances and inline actions (mark visited / skip / remove / reopen), a Start
 * route action, an Add stops / Clear path footer, and a route map. When every
 * stop is resolved it swaps the list for the end-of-path PathSummary. The old
 * PathPlanSheet modal that used to carry this content is retired — everything
 * lives here, rendered straight from useTodayPath stop snapshots.
 */
import * as React from "react";
import { ArrowRight, Check, CircleDashed, Navigation, Plus, SkipForward, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { formatDistance, haversineMeters } from "@/lib/distance";
import type { Disposition } from "@/lib/followUpScheduling";
import { labelForCategory } from "../mockData";
import { useTodayPath } from "../hooks/useTodayPath";
import type { TodayStop } from "../hooks/useTodayPath";
import { routeStats, formatEta } from "../lib/routeStats";
import { MerchantMap } from "./MerchantMap";
import { PathSummary } from "./PathSummary";

interface ActivePathViewProps {
  /** Rep position — route math + map center. */
  origin: { lat: number; lng: number };
  /** Open the discovery / "add stops" view. */
  onAddStops: () => void;
  /** Enter running mode (turn-by-turn route). */
  onStartRoute: () => void;
}

export function ActivePathView({ origin, onAddStops, onStartRoute }: ActivePathViewProps) {
  const { stops, setStatus, remove, clear, isComplete } = useTodayPath();
  const navigate = useNavigate();

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

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-heading-md text-text-default">Today&apos;s path</h2>
          <span className="text-caption tabular-nums text-text-muted">
            {visited}/{stats.stopCount} visited · {formatDistance(stats.totalRouteMeters)} · {formatEta(stats.etaMinutes)}
          </span>
        </div>

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
            {/* Hero CTA — the rep's single most important daily action. Full-width,
                saturated brand fill, icon chip + forward arrow so it reads as
                "launch", not just another button. The header already carries
                distance/ETA, so the subline stays action-framed ("stops to go")
                rather than repeating those metrics. */}
            {pending > 0 && (
              <button
                type="button"
                onClick={onStartRoute}
                aria-label={`Start route — ${pending} stop${pending === 1 ? "" : "s"} to go`}
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

            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              {stops.map((s, i) => (
                <StopRow
                  key={s.merchantId}
                  stop={s}
                  index={i}
                  leg={legs[i] ?? 0}
                  onVisited={() => {
                    setStatus(s.merchantId, "visited");
                    toast.success(`Marked ${s.name} as visited`);
                  }}
                  onSkip={() => {
                    setStatus(s.merchantId, "skipped");
                    toast(`Skipped ${s.name}`);
                  }}
                  onRemove={() => {
                    remove(s.merchantId);
                    toast(`Removed ${s.name} from path`);
                  }}
                  onReopen={() => setStatus(s.merchantId, "pending")}
                />
              ))}
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

      <div className="min-h-[280px]">
        <MerchantMap position={origin} merchants={[]} routePath={routePath} />
      </div>
    </div>
  );
}

// ─── StopRow ──────────────────────────────────────────────────────────

function StopRow({
  stop,
  index,
  leg,
  onVisited,
  onSkip,
  onRemove,
  onReopen,
}: {
  stop: TodayStop;
  index: number;
  leg: number;
  onVisited: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onReopen: () => void;
}) {
  const status = stop.status;
  const isResolved = status !== "pending";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-radius-md border border-border-subtle bg-surface-default p-3",
        status === "visited" && "opacity-75",
        status === "skipped" && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
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

        <div className="flex min-w-0 flex-1 flex-col">
          <p className={cn("truncate text-body-strong text-text-default", isResolved && "line-through")}>
            {stop.name}
          </p>
          <p className="text-caption text-text-muted">
            {labelForCategory(stop.category)}
            {stop.address ? ` · ${stop.address}` : ""}
          </p>
          <p className="mt-1 text-caption text-text-subtle tabular-nums">
            {index === 0 ? "From start" : "From prev stop"}: {formatDistance(leg)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-10">
        {status === "pending" ? (
          <>
            <Button variant="primary" size="sm" leadingIcon={Check} onClick={onVisited}>
              Mark visited
            </Button>
            <Button variant="tertiary" size="sm" leadingIcon={SkipForward} onClick={onSkip}>
              Skip
            </Button>
            <Button variant="tertiary" size="sm" leadingIcon={Trash2} onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <Button variant="tertiary" size="sm" leadingIcon={CircleDashed} onClick={onReopen}>
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}
