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
});
