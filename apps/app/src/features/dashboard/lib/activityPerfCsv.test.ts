import { describe, it, expect } from "vitest";
import type { DealPerf } from "./activityPerformance";
import { activityPerfCsv } from "./activityPerfCsv";

const rows: DealPerf[] = [
  { dealId: "d1", companyName: "Northside Diner", ownerId: "u1", outcome: "won", valueCents: 500_000, days: 16, counts: { call: 2, email: 1, drop_in: 0, appointment: 1, total: 4 } },
  { dealId: "d2", companyName: "Beacon Auto", ownerId: "u2", outcome: "lost", valueCents: 300_000, days: 26, counts: { call: 1, email: 0, drop_in: 0, appointment: 0, total: 1 } },
  { dealId: "d3", companyName: "Vista Payments", ownerId: "u1", outcome: "open", valueCents: 900_000, days: null, counts: { call: 1, email: 1, drop_in: 1, appointment: 0, total: 3 } },
];
const nameOf = (id: string | null) => (id === "u1" ? "You" : id === "u2" ? "Remy" : "Unassigned");

describe("activityPerfCsv", () => {
  it("emits a header and one row per deal in the scope, richest first", () => {
    const csv = activityPerfCsv(rows, "won", nameOf);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Company,Rep,Outcome,Value,Calls,Emails,Visits,Appointments,Total,Days");
    expect(lines).toHaveLength(2); // header + 1 won row
    expect(lines[1]).toContain("Northside Diner");
    expect(lines[1]).toContain("You");
    expect(lines[1]).toContain("16");
  });

  it("all scope includes every deal, sorted by value desc, with blank days for open", () => {
    const csv = activityPerfCsv(rows, "all", nameOf);
    const lines = csv.split("\n").slice(1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Vista Payments"); // 900k, richest first
    expect(lines[0]!.endsWith(",")).toBe(true); // open -> empty days field last
  });

  it("escapes formula-injection-prone company names", () => {
    const danger: DealPerf[] = [{ ...rows[0]!, companyName: "=SUM(A1)" }];
    const csv = activityPerfCsv(danger, "won", nameOf);
    expect(csv).toContain("'=SUM(A1)");
  });
});
