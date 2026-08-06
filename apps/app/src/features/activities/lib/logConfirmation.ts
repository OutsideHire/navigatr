/**
 * Post-log confirmation (Screen Content Spec §5). After an outcome is logged the
 * platform must explain what it did: which follow-up task(s) it created (or that
 * it created none), whether they reach the Path, and any record-state change.
 * This is the pure formatter; useLogActivity returns the raw summary and the
 * sheet renders the result.
 */
import type { ActivityType } from "../mockData";

export interface LogConfirmationTask {
  type: string; // call | email | drop_in | appointment | todo
  title: string;
  targetAt: string; // YYYY-MM-DD
}

export interface LogConfirmation {
  activityType: ActivityType;
  createdTasks: LogConfirmationTask[]; // empty → terminal outcome, no follow-up
  compound: boolean; // send_info → two tasks
  recordEffects: string[]; // e.g. "Phone number flagged as invalid"
}

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  drop_in: "Drop-in",
  appointment: "Appointment",
};

const TASK_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  drop_in: "Drop-in",
  appointment: "Appointment",
  todo: "To-do",
};

/** Whole-day delta from today (local) to a YYYY-MM-DD date. */
function daysFromToday(dateStr: string, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  return Math.round((target - today) / 86_400_000);
}

function dueLabel(dateStr: string, now: Date): string {
  const d = daysFromToday(dateStr, now);
  if (d <= 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

/** A drop-in follow-up becomes a Class D Path stop; everything else lives on
 *  Activities only. */
function reachesPath(type: string): boolean {
  return type === "drop_in";
}

export interface FormattedConfirmation {
  title: string;
  lines: string[];
}

export function formatLogConfirmation(c: LogConfirmation, now: Date = new Date()): FormattedConfirmation {
  const title = `${ACTIVITY_LABEL[c.activityType]} logged`;
  const lines: string[] = [];

  if (c.createdTasks.length === 0) {
    lines.push("No follow-up scheduled.");
  } else {
    for (const t of c.createdTasks) {
      const where = reachesPath(t.type) ? " · shows on your Path" : "";
      lines.push(`${TASK_LABEL[t.type] ?? t.type} task created, ${dueLabel(t.targetAt, now)}${where}`);
    }
  }
  for (const e of c.recordEffects) lines.push(e);
  return { title, lines };
}
