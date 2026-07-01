/**
 * PlanPathWizard — the full-page "Plan a Path" wizard (SP2).
 *
 * A linear, data-driven stepper assembling existing path building blocks:
 *   mode → search → results → review → saved
 *
 * The shell owns all wizard state (no global store): the current stepKey, the
 * chosen mode, the resolved origin (via usePathOrigin), the discovery filters
 * (IndustrySelection / radiusM / minEmployees / allIndustries), the in-progress
 * ordered stop set, and the created pathId after save. Step components are
 * presentational — they receive state + callbacks and are independently testable.
 *
 * The progress bar + "Step N of M" derive from PLAN_STEPS, so SP3 inserting a
 * `schedule` step before `saved` needs no shell rework.
 *
 * Save happens IMMEDIATELY on the review Continue (SP2): createPath(path_date =
 * today) + addStops in the reviewed order (route optimized on save via
 * orderStops). Scheduling / future-dated paths are SP3.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";

import { haversineMeters } from "@/lib/distance";
import { type Merchant, type MerchantCategory } from "../mockData";
import { usePathOrigin } from "../hooks/usePathOrigin";
import { useMerchants } from "../hooks/useMerchants";
import { usePathMutations, type StopSnapshot } from "../hooks/usePathMutations";
import { todayISO } from "../lib/today";
import { orderStops } from "../lib/proposeRoute";
import { selectedCategories, RECOMMENDED_SELECTION, type IndustrySelection } from "../lib/industrySelection";
import type { MerchantWithDistance } from "../components/MerchantList";
import { DropInSheet } from "../components/DropInSheet";

import {
  PLAN_STEPS,
  stepFor,
  stepIndex,
  stepLabel,
  type StepKey,
} from "../components/plan/steps";
import { ChoosePathMode, type PathMode } from "../components/plan/ChoosePathMode";
import { PlanSearchStep } from "../components/plan/PlanSearchStep";
import { PlanResultsStep } from "../components/plan/PlanResultsStep";
import { PlanReviewStep } from "../components/plan/PlanReviewStep";
import { PlanSavedStep } from "../components/plan/PlanSavedStep";

const DEFAULT_RADIUS_M = 8047; // 5 mi

export function PlanPathWizard() {
  const navigate = useNavigate();

  // --- Wizard step + mode ---------------------------------------------------
  const [stepKey, setStepKey] = React.useState<StepKey>("mode");
  const [mode, setMode] = React.useState<PathMode | null>(null);

  // --- Origin (search-by-city) ----------------------------------------------
  const { origin, originLabel, searching, searchError, searchLocation } = usePathOrigin();

  // --- Filters --------------------------------------------------------------
  const [radiusM, setRadiusM] = React.useState<number>(DEFAULT_RADIUS_M);
  const [minEmployees, setMinEmployees] = React.useState<number>(0);
  const [selection, setSelection] = React.useState<IndustrySelection>(RECOMMENDED_SELECTION);
  const [allIndustries, setAllIndustries] = React.useState(false);

  const industries = React.useMemo(
    () => selectedCategories(selection) as unknown as MerchantCategory[],
    [selection],
  );

  // --- In-progress ordered stop set -----------------------------------------
  // Ordered ids + a snapshot map so review can render/reorder even when a stop
  // has scrolled out of the current results window.
  const [stopIds, setStopIds] = React.useState<string[]>([]);
  const [stopById, setStopById] = React.useState<Map<string, Merchant>>(new Map());
  const addedIdSet = React.useMemo(() => new Set(stopIds), [stopIds]);
  const orderedStops = React.useMemo(
    () => stopIds.map((id) => stopById.get(id)).filter((m): m is Merchant => Boolean(m)),
    [stopIds, stopById],
  );

  // --- Saved path -----------------------------------------------------------
  const [createdPathId, setCreatedPathId] = React.useState<string | null>(null);
  const { createPath, addStops } = usePathMutations();
  const [saving, setSaving] = React.useState(false);

  // --- Drop-in sheet --------------------------------------------------------
  const [dropInMerchant, setDropInMerchant] = React.useState<Merchant | null>(null);
  const [dropInOpen, setDropInOpen] = React.useState(false);

  // --- Merchants (results step) ---------------------------------------------
  const {
    merchants: liveMerchants,
    isLoading: merchantsLoading,
    isError: merchantsError,
    refetch: refetchMerchants,
  } = useMerchants(origin, { radiusM, industries, allIndustries, includeChains: true });

  // Distance-annotate + sort nearest-first for the results list.
  const resultMerchants: MerchantWithDistance[] = React.useMemo(() => {
    if (!origin) return [];
    return liveMerchants
      .map((m) => ({
        ...m,
        distanceMeters:
          Number.isFinite(m.lat) && Number.isFinite(m.lng)
            ? haversineMeters(origin, { lat: m.lat, lng: m.lng })
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [liveMerchants, origin]);

  // --- Stop set mutations ---------------------------------------------------
  const toggleStop = React.useCallback((m: Merchant) => {
    setStopIds((prev) => (prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]));
    setStopById((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.set(m.id, m);
      return next;
    });
  }, []);

  const removeStop = React.useCallback((id: string) => {
    setStopIds((prev) => prev.filter((x) => x !== id));
    setStopById((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const moveStop = React.useCallback((index: number, direction: "up" | "down") => {
    setStopIds((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }, []);

  const openDropIn = React.useCallback((m: Merchant) => {
    setDropInMerchant(m);
    setDropInOpen(true);
  }, []);

  // --- Navigation -----------------------------------------------------------
  const goTo = React.useCallback((key: StepKey) => setStepKey(key), []);

  const resetWizard = React.useCallback(() => {
    setStepKey("mode");
    setMode(null);
    setRadiusM(DEFAULT_RADIUS_M);
    setMinEmployees(0);
    setSelection(RECOMMENDED_SELECTION);
    setAllIndustries(false);
    setStopIds([]);
    setStopById(new Map());
    setCreatedPathId(null);
  }, []);

  const exitToPath = React.useCallback(() => navigate("/path"), [navigate]);

  // Save the reviewed path: create today's path, then add stops in reviewed order
  // (route-optimized via orderStops). Advances to `saved` on success.
  const savePath = React.useCallback(async () => {
    if (saving || orderedStops.length === 0) return;
    // Already saved this run — jump straight to the confirmation instead of
    // creating a duplicate path.
    if (createdPathId) {
      goTo("saved");
      return;
    }
    setSaving(true);
    try {
      const pathId = await createPath.mutateAsync({
        date: todayISO(),
        originLabel: originLabel ?? null,
        originLat: origin?.lat ?? null,
        originLng: origin?.lng ?? null,
      });
      // Optimize the reviewed set from the origin (falls back to reviewed order
      // when there's no origin — shouldn't happen past the search gate).
      const optimized = origin ? orderStops(origin, orderedStops) : orderedStops;
      const stops: StopSnapshot[] = optimized.map((m) => ({
        prospectId: m.id,
        name: m.name,
        address: m.address ?? null,
        phone: m.phone ?? null,
        lat: m.lat,
        lng: m.lng,
        category: m.category,
        primaryType: m.primaryType ?? null,
      }));
      await addStops.mutateAsync({ pathId, basePosition: 0, stops });
      setCreatedPathId(pathId);
      goTo("saved");
    } catch {
      toast.error("Couldn't save the path. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [saving, createdPathId, orderedStops, createPath, addStops, origin, originLabel, goTo]);

  // --- Footer wiring per step -----------------------------------------------
  const idx = stepIndex(stepKey);
  const step = stepFor(stepKey);

  const canContinue = ((): boolean => {
    switch (stepKey) {
      case "mode":
        return mode !== null;
      case "search":
        return origin != null;
      case "results":
        return stopIds.length >= 1;
      case "review":
        return orderedStops.length >= 1 && !saving;
      default:
        return false;
    }
  })();

  const handleBack = React.useCallback(() => {
    switch (stepKey) {
      case "search":
        goTo("mode");
        break;
      case "results":
        goTo("search");
        break;
      case "review":
        goTo("results");
        break;
      default:
        break;
    }
  }, [stepKey, goTo]);

  const handleContinue = React.useCallback(() => {
    switch (stepKey) {
      case "mode":
        if (mode === "create") exitToPath();
        else if (mode === "plan") goTo("search");
        break;
      case "search":
        if (origin) goTo("results");
        break;
      case "results":
        if (stopIds.length >= 1) goTo("review");
        break;
      case "review":
        void savePath();
        break;
      default:
        break;
    }
  }, [stepKey, mode, origin, stopIds.length, exitToPath, goTo, savePath]);

  const continueLabel =
    stepKey === "mode"
      ? mode === "create"
        ? "Go to Create"
        : "Continue"
      : stepKey === "results"
        ? "Review path"
        : stepKey === "review"
          ? saving
            ? "Saving…"
            : "Save path"
          : "Continue";

  const showFooter = stepKey !== "saved";
  const showBack = stepKey !== "mode" && stepKey !== "saved";

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-4xl flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-border-default pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Plan a path</h1>
          <p className="text-body-md text-text-muted">
            {stepLabel(stepKey)} · {step.title}
          </p>
        </div>
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          leadingIcon={X}
          aria-label="Close"
          onClick={exitToPath}
        />
      </header>

      {/* Progress bar — derived from PLAN_STEPS. */}
      <div className="mt-3 flex gap-1" aria-hidden>
        {PLAN_STEPS.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              "h-1 flex-1 rounded-radius-full transition-colors",
              i <= idx ? "bg-brand-primary" : "bg-surface-sunken",
            )}
          />
        ))}
      </div>

      {/* Body */}
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {stepKey === "mode" && <ChoosePathMode mode={mode} onSelect={setMode} />}

        {stepKey === "search" && (
          <PlanSearchStep
            originResolved={origin != null}
            originLabel={originLabel}
            onSearch={searchLocation}
            searching={searching}
            searchError={searchError}
            radiusM={radiusM}
            onRadiusChange={setRadiusM}
            minEmployees={minEmployees}
            onMinEmployeesChange={setMinEmployees}
            selection={selection}
            onSelectionChange={setSelection}
            allIndustries={allIndustries}
            onAllIndustriesChange={setAllIndustries}
          />
        )}

        {stepKey === "results" && (
          <PlanResultsStep
            merchants={resultMerchants}
            isLoading={merchantsLoading}
            isError={merchantsError}
            onRetry={refetchMerchants}
            addedIds={addedIdSet}
            onToggleStop={toggleStop}
            onLogDropIn={openDropIn}
          />
        )}

        {stepKey === "review" && (
          <PlanReviewStep
            stops={orderedStops}
            onRemove={removeStop}
            onMove={moveStop}
            onAddMore={() => goTo("results")}
          />
        )}

        {stepKey === "saved" && (
          <PlanSavedStep
            pathName={originLabel ?? "Your path"}
            stopCount={orderedStops.length}
            onViewUpcoming={exitToPath}
            onBuildAnother={resetWizard}
            onDone={exitToPath}
          />
        )}
      </div>

      {/* Footer */}
      {showFooter && (
        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-border-default pt-4">
          {showBack ? (
            <Button variant="secondary" leadingIcon={ArrowLeft} onClick={handleBack} disabled={saving}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {stepKey === "results" && (
              <span className="text-caption text-text-muted">
                {stopIds.length} {stopIds.length === 1 ? "stop" : "stops"} added
              </span>
            )}
            <Button
              variant="primary"
              trailingIcon={stepKey === "review" ? undefined : ArrowRight}
              leadingIcon={stepKey === "review" && saving ? Loader2 : undefined}
              loading={stepKey === "review" && saving}
              disabled={!canContinue}
              onClick={handleContinue}
            >
              {continueLabel}
            </Button>
          </div>
        </footer>
      )}

      <DropInSheet merchant={dropInMerchant} open={dropInOpen} onOpenChange={setDropInOpen} />
    </div>
  );
}

export default PlanPathWizard;
