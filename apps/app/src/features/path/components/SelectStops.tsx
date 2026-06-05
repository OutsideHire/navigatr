import * as React from "react";
import { ChevronDown, Navigation, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Input } from "@/components/navigatr";
import { formatDistance, type LatLng } from "@/lib/distance";
import { CATEGORY_LABEL } from "../mockData";
import type { MerchantWithDistance } from "./MerchantList";
import { type PathSortMode } from "../lib/sortMerchants";
import { orderStops } from "../lib/proposeRoute";
import { routeStats, formatEta } from "../lib/routeStats";

/** Cap on visible candidate rows so a 500-deep pool never paints in full. */
const MORE_CAP = 100;

const SORTS: Array<{ label: string; mode: PathSortMode }> = [
  { label: "Opportunity", mode: "opportunity" },
  { label: "Distance", mode: "distance" },
];

export interface SelectStopsProps {
  pool: MerchantWithDistance[];
  origin: LatLng;
  sortMode: PathSortMode;
  onSortChange: (mode: PathSortMode) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onBack: () => void;
  onStart: (orderedIds: string[]) => void;
}

function metaLine(m: MerchantWithDistance): string {
  return (
    (Number.isFinite(m.distanceMeters) ? `${formatDistance(m.distanceMeters)} · ` : "") +
    CATEGORY_LABEL[m.category] +
    (typeof m.rating === "number" ? ` · ★${m.rating.toFixed(1)}` : "")
  );
}

/**
 * SelectStops — Create step 2 (slide-out panel body), route-first. The rep's route
 * is the hero: selected stops in nearest-neighbor (drive) order, numbered, each
 * removable. "Add nearby" is a collapsed section (sort + search + candidates) you
 * expand to add — auto-open when the route is empty. Selection logic lives in the
 * wizard; Start hands the NN-ordered selection up.
 */
export function SelectStops({
  pool, origin, sortMode, onSortChange, selectedIds, onToggle, onBack, onStart,
}: SelectStopsProps) {
  const selected = React.useMemo(() => pool.filter((m) => selectedIds.has(m.id)), [pool, selectedIds]);
  const ordered = React.useMemo(() => orderStops(origin, selected), [origin, selected]);
  const stats = React.useMemo(
    () => routeStats(origin, ordered.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, ordered],
  );

  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(selected.length === 0);
  // Keep the add section open whenever the route is empty (nothing to show above it).
  React.useEffect(() => {
    if (selected.length === 0) setAddOpen(true);
  }, [selected.length]);

  const q = search.trim().toLowerCase();
  const unselectedAll = pool.filter((m) => !selectedIds.has(m.id) && (q === "" || m.name.toLowerCase().includes(q)));
  const unselected = unselectedAll.slice(0, MORE_CAP);
  const moreTruncated = unselectedAll.length - unselected.length;
  const addCount = pool.length - selected.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky route summary */}
      <div className="shrink-0 border-b border-border-default px-5 py-3">
        <span className="text-body-md font-medium text-text-default">
          In your route · {stats.stopCount}
          {stats.stopCount > 0 && (
            <span className="text-text-muted">
              {" · "}{formatDistance(stats.totalRouteMeters)}{" · "}{formatEta(stats.etaMinutes)}
            </span>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {pool.length === 0 ? (
          <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
            No businesses match these filters. Go back and widen the radius or industries.
          </p>
        ) : (
          <>
            {/* Route — the hero */}
            {selected.length === 0 ? (
              <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
                No stops in your route yet — add nearby businesses below.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {ordered.map((m, i) => (
                  <RouteRow key={m.id} m={m} index={i} onRemove={() => onToggle(m.id)} />
                ))}
              </div>
            )}

            {/* Add nearby — collapsed by default */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setAddOpen((o) => !o)}
                aria-expanded={addOpen}
                aria-controls="add-nearby-list"
                className="flex items-center justify-between rounded-radius-md border border-dashed border-border-default px-3 py-2.5 text-left text-body-md font-medium text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
              >
                <span>Add nearby{addCount > 0 ? ` · ${addCount}` : ""}</span>
                <ChevronDown className={cn("h-4 w-4 text-text-muted transition-transform", addOpen && "rotate-180")} aria-hidden />
              </button>
              {addOpen && (
                <div id="add-nearby-list" className="flex flex-col gap-2">
                  <div className="flex shrink-0 gap-0.5 self-start rounded-radius-md bg-surface-sunken p-0.5">
                    {SORTS.map((opt) => (
                      <button key={opt.mode} type="button" onClick={() => onSortChange(opt.mode)}
                        aria-pressed={sortMode === opt.mode}
                        className={cn(
                          "rounded-radius-sm px-2.5 py-1 text-caption font-medium transition-colors",
                          sortMode === opt.mode ? "bg-surface-default text-text-default shadow-sm" : "text-text-muted hover:text-text-default",
                        )}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input aria-label="Search businesses" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search businesses…" />
                  {unselected.map((m) => <AddRow key={m.id} m={m} onAdd={() => onToggle(m.id)} />)}
                  {moreTruncated > 0 && (
                    <span className="px-1 text-caption text-text-muted">+{moreTruncated} more — search to narrow.</span>
                  )}
                  {unselectedAll.length === 0 && (
                    <span className="px-1 text-caption text-text-muted">
                      {q ? "No matches." : "All nearby businesses are in your route."}
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Sticky footer */}
      <div className="flex shrink-0 gap-2 border-t border-border-default px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button
          variant="primary" leadingIcon={Navigation} className="flex-1"
          disabled={selected.length === 0}
          onClick={() => onStart(ordered.map((m) => m.id))}
        >
          Start path ({selected.length})
        </Button>
      </div>
    </div>
  );
}

/** A stop in the route: numbered drive-order badge + name/meta + remove. */
function RouteRow({ m, index, onRemove }: { m: MerchantWithDistance; index: number; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-radius-md border border-border-default p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary text-caption font-semibold tabular-nums text-brand-primary-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-md text-text-default">{m.name}</p>
        <p className="text-caption text-text-muted">{metaLine(m)}</p>
      </div>
      <button
        type="button" aria-label={`Remove ${m.name}`} onClick={onRemove}
        className="-m-1 rounded-radius-sm p-2 text-text-muted hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** A nearby candidate you can add: checkbox + name/meta. */
function AddRow({ m, onAdd }: { m: MerchantWithDistance; onAdd: () => void }) {
  return (
    <div className="rounded-radius-md border border-border-default p-3">
      <Checkbox checked={false} onCheckedChange={onAdd} label={m.name} helper={metaLine(m)} />
    </div>
  );
}
