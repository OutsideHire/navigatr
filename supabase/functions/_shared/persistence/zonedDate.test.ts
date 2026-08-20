import { describe, it, expect } from "vitest";
import { dateInZone } from "./zonedDate";
import { dateInZone as clientDateInZone } from "../../../../apps/app/src/lib/zonedDate";

// The server scorer cannot import from apps/app, so dateInZone is duplicated.
// This test pins the two copies together: any drift fails here.
describe("dateInZone (server) parity with the client copy", () => {
  const cases: Array<[string, string | null]> = [
    ["2026-08-21T03:00:00.000Z", "America/Chicago"],
    ["2026-01-21T05:30:00.000Z", "America/Chicago"],
    ["2026-08-21T05:30:00.000Z", "America/Phoenix"],
    ["2026-08-21T03:00:00.000Z", "Pacific/Honolulu"],
    ["2026-08-21T03:00:00.000Z", "UTC"],
    ["2026-08-21T03:00:00.000Z", null],
    ["2026-08-21T03:00:00.000Z", "Mars/Olympus"],
  ];

  it("matches the client implementation for every case", () => {
    for (const [iso, tz] of cases) {
      expect(dateInZone(iso, tz)).toBe(clientDateInZone(iso, tz));
    }
  });

  it("resolves the rep-local day (Central evening is the prior UTC day)", () => {
    // Direct behavior check so the server file is not only asserted via parity.
    expect(dateInZone("2026-08-21T03:00:00.000Z", "America/Chicago")).toBe("2026-08-20");
  });
});
