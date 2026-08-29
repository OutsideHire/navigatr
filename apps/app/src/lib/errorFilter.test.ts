import { describe, it, expect } from "vitest";
import {
  IGNORED_ERROR_PATTERNS,
  isSupabaseError,
  isExpectedPermissionError,
  normalizeError,
} from "./errorFilter";

describe("IGNORED_ERROR_PATTERNS", () => {
  // Each real production Sentry noise title should be covered by a substring
  // pattern (Sentry's ignoreErrors matches by substring).
  const matches = (msg: string) => IGNORED_ERROR_PATTERNS.some((p) => msg.includes(p));

  it("covers browser-extension injection noise", () => {
    expect(matches("Non-Error promise rejection captured with value: Object Not Found Matching Id:2, MethodName:update, ParamCount:4")).toBe(true);
  });
  it("covers PWA service-worker update churn", () => {
    expect(matches("newestWorker is null")).toBe(true);
    expect(matches("Failed to update a ServiceWorker for scope ('https://app.getnavigatr.io/')")).toBe(true);
  });
  it("covers stale-tab-after-deploy chunk loads", () => {
    expect(matches("Failed to fetch dynamically imported module: https://app.getnavigatr.io/assets/AgentsPage-CEOAMiHo.js")).toBe(true);
  });
  it("covers transient auth token-lock contention", () => {
    expect(matches('Acquiring an exclusive Navigator LockManager lock "lock:navigatr-auth" immediately failed')).toBe(true);
  });
  it("does NOT match an ordinary application error", () => {
    expect(matches("TypeError: cannot read properties of undefined (reading 'id')")).toBe(false);
  });
});

describe("isSupabaseError", () => {
  it("recognizes a PostgREST error shape (code + message + details + hint)", () => {
    expect(isSupabaseError({ code: "P0001", message: "forbidden", details: null, hint: null })).toBe(true);
  });
  it("rejects a real Error, a string, null, and a partial shape", () => {
    expect(isSupabaseError(new Error("[P0001] forbidden"))).toBe(false); // an Error is not a raw supabase object
    expect(isSupabaseError("forbidden")).toBe(false);
    expect(isSupabaseError(null)).toBe(false);
    expect(isSupabaseError({ code: "P0001", message: "forbidden" })).toBe(false); // no details/hint
  });
});

describe("isExpectedPermissionError", () => {
  it("is true for a P0001 forbidden and insufficient_privilege (42501)", () => {
    expect(isExpectedPermissionError({ code: "P0001", message: "forbidden", details: null, hint: null })).toBe(true);
    expect(isExpectedPermissionError({ code: "P0001", message: "not_authenticated", details: null, hint: null })).toBe(true);
    expect(isExpectedPermissionError({ code: "42501", message: "permission denied for table deals", details: null, hint: null })).toBe(true);
  });
  it("is false for any other Supabase error or non-Supabase value", () => {
    expect(isExpectedPermissionError({ code: "23505", message: "duplicate key value", details: null, hint: null })).toBe(false);
    expect(isExpectedPermissionError({ code: "P0001", message: "seat_cap_reached", details: null, hint: null })).toBe(false);
    expect(isExpectedPermissionError(new Error("boom"))).toBe(false);
    expect(isExpectedPermissionError(null)).toBe(false);
  });
});

describe("normalizeError", () => {
  it("turns a Supabase error into a readable, grouped Error with extra fields", () => {
    const { error, extra } = normalizeError({ code: "23505", message: "duplicate key value", details: "Key (email) exists.", hint: null });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("[23505] duplicate key value");
    expect((error as Error).name).toBe("SupabaseError");
    expect(extra).toMatchObject({ supabase_code: "23505", supabase_details: "Key (email) exists.", supabase_hint: null });
  });
  it("passes a real Error through unchanged with no extra", () => {
    const original = new Error("cannot read 'id'");
    const { error, extra } = normalizeError(original);
    expect(error).toBe(original);
    expect(extra).toBeUndefined();
  });
  it("passes a non-Supabase value through unchanged", () => {
    const { error, extra } = normalizeError("plain string");
    expect(error).toBe("plain string");
    expect(extra).toBeUndefined();
  });
});
