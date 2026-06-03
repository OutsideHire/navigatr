import * as React from "react";
import { Check, X, Plus, MapPin } from "lucide-react";
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
}

/**
 * ActivePathView — the path-first home. The rep's current day's path IS the main
 * content: a stats header, the ordered stops (status + remove), a route map, and
 * Add stops. Reads the path from useTodayPath (stops carry snapshots, so this
 * renders without the discovery list). frontend-design refines the visuals.
 */
export function ActivePathView({ origin, onAddStops }: ActivePathViewProps) {
  const { stops, setStatus, remove } = useTodayPath();
  const orderedCoords = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = React.useMemo(() => routeStats(origin, orderedCoords), [origin, stops]);
  const routePath = stops.length > 0 ? [origin, ...orderedCoords] : undefined;

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 rounded-radius-md bg-surface-sunken p-3 text-center">
          <Stat label="Stops" value={`${stats.stopCount} stops`} />
          <Stat label="Nearest" value={stats.nearestMeters == null ? "—" : formatDistance(stats.nearestMeters)} />
          <Stat label="Est. time" value={formatEta(stats.etaMinutes)} />
        </div>
        <ol className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {stops.map((s, i) => (
            <li key={s.merchantId} className={cn(
              "flex items-center gap-3 rounded-radius-md border border-border-default p-3",
              s.status === "visited" && "opacity-60",
            )}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold tabular-nums text-text-muted">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-text-default">{s.name}</p>
                <p className="truncate text-caption text-text-muted">
                  <MapPin className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                  {CATEGORY_LABEL[s.category as MerchantCategory] ?? s.category}
                  {s.status !== "pending" ? ` · ${s.status}` : ""}
                </p>
              </div>
              <button type="button" aria-label="Mark visited" onClick={() => setStatus(s.merchantId, "visited")}
                className="rounded-radius-sm p-1.5 text-text-muted hover:text-status-success">
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-label="Remove from path" onClick={() => remove(s.merchantId)}
                className="rounded-radius-sm p-1.5 text-text-muted hover:text-status-danger">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-body-md font-semibold tabular-nums text-text-default">{value}</p>
      <p className="text-caption text-text-muted">{label}</p>
    </div>
  );
}
