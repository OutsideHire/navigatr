import { describe, it, expect } from "vitest";
import { rowToPath, rowToStop, type PathRow, type PathStopRow } from "./pathTypes";

describe("pathTypes mappers", () => {
  it("maps a path row to camelCase with a stop count", () => {
    const row: PathRow = {
      id: "p1", path_date: "2026-06-03", name: "Downtown · Wed Jun 3",
      origin_label: "Current location",
      origin_lat: 30.27, origin_lng: -97.74, status: "planned",
      reminder_at: "2026-06-03T13:30:00.000Z",
    };
    const p = rowToPath(row, 8);
    expect(p).toEqual({
      id: "p1", date: "2026-06-03", name: "Downtown · Wed Jun 3",
      originLabel: "Current location",
      originLat: 30.27, originLng: -97.74, status: "planned",
      reminderAt: "2026-06-03T13:30:00.000Z", stopCount: 8,
    });
  });

  it("defaults name + reminderAt to null when the row omits them", () => {
    const row: PathRow = {
      id: "p2", path_date: "2026-06-04", origin_label: null,
      origin_lat: null, origin_lng: null, status: "planned",
    };
    const p = rowToPath(row, 0);
    expect(p.name).toBeNull();
    expect(p.reminderAt).toBeNull();
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
