import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearInviteToken, inviteTokenKey, readInviteToken, writeInviteToken } from "./portalInviteToken";

// Node 25's global web storage is unreliable under vitest: install an in-memory sessionStorage per test.
const origSessionStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();

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

function install(shim: Storage) {
  Object.defineProperty(window, "sessionStorage", { value: shim, writable: true, configurable: true });
}

beforeEach(() => install(memoryStorage()));
afterEach(() => {
  Object.defineProperty(window, "sessionStorage", { value: origSessionStorage, writable: true, configurable: true });
});

describe("pending invite token", () => {
  it("keeps the token per slug for this tab and clears it", () => {
    expect(inviteTokenKey("acme")).toBe("navigatr-portal-invite:acme");
    writeInviteToken("acme", "tok-1");
    expect(readInviteToken("acme")).toBe("tok-1");
    expect(readInviteToken("other")).toBeNull();
    clearInviteToken("acme");
    expect(readInviteToken("acme")).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    install({ length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom });
    expect(() => writeInviteToken("acme", "t")).not.toThrow();
    expect(readInviteToken("acme")).toBeNull();
    expect(() => clearInviteToken("acme")).not.toThrow();
  });
});
