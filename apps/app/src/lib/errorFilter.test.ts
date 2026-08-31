import { describe, it, expect } from "vitest";
import {
  IGNORED_ERROR_PATTERNS,
  isSupabaseError,
  isExpectedPermissionError,
  normalizeError,
  normalizeSupabaseSentryEvent,
  type SentryEventLike,
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
  it("covers Sentry's own event-drop narration", () => {
    expect(matches("An event processor returned `null`, will not send event.")).toBe(true);
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
  it("is true ONLY for a P0001 'forbidden' RPC-gate denial", () => {
    expect(isExpectedPermissionError({ code: "P0001", message: "forbidden", details: null, hint: null })).toBe(true);
  });
  it("does NOT suppress a 42501 missing-GRANT error (a real deploy bug must stay visible)", () => {
    // A forgotten `GRANT ... TO authenticated` raises 42501 for every user; an
    // RLS row-read denial returns zero rows, not 42501. So 42501 is never noise.
    expect(isExpectedPermissionError({ code: "42501", message: "permission denied for table deals", details: null, hint: null })).toBe(false);
  });
  it("does NOT suppress P0001 'not_authenticated' (a signed-in tokenless request is a real bug)", () => {
    expect(isExpectedPermissionError({ code: "P0001", message: "not_authenticated", details: null, hint: null })).toBe(false);
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

describe("normalizeSupabaseSentryEvent", () => {
  // Simulates the synthesized event Sentry's global handlers build from a raw
  // {code,details,hint,message} object rejected UNHANDLED (NAVIGATR-APP-7).
  const synthesizedEvent = (): SentryEventLike => ({
    exception: { values: [{ type: "Error", value: "Object captured as exception with keys: code, details, hint, message" }] },
  });
  const rawError = { code: "42501", message: "permission denied for table deals", details: null, hint: null };

  it("rewrites a raw-Supabase unhandled event into a readable SupabaseError (no fingerprint, so redactPii-scrubbed value drives grouping)", () => {
    const event = synthesizedEvent();
    const { drop } = normalizeSupabaseSentryEvent(event, rawError);
    expect(drop).toBe(false);
    expect(event.exception?.values?.[0]).toMatchObject({ type: "SupabaseError", value: "[42501] permission denied for table deals" });
    // No fingerprint is set: a raw message in fingerprint would ship unredacted.
    expect((event as { fingerprint?: unknown }).fingerprint).toBeUndefined();
    expect(event.extra).toMatchObject({ supabase_code: "42501", supabase_details: null, supabase_hint: null });
  });

  it("keeps distinct 42501 tables in separate groups via the value (forgotten-GRANT visibility)", () => {
    const a = synthesizedEvent();
    const b = synthesizedEvent();
    normalizeSupabaseSentryEvent(a, { code: "42501", message: "permission denied for table deals", details: null, hint: null });
    normalizeSupabaseSentryEvent(b, { code: "42501", message: "permission denied for table notes", details: null, hint: null });
    // Sentry groups exception events by type + value; distinct values => distinct issues.
    expect(a.exception?.values?.[0]?.value).not.toBe(b.exception?.values?.[0]?.value);
  });

  it("signals DROP for an authz-working-as-designed P0001 forbidden", () => {
    const event = synthesizedEvent();
    const { drop } = normalizeSupabaseSentryEvent(event, { code: "P0001", message: "forbidden", details: null, hint: null });
    expect(drop).toBe(true);
  });

  it("is a no-op for an already-normalized Error (the wrapper path is not double-processed)", () => {
    const event = synthesizedEvent();
    const before = JSON.stringify(event);
    const { drop } = normalizeSupabaseSentryEvent(event, new Error("[42501] permission denied for table deals"));
    expect(drop).toBe(false);
    expect(JSON.stringify(event)).toBe(before);
  });

  it("is a no-op for a non-Supabase throwable", () => {
    const event = synthesizedEvent();
    const before = JSON.stringify(event);
    normalizeSupabaseSentryEvent(event, new TypeError("cannot read 'id'"));
    expect(JSON.stringify(event)).toBe(before);
  });

  it("fabricates an exception when the synthesized event has none", () => {
    const event: SentryEventLike = {};
    normalizeSupabaseSentryEvent(event, rawError);
    expect(event.exception?.values?.[0]).toMatchObject({ type: "SupabaseError", value: "[42501] permission denied for table deals" });
  });
});
