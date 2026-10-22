import { describe, it, expect, vi, beforeEach } from "vitest";
import { AUTH_REFRESH_TIMEOUT_MS, createSessionGuardFetch, setSessionGuardHooks } from "./sessionGuard";

const ANON = "anon-key";
const STORAGE = "navigatr-auth";
const REST = "https://x.supabase.co/rest/v1/paths?select=*";
const AUTH = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";

// jsdom's localStorage is not writable, so install a Map-backed one.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  setSessionGuardHooks(null);
});

function signedIn() {
  store.set(STORAGE, JSON.stringify({ access_token: "stale" }));
}

function makeFetch(base = vi.fn(async () => new Response("{}", { status: 200 }))) {
  return { base, guard: createSessionGuardFetch({ anonKey: ANON, storageKey: STORAGE, baseFetch: base }) };
}

function authHeaderOf(base: ReturnType<typeof vi.fn>, call = 0): string | null {
  const [input, init] = base.mock.calls[call]!;
  const h = new Headers((init as RequestInit | undefined)?.headers ?? (input as Request).headers);
  return h.get("Authorization");
}

describe("sessionGuard", () => {
  it("leaves a normally authenticated request completely alone", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    await guard(REST, { headers: { Authorization: "Bearer real-user-jwt" } });
    expect(base).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(base)).toBe("Bearer real-user-jwt");
  });

  // The bug: the SDK fell back to the publishable key while a session is stored.
  it("repairs a token-less request by attaching the recovered token", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    setSessionGuardHooks({
      recover: vi.fn(async () => true),
      getAccessToken: vi.fn(async () => "fresh-jwt"),
    });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(base).toHaveBeenCalledTimes(1); // repaired in place, NOT replayed
    expect(authHeaderOf(base)).toBe("Bearer fresh-jwt");
  });

  // Recovery itself calls /auth/v1/token. Intercepting that would recurse, or
  // deadlock waiting on the very request that would fix the problem.
  it("NEVER intercepts an auth endpoint, even token-less with a session stored", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    const recover = vi.fn(async () => true);
    setSessionGuardHooks({ recover, getAccessToken: async () => "fresh-jwt" });
    await guard(AUTH, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(recover).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });

  it("leaves a genuinely signed-out request alone (nothing stored to repair)", async () => {
    const { base, guard } = makeFetch();
    const recover = vi.fn(async () => true);
    setSessionGuardHooks({ recover, getAccessToken: async () => "fresh-jwt" });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(recover).not.toHaveBeenCalled();
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });

  it("sends the request unchanged when recovery fails (never worse than today)", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    setSessionGuardHooks({
      recover: async () => false,
      getAccessToken: async () => "should-not-be-used",
    });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(base).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });

  it("passes through before the auth store has registered its hooks", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(base).toHaveBeenCalledTimes(1);
  });

  // The 2026-09-10 outage was an over-eager retry. This guard must never add
  // request volume: exactly one outbound request in EVERY branch above.
  it("issues exactly one outbound request per call, in every branch", async () => {
    signedIn();
    for (const hooks of [
      null,
      { recover: async () => true, getAccessToken: async () => "fresh-jwt" },
      { recover: async () => false, getAccessToken: async () => null },
    ]) {
      const { base, guard } = makeFetch();
      setSessionGuardHooks(hooks);
      await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
      expect(base).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * The storage-only gate was a hole. In both states below localStorage says
   * "signed out" while the app is still rendering a signed-in rep, and the
   * guard used to wave the request straight through as anon into a 42501:
   *   1. a non-retryable refresh makes the SDK delete the storage row before
   *      SIGNED_OUT reaches the app, so in-flight queries leave unauthenticated;
   *   2. a WebKit PWA fails the storage read on resume while the session is
   *      perfectly alive, and no auth event fires at all.
   */
  it("repairs a token-less request when storage is empty but the app says a rep is signed in", async () => {
    const { base, guard } = makeFetch();
    // Deliberately NOT signedIn(): storage is empty, which is the whole point.
    setSessionGuardHooks({
      recover: async () => true,
      getAccessToken: async () => "fresh-jwt",
      believesSignedIn: () => true,
    });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(authHeaderOf(base)).toBe("Bearer fresh-jwt");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("still leaves a genuinely signed-out visitor alone", async () => {
    // Empty storage AND the app agrees nobody is signed in: the login screen,
    // a public read. Nothing to repair, and recovery must not even be tried.
    const recover = vi.fn(async () => true);
    const { base, guard } = makeFetch();
    setSessionGuardHooks({
      recover,
      getAccessToken: async () => "fresh-jwt",
      believesSignedIn: () => false,
    });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(recover).not.toHaveBeenCalled();
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });

  it("treats a registration without believesSignedIn exactly as before", async () => {
    // The hook is optional; an older registration must not start repairing
    // signed-out requests just because the field is missing.
    const recover = vi.fn(async () => true);
    const { base, guard } = makeFetch();
    setSessionGuardHooks({ recover, getAccessToken: async () => "fresh-jwt" });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(recover).not.toHaveBeenCalled();
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });

  it("does not attach the anon key as if it were a user token", async () => {
    const { base, guard } = makeFetch();
    signedIn();
    setSessionGuardHooks({
      recover: async () => true,
      getAccessToken: async () => ANON, // SDK handed back the fallback again
    });
    await guard(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(authHeaderOf(base)).toBe(`Bearer ${ANON}`);
  });
});

/**
 * ROOT CAUSE of "Session recovery failed ... reason=timeout" (prod 2026-10).
 * auth-js sends the refresh-token request with no timeout, and it sends it
 * while holding the auth lock. getSession and refreshSession queue behind that
 * lock with no timeout of their own, so one stalled refresh (a dead socket
 * after the laptop or iPad slept) froze every auth read in the tab. Bounding
 * the refresh request turns a stall into auth-js's own retryable network
 * error, which releases the lock and lets its existing backoff try again.
 * No retry is added here.
 */
describe("sessionGuard bounds the refresh-token request", () => {
  it("aborts a refresh request that never answers, after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
      );
      const { guard } = makeFetch(base as never);
      const pending = guard(AUTH, { method: "POST", headers: { Authorization: `Bearer ${ANON}` } });
      const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(AUTH_REFRESH_TIMEOUT_MS);
      await settled;
      expect(base).toHaveBeenCalledTimes(1); // bounded, never retried here
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays under Supabase's 10s refresh-token reuse window", () => {
    // If the server rotated the token but the answer was lost, auth-js's next
    // try reuses the old token. Inside the reuse window the server hands back
    // the same new session; outside it, it revokes the family and signs out.
    expect(AUTH_REFRESH_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it("does not time-limit other auth requests (sign-in on a slow link must finish)", async () => {
    const base = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    const { guard } = makeFetch(base as never);
    await guard("https://x.supabase.co/auth/v1/token?grant_type=password", { method: "POST" });
    expect(base.mock.calls[0]![1]?.signal).toBeUndefined();
  });

  it("keeps a caller's own signal instead of replacing it", async () => {
    const base = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    const { guard } = makeFetch(base as never);
    const own = new AbortController().signal;
    await guard(AUTH, { method: "POST", signal: own });
    expect(base.mock.calls[0]![1]?.signal).toBe(own);
  });
});

/**
 * B (prod 2026-10-22): the rep tapped Start driving, the SDK ended the
 * session, and queries that were waiting on the token went out as anon and came
 * back 42501. After a sign-out the app has observed, a table request carrying
 * only the publishable key can only ever be refused (anon holds no table
 * grants), so it is refused HERE without touching the network.
 */
describe("sessionGuard drains table requests right after a sign-out", () => {
  const anonInit = { headers: { Authorization: `Bearer ${ANON}` } };

  it("refuses an anon table request locally while the app is draining a sign-out", async () => {
    const { base, guard } = makeFetch();
    setSessionGuardHooks({
      recover: vi.fn(async () => false),
      getAccessToken: vi.fn(async () => null),
      believesSignedIn: () => false,
      refuseAnonTableRequests: () => true,
    });
    await expect(guard(REST, anonInit)).rejects.toMatchObject({ name: "AbortError" });
    expect(base).not.toHaveBeenCalled();
  });

  it("still sends an anon RPC (public RPCs are legitimate without a session)", async () => {
    const { base, guard } = makeFetch();
    setSessionGuardHooks({
      recover: vi.fn(async () => false),
      getAccessToken: vi.fn(async () => null),
      believesSignedIn: () => false,
      refuseAnonTableRequests: () => true,
    });
    await guard("https://x.supabase.co/rest/v1/rpc/get_invite_preview", anonInit);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("sends anon table requests as before when not draining", async () => {
    const { base, guard } = makeFetch();
    setSessionGuardHooks({
      recover: vi.fn(async () => false),
      getAccessToken: vi.fn(async () => null),
      believesSignedIn: () => false,
      refuseAnonTableRequests: () => false,
    });
    await guard(REST, anonInit);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("sessionGuard bounds reading the refresh response too (M1)", () => {
  it("aborts when the headers arrive but the body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const stalledBody = new ReadableStream<Uint8Array>({ start() { /* never enqueues, never closes */ } });
      const base = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
        new Response(stalledBody, { status: 200, headers: { "Content-Type": "application/json" } }),
      );
      const { guard } = makeFetch(base as never);
      const pending = guard(AUTH, { method: "POST" });
      const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(AUTH_REFRESH_TIMEOUT_MS);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands auth-js the same status, headers and body when the answer is prompt", async () => {
    const base = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "a" }), { status: 200, headers: { "X-Test": "1" } }),
    );
    const { guard } = makeFetch(base as never);
    const res = await guard(AUTH, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Test")).toBe("1");
    expect(await res.json()).toEqual({ access_token: "a" });
  });

  it("passes a refused refresh straight through with its status", async () => {
    const base = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    const { guard } = makeFetch(base as never);
    const res = await guard(AUTH, { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });
  });
});
