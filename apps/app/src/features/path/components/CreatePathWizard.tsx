/**
 * CreatePathWizard — the guided "Create path" flow (Path v2, Slice 2).
 *
 * Two steps inside one Radix Dialog (same shell pattern as PathPlanSheet):
 *   1. Filters — radius (5/10/15mi), industry (category bucket), stop cap.
 *   2. Preview — route summary (stops / nearest / furthest / ~ETA) + the
 *      nearest-neighbor-ordered top-N stops, with Distance/Opportunity sort.
 * "Start path" hands the ordered merchant IDs to the caller, which writes them
 * into the queue. Places-only: no employee/value/email anywhere.
 *
 * The wizard does NOT fetch — PathPage owns useMerchants and passes the loaded,
 * distance-annotated, radius-gated merchants in. Changing the radius here calls
 * onRadiusChange so PathPage re-ingests at the new radius (Slice 1 wiring).
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Route as RouteIcon, MapPin, Navigation, Pencil } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Input, Select } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import { IndustryEditor } from "./IndustryEditor";
import { usePathPreferences, useUpdateDefaultIndustries } from "../hooks/usePathPreferences";
import { selectedCategories, type IndustrySelection } from "../lib/industrySelection";
import type { MerchantWithDistance } from "./MerchantList";
import { type PathSortMode } from "../lib/sortMerchants";
import { proposeRoute } from "../lib/proposeRoute";
import { routeStats, formatEta } from "../lib/routeStats";

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
  /** Push the rep's industry scope up so PathPage re-ingests (like radius). */
  onIndustriesChange: (industries: MerchantCategory[]) => void;
  /** Called with the ordered merchant IDs when the rep starts the path. */
  onStart: (orderedIds: string[]) => void;
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

type Step = "filters" | "preview";

export function CreatePathWizard({
  open,
  onOpenChange,
  origin,
  merchants,
  radiusM,
  onRadiusChange,
  onIndustriesChange,
  onStart,
}: CreatePathWizardProps) {
  const { data: prefs } = usePathPreferences();
  const updateDefaults = useUpdateDefaultIndustries();

  const [step, setStep] = React.useState<Step>("filters");
  const [selection, setSelection] = React.useState<IndustrySelection>({});
  const [editing, setEditing] = React.useState(false);
  const [minRating, setMinRating] = React.useState(0);
  const [stopCapText, setStopCapText] = React.useState<string>(String(DEFAULT_STOP_CAP));
  const [sortMode, setSortMode] = React.useState<PathSortMode>("opportunity");

  // Free-entry stop cap → a clamped number. Blank/garbage falls back to the
  // default; over the server cap clamps down. Kept as text so the field can be
  // cleared while typing without snapping the cursor.
  const stopCap = Math.min(MAX_STOP_CAP, Math.max(1, parseInt(stopCapText, 10) || DEFAULT_STOP_CAP));

  const chosen = React.useMemo(() => selectedCategories(selection), [selection]);

  // Apply a working selection: store it + lift the category list so PathPage
  // re-ingests at the new scope (Edge ingests whole categories; sub-types narrow
  // the route client-side via proposeRoute's `selection`).
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
      setStopCapText(String(DEFAULT_STOP_CAP));
      setSortMode("opportunity");
    }
  }, [open]);

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

  // Geocoded + sub-type-filtered + rating-gated + top-N selected + nearest-
  // neighbor ordered → the proposed route. Shared with PathPage's queue via
  // proposeRoute so the rep-approved order/ETA matches what gets enqueued.
  const proposed = React.useMemo(
    () => proposeRoute(merchants, { origin, industries: chosen, selection, sortMode, stopCap, minRating }),
    [merchants, origin, chosen, selection, sortMode, stopCap, minRating],
  );

  const stats = React.useMemo(
    () => routeStats(origin, proposed.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, proposed],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-radius-lg bg-surface-default p-5 shadow-lg md:inset-0 md:bottom-auto md:top-1/2 md:max-h-[80dvh] md:-translate-y-1/2 md:rounded-radius-lg"
        >
          <div className="flex items-center justify-between pb-3">
            <Dialog.Title className="text-heading-sm text-text-default">
              {step === "filters" ? "Create path" : "Route preview"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {step === "filters" && (
            <div className="flex flex-col gap-4 overflow-y-auto">
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
                  {!editing && (
                    <Button variant="secondary" size="sm" leadingIcon={Pencil} onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )}
                </div>
                {editing ? (
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
              </div>
              <Button variant="primary" leadingIcon={RouteIcon} onClick={() => setStep("preview")}>
                Preview route
              </Button>
            </div>
          )}

          {step === "preview" && (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="grid grid-cols-4 gap-2 rounded-radius-md bg-surface-sunken p-3 text-center">
                <Stat label="Stops" value={String(stats.stopCount)} />
                <Stat label="Nearest" value={stats.nearestMeters == null ? "—" : formatDistance(stats.nearestMeters)} />
                <Stat label="Furthest" value={stats.furthestMeters == null ? "—" : formatDistance(stats.furthestMeters)} />
                <Stat label="Est. time" value={formatEta(stats.etaMinutes)} />
              </div>

              <div className="flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5">
                {([
                  { label: "Opportunity", mode: "opportunity" },
                  { label: "Distance", mode: "distance" },
                ] as Array<{ label: string; mode: PathSortMode }>).map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => setSortMode(opt.mode)}
                    aria-pressed={sortMode === opt.mode}
                    className={cn(
                      "rounded-radius-sm px-3 py-1.5 text-caption font-medium transition-colors",
                      sortMode === opt.mode
                        ? "bg-surface-default text-text-default shadow-sm"
                        : "text-text-muted hover:text-text-default",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <ol className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                {proposed.length === 0 && (
                  <li className="rounded-radius-md border border-dashed border-border-default p-4 text-center text-caption text-text-muted">
                    No businesses match these filters within {formatDistance(radiusM)}. Widen the radius or industry.
                  </li>
                )}
                {proposed.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-radius-md border border-border-default p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold tabular-nums text-text-muted">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-md font-medium text-text-default">{m.name}</p>
                      <p className="truncate text-caption text-text-muted">
                        <MapPin className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                        {Number.isFinite(m.distanceMeters) ? `${formatDistance(m.distanceMeters)} away` : m.address}
                        {" · "}
                        {CATEGORY_LABEL[m.category]}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex gap-2 pt-1">
                <Button variant="secondary" onClick={() => setStep("filters")}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  leadingIcon={Navigation}
                  disabled={proposed.length === 0}
                  onClick={() => onStart(proposed.map((m) => m.id))}
                  className="flex-1"
                >
                  Start path ({proposed.length})
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

export default CreatePathWizard;
