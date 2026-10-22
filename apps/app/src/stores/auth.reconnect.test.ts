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

const { getSession, refreshSession, onAuthStateChange, sdkSignOut } = vi.hoisted(() => ({
  sdkSignOut: vi.fn().mockResolvedValue({ error: null }),
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
}));
vi.mock("@/lib/supabase", () => ({
  AUTH_STORAGE_KEY: "navigatr-auth",
  supabase: { auth: { getSession, refreshSession, onAuthStateChange, signOut: sdkSignOut } },
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

const { haltQueriesForSignOut, refetchFailedQueries } = vi.hoisted(() => ({
  haltQueriesForSignOut: vi.fn(),
  refetchFailedQueries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sessionQueries", () => ({ haltQueriesForSignOut, refetchFailedQueries }));

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
  SIGN_OUT_TIMEOUT_MS,
} from "./auth";
import { appBelievesSignedIn } from "@/lib/sessionPresence";

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

// Hung SDK calls are released after each test. Recovery keeps a handle on an
// outstanding timed-out call (I2) and will not pile new calls on top of it, so
// a promise left hanging forever would leak into the next test.
const hung: Array<(v: unknown) => void> = [];
function hang<T = never>(): Promise<T> {
  return new Promise<T>((resolve) => { hung.push(resolve as (v: unknown) => void); });
}
afterEach(async () => {
  vi.useRealTimers();
  hung.splice(0).forEach((release) => release({ data: { session: null }, error: null }));
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(none());
  refreshSession.mockReset().mockResolvedValue(none());
  sdkSignOut.mockReset().mockResolvedValue({ error: null });
  captureMessage.mockReset();
  addBreadcrumb.mockReset();
  haltQueriesForSignOut.mockReset();
  refetchFailedQueries.mockReset().mockResolvedValue(undefined);
  useAuth.setState({ user: null, session: null, loading: false, error: null, reconnecting: false });
  installLocalStorage();
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

describe("error reporting knows whether the app believes a user is signed in", () => {
  it("answers no once the store has let go of the user, yes while it shows one", () => {
    useAuth.setState({ user: null, session: null });
    expect(appBelievesSignedIn()).toBe(false);
    useAuth.setState({ user: session().user as never, session: session() as never });
    expect(appBelievesSignedIn()).toBe(true);
  });

  it("answers yes for a user shown without a confirmed session (an anon 42501 then is the #185 signal and must report)", () => {
    // Covers the held-on-stored-session case and the SDK having dropped the
    // session while the store still shows the rep: a request leaving as anon
    // there means the token failed to attach, which we must keep seeing.
    persistSession();
    holdProvisionalSession();
    expect(appBelievesSignedIn()).toBe(true);
    useAuth.setState({ user: session().user as never, session: null, reconnecting: false });
    expect(appBelievesSignedIn()).toBe(true);
  });
});

describe("recoverSession keeps a late answer", () => {
  it("adopts a session that arrives after the attempt already timed out", async () => {
    persistSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(hang());

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
    getSession.mockReturnValue(hang());
    refreshSession.mockReturnValue(hang());
    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 })).toBe("timeout");
    // trackRecovery reports through a lazy import; wait for it to land rather
    // than for an arbitrary stretch of real time, so the absence is real.
    await vi.dynamicImportSettled();
    expect(addBreadcrumb).toHaveBeenCalled();
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
    getSession.mockReturnValue(hang());
    refreshSession.mockReturnValue(hang());

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
    getSession.mockReturnValueOnce(hang());
    await bootstrapSession(5);
    expect(useAuth.getState().user?.id).toBe("stored-user");
    expect(useAuth.getState().reconnecting).toBe(true);
    expect(useAuth.getState().loading).toBe(false);
  });

  it("on a hung SDK with nothing stored, settles signed out as before", async () => {
    useAuth.setState({ loading: true });
    getSession.mockReturnValueOnce(hang());
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

/**
 * C1 (review): screens that failed while held must reload however the hold
 * ends. auth-js's own retry or visibility handler emits TOKEN_REFRESHED, a late
 * getSession answer is adopted, the boot read lands late: none of those went
 * through useReconnect, so the rep was left on "Could not load your profile".
 */
describe("ending a hold with a session reloads the failed screens", () => {
  it("on TOKEN_REFRESHED from auth-js while reconnecting", () => {
    persistSession();
    holdProvisionalSession();
    watcher("TOKEN_REFRESHED", session("fresh"));
    expect(refetchFailedQueries).toHaveBeenCalledTimes(1);
  });

  it("on a late answer adopted after a timed-out attempt", async () => {
    persistSession();
    holdProvisionalSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(hang());
    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 });
    release(ok(session("late")));
    await vi.waitFor(() => expect(refetchFailedQueries).toHaveBeenCalledTimes(1));
  });

  it("not on an ordinary token refresh (nothing was held)", () => {
    useAuth.setState({ user: session().user as never, session: session() as never });
    watcher("TOKEN_REFRESHED", session("fresh"));
    expect(refetchFailedQueries).not.toHaveBeenCalled();
  });
});

/**
 * I1 (review): signing out while held did nothing. supabase.auth.signOut()
 * queues behind the same stuck auth lock, then refreshes again, fails
 * retryably and returns {error} WITHOUT removing the session or emitting
 * SIGNED_OUT. Sign-out must finish on this device regardless.
 */
describe("signOut finishes on the device even when auth-js cannot answer", () => {
  function storedKeys(): string[] {
    return [KEY, `${KEY}-code-verifier`, `${KEY}-user`].filter((k) => window.localStorage.getItem(k) !== null);
  }
  function persistAll() {
    persistSession();
    window.localStorage.setItem(`${KEY}-code-verifier`, "v");
    window.localStorage.setItem(`${KEY}-user`, "{}");
  }

  it("while reconnecting: wipes the stored session at once and signs out", async () => {
    persistAll();
    holdProvisionalSession();
    sdkSignOut.mockReturnValue(hang());

    await useAuth.getState().signOut();

    expect(storedKeys()).toEqual([]);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().reconnecting).toBe(false);
    expect(haltQueriesForSignOut).toHaveBeenCalledTimes(1);
  });

  it("when the SDK sign-out does not answer in time: signs out locally", async () => {
    vi.useFakeTimers();
    persistAll();
    useAuth.setState({ user: session().user as never, session: session() as never });
    sdkSignOut.mockReturnValue(hang());

    const done = useAuth.getState().signOut();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS);
    await done;

    expect(storedKeys()).toEqual([]);
    expect(useAuth.getState().user).toBeNull();
  });

  it("when the SDK sign-out fails retryably: signs out locally instead of throwing", async () => {
    persistAll();
    useAuth.setState({ user: session().user as never, session: session() as never });
    sdkSignOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } });

    await expect(useAuth.getState().signOut()).resolves.toBeUndefined();
    expect(storedKeys()).toEqual([]);
    expect(useAuth.getState().user).toBeNull();
  });

  it("a definite server refusal still surfaces as before", async () => {
    persistAll();
    useAuth.setState({ user: session().user as never, session: session() as never });
    const refusal = { name: "AuthApiError", status: 422, message: "nope" };
    sdkSignOut.mockResolvedValue({ error: refusal });

    await expect(useAuth.getState().signOut()).rejects.toBe(refusal);
    expect(storedKeys()).toHaveLength(3);
  });

  it("after a local sign-out, a late SDK answer or refresh event does not bring the rep back", async () => {
    persistAll();
    holdProvisionalSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(hang());
    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 5 });
    sdkSignOut.mockReturnValue(hang());

    await useAuth.getState().signOut();
    release(ok(session("stale")));
    watcher("TOKEN_REFRESHED", session("stale"));
    await new Promise((r) => setTimeout(r, 0));

    expect(useAuth.getState().user).toBeNull();
  });

  it("a fresh sign-in after a local sign-out is accepted", async () => {
    persistAll();
    holdProvisionalSession();
    sdkSignOut.mockReturnValue(hang());
    await useAuth.getState().signOut();

    watcher("SIGNED_IN", session("fresh"));
    expect(useAuth.getState().user?.id).toBe("fresh");
    watcher("TOKEN_REFRESHED", session("fresh"));
    expect(useAuth.getState().session).not.toBeNull();
  });

  it("while reconnecting, does not queue an SDK sign-out behind the stuck lock", async () => {
    // A queued sign-out would run whenever the lock frees, against whatever
    // session is stored THEN, which could be a fresh sign-in.
    persistAll();
    holdProvisionalSession();
    await useAuth.getState().signOut();
    expect(sdkSignOut).not.toHaveBeenCalled();
  });

  it("if auth-js's stuck refresh later writes the session back, it is wiped again and ignored", async () => {
    persistAll();
    holdProvisionalSession();
    await useAuth.getState().signOut();

    persistSession("stale");
    watcher("TOKEN_REFRESHED", session("stale"));

    expect(storedKeys()).toEqual([]);
    expect(useAuth.getState().user).toBeNull();
  });

  it("after a timed-out SDK sign-out, wipes again if that call later fails and left a session", async () => {
    vi.useFakeTimers();
    persistAll();
    useAuth.setState({ user: session().user as never, session: session() as never });
    let finish!: (v: unknown) => void;
    sdkSignOut.mockReturnValue(new Promise((r) => { finish = r; }));
    const done = useAuth.getState().signOut();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS);
    await done;

    persistSession("stale");
    finish({ error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(storedKeys()).toEqual([]);
  });
});

/**
 * I2 (review): a timed-out getSession/refreshSession is not cancelled; auth-js
 * keeps it queued behind its lock. Every new recovery run used to add more, so
 * when the link came back they burst into back-to-back token rotations.
 * While one is outstanding, recovery waits on it instead of adding another.
 */
describe("recovery never stacks SDK calls behind a stuck lock", () => {
  it("N runs against a stuck SDK add at most one outstanding call", async () => {
    persistSession();
    getSession.mockReturnValue(hang());
    refreshSession.mockReturnValue(hang());

    for (let n = 0; n < 5; n++) {
      expect(await recoverSession({ attempts: 3, backoffMs: 0, timeoutMs: 2 })).toBe("timeout");
    }

    expect(getSession.mock.calls.length + refreshSession.mock.calls.length).toBe(1);
  });

  it("uses the outstanding call's answer when it lands, without a new call", async () => {
    persistSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(hang());
    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 2 })).toBe("timeout");

    const next = recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 50 });
    release(ok(session("landed")));
    expect(await next).toBe("recovered");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("issues fresh calls again once the outstanding one has settled", async () => {
    persistSession();
    let release!: (v: unknown) => void;
    getSession.mockReturnValueOnce(new Promise((r) => { release = r; }));
    refreshSession.mockReturnValue(hang());
    await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 2 });
    release(none());
    await new Promise((r) => setTimeout(r, 0));

    getSession.mockResolvedValueOnce(ok(session("fresh")));
    expect(await recoverSession({ attempts: 1, backoffMs: 0, timeoutMs: 50 })).toBe("recovered");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("counts a hung boot read as the outstanding call too", async () => {
    useAuth.setState({ loading: true });
    persistSession();
    getSession.mockReturnValue(hang());
    refreshSession.mockReturnValue(hang());
    await bootstrapSession(2);
    await recoverSession({ attempts: 2, backoffMs: 0, timeoutMs: 2 });
    expect(getSession.mock.calls.length + refreshSession.mock.calls.length).toBe(1);
  });
});
