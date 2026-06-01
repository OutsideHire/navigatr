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
import { X, Route as RouteIcon, MapPin, Navigation } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Chip, Input, Select, type SelectOption } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import { TIER_1_KEYS, TIER_2_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
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

const RADIUS_CHOICES: SelectOption[] = [
  { value: "8047", label: "5 miles" },
  { value: "16093", label: "10 miles" },
  { value: "24140", label: "15 miles" },
];

/** The 12 fetchable industries (Tier 1 + 2), for the multi-select chip row.
 *  Empty selection = the hook's Tier-1 default; "All" = exactly these 12. */
const CATEGORIES: MerchantCategory[] = [
  "manufacturing", "construction_trades", "healthcare", "professional_services", "automotive",
  "retail", "food_beverage", "hospitality", "education", "finance_banking", "fitness_wellness", "non_profit",
];

/** Default + bounds for the free-entry "Max stops" field. The server read path
 *  caps a pull at 100, so there's no point letting a rep ask for more. */
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
  const [step, setStep] = React.useState<Step>("filters");
  const [industries, setIndustries] = React.useState<MerchantCategory[]>([]);
  const [stopCapText, setStopCapText] = React.useState<string>(String(DEFAULT_STOP_CAP));
  const [sortMode, setSortMode] = React.useState<PathSortMode>("opportunity");

  // Free-entry stop cap → a clamped number. Blank/garbage falls back to the
  // default; over the server cap clamps down. Kept as text so the field can be
  // cleared while typing without snapping the cursor.
  const stopCap = Math.min(MAX_STOP_CAP, Math.max(1, parseInt(stopCapText, 10) || DEFAULT_STOP_CAP));

  // Every industry mutation lifts state to the parent (PathPage) so it
  // re-ingests at the new scope, the same way onRadiusChange drives radius.
  const applyIndustries = (next: MerchantCategory[]) => {
    setIndustries(next);
    onIndustriesChange(next);
  };
  const toggleIndustry = (c: MerchantCategory) =>
    applyIndustries(industries.includes(c) ? industries.filter((x) => x !== c) : [...industries, c]);
  const selectAll = () => applyIndustries([...TIER_1_KEYS, ...TIER_2_KEYS] as MerchantCategory[]);
  const clearIndustries = () => applyIndustries([]);

  // Reset to step 1 + Default (Tier 1) industries whenever the wizard (re)opens.
  React.useEffect(() => {
    if (open) {
      setStep("filters");
      setIndustries([]);
      onIndustriesChange([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Geocoded + industry-filtered (empty = all) + top-N selected + nearest-
  // neighbor ordered → the proposed route. Shared with PathPage's queue via
  // proposeRoute so the rep-approved order/ETA matches what gets enqueued.
  const proposed = React.useMemo(
    () => proposeRoute(merchants, { origin, industries, sortMode, stopCap }),
    [merchants, origin, industries, sortMode, stopCap],
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
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Search radius</span>
                <Select
                  options={RADIUS_CHOICES}
                  value={String(radiusM)}
                  onValueChange={(v) => onRadiusChange(Number(v))}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">
                  Industries{" "}
                  <span className="font-normal">
                    ({industries.length === 0 ? "Default (Tier 1)" : `${industries.length} selected`})
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={industries.length === 0} onClick={clearIndustries}>
                    Default (Tier 1)
                  </Chip>
                  <Chip active={industries.length === CATEGORIES.length} onClick={selectAll}>
                    All industries
                  </Chip>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <Chip
                      key={c}
                      active={industries.includes(c)}
                      onClick={() => toggleIndustry(c)}
                    >
                      {CATEGORY_LABEL[c]}
                    </Chip>
                  ))}
                </div>
                <span className="text-caption text-text-muted">
                  Leave on Default for the Tier-1 core, or pick industries / All.
                </span>
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
                  placeholder={String(DEFAULT_STOP_CAP)}
                />
              </label>
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
