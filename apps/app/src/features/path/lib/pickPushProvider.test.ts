import { describe, it, expect } from "vitest";
import { pickPushProvider } from "../../../../../../supabase/functions/_shared/calendarProviders/pickPushProvider";

describe("pickPushProvider", () => {
  it("returns null when no calendar is connected", () => {
    expect(pickPushProvider([], null)).toBeNull();
    expect(pickPushProvider([], "google")).toBeNull();
  });

  it("uses the single active provider", () => {
    expect(pickPushProvider(["google"], null)).toBe("google");
    expect(pickPushProvider(["microsoft"], null)).toBe("microsoft");
  });

  it("prefers Google when both are connected and there's no existing mirror", () => {
    expect(pickPushProvider(["microsoft", "google"], null)).toBe("google");
  });

  it("keeps an existing mirror's provider when it's still active (no orphaning)", () => {
    expect(pickPushProvider(["google", "microsoft"], "microsoft")).toBe("microsoft");
    expect(pickPushProvider(["google", "microsoft"], "google")).toBe("google");
  });

  it("falls back off a stale existing provider that's no longer connected", () => {
    // Mirror says microsoft, but only google is active now → push to google.
    expect(pickPushProvider(["google"], "microsoft")).toBe("google");
  });
});
