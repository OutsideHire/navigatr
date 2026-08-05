/**
 * taskFromOutcome — pure mapping from a logged activity's outcome to the fields
 * of the follow-up task it generates, or null when the outcome carries no
 * interval. Reuses the existing DISPOSITIONS interval map, so SP1 introduces no
 * new interval decisions. Task type inherits the activity type by default; the
 * SP2 overrides (drop-in Statement Secured -> To-do, call Verbal-commitment ->
 * To-do, call Send-info -> Email+Call) plug in via OUTCOME_TYPE_OVERRIDE, which
 * is intentionally empty in SP1.
 */
import { DISPOSITIONS, type Disposition } from "@/lib/followUpScheduling";
import { bandsFromTarget } from "./taskBands";
import { type TaskType } from "./isProspectTouch";

/**
 * Outcomes whose follow-up changes channel (SP2). Statement Secured (drop-in)
 * and Verbal commitment (call) both mean the next action is desk work, not a
 * repeat of the same touch, so they produce a To-do rather than inheriting the
 * activity type. Send info is a compound (Email + Call) handled at the log site,
 * not here.
 */
const OUTCOME_TYPE_OVERRIDE: Partial<Record<Disposition, TaskType>> = {
  statement_secured: "todo",
  verbal_commitment: "todo",
};

export interface NewTaskFields {
  type: TaskType;
  title: string;
  date_source: "interval";
  earliest_at: string;
  target_at: string;
  latest_at: string;
  original_target_at: string;
  source_outcome: string;
}

/**
 * @param targetISO the follow-up date already stored on the activity
 *   (`activities.follow_up_date`). The task's target is built from THIS date so
 *   it stays byte-equal to the score signal; the disposition interval only
 *   sizes the surrounding slack band.
 */
export function taskFromOutcome(
  activityType: TaskType,
  disposition: Disposition,
  targetISO: string | null,
  dealName: string,
): NewTaskFields | null {
  const spec = DISPOSITIONS[disposition];
  const bands = bandsFromTarget(targetISO, spec?.businessDays ?? null);
  if (!bands) return null;
  return {
    type: OUTCOME_TYPE_OVERRIDE[disposition] ?? activityType,
    title: dealName,
    date_source: "interval",
    ...bands,
    original_target_at: bands.target_at,
    source_outcome: disposition,
  };
}
