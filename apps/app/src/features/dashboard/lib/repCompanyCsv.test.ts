import { describe, it, expect } from "vitest";
import { repCompanyCsv } from "./repCompanyCsv";
import { repCompanyAggregate } from "./repCompanyActivity";

describe("repCompanyCsv", () => {
  const { reps, grandTotal } = repCompanyAggregate([
    { ownerId: "u1", companyName: "Acme", type: "call" },
    { ownerId: "u1", companyName: "Acme", type: "email" },
    { ownerId: "u1", companyName: "Beta, Inc", type: "call" },
  ]);
  const nameOf = (id: string | null) => (id === "u1" ? "Dana W" : "Unassigned");

  it("emits a header, one row per rep by company, and a grand total row", () => {
    const csv = repCompanyCsv(reps, nameOf, grandTotal);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Rep,Company,Calls,Emails,Visits,Appointments,Total");
    expect(lines).toContain("Dana W,Acme,1,1,0,0,2");
    expect(lines[lines.length - 1]).toBe("Grand total,,2,1,0,0,3");
  });

  it("quotes cells containing commas", () => {
    const csv = repCompanyCsv(reps, nameOf, grandTotal);
    expect(csv).toContain('Dana W,"Beta, Inc",1,0,0,0,1');
  });
});
