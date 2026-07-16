import { describe, it, expect } from "vitest";
import {
  median,
  mean,
  percentile,
  stddev,
  computeActivityToWin,
  repComparisonBand,
  leadSourceBucket,
  type AwFilters,
} from "./activityToWin";
import type { Deal } from "@/features/pipeline/mockData";
import { resolveRange } from "./dateRange";

// All-time window anchored at a fixed "now" so closedWonAt comparisons are stable.
const NOW = new Date("2026-07-16T00:00:00.000Z");
const ALL = resolveRange("all", NOW);

/** Won-deal factory: fills required Deal fields; snapshot fields via overrides. */
function won(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id,
    companyName: o.companyName ?? o.id,
    contactName: "C",
    phone: "",
    email: "",
    valueCents: o.valueCents ?? 50_000_00,
    stage: o.stage ?? "won",
    probability: 100,
    lastActivity: "2026-06-01T00:00:00.000Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "1-9",
    leadSource: o.leadSource ?? "",
    updatedAt: "2026-06-01T00:00:00.000Z",
    owner_id: o.owner_id ?? "u1",
    lostReasonCategory: null,
    lostReasonNotes: null,
    closedWonAt: o.closedWonAt ?? "2026-06-15T00:00:00.000Z",
    firstActivityAt: o.firstActivityAt ?? "2026-06-01T00:00:00.000Z",
    activityCountTotal: o.activityCountTotal,
    activityCountCall: o.activityCountCall,
    activityCountEmail: o.activityCountEmail,
    activityCountDropin: o.activityCountDropin,
    activityCountAppointment: o.activityCountAppointment,
    timeToWinBusinessDays: o.timeToWinBusinessDays,
    timeToWinCalendarDays: o.timeToWinCalendarDays,
    industry: o.industry ?? null,
  };
}

describe("median", () => {
  it("returns null for empty", () => expect(median([])).toBeNull());
  it("odd length → middle", () => expect(median([3, 1, 2])).toBe(2));
  it("even length → average of two middles", () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it("single", () => expect(median([7])).toBe(7));
});

describe("mean", () => {
  it("null for empty", () => expect(mean([])).toBeNull());
  it("averages", () => expect(mean([2, 4])).toBe(3));
});

describe("percentile (linear interpolation)", () => {
  it("null for empty", () => expect(percentile([], 0.25)).toBeNull());
  it("single value", () => expect(percentile([5], 0.25)).toBe(5));
  it("p50 == median (odd)", () => expect(percentile([1, 2, 3], 0.5)).toBe(2));
  it("p25 / p75 on 1..5", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("stddev", () => {
  it("0 for <2 values", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });
  it("0 when all equal", () => expect(stddev([4, 4, 4])).toBe(0));
  it("population sd", () => expect(stddev([2, 4, 6])).toBeCloseTo(1.632993, 5));
});

describe("leadSourceBucket", () => {
  it("empty / whitespace / null → Other", () => {
    expect(leadSourceBucket("")).toBe("Other");
    expect(leadSourceBucket("   ")).toBe("Other");
    expect(leadSourceBucket(null)).toBe("Other");
    expect(leadSourceBucket(undefined)).toBe("Other");
  });
  it("trims real values", () => expect(leadSourceBucket("  Partner referral  ")).toBe("Partner referral"));
});

describe("computeActivityToWin", () => {
  it("only counts currently-won deals with an in-window close snapshot", () => {
    const deals = [
      won({ id: "w", activityCountTotal: 4, timeToWinBusinessDays: 5, timeToWinCalendarDays: 7 }),
      won({ id: "open", stage: "qualified", closedWonAt: null, activityCountTotal: 9 }),
      won({ id: "reopened", stage: "contacted", activityCountTotal: 9 }), // was won, now reopened → excluded
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0]!.dealId).toBe("w");
  });

  it("excludes zero-activity wins from Component A and counts them as unmeasured", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 5 }),
      won({ id: "b", activityCountTotal: 6, timeToWinBusinessDays: 7 }),
      won({ id: "c", activityCountTotal: 8, timeToWinBusinessDays: 9 }),
      won({ id: "z", activityCountTotal: 0, timeToWinBusinessDays: null }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.unmeasuredWins).toBe(1);
    expect(agg.sampleSize).toBe(3);
    expect(agg.medianTotal).toBe(6);
    expect(agg.meanTotal).toBe(6);
    expect(agg.medianBusinessDays).toBe(7);
  });

  it("flags insufficient data below the 3-deal minimum but still computes", () => {
    const two = computeActivityToWin(
      [
        won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 5 }),
        won({ id: "b", activityCountTotal: 6, timeToWinBusinessDays: 7 }),
      ],
      { range: ALL },
    );
    expect(two.sampleSize).toBe(2);
    expect(two.insufficientData).toBe(true);
    expect(two.medianTotal).toBe(5);

    const three = computeActivityToWin(
      [
        won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 5 }),
        won({ id: "b", activityCountTotal: 6, timeToWinBusinessDays: 7 }),
        won({ id: "c", activityCountTotal: 8, timeToWinBusinessDays: 9 }),
      ],
      { range: ALL },
    );
    expect(three.insufficientData).toBe(false);
  });

  it("computes per-type medians over the measured cohort", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 6, activityCountCall: 3, activityCountEmail: 2, activityCountDropin: 1, activityCountAppointment: 0, timeToWinBusinessDays: 4 }),
      won({ id: "b", activityCountTotal: 9, activityCountCall: 5, activityCountEmail: 2, activityCountDropin: 2, activityCountAppointment: 0, timeToWinBusinessDays: 6 }),
      won({ id: "c", activityCountTotal: 12, activityCountCall: 7, activityCountEmail: 3, activityCountDropin: 2, activityCountAppointment: 0, timeToWinBusinessDays: 8 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.medianByType.call).toBe(5);
    expect(agg.medianByType.email).toBe(2);
    expect(agg.medianByType.dropin).toBe(2);
    expect(agg.medianByType.appointment).toBe(0);
  });

  it("computes the business-days IQR (p25/p75) over the timing cohort", () => {
    const deals = [1, 2, 3, 4, 5].map((n) =>
      won({ id: `d${n}`, activityCountTotal: 3, timeToWinBusinessDays: n }),
    );
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.medianBusinessDays).toBe(3);
    expect(agg.p25BusinessDays).toBe(2);
    expect(agg.p75BusinessDays).toBe(4);
  });

  it("excludes null-timing wins from Component B but keeps them in Component A", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 5 }),
      won({ id: "b", activityCountTotal: 6, timeToWinBusinessDays: null }), // logged activity, no first_activity timing
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.sampleSize).toBe(2);
    expect(agg.timingSampleSize).toBe(1);
    expect(agg.medianBusinessDays).toBe(5);
  });

  it("flags an outlier deal >2 SD from the cohort median", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 4, timeToWinBusinessDays: 4 }),
      won({ id: "b", activityCountTotal: 5, timeToWinBusinessDays: 5 }),
      won({ id: "c", activityCountTotal: 5, timeToWinBusinessDays: 5 }),
      won({ id: "d", activityCountTotal: 6, timeToWinBusinessDays: 6 }),
      won({ id: "big", activityCountTotal: 60, timeToWinBusinessDays: 90 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    const outliers = agg.rows.filter((r) => r.isOutlier).map((r) => r.dealId);
    expect(outliers).toEqual(["big"]);
  });

  it("does not flag outliers when there is no spread", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 5, timeToWinBusinessDays: 5 }),
      won({ id: "b", activityCountTotal: 5, timeToWinBusinessDays: 5 }),
      won({ id: "c", activityCountTotal: 5, timeToWinBusinessDays: 5 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.rows.every((r) => !r.isOutlier)).toBe(true);
  });

  it("never flags a zero-activity (unmeasured) win as a Component-A outlier", () => {
    // z's total (0) is far from the measured cohort median, but it is excluded
    // from Component A, so it must not receive an activity-volume outlier badge.
    const deals = [
      won({ id: "a", activityCountTotal: 8, timeToWinBusinessDays: 8 }),
      won({ id: "b", activityCountTotal: 9, timeToWinBusinessDays: 9 }),
      won({ id: "c", activityCountTotal: 10, timeToWinBusinessDays: 10 }),
      won({ id: "d", activityCountTotal: 11, timeToWinBusinessDays: 11 }),
      won({ id: "e", activityCountTotal: 12, timeToWinBusinessDays: 12 }),
      won({ id: "z", activityCountTotal: 0, timeToWinBusinessDays: null }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.rows.find((r) => r.dealId === "z")!.isOutlier).toBe(false);
  });

  it("computes median calendar days over the calendar-days cohort", () => {
    const deals = [
      won({ id: "a", activityCountTotal: 3, timeToWinBusinessDays: 3, timeToWinCalendarDays: 4 }),
      won({ id: "b", activityCountTotal: 3, timeToWinBusinessDays: 5, timeToWinCalendarDays: 8 }),
      won({ id: "c", activityCountTotal: 3, timeToWinBusinessDays: 7, timeToWinCalendarDays: 10 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    expect(agg.medianCalendarDays).toBe(8);
  });

  it("filters by owner, source (incl Other), industry, and value band", () => {
    const deals = [
      won({ id: "u1a", owner_id: "u1", leadSource: "Cold outreach", industry: "retail", valueCents: 10_000_00, activityCountTotal: 3, timeToWinBusinessDays: 3 }),
      won({ id: "u2a", owner_id: "u2", leadSource: "Cold outreach", industry: "retail", valueCents: 10_000_00, activityCountTotal: 9, timeToWinBusinessDays: 9 }),
      won({ id: "u1-other", owner_id: "u1", leadSource: "", industry: "food", valueCents: 200_000_00, activityCountTotal: 5, timeToWinBusinessDays: 5 }),
    ];
    const byOwner = computeActivityToWin(deals, { range: ALL, filters: { ownerId: "u1" } });
    expect(byOwner.rows.map((r) => r.dealId).sort()).toEqual(["u1-other", "u1a"]);

    const byOther = computeActivityToWin(deals, { range: ALL, filters: { source: "Other" } });
    expect(byOther.rows.map((r) => r.dealId)).toEqual(["u1-other"]);

    const byIndustry = computeActivityToWin(deals, { range: ALL, filters: { industry: "retail" } });
    expect(byIndustry.rows.map((r) => r.dealId).sort()).toEqual(["u1a", "u2a"]);

    const midBand: AwFilters = { valueBand: { minCents: 25_000_00, maxCents: 100_000_00 } };
    const byBand = computeActivityToWin(deals, { range: ALL, filters: midBand });
    expect(byBand.rows).toHaveLength(0); // 10k below, 200k above the [25k,100k) band
  });

  it("value band boundary is half-open [min, max)", () => {
    const deals = [
      won({ id: "exactly25k", valueCents: 25_000_00, activityCountTotal: 3, timeToWinBusinessDays: 3 }),
      won({ id: "exactly100k", valueCents: 100_000_00, activityCountTotal: 3, timeToWinBusinessDays: 3 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL, filters: { valueBand: { minCents: 25_000_00, maxCents: 100_000_00 } } });
    expect(agg.rows.map((r) => r.dealId)).toEqual(["exactly25k"]); // 25k included, 100k excluded
  });

  it("windows by closedWonAt", () => {
    const deals = [
      won({ id: "recent", closedWonAt: "2026-07-10T00:00:00.000Z", activityCountTotal: 3, timeToWinBusinessDays: 3 }),
      won({ id: "old", closedWonAt: "2026-01-10T00:00:00.000Z", activityCountTotal: 3, timeToWinBusinessDays: 3 }),
    ];
    const last30 = computeActivityToWin(deals, { range: resolveRange("30d", NOW) });
    expect(last30.rows.map((r) => r.dealId)).toEqual(["recent"]);
  });

  it("empty input → zeros / nulls / insufficient", () => {
    const agg = computeActivityToWin([], { range: ALL });
    expect(agg.sampleSize).toBe(0);
    expect(agg.insufficientData).toBe(true);
    expect(agg.medianTotal).toBeNull();
    expect(agg.medianBusinessDays).toBeNull();
    expect(agg.rows).toHaveLength(0);
  });
});

describe("repComparisonBand", () => {
  it("ranges per-rep medians across reps", () => {
    const deals = [
      // rep u1: totals [4,6] → median 5; days [4,6] → 5
      won({ id: "a", owner_id: "u1", activityCountTotal: 4, timeToWinBusinessDays: 4 }),
      won({ id: "b", owner_id: "u1", activityCountTotal: 6, timeToWinBusinessDays: 6 }),
      // rep u2: totals [10,12] → median 11; days [30,40] → 35
      won({ id: "c", owner_id: "u2", activityCountTotal: 10, timeToWinBusinessDays: 30 }),
      won({ id: "d", owner_id: "u2", activityCountTotal: 12, timeToWinBusinessDays: 40 }),
    ];
    const agg = computeActivityToWin(deals, { range: ALL });
    const band = repComparisonBand(agg.rows);
    expect(band.repCount).toBe(2);
    expect(band.touches).toEqual({ min: 5, max: 11 });
    expect(band.businessDays).toEqual({ min: 5, max: 35 });
  });

  it("returns null bands when only one rep has a value", () => {
    const deals = [
      won({ id: "a", owner_id: "u1", activityCountTotal: 4, timeToWinBusinessDays: 4 }),
      won({ id: "b", owner_id: "u1", activityCountTotal: 6, timeToWinBusinessDays: 6 }),
    ];
    const band = repComparisonBand(computeActivityToWin(deals, { range: ALL }).rows);
    expect(band.repCount).toBe(1);
    expect(band.touches).toBeNull();
    expect(band.businessDays).toBeNull();
  });
});
