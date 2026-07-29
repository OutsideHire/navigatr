import { describe, it, expect } from "vitest";
import {
  directReportStatus,
  buildDirectReportRows,
  filterDirectReports,
  assembleDirectReportInputs,
  directReportsCsv,
  type DirectReportInput,
} from "./directReports";
import type { PersistencePoint } from "./persistenceIndex";

const input = (over: Partial<DirectReportInput> = {}): DirectReportInput => ({
  ownerId: "u1",
  name: "Rep One",
  role: "Sales Professional",
  composite: 70,
  delta30: 0,
  activityCount: 100,
  spark: [68, 69, 70],
  ...over,
});

describe("directReportStatus", () => {
  it("is trending_up at or above +2 (prototype: +4.5, +4.9)", () => {
    expect(directReportStatus(2)).toBe("trending_up");
    expect(directReportStatus(4.5)).toBe("trending_up");
  });
  it("is needs_attention at or below -3 (prototype: -6.3)", () => {
    expect(directReportStatus(-3)).toBe("needs_attention");
    expect(directReportStatus(-6.3)).toBe("needs_attention");
  });
  it("is holding in the middle band (prototype: -1.0, -0.2)", () => {
    expect(directReportStatus(-1)).toBe("holding");
    expect(directReportStatus(-0.2)).toBe("holding");
    expect(directReportStatus(1.9)).toBe("holding");
  });
  it("treats a null delta (too little history) as holding", () => {
    expect(directReportStatus(null)).toBe("holding");
  });
});

describe("buildDirectReportRows", () => {
  it("sorts by composite descending and attaches status", () => {
    const rows = buildDirectReportRows([
      input({ ownerId: "a", name: "Alpha", composite: 58, delta30: -6.3 }),
      input({ ownerId: "b", name: "Beta", composite: 84, delta30: -0.2 }),
      input({ ownerId: "c", name: "Gamma", composite: 66, delta30: 4.5 }),
    ]);
    expect(rows.map((r) => r.ownerId)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.status)).toEqual(["holding", "trending_up", "needs_attention"]);
  });

  it("puts reps with no score (null composite) last, name-sorted", () => {
    const rows = buildDirectReportRows([
      input({ ownerId: "z", name: "Zoe", composite: null }),
      input({ ownerId: "a", name: "Ann", composite: null }),
      input({ ownerId: "m", name: "Max", composite: 50 }),
    ]);
    expect(rows.map((r) => r.ownerId)).toEqual(["m", "a", "z"]);
  });

  it("breaks composite ties by name ascending", () => {
    const rows = buildDirectReportRows([
      input({ ownerId: "b", name: "Bravo", composite: 70 }),
      input({ ownerId: "a", name: "Alpha", composite: 70 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("filterDirectReports", () => {
  const rows = buildDirectReportRows([
    input({ ownerId: "a", name: "A", composite: 58, delta30: -6.3 }), // needs_attention
    input({ ownerId: "b", name: "B", composite: 66, delta30: 4.5 }), // trending_up
    input({ ownerId: "c", name: "C", composite: 76, delta30: -1 }), // holding
  ]);

  it("passes everything through for 'all'", () => {
    expect(filterDirectReports(rows, "all")).toHaveLength(3);
  });
  it("filters to a single status", () => {
    expect(filterDirectReports(rows, "needs_attention").map((r) => r.ownerId)).toEqual(["a"]);
    expect(filterDirectReports(rows, "trending_up").map((r) => r.ownerId)).toEqual(["b"]);
    expect(filterDirectReports(rows, "holding").map((r) => r.ownerId)).toEqual(["c"]);
  });
});

describe("assembleDirectReportInputs", () => {
  const now = new Date("2026-07-24T12:00:00Z");
  const pt = (composite: number | null): PersistencePoint =>
    ({ date: "2026-07-01", composite, activityCount: 0 }) as PersistencePoint;

  const base = {
    roster: [{ ownerId: "u1", composite: 76 }],
    deals: [
      { id: "d1", owner_id: "u1" },
      { id: "d2", owner_id: "u2" },
    ],
    activities: [] as { dealId: string; occurredAt: string }[],
    members: new Map([["u1", { name: "Dana Whitfield", role: "Sales Professional" }]]),
    historyFor: () => [pt(70), pt(72), pt(76)],
    now,
  };

  it("maps name/role from members and composite from roster", () => {
    const [row] = assembleDirectReportInputs(base);
    expect(row.name).toBe("Dana Whitfield");
    expect(row.role).toBe("Sales Professional");
    expect(row.composite).toBe(76);
  });

  it("derives delta30 and a non-null sparkline from the injected series", () => {
    const [row] = assembleDirectReportInputs(base);
    expect(row.delta30).toBe(6); // 76 - 70
    expect(row.spark).toEqual([70, 72, 76]);
  });

  it("counts only in-window activities on deals the rep owns", () => {
    const inWindow = "2026-07-20T00:00:00Z";
    const outWindow = "2026-01-01T00:00:00Z"; // >60d before now
    const rows = assembleDirectReportInputs({
      ...base,
      activities: [
        { dealId: "d1", occurredAt: inWindow }, // u1, counts
        { dealId: "d1", occurredAt: inWindow }, // u1, counts
        { dealId: "d1", occurredAt: outWindow }, // too old, skip
        { dealId: "d2", occurredAt: inWindow }, // u2's deal, not u1
        { dealId: "d-unknown", occurredAt: inWindow }, // orphan, skip
      ],
    });
    expect(rows[0].activityCount).toBe(2);
  });

  it("defaults name to Unknown rep and role to null when the member is missing", () => {
    const rows = assembleDirectReportInputs({
      ...base,
      roster: [{ ownerId: "ghost", composite: 50 }],
      activities: [],
    });
    expect(rows[0].name).toBe("Unknown rep");
    expect(rows[0].role).toBeNull();
  });
});

describe("directReportsCsv", () => {
  const rows = buildDirectReportRows([
    input({ ownerId: "a", name: "Alpha", role: "Sales Professional", composite: 84, delta30: -0.2, activityCount: 318 }),
    input({ ownerId: "b", name: "Beta", role: null, composite: null, delta30: null, activityCount: 0 }),
  ]);

  it("writes a header and one row per rep, blanks for null values", () => {
    const csv = directReportsCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Rep,Role,Index,30-Day Change,Activities,Status");
    expect(lines[1]).toBe("Alpha,Sales Professional,84,-0.2,318,Holding");
    expect(lines[2]).toBe("Beta,,,,0,Holding");
  });

  it("escapes a name that could be read as a formula (injection safety)", () => {
    const csv = directReportsCsv(buildDirectReportRows([input({ name: "=cmd()", composite: 50 })]));
    // escapeCsvCell prefixes/ quotes dangerous leading characters.
    expect(csv.split("\n")[1].startsWith("=cmd()")).toBe(false);
  });
});
