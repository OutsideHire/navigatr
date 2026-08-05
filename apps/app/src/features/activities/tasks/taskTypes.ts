/**
 * The Task object — the follow-up primitive (SP1). Mirrors the `task` table
 * (migration 20260806000001). Only `targetAt` is shown to the rep; the other
 * band dates + dateSource drive the Path optimizer later (SP3).
 */
import { type TaskType } from "../lib/isProspectTouch";

export type TaskStatus = "open" | "completed" | "cancelled";
export type TaskDateSource = "interval" | "asserted" | "sla";

export interface Task {
  id: string;
  orgId: string;
  ownerId: string;
  type: TaskType;
  title: string;
  dealId: string | null;
  status: TaskStatus;
  earliestAt: string;
  targetAt: string;
  latestAt: string;
  originalTargetAt: string;
  dateSource: TaskDateSource;
  startAt: string | null;
  reminderAt: string | null;
  priority: string | null;
  repeatRule: string | null;
  sourceActivityId: string | null;
  sourceOutcome: string | null;
  snoozeCount: number;
  excludeFromPath: boolean;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Snake_case row (as selected from Supabase). Loose typing at the boundary. */
export interface TaskRow {
  id: string;
  org_id: string;
  owner_id: string;
  type: string;
  title: string;
  deal_id: string | null;
  status: string;
  earliest_at: string;
  target_at: string;
  latest_at: string;
  original_target_at: string;
  date_source: string;
  start_at: string | null;
  reminder_at: string | null;
  priority: string | null;
  repeat_rule: string | null;
  source_activity_id: string | null;
  source_outcome: string | null;
  snooze_count: number;
  exclude_from_path: boolean;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TASK_SELECT =
  "id, org_id, owner_id, type, title, deal_id, status, earliest_at, target_at, latest_at, " +
  "original_target_at, date_source, start_at, reminder_at, priority, repeat_rule, " +
  "source_activity_id, source_outcome, snooze_count, exclude_from_path, completed_at, cancelled_at, created_at, updated_at";

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    orgId: r.org_id,
    ownerId: r.owner_id,
    type: r.type as TaskType,
    title: r.title,
    dealId: r.deal_id,
    status: r.status as TaskStatus,
    earliestAt: r.earliest_at,
    targetAt: r.target_at,
    latestAt: r.latest_at,
    originalTargetAt: r.original_target_at,
    dateSource: r.date_source as TaskDateSource,
    startAt: r.start_at,
    reminderAt: r.reminder_at,
    priority: r.priority,
    repeatRule: r.repeat_rule,
    sourceActivityId: r.source_activity_id,
    sourceOutcome: r.source_outcome,
    snoozeCount: r.snooze_count,
    excludeFromPath: r.exclude_from_path,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
