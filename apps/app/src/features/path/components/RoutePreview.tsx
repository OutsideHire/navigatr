/**
 * RoutePreview — Create step 3. A read-only confirmation of the optimized
 * (nearest-neighbor) route before the rep starts the path: a KPI summary, the
 * first few numbered stops, then "+N more stops". No employee/value metrics —
 * Places data doesn't carry them. Editing happens back in step 2 (Select stops).
 */
import { Navigation, Phone } from "lucide-react";

import { Button } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { formatEta, type RouteStats } from "../lib/routeStats";
import type { MerchantWithDistance } from "./MerchantList";

/** Stops listed before collapsing into a "+N more stops" line. */
const PREVIEW_ROWS = 4;

export interface RoutePreviewProps {
  /** Nearest-neighbor driving order (numbered 1..N). */
  ordered: MerchantWithDistance[];
  /** Route math for the same ordered set. */
  stats: RouteStats;
  /** Return to Select stops (step 2). */
  onBack: () => void;
  /** Commit and start the path. */
  onStart: () => void;
}

export function RoutePreview({ ordered, stats, onBack, onStart }: RoutePreviewProps) {
  const shown = ordered.slice(0, PREVIEW_ROWS);
  const moreCount = ordered.length - shown.length;

  // nearest/furthest are null for an empty route; formatDistance renders "—" for
  // non-finite input, so coerce null → NaN to reuse that path.
  const kpis: Array<{ label: string; value: string }> = [
    { label: "Stops", value: String(stats.stopCount) },
    { label: "Nearest", value: formatDistance(stats.nearestMeters ?? NaN) },
    { label: "Furthest", value: formatDistance(stats.furthestMeters ?? NaN) },
    { label: "Est. time", value: formatEta(stats.etaMinutes) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {/* KPI summary */}
        <div className="grid grid-cols-4 gap-2 rounded-radius-md bg-brand-primary-10 px-3 py-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-body-strong tabular-nums text-brand-primary">{k.value}</span>
              <span className="text-caption text-text-muted">{k.label}</span>
            </div>
          ))}
        </div>

        {/* First PREVIEW_ROWS of the nearest-neighbor route. */}
        <div className="flex flex-col gap-2">
          {shown.map((m, i) => (
            <div key={m.id} className="flex items-start gap-3 rounded-radius-md border border-border-default p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary text-caption font-semibold tabular-nums text-brand-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-text-default">{m.name}</p>
                <p className="truncate text-caption text-text-muted">
                  {m.address}
                  {Number.isFinite(m.distanceMeters) ? ` · ${formatDistance(m.distanceMeters)} away` : ""}
                </p>
                {(typeof m.rating === "number" || m.phone) && (
                  <p className="mt-1 flex items-center gap-3 text-caption text-text-muted">
                    {typeof m.rating === "number" && <span>★ {m.rating.toFixed(1)}</span>}
                    {m.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" aria-hidden /> {m.phone}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ))}
          {moreCount > 0 && (
            <p className="py-1 text-center text-caption text-text-muted">+ {moreCount} more stops</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border-default px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button variant="primary" leadingIcon={Navigation} className="flex-1" onClick={onStart}>
          Start path
        </Button>
      </div>
    </div>
  );
}

export default RoutePreview;
