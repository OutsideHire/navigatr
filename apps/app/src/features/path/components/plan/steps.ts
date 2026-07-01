/**
 * Plan-a-Path wizard step descriptors.
 *
 * Data-driven stepper: the wizard shell derives its progress bar + "Step N of M"
 * label from this ordered array, so SP3 can insert a `schedule` step before
 * `saved` without touching the shell. SP2 ships 5 steps:
 *   mode → search → results → review → saved
 */

export type StepKey = "mode" | "search" | "results" | "review" | "schedule" | "saved";

export interface Step {
  key: StepKey;
  /** Shown after "Step N of M · " in the header. */
  title: string;
}

/** Ordered SP2 step list. Order here IS the wizard order. */
export const PLAN_STEPS: readonly Step[] = [
  { key: "mode", title: "Choose how to build" },
  { key: "search", title: "Search & filters" },
  { key: "results", title: "Add stops" },
  { key: "review", title: "Review path" },
  { key: "schedule", title: "Schedule & remind" },
  { key: "saved", title: "Path saved" },
] as const;

/** Zero-based index of a step key in the ordered list, or -1 if unknown. */
export function stepIndex(key: StepKey): number {
  return PLAN_STEPS.findIndex((s) => s.key === key);
}

/** The step descriptor for a key. */
export function stepFor(key: StepKey): Step {
  const s = PLAN_STEPS.find((step) => step.key === key);
  if (!s) throw new Error(`Unknown step key: ${key}`);
  return s;
}

/** Human "Step N of M" label for a step key (1-based N, M = total steps). */
export function stepLabel(key: StepKey): string {
  const idx = stepIndex(key);
  return `Step ${idx + 1} of ${PLAN_STEPS.length}`;
}

/** The next step key after `key`, or null if it's the last step. */
export function nextStep(key: StepKey): StepKey | null {
  const idx = stepIndex(key);
  const next = PLAN_STEPS[idx + 1];
  return next ? next.key : null;
}

/** The previous step key before `key`, or null if it's the first step. */
export function prevStep(key: StepKey): StepKey | null {
  const idx = stepIndex(key);
  if (idx <= 0) return null;
  return PLAN_STEPS[idx - 1]!.key;
}
