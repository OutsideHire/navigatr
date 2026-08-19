/**
 * taskPrimaryAction. The one primary CTA an Activities task row should offer.
 *
 * A non-to-do task (call / email / drop-in / appointment) logs its OUTCOME
 * against its DEAL: the card offers "Log outcome" (the scheduled path — the
 * type is inherited from the task, not re-picked). Drop-ins are included (a
 * drop-in task otherwise has no way to be closed off-Path). If that deal is not
 * in the rep's loaded org deals (removed, or stale/foreign sample data), logging
 * can only fail at the database, so the row offers "Dismiss" instead so the rep
 * can clear the dead row. To-dos are completed in place ("Complete"), no deal,
 * no outcome, excluded from Follow-Up Discipline.
 */

export type TaskActionKind = "mark_done" | "log_outcome" | "dismiss";

export interface TaskActionInput {
  /** type === "todo": a plain reminder, completed in place, needs no deal. */
  isTodo: boolean;
  /** The task type ("call" | "email" | "drop_in" | "appointment" | "todo"). */
  type: string;
  /** The task's linked deal, or null. */
  dealId: string | null;
  /** Whether that deal is present in the rep's loaded org deals (dealById). */
  hasLoadableDeal: boolean;
}

export interface TaskPrimaryAction {
  kind: TaskActionKind;
  /** True when the row points at a deal the rep can't act on (missing/foreign
   *  sample data). Drives the explanatory note on the row. */
  dealUnavailable: boolean;
}

export function taskPrimaryAction(input: TaskActionInput): TaskPrimaryAction {
  // A to-do is completed in place; it never logs against a deal.
  if (input.isTodo) return { kind: "mark_done", dealUnavailable: false };

  // Everything else acts on a deal. No loadable deal -> the only safe action is
  // to dismiss the row (logging would be rejected by the database).
  const loadable = input.dealId != null && input.hasLoadableDeal;
  if (!loadable) return { kind: "dismiss", dealUnavailable: true };

  // Call / email / drop-in / appointment all log their outcome inline from the
  // card (drop-ins included — reversal of the earlier "removed on drop-ins" rule,
  // since a drop-in task otherwise cannot be closed without an open-tasks surface
  // on the deal record).
  return { kind: "log_outcome", dealUnavailable: false };
}
