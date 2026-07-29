import { describe, it, expect } from "vitest";
import type { Activity, ActivityType } from "@/features/activities/mockData";
import type { Deal } from "@/features/pipeline/mockData";
import type { DateRange } from "./dateRange";
import {
  buildDealPerf, bandFromRows, repPerf, grandPerf, scopeKpis,
  rankReps, repCell, wonVsLost, REP_COLUMNS,
} from "./activityPerformance";

/**
 * Fixture ported verbatim from the linked prototype (artifact a932ebf4) so this
 * suite locks the report to the exact numbers shown in the design PDF/prototype.
 */
type ProtoRow = {
  co: string; rep: string; out: "won" | "lost" | "open"; val: number;
  calls: number; emails: number; visits: number; appts: number; days: number | null;
};
const DATA: ProtoRow[] = [
  { co: "Maple Street Barbershop", rep: "Ravi Shah", out: "won", val: 155000, calls: 3, emails: 3, visits: 1, appts: 1, days: 20 },
  { co: "Summit Legal Services", rep: "Ravi Shah", out: "won", val: 88000, calls: 2, emails: 2, visits: 1, appts: 1, days: 15 },
  { co: "Northside Veterinary Clinic", rep: "Ravi Shah", out: "won", val: 42000, calls: 2, emails: 1, visits: 1, appts: 1, days: 14 },
  { co: "Golden Gate Cafe", rep: "Ravi Shah", out: "won", val: 27500, calls: 2, emails: 2, visits: 1, appts: 0, days: 13 },
  { co: "Cascade Coffee Roasters", rep: "Ravi Shah", out: "won", val: 19000, calls: 1, emails: 2, visits: 1, appts: 0, days: 17 },
  { co: "Union Square Dry Cleaners", rep: "Remy Fox", out: "won", val: 9800, calls: 2, emails: 3, visits: 1, appts: 0, days: 18 },
  { co: "Pearl District Dental", rep: "Rosa Kim", out: "open", val: 60000, calls: 2, emails: 1, visits: 0, appts: 1, days: null },
  { co: "Riverside Auto Body", rep: "Rosa Kim", out: "open", val: 34000, calls: 2, emails: 1, visits: 1, appts: 0, days: null },
  { co: "Beacon Hill Bakery", rep: "Rosa Kim", out: "lost", val: 22000, calls: 1, emails: 1, visits: 0, appts: 1, days: 26 },
  { co: "Clover Fitness Studio", rep: "Rosa Kim", out: "lost", val: 15000, calls: 1, emails: 1, visits: 0, appts: 0, days: 31 },
  { co: "Lakeview Hardware", rep: "Riley Cole", out: "open", val: 48000, calls: 1, emails: 1, visits: 1, appts: 0, days: null },
  { co: "Bridgeport Florist", rep: "Riley Cole", out: "open", val: 12000, calls: 1, emails: 1, visits: 0, appts: 0, days: null },
  { co: "Oakwood Tailors", rep: "Riley Cole", out: "lost", val: 18000, calls: 1, emails: 0, visits: 1, appts: 0, days: 24 },
  { co: "Harborview Optical", rep: "Riley Cole", out: "open", val: 26000, calls: 1, emails: 0, visits: 0, appts: 0, days: null },
  { co: "Sunset Nail Bar", rep: "Riley Cole", out: "lost", val: 8000, calls: 0, emails: 1, visits: 0, appts: 0, days: 29 },
  { co: "Ironclad Storage", rep: "Remy Fox", out: "open", val: 31000, calls: 1, emails: 0, visits: 0, appts: 0, days: null },
  { co: "Meridian Tax Group", rep: "Remy Fox", out: "lost", val: 14000, calls: 1, emails: 0, visits: 0, appts: 0, days: 22 },
  { co: "Copper Kettle Diner", rep: "Remy Fox", out: "open", val: 9000, calls: 1, emails: 0, visits: 0, appts: 1, days: null },
  { co: "Grandview Print Shop", rep: "Robert Patton", out: "open", val: 16000, calls: 1, emails: 0, visits: 2, appts: 0, days: null },
];

const OCCURRED = "2026-01-01T00:00:00.000Z";
const RANGE: DateRange = { fromIso: null, toIso: "2999-01-01T00:00:00.000Z" };
const STAGE = { won: "won", lost: "lost", open: "qualified" } as const;

function buildFixture(): { activities: Activity[]; deals: Deal[] } {
  const deals: Deal[] = [];
  const activities: Activity[] = [];
  let aid = 0;
  DATA.forEach((r, i) => {
    const id = `deal-${i}`;
    deals.push({
      id,
      companyName: r.co,
      owner_id: r.rep,
      stage: STAGE[r.out],
      valueCents: r.val * 100,
      timeToWinCalendarDays: r.out === "won" ? r.days : null,
      timeToLostCalendarDays: r.out === "lost" ? r.days : null,
    } as unknown as Deal);
    const push = (type: ActivityType, n: number) => {
      for (let k = 0; k < n; k++) {
        activities.push({ id: `a-${aid++}`, dealId: id, type, occurredAt: OCCURRED } as unknown as Activity);
      }
    };
    push("call", r.calls);
    push("email", r.emails);
    push("drop_in", r.visits);
    push("appointment", r.appts);
  });
  return { activities, deals };
}

const { activities, deals } = buildFixture();
const rows = buildDealPerf(activities, deals, RANGE);
const reps = repPerf(rows);
const grand = grandPerf(reps);

describe("buildDealPerf + band", () => {
  it("produces one row per deal with windowed counts + close days", () => {
    expect(rows).toHaveLength(19);
    const maple = rows.find((r) => r.companyName === "Maple Street Barbershop")!;
    expect(maple.counts.total).toBe(8);
    expect(maple.outcome).toBe("won");
    expect(maple.days).toBe(20);
    const pearl = rows.find((r) => r.companyName === "Pearl District Dental")!;
    expect(pearl.outcome).toBe("open");
    expect(pearl.days).toBeNull();
  });

  it("bands activities by outcome and totals 63", () => {
    expect(bandFromRows(rows)).toEqual({ won: 34, open: 20, lost: 9, total: 63 });
  });
});

describe("grand totals", () => {
  it("matches the prototype aggregates", () => {
    expect(grand.act).toBe(63);
    expect(grand.wins).toBe(6);
    expect(grand.losses).toBe(5);
    expect(grand.open).toBe(8);
    expect(grand.repCount).toBe(5);
    expect(grand.companyCount).toBe(19);
    expect(grand.wonVal).toBe(341300 * 100);
    expect(grand.openVal).toBe(236000 * 100);
    expect(grand.lostVal).toBe(77000 * 100);
  });
});

describe("scopeKpis parity with the prototype/PDF screenshots", () => {
  const byLabel = (scope: "all" | "won" | "lost" | "open") =>
    Object.fromEntries(scopeKpis(grand, rows, scope).map((c) => [c.label, c]));

  it("Won band", () => {
    const k = byLabel("won");
    expect(k["Revenue won"]!.value).toBe("$341.3K");
    expect(k["Touches per win"]!.value).toBe("10.5");
    expect(k["On winners only"]!.value).toBe("5.7");
    expect(k["Days to close"]!.value).toBe("16.2");
    expect(k["Effort not converted"]!.value).toBe("29");
    expect(k["Effort not converted"]!.sub).toBe("46% of all activity");
    expect(k["Effort not converted"]!.flag).toBe(true);
  });

  it("Open band", () => {
    const k = byLabel("open");
    expect(k["Open pipeline"]!.value).toBe("$236K");
    expect(k["Touches so far"]!.value).toBe("20");
    expect(k["Touches so far"]!.sub).toBe("2.5 per company");
    expect(k["Under the win median"]!.value).toBe("8");
    expect(k["Projected wins"]!.value).toBe("4.4");
  });

  it("Lost band", () => {
    const k = byLabel("lost");
    expect(k["Revenue lost"]!.value).toBe("$77K");
    expect(k["Touches per loss"]!.value).toBe("1.8");
    expect(k["Days before loss"]!.value).toBe("26.4");
    expect(k["Win rate"]!.value).toBe("55%");
  });

  it("All band", () => {
    const k = byLabel("all");
    expect(k["Total activity"]!.value).toBe("63");
    expect(k["Total activity"]!.sub).toBe("5 reps, 19 companies");
    expect(k["Deals won"]!.value).toBe("6");
    expect(k["Win rate"]!.value).toBe("55%");
  });
});

describe("rankReps + badges", () => {
  it("won scope: Ravi leads on value; Remy trails effort vs outcome", () => {
    const ranked = rankReps(reps, "won", "value");
    expect(ranked[0]!.rep.ownerId).toBe("Ravi Shah");
    expect(repCell(ranked[0]!.rep, "wins")).toBe("5");
    expect(repCell(ranked[0]!.rep, "perWin")).toBe("5.6"); // 28 activity / 5 wins
    expect(repCell(ranked[0]!.rep, "wonVal")).toBe("$331.5K");
  });

  it("open scope: columns are companies/activity/touches-per-co/pipeline", () => {
    expect(REP_COLUMNS.open.map((c) => c.label)).toEqual(["Companies", "Activity", "Touches / co", "Pipeline"]);
    const ranked = rankReps(reps, "open", "value");
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("no badges in the all scope", () => {
    expect(rankReps(reps, "all", "activity").every((r) => r.badge === null)).toBe(true);
  });
});

describe("wonVsLost compare", () => {
  it("returns average per-deal mix for won and lost", () => {
    const c = wonVsLost(rows);
    // Won calls: (3+2+2+2+1+2)/6 = 2.0
    expect(c.won.calls).toBeCloseTo(2.0, 5);
    expect(c.lost.calls).toBeCloseTo(0.8, 5); // (1+1+1+0+1)/5
  });
});
