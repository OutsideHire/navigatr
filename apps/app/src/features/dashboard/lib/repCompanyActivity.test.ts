import { describe, it, expect } from "vitest";
import type { Activity } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import {
  attributeActivities,
  repCompanyAggregate,
  sortReps,
  emptyCounts,
} from "./repCompanyActivity";

const range = { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T00:00:00.000Z" };

function deal(id: string, owner_id: string | null, companyName: string): Deal {
  return { id, owner_id, companyName } as Deal;
}
function act(dealId: string, type: Activity["type"], occurredAt: string): Activity {
  return { id: `${dealId}-${type}-${occurredAt}`, dealId, type, occurredAt, loggedBy: null } as Activity;
}

describe("attributeActivities", () => {
  const deals = [deal("d1", "u1", "Acme"), deal("d2", "u1", "Beta"), deal("d3", "u2", "Acme")];

  it("joins each activity to its deal's owner and company, in-range only", () => {
    const acts = [
      act("d1", "call", "2026-03-01T00:00:00.000Z"),
      act("d2", "email", "2026-03-02T00:00:00.000Z"),
      act("d1", "call", "2020-01-01T00:00:00.000Z"),
    ];
    const rows = attributeActivities(acts, deals, range);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ownerId: "u1", companyName: "Acme", type: "call" });
  });

  it("skips activities whose deal is not visible", () => {
    const rows = attributeActivities([act("missing", "call", "2026-03-01T00:00:00.000Z")], deals, range);
    expect(rows).toHaveLength(0);
  });
});

describe("repCompanyAggregate", () => {
  it("groups rep -> company -> per-type counts and reconciles at every level", () => {
    const rows = [
      { ownerId: "u1", companyName: "Acme", type: "call" as const },
      { ownerId: "u1", companyName: "Acme", type: "email" as const },
      { ownerId: "u1", companyName: "Beta", type: "call" as const },
      { ownerId: "u2", companyName: "Acme", type: "drop_in" as const },
    ];
    const { reps, grandTotal } = repCompanyAggregate(rows);
    const u1 = reps.find((r) => r.ownerId === "u1")!;
    expect(u1.companyCount).toBe(2);
    expect(u1.counts.total).toBe(3);
    expect(u1.counts.call).toBe(2);
    const sumCos = u1.companies.reduce((s, c) => s + c.counts.total, 0);
    expect(sumCos).toBe(u1.counts.total);
    expect(grandTotal.total).toBe(reps.reduce((s, r) => s + r.counts.total, 0));
    expect(grandTotal.total).toBe(4);
  });

  it("sorts a rep's companies by total desc", () => {
    const rows = [
      { ownerId: "u1", companyName: "Small", type: "call" as const },
      { ownerId: "u1", companyName: "Big", type: "call" as const },
      { ownerId: "u1", companyName: "Big", type: "email" as const },
    ];
    const { reps } = repCompanyAggregate(rows);
    expect(reps[0]!.companies.map((c) => c.companyName)).toEqual(["Big", "Small"]);
  });

  it("buckets null owner under an unassigned rep", () => {
    const { reps } = repCompanyAggregate([{ ownerId: null, companyName: "Acme", type: "call" as const }]);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.ownerId).toBeNull();
  });

  it("breaks company-total ties alphabetically", () => {
    const { reps } = repCompanyAggregate([
      { ownerId: "u1", companyName: "Zeta", type: "call" as const },
      { ownerId: "u1", companyName: "Alpha", type: "call" as const },
    ]);
    expect(reps[0]!.companies.map((c) => c.companyName)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("sortReps", () => {
  const nameOf = (id: string | null) => id ?? "Unassigned";
  it("sorts by the selected metric descending", () => {
    const { reps } = repCompanyAggregate([
      { ownerId: "u1", companyName: "A", type: "call" as const },
      { ownerId: "u2", companyName: "A", type: "call" as const },
      { ownerId: "u2", companyName: "A", type: "email" as const },
    ]);
    const byTotal = sortReps(reps, "total", nameOf);
    expect(byTotal[0]!.ownerId).toBe("u2");
    const byEmail = sortReps(reps, "email", nameOf);
    expect(byEmail[0]!.ownerId).toBe("u2");
  });

  it("breaks metric ties by total desc, then name asc", () => {
    const { reps } = repCompanyAggregate([
      // u1 and u2 tie on calls (1 each); u1 has an extra email so higher total
      { ownerId: "u1", companyName: "A", type: "call" as const },
      { ownerId: "u1", companyName: "A", type: "email" as const },
      { ownerId: "u2", companyName: "A", type: "call" as const },
      // u3 also 1 call, same total as u2 -> falls to name tie-break
      { ownerId: "u3", companyName: "A", type: "call" as const },
    ]);
    const names: Record<string, string> = { u1: "Beta", u2: "Yara", u3: "Alan" };
    const nameOf = (id: string | null) => (id ? names[id]! : "Unassigned");
    const byCall = sortReps(reps, "call", nameOf);
    // u1 first (call tie with others but higher total); then u2 vs u3 tie on call+total -> name asc: Alan(u3) before Yara(u2)
    expect(byCall.map((r) => r.ownerId)).toEqual(["u1", "u3", "u2"]);
  });
});

describe("emptyCounts", () => {
  it("is all zeros", () => {
    expect(emptyCounts()).toEqual({ call: 0, email: 0, drop_in: 0, appointment: 0, total: 0 });
  });
});
