import * as React from "react";
import { ChevronDown, Navigation, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Input } from "@/components/navigatr";
import { formatDistance, type LatLng } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import type { MerchantWithDistance } from "./MerchantList";
import { MerchantMap } from "./MerchantMap";
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

/** "Mostly Manufacturing & Professional Services" — top 1-2 categories by count. */
export function routeDescriptor(stops: MerchantWithDistance[]): string {
  if (stops.length === 0) return "";
  const counts = new Map<MerchantCategory, number>();
  for (const s of stops) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => CATEGORY_LABEL[c]);
  return top.length === 1 ? `All ${top[0]}` : `Mostly ${top[0]} & ${top[1]}`;
}

/**
 * SelectStops — Create step 2. Map-led "Confirm route": the default view shows the
 * route on a map + a one-line summary + Start, so the rep confirms at a glance
 * instead of scrolling 25 rows. "Edit stops" opens the editable list (numbered route
 * rows + "Add nearby"); Done returns to Confirm. Selection logic lives in the wizard.
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

  const [view, setView] = React.useState<"confirm" | "edit">("confirm");
  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(selected.length === 0);
  React.useEffect(() => {
    if (selected.length === 0) setAddOpen(true);
  }, [selected.length]);

  const q = search.trim().toLowerCase();
  const unselectedAll = pool.filter((m) => !selectedIds.has(m.id) && (q === "" || m.name.toLowerCase().includes(q)));
  const unselected = unselectedAll.slice(0, MORE_CAP);
  const moreTruncated = unselectedAll.length - unselected.length;
  const addCount = pool.length - selected.length;
  const noStops = selected.length === 0;

  const summaryLine = (
    <span className="text-body-md font-medium text-text-default">
      In your route · {stats.stopCount}
      {stats.stopCount > 0 && (
        <span className="text-text-muted">
          {" · "}{formatDistance(stats.totalRouteMeters)}{" · "}{formatEta(stats.etaMinutes)}
        </span>
      )}
    </span>
  );

  // ───────────────────────── Confirm view (default) ─────────────────────────
  if (view === "confirm") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-default px-5 py-3">{summaryLine}</div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          <MerchantMap
            position={origin}
            merchants={ordered}
            routePath={[origin, ...ordered.map((m) => ({ lat: m.lat, lng: m.lng }))]}
            className="h-56 w-full shrink-0 overflow-hidden rounded-radius-md"
          />
          {pool.length === 0 ? (
            <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
              No businesses match these filters. Go back and widen the radius or industries.
            </p>
          ) : noStops ? (
            <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
              No stops yet — tap Edit stops to add nearby businesses.
            </p>
          ) : (
            <p className="text-caption text-text-muted">{routeDescriptor(selected)}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border-default px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button
            variant="primary" leadingIcon={Navigation} className="w-full"
            disabled={noStops} onClick={() => onStart(ordered.map((m) => m.id))}
          >
            Start path ({selected.length})
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onBack}>Back</Button>
            <Button variant="secondary" leadingIcon={Pencil} className="flex-1" onClick={() => setView("edit")}>
              Edit stops ({selected.length})
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────────── Edit view ──────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-default px-5 py-3">
        <span className="text-body-md font-medium text-text-default">Edit route · {stats.stopCount}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {pool.length === 0 ? (
          <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
            No businesses match these filters. Go back and widen the radius or industries.
          </p>
        ) : (
          <>
            {noStops ? (
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

            <div className="flex flex-col gap-2">
              <button
                type="button" onClick={() => setAddOpen((o) => !o)}
                aria-expanded={addOpen} aria-controls="add-nearby-list"
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

      <div className="flex shrink-0 gap-2 border-t border-border-default px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={() => setView("confirm")}>Done</Button>
        <Button
          variant="primary" leadingIcon={Navigation} className="flex-1"
          disabled={noStops} onClick={() => onStart(ordered.map((m) => m.id))}
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
