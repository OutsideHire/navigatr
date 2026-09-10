import { describe, it, expect } from "vitest";
import {
  isRateLimitStatus,
  newRateGate,
  noteStatus,
  classifyColdFetch,
} from "./discoveryBackoff";

describe("isRateLimitStatus", () => {
  it("treats 429 as rate limiting", () => {
    expect(isRateLimitStatus(429)).toBe(true);
  });
  it("does NOT trip on 400 / 401 / 403 / 5xx (those are per-bucket, not a quota wall)", () => {
    for (const s of [200, 400, 401, 403, 404, 500, 502, 503]) {
      expect(isRateLimitStatus(s)).toBe(false);
    }
  });
});

describe("RateGate", () => {
  it("starts untripped", () => {
    expect(newRateGate().tripped).toBe(false);
  });

  it("trips (and stays tripped) once a 429 is seen", () => {
    const gate = newRateGate();
    expect(noteStatus(gate, 200)).toBe(false);
    expect(noteStatus(gate, 500)).toBe(false); // a 5xx doesn't trip
    expect(gate.tripped).toBe(false);
    expect(noteStatus(gate, 429)).toBe(true); // 429 trips
    expect(gate.tripped).toBe(true);
    // Stays tripped even for a subsequent non-429.
    expect(noteStatus(gate, 200)).toBe(true);
  });

  it("keeps gates independent per request", () => {
    const a = newRateGate();
    const b = newRateGate();
    noteStatus(a, 429);
    expect(a.tripped).toBe(true);
    expect(b.tripped).toBe(false);
  });
});

describe("classifyColdFetch", () => {
  it("proceeds when there is at least one pull, even if rate-limited late", () => {
    expect(classifyColdFetch(3, false)).toBe("ok");
    expect(classifyColdFetch(1, true)).toBe("ok"); // partial success still proceeds
  });
  it("returns rate_limited when nothing came back and the breaker tripped", () => {
    expect(classifyColdFetch(0, true)).toBe("rate_limited");
  });
  it("returns fetch_failed when nothing came back for a non-quota reason", () => {
    expect(classifyColdFetch(0, false)).toBe("fetch_failed");
  });
});
