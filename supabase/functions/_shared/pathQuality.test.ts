import { describe, it, expect } from "vitest";
import {
  qualityFilterOn,
  normalizeBusinessStatus,
  normalizeSearchType,
  searchLogRow,
} from "./pathQuality";

describe("qualityFilterOn (the global switch)", () => {
  it("is on when the setting is missing or empty", () => {
    expect(qualityFilterOn(undefined)).toBe(true);
    expect(qualityFilterOn(null)).toBe(true);
    expect(qualityFilterOn("")).toBe(true);
  });

  it("turns off only for off, 0 or false, ignoring case and spaces", () => {
    for (const v of ["off", "OFF", " Off ", "0", "false", "FALSE"]) {
      expect(qualityFilterOn(v)).toBe(false);
    }
  });

  it("stays on for anything else, typos included", () => {
    for (const v of ["on", "1", "true", "of", "disabled"]) {
      expect(qualityFilterOn(v)).toBe(true);
    }
  });
});

describe("normalizeBusinessStatus", () => {
  it("keeps the three statuses Google documents", () => {
    expect(normalizeBusinessStatus("OPERATIONAL")).toBe("OPERATIONAL");
    expect(normalizeBusinessStatus("CLOSED_TEMPORARILY")).toBe("CLOSED_TEMPORARILY");
    expect(normalizeBusinessStatus("CLOSED_PERMANENTLY")).toBe("CLOSED_PERMANENTLY");
  });

  it("treats a missing or unknown value as unknown (null), never as closed", () => {
    expect(normalizeBusinessStatus(undefined)).toBeNull();
    expect(normalizeBusinessStatus("BUSINESS_STATUS_UNSPECIFIED")).toBeNull();
    expect(normalizeBusinessStatus("closed_permanently")).toBeNull();
    expect(normalizeBusinessStatus(3)).toBeNull();
  });
});

describe("normalizeSearchType", () => {
  it("keeps a known surface", () => {
    expect(normalizeSearchType("plan_area")).toBe("plan_area");
    expect(normalizeSearchType("add_stops")).toBe("add_stops");
  });

  it("labels anything else unspecified", () => {
    expect(normalizeSearchType(undefined)).toBe("unspecified");
    expect(normalizeSearchType("drop table")).toBe("unspecified");
  });
});

describe("searchLogRow", () => {
  it("maps the counts onto the R7 columns", () => {
    expect(
      searchLogRow({
        orgId: "org-1",
        userId: "user-1",
        searchType: "add_stops",
        qualityFilterOn: true,
        counts: { candidates: 40, closed_hidden: 3, home_based_hidden: 7, suppressed_hidden: 2 },
        finalStops: 25,
      }),
    ).toEqual({
      org_id: "org-1",
      user_id: "user-1",
      search_type: "add_stops",
      quality_filter_on: true,
      candidates: 40,
      removed_closed: 3,
      removed_service_area: 7,
      removed_suppressed: 2,
      final_stops: 25,
    });
  });

  it("logs zeros when the counts query failed, so the search still leaves a row", () => {
    const row = searchLogRow({
      orgId: null,
      userId: "user-1",
      searchType: "unspecified",
      qualityFilterOn: false,
      counts: null,
      finalStops: 0,
    });
    expect(row.candidates).toBe(0);
    expect(row.removed_closed).toBe(0);
    expect(row.removed_service_area).toBe(0);
    expect(row.removed_suppressed).toBe(0);
  });
});
