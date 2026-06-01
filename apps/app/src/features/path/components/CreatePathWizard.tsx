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
import { Button, Select, type SelectOption } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import type { MerchantWithDistance } from "./MerchantList";
import { sortMerchants, type PathSortMode } from "../lib/sortMerchants";
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
  /** Called with the ordered merchant IDs when the rep starts the path. */
  onStart: (orderedIds: string[]) => void;
}

const RADIUS_CHOICES: SelectOption[] = [
  { value: "8047", label: "5 miles" },
  { value: "16093", label: "10 miles" },
  { value: "24140", label: "15 miles" },
];
const STOP_CAP_CHOICES: SelectOption[] = [
  { value: "25", label: "25 stops" },
  { value: "28", label: "28 stops" },
  { value: "30", label: "30 stops" },
];

const CATEGORY_CHOICES: SelectOption[] = [
  { value: "all", label: "All industries" },
  ...(
    ["restaurant", "retail", "healthcare", "personal_services", "automotive", "professional_services", "hospitality", "other"] as MerchantCategory[]
  ).map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
];

type Step = "filters" | "preview";

export function CreatePathWizard({
  open,
  onOpenChange,
  origin,
  merchants,
  radiusM,
  onRadiusChange,
  onStart,
}: CreatePathWizardProps) {
  const [step, setStep] = React.useState<Step>("filters");
  const [industry, setIndustry] = React.useState<string>("all");
  const [stopCap, setStopCap] = React.useState<number>(28);
  const [sortMode, setSortMode] = React.useState<PathSortMode>("opportunity");

  // Reset to step 1 whenever the wizard is (re)opened.
  React.useEffect(() => {
    if (open) setStep("filters");
  }, [open]);

  // Geocoded + industry-filtered + sorted + capped → the proposed route.
  const proposed = React.useMemo(() => {
    const geocoded = merchants.filter(
      (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng),
    );
    const byIndustry =
      industry === "all" ? geocoded : geocoded.filter((m) => m.category === industry);
    return sortMerchants(byIndustry, sortMode).slice(0, stopCap);
  }, [merchants, industry, sortMode, stopCap]);

  const stats = React.useMemo(
    () => routeStats(origin, proposed.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, proposed],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-radius-lg bg-surface-default p-5 shadow-lg md:inset-0 md:bottom-auto md:top-1/2 md:max-h-[80dvh] md:-translate-y-1/2 md:rounded-radius-lg">
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
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Industry</span>
                <Select
                  options={CATEGORY_CHOICES}
                  value={industry}
                  onValueChange={setIndustry}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Max stops</span>
                <Select
                  options={STOP_CAP_CHOICES}
                  value={String(stopCap)}
                  onValueChange={(v) => setStopCap(Number(v))}
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
