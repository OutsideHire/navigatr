import { describe, it, expect } from "vitest";
import { US_TIMEZONES, timezoneLabel, isKnownTimezone } from "./timezones";

describe("timezones", () => {
  it("lists the US zones including non-DST Phoenix and Honolulu", () => {
    const ids = US_TIMEZONES.map((z) => z.id);
    expect(ids).toContain("America/New_York");
    expect(ids).toContain("America/Chicago");
    expect(ids).toContain("America/Denver");
    expect(ids).toContain("America/Los_Angeles");
    expect(ids).toContain("America/Phoenix");
    expect(ids).toContain("America/Anchorage");
    expect(ids).toContain("Pacific/Honolulu");
  });

  it("labels a listed zone in plain language", () => {
    expect(timezoneLabel("America/Chicago")).toBe("Central Time (America/Chicago)");
  });

  it("falls back to the bare id for a zone outside the US list", () => {
    expect(timezoneLabel("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("recognizes a known IANA id and rejects junk", () => {
    expect(isKnownTimezone("America/Chicago")).toBe(true);
    expect(isKnownTimezone("Pacific/Honolulu")).toBe(true);
    expect(isKnownTimezone("Mars/Olympus")).toBe(false);
    expect(isKnownTimezone("")).toBe(false);
  });
});
