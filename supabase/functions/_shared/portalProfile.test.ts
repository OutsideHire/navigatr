import { describe, it, expect } from "vitest";
import { PORTAL_PROFILE_LIMITS, PORTAL_PROFILE_MESSAGES, validateProfile } from "./portalProfile";

describe("validateProfile", () => {
  it("trims the name and phone, and turns a blank phone into null", () => {
    expect(validateProfile({ name: "  Jane Smith ", phone: "  ", weeklyDigest: false })).toEqual({
      ok: true,
      value: { name: "Jane Smith", phone: null, weeklyDigest: false },
    });
    expect(validateProfile({ name: "Jane", phone: " (555) 010-0100 ", weeklyDigest: true })).toEqual({
      ok: true,
      value: { name: "Jane", phone: "(555) 010-0100", weeklyDigest: true },
    });
    expect(validateProfile({ name: "Jane", phone: null, weeklyDigest: true })).toEqual({
      ok: true,
      value: { name: "Jane", phone: null, weeklyDigest: true },
    });
  });

  it("needs a name of at most 120 characters", () => {
    for (const name of ["", "   ", undefined, 42]) {
      expect(validateProfile({ name, phone: null, weeklyDigest: true })).toEqual({ ok: false, field: "name" });
    }
    expect(validateProfile({ name: "a".repeat(PORTAL_PROFILE_LIMITS.name + 1), phone: null, weeklyDigest: true })).toEqual({
      ok: false,
      field: "name",
    });
    expect(validateProfile({ name: "a".repeat(PORTAL_PROFILE_LIMITS.name), phone: null, weeklyDigest: true }).ok).toBe(true);
  });

  it("rejects a phone that is too long, has fewer than 7 digits, or is not text", () => {
    for (const phone of ["5".repeat(PORTAL_PROFILE_LIMITS.phone + 1), "call me", "12345 6", 5550100]) {
      expect(validateProfile({ name: "Jane", phone, weeklyDigest: true })).toEqual({ ok: false, field: "phone" });
    }
    expect(validateProfile({ name: "Jane", phone: "1234567", weeklyDigest: true }).ok).toBe(true);
  });

  it("needs the weekly email choice as a boolean", () => {
    expect(validateProfile({ name: "Jane", phone: null })).toEqual({ ok: false, field: "weeklyDigest" });
    expect(validateProfile({ name: "Jane", phone: null, weeklyDigest: "yes" })).toEqual({ ok: false, field: "weeklyDigest" });
  });

  it("treats a missing body as a missing name", () => {
    expect(validateProfile(null)).toEqual({ ok: false, field: "name" });
  });

  it("has partner-facing copy for every field that never names the platform", () => {
    for (const key of ["name", "phone", "weeklyDigest"] as const) {
      expect(PORTAL_PROFILE_MESSAGES[key]).toBeTruthy();
      expect(PORTAL_PROFILE_MESSAGES[key]).not.toMatch(/navigatr/i);
    }
  });
});
