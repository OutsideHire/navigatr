/**
 * useRetryCooldown: a short, self-resetting cooldown for a manual "Retry"
 * button.
 *
 * Path discovery is expensive: one retry re-runs a large Google Places fan-out.
 * During the 2026-09-10 outage, reps mashing "Retry" on the error card kept the
 * Places quota pinned. This hook gates the button: after `arm()` is called
 * (on a retry click), `cooling` stays true for `seconds`, with `remaining`
 * counting down so the button can show "Try again in 12s".
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface RetryCooldown {
  /** True while the button should stay disabled. */
  cooling: boolean;
  /** Whole seconds left on the cooldown (0 when not cooling). */
  remaining: number;
  /** Start (or restart) the cooldown. Call this when a retry actually fires. */
  arm: () => void;
}

export function useRetryCooldown(seconds = 20): RetryCooldown {
  const [remaining, setRemaining] = useState(0);
  const endRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const rem = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000));
    setRemaining(rem);
    if (rem <= 0) stop();
  }, [stop]);

  const arm = useCallback(() => {
    endRef.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
    stop();
    timerRef.current = setInterval(tick, 250);
  }, [seconds, stop, tick]);

  // Clear any pending interval when the component unmounts.
  useEffect(() => stop, [stop]);

  return { cooling: remaining > 0, remaining, arm };
}
