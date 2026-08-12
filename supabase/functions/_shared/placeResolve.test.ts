import { describe, it, expect } from "vitest";
import {
  MIN_AUTOCOMPLETE_CHARS,
  normalizeAutocomplete,
  normalizePlaceDetails,
  type GoogleAutocompleteResponse,
  type GooglePlaceDetails,
} from "./placeResolve";

describe("MIN_AUTOCOMPLETE_CHARS", () => {
  it("is 3 (the search-gate floor)", () => {
    expect(MIN_AUTOCOMPLETE_CHARS).toBe(3);
  });
});

describe("normalizeAutocomplete", () => {
  it("maps place predictions to suggestion rows", () => {
    const raw: GoogleAutocompleteResponse = {
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJ_pat",
            text: { text: "Pat's Family Diner, 101 Congress Ave, Austin, TX" },
            structuredFormat: {
              mainText: { text: "Pat's Family Diner" },
              secondaryText: { text: "101 Congress Ave, Austin, TX" },
            },
          },
        },
      ],
    };
    expect(normalizeAutocomplete(raw)).toEqual([
      {
        placeId: "ChIJ_pat",
        primaryText: "Pat's Family Diner",
        secondaryText: "101 Congress Ave, Austin, TX",
        fullText: "Pat's Family Diner, 101 Congress Ave, Austin, TX",
      },
    ]);
  });

  it("drops query-only predictions (no placeId)", () => {
    const raw: GoogleAutocompleteResponse = {
      suggestions: [
        { placePrediction: undefined },
        {
          placePrediction: {
            placeId: "ChIJ_real",
            structuredFormat: { mainText: { text: "Real Place" } },
          },
        },
      ],
    };
    const out = normalizeAutocomplete(raw);
    expect(out).toHaveLength(1);
    expect(out[0].placeId).toBe("ChIJ_real");
  });

  it("falls back to the single-line label when structured text is missing", () => {
    const raw: GoogleAutocompleteResponse = {
      suggestions: [
        { placePrediction: { placeId: "ChIJ_x", text: { text: "Some Business" } } },
      ],
    };
    expect(normalizeAutocomplete(raw)).toEqual([
      { placeId: "ChIJ_x", primaryText: "Some Business", secondaryText: "", fullText: "Some Business" },
    ]);
  });

  it("skips a prediction with a placeId but no usable text", () => {
    const raw: GoogleAutocompleteResponse = {
      suggestions: [{ placePrediction: { placeId: "ChIJ_blank" } }],
    };
    expect(normalizeAutocomplete(raw)).toEqual([]);
  });

  it("returns an empty array for an empty/absent suggestions list", () => {
    expect(normalizeAutocomplete({})).toEqual([]);
    expect(normalizeAutocomplete({ suggestions: [] })).toEqual([]);
  });
});

describe("normalizePlaceDetails", () => {
  it("maps a full details payload and buckets the industry via the shared taxonomy", () => {
    const raw: GooglePlaceDetails = {
      id: "ChIJ_dental",
      displayName: { text: "Riverside Dental Group" },
      formattedAddress: "512 Riverside Dr, Austin, TX",
      location: { latitude: 30.25, longitude: -97.74 },
      primaryType: "dentist",
      types: ["dentist", "health", "establishment"],
      nationalPhoneNumber: "(512) 555-0105",
    };
    const out = normalizePlaceDetails(raw);
    expect(out.placeId).toBe("ChIJ_dental");
    expect(out.name).toBe("Riverside Dental Group");
    expect(out.formattedAddress).toBe("512 Riverside Dr, Austin, TX");
    expect(out.lat).toBe(30.25);
    expect(out.lng).toBe(-97.74);
    expect(out.primaryType).toBe("dentist");
    expect(out.phone).toBe("(512) 555-0105");
    // bucketForType maps dentist -> a real industry key (not "other").
    expect(out.industry).not.toBe("other");
    expect(typeof out.industry).toBe("string");
  });

  it("returns null coords/address/phone when Google omits them", () => {
    const out = normalizePlaceDetails({
      id: "ChIJ_bare",
      displayName: { text: "Bare Business" },
      types: [],
    });
    expect(out).toEqual({
      placeId: "ChIJ_bare",
      name: "Bare Business",
      formattedAddress: null,
      lat: null,
      lng: null,
      primaryType: null,
      phone: null,
      industry: "other",
    });
  });

  it("treats blank strings as absent (null), not empty text", () => {
    const out = normalizePlaceDetails({
      id: "ChIJ_ws",
      displayName: { text: "  Spaced Name  " },
      formattedAddress: "   ",
      nationalPhoneNumber: "  ",
      types: ["restaurant"],
    });
    expect(out.name).toBe("Spaced Name");
    expect(out.formattedAddress).toBeNull();
    expect(out.phone).toBeNull();
  });
});
