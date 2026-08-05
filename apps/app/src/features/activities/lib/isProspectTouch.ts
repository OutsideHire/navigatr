/**
 * isProspectTouch — whether a task/activity type represents merchant contact.
 *
 * activity_type is a Postgres enum (not a lookup table), so this classification
 * lives in code as the single source of truth. True for the four contact types,
 * false for todo (internal desk work). Metrics that measure merchant contact
 * (Follow-Up Discipline, Activity Logging Coverage, Touch Cadence) filter on it.
 * SP1 defines it; the metric re-base that consumes it is deferred.
 */
export type TaskType = "call" | "email" | "drop_in" | "appointment" | "todo";

const PROSPECT_TOUCH: Record<TaskType, boolean> = {
  call: true,
  email: true,
  drop_in: true,
  appointment: true,
  todo: false,
};

export function isProspectTouch(type: TaskType): boolean {
  return PROSPECT_TOUCH[type];
}
