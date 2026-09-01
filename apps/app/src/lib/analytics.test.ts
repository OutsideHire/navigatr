import { describe, it, expect, beforeEach, vi } from "vitest";

// A PLAIN (non-vi.fn) module mock: it records calls in an array and throws via
// a flag. Using a plain function (not vi.fn().mockImplementation(throw)) keeps
// the deliberately-thrown provider error out of vitest 4's mock-result
// tracking, which would otherwise surface a caught throw as a test failure.
// We only want to prove our wrapper SWALLOWS provider failures.
let calls: unknown[][] = [];
let providerThrows = false;
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => {
    calls.push(args);
    if (providerThrows) throw new Error("network down");
  },
}));

import { track } from "./analytics";

beforeEach(() => {
  calls = [];
  providerThrows = false;
});

describe("analytics.track", () => {
  it("forwards the event name and properties to the provider", () => {
    track("deal_created", { source: "path", included_chains: false });
    expect(calls).toEqual([["deal_created", { source: "path", included_chains: false }]]);
  });

  it("forwards an event with no properties", () => {
    track("route_planned");
    expect(calls).toEqual([["route_planned", undefined]]);
  });

  it("never throws if the provider fails (best-effort, must not break the app)", () => {
    providerThrows = true;
    let threw = false;
    try {
      track("deal_created");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(calls).toEqual([["deal_created", undefined]]); // it did attempt the send
  });
});
