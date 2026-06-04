import { describe, it, expect } from "vitest";
import { directionsUrl } from "./directionsUrl";

describe("directionsUrl", () => {
  it("builds a universal Google Maps directions deep link to the destination", () => {
    expect(directionsUrl(35.52, -97.51)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=35.52%2C-97.51",
    );
  });
  it("encodes the comma between coordinates", () => {
    expect(directionsUrl(0, 0)).toContain("destination=0%2C0");
  });
});
