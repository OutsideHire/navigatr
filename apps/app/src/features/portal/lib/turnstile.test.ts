import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TURNSTILE_SCRIPT_URL, loadTurnstile, resetTurnstileLoader, turnstileSiteKey, type TurnstileApi } from "./turnstile";

const FAKE: TurnstileApi = { render: vi.fn(() => "w1"), remove: vi.fn() };

function scripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`));
}

beforeEach(() => {
  resetTurnstileLoader();
  delete window.turnstile;
  scripts().forEach((s) => s.remove());
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe("loadTurnstile", () => {
  it("resolves at once when the script is already on the page", async () => {
    window.turnstile = FAKE;
    await expect(loadTurnstile()).resolves.toBe(FAKE);
    expect(scripts()).toHaveLength(0);
  });

  it("adds the script once, explicitly rendered, and resolves when it loads", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);
    window.turnstile = FAKE;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(FAKE);
    await expect(second).resolves.toBe(FAKE);
  });

  it("rejects when the script fails, and tries again next time", async () => {
    const failed = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow("turnstile_load_failed");
    expect(scripts()).toHaveLength(0);
    const retry = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    window.turnstile = FAKE;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(FAKE);
  });

  it("rejects when the script loads without the API", async () => {
    const p = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(p).rejects.toThrow("turnstile_missing");
  });
});

describe("turnstileSiteKey", () => {
  it("reads VITE_TURNSTILE_SITE_KEY, trimmed, and is empty when unset", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", " 1x00000000000000000000AA ");
    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBe("");
  });
});
