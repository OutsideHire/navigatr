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

  it("schedules a periodic update check when the SW registers", async () => {
    const setInt = vi.spyOn(globalThis, "setInterval");
    await import("./pwa");
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    expect(setInt).toHaveBeenCalled();
    setInt.mockRestore();
  });
});
