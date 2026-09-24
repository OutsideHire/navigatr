import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionGuardFetch, setSessionGuardHooks } from "./sessionGuard";

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
