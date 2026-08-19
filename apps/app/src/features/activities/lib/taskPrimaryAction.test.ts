import { describe, it, expect } from "vitest";
import { taskPrimaryAction } from "./taskPrimaryAction";

describe("taskPrimaryAction", () => {
  it("a to-do is completed in place, no deal needed", () => {
    expect(taskPrimaryAction({ isTodo: true, type: "todo", dealId: null, hasLoadableDeal: false }))
      .toEqual({ kind: "mark_done", dealUnavailable: false });
  });

  it("call/email/appointment/drop-in with a loadable deal all offer Log outcome (drop-in included, reversal)", () => {
    for (const type of ["call", "email", "appointment", "drop_in"]) {
      expect(taskPrimaryAction({ isTodo: false, type, dealId: "d-1", hasLoadableDeal: true }))
        .toEqual({ kind: "log_outcome", dealUnavailable: false });
    }
  });

  it("a non-to-do whose deal is not loaded (removed/foreign) offers Dismiss", () => {
    // The exact 'won't save' bug: the deal isn't in the rep's org deals, so
    // logging would be rejected by the database. Offer Dismiss instead.
    expect(taskPrimaryAction({ isTodo: false, type: "call", dealId: "gone", hasLoadableDeal: false }))
      .toEqual({ kind: "dismiss", dealUnavailable: true });
    expect(taskPrimaryAction({ isTodo: false, type: "drop_in", dealId: "gone", hasLoadableDeal: false }))
      .toEqual({ kind: "dismiss", dealUnavailable: true });
  });

  it("a non-to-do with no deal at all also offers Dismiss (nothing to log against)", () => {
    expect(taskPrimaryAction({ isTodo: false, type: "email", dealId: null, hasLoadableDeal: false }))
      .toEqual({ kind: "dismiss", dealUnavailable: true });
    // hasLoadableDeal true is meaningless without a dealId; still Dismiss.
    expect(taskPrimaryAction({ isTodo: false, type: "email", dealId: null, hasLoadableDeal: true }))
      .toEqual({ kind: "dismiss", dealUnavailable: true });
  });
});
