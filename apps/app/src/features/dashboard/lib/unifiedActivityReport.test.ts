import { describe, it, expect } from "vitest";
import type { Activity } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import { classifyDealOutcome, attributeActivitiesWithOutcome, outcomeBand, reconciliation } from "./unifiedActivityReport";
import { unifiedRepRows, rankDivergence } from "./unifiedActivityReport";

const range = { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T00:00:00.000Z" };
const deal = (id: string, owner_id: string | null, companyName: string, stage: string, valueCents = 0): Deal =>
  ({ id, owner_id, companyName, stage, valueCents } as Deal);
const act = (dealId: string, type: Activity["type"], occurredAt: string): Activity =>
  ({ id: `${dealId}-${type}-${occurredAt}`, dealId, type, occurredAt } as Activity);

const deals = [deal("w", "u1", "Acme", "won", 100), deal("l", "u1", "Beta", "lost"), deal("o", "u2", "Acme", "proposal")];

describe("classifyDealOutcome", () => {
  it("maps stage to outcome", () => {
    expect(classifyDealOutcome("won")).toBe("won");
    expect(classifyDealOutcome("lost")).toBe("lost");
    expect(classifyDealOutcome("proposal")).toBe("open");
    expect(classifyDealOutcome("new")).toBe("open");
  });
});

describe("attributeActivitiesWithOutcome", () => {
  it("tags each in-window activity with its deal outcome, owner, company; skips unmatched + out-of-window", () => {
    const acts = [
      act("w", "call", "2026-03-01T00:00:00.000Z"),
      act("l", "email", "2026-03-02T00:00:00.000Z"),
      act("o", "drop_in", "2026-03-03T00:00:00.000Z"),
      act("w", "call", "2020-01-01T00:00:00.000Z"),
      act("missing", "call", "2026-03-01T00:00:00.000Z"),
    ];
    const rows = attributeActivitiesWithOutcome(acts, deals, range);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.type === "call")!.outcome).toBe("won");
    expect(rows.find((r) => r.type === "email")!.outcome).toBe("lost");
    expect(rows.find((r) => r.type === "drop_in")!.outcome).toBe("open");
  });
});

describe("outcomeBand + reconciliation", () => {
  const rows = attributeActivitiesWithOutcome(
    [act("w", "call", "2026-03-01T00:00:00.000Z"), act("w", "email", "2026-03-02T00:00:00.000Z"), act("l", "call", "2026-03-03T00:00:00.000Z"), act("o", "call", "2026-03-04T00:00:00.000Z")],
    deals, range,
  );
  it("counts activities by outcome and totals", () => {
    const b = outcomeBand(rows);
    expect(b).toEqual({ won: 2, lost: 1, open: 1, total: 4 });
  });
  it("reconciliation splits won vs open-or-lost, unattached always 0", () => {
    expect(reconciliation(outcomeBand(rows))).toEqual({ total: 4, won: 2, openLost: 2, unattached: 0 });
  });
});

describe("unifiedRepRows", () => {
  const deals2 = [deal("w1", "u1", "Acme", "won", 20000), deal("w2", "u1", "Beta", "won", 10000), deal("o1", "u2", "Acme", "proposal", 5000)];
  const acts2 = [
    act("w1", "call", "2026-03-01T00:00:00.000Z"), act("w1", "email", "2026-03-02T00:00:00.000Z"),
    act("w2", "call", "2026-03-03T00:00:00.000Z"), act("o1", "call", "2026-03-04T00:00:00.000Z"),
  ];
  it("aggregates rep -> company activity counts + deal columns for the scope", () => {
    const rows = unifiedRepRows(acts2, deals2, range, "won");
    const u1 = rows.find((r) => r.ownerId === "u1")!;
    expect(u1.counts.total).toBe(3);
    expect(u1.companyCount).toBe(2);
    expect(u1.dealCount).toBe(2);
    expect(u1.valueCents).toBe(30000);
    expect(rows.some((r) => r.ownerId === "u2")).toBe(false);
  });
  it("in the all scope every rep with activity appears", () => {
    const rows = unifiedRepRows(acts2, deals2, range, "all");
    expect(rows.map((r) => r.ownerId).sort()).toEqual(["u1", "u2"]);
  });
});

describe("rankDivergence", () => {
  it("flags reps whose effort rank and outcome rank differ by 2+", () => {
    const rows = [
      { ownerId: "a", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 30 }, valueCents: 10 } as any,
      { ownerId: "b", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 20 }, valueCents: 100 } as any,
      { ownerId: "c", counts: { call: 0, email: 0, drop_in: 0, appointment: 0, total: 10 }, valueCents: 50 } as any,
    ];
    const d = rankDivergence(rows);
    expect(d.get("a")).toEqual({ effortRank: 1, outcomeRank: 3 });
    expect(d.has("b")).toBe(false);
  });
});
