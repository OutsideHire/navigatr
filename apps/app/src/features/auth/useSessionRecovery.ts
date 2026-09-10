/**
 * useSessionRecovery — give a "no user" state a chance to recover before the
 * app treats it as signed out.
 *
 * iOS Safari and WebKit PWAs can momentarily report "no session" on resume or
 * reload even when a valid refresh token is still in storage. ProtectedRoute
 * uses this hook so that, instead of redirecting to /login the instant the auth
 * store shows no user, it first runs recoverSession() (re-read + refresh with a
 * short retry) and only redirects if that genuinely fails.
 *
 * Contract:
 *   active = "the store shows no user and we haven't confirmed a real sign-out"
 *   - active false            → nothing to recover; returns "settled", and the
 *                               hook re-arms so a LATER logout can recover again.
 *   - active true, in flight  → returns "recovering" (caller shows a spinner).
 *   - active true, finished   → returns "settled" (caller may now redirect).
 *
 * Recovery runs at most once per episode (per continuous stretch of active). A
 * successful recovery flips the store's user back on, which flips `active` to
 * false — no redirect, no loop.
 */
import { useEffect, useState } from "react";
import { recoverSession } from "@/stores/auth";

export type RecoveryPhase = "recovering" | "settled";

export function useSessionRecovery(active: boolean): RecoveryPhase {
  const [phase, setPhase] = useState<RecoveryPhase>("recovering");

  useEffect(() => {
    if (!active) {
      // Have a user (or still bootstrapping): re-arm for a future episode.
      setPhase("recovering");
      return;
    }
    let cancelled = false;
    setPhase("recovering");
    void recoverSession().finally(() => {
      if (!cancelled) setPhase("settled");
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // While inactive there is nothing to recover, so report "settled" regardless
  // of the re-armed internal phase.
  return active ? phase : "settled";
}
