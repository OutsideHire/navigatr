import { describe, it, expect, beforeEach } from "vitest";

// Node's experimental global `localStorage` exists but lacks a working
// setItem in this runtime, so it shadows jsdom's and breaks Zustand persist.
// Install a real in-memory implementation before the store reads it.
const memoryStore = new Map<string, string>();
const memoryLocalStorage: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear: () => memoryStore.clear(),
  getItem: (key) => memoryStore.get(key) ?? null,
  key: (index) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key) => {
    memoryStore.delete(key);
  },
  setItem: (key, value) => {
    memoryStore.set(key, String(value));
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryLocalStorage,
});

const { usePathQueue } = await import("./usePathQueue");

describe("usePathQueue.logVisit", () => {
  beforeEach(() => usePathQueue.getState().clear());

  it("marks the stop visited and records the disposition", () => {
    const q = usePathQueue.getState();
    q.add("m-1");
    q.logVisit("m-1", "met_dm");
    const stop = usePathQueue.getState().stops.find((s) => s.merchantId === "m-1")!;
    expect(stop.status).toBe("visited");
    expect(stop.disposition).toBe("met_dm");
    expect(stop.resolvedAt).not.toBeNull();
  });

  it("new stops start with a null disposition", () => {
    usePathQueue.getState().add("m-2");
    const stop = usePathQueue.getState().stops.find((s) => s.merchantId === "m-2")!;
    expect(stop.disposition).toBeNull();
  });
});
