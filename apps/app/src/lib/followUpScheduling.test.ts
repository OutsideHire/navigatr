import { describe, it, expect } from "vitest";
import {
  calculateFollowUpDate,
  DISPOSITIONS,
  formatFollowUpDate,
  schedulesFollowUp,
  APPOINTMENT_STAGE_EFFECT,
  type Disposition,
} from "./followUpScheduling";

/** Helper — pin "today" so business-day math is deterministic. */
const WED_APR_30_2026 = new Date("2026-04-30T12:00:00Z"); // a Wednesday

describe("calculateFollowUpDate", () => {
  it("statement_secured → +1 business day", () => {
    // Wed → Thu
    const iso = calculateFollowUpDate("statement_secured", WED_APR_30_2026)!;
    expect(new Date(iso).toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("positive_engagement → +3 business days, skipping weekend", () => {
    // Wed + 3 business days = Mon (Thu, Fri, Mon)
    const iso = calculateFollowUpDate("positive_engagement", WED_APR_30_2026)!;
    expect(new Date(iso).toISOString().slice(0, 10)).toBe("2026-05-05");
  });

  it("connected_with_dm → +7 business days, lands the next Friday", () => {
    // Wed + 7 bd = next Fri
    const iso = calculateFollowUpDate("connected_with_dm", WED_APR_30_2026)!;
    expect(new Date(iso).toISOString().slice(0, 10)).toBe("2026-05-11");
  });

  it("terminal dispositions return null", () => {
    const terminals: Disposition[] = ["not_interested", "wrong_number", "closed_lost", "followup_requested"];
    for (const d of terminals) {
      expect(calculateFollowUpDate(d, WED_APR_30_2026)).toBeNull();
    }
  });

  it("every disposition has a label, rationale, and tier", () => {
    for (const [key, spec] of Object.entries(DISPOSITIONS)) {
      expect(spec.key).toBe(key);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.rationale.length).toBeGreaterThan(0);
      expect(["positive", "neutral", "negative", "cool"]).toContain(spec.tier);
    }
  });
});

describe("formatFollowUpDate", () => {
  it("renders short weekday + month + day", () => {
    const iso = "2026-05-05T00:00:00.000Z";
    const out = formatFollowUpDate(iso);
    expect(out).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/);
  });
});

describe("field dispositions (Path Slice 3)", () => {
  it("registers all 9 new dispositions with a tier", () => {
    for (const key of [
      "met_dm", "gatekeeper", "left_collateral", "scheduled_callback",
      "not_in_office", "closed_locked", "do_not_contact", "out_of_business", "other",
    ] as const) {
      expect(DISPOSITIONS[key]).toBeDefined();
      expect(DISPOSITIONS[key].tier).toBeTruthy();
    }
  });

  it("engaged outcomes schedule a follow-up; terminal ones do not", () => {
    const from = new Date("2026-06-01T12:00:00Z"); // a Monday
    expect(calculateFollowUpDate("met_dm", from)).not.toBeNull();
    expect(calculateFollowUpDate("scheduled_callback", from)).not.toBeNull();
    expect(calculateFollowUpDate("out_of_business", from)).toBeNull();
    expect(calculateFollowUpDate("do_not_contact", from)).toBeNull();
  });
});

describe("disposition catalog (drop-in redesign)", () => {
  it("has the redesigned metadata for the 10 outcome dispositions", () => {
    expect(DISPOSITIONS.dm_unavailable.label).toBe("DM Unavailable");
    expect(DISPOSITIONS.followup_requested.label).toBe("Follow-Up Requested");
    expect(DISPOSITIONS.wrong_number.label).toBe("Wrong Person");
    expect(DISPOSITIONS.wrong_number.tier).toBe("cool");
    expect(DISPOSITIONS.future_potential.tier).toBe("neutral");
    expect(DISPOSITIONS.statement_secured.rationale).toBe("Highest urgency. 1 day.");
    expect(DISPOSITIONS.connected_with_dm.rationale).toBe("Relationship. 7 days.");
  });

  it("schedulesFollowUp is true for the 7 with a follow-up, false for the 3 terminal", () => {
    const yes: Disposition[] = ["statement_secured","positive_engagement","connected_with_dm","dm_unavailable","followup_requested","future_potential","low_probability"];
    const no: Disposition[] = ["wrong_number","not_interested","closed_lost"];
    for (const d of yes) expect(schedulesFollowUp(d)).toBe(true);
    for (const d of no) expect(schedulesFollowUp(d)).toBe(false);
  });
});

describe("appointment outcomes (W2a-2)", () => {
  const EXPECTED: Record<string, { label: string; businessDays: number | null }> = {
    appt_presented_awaiting: { label: "Presented, awaiting decision", businessDays: 3 },
    appt_statements_collected: { label: "Statements collected", businessDays: 1 },
    appt_verbal_commitment: { label: "Verbal commitment", businessDays: 1 },
    appt_no_show: { label: "No show", businessDays: 2 },
    appt_rescheduled: { label: "Rescheduled on the spot", businessDays: 2 },
    appt_application_signed: { label: "Application signed", businessDays: 2 },
    appt_dm_unavailable: { label: "Decision maker not available", businessDays: 2 },
    appt_cancelled_by_merchant: { label: "Cancelled by merchant", businessDays: 3 },
    appt_not_interested: { label: "Not interested", businessDays: null },
  };

  it("registers each of the nine outcomes with its label and businessDays", () => {
    for (const [key, expected] of Object.entries(EXPECTED)) {
      const spec = DISPOSITIONS[key as Disposition];
      expect(spec).toBeDefined();
      expect(spec.label).toBe(expected.label);
      expect(spec.businessDays).toBe(expected.businessDays);
    }
  });

  it("schedulesFollowUp is true for the eight scheduling outcomes, false for appt_not_interested", () => {
    const yes: Disposition[] = [
      "appt_presented_awaiting",
      "appt_statements_collected",
      "appt_verbal_commitment",
      "appt_no_show",
      "appt_rescheduled",
      "appt_application_signed",
      "appt_dm_unavailable",
      "appt_cancelled_by_merchant",
    ];
    for (const d of yes) expect(schedulesFollowUp(d)).toBe(true);
    expect(schedulesFollowUp("appt_not_interested")).toBe(false);
  });

  it("calculateFollowUpDate works unchanged for the new outcomes", () => {
    const from = new Date("2026-06-01T12:00:00Z"); // a Monday
    for (const d of Object.keys(EXPECTED) as Disposition[]) {
      const iso = calculateFollowUpDate(d, from);
      if (EXPECTED[d].businessDays === null) {
        expect(iso).toBeNull();
      } else {
        expect(iso).not.toBeNull();
      }
    }
  });
});

describe("APPOINTMENT_STAGE_EFFECT", () => {
  it("maps only the two forward-advancing outcomes, and nothing else", () => {
    expect(APPOINTMENT_STAGE_EFFECT.appt_verbal_commitment).toBe("proposal");
    expect(APPOINTMENT_STAGE_EFFECT.appt_application_signed).toBe("submitted");
    expect(Object.keys(APPOINTMENT_STAGE_EFFECT).sort()).toEqual(
      ["appt_application_signed", "appt_verbal_commitment"].sort(),
    );
  });
});
