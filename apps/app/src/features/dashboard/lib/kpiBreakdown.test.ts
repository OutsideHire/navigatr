import { describe, it, expect } from "vitest";
import { breakdownByOwner } from "./kpiBreakdown";
import type { Deal } from "@/features/pipeline/mockData";

function deal(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id, companyName: o.companyName ?? o.id, contactName: "C", phone: "", email: "",
    valueCents: o.valueCents ?? 0, stage: o.stage ?? "qualified", probability: 50,
    lastActivity: "2026-07-01T00:00:00Z", nextFollowup: null, address: null,
    employeeCountRange: "1-9", leadSource: "", updatedAt: "2026-07-01T00:00:00Z",
    owner_id: o.owner_id ?? null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

const DEALS: Deal[] = [
  deal({ id: "a", owner_id: "u1", stage: "qualified", valueCents: 100 }),
  deal({ id: "b", owner_id: "u1", stage: "proposal", valueCents: 300 }),
  deal({ id: "c", owner_id: "u2", stage: "new", valueCents: 50 }),
  deal({ id: "d", owner_id: "u1", stage: "won", valueCents: 900 }),
  deal({ id: "e", owner_id: "u2", stage: "won", valueCents: 100 }),
  deal({ id: "f", owner_id: "u2", stage: "lost", valueCents: 999 }),
  deal({ id: "g", owner_id: null, stage: "new", valueCents: 40 }),
];

describe("breakdownByOwner", () => {
  it("activeLeads = count of open deals per owner, sorted desc", () => {
    const b = breakdownByOwner(DEALS, "activeLeads");
    // u1: a,b (2); u2: c (1); null: g (1). won/lost excluded.
    expect(b.rows).toEqual([
      { ownerId: "u1", value: 2 },
      { ownerId: "u2", value: 1 },
      { ownerId: null, value: 1 },
    ]);
    expect(b.total).toBe(4);
    expect(b.max).toBe(2);
    expect(b.min).toBe(1);
  });

  it("pipelineValue = sum of open value per owner", () => {
    const b = breakdownByOwner(DEALS, "pipelineValue");
    expect(b.rows).toEqual([
      { ownerId: "u1", value: 400 },
      { ownerId: "u2", value: 50 },
      { ownerId: null, value: 40 },
    ]);
    expect(b.total).toBe(490);
  });

  it("won = sum of won value per owner (all-time, matching the KPI)", () => {
    const b = breakdownByOwner(DEALS, "won");
    expect(b.rows).toEqual([
      { ownerId: "u1", value: 900 },
      { ownerId: "u2", value: 100 },
    ]);
    expect(b.total).toBe(1000);
  });

  it("empty input yields no rows and zeroed stats", () => {
    expect(breakdownByOwner([], "won")).toEqual({ rows: [], min: 0, max: 0, total: 0 });
  });
});
