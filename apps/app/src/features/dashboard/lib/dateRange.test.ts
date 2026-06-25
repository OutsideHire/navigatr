import { describe, it, expect } from "vitest";
import { resolveRange, withinRange, rangeLabel, RANGE_OPTIONS } from "./dateRange";

const NOW = new Date("2026-06-25T12:00:00.000Z");

describe("resolveRange", () => {
  it("'all' has no lower bound", () => {
    const r = resolveRange("all", NOW);
    expect(r.fromIso).toBeNull();
    expect(r.toIso).toBe(NOW.toISOString());
  });

  it("'7d' sets fromIso 7 days before now", () => {
    const r = resolveRange("7d", NOW);
    expect(r.fromIso).toBe("2026-06-18T12:00:00.000Z");
    expect(r.toIso).toBe(NOW.toISOString());
  });

  it("'30d' and '90d' offset by 30 and 90 days", () => {
    expect(resolveRange("30d", NOW).fromIso).toBe("2026-05-26T12:00:00.000Z");
    expect(resolveRange("90d", NOW).fromIso).toBe("2026-03-27T12:00:00.000Z");
  });
});

describe("withinRange", () => {
  const r = resolveRange("30d", NOW); // [2026-05-26, 2026-06-25]

  it("accepts a timestamp inside the window", () => {
    expect(withinRange("2026-06-10T00:00:00.000Z", r)).toBe(true);
  });

  it("accepts the boundaries (inclusive)", () => {
    expect(withinRange(r.fromIso!, r)).toBe(true);
    expect(withinRange(r.toIso, r)).toBe(true);
  });

  it("rejects before the lower bound", () => {
    expect(withinRange("2026-05-25T23:59:59.000Z", r)).toBe(false);
  });

  it("rejects after the upper bound (future)", () => {
    expect(withinRange("2026-07-01T00:00:00.000Z", r)).toBe(false);
  });

  it("all-time accepts anything up to now, rejects the future", () => {
    const all = resolveRange("all", NOW);
    expect(withinRange("2000-01-01T00:00:00.000Z", all)).toBe(true);
    expect(withinRange("2030-01-01T00:00:00.000Z", all)).toBe(false);
  });
});

describe("rangeLabel", () => {
  it("maps each key to its option label", () => {
    for (const o of RANGE_OPTIONS) expect(rangeLabel(o.key)).toBe(o.label);
  });
});
