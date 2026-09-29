/**
 * useSessionRecovery.test.tsx — the grace-and-recover state machine that keeps
 * a transient "no session" from bouncing a signed-in rep to /login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { recoverSession } = vi.hoisted(() => ({ recoverSession: vi.fn() }));
vi.mock("@/stores/auth", () => ({ recoverSession }));

import { useSessionRecovery } from "./useSessionRecovery";

beforeEach(() => {
  recoverSession.mockReset();
});

describe("useSessionRecovery", () => {
  it("does not attempt recovery while inactive (has a user), reports settled", () => {
    const { result } = renderHook(() => useSessionRecovery(false));
    expect(result.current).toBe("settled");
    expect(recoverSession).not.toHaveBeenCalled();
  });

  it("reports 'recovering' while an attempt is in flight, then 'settled' when it finishes", async () => {
    let resolve!: (v: string) => void;
    recoverSession.mockReturnValue(new Promise<string>((r) => { resolve = r; }));

    const { result } = renderHook(() => useSessionRecovery(true));
    // Attempt kicked off; still in flight.
    expect(recoverSession).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("recovering");

    // Recovery failed (no session found) — the hook settles so the caller can
    // now redirect. (`active` stays true because the store still has no user.)
    await act(async () => { resolve("expired"); });
    expect(result.current).toBe("settled");
  });

  it("runs recovery at most once per episode (no re-fire on re-render)", async () => {
    recoverSession.mockResolvedValue("expired");
    const { result, rerender } = renderHook(({ a }) => useSessionRecovery(a), {
      initialProps: { a: true },
    });
    await waitFor(() => expect(result.current).toBe("settled"));
    rerender({ a: true });
    rerender({ a: true });
    expect(recoverSession).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the user returns: a later logout episode recovers again", async () => {
    recoverSession.mockResolvedValue("expired");
    const { result, rerender } = renderHook(({ a }) => useSessionRecovery(a), {
      initialProps: { a: true },
    });
    await waitFor(() => expect(result.current).toBe("settled"));
    expect(recoverSession).toHaveBeenCalledTimes(1);

    // User recovered (active flips false)...
    rerender({ a: false });
    expect(result.current).toBe("settled");

    // ...then a NEW logout episode (active true again) triggers a fresh attempt.
    rerender({ a: true });
    expect(recoverSession).toHaveBeenCalledTimes(2);
    expect(result.current).toBe("recovering");
  });
});

/**
 * The hold-instead-of-logout behaviour. "We never reached the server" is not
 * the same answer as "the server says you are signed out", and only the second
 * justifies sending a rep to /login. A rep who drives through a dead zone used
 * to be handed a sign-in form they had no connection to submit.
 */
describe("useSessionRecovery holds instead of settling when the network is the problem", () => {
  it.each(["transport", "timeout"])(
    "reports 'reconnecting' when recovery failed with %s",
    async (outcome) => {
      recoverSession.mockResolvedValue(outcome);
      const { result } = renderHook(() => useSessionRecovery(true));
      await waitFor(() => expect(result.current).toBe("reconnecting"));
    },
  );

  it.each(["expired", "unknown", "no-session"])(
    "settles (so the caller may redirect) when recovery failed with %s",
    async (outcome) => {
      recoverSession.mockResolvedValue(outcome);
      const { result } = renderHook(() => useSessionRecovery(true));
      await waitFor(() => expect(result.current).toBe("settled"));
    },
  );

  it("retries when the browser reports the connection is back", async () => {
    recoverSession.mockResolvedValue("transport");
    const { result } = renderHook(() => useSessionRecovery(true));
    await waitFor(() => expect(result.current).toBe("reconnecting"));
    expect(recoverSession).toHaveBeenCalledTimes(1);

    recoverSession.mockResolvedValue("recovered");
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(recoverSession).toHaveBeenCalledTimes(2));
  });

  it("retries when the rep comes back to the app", async () => {
    // A phone that slept through the outage never fires `online`, so returning
    // to the app has to be its own trigger or the rep is stuck on the wall.
    recoverSession.mockResolvedValue("transport");
    const { result } = renderHook(() => useSessionRecovery(true));
    await waitFor(() => expect(result.current).toBe("reconnecting"));

    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(recoverSession).toHaveBeenCalledTimes(2));
  });

  it("tells Sentry which caller asked, so a boot gate is separable from a mid-session request", async () => {
    recoverSession.mockResolvedValue("expired");
    renderHook(() => useSessionRecovery(true));
    await waitFor(() =>
      expect(recoverSession).toHaveBeenCalledWith(
        expect.objectContaining({ caller: "protected_route" }),
      ),
    );
  });
});
