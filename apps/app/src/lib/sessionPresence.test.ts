import { describe, it, expect, afterEach } from "vitest";
import { appBelievesSignedIn, setSignedInProbe } from "./sessionPresence";

afterEach(() => setSignedInProbe(null));

describe("appBelievesSignedIn", () => {
  it("assumes a session when nothing has registered (keeps reporting as before)", () => {
    expect(appBelievesSignedIn()).toBe(true);
  });

  it("answers with the registered probe", () => {
    setSignedInProbe(() => false);
    expect(appBelievesSignedIn()).toBe(false);
    setSignedInProbe(() => true);
    expect(appBelievesSignedIn()).toBe(true);
  });

  it("assumes a session when the probe throws, so a broken probe never hides an error", () => {
    setSignedInProbe(() => {
      throw new Error("boom");
    });
    expect(appBelievesSignedIn()).toBe(true);
  });
});
