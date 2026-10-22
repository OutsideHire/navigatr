/**
 * useReconnect: keep confirming a held session in the background.
 *
 * When auth-js does not answer in time but a session is stored on the device,
 * the store keeps the rep in the app as that user and sets `reconnecting`
 * (see holdProvisionalSession). This hook, mounted by ProtectedRoute, keeps
 * asking until there is an answer:
 *   - recovered        -> the store confirms the session; it also reloads the
 *                         screens that failed meanwhile (confirmSession).
 *   - timeout/transport-> still no answer; try again later, backing off.
 *   - expired, unknown, no-session -> a definitive answer; hand the rep to
 *                         sign-in exactly as before (abandonProvisionalSession).
 *
 * Retries are TIMED here, unlike the full-screen wall, because the case this
 * exists for is a rep who is ONLINE: `online` never fires for them, so an
 * event-only retry left them stuck until they gave up and signed in again.
 * Backoff caps at 30s, and each attempt is the store's single-flight
 * recovery, so this adds at most one auth attempt per step.
 */
import { useEffect } from "react";
import { abandonProvisionalSession, recoverSession } from "@/stores/auth";

const DELAYS_MS = [2000, 4000, 8000, 16000, 30000];

export function reconnectDelayMs(n: number): number {
  return DELAYS_MS[Math.min(n, DELAYS_MS.length - 1)]!;
}

export function useReconnect(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let running = false;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(run, reconnectDelayMs(step));
    };

    function run() {
      if (stopped || running) return;
      if (timer) clearTimeout(timer);
      timer = null;
      running = true;
      void recoverSession({ caller: "protected_route" }).then(
        (outcome) => {
          running = false;
          if (stopped) return;
          if (outcome === "recovered") {
            // The store reloads failed screens on every hold-ending
            // transition, however it ends (see confirmSession in auth.ts).
            stopped = true;
            return;
          }
          if (outcome === "timeout" || outcome === "transport") {
            step += 1;
            schedule();
            return;
          }
          stopped = true;
          abandonProvisionalSession();
        },
        () => {
          running = false;
          step += 1;
          schedule();
        },
      );
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}
