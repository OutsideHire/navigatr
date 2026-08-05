import { describe, it, expect } from "vitest";
import { DISPOSITIONS_BY_TYPE, DISPOSITION_VALUES } from "./dispositionSets";
import { DISPOSITIONS } from "@/lib/followUpScheduling";
import type { ActivityType } from "../mockData";

const TYPES: ActivityType[] = ["call", "email", "drop_in", "appointment"];

describe("dispositionSets", () => {
  it("every type has non-empty top/all and top ⊆ all", () => {
    for (const t of TYPES) {
      const set = DISPOSITIONS_BY_TYPE[t];
      expect(set.top.length).toBeGreaterThan(0);
      expect(set.all.length).toBeGreaterThanOrEqual(set.top.length);
      for (const d of set.top) expect(set.all).toContain(d);
    }
  });

  it("differentiates Drop-in from Call (the core contract)", () => {
    const drop = DISPOSITIONS_BY_TYPE.drop_in.all;
    const call = DISPOSITIONS_BY_TYPE.call.all;
    // Drop-in carries field-visit outcomes; Call carries phone outcomes.
    expect(drop).toContain("met_dm");
    expect(call).not.toContain("met_dm");
  });

  it("SP2: the Call set records unconnected dials and drops Closed Lost", () => {
    const call = DISPOSITIONS_BY_TYPE.call.all;
    expect(call).toContain("no_answer"); // the 85%-of-dials gap
    expect(call).toContain("voicemail");
    expect(call).toContain("callback");
    expect(call).not.toContain("closed_lost");
  });

  it("SP2: Email has its own set, no longer reusing Call", () => {
    const email = DISPOSITIONS_BY_TYPE.email.all;
    const call = DISPOSITIONS_BY_TYPE.call.all;
    expect(email).toContain("sent_pricing");
    expect(email).toContain("unsubscribed");
    expect(email).not.toContain("no_answer"); // distinct from call
    expect(email).not.toEqual(call);
  });

  it("DISPOSITION_VALUES is a superset of every type's options", () => {
    const values = new Set<string>(DISPOSITION_VALUES);
    for (const t of TYPES) {
      for (const d of DISPOSITIONS_BY_TYPE[t].all) expect(values.has(d)).toBe(true);
    }
  });

  it("every value has a spec in DISPOSITIONS", () => {
    for (const v of DISPOSITION_VALUES) expect(DISPOSITIONS[v]).toBeTruthy();
  });

  it("appointment has its own outcome set, distinct from Call (W2a-2)", () => {
    expect(DISPOSITIONS_BY_TYPE.appointment.top).toEqual([
      "appt_presented_awaiting",
      "appt_statements_collected",
      "appt_verbal_commitment",
      "appt_no_show",
      "appt_rescheduled",
    ]);
    expect(DISPOSITIONS_BY_TYPE.appointment.all).toEqual([
      "appt_presented_awaiting",
      "appt_statements_collected",
      "appt_verbal_commitment",
      "appt_no_show",
      "appt_rescheduled",
      "appt_application_signed",
      "appt_dm_unavailable",
      "appt_cancelled_by_merchant",
      "appt_not_interested",
    ]);
  });
});
