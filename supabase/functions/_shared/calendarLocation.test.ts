import { describe, it, expect } from "vitest";
import { extractGoogleLocation, extractMicrosoftLocation } from "./calendarLocation";

describe("extractGoogleLocation", () => {
  it("returns the trimmed location string when present", () => {
    expect(extractGoogleLocation("  100 Broadway, Oklahoma City, OK  ")).toBe(
      "100 Broadway, Oklahoma City, OK",
    );
  });

  it("returns null for empty, whitespace-only, or absent location", () => {
    expect(extractGoogleLocation("")).toBeNull();
    expect(extractGoogleLocation("   ")).toBeNull();
    expect(extractGoogleLocation(null)).toBeNull();
    expect(extractGoogleLocation(undefined)).toBeNull();
  });
});

describe("extractMicrosoftLocation", () => {
  it("uses displayName when the Graph location has one", () => {
    expect(
      extractMicrosoftLocation({ displayName: "100 Broadway, Oklahoma City, OK" }),
    ).toBe("100 Broadway, Oklahoma City, OK");
  });

  it("trims the displayName", () => {
    expect(extractMicrosoftLocation({ displayName: "  Harry's Bar  " })).toBe(
      "Harry's Bar",
    );
  });

  it("falls back to composing the address sub-fields when displayName is blank", () => {
    expect(
      extractMicrosoftLocation({
        displayName: "",
        address: {
          street: "123 Main St",
          city: "Oklahoma City",
          state: "OK",
          postalCode: "73102",
          countryOrRegion: "USA",
        },
      }),
    ).toBe("123 Main St, Oklahoma City, OK, 73102, USA");
  });

  it("skips missing/blank address parts when composing", () => {
    expect(
      extractMicrosoftLocation({
        displayName: null,
        address: { street: "123 Main St", city: "Oklahoma City", state: "OK" },
      }),
    ).toBe("123 Main St, Oklahoma City, OK");
  });

  it("returns null when neither displayName nor any address field is usable", () => {
    expect(extractMicrosoftLocation(null)).toBeNull();
    expect(extractMicrosoftLocation(undefined)).toBeNull();
    expect(extractMicrosoftLocation({})).toBeNull();
    expect(extractMicrosoftLocation({ displayName: "   " })).toBeNull();
    expect(extractMicrosoftLocation({ displayName: "", address: {} })).toBeNull();
    expect(
      extractMicrosoftLocation({ address: { street: "  ", city: "" } }),
    ).toBeNull();
  });

  // Microsoft Graph exposes an event's location(s) in BOTH the singular
  // `location` object AND the plural `locations[]` array. Real Outlook events
  // routinely arrive with the singular `location` empty/absent while the address
  // is carried in `locations[]`. Reading only the singular object loses the
  // address and collapses the meeting to a no-location time block.
  it("falls back to the plural locations[] displayName when the singular is blank", () => {
    expect(
      extractMicrosoftLocation(
        { displayName: "" },
        [{ displayName: "100 Broadway, Oklahoma City, OK" }],
      ),
    ).toBe("100 Broadway, Oklahoma City, OK");
  });

  it("falls back to the plural locations[] when the singular is absent", () => {
    expect(
      extractMicrosoftLocation(null, [
        { displayName: "Harry's Bar" },
      ]),
    ).toBe("Harry's Bar");
  });

  it("composes the address sub-fields from a locations[] entry", () => {
    expect(
      extractMicrosoftLocation(undefined, [
        {
          displayName: "",
          address: {
            street: "123 Main St",
            city: "Oklahoma City",
            state: "OK",
            postalCode: "73102",
          },
        },
      ]),
    ).toBe("123 Main St, Oklahoma City, OK, 73102");
  });

  it("prefers the singular location over locations[] when both resolve", () => {
    expect(
      extractMicrosoftLocation(
        { displayName: "Primary Venue" },
        [{ displayName: "Secondary Venue" }],
      ),
    ).toBe("Primary Venue");
  });

  it("skips unusable locations[] entries and uses the first usable one", () => {
    expect(
      extractMicrosoftLocation(null, [
        {},
        { displayName: "   " },
        { displayName: "9 Real St, Edmond, OK" },
      ]),
    ).toBe("9 Real St, Edmond, OK");
  });

  it("returns null when neither the singular nor any locations[] entry is usable", () => {
    expect(extractMicrosoftLocation(null, [])).toBeNull();
    expect(extractMicrosoftLocation(null, [{}, { displayName: "  " }])).toBeNull();
    expect(extractMicrosoftLocation({ displayName: "" }, undefined)).toBeNull();
  });
});
