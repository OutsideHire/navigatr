import * as React from "react";
import { ChevronDown, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Input } from "@/components/navigatr";
import { formatDistance, type LatLng } from "@/lib/distance";
import { CATEGORY_LABEL } from "../mockData";
import type { MerchantWithDistance } from "./MerchantList";
import { type PathSortMode } from "../lib/sortMerchants";
import { orderStops } from "../lib/proposeRoute";
import { routeStats, formatEta } from "../lib/routeStats";

/** Cap on visible unselected rows so a 500-deep pool never paints in full. */
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

/**
 * SelectStops — Create step 2 (slide-out panel body). Sticky top (route summary +
 * sort + search), a scrolling list (collapsible "In your route" + "More nearby"),
 * and a sticky footer (Back + Start). Rows are the navigatr Checkbox with the
 * business name as label and "distance · category · ★rating" as helper. Selection
 * logic lives in the wizard; Start hands the NN-ordered selection up.
 */
export function SelectStops({
  pool, origin, sortMode, onSortChange, selectedIds, onToggle, onBack, onStart,
}: SelectStopsProps) {
  // search + collapse state are local; going Back unmounts this panel, so both
  // reset when the rep re-enters Select stops (intended — a fresh curation pass).
  const [search, setSearch] = React.useState("");
  const [selectedOpen, setSelectedOpen] = React.useState(false);

  const selected = React.useMemo(() => pool.filter((m) => selectedIds.has(m.id)), [pool, selectedIds]);
  const ordered = React.useMemo(() => orderStops(origin, selected), [origin, selected]);
  const stats = React.useMemo(
    () => routeStats(origin, ordered.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, ordered],
  );

  const q = search.trim().toLowerCase();
  const unselectedAll = pool.filter((m) => !selectedIds.has(m.id) && (q === "" || m.name.toLowerCase().includes(q)));
  const unselected = unselectedAll.slice(0, MORE_CAP);
  const moreTruncated = unselectedAll.length - unselected.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border-default px-5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-md font-medium text-text-default">
            {stats.stopCount} {stats.stopCount === 1 ? "stop" : "stops"}
            <span className="text-text-muted">
              {" · "}{formatDistance(stats.totalRouteMeters)}{" · "}{formatEta(stats.etaMinutes)}
            </span>
          </span>
          <div className="flex shrink-0 gap-0.5 rounded-radius-md bg-surface-sunken p-0.5">
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
        </div>
        <Input aria-label="Search businesses" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search businesses…" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {pool.length === 0 ? (
          <p className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
            No businesses match these filters. Go back and widen the radius or industries.
          </p>
        ) : (
          <>
            {selected.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedOpen((o) => !o)}
                  aria-expanded={selectedOpen}
                  aria-controls="selected-stops-list"
                  className="flex items-center justify-between rounded-radius-md border border-brand-primary bg-surface-sunken px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
                >
                  <span className="text-body-md font-medium text-text-default">In your route · {selected.length}</span>
                  <ChevronDown className={cn("h-4 w-4 text-text-muted transition-transform", selectedOpen && "rotate-180")} aria-hidden />
                </button>
                {selectedOpen && (
                  <div id="selected-stops-list" className="flex flex-col gap-1.5">
                    {selected.map((m) => <StopRow key={m.id} m={m} checked onToggle={onToggle} accent />)}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">More nearby</span>
              {unselected.map((m) => <StopRow key={m.id} m={m} checked={false} onToggle={onToggle} />)}
              {moreTruncated > 0 && (
                <span className="px-1 text-caption text-text-muted">+{moreTruncated} more — search to narrow.</span>
              )}
              {unselectedAll.length === 0 && selected.length > 0 && (
                <span className="px-1 text-caption text-text-muted">All nearby businesses are selected.</span>
              )}
            </div>
          </>
        )}
      </div>

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

function StopRow({
  m, checked, onToggle, accent,
}: { m: MerchantWithDistance; checked: boolean; onToggle: (id: string) => void; accent?: boolean }) {
  const meta =
    (Number.isFinite(m.distanceMeters) ? `${formatDistance(m.distanceMeters)} · ` : "") +
    CATEGORY_LABEL[m.category] +
    (typeof m.rating === "number" ? ` · ★${m.rating.toFixed(1)}` : "");
  return (
    <div className={cn("rounded-radius-md border p-3", accent ? "border-brand-primary" : "border-border-default")}>
      <Checkbox checked={checked} onCheckedChange={() => onToggle(m.id)} label={m.name} helper={meta} />
    </div>
  );
}
