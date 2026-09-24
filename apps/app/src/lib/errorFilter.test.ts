import { describe, it, expect } from "vitest";
import {
  IGNORED_ERROR_PATTERNS,
  isExpectedDomainError,
  isExpectedPermissionError,
  isFunctionsFetchError,
  isMessageObject,
  isSupabaseError,
  isTransientNetworkError,
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
  it("covers transient network fetch failures (dead-zone noise)", () => {
    // Sentry ignoreErrors substring-matches the captured value, e.g. the wrapped
    // "SupabaseError: [] TypeError: Load failed".
    expect(matches("[] TypeError: Load failed")).toBe(true);
    expect(matches("TypeError: Failed to fetch")).toBe(true);
    expect(matches("NetworkError when attempting to fetch resource")).toBe(true);
  });
});

describe("isTransientNetworkError", () => {
  it("is true for the browser fetch-failure signatures across shapes", () => {
    // The exact shape supabase-js yields when the fetch never completed: a
    // Supabase-like object with an EMPTY code (no HTTP response received).
    expect(isTransientNetworkError({ code: "", message: "TypeError: Load failed", details: "stack", hint: "" })).toBe(true);
    expect(isTransientNetworkError(new Error("[] TypeError: Load failed"))).toBe(true); // wrapped Error
    expect(isTransientNetworkError(new TypeError("Failed to fetch"))).toBe(true); // Chromium
    expect(isTransientNetworkError({ message: "NetworkError when attempting to fetch resource" })).toBe(true); // Firefox, bare {message}
    expect(isTransientNetworkError("The network connection was lost")).toBe(true); // iOS, plain string
  });

  it("does NOT drop errors that actually reached the server (real coded errors)", () => {
    expect(isTransientNetworkError({ code: "PGRST202", message: "Could not find the function public.cron_health", details: null, hint: null })).toBe(false);
    expect(isTransientNetworkError({ code: "42501", message: "permission denied for table profiles", details: null, hint: null })).toBe(false);
    expect(isTransientNetworkError(new Error("cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
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

describe("isMessageObject", () => {
  it("recognizes a non-Error object carrying a string message", () => {
    expect(isMessageObject({ message: "boom" })).toBe(true);
    expect(isMessageObject({ message: "boom", status: 500 })).toBe(true);
    // A Supabase error is a message object too (callers check isSupabaseError
    // first, for the richer code/details/hint handling).
    expect(isMessageObject({ code: "P0001", message: "forbidden", details: null, hint: null })).toBe(true);
  });
  it("rejects Errors, non-string messages, and non-objects", () => {
    expect(isMessageObject(new Error("boom"))).toBe(false); // Sentry handles Errors natively
    expect(isMessageObject(new TypeError("boom"))).toBe(false);
    expect(isMessageObject({ message: 123 })).toBe(false);
    expect(isMessageObject({ code: "x" })).toBe(false); // no message key
    expect(isMessageObject("boom")).toBe(false);
    expect(isMessageObject(null)).toBe(false);
  });
  it("rejects an empty or whitespace-only message (would collision-group as a bare CapturedError)", () => {
    expect(isMessageObject({ message: "" })).toBe(false);
    expect(isMessageObject({ message: "   " })).toBe(false);
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
  it("turns a bare {message} object into a readable Error (the 'keys: message' bug)", () => {
    const { error, extra } = normalizeError({ message: "boom" });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom");
    expect((error as Error).name).toBe("CapturedError");
    expect(extra).toBeUndefined();
  });
  it("stashes a message-object's other fields under captured_object", () => {
    const { error, extra } = normalizeError({ message: "boom", status: 500, url: "/x" });
    expect((error as Error).message).toBe("boom");
    expect(extra).toMatchObject({ captured_object: { status: 500, url: "/x" } });
  });
  // SUPERSEDED 2026-09-24, intent preserved. This used to assert raw
  // pass-through, guarding against a BARE CapturedError that would dump every
  // empty-message object into one meaningless Sentry group. That anti-collision
  // intent still stands. But passing raw is exactly what produced the useless
  // title "Object captured as exception with keys: code, details, hint,
  // message" seen in prod. We now build a SHAPE-SPECIFIC title, which is
  // readable AND still keeps unrelated shapes in separate groups.
  it("makes an empty-message object readable without collision-grouping it", () => {
    const raw = { message: "" };
    const { error, extra } = normalizeError(raw);
    expect(error).not.toBe(raw);
    expect((error as Error).name).toBe("CapturedObject");
    expect((error as Error).message).toBe("Unreadable error object with keys: message");
    expect(extra?.captured_object).toEqual(raw);
  });

  it("keeps different unreadable shapes in DIFFERENT groups (the anti-collision guard)", () => {
    const a = normalizeError({ message: "" }).error as Error;
    const b = normalizeError({ status: 500, url: "/x" }).error as Error;
    const c = normalizeError({ code: 42501, details: null, hint: null, message: "" }).error as Error;
    expect(a.message).not.toBe(b.message);
    expect(b.message).not.toBe(c.message);
    expect(a.message).not.toBe(c.message);
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

  it("signals DROP for a transient network fetch failure (empty-code Load failed)", () => {
    const event = synthesizedEvent();
    const { drop } = normalizeSupabaseSentryEvent(event, { code: "", message: "TypeError: Load failed", details: "stack", hint: "" });
    expect(drop).toBe(true);
  });

  it("is a no-op for an already-normalized Error (the wrapper path is not double-processed)", () => {
    const event = synthesizedEvent();
    const before = JSON.stringify(event);
    const { drop } = normalizeSupabaseSentryEvent(event, new Error("[42501] permission denied for table deals"));
    expect(drop).toBe(false);
    expect(JSON.stringify(event)).toBe(before);
  });

  it("is a no-op for a real Error (Sentry handles Errors natively; the wrapper path is not double-processed)", () => {
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

  // A bare {message}-only object rejected UNHANDLED synthesizes the useless
  // "Object captured as exception with keys: message" event (NAVIGATR-APP-P on
  // /admin/agents/:id). The generic fallback rescues it the same way.
  it("rewrites a bare {message} unhandled event into a readable CapturedError", () => {
    const event: SentryEventLike = {
      exception: { values: [{ type: "Error", value: "Object captured as exception with keys: message" }] },
    };
    const { drop } = normalizeSupabaseSentryEvent(event, { message: "boom" });
    expect(drop).toBe(false);
    expect(event.exception?.values?.[0]).toMatchObject({ type: "CapturedError", value: "boom" });
  });

  it("stashes a message-object's other fields under captured_object in extra", () => {
    const event: SentryEventLike = {
      exception: { values: [{ type: "Error", value: "Object captured as exception with keys: message, status" }] },
    };
    normalizeSupabaseSentryEvent(event, { message: "boom", status: 500 });
    expect(event.extra).toMatchObject({ captured_object: { status: 500 } });
  });
});

describe("expected-condition and unreadable-object filtering (2026-09-24 Sentry triage)", () => {
  // These reach Sentry only because EVERY react-query mutation rejection is
  // reported, including ones the caller catches and shows as a friendly toast.
  it("treats our own business-outcome sentinels as expected, by class name", () => {
    const dup = new Error("This business is already in your team's pipeline.");
    dup.name = "DuplicateDealError";
    expect(isExpectedDomainError(dup)).toBe(true);

    const locked = new Error("lead source is locked");
    locked.name = "LeadSourceLockedError";
    expect(isExpectedDomainError(locked)).toBe(true);
  });

  it("does NOT treat a real failure as an expected domain error", () => {
    // Same message, ordinary Error: a genuine insert failure must still report.
    expect(isExpectedDomainError(new Error("This business is already in your team's pipeline."))).toBe(false);
    expect(isExpectedDomainError(new TypeError("boom"))).toBe(false);
  });

  it("treats FunctionsFetchError as transport noise, but not FunctionsHttpError", () => {
    const fetchErr = new Error("Failed to send a request to the Edge Function");
    fetchErr.name = "FunctionsFetchError";
    expect(isFunctionsFetchError(fetchErr)).toBe(true);

    // A function that actually responded with a non-2xx is a REAL failure and
    // must stay visible.
    const httpErr = new Error("Edge Function returned a non-2xx status code");
    httpErr.name = "FunctionsHttpError";
    expect(isFunctionsFetchError(httpErr)).toBe(false);
  });

  // The "Object captured as exception with keys: code, details, hint, message"
  // title: an object with the Supabase shape but a non-string code and an empty
  // message slips past BOTH guards and used to reach Sentry raw.
  it("never returns a raw object from normalizeError", () => {
    const weird = { code: 42501, details: null, hint: null, message: "" };
    const { error, extra } = normalizeError(weird);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("42501");
    expect((error as Error).name).toBe("CapturedObject");
    expect(extra?.captured_object).toEqual(weird);
  });

  it("titles a codeless unreadable object by its key shape so it still groups", () => {
    const { error } = normalizeError({ foo: 1, bar: 2 });
    expect((error as Error).message).toBe("Unreadable error object with keys: bar, foo");
  });
});

describe("expected RPC sentinels (P0001)", () => {
  const supa = (code: string, message: string) => ({ code, message, details: null, hint: null });

  it("drops an invite that was already actioned by someone else", () => {
    expect(isExpectedPermissionError(supa("P0001", "invite_not_found_or_already_resolved"))).toBe(true);
    expect(isExpectedPermissionError(supa("P0001", "already_in_organization"))).toBe(true);
  });

  it("still drops the original P0001 forbidden", () => {
    expect(isExpectedPermissionError(supa("P0001", "forbidden"))).toBe(true);
  });

  // Hitting one of these means the UI offered an action it should have
  // prevented. That is a real defect and must stay visible.
  it("does NOT drop the cannot_* guard rails", () => {
    for (const m of [
      "cannot_deactivate_self",
      "cannot_demote_sole_admin",
      "cannot_change_own_role",
      "cycle_detected",
    ]) {
      expect(isExpectedPermissionError(supa("P0001", m))).toBe(false);
    }
  });

  // The 2026-09-24 incident: a 42501 means the request ran as `anon` because the
  // rep's token did not attach. That is the involuntary-logout signal and must
  // keep reporting, so we can tell if sessionGuard ever stops repairing it.
  it("NEVER drops a 42501, whatever the message", () => {
    expect(isExpectedPermissionError(supa("42501", "permission denied for table paths"))).toBe(false);
    expect(isExpectedPermissionError(supa("42501", "forbidden"))).toBe(false);
  });

  it("matches the sentinel exactly, never as a substring", () => {
    expect(isExpectedPermissionError(supa("P0001", "invite_not_found_or_already_resolved_somehow"))).toBe(false);
    expect(isExpectedPermissionError(supa("P0001", "not already_in_organization"))).toBe(false);
  });
});
