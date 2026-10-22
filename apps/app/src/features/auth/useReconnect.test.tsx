/**
 * useReconnect: while the rep is held in the app on their stored session
 * (auth-js did not answer in time), keep trying in the background until the
 * session is confirmed or definitively over. Production 2026-10: online reps
 * were left on a wall that only retried on `online` (never fires when already
 * online), so they tapped "Sign in again" and landed on /login.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { recoverSession, abandonProvisionalSession } = vi.hoisted(() => ({
  recoverSession: vi.fn(),
  abandonProvisionalSession: vi.fn(),
}));
vi.mock("@/stores/auth", () => ({ recoverSession, abandonProvisionalSession }));
const { refetchFailedQueries } = vi.hoisted(() => ({ refetchFailedQueries: vi.fn() }));
vi.mock("@/lib/sessionQueries", () => ({ refetchFailedQueries }));

import { useReconnect, reconnectDelayMs } from "./useReconnect";

beforeEach(() => {
  vi.useFakeTimers();
  recoverSession.mockReset();
  abandonProvisionalSession.mockReset();
  refetchFailedQueries.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

/** Let the timer fire and the recovery promise settle. */
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("reconnectDelayMs", () => {
  it("backs off and caps", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe("useReconnect", () => {
  it("does nothing while not reconnecting", async () => {
    renderHook(() => useReconnect(false));
    await advance(120_000);
    expect(recoverSession).not.toHaveBeenCalled();
  });

  it("keeps retrying with backoff while auth-js has not answered, then reloads failed screens on success", async () => {
    recoverSession
      .mockResolvedValueOnce("timeout")
      .mockResolvedValueOnce("timeout")
      .mockResolvedValueOnce("recovered");
    renderHook(() => useReconnect(true));

    await advance(2000);
    expect(recoverSession).toHaveBeenCalledTimes(1);
    expect(recoverSession).toHaveBeenCalledWith(expect.objectContaining({ caller: "protected_route" }));
    await advance(4000);
    expect(recoverSession).toHaveBeenCalledTimes(2);
    await advance(8000);
    expect(recoverSession).toHaveBeenCalledTimes(3);

    expect(refetchFailedQueries).toHaveBeenCalledTimes(1);
    expect(abandonProvisionalSession).not.toHaveBeenCalled();
    // Recovered: no further attempts.
    await advance(120_000);
    expect(recoverSession).toHaveBeenCalledTimes(3);
  });

  it.each(["expired", "unknown", "no-session"])(
    "gives the rep up to sign-in on a definitive answer (%s)",
    async (outcome) => {
      recoverSession.mockResolvedValueOnce(outcome);
      renderHook(() => useReconnect(true));
      await advance(2000);
      expect(abandonProvisionalSession).toHaveBeenCalledTimes(1);
      await advance(120_000);
      expect(recoverSession).toHaveBeenCalledTimes(1);
    },
  );

  it("tries at once when the connection comes back or the rep returns to the app", async () => {
    recoverSession.mockResolvedValue("transport");
    renderHook(() => useReconnect(true));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await advance(0);
    expect(recoverSession).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(0);
    expect(recoverSession).toHaveBeenCalledTimes(2);
  });

  it("stops when the hold ends from elsewhere (a real session arrived)", async () => {
    recoverSession.mockResolvedValue("timeout");
    const { rerender } = renderHook(({ a }) => useReconnect(a), { initialProps: { a: true } });
    rerender({ a: false });
    await advance(120_000);
    expect(recoverSession).not.toHaveBeenCalled();
  });
});
