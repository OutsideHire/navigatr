import { describe, it, expect } from "vitest";
import {
  calculateFollowUpDate,
  DISPOSITIONS,
  formatFollowUpDate,
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
