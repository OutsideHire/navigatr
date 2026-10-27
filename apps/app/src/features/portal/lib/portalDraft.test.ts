import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EMPTY_DRAFT, clearPortalDraft, isEmptyDraft, portalDraftKey, readPortalDraft, writePortalDraft } from "./portalDraft";

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
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

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error("blocked");
  };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
}

function install(shim: Storage) {
  Object.defineProperty(window, "localStorage", { value: shim, writable: true, configurable: true });
}

beforeEach(() => install(memoryStorage()));
afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("portal draft", () => {
  it("keeps the employee count (FR-PORT-35)", () => {
    expect(EMPTY_DRAFT.employeeCount).toBe("");
    writePortalDraft("acme", { ...EMPTY_DRAFT, employeeCount: "11-50" });
    expect(readPortalDraft("acme")).toEqual({ ...EMPTY_DRAFT, employeeCount: "11-50" });
  });

  it("round-trips per slug", () => {
    writePortalDraft("acme", { ...EMPTY_DRAFT, companyName: "Fresh Bakery", notes: "Busy at lunch" });
    expect(readPortalDraft("acme")).toEqual({ ...EMPTY_DRAFT, companyName: "Fresh Bakery", notes: "Busy at lunch" });
    expect(readPortalDraft("other")).toEqual(EMPTY_DRAFT);
    expect(portalDraftKey("acme")).toBe("navigatr-portal-draft:acme");
  });

  it("removes the key for an all-blank draft and on clear", () => {
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "555" });
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "   " });
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();
    writePortalDraft("acme", { ...EMPTY_DRAFT, phone: "555" });
    clearPortalDraft("acme");
    expect(window.localStorage.getItem("navigatr-portal-draft:acme")).toBeNull();
  });

  it("ignores junk, unknown keys and non-string values", () => {
    window.localStorage.setItem("navigatr-portal-draft:acme", "{not json");
    expect(readPortalDraft("acme")).toEqual(EMPTY_DRAFT);
    window.localStorage.setItem("navigatr-portal-draft:acme", JSON.stringify({ companyName: 7, evil: "x", contactName: "Ann" }));
    expect(readPortalDraft("acme")).toEqual({ ...EMPTY_DRAFT, contactName: "Ann" });
  });

  it("never throws when storage is blocked", () => {
    install(throwingStorage());
    expect(() => writePortalDraft("acme", { ...EMPTY_DRAFT, companyName: "X" })).not.toThrow();
    expect(readPortalDraft("acme")).toEqual(EMPTY_DRAFT);
    expect(() => clearPortalDraft("acme")).not.toThrow();
  });

  it("knows an empty draft", () => {
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, urgency: "no_rush" })).toBe(false);
  });
});
