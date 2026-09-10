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
    let resolve!: (v: boolean) => void;
    recoverSession.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));

    const { result } = renderHook(() => useSessionRecovery(true));
    // Attempt kicked off; still in flight.
    expect(recoverSession).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("recovering");

    // Recovery failed (no session found) — the hook settles so the caller can
    // now redirect. (`active` stays true because the store still has no user.)
    await act(async () => { resolve(false); });
    expect(result.current).toBe("settled");
  });

  it("runs recovery at most once per episode (no re-fire on re-render)", async () => {
    recoverSession.mockResolvedValue(false);
    const { result, rerender } = renderHook(({ a }) => useSessionRecovery(a), {
      initialProps: { a: true },
    });
    await waitFor(() => expect(result.current).toBe("settled"));
    rerender({ a: true });
    rerender({ a: true });
    expect(recoverSession).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the user returns: a later logout episode recovers again", async () => {
    recoverSession.mockResolvedValue(false);
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
