import { describe, it, expect } from "vitest";
import { unifiedActivityCsv } from "./unifiedActivityCsv";
import type { UnifiedRepRow } from "./unifiedActivityReport";

const reps: UnifiedRepRow[] = [
  {
    ownerId: "u1",
    counts: { call: 7, email: 5, drop_in: 2, appointment: 1, total: 15 },
    companyCount: 2, dealCount: 2, valueCents: 3000000,
    companies: [
      { companyName: "Acme", counts: { call: 4, email: 3, drop_in: 1, appointment: 1, total: 9 }, dealCount: 1, valueCents: 2000000 },
      { companyName: "Beta, Inc", counts: { call: 3, email: 2, drop_in: 1, appointment: 0, total: 6 }, dealCount: 1, valueCents: 1000000 },
    ],
  },
];
const nameOf = (id: string | null) => (id === "u1" ? "Dana W" : "Unassigned");

describe("unifiedActivityCsv", () => {
  it("emits a header and one row per rep x company with scoped values", () => {
    const csv = unifiedActivityCsv(reps, nameOf);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Rep,Company,Calls,Emails,Visits,Appointments,Total,Deals,Value");
    expect(lines).toContain("Dana W,Acme,4,3,1,1,9,1,$20K");
  });
  it("quotes cells containing commas", () => {
    const csv = unifiedActivityCsv(reps, nameOf);
    expect(csv).toContain('Dana W,"Beta, Inc",3,2,1,0,6,1,$10K');
  });
});
