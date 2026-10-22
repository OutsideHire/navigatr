/**
 * auth.reconnect.test.ts: what the store does when recovery cannot get an
 * answer (TIMEOUT) versus when the session definitively ends.
 *
 * Production 2026-10 (release fdee38e): "Session recovery failed despite a
 * persisted token", every event reason=timeout, online=true, attempts=3, on
 * /dashboard, /admin/agents/:id and /path. The rep was online and holding a
 * token; auth-js simply had not answered yet. Those reps must stay in the app
 * while we keep trying, and only a definitive answer may send them to sign in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getSession, refreshSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
}));
vi.mock("@/lib/supabase", () => ({
  AUTH_STORAGE_KEY: "navigatr-auth",
  supabase: { auth: { getSession, refreshSession, onAuthStateChange } },
}));

const { captureMessage, addBreadcrumb } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock("@/lib/observability", () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
  setUser: vi.fn(),
}));

const { haltQueriesForSignOut } = vi.hoisted(() => ({ haltQueriesForSignOut: vi.fn() }));
vi.mock("@/lib/sessionQueries", () => ({ haltQueriesForSignOut }));

const { guardHooks } = vi.hoisted(() => ({ guardHooks: { current: null as null | Record<string, () => unknown> } }));
vi.mock("@/lib/sessionGuard", () => ({
  setSessionGuardHooks: (h: Record<string, () => unknown>) => { guardHooks.current = h; },
}));

import {
  useAuth,
  recoverSession,
  holdProvisionalSession,
  abandonProvisionalSession,
  bootstrapSession,
  RECOVERY_REPORT_AFTER_MS,
} from "./auth";
import { hasSessionNow } from "@/lib/sessionPresence";

const KEY = "navigatr-auth";
const watcher = onAuthStateChange.mock.calls[0][0] as (event: string, s: unknown) => void;

function session(id = "user-1") {
  return { access_token: "tok", user: { id, email: "u@example.com", user_metadata: {} } };
}
const ok = (s: unknown) => ({ data: { session: s }, error: null });
const none = () => ({ data: { session: null }, error: null });

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
/** What auth-js actually persists: the whole session, user included. */
function persistSession(id = "stored-user") {
  window.localStorage.setItem(KEY, JSON.stringify(session(id)));
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(none());
  refreshSession.mockReset().mockResolvedValue(none());
  captureMessage.mockReset();
  addBreadcrumb.mockReset();
  haltQueriesForSignOut.mockReset();
  useAuth.setState({ user: null, session: null, loading: false, error: null, reconnecting: false });
  installLocalStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("holdProvisionalSession", () => {
  it("keeps the rep in the app as the stored user and marks the store reconnecting", () => {
    persistSession("stored-user");
    expect(holdProvisionalSession()).toBe(true);
    const s = useAuth.getState();
    expect(s.user?.id).toBe("stored-user");
    expect(s.reconnecting).toBe(true);
    expect(s.loading).toBe(false);
    // No confirmed session yet: the token has not been checked.
    expect(s.session).toBeNull();
  });

  it("refuses when nothing usable is stored, so the caller falls back", () => {
    expect(holdProvisionalSession()).toBe(false);
    window.localStorage.setItem(KEY, "not json");
    expect(holdProvisionalSession()).toBe(false);
    window.localStorage.setItem(KEY, JSON.stringify({ access_token: "x" }));
    expect(holdProvisionalSession()).toBe(false);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().reconnecting).toBe(false);
  });

  it("ends when a real session arrives from the SDK", () => {
    persistSession();
    holdProvisionalSession();
    watcher("TOKEN_REFRESHED", session("fresh"));
    expect(useAuth.getState().reconnecting).toBe(false);
    expect(useAuth.getState().session).not.toBeNull();
  });

  it("ends when recovery adopts a session", async () => {
    persistSession();
    holdProvisionalSession();
    getSession.mockResolvedValueOnce(ok(session("back")));
    expect(await recoverSession({ backoffMs: 0 })).toBe("recovered");
    expect(useAuth.getState().reconnecting).toBe(false);
  });
});

describe("abandonProvisionalSession", () => {
  it("clears the held user and stops the data layer (definitive answer)", () => {
    persistSession();
    holdProvisionalSession();
    abandonProvisionalSession();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().reconnecting).toBe(false);
    expect(haltQueriesForSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("a definitive sign-out stops the data layer first", () => {
  it("halts queries on SIGNED_OUT, before the user is cleared", () => {
    useAuth.setState({ user: session().user as never, session: session() as never });
    let userAtHalt: unknown = "not called";
    haltQueriesForSignOut.mockImplementation(() => { userAtHalt = useAuth.getState().user; });
    watcher("SIGNED_OUT", null);
    expect(haltQueriesForSignOut).toHaveBeenCalledTimes(1);
    // Halted while the screens were still mounted, so nothing re-fires.
    expect(userAtHalt).not.toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it("does not halt queries on a transient null (non-sign-out) event", () => {
    useAuth.setState({ user: session().user as never, session: session() as never });
    watcher("TOKEN_REFRESHED", null);
    expect(haltQueriesForSignOut).not.toHaveBeenCalled();
  });

  it("tells the session guard to refuse anon table requests just after SIGNED_OUT, then stop", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    const refuse = guardHooks.current!.refuseAnonTableRequests as () => boolean;
    expect(refuse()).toBe(false);
    watcher("SIGNED_OUT", null);
    expect(refuse()).toBe(true);
    vi.setSystemTime(new Date("2026-10-22T12:01:00Z"));
    expect(refuse()).toBe(false);
  });
});

describe("error reporting knows whether a session is held", () => {
  it("answers no session when the store has none, yes when it has one", () => {
    useAuth.setState({ user: null, session: null });
    expect(hasSessionNow()).toBe(false);
    useAuth.setState({ user: session().user as never, session: session() as never });
    expect(hasSessionNow()).toBe(true);
  });

  it("answers no session while only holding a provisional user", () => {
    persistSession();
    holdProvisionalSession();
    expect(hasSessionNow()).toBe(false);
  });
});

describe("recoverSession keeps a late answer", () => {
  it("adopts a session that arrives after the attempt already timed out", async () => {
    persistSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(new Promise(() => {}));

    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 })).toBe("timeout");
    // auth-js finally got the lock and answered. Throwing that away is what
    // left reps on the wall even after their session was fine.
    release(ok(session("late")));
    await vi.waitFor(() => expect(useAuth.getState().user?.id).toBe("late"));
    expect(useAuth.getState().session).not.toBeNull();
  });
});

describe("the Sentry warning fires on a definitive failure or after a long wait, not on every timeout", () => {
  it("does not warn on a timeout that has not lasted long", async () => {
    persistSession();
    getSession.mockReturnValue(new Promise(() => {}));
    refreshSession.mockReturnValue(new Promise(() => {}));
    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 })).toBe("timeout");
    await new Promise((r) => setTimeout(r, 20));
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("warns once, tagged timeout, when the rep has been unresolved past the cap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    persistSession();
    // Start from a clean episode: a success ends any earlier unresolved stretch.
    getSession.mockResolvedValueOnce(ok(session()));
    await recoverSession({ backoffMs: 0 });
    useAuth.setState({ user: null, session: null });
    getSession.mockReturnValue(new Promise(() => {}));
    refreshSession.mockReturnValue(new Promise(() => {}));

    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 });
    vi.setSystemTime(new Date(Date.parse("2026-10-22T12:00:00Z") + RECOVERY_REPORT_AFTER_MS + 1000));
    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 });
    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 });

    await vi.waitFor(() => expect(captureMessage).toHaveBeenCalledTimes(1));
    expect(captureMessage).toHaveBeenCalledWith(
      "Session recovery failed despite a persisted token",
      "warning",
      expect.objectContaining({ "recovery.reason": "timeout", "recovery.online": expect.any(String) }),
    );
  });

  it("still warns at once on a definitive expiry", async () => {
    persistSession();
    refreshSession.mockResolvedValue({ data: { session: null }, error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token" } });
    expect(await recoverSession({ attempts: 1, backoffMs: 0 })).toBe("expired");
    await vi.waitFor(() =>
      expect(captureMessage).toHaveBeenCalledWith(
        expect.any(String), "warning", expect.objectContaining({ "recovery.reason": "expired" }),
      ),
    );
  });
});

describe("bootstrapSession", () => {
  it("adopts the stored session when the SDK answers in time (unchanged)", async () => {
    useAuth.setState({ loading: true });
    getSession.mockResolvedValueOnce(ok(session("booted")));
    await bootstrapSession(50);
    expect(useAuth.getState().user?.id).toBe("booted");
    expect(useAuth.getState().reconnecting).toBe(false);
    expect(useAuth.getState().loading).toBe(false);
  });

  it("on a hung SDK with a stored session, opens the app as that user and reconnects", async () => {
    useAuth.setState({ loading: true });
    persistSession("stored-user");
    getSession.mockReturnValueOnce(new Promise(() => {}));
    await bootstrapSession(5);
    expect(useAuth.getState().user?.id).toBe("stored-user");
    expect(useAuth.getState().reconnecting).toBe(true);
    expect(useAuth.getState().loading).toBe(false);
  });

  it("on a hung SDK with nothing stored, settles signed out as before", async () => {
    useAuth.setState({ loading: true });
    getSession.mockReturnValueOnce(new Promise(() => {}));
    await bootstrapSession(5);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().reconnecting).toBe(false);
    expect(useAuth.getState().loading).toBe(false);
  });

  it("adopts the SDK's answer when it arrives after the boot gave up waiting", async () => {
    useAuth.setState({ loading: true });
    persistSession("stored-user");
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    await bootstrapSession(5);
    release(ok(session("confirmed")));
    await vi.waitFor(() => expect(useAuth.getState().user?.id).toBe("confirmed"));
    expect(useAuth.getState().reconnecting).toBe(false);
  });
});
