import { describe, it, expect, vi, beforeEach } from "vitest";

const registerSW = vi.fn();
vi.mock("virtual:pwa-register", () => ({ registerSW: (opts: unknown) => registerSW(opts) }));
const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));

// The pwa module registers at import time and is import-cached, so registerSW is
// only called once across the whole file. Capture the options object the first
// time and reuse it — `beforeEach` resets the toast spy each test but the captured
// opts (and their closures over the real module state) survive.
type RegisterOpts = {
  immediate: boolean;
  onNeedRefresh: () => void;
  onRegisteredSW: (url: string, reg?: unknown) => void;
};
let capturedOpts: RegisterOpts | undefined;
const mockUpdate = vi.fn(async () => {});

beforeEach(() => { toast.mockReset(); });

describe("pwa update prompt", () => {
  it("shows a Refresh toast on a new version and applies it via updateSW(true)", async () => {
    registerSW.mockReturnValue(mockUpdate);
    await import("./pwa"); // import runs registerSW(opts) at module load
    expect(registerSW).toHaveBeenCalledTimes(1);
    capturedOpts = registerSW.mock.calls[0][0] as RegisterOpts;
    const opts = capturedOpts;
    expect(opts.immediate).toBe(true);

    opts.onNeedRefresh();
    expect(toast).toHaveBeenCalledTimes(1);
    const [msg, cfg] = toast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(String(msg)).toMatch(/new version|update/i);
    expect(cfg.action.label).toMatch(/refresh/i);
    cfg.action.onClick();
    expect(mockUpdate).toHaveBeenCalledWith(true);
  });

  it("schedules a periodic update check when the SW registers", async () => {
    const setInt = vi.spyOn(globalThis, "setInterval");
    const mod = await import("./pwa"); // cached from the first test's import — opts already captured
    void mod;
    const opts = capturedOpts as { onRegisteredSW: (url: string, reg?: unknown) => void };
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    expect(setInt).toHaveBeenCalled();
    setInt.mockRestore();
  });
});

// Re-uses the same import-cached module + capturedOpts as the suite above. Note the
// module's `visibilitychange` listener was registered once at import; it closes over
// the live module state (`registration`, `pendingUpdate`). By the time these run,
// the prior suite has already set `pendingUpdate = true` (test 1's onNeedRefresh) and
// `registration` to a `{ update }` reg (test 2's onRegisteredSW). We rebind the
// module's `registration` here by re-invoking onRegisteredSW with a fresh spy so the
// listener calls *our* reg.
describe("pwa update checks on tab focus", () => {
  const goVisible = () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("checks for a newer SW when the tab becomes visible", async () => {
    await import("./pwa");
    const opts = capturedOpts as { onRegisteredSW: (url: string, reg?: unknown) => void };
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg); // rebinds module-scoped `registration` to this reg
    goVisible();
    expect((reg as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();
  });

  it("does nothing on visibilitychange when the tab is hidden", async () => {
    await import("./pwa");
    const opts = capturedOpts as { onRegisteredSW: (url: string, reg?: unknown) => void };
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect((reg as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("re-surfaces the Refresh toast on focus when an update is pending", async () => {
    await import("./pwa");
    const opts = capturedOpts as {
      onNeedRefresh: () => void;
      onRegisteredSW: (url: string, reg?: unknown) => void;
    };
    const reg = { update: vi.fn() } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW("/sw.js", reg);
    opts.onNeedRefresh(); // latch pendingUpdate = true; also shows the toast once
    toast.mockReset(); // simulate the user dismissing the toast: clear the spy
    goVisible();
    // The re-shown prompt: same Refresh action + stable id so it replaces, not stacks.
    expect(toast).toHaveBeenCalled();
    const [, cfg] = toast.mock.calls[0] as [string, { id: string; action: { label: string } }];
    expect(cfg.id).toBe("pwa-update");
    expect(cfg.action.label).toMatch(/refresh/i);
  });
});
