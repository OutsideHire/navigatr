import { describe, it, expect } from "vitest";
import { pickPushProvider } from "./pickPushProvider";

describe("pickPushProvider", () => {
  it("keeps an existing mirror on a still-active provider", () => {
    expect(pickPushProvider(["google", "microsoft"], "microsoft", "google")).toBe("microsoft");
  });
  it("honors the rep's primary when no mirror and primary is active", () => {
    expect(pickPushProvider(["google", "microsoft"], null, "microsoft")).toBe("microsoft");
  });
  it("ignores a primary that is not currently active", () => {
    expect(pickPushProvider(["google"], null, "microsoft")).toBe("google");
  });
  it("falls back to Google-first when no mirror and no primary", () => {
    expect(pickPushProvider(["google", "microsoft"], null, null)).toBe("google");
  });
  it("returns the single active provider", () => {
    expect(pickPushProvider(["microsoft"], null, null)).toBe("microsoft");
  });
  it("returns null when nothing is active", () => {
    expect(pickPushProvider([], null, "google")).toBeNull();
  });
});
