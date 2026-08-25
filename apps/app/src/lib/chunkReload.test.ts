import { describe, it, expect, vi } from "vitest";
import { installChunkReloadHandler } from "./chunkReload";

function makeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
  };
}

describe("installChunkReloadHandler", () => {
  it("reloads once when a vite:preloadError fires", () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const storage = makeStorage();
    installChunkReloadHandler({ target, reload, storage, now: () => 1000 });

    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again within the cooldown (no reload loop)", () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const storage = makeStorage();
    let t = 1000;
    installChunkReloadHandler({ target, reload, storage, now: () => t });

    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);

    t = 5000; // still within the 10s cooldown
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1); // suppressed
  });

  it("reloads again once the cooldown has elapsed", () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const storage = makeStorage();
    let t = 1000;
    installChunkReloadHandler({ target, reload, storage, now: () => t });

    target.dispatchEvent(new Event("vite:preloadError"));
    t = 1000 + 11_000; // past the cooldown
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
