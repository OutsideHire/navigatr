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

export type RecoveryPhase = "recovering" | "reconnecting" | "settled";

export function useSessionRecovery(active: boolean): RecoveryPhase {
  const [phase, setPhase] = useState<RecoveryPhase>("recovering");
  // Bumped to re-run recovery when the moment is right (see the listener
  // below). Not a timer: a rep on a dead screen should not generate background
  // auth traffic, so we only retry on an event that plausibly changed the
  // answer.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) {
      // Have a user (or still bootstrapping): re-arm for a future episode.
      setPhase("recovering");
      return;
    }
    let cancelled = false;
    setPhase("recovering");
    void recoverSession({ caller: "protected_route" }).then(
      (outcome) => {
        if (cancelled) return;
        // THE DISTINCTION THIS WHOLE CHANGE EXISTS FOR. "transport" and
        // "timeout" mean we never got an answer about the token, so we do NOT
        // know the rep is signed out and must not act as if we do. Redirecting
        // a rep in a tunnel to /login strands them on a form they cannot
        // submit, mid-route, with their day gone from the screen: the exact
        // failure the mobile-logout fix existed to stop, arriving by a
        // different door. Hold instead, and try again when something changes.
        setPhase(outcome === "transport" || outcome === "timeout" ? "reconnecting" : "settled");
      },
      () => {
        if (!cancelled) setPhase("settled");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, attempt]);

  // Retry on the two events that can actually change the outcome: the link
  // coming back, and the rep returning to the app (a phone that slept through
  // the outage never fires `online`). Both are free until they fire.
  useEffect(() => {
    if (!active) return;
    const retry = () => setAttempt((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  // While inactive there is nothing to recover, so report "settled" regardless
  // of the re-armed internal phase.
  return active ? phase : "settled";
}
