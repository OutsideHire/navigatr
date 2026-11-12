import { describe, it, expect } from "vitest";
import {
  GOOGLE_CLOSED_NOTE,
  SUPPRESSED_NOTE,
  stopQualityNote,
  stopQualityNotes,
} from "./stopQualityNote";

describe("stopQualityNote", () => {
  it("uses the spec's exact copy", () => {
    expect(SUPPRESSED_NOTE).toBe("Flagged by your team as out of business or home-based");
    expect(GOOGLE_CLOSED_NOTE).toBe("Google lists this business as closed");
  });

  it("says nothing for a clean business or a deal with no flags", () => {
    expect(stopQualityNote(undefined)).toBeNull();
    expect(stopQualityNote({ google_closed: false, suppressed: false })).toBeNull();
  });

  it("names Google when only Google says closed", () => {
    expect(stopQualityNote({ google_closed: true, suppressed: false })).toBe(GOOGLE_CLOSED_NOTE);
  });

  it("names the team when a teammate flagged it, even if Google also says closed", () => {
    expect(stopQualityNote({ google_closed: false, suppressed: true })).toBe(SUPPRESSED_NOTE);
    expect(stopQualityNote({ google_closed: true, suppressed: true })).toBe(SUPPRESSED_NOTE);
  });
});

describe("stopQualityNotes", () => {
  it("keeps only the deals that have something to say", () => {
    const notes = stopQualityNotes([
      { deal_id: "a", google_closed: true, suppressed: false },
      { deal_id: "b", google_closed: false, suppressed: false },
      { deal_id: "c", google_closed: false, suppressed: true },
    ]);
    expect([...notes.entries()]).toEqual([
      ["a", GOOGLE_CLOSED_NOTE],
      ["c", SUPPRESSED_NOTE],
    ]);
  });
});
