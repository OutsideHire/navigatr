import { describe, it, expect } from "vitest";
import {
  interleaveAroundAnchors,
  type AnchorLike,
  type FlexibleLike,
} from "./interleaveAroundAnchors";

// All fixtures put stops and anchors at the origin (drive == 0) so fit math is
// driven purely by dwell and the anchor's start clock, with no haversine noise.
const ORIGIN = { lat: 0, lng: 0 };
const DWELL = 20;

const anchor = (o: Partial<AnchorLike> = {}): AnchorLike => ({
  startAt: "2026-08-09T15:00:00.000Z",
  endAt: "2026-08-09T16:00:00.000Z",
  lat: 0,
  lng: 0,
  ...o,
});

// A flexible carrying an id so we can assert order/identity in the output.
interface Flex extends FlexibleLike {
  id: string;
}
const flex = (id: string, o: Partial<Flex> = {}): Flex => ({
  id,
  lat: 0,
  lng: 0,
  ...o,
});

// 8:00 UTC start: a full day of budget before the 3pm anchor.
const START = Date.parse("2026-08-09T08:00:00.000Z");

describe("interleaveAroundAnchors", () => {
  it("emits a fitting flexible stop before the anchor", () => {
    const a = anchor({ startAt: "2026-08-09T15:00:00.000Z" });
    const q = [flex("f1")];
    const out = interleaveAroundAnchors([a], q, {
      origin: ORIGIN,
      dwellMin: DWELL,
      effectiveStartMs: START,
    });
    expect(out.map((e) => e.kind)).toEqual(["flexible", "anchor"]);
    expect(out[0]!.item).toBe(q[0]);
    expect(out[1]!.item).toBe(a);
  });

  it("emits a non-fitting flexible stop after the anchor", () => {
    // Anchor starts 1 minute after the effective start; a 20-min dwell stop
    // cannot depart before it, so it defers past the anchor.
    const a = anchor({ startAt: "2026-08-09T08:01:00.000Z", endAt: "2026-08-09T09:00:00.000Z" });
    const q = [flex("f1")];
    const out = interleaveAroundAnchors([a], q, {
      origin: ORIGIN,
      dwellMin: DWELL,
      effectiveStartMs: START,
    });
    expect(out.map((e) => e.kind)).toEqual(["anchor", "flexible"]);
    expect(out[0]!.item).toBe(a);
    expect(out[1]!.item).toBe(q[0]);
  });

  it("returns all flexible stops in queue order when there are no anchors", () => {
    const q = [flex("f1"), flex("f2"), flex("f3")];
    const out = interleaveAroundAnchors([], q, {
      origin: ORIGIN,
      dwellMin: DWELL,
      effectiveStartMs: START,
    });
    expect(out.map((e) => e.kind)).toEqual(["flexible", "flexible", "flexible"]);
    expect(out.map((e) => e.item)).toEqual([q[0], q[1], q[2]]);
  });

  it("does not throw for a null-coord anchor and still emits it (driveOn treated as 0)", () => {
    const a = anchor({ startAt: "2026-08-09T15:00:00.000Z", lat: null, lng: null });
    const q = [flex("f1")];
    const out = interleaveAroundAnchors([a], q, {
      origin: ORIGIN,
      dwellMin: DWELL,
      effectiveStartMs: START,
    });
    // The fitting flexible still precedes the null-coord anchor.
    expect(out.map((e) => e.kind)).toEqual(["flexible", "anchor"]);
    expect(out[1]!.item).toBe(a);
  });

  it("preserves queue order for leftovers after the last anchor", () => {
    // The anchor sits early enough that only the first stop fits before it; the
    // rest spill after, in original queue order.
    const a = anchor({ startAt: "2026-08-09T08:25:00.000Z", endAt: "2026-08-09T09:00:00.000Z" });
    const q = [flex("f1"), flex("f2"), flex("f3")];
    const out = interleaveAroundAnchors([a], q, {
      origin: ORIGIN,
      dwellMin: DWELL,
      effectiveStartMs: START,
    });
    expect(out.map((e) => e.kind)).toEqual(["flexible", "anchor", "flexible", "flexible"]);
    expect(out[0]!.item).toBe(q[0]);
    expect(out[2]!.item).toBe(q[1]);
    expect(out[3]!.item).toBe(q[2]);
  });
});
