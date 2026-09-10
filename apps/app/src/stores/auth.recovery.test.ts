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

    expect(recovered).toBe(true);
    expect(useAuth.getState().user?.id).toBe("user-1");
    expect(refreshSession).not.toHaveBeenCalled(); // read succeeded, no refresh needed
  });

  it("forces a refresh-token exchange when the read is still empty", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValueOnce(ok(session("refreshed")));

    const recovered = await recoverSession({ backoffMs: 0 });

    expect(recovered).toBe(true);
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

    expect(recovered).toBe(true);
    expect(useAuth.getState().user?.id).toBe("late");
  });

  it("gives up fast with no persisted token: one read, no refresh, no Sentry noise", async () => {
    // Nothing persisted = genuine signed-out visitor. Must not stall on retries.
    getSession.mockResolvedValue(none());

    const recovered = await recoverSession({ attempts: 3, backoffMs: 0 });

    expect(recovered).toBe(false);
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

    expect(recovered).toBe(true);
    expect(useAuth.getState().user?.id).toBe("in-memory");
  });

  it("returns false and flags Sentry when a persisted token can't be recovered", async () => {
    persistToken();
    getSession.mockResolvedValue(none());
    refreshSession.mockResolvedValue(none());

    const recovered = await recoverSession({ attempts: 2, backoffMs: 0 });

    expect(recovered).toBe(false);
    // The rare, high-signal case: a rep WITH a token still got logged out.
    // trackRecovery reports via a lazy import("@/lib/observability"), so wait
    // for that microtask chain to settle before asserting.
    await vi.waitFor(() =>
      expect(captureMessage).toHaveBeenCalledWith(
        "Session recovery failed despite a persisted token",
        "warning",
      ),
    );
  });

  it("does not hang when getSession never resolves (timeout guard)", async () => {
    // Hung SDK call: withTimeout resolves null so recovery still settles.
    getSession.mockReturnValue(new Promise(() => {}));

    const recovered = await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 10 });

    expect(recovered).toBe(false);
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
