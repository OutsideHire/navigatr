/**
 * auth.recovery.test.ts — session recovery + the tolerant onAuthStateChange
 * watcher.
 *
 * These guard the mobile-logout fix: iOS/WebKit can momentarily report "no
 * session" on resume or reload even with a valid refresh token in storage. The
 * store must (a) actively try to recover a session before the app treats it as
 * signed out, and (b) NOT wipe a held user on a transient null event — only on a
 * genuine SIGNED_OUT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// SDK auth surface — driven per test. vi.hoisted so the vi.mock factory (which
// is itself hoisted above the imports) can safely close over these. Defaults are
// seeded here because ESM hoists `import "./auth"` — and its bootstrap
// getSession() call — above any setup that runs in file body order.
const { getSession, refreshSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
}));

vi.mock("@/lib/supabase", () => ({
  AUTH_STORAGE_KEY: "navigatr-auth",
  supabase: { auth: { getSession, refreshSession, onAuthStateChange } },
}));

// Observability is lazy-imported by trackRecovery/identifyUser; stub it so we
// can assert the involuntary-logout signal without spinning up Sentry.
const { captureMessage, addBreadcrumb } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock("@/lib/observability", () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
  setUser: vi.fn(),
}));

import { useAuth, recoverSession } from "./auth";

const AUTH_STORAGE_KEY = "navigatr-auth";

/** Minimal session shape — the store only reads session.user. */
function session(id = "user-1") {
  return { access_token: "tok", user: { id, email: "u@example.com", user_metadata: {} } };
}
function ok(s: unknown) {
  return { data: { session: s }, error: null };
}
function none() {
  return { data: { session: null }, error: null };
}

/** The watcher callback the store registered at import time. */
const watcher = onAuthStateChange.mock.calls[0][0] as (
  event: string,
  s: unknown,
) => void;

// Map-backed localStorage the store's hasPersistedSession() reads through. A
// fresh one per test keeps "is a token persisted?" fully under our control.
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  return store;
}

function persistToken() {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: "x" }));
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(none());
  refreshSession.mockReset().mockResolvedValue(none());
  captureMessage.mockReset();
  addBreadcrumb.mockReset();
  useAuth.setState({ user: null, session: null, loading: false, error: null });
  installLocalStorage();
});

describe("recoverSession", () => {
  it("recovers when a fresh read returns a session (persisted token)", async () => {
    persistToken();
    getSession.mockResolvedValueOnce(ok(session()));

    const recovered = await recoverSession({ backoffMs: 0 });

    expect(recovered).toBe("recovered");
    expect(useAuth.getState().user?.id).toBe("user-1");
    expect(refreshSession).not.toHaveBeenCalled(); // read succeeded, no refresh needed
  });

  it("forces a refresh-token exchange when the read is still empty", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValueOnce(ok(session("refreshed")));

    const recovered = await recoverSession({ backoffMs: 0 });

    expect(recovered).toBe("recovered");
    expect(refreshSession).toHaveBeenCalled();
    expect(useAuth.getState().user?.id).toBe("refreshed");
  });

  it("retries across the transient window and recovers on a later attempt", async () => {
    persistToken();
    // Read empty on the first two attempts, then the session reappears.
    getSession
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(ok(session("late")));
    refreshSession.mockResolvedValue(none());

    const recovered = await recoverSession({ attempts: 3, backoffMs: 0 });

    expect(recovered).toBe("recovered");
    expect(useAuth.getState().user?.id).toBe("late");
  });

  it("gives up fast with no persisted token: one read, no refresh, no Sentry noise", async () => {
    // Nothing persisted = genuine signed-out visitor. Must not stall on retries.
    getSession.mockResolvedValue(none());

    const recovered = await recoverSession({ attempts: 3, backoffMs: 0 });

    // "no-session" and a graded failure are different answers: nothing was
    // persisted, so there is no involuntary logout to report.
    expect(recovered).toBe("no-session");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    // A plain logged-out visitor is NOT an involuntary-logout signal.
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("recovers an in-memory-only session even without a persisted token", async () => {
    // e.g. a session just parsed from an OAuth callback, not yet written to
    // storage. The single read still adopts it.
    getSession.mockResolvedValueOnce(ok(session("in-memory")));

    const recovered = await recoverSession({ backoffMs: 0 });

    expect(recovered).toBe("recovered");
    expect(useAuth.getState().user?.id).toBe("in-memory");
  });

  it("flags Sentry when a persisted token can't be recovered", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValue(none());

    const recovered = await recoverSession({ attempts: 2, backoffMs: 0 });

    // The SDK gave no reason at all, so the grade is "unknown" rather than a
    // confident "expired". Guessing "expired" here is exactly the mistake that
    // signs a rep out over a condition we never diagnosed.
    expect(recovered).toBe("unknown");
    // The rare, high-signal case: a rep WITH a token still got logged out.
    // trackRecovery reports via a lazy import("@/lib/observability"), so wait
    // for that microtask chain to settle before asserting.
    await vi.waitFor(() =>
      expect(captureMessage).toHaveBeenCalledWith(
        "Session recovery failed despite a persisted token",
        "warning",
        expect.objectContaining({ "recovery.reason": "unknown" }),
      ),
    );
  });

  it("does not hang when getSession never resolves (timeout guard)", async () => {
    // Hung SDK call: settle() resolves a timeout so recovery still settles.
    getSession.mockReturnValue(new Promise(() => {}));

    const recovered = await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 10 });

    expect(recovered).toBe("no-session");
  });
});

/**
 * The grading spec. Before this, every one of these collapsed to a single
 * `false` and the app signed the rep out for all of them alike. The whole
 * point is that "the server refused your token" and "your phone never reached
 * the server" must come back as different answers, because the UI takes
 * opposite actions on them.
 */
describe("recoverSession grades WHY it failed", () => {
  /** An auth-js style error object: what the SDK actually hands back. */
  function authError(fields: { name?: string; status?: number; message?: string }) {
    return { data: { session: null }, error: { name: "AuthApiError", ...fields } };
  }

  it("grades a refused refresh token as expired (a real sign-out)", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValue(
      authError({ status: 400, message: "Invalid Refresh Token" }),
    );

    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("expired");
    await vi.waitFor(() =>
      expect(captureMessage).toHaveBeenCalledWith(
        expect.any(String),
        "warning",
        expect.objectContaining({ "recovery.reason": "expired" }),
      ),
    );
  });

  it("grades a dead connection as transport, NOT expired", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockRejectedValue(
      Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError" }),
    );

    // This is the rep in a tunnel. Calling this "expired" is what logged them out.
    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("transport");
  });

  it("grades a 5xx from the auth endpoint as transport", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValue(authError({ status: 503, message: "Service Unavailable" }));

    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("transport");
  });

  it("grades a rate-limited refresh as transport even though 429 is a 4xx", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValue(authError({ status: 429, message: "Too Many Requests" }));

    // A quota blip says nothing about whether the token is still good, so it
    // must not be graded as a sign-out.
    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("transport");
  });

  it("grades a hung call as timeout when a token IS persisted", async () => {
    persistToken();
    getSession.mockReturnValue(new Promise(() => {}));
    refreshSession.mockReturnValue(new Promise(() => {}));

    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 })).toBe("timeout");
  });

  it("reads the reason off getSession, not only off refreshSession", async () => {
    // getSession drives its own refresh internally, so the real error often
    // surfaces on the READ. Grading only the refresh reports whatever generic
    // complaint refreshSession makes afterwards and settles nothing.
    persistToken();
    getSession.mockResolvedValue(authError({ status: 503, message: "Service Unavailable" }));
    refreshSession.mockResolvedValue(none());

    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("transport");
  });

  it("lets a definite expiry outrank a timeout seen on an earlier attempt", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession
      .mockReturnValueOnce(new Promise(() => {})) // attempt 1: no answer
      .mockResolvedValue(authError({ status: 400, message: "Invalid Refresh Token" }));

    // The server did eventually answer and refuse the token, so it really is
    // dead; an earlier silence must not soften that into "just reconnect".
    expect(await recoverSession({ attempts: 2, backoffMs: 0, timeoutMs: 5 })).toBe("expired");
  });
});

describe("onAuthStateChange watcher (tolerant)", () => {
  it("clears the user on a genuine SIGNED_OUT", () => {
    useAuth.setState({ user: session().user as never, session: session() as never });
    watcher("SIGNED_OUT", null);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().session).toBeNull();
    expect(useAuth.getState().loading).toBe(false);
  });

  it("KEEPS an existing user on a transient null session (non-sign-out event)", () => {
    // The core fix: a WebKit resume blip must not wipe a signed-in rep.
    useAuth.setState({ user: session("held").user as never, session: session("held") as never });
    watcher("TOKEN_REFRESHED", null);
    expect(useAuth.getState().user?.id).toBe("held");
    expect(useAuth.getState().loading).toBe(false);
  });

  it("adopts a session carried by any event", () => {
    watcher("TOKEN_REFRESHED", session("new"));
    expect(useAuth.getState().user?.id).toBe("new");
    expect(useAuth.getState().loading).toBe(false);
  });

  it("settles loading without a user on a cold-start empty INITIAL_SESSION", () => {
    useAuth.setState({ user: null, session: null, loading: true });
    watcher("INITIAL_SESSION", null);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().loading).toBe(false);
  });
});

describe("recoverSession is single-flight", () => {
  // Before the transport-level guard existed, recoverSession was safe only by
  // ACCIDENT: one caller (useSessionRecovery), one ProtectedRoute rendered at a
  // time. Now any query can trigger it, so a screen firing several at once must
  // still produce exactly ONE attempt. This is not just about speed: Supabase
  // rotates refresh tokens, so concurrent unserialised refreshes can invalidate
  // each other and cause the very involuntary logout this fix exists to prevent.
  it("runs ONE attempt for many concurrent callers, and resolves them all", async () => {
    installLocalStorage();
    persistToken();
    let release!: (v: unknown) => void;
    getSession.mockReset().mockImplementationOnce(
      () => new Promise((r) => { release = r as (v: unknown) => void; }),
    );

    const inFlight = [
      recoverSession(), recoverSession(), recoverSession(),
      recoverSession(), recoverSession(),
    ];
    release(ok(session()));
    const results = await Promise.all(inFlight);

    expect(results).toEqual([
      "recovered", "recovered", "recovered", "recovered", "recovered",
    ]);
    expect(getSession).toHaveBeenCalledTimes(1);
    // One read succeeded, so no refresh-token exchange should have been needed.
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("allows a fresh recovery once the previous one has settled", async () => {
    installLocalStorage();
    persistToken();
    getSession.mockReset().mockResolvedValue(ok(session()));
    await recoverSession();
    await recoverSession();
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
