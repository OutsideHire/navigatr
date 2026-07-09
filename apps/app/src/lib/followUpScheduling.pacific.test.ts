// Bug 2 regression — formatFollowUpDate at UTC+12.
//
// Runs in Pacific/Auckland (UTC+12, no DST in July). The Activities-row text
// ("Due …") and the follow-up toast both format the stored follow-up via
// formatFollowUpDate. A follow-up at noon UTC of Jul 9 is 2026-07-10T00:00
// local — rendered in local time (the pre-fix bug) it read "Fri, Jul 10", a
// day LATE, disagreeing with dayHeading and the notification bell (both UTC).
// The correct display is the stored UTC calendar day, "Thu, Jul 9". This
// assertion FAILS on the pre-fix code (it returns "Fri, Jul 10").
process.env.TZ = "Pacific/Auckland";

import { describe, it, expect } from "vitest";
import { formatFollowUpDate } from "./followUpScheduling";
import { dateOnlyToNoonUtcIso, toUtcDateOnly } from "./calendarDate";

describe("formatFollowUpDate — Pacific (UTC+12) renders the stored UTC day", () => {
  it("renders a noon-UTC Jul-9 follow-up as 'Thu, Jul 9', not a day late", () => {
    expect(formatFollowUpDate(dateOnlyToNoonUtcIso("2026-07-09"))).toBe("Thu, Jul 9");
  });

  it("agrees with the UTC calendar day used by the day heading and bell", () => {
    const iso = dateOnlyToNoonUtcIso("2026-07-09");
    // The day heading / bell key off toUtcDateOnly (the stored calendar day).
    expect(toUtcDateOnly(new Date(iso))).toBe("2026-07-09");
    // formatFollowUpDate must land on that same day for the same viewer.
    expect(formatFollowUpDate(iso)).toContain("Jul 9");
  });
});
