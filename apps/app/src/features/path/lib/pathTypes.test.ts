import { describe, it, expect } from "vitest";
import { rowToPath, rowToStop, type PathRow, type PathStopRow } from "./pathTypes";

describe("pathTypes mappers", () => {
  it("maps a path row to camelCase with a stop count", () => {
    const row: PathRow = {
      id: "p1", path_date: "2026-06-03", origin_label: "Current location",
      origin_lat: 30.27, origin_lng: -97.74, status: "planned",
    };
    const p = rowToPath(row, 8);
    expect(p).toEqual({
      id: "p1", date: "2026-06-03", originLabel: "Current location",
      originLat: 30.27, originLng: -97.74, status: "planned", stopCount: 8,
    });
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
