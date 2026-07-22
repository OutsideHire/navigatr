import { describe, it, expect } from "vitest";
import type { ActivityToWinRow } from "./activityToWin";
import {
  activitiesReportKpis,
  salespersonRanking,
  avgActivitiesByType,
  activitiesReportInsights,
  sortReportRows,
} from "./activitiesReport";

function mk(o: Partial<ActivityToWinRow> & { dealId: string; companyName: string }): ActivityToWinRow {
  return {
    ownerId: "u1",
    source: "Cold",
    valueCents: 5_000_000,
    closedWonAt: "2026-06-01T00:00:00.000Z",
    firstActivityAt: "2026-05-20T00:00:00.000Z",
    counts: { total: 5, call: 2, email: 1, dropin: 2, appointment: 0 },
    businessDays: 8,
    calendarDays: 11,
    isOutlier: false,
    ...o,
  };
}

const ROWS: ActivityToWinRow[] = [
  mk({ dealId: "d1", companyName: "Retail Plus", ownerId: "u1", valueCents: 10_000_000,
       counts: { total: 21, call: 10, email: 6, dropin: 4, appointment: 1 }, businessDays: 40 }),
  mk({ dealId: "d2", companyName: "Global Finance", ownerId: "u2", valueCents: 25_000_000,
       counts: { total: 47, call: 20, email: 15, dropin: 8, appointment: 4 }, businessDays: 60 }),
  mk({ dealId: "d3", companyName: "Acme Co", ownerId: "u1", valueCents: 4_000_000,
       counts: { total: 30, call: 12, email: 10, dropin: 6, appointment: 2 }, businessDays: 20 }),
];

describe("activitiesReportKpis", () => {
  it("totals deals and value, and averages activities and days", () => {
    const k = activitiesReportKpis(ROWS);
    expect(k.dealsClosed).toBe(3);
    expect(k.totalValueCents).toBe(39_000_000);
    expect(k.avgActivities).toBeCloseTo((21 + 47 + 30) / 3, 5);
    expect(k.avgBusinessDays).toBeCloseTo((40 + 60 + 20) / 3, 5);
  });

  it("picks the most efficient deal (fewest activities, >0)", () => {
    const k = activitiesReportKpis(ROWS);
    expect(k.mostEfficient).toEqual({ company: "Retail Plus", count: 21 });
  });

  it("excludes zero-activity deals from most efficient", () => {
    const rows = [mk({ dealId: "z", companyName: "Zero", counts: { total: 0, call: 0, email: 0, dropin: 0, appointment: 0 } }), ...ROWS];
    expect(activitiesReportKpis(rows).mostEfficient).toEqual({ company: "Retail Plus", count: 21 });
  });

  it("picks the highest-value deal", () => {
    const k = activitiesReportKpis(ROWS);
    expect(k.highestValue).toEqual({ company: "Global Finance", valueCents: 25_000_000 });
  });

  it("averages days only over deals that have a value", () => {
    const rows = [mk({ dealId: "n", companyName: "NoDays", businessDays: null }), ...ROWS];
    expect(activitiesReportKpis(rows).avgBusinessDays).toBeCloseTo((40 + 60 + 20) / 3, 5);
  });

  it("returns null averages and null picks for an empty set", () => {
    const k = activitiesReportKpis([]);
    expect(k).toEqual({
      dealsClosed: 0, totalValueCents: 0, avgActivities: null,
      avgBusinessDays: null, mostEfficient: null, highestValue: null,
    });
  });
});

describe("salespersonRanking", () => {
  it("groups by owner, sums revenue, and sorts by revenue desc", () => {
    const r = salespersonRanking(ROWS);
    expect(r.map((x) => x.ownerId)).toEqual(["u2", "u1"]); // u2 25M > u1 14M
    const u1 = r.find((x) => x.ownerId === "u1")!;
    expect(u1.dealsClosed).toBe(2);
    expect(u1.totalRevenueCents).toBe(14_000_000);
    expect(u1.avgDealCents).toBe(7_000_000);
    expect(u1.avgActivities).toBeCloseTo((21 + 30) / 2, 5);
    expect(u1.avgBusinessDays).toBeCloseTo((40 + 20) / 2, 5);
  });

  it("maps a null owner to a null-owner row", () => {
    const r = salespersonRanking([mk({ dealId: "x", companyName: "X", ownerId: null })]);
    expect(r[0]!.ownerId).toBeNull();
    expect(r[0]!.dealsClosed).toBe(1);
  });
});

describe("avgActivitiesByType", () => {
  it("averages each type across all rows", () => {
    const t = avgActivitiesByType(ROWS);
    expect(t.call).toBeCloseTo((10 + 20 + 12) / 3, 5);
    expect(t.email).toBeCloseTo((6 + 15 + 10) / 3, 5);
    expect(t.dropin).toBeCloseTo((4 + 8 + 6) / 3, 5);
    expect(t.appointment).toBeCloseTo((1 + 4 + 2) / 3, 5);
  });

  it("returns null for every type when empty", () => {
    expect(avgActivitiesByType([])).toEqual({ call: null, email: null, dropin: null, appointment: null });
  });
});

describe("sortReportRows", () => {
  it("sorts by value ascending and descending", () => {
    const asc = sortReportRows(ROWS, "value", "asc").map((r) => r.companyName);
    expect(asc).toEqual(["Acme Co", "Retail Plus", "Global Finance"]);
    const desc = sortReportRows(ROWS, "value", "desc").map((r) => r.companyName);
    expect(desc).toEqual(["Global Finance", "Retail Plus", "Acme Co"]);
  });

  it("sorts by company name (ascending A to Z)", () => {
    expect(sortReportRows(ROWS, "company", "asc").map((r) => r.companyName)).toEqual(["Acme Co", "Global Finance", "Retail Plus"]);
  });

  it("sorts by total touches and by a single activity type", () => {
    expect(sortReportRows(ROWS, "total", "desc").map((r) => r.companyName)).toEqual(["Global Finance", "Acme Co", "Retail Plus"]);
    expect(sortReportRows(ROWS, "call", "asc").map((r) => r.companyName)).toEqual(["Retail Plus", "Acme Co", "Global Finance"]);
  });

  it("puts null-day rows last on ascending sorts", () => {
    const rows = [mk({ dealId: "n", companyName: "NoDays", businessDays: null }), ...ROWS];
    expect(sortReportRows(rows, "days", "asc").map((r) => r.companyName).at(-1)).toBe("NoDays");
  });

  it("does not mutate the input array", () => {
    const before = ROWS.map((r) => r.companyName);
    sortReportRows(ROWS, "value", "desc");
    expect(ROWS.map((r) => r.companyName)).toEqual(before);
  });
});

describe("activitiesReportInsights", () => {
  it("returns an empty list for no rows", () => {
    expect(activitiesReportInsights([], [])).toEqual([]);
  });

  it("summarizes averages, top type, efficiency, and intensity", () => {
    const out = activitiesReportInsights(ROWS, salespersonRanking(ROWS));
    expect(out.some((s) => /average/i.test(s) && /activities/i.test(s))).toBe(true);
    expect(out.some((s) => /Calls/.test(s))).toBe(true); // calls are the most-used type
    expect(out.some((s) => /Retail Plus/.test(s) && /efficient/i.test(s))).toBe(true);
    expect(out.some((s) => /Global Finance/.test(s))).toBe(true); // most intensive (47)
  });

  it("adds a top-performer line when a name resolver is given", () => {
    const out = activitiesReportInsights(ROWS, salespersonRanking(ROWS), (id) => (id === "u2" ? "Michael Chen" : "Sarah"));
    expect(out.some((s) => /Michael Chen/.test(s) && /revenue/i.test(s))).toBe(true);
  });
});
