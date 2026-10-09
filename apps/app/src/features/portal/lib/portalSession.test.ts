import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearPortalSession, portalSessionKey, readPortalSession, writePortalSession } from "./portalSession";

// Node 25 ships a broken global localStorage, so install an in-memory Storage
// per test and restore the original afterwards (same approach as CookieBanner.test.tsx).
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function install(shim: Storage) {
  Object.defineProperty(window, "localStorage", { value: shim, writable: true, configurable: true });
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error("blocked");
  };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
}

function storedKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) out.push(window.localStorage.key(i) as string);
  return out;
}

beforeEach(() => {
  install(memoryStorage());
});
afterEach(() => {
  clearPortalSession("acme");
  clearPortalSession("beta");
  if (origLocalStorage) install(origLocalStorage);
});

describe("portal session storage", () => {
  it("keeps one session per slug under a portal-only key", () => {
    writePortalSession("acme", "t1");
    writePortalSession("beta", "t2");
    expect(portalSessionKey("acme")).toBe("navigatr-portal-session:acme");
    expect(localStorage.getItem("navigatr-portal-session:acme")).toBe("t1");
    expect(readPortalSession("beta")).toBe("t2");
    expect(storedKeys().every((k) => k.startsWith("navigatr-portal-session:"))).toBe(true);
  });

  it("clears a session", () => {
    writePortalSession("acme", "t1");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readPortalSession("acme")).toBeNull();
  });

  it("falls back to memory when storage throws (private mode)", () => {
    install(throwingStorage());
    writePortalSession("acme", "t3");
    expect(readPortalSession("acme")).toBe("t3");
    clearPortalSession("acme");
    expect(readPortalSession("acme")).toBeNull();
  });
});
