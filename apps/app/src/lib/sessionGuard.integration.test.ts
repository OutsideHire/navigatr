/**
 * The refresh deadline against the REAL auth-js client (M7). Unit tests prove
 * the guard aborts; this proves what auth-js does with that abort: it treats
 * it as a retryable network failure, keeps the stored session, emits no
 * SIGNED_OUT, and its own retry loop ends in bounded time instead of holding
 * the auth lock for as long as the socket stays dead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthClient } from "@supabase/supabase-js";
import { createSessionGuardFetch } from "./sessionGuard";

const STORAGE_KEY = "it-auth";
const ANON = "anon-key";

afterEach(() => vi.useRealTimers());

describe("real auth-js client + a refresh request that never answers", () => {
  it("keeps the session, emits no SIGNED_OUT, and gives up retryably in bounded time", async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    const stored = new Map<string, string>();
    stored.set(
      STORAGE_KEY,
      JSON.stringify({
        access_token: "expired-access",
        refresh_token: "refresh-1",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now - 60, // already expired: reading the session must refresh
        user: { id: "rep-1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
      }),
    );
    const storage = {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    };

    // The dead socket: the request is sent and nothing ever comes back,
    // unless it is aborted.
    const refreshSends: number[] = [];
    const deadFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      refreshSends.push(Date.now());
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });

    const client = new AuthClient({
      url: "https://x.supabase.co/auth/v1",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      storageKey: STORAGE_KEY,
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: createSessionGuardFetch({ anonKey: ANON, storageKey: STORAGE_KEY, baseFetch: deadFetch as never }),
    });
    const events: string[] = [];
    client.onAuthStateChange((event) => {
      events.push(event);
    });

    const started = Date.now();
    let settledAt = 0;
    const read = client.getSession().then((r) => {
      settledAt = Date.now();
      return r;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const { data, error } = await read;

    // Gave up retryably: no session handed out, but the error is the
    // retryable network kind, not a refusal.
    expect(data.session).toBeNull();
    expect(error?.name).toBe("AuthRetryableFetchError");
    // The stored session survives, and nothing announced a sign-out.
    expect(stored.has(STORAGE_KEY)).toBe(true);
    expect(events).not.toContain("SIGNED_OUT");
    // Bounded, and exactly as the sessionGuard comment says: each attempt is
    // cut at 8s, auth-js's own loop retries at 8.2s, 16.6s and 25.4s and then
    // gives up, so the lock is held for about 33s, not for as long as the
    // socket stays dead. (Without the deadline this read never settles.)
    expect(refreshSends.map((t) => t - started)).toEqual([0, 8200, 16600, 25400]);
    expect(settledAt - started).toBe(33_400);
  });
});
