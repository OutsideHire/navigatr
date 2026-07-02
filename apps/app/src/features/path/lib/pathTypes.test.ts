import { describe, it, expect } from "vitest";
import {
  rowToPath,
  rowToStop,
  firstPendingIndex,
  pathLanding,
  type PathRow,
  type PathStopRow,
  type StopLike,
} from "./pathTypes";

describe("pathTypes mappers", () => {
  it("maps a path row to camelCase with a stop count", () => {
    const row: PathRow = {
      id: "p1", path_date: "2026-06-03", name: "Downtown · Wed Jun 3",
      origin_label: "Current location",
      origin_lat: 30.27, origin_lng: -97.74, status: "planned",
      reminder_at: "2026-06-03T13:30:00.000Z",
      started_at: "2026-06-03T14:00:00.000Z",
    };
    const p = rowToPath(row, 8);
    expect(p).toEqual({
      id: "p1", date: "2026-06-03", name: "Downtown · Wed Jun 3",
      originLabel: "Current location",
      originLat: 30.27, originLng: -97.74, status: "planned",
      reminderAt: "2026-06-03T13:30:00.000Z",
      startedAt: "2026-06-03T14:00:00.000Z", stopCount: 8,
    });
  });

  it("defaults name + reminderAt + startedAt to null when the row omits them", () => {
    const row: PathRow = {
      id: "p2", path_date: "2026-06-04", origin_label: null,
      origin_lat: null, origin_lng: null, status: "planned",
    };
    const p = rowToPath(row, 0);
    expect(p.name).toBeNull();
    expect(p.reminderAt).toBeNull();
    expect(p.startedAt).toBeNull();
  });

  it("maps a stop row to camelCase preserving the display snapshot + state", () => {
    const row: PathStopRow = {
      id: "s1", path_id: "p1", prospect_id: "pr1", name: "Uratex Showroom",
      address: "123 Rd", phone: "+15551234567", lat: 30.2, lng: -97.7, category: "manufacturing_wholesale",
      primary_type: "manufacturer", position: 0, status: "visited",
      disposition: "met_dm", deal_created: true, added_at: "2026-06-03T01:00:00Z",
    };
    const s = rowToStop(row);
    expect(s).toEqual({
      id: "s1", pathId: "p1", prospectId: "pr1", name: "Uratex Showroom",
      address: "123 Rd", phone: "+15551234567", lat: 30.2, lng: -97.7, category: "manufacturing_wholesale",
      primaryType: "manufacturer", position: 0, status: "visited",
      disposition: "met_dm", dealCreated: true, addedAt: "2026-06-03T01:00:00Z",
    });
  });
});

describe("firstPendingIndex", () => {
  const s = (position: number, status: StopLike["status"]): StopLike => ({ position, status });

  it("returns 0 when every stop is pending", () => {
    expect(firstPendingIndex([s(0, "pending"), s(1, "pending"), s(2, "pending")])).toBe(0);
  });

  it("returns the index of the first pending stop when earlier stops are done", () => {
    expect(firstPendingIndex([s(0, "visited"), s(1, "skipped"), s(2, "pending"), s(3, "pending")])).toBe(2);
  });

  it("returns -1 when no stop is pending", () => {
    expect(firstPendingIndex([s(0, "visited"), s(1, "skipped")])).toBe(-1);
  });

  it("returns -1 for an empty stop list", () => {
    expect(firstPendingIndex([])).toBe(-1);
  });

  it("indexes into the position-sorted order, not input order", () => {
    // Input is out of order; the first pending by position is position 1 → index 1.
    expect(firstPendingIndex([s(2, "pending"), s(0, "visited"), s(1, "pending")])).toBe(1);
  });
});

describe("pathLanding", () => {
  it("lands on entry when the path has not started (startedAt null)", () => {
    expect(pathLanding({ startedAt: null, hasPendingStops: true })).toBe("entry");
    expect(pathLanding({ startedAt: null, hasPendingStops: false })).toBe("entry");
    expect(pathLanding({ startedAt: undefined, hasPendingStops: true })).toBe("entry");
  });

  it("lands on run when started and there are pending stops", () => {
    expect(pathLanding({ startedAt: "2026-07-02T10:00:00Z", hasPendingStops: true })).toBe("run");
  });

  it("lands on summary when started and no pending stops remain", () => {
    expect(pathLanding({ startedAt: "2026-07-02T10:00:00Z", hasPendingStops: false })).toBe("summary");
  });
});
