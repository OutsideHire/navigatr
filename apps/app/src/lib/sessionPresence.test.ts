import { describe, it, expect, afterEach } from "vitest";
import { hasSessionNow, setSessionPresenceProbe } from "./sessionPresence";

afterEach(() => setSessionPresenceProbe(null));

describe("hasSessionNow", () => {
  it("assumes a session when nothing has registered (keeps reporting as before)", () => {
    expect(hasSessionNow()).toBe(true);
  });

  it("answers with the registered probe", () => {
    setSessionPresenceProbe(() => false);
    expect(hasSessionNow()).toBe(false);
    setSessionPresenceProbe(() => true);
    expect(hasSessionNow()).toBe(true);
  });

  it("assumes a session when the probe throws, so a broken probe never hides an error", () => {
    setSessionPresenceProbe(() => {
      throw new Error("boom");
    });
    expect(hasSessionNow()).toBe(true);
  });
});
