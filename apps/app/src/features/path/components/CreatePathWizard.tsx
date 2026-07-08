/**
 * CreatePathWizard — the guided "Create path" flow (Path v2, Slice 2).
 *
 * Two steps inside one Radix Dialog (same shell pattern as the other Path dialogs):
 *   1. Filters — radius (5/10/15mi), industry (category bucket), stop cap.
 *   2. Select stops — the editable candidate pool (SelectStops): the optimized
 *      top-N pre-selected, the rest of the nearby pool below, Distance/Opportunity
 *      sort. The rep curates; "Start path" hands the nearest-neighbor-ordered
 *      merchant IDs to the caller, which writes them into the queue. Places-only:
 *      no employee/value/email anywhere.
 *
 * The wizard does NOT fetch — PathPage owns useMerchants and passes the loaded,
 * distance-annotated, radius-gated merchants in. Changing the radius here calls
 * onRadiusChange so PathPage re-ingests at the new radius (Slice 1 wiring).
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Route as RouteIcon, Pencil } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Checkbox, Input, Select } from "@/components/navigatr";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import { IndustryEditor } from "./IndustryEditor";
import { SelectStops } from "./SelectStops";
import { CalendarOverlay } from "./CalendarOverlay";
import type {
  CalendarStatus,
  CalendarTimeBlock,
  CalendarWaypoint,
} from "../hooks/useCalendarEvents";
import type { Interval } from "../lib/freeWindows";
import { usePathPreferences, useUpdateDefaultIndustries } from "../hooks/usePathPreferences";
import { selectedCategories, type IndustrySelection } from "../lib/industrySelection";
import type { MerchantWithDistance } from "./MerchantList";
import { type PathSortMode } from "../lib/sortMerchants";
import { candidatePool, orderStops } from "../lib/proposeRoute";
import { routeStats } from "../lib/routeStats";
import { scheduleDay, type ScheduleResult } from "../lib/scheduleDay";
import { RoutePreview } from "./RoutePreview";
import { ResultsCountField } from "./ResultsCountField";

export interface CreatePathWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rep position — preview route math measures from here. */
  origin: { lat: number; lng: number };
  /** Loaded + distance-annotated merchants (already radius-gated by PathPage). */
  merchants: MerchantWithDistance[];
  /** Current ingest radius (meters); the radius Select reflects + drives it. */
  radiusM: number;
  onRadiusChange: (meters: number) => void;
  /** Results count — how many nearby businesses to fetch/show (the pool size,
   *  SEPARATE from the Max-stops cap). Drives PathPage's useMerchants limit. */
  resultsCount: number;
  onResultsCountChange: (count: number) => void;
  /** Push the rep's industry scope up so PathPage re-ingests (like radius). */
  onIndustriesChange: (industries: MerchantCategory[]) => void;
  /** Push the "All industries" toggle up so PathPage ingests every bucket. */
  onAllIndustriesChange: (allIndustries: boolean) => void;
  /** Called with the ordered merchant IDs when the rep starts the path. */
  onStart: (orderedIds: string[]) => void;
  /** OPTIONAL — the rep's day time-window, as ISO datetimes for today in their
   *  local timezone. Emitted on mount and whenever Start/End change. A later
   *  task lifts this to PathPage to drive the calendar read; the wizard owns the
   *  local window state and works fine without this callback. */
  onWindowChange?: (window: { start: string; end: string }) => void;
  /** OPTIONAL — Calendar-Aware Path (Slice 1). Mappable calendar appointments,
   *  shown as read-only waypoints atop the Select-stops step. Default empty. */
  calendarWaypoints?: CalendarWaypoint[];
  /** OPTIONAL — unmappable calendar events (time blocks) for the day view. */
  calendarTimeBlocks?: CalendarTimeBlock[];
  /** OPTIONAL — free gaps in the day derived from the window minus meetings. */
  calendarFreeWindows?: Interval[];
  /** OPTIONAL — the rep's calendar connection state. Default "not_connected". */
  calendarStatus?: CalendarStatus;
  /** OPTIONAL — re-pull the calendar read. Default no-op. */
  onRefreshCalendar?: () => void;
}

/** Same options + segmented style as PathPage's "Within" control — the wizard
 *  shares that radius state, so it must look like the same control, not a
 *  separate setting. */
const RADIUS_OPTIONS: Array<{ label: string; meters: number }> = [
  { label: "5 mi", meters: 8047 },
  { label: "10 mi", meters: 16093 },
  { label: "15 mi", meters: 24140 },
];

/** Min-rating Select options. "Any" = no filter; the rest are inclusive floors
 *  on the Google rating already loaded for each prospect. (No "Min employees" —
 *  employee count isn't available from Places.) */
const RATING_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Any", value: 0 },
  { label: "3.0+", value: 3 },
  { label: "3.5+", value: 3.5 },
  { label: "4.0+", value: 4 },
  { label: "4.5+", value: 4.5 },
];

/** Default + bounds for the free-entry "Max stops" field. 100 is a practical
 *  ceiling on a single drop-in day's route — independent of the larger
 *  read-path cap (prospects_nearby returns up to 500). */
const DEFAULT_STOP_CAP = 25;
const MAX_STOP_CAP = 100;

/** Default day time-window shown in the "When" control. */
const DEFAULT_WINDOW_START = "08:00";
const DEFAULT_WINDOW_END = "18:00";

/** Convert an `HH:MM` value into an ISO datetime for TODAY in the rep's local
 *  timezone (today's date at that local time). new Date() is local-today;
 *  setHours sets the local wall-clock time; toISOString normalizes to UTC. */
function hhmmToIsoToday(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** Add one hour to an `HH:MM` value, wrapping at 24h (used to clamp End to
 *  Start + 1h when End <= Start). */
function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const next = (h + 1) % 24;
  return `${String(next).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Step = "filters" | "select" | "preview";

export function CreatePathWizard({
  open,
  onOpenChange,
  origin,
  merchants,
  radiusM,
  onRadiusChange,
  resultsCount,
  onResultsCountChange,
  onIndustriesChange,
  onAllIndustriesChange,
  onStart,
  onWindowChange,
  calendarWaypoints = [],
  calendarTimeBlocks = [],
  calendarFreeWindows = [],
  calendarStatus = "not_connected",
  onRefreshCalendar,
}: CreatePathWizardProps) {
  const { data: prefs } = usePathPreferences();
  const updateDefaults = useUpdateDefaultIndustries();

  const [step, setStep] = React.useState<Step>("filters");
  const [selection, setSelection] = React.useState<IndustrySelection>({});
  const [allIndustries, setAllIndustries] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [minRating, setMinRating] = React.useState(0);
  const [stopCapText, setStopCapText] = React.useState<string>(String(DEFAULT_STOP_CAP));
  const [sortMode, setSortMode] = React.useState<PathSortMode>("opportunity");

  // "When" — the rep's day time-window. Local state; emitted up (if a callback
  // is passed) as ISO datetimes for today on mount and on every change.
  const [windowStart, setWindowStart] = React.useState(DEFAULT_WINDOW_START);
  const [windowEnd, setWindowEnd] = React.useState(DEFAULT_WINDOW_END);

  // Keep onWindowChange in a ref so the emit effect fires on start/end changes
  // (and mount) without re-firing when the parent recreates the callback.
  const onWindowChangeRef = React.useRef(onWindowChange);
  React.useEffect(() => { onWindowChangeRef.current = onWindowChange; });
  React.useEffect(() => {
    onWindowChangeRef.current?.({
      start: hhmmToIsoToday(windowStart),
      end: hhmmToIsoToday(windowEnd),
    });
  }, [windowStart, windowEnd]);

  const handleStartChange = React.useCallback((value: string) => {
    setWindowStart(value);
    // If end is now <= start, clamp end to start + 1h.
    setWindowEnd((prev) => (prev <= value ? addHour(value) : prev));
  }, []);
  const handleEndChange = React.useCallback((value: string) => {
    // Clamp end to start + 1h when end <= start.
    setWindowEnd(value <= windowStart ? addHour(windowStart) : value);
  }, [windowStart]);

  // Free-entry stop cap → a clamped number. Blank/garbage falls back to the
  // default; over the server cap clamps down. Kept as text so the field can be
  // cleared while typing without snapping the cursor.
  const stopCap = Math.min(MAX_STOP_CAP, Math.max(1, parseInt(stopCapText, 10) || DEFAULT_STOP_CAP));

  const chosen = React.useMemo(() => selectedCategories(selection), [selection]);

  // Apply a working selection: store it + lift the category list so PathPage
  // re-ingests at the new scope (Edge ingests whole categories; sub-types narrow
  // the pool client-side via candidatePool's `selection`).
  const applySelection = React.useCallback(
    (sel: IndustrySelection) => {
      setSelection(sel);
      onIndustriesChange(selectedCategories(sel));
    },
    [onIndustriesChange],
  );

  // Reset to step 1 on (re)open.
  React.useEffect(() => {
    if (open) {
      setStep("filters");
      setEditing(false);
      setMinRating(0);
      setSelection({});
      setAllIndustries(false);
      onAllIndustriesChange(false);
      setStopCapText(String(DEFAULT_STOP_CAP));
      setSortMode("opportunity");
      setWindowStart(DEFAULT_WINDOW_START);
      setWindowEnd(DEFAULT_WINDOW_END);
      setSelectedIds(new Set());
    }
    // onAllIndustriesChange is PathPage's stable useState setter — safe in deps.
  }, [open, onAllIndustriesChange]);

  // Toggle "All industries": fetch every bucket (Edge omits per-bucket scoping)
  // and stop filtering the displayed pool by industry. Closes the editor.
  const toggleAllIndustries = React.useCallback((on: boolean) => {
    setAllIndustries(on);
    if (on) setEditing(false);
    onAllIndustriesChange(on);
  }, [onAllIndustriesChange]);

  // Seed the working selection from saved defaults ONCE per open, as soon as the
  // preference query has data. seededRef stops a later refetch (e.g. after
  // "Save as default" invalidates the query) from clobbering an in-progress edit.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (open) seededRef.current = false;
  }, [open]);
  React.useEffect(() => {
    if (open && prefs && !seededRef.current) {
      seededRef.current = true;
      applySelection(prefs);
    }
    // applySelection is intentionally excluded: it closes over onIndustriesChange,
    // which PathPage may recreate each render; seededRef already guarantees we
    // seed exactly once per open (and not again when the prefs query refetches).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefs]);

  // Geocoded + sub-type-filtered + rating-gated, sorted candidate pool. The
  // Select-stops step lets the rep curate from this; SelectStops orders the
  // chosen set itself for Start + the live distance/ETA.
  const pool = React.useMemo(
    () => candidatePool(merchants, allIndustries
      ? { industries: [], minRating, sortMode }
      : { industries: chosen, selection, minRating, sortMode }),
    [merchants, allIndustries, chosen, selection, minRating, sortMode],
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Auto-select the optimized top-N. Re-seed only when the pool MEMBERSHIP changes
  // (filters changed) or the stop cap changes — NOT on sort (same businesses,
  // reordered) and NOT on toggle, so the rep's curation survives those.
  const membershipKey = React.useMemo(
    () => [...pool.map((m) => m.id)].sort().join(","),
    [pool],
  );
  React.useEffect(() => {
    setSelectedIds(new Set(pool.slice(0, stopCap).map((m) => m.id)));
    // membershipKey is a stable proxy for pool membership; pool is intentionally
    // omitted — the effect always runs against the render that changed
    // membershipKey, so there is no stale-pool risk. Re-seed only on membership or
    // stop-cap change (not on sort or per-item toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipKey, stopCap]);

  const toggleStop = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Step 3 (preview) needs the same ordered route + stats SelectStops shows. Derive
  // them here from the curated selection so the preview and the started queue agree.
  const selectedStops = React.useMemo(
    () => pool.filter((m) => selectedIds.has(m.id)),
    [pool, selectedIds],
  );
  const orderedStops = React.useMemo(
    () => orderStops(origin, selectedStops),
    [origin, selectedStops],
  );
  const previewStats = React.useMemo(
    () => routeStats(origin, orderedStops.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, orderedStops],
  );

  // Route-around optimizer (Slice 1): when the rep's day has calendar meetings,
  // pack the selected prospects into the free gaps AROUND those fixed events and
  // hand the resulting time-aware timeline to the preview. No meetings → null, so
  // the preview keeps its plain ordered-stop list (existing behavior). The window
  // uses the same ISO-for-today conversion the "When" picker emits.
  const daySchedule = React.useMemo<ScheduleResult | null>(() => {
    if (calendarWaypoints.length === 0 && calendarTimeBlocks.length === 0) return null;
    return scheduleDay({
      windowStart: hhmmToIsoToday(windowStart),
      windowEnd: hhmmToIsoToday(windowEnd),
      origin,
      waypoints: calendarWaypoints.map((w) => ({
        id: w.id,
        title: w.title,
        start: w.start,
        end: w.end,
        lat: w.lat,
        lng: w.lng,
      })),
      timeBlocks: calendarTimeBlocks.map((b) => ({
        id: b.id,
        title: b.title,
        start: b.start,
        end: b.end,
      })),
      prospects: selectedStops.map((m) => ({ id: m.id, name: m.name, lat: m.lat, lng: m.lng })),
    });
  }, [calendarWaypoints, calendarTimeBlocks, windowStart, windowEnd, origin, selectedStops]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-surface-default shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right md:max-w-[28rem]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border-default px-5 py-4">
            <Dialog.Title className="text-heading-sm text-text-default">
              {step === "filters" ? "Create path" : step === "select" ? "Select stops" : "Optimized route preview"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {step === "filters" && (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <p className="text-body-md text-text-muted">
                  Auto-build an optimized drop-in route from businesses near you.
                </p>
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-text-muted">Search radius</span>
                  <div className="flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5">
                    {RADIUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.meters}
                        type="button"
                        onClick={() => onRadiusChange(opt.meters)}
                        aria-pressed={radiusM === opt.meters}
                        className={cn(
                          "inline-flex items-center rounded-radius-sm px-3 py-1.5 text-caption font-medium tabular-nums transition-colors",
                          radiusM === opt.meters
                            ? "bg-surface-default text-text-default shadow-sm"
                            : "text-text-muted hover:text-text-default",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Your industries — the hero control. The rep's saved default,
                    auto-applied; Edit overrides this path (and can persist it). The
                    section header stays put across view/edit; only the body swaps. */}
                <div className="flex flex-col gap-3 rounded-radius-md border border-brand-primary bg-surface-default p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-body-strong text-text-default">Your industries</span>
                      <span className="text-caption text-text-muted">
                        Auto-applied from your default · Edit changes this path only.
                      </span>
                    </div>
                    {!editing && !allIndustries && (
                      <Button variant="secondary" size="sm" leadingIcon={Pencil} onClick={() => setEditing(true)}>
                        Edit
                      </Button>
                    )}
                  </div>
                  <Checkbox
                    label="All industries"
                    checked={allIndustries}
                    onCheckedChange={(v) => toggleAllIndustries(v === true)}
                  />
                  {allIndustries ? (
                    <p className="text-caption text-text-muted">
                      Every business type nearby is included. Turn off to pick specific industries.
                    </p>
                  ) : editing ? (
                    <IndustryEditor
                      value={selection}
                      scope="path"
                      onUseForPath={(sel) => { applySelection(sel); setEditing(false); }}
                      onSaveDefault={(sel) => {
                        applySelection(sel);
                        // Optimistic: the selection already applies to this path via
                        // applySelection; we only surface a toast if the persist fails.
                        updateDefaults.mutate(sel, {
                          onError: () => toast.error("Couldn't save as default — it still applies to this path."),
                        });
                        setEditing(false);
                      }}
                    />
                  ) : chosen.length === 0 ? (
                    <p className="text-caption text-text-muted">No industries selected — Edit to choose.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {chosen.map((c) => (
                        <span
                          key={c}
                          className="inline-flex h-7 items-center rounded-radius-full bg-surface-sunken px-3 text-caption font-medium text-text-default"
                        >
                          {CATEGORY_LABEL[c]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Secondary scope filters */}
                <div className="grid grid-cols-2 items-start gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="min-rating" className="text-caption font-medium text-text-muted">Min rating</label>
                    <Select
                      id="min-rating"
                      value={String(minRating)}
                      onValueChange={(v) => setMinRating(Number(v))}
                      options={RATING_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                    />
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-caption font-medium text-text-muted">Max stops</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_STOP_CAP}
                      value={stopCapText}
                      onChange={(e) => setStopCapText(e.target.value)}
                      onBlur={() => setStopCapText(String(stopCap))}
                      placeholder={String(DEFAULT_STOP_CAP)}
                    />
                  </label>
                  {/* Results count — how many nearby businesses to fetch/show
                      (the pool size). SEPARATE from Max stops: this widens the
                      pool the rep curates from, up to 50. */}
                  <ResultsCountField value={resultsCount} onChange={onResultsCountChange} />
                </div>

                {/* When — the rep's day time-window. Feeds the calendar read
                    (later task) so we can surface free windows in the day. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-text-muted">When</span>
                  <div className="grid grid-cols-2 gap-3">
                    <label htmlFor="window-start" className="flex flex-col gap-1.5">
                      <span className="text-caption text-text-muted">Start</span>
                      <Input
                        id="window-start"
                        type="time"
                        value={windowStart}
                        onChange={(e) => handleStartChange(e.target.value)}
                      />
                    </label>
                    <label htmlFor="window-end" className="flex flex-col gap-1.5">
                      <span className="text-caption text-text-muted">End</span>
                      <Input
                        id="window-end"
                        type="time"
                        value={windowEnd}
                        onChange={(e) => handleEndChange(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t border-border-default px-5 py-4">
                <Button variant="primary" leadingIcon={RouteIcon} className="w-full" onClick={() => setStep("select")}>
                  Select stops
                </Button>
              </div>
            </>
          )}

          {step === "select" && (
            <SelectStops
              pool={pool}
              origin={origin}
              sortMode={sortMode}
              onSortChange={setSortMode}
              selectedIds={selectedIds}
              onToggle={toggleStop}
              onBack={() => setStep("filters")}
              onReview={() => setStep("preview")}
              calendarOverlay={
                <CalendarOverlay
                  waypoints={calendarWaypoints}
                  timeBlocks={calendarTimeBlocks}
                  freeWindows={calendarFreeWindows}
                  status={calendarStatus}
                  onRefresh={onRefreshCalendar ?? (() => {})}
                />
              }
              calendarPins={calendarWaypoints}
            />
          )}

          {step === "preview" && (
            <RoutePreview
              ordered={orderedStops}
              stats={previewStats}
              onBack={() => setStep("select")}
              onStart={() => onStart(orderedStops.map((m) => m.id))}
              timeline={daySchedule ?? undefined}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default CreatePathWizard;
