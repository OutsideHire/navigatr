import * as React from "react";
import { Check, X, Plus, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { MerchantMap } from "./MerchantMap";
import { useTodayPath } from "../hooks/useTodayPath";
import { routeStats, formatEta } from "../lib/routeStats";
import { formatDistance } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";

interface ActivePathViewProps {
  /** Rep position — route math + map center. */
  origin: { lat: number; lng: number };
  /** Open the discovery / "add stops" view. */
  onAddStops: () => void;
  /** Enter running mode (turn-by-turn route). */
  onStartRoute: () => void;
}

/**
 * ActivePathView — the path-first home. The rep's current day's path IS the main
 * content: a light progress header, the ordered stops (status + remove), a route
 * map, and Add stops. Renders entirely from useTodayPath stop snapshots, so it
 * works for a path whose stops aren't in the current discovery list. Actions stay
 * visible (mobile-first — no hover-to-discover).
 */
export function ActivePathView({ origin, onAddStops, onStartRoute }: ActivePathViewProps) {
  const { stops, setStatus, remove } = useTodayPath();
  const orderedCoords = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = React.useMemo(() => routeStats(origin, orderedCoords), [origin, stops]);
  const routePath = stops.length > 0 ? [origin, ...orderedCoords] : undefined;
  const visited = stops.filter((s) => s.status === "visited").length;

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-heading-md text-text-default">Today&apos;s path</h2>
          <span className="text-caption tabular-nums text-text-muted">
            {visited}/{stats.stopCount} done · ~{formatEta(stats.etaMinutes)}
          </span>
        </div>
        <p className="text-caption text-text-subtle">
          {stats.stopCount} stops
          {stats.furthestMeters != null ? ` · ${formatDistance(stats.furthestMeters)} to furthest` : ""}
        </p>

        {stops.some((s) => s.status === "pending") && (
          <Button variant="primary" size="sm" leadingIcon={Navigation} onClick={onStartRoute} className="self-start">
            Start route
          </Button>
        )}

        <ol className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {stops.map((s, i) => (
            <li
              key={s.merchantId}
              className="group flex items-center gap-3 rounded-radius-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-default"
            >
              <span
                className={cn(
                  "w-5 shrink-0 text-center text-caption font-semibold tabular-nums",
                  s.status === "visited" ? "text-status-success" : "text-text-subtle",
                )}
              >
                {s.status === "visited" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-body-md font-medium",
                    s.status === "pending" ? "text-text-default" : "text-text-muted",
                  )}
                >
                  {s.name}
                </p>
                <p className="truncate text-caption text-text-subtle">
                  {CATEGORY_LABEL[s.category as MerchantCategory] ?? s.category}
                  {s.status === "skipped" ? " · skipped" : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Mark visited"
                onClick={() => setStatus(s.merchantId, "visited")}
                className="rounded-radius-sm p-1.5 text-text-subtle transition-colors hover:text-status-success"
              >
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Remove from path"
                onClick={() => remove(s.merchantId)}
                className="rounded-radius-sm p-1.5 text-text-subtle transition-colors hover:text-status-danger"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>

        <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddStops} className="self-start">
          Add stops
        </Button>
      </div>

      <div className="min-h-[280px]">
        <MerchantMap position={origin} merchants={[]} routePath={routePath} />
      </div>
    </div>
  );
}
