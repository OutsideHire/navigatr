/**
 * taskPrimaryAction. The one primary CTA an Activities task row should offer.
 *
 * A non-to-do task (call / email / drop-in / appointment) logs its outcome
 * against its DEAL. If that deal is not in the rep's loaded org deals (it was
 * removed, or is stale/foreign sample data), logging can only fail at the
 * database, so the row must NOT offer "Log activity" / "Open deal": it offers
 * "Dismiss" instead, so the rep can clear the dead row. To-dos never need a deal.
 */

export type TaskActionKind = "mark_done" | "log_activity" | "open_deal" | "dismiss";

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

  // A drop-in is logged from the deal record; the rest log inline.
  if (input.type === "drop_in") return { kind: "open_deal", dealUnavailable: false };
  return { kind: "log_activity", dealUnavailable: false };
}
