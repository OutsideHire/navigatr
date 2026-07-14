import { describe, it, expect } from "vitest";
import {
  computeCadenceStatus,
  formatCadence,
  cadenceSignalLabel,
} from "./partnerCadence";

// Comparisons use calendarDayDelta (now's LOCAL day vs the due instant's UTC
// day). Overdue/upcoming cases use wide (10-day) margins so a runner's tz can
// never flip them; the due-today case is constructed at UTC noon (CI runs UTC).
describe("computeCadenceStatus", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("returns 'none' when there is no cadence", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: null, lastTouch: "2026-07-01T12:00:00Z", createdAt: "2026-06-01T12:00:00Z" },
      now,
    );
    expect(s.hasCadence).toBe(false);
    expect(s.state).toBe("none");
    expect(s.dueAt).toBeNull();
  });

  it("is overdue when last touch + cadence is well before now", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: 30, lastTouch: "2026-06-10T12:00:00Z", createdAt: "2026-01-01T12:00:00Z" },
      now,
    );
    // due = Jul 10; now = Jul 20 → 10 days overdue
    expect(s.state).toBe("overdue");
    expect(s.daysOverdue).toBe(10);
    expect(s.dueAt?.slice(0, 10)).toBe("2026-07-10");
  });

  it("is upcoming when last touch + cadence is well after now", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: 30, lastTouch: "2026-07-15T12:00:00Z", createdAt: "2026-01-01T12:00:00Z" },
      now,
    );
    // due = Aug 14 → future
    expect(s.state).toBe("upcoming");
    expect(s.daysUntilDue).toBeGreaterThan(0);
    expect(s.daysOverdue).toBe(0);
  });

  it("is due today when the anchor + cadence lands on today (UTC)", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: 30, lastTouch: "2026-06-20T12:00:00Z", createdAt: "2026-01-01T12:00:00Z" },
      now,
    );
    // due = Jul 20 == now's day
    expect(s.state).toBe("due-today");
    expect(s.daysOverdue).toBe(0);
    expect(s.daysUntilDue).toBe(0);
  });

  it("anchors on createdAt when never touched", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: 30, lastTouch: null, createdAt: "2026-06-01T12:00:00Z" },
      now,
    );
    // due = Jul 1; now Jul 20 → 19 overdue
    expect(s.state).toBe("overdue");
    expect(s.daysOverdue).toBe(19);
  });

  it("returns 'none' when cadence is set but there is no anchor", () => {
    const s = computeCadenceStatus(
      { followupCadenceDays: 30, lastTouch: null, createdAt: undefined },
      now,
    );
    expect(s.state).toBe("none");
    expect(s.dueAt).toBeNull();
  });
});

describe("formatCadence", () => {
  it("labels a cadence in days", () => {
    expect(formatCadence(30)).toBe("Every 30 days");
  });
  it("is empty for no cadence", () => {
    expect(formatCadence(null)).toBe("");
  });
});

describe("cadenceSignalLabel", () => {
  const base = { hasCadence: true, dueAt: "2026-07-10T12:00:00Z", daysUntilDue: 0 };
  it("labels overdue and due-today, nothing otherwise", () => {
    expect(cadenceSignalLabel({ ...base, state: "overdue", daysOverdue: 5 })).toBe("Overdue 5d");
    expect(cadenceSignalLabel({ ...base, state: "due-today", daysOverdue: 0 })).toBe("Due today");
    expect(cadenceSignalLabel({ ...base, state: "upcoming", daysOverdue: 0 })).toBeNull();
    expect(cadenceSignalLabel({ state: "none", daysOverdue: 0 })).toBeNull();
  });
});
