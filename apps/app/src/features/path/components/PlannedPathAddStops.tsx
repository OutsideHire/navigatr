/**
 * PlannedPathAddStops: the "Add stops" view inside PlannedPathSheet.
 *
 * Searches the path's area again (its saved center, or the first stop when the
 * path has none) with the same defaults Plan a Path opens with: 5 mi,
 * recommended business types, no chains, 25 results, auto-widen to fill. The
 * path does not store the filters it was planned with, so these defaults are
 * the closest match. Businesses already on the path are left out.
 *
 * The rep ticks businesses and taps "Add N stops". They are appended after the
 * current stops, nearest to the area first, and the parent re-syncs the
 * calendar block. Reordering happens back in the stop list.
 */
import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/navigatr";
import { haversineMeters } from "@/lib/distance";
import type { Merchant, MerchantCategory } from "../mockData";
import type { PathStop } from "../lib/pathTypes";
import { useMerchants } from "../hooks/useMerchants";
import { discoveryShortfallHint } from "../lib/discoveryHint";
import { selectedCategories, RECOMMENDED_SELECTION } from "../lib/industrySelection";
import { usePathMutations, type StopSnapshot } from "../hooks/usePathMutations";
import type { MerchantWithDistance } from "./MerchantList";
import { PlanResultsStep } from "./plan/PlanResultsStep";

const DEFAULT_RADIUS_M = 8047; // 5 mi, same as Plan a Path
const RECOMMENDED_INDUSTRIES = selectedCategories(RECOMMENDED_SELECTION) as unknown as MerchantCategory[];

export interface PlannedPathAddStopsProps {
  pathId: string;
  /** Where to search. Null keeps discovery off. */
  center: { lat: number; lng: number } | null;
  /** The path's current stops: left out of the list, and the new ones go after them. */
  stops: PathStop[];
  /** Saved: the parent re-syncs the calendar and shows the stop list again. */
  onAdded: () => void;
  onBack: () => void;
}

export function PlannedPathAddStops({ pathId, center, stops, onAdded, onBack }: PlannedPathAddStopsProps) {
  const [showFiltered, setShowFiltered] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const { addStops } = usePathMutations();

  const {
    merchants: live,
    hidden,
    isLoading,
    isError,
    refetch,
    effectiveRadiusM,
    requestedRadiusM,
    requestedLimit,
  } = useMerchants(center, {
    radiusM: DEFAULT_RADIUS_M,
    industries: RECOMMENDED_INDUSTRIES,
    includeChains: false,
    includeHomeBased: showFiltered,
    fillToLimit: true,
  });

  const onPath = React.useMemo(() => new Set(stops.map((s) => s.prospectId)), [stops]);

  // Nearest to the area first, minus what is already on the path.
  const results: MerchantWithDistance[] = React.useMemo(() => {
    if (!center) return [];
    return live
      .filter((m) => !onPath.has(m.id))
      .map((m) => ({
        ...m,
        distanceMeters:
          Number.isFinite(m.lat) && Number.isFinite(m.lng)
            ? haversineMeters(center, { lat: m.lat, lng: m.lng })
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [live, onPath, center]);

  const hint = discoveryShortfallHint({
    shown: results.length,
    requested: requestedLimit,
    requestedRadiusM,
    effectiveRadiusM,
    hidden,
  });

  const toggle = React.useCallback((m: Merchant) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  }, []);

  // Only picks still in the list count: a filter change or refetch can drop one.
  const pickedResults = React.useMemo(() => results.filter((m) => picked.has(m.id)), [results, picked]);
  const count = pickedResults.length;

  const handleAdd = React.useCallback(async () => {
    if (count === 0 || saving) return;
    const snapshots: StopSnapshot[] = pickedResults.map((m) => ({
        prospectId: m.id,
        placeId: m.placeId ?? null,
        name: m.name,
        address: m.address ?? null,
        phone: m.phone ?? null,
        lat: m.lat,
        lng: m.lng,
        category: m.category,
        primaryType: m.primaryType ?? null,
      }));
    setSaving(true);
    try {
      // After the highest position, not the count: removing a stop leaves a gap.
      const basePosition = stops.reduce((max, s) => Math.max(max, s.position + 1), 0);
      await addStops.mutateAsync({ pathId, basePosition, stops: snapshots });
    } catch {
      toast.error("Couldn't add the stops. Try again.");
      setSaving(false);
      return;
    }
    toast.success(`Added ${snapshots.length} ${snapshots.length === 1 ? "stop" : "stops"}`);
    onAdded();
  }, [count, saving, pickedResults, addStops, pathId, stops, onAdded]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          <h3 className="text-label text-text-default">Add stops</h3>
          <PlanResultsStep
            merchants={results}
            isLoading={isLoading}
            isError={isError}
            onRetry={refetch}
            addedIds={picked}
            onToggleStop={toggle}
            addLabel="Add to path"
            onAddAll={() => setPicked(new Set(results.map((m) => m.id)))}
            onRemoveAll={() => setPicked(new Set())}
            discoveryHint={hint}
            hiddenHomeBased={hidden.homeBased}
            hiddenChains={hidden.chains}
            showingFiltered={showFiltered}
            onToggleFiltered={() => setShowFiltered((v) => !v)}
          />
        </div>
      </div>

      <footer className="flex shrink-0 gap-3 border-t border-border-default px-5 py-4">
        <Button variant="secondary" size="lg" leadingIcon={ArrowLeft} onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={count === 0 || saving}
          loading={saving}
          onClick={() => void handleAdd()}
        >
          {count === 0 ? "Add" : `Add ${count} ${count === 1 ? "stop" : "stops"}`}
        </Button>
      </footer>
    </>
  );
}

export default PlannedPathAddStops;
