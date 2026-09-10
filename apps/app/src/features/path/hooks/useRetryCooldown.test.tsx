/**
 * useRetryCooldown.test.tsx: the retry cooldown that stops reps from mashing
 * the discovery "Retry" button and re-firing the Places fan-out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRetryCooldown } from "./useRetryCooldown";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useRetryCooldown", () => {
  it("is not cooling before arm() is called", () => {
    const { result } = renderHook(() => useRetryCooldown(20));
    expect(result.current.cooling).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it("cools for the configured seconds after arm(), then releases", () => {
    const { result } = renderHook(() => useRetryCooldown(20));

    act(() => result.current.arm());
    expect(result.current.cooling).toBe(true);
    expect(result.current.remaining).toBe(20);

    // Halfway through: still cooling, counting down. (Fake timers advance
    // Date.now() too, so advanceTimersByTime is the only clock we move.)
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.cooling).toBe(true);
    expect(result.current.remaining).toBe(10);

    // Past the end: released.
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.cooling).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it("arm() restarts the cooldown from full", () => {
    const { result } = renderHook(() => useRetryCooldown(20));
    act(() => result.current.arm());
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.remaining).toBe(5);
    // Re-arm at t=15s -> full 20s again.
    act(() => result.current.arm());
    expect(result.current.remaining).toBe(20);
    expect(result.current.cooling).toBe(true);
  });

  it("stops its timer on unmount (no lingering interval)", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { result, unmount } = renderHook(() => useRetryCooldown(20));
    act(() => result.current.arm());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
