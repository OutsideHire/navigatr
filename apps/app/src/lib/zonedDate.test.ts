import { describe, it, expect } from "vitest";
import { dateInZone } from "./zonedDate";

describe("dateInZone", () => {
  it("returns the local calendar day for an instant in a given IANA zone", () => {
    // 2026-08-21T03:00:00Z is still Aug 20 in US Central (UTC-5 in August).
    expect(dateInZone("2026-08-21T03:00:00.000Z", "America/Chicago")).toBe("2026-08-20");
    // The same instant is Aug 21 in UTC.
    expect(dateInZone("2026-08-21T03:00:00.000Z", "UTC")).toBe("2026-08-21");
  });

  it("honors DST (Central is UTC-5 in August, UTC-6 in January)", () => {
    expect(dateInZone("2026-01-21T05:30:00.000Z", "America/Chicago")).toBe("2026-01-20");
    expect(dateInZone("2026-08-21T04:30:00.000Z", "America/Chicago")).toBe("2026-08-20");
  });

  it("honors a non-DST zone (Phoenix stays UTC-7 year round)", () => {
    expect(dateInZone("2026-08-21T05:30:00.000Z", "America/Phoenix")).toBe("2026-08-20");
    expect(dateInZone("2026-01-21T05:30:00.000Z", "America/Phoenix")).toBe("2026-01-20");
  });

  it("falls back to UTC for a null/empty/unresolvable zone (preserves prior behavior)", () => {
    expect(dateInZone("2026-08-21T03:00:00.000Z", null)).toBe("2026-08-21");
    expect(dateInZone("2026-08-21T03:00:00.000Z", "")).toBe("2026-08-21");
    expect(dateInZone("2026-08-21T03:00:00.000Z", "Mars/Olympus")).toBe("2026-08-21");
  });

  it("accepts a Date or epoch ms as well as an ISO string", () => {
    const iso = "2026-08-21T03:00:00.000Z";
    expect(dateInZone(new Date(iso), "America/Chicago")).toBe("2026-08-20");
    expect(dateInZone(Date.parse(iso), "America/Chicago")).toBe("2026-08-20");
  });
});
