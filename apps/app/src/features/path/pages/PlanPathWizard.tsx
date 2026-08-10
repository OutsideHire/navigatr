/**
 * PlanPathWizard — the "Plan a Path" slide-out wizard.
 *
 * A linear, data-driven stepper assembling existing path building blocks:
 *   search → results → review → schedule → saved
 * (Mode choice — Create vs Plan — happens on the PathPage entry card.)
 *
 * The shell owns all wizard state (no global store): the current stepKey, the
 * resolved origin (via usePathOrigin), the discovery filters
 * (IndustrySelection / radiusM / minEmployees / allIndustries), the in-progress
 * ordered stop set, and the created pathId after save. Step components are
 * presentational — they receive state + callbacks and are independently testable.
 *
 * The progress bar + "Step N of M" derive from PLAN_STEPS, so SP3 inserting a
 * `schedule` step before `saved` needs no shell rework.
 *
 * Save happens on the Schedule step's Continue (SP3): createPath with the
 * chosen (today-or-future) date + name + reminder_at, then addStops in the
 * reviewed order (route optimized via orderStops). Review Continue advances to
 * Schedule; the save runs once.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";

import { haversineMeters } from "@/lib/distance";
import { type Merchant, type MerchantCategory } from "../mockData";
import { usePathOrigin } from "../hooks/usePathOrigin";
import { useMerchants } from "../hooks/useMerchants";
import { discoveryShortfallHint } from "../lib/discoveryHint";
import { usePathMutations, type StopSnapshot } from "../hooks/usePathMutations";
import { usePathCalendarSync } from "../hooks/usePathCalendarSync";
import { todayISO, addDaysISO } from "../lib/today";
import {
  composeReminderAt,
  defaultPathName,
  formatReminder,
  isTodayOrFuture,
} from "../lib/scheduleDate";
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
import { PlanSearchStep } from "../components/plan/PlanSearchStep";
import { PlanResultsStep } from "../components/plan/PlanResultsStep";
import { PlanReviewStep } from "../components/plan/PlanReviewStep";
import { PlanScheduleStep, type DateQuickPick } from "../components/plan/PlanScheduleStep";
import { PlanSavedStep } from "../components/plan/PlanSavedStep";

const DEFAULT_RADIUS_M = 8047; // 5 mi
const DEFAULT_REMINDER_TIME = "08:30"; // local wall-clock

export interface PlanPathWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the rep finishes a saved path (Done / View upcoming) — lets the
   *  parent land on the entry/Upcoming screen rather than an active route view. */
  onSaved?: () => void;
}

export function PlanPathWizard({ open, onOpenChange, onSaved }: PlanPathWizardProps) {
  // --- Wizard step ----------------------------------------------------------
  // Mode choice (Create vs Plan) lives on the PathPage entry card, so the
  // wizard opens straight to the search step.
  const [stepKey, setStepKey] = React.useState<StepKey>("search");

  // --- Origin (search-by-city) ----------------------------------------------
  const { origin, originLabel, searching, searchError, searchLocation } = usePathOrigin();

  // --- Filters --------------------------------------------------------------
  const [radiusM, setRadiusM] = React.useState<number>(DEFAULT_RADIUS_M);
  const [minEmployees, setMinEmployees] = React.useState<number>(0);
  const [selection, setSelection] = React.useState<IndustrySelection>(RECOMMENDED_SELECTION);
  const [allIndustries, setAllIndustries] = React.useState(false);
  // Results count — how many nearby businesses to fetch/show. Default 25,
  // clamped to [1, 50] in useMerchants.
  const [resultsCount, setResultsCount] = React.useState(25);

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
  // Milestone 3: Plan-a-Path save is the ONLY moment that CREATES a calendar
  // block (the path is planned + not started). Fire-and-forget after save.
  const { syncPath } = usePathCalendarSync();
  const [saving, setSaving] = React.useState(false);

  // --- Schedule (SP3) -------------------------------------------------------
  // Default = tomorrow ("prep tomorrow's route"). The name auto-derives from
  // origin + date until the rep edits it (nameTouched latches the override).
  const [scheduleDate, setScheduleDate] = React.useState<string>(() => addDaysISO(todayISO(), 1));
  const [datePick, setDatePick] = React.useState<DateQuickPick>("tomorrow");
  const [reminderTime, setReminderTime] = React.useState<string>(DEFAULT_REMINDER_TIME);
  const [pathName, setPathName] = React.useState<string>("");
  const [nameTouched, setNameTouched] = React.useState(false);

  // Keep the auto-name in sync with origin + date until the rep overrides it.
  const derivedName = React.useMemo(
    () => defaultPathName(originLabel, scheduleDate),
    [originLabel, scheduleDate],
  );
  const effectiveName = nameTouched ? pathName : derivedName;

  const handleDateChange = React.useCallback((iso: string, pick: DateQuickPick) => {
    setScheduleDate(iso);
    setDatePick(pick);
  }, []);

  const handleNameChange = React.useCallback((next: string) => {
    setNameTouched(true);
    setPathName(next);
  }, []);

  const dateValid = React.useMemo(() => isTodayOrFuture(scheduleDate), [scheduleDate]);
  const reminderAt = React.useMemo(
    () => composeReminderAt(scheduleDate, reminderTime),
    [scheduleDate, reminderTime],
  );

  // --- Drop-in sheet --------------------------------------------------------
  const [dropInMerchant, setDropInMerchant] = React.useState<Merchant | null>(null);
  const [dropInOpen, setDropInOpen] = React.useState(false);

  // --- Merchants (results step) ---------------------------------------------
  const {
    merchants: liveMerchants,
    isLoading: merchantsLoading,
    isError: merchantsError,
    refetch: refetchMerchants,
    hidden: merchantsHidden,
    effectiveRadiusM: merchantsEffectiveRadiusM,
    requestedRadiusM: merchantsRequestedRadiusM,
    requestedLimit: merchantsRequestedLimit,
    // includeChains: false so Plan never surfaces chains (McDonald's, Taco Bell,
    // etc.), matching Create. Excluding server-side lets auto-widen fill the
    // requested count with non-chain businesses.
    // Only auto-widen on the results step, so the extra edge calls fire when the
    // rep is actually looking at results, not while they tune filters.
  } = useMerchants(origin, { radiusM, industries, allIndustries, includeChains: false, limit: resultsCount, fillToLimit: stepKey === "results" });

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

  // Shortfall/widen explanation for the results step.
  const discoveryHint = React.useMemo(
    () =>
      discoveryShortfallHint({
        shown: resultMerchants.length,
        requested: merchantsRequestedLimit,
        requestedRadiusM: merchantsRequestedRadiusM,
        effectiveRadiusM: merchantsEffectiveRadiusM,
        hidden: merchantsHidden,
      }),
    [
      resultMerchants.length,
      merchantsRequestedLimit,
      merchantsRequestedRadiusM,
      merchantsEffectiveRadiusM,
      merchantsHidden,
    ],
  );

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

  // Bulk add/remove over the current results (see PlanResultsStep's "Add all").
  const addAll = React.useCallback((ms: Merchant[]) => {
    setStopIds((prev) => {
      const have = new Set(prev);
      return [...prev, ...ms.map((m) => m.id).filter((id) => !have.has(id))];
    });
    setStopById((prev) => {
      const next = new Map(prev);
      ms.forEach((m) => next.set(m.id, m));
      return next;
    });
  }, []);

  const removeAll = React.useCallback((ms: Merchant[]) => {
    const ids = new Set(ms.map((m) => m.id));
    setStopIds((prev) => prev.filter((id) => !ids.has(id)));
    setStopById((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
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
    setStepKey("search");
    setRadiusM(DEFAULT_RADIUS_M);
    setMinEmployees(0);
    setSelection(RECOMMENDED_SELECTION);
    setAllIndustries(false);
    setResultsCount(25);
    setStopIds([]);
    setStopById(new Map());
    setCreatedPathId(null);
    setScheduleDate(addDaysISO(todayISO(), 1));
    setDatePick("tomorrow");
    setReminderTime(DEFAULT_REMINDER_TIME);
    setPathName("");
    setNameTouched(false);
  }, []);

  // Finishing a saved path (Done / View upcoming): notify the parent (so it can
  // land on the entry/Upcoming screen) and close the slide-out.
  const finishSaved = React.useCallback(() => {
    onSaved?.();
    onOpenChange(false);
  }, [onSaved, onOpenChange]);

  // Reset to a clean wizard each time the slide-out (re)opens.
  React.useEffect(() => {
    if (open) resetWizard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Save the scheduled path (SP3): create a path on the CHOSEN date with the name
  // + reminder, then add stops in reviewed order (route-optimized via orderStops).
  // Runs on the Schedule step's Continue. Advances to `saved` on success.
  const savePath = React.useCallback(async () => {
    if (saving || orderedStops.length === 0) return;
    if (!dateValid) return; // guard: today-or-future date required
    // Already saved this run — jump straight to the confirmation instead of
    // creating a duplicate path.
    if (createdPathId) {
      goTo("saved");
      return;
    }
    setSaving(true);
    try {
      const pathId = await createPath.mutateAsync({
        date: scheduleDate,
        originLabel: originLabel ?? null,
        originLat: origin?.lat ?? null,
        originLng: origin?.lng ?? null,
        name: effectiveName,
        reminderAt,
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
      // Plan-a-Path save succeeded → create the planned path's calendar block.
      // Fire-and-forget: never block/fail the save. This is the ONLY create site.
      void syncPath(pathId);
      goTo("saved");
    } catch {
      toast.error("Couldn't save the path. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [saving, createdPathId, orderedStops, createPath, addStops, syncPath, origin, originLabel, goTo, dateValid, scheduleDate, effectiveName, reminderAt]);

  // --- Footer wiring per step -----------------------------------------------
  const idx = stepIndex(stepKey);
  const step = stepFor(stepKey);

  const canContinue = ((): boolean => {
    switch (stepKey) {
      case "search":
        return origin != null;
      case "results":
        return stopIds.length >= 1;
      case "review":
        return orderedStops.length >= 1;
      case "schedule":
        return orderedStops.length >= 1 && dateValid && !saving;
      default:
        return false;
    }
  })();

  const handleBack = React.useCallback(() => {
    switch (stepKey) {
      case "results":
        goTo("search");
        break;
      case "review":
        goTo("results");
        break;
      case "schedule":
        goTo("review");
        break;
      default:
        break;
    }
  }, [stepKey, goTo]);

  const handleContinue = React.useCallback(() => {
    switch (stepKey) {
      case "search":
        if (origin) goTo("results");
        break;
      case "results":
        if (stopIds.length >= 1) goTo("review");
        break;
      case "review":
        // SP3: review Continue advances to schedule (no save yet).
        if (orderedStops.length >= 1) goTo("schedule");
        break;
      case "schedule":
        // SP3: the save happens here (once), on schedule Continue.
        void savePath();
        break;
      default:
        break;
    }
  }, [stepKey, origin, stopIds.length, orderedStops.length, goTo, savePath]);

  const continueLabel =
    stepKey === "results"
      ? "Review path"
      : stepKey === "review"
        ? "Schedule path"
        : stepKey === "schedule"
          ? saving
            ? "Saving…"
            : "Save path"
          : "Continue";

  const showFooter = stepKey !== "saved";
  // No Back on the first step (search) or the terminal saved step.
  const showBack = stepKey !== "search" && stepKey !== "saved";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-surface-default shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right md:max-w-[28rem]"
        >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-default px-5 py-4">
        <div className="flex flex-col gap-1">
          <Dialog.Title className="text-heading-sm text-text-default">Plan a new area</Dialog.Title>
          <p className="text-caption text-text-muted">
            {stepLabel(stepKey)} · {step.title}
          </p>
        </div>
        <Dialog.Close asChild>
          <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </Dialog.Close>
      </div>

      {/* Progress bar — derived from PLAN_STEPS. */}
      <div className="mt-3 flex shrink-0 gap-1 px-5" aria-hidden>
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
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5">
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
            resultsCount={resultsCount}
            onResultsCountChange={setResultsCount}
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
            onAddAll={() => addAll(resultMerchants)}
            onRemoveAll={() => removeAll(resultMerchants)}
            discoveryHint={discoveryHint}
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

        {stepKey === "schedule" && (
          <PlanScheduleStep
            date={scheduleDate}
            onDateChange={handleDateChange}
            activePick={datePick}
            reminderTime={reminderTime}
            onReminderTimeChange={setReminderTime}
            name={effectiveName}
            onNameChange={handleNameChange}
            dateValid={dateValid}
          />
        )}

        {stepKey === "saved" && (
          <PlanSavedStep
            pathName={effectiveName || originLabel || "Your path"}
            stopCount={orderedStops.length}
            reminderLabel={formatReminder(reminderAt)}
            onViewUpcoming={finishSaved}
            onBuildAnother={resetWizard}
            onDone={finishSaved}
          />
        )}
      </div>

      {/* Footer */}
      {showFooter && (
        <footer className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border-default px-5 py-4">
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
              trailingIcon={stepKey === "schedule" ? undefined : ArrowRight}
              leadingIcon={stepKey === "schedule" && saving ? Loader2 : undefined}
              loading={stepKey === "schedule" && saving}
              disabled={!canContinue}
              onClick={handleContinue}
            >
              {continueLabel}
            </Button>
          </div>
        </footer>
      )}

      <DropInSheet merchant={dropInMerchant} open={dropInOpen} onOpenChange={setDropInOpen} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default PlanPathWizard;
