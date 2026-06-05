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
