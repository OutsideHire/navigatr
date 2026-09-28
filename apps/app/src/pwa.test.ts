import { describe, it, expect, vi, beforeEach } from "vitest";

const registerSW = vi.fn();
vi.mock("virtual:pwa-register", () => ({ registerSW: (opts: unknown) => registerSW(opts) }));

// The pwa module registers at import time and is import-cached, so registerSW is
// only called once across the whole file. We capture the options object on the
// first import and reuse it; the tests are ordered so each one leaves the
// module's internal `pendingUpdate` back at false (every test that sets it also
// applies it), keeping them independent despite the shared module state.
type RegisterOpts = {
  immediate: boolean;
  onNeedRefresh: () => void;
  onRegisteredSW: (url: string, reg?: unknown) => void;
};
let opts: RegisterOpts;
const mockUpdate = vi.fn(async () => {});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}
function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => { mockUpdate.mockClear(); });

describe("pwa auto-update", () => {
  it("registers the service worker once, immediately", async () => {
    registerSW.mockReturnValue(mockUpdate);
    await import("./pwa"); // import runs registerSW(opts) at module load
    expect(registerSW).toHaveBeenCalledTimes(1);
    opts = registerSW.mock.calls[0][0] as RegisterOpts;
    expect(opts.immediate).toBe(true);
  });

  it("applies a new version immediately (and silently) when detected in the background", async () => {
    await import("./pwa");
    setVisibility("hidden");
    opts.onNeedRefresh();
    // Auto skip-waiting + reload to the new bundle; no user prompt.
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  it("does not reload while the app is in the foreground, then applies on background", async () => {
    await import("./pwa");
    setVisibility("visible");
    opts.onNeedRefresh();
    // Never interrupts active use (protects unsaved input): no reload yet.
    expect(mockUpdate).not.toHaveBeenCalled();
    // Backgrounding the app is the safe, invisible moment to apply it.
    setVisibility("hidden");
    fireVisibilityChange();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  it("applies a foreground-detected update when the app is reopened, before interaction", async () => {
    await import("./pwa");
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    setVisibility("visible");
    opts.onNeedRefresh(); // detected in foreground -> pending, not applied
    expect(mockUpdate).not.toHaveBeenCalled();
    // Returning to the app checks for a newer SW and applies the pending one.
    fireVisibilityChange();
    expect((reg as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  // Suppressing update-check noise must not be able to break the update
  // mechanism it decorates. All three run inside the visibilitychange listener,
  // where anything thrown would skip applyUpdate() below it and a pending
  // deploy would never land.

  // NOT COVERED HERE, deliberately: that a REJECTED update check does not
  // escape as an unhandled rejection. vitest intercepts process-level
  // unhandled rejections for its own reporter, so a test asserting their
  // absence passes against the pre-change source too, i.e. it proves nothing.
  // Verified rather than assumed: both shapes of that assertion were written
  // and both stayed green on `git show origin/main:apps/app/src/pwa.ts`.
  // The `.catch()` in checkForUpdate is what handles it; the two tests below
  // cover the parts that ARE observable from here.

  // The synchronous hazard, and the one that costs a rep a stale build: a
  // registration whose update() THROWS rather than rejecting. On the old
  // handler this escapes the listener and applyUpdate() below it never runs.
  it("still applies a pending update when update() throws synchronously", async () => {
    await import("./pwa");
    const reg = {
      update: vi.fn(() => { throw new TypeError("Illegal invocation"); }),
    } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    setVisibility("visible");
    opts.onNeedRefresh();
    fireVisibilityChange();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  // This one guards a bug introduced and fixed WITHIN this change rather than
  // one that ever shipped: a bare `reg.update().catch(...)` blows up on a
  // registration whose update() returns nothing, which is exactly what the
  // mocks above do. Keeps the Promise.resolve wrapper from being "simplified"
  // back out.
  it("still applies a pending update when update() returns no promise at all", async () => {
    await import("./pwa");
    const reg = { update: vi.fn(() => undefined) } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    setVisibility("visible");
    opts.onNeedRefresh();
    fireVisibilityChange();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  it("schedules a periodic update check when the SW registers", async () => {
    const setInt = vi.spyOn(globalThis, "setInterval");
    await import("./pwa");
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    expect(setInt).toHaveBeenCalled();
    setInt.mockRestore();
  });

  it("never reloads mid-auth-handoff, then applies once the user is off /auth", async () => {
    const { isAuthHandoffPath } = await import("./pwa");
    // Pure predicate: only the /auth/* handoff routes are protected.
    expect(isAuthHandoffPath("/auth/callback")).toBe(true);
    expect(isAuthHandoffPath("/dashboard")).toBe(false);
    expect(isAuthHandoffPath("/login")).toBe(false);

    // On the OAuth callback, a detected update must NOT reload (it would re-run
    // the app mid-PKCE exchange and can drop the session).
    history.pushState({}, "", "/auth/callback");
    setVisibility("hidden");
    opts.onNeedRefresh();
    expect(mockUpdate).not.toHaveBeenCalled();

    // Once the user lands on a normal route, the still-pending update applies at
    // the next visibility change, leaving module state clean for later tests.
    history.pushState({}, "", "/dashboard");
    fireVisibilityChange();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });
});
