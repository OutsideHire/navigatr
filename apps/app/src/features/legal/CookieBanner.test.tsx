/**
 * CookieBanner — verifies first-visit visibility, accept/reject persistence,
 * dismissal, and the useCookieConsent hook contract.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// This project's vitest env doesn't ship a fully-functional jsdom
// localStorage (setItem/removeItem are missing). Replace window.localStorage
// with a small in-memory map for these tests. Restore the original at
// teardown so other tests aren't affected.
const _origLocalStorage = (() => {
  try { return window.localStorage; } catch { return undefined; }
})();

function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, value); },
  };
  Object.defineProperty(window, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}

function restoreLocalStorage() {
  if (_origLocalStorage) {
    Object.defineProperty(window, "localStorage", {
      value: _origLocalStorage,
      writable: true,
      configurable: true,
    });
  }
}

import {
  CookieBanner,
  loadConsent,
  useCookieConsent,
} from "./CookieBanner";

const STORAGE_KEY = "navigatr:cookie-consent";

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  installLocalStorageShim();
});

afterEach(() => {
  restoreLocalStorage();
});

describe("CookieBanner — first-visit visibility", () => {
  it("renders the banner when no consent has been recorded", () => {
    renderBanner();
    expect(screen.getByRole("dialog", { name: /cookies/i })).toBeInTheDocument();
  });

  it("does not render the banner when a current consent already exists", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        decided_at: "2026-05-29T00:00:00Z",
        categories: { essential: true, analytics: true },
      }),
    );
    renderBanner();
    expect(screen.queryByRole("dialog", { name: /cookies/i })).toBeNull();
  });

  it("re-renders the banner when the persisted consent schema is outdated (v=0)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 0, // older schema → treat as no decision
        decided_at: "2026-01-01T00:00:00Z",
        categories: { essential: true, analytics: true },
      }),
    );
    renderBanner();
    expect(screen.getByRole("dialog", { name: /cookies/i })).toBeInTheDocument();
  });
});

describe("CookieBanner — accept / reject flow", () => {
  it("'Accept all' persists analytics=true and hides the banner", () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    const stored = loadConsent();
    expect(stored).not.toBeNull();
    expect(stored!.categories.essential).toBe(true);
    expect(stored!.categories.analytics).toBe(true);
    expect(screen.queryByRole("dialog", { name: /cookies/i })).toBeNull();
  });

  it("'Essential only' persists analytics=false and hides the banner", () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /essential only/i }));
    const stored = loadConsent();
    expect(stored!.categories.analytics).toBe(false);
    expect(stored!.categories.essential).toBe(true);
    expect(screen.queryByRole("dialog", { name: /cookies/i })).toBeNull();
  });

  it("close (X) dismiss saves an essential-only decision", () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    const stored = loadConsent();
    expect(stored!.categories.analytics).toBe(false);
  });

  it("decided_at is a parseable ISO timestamp", () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    const stored = loadConsent();
    expect(stored!.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isFinite(Date.parse(stored!.decided_at))).toBe(true);
  });
});

describe("useCookieConsent hook", () => {
  it("returns null when no consent is stored", () => {
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current).toBeNull();
  });

  it("returns the stored consent when one exists", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        decided_at: "2026-05-29T00:00:00Z",
        categories: { essential: true, analytics: false },
      }),
    );
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current?.categories.analytics).toBe(false);
  });

  it("re-renders when the banner dispatches the consent event", () => {
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current).toBeNull();

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          decided_at: "2026-05-29T00:00:00Z",
          categories: { essential: true, analytics: true },
        }),
      );
      window.dispatchEvent(new Event("navigatr:cookie-consent"));
    });

    expect(result.current?.categories.analytics).toBe(true);
  });
});
